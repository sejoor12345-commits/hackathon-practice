/*
 * toolkit/starter/api/llm.js 테스트 – 진짜 OpenRouter를 부르지 않고 fetch 를 가짜로 바꿔서 시험한다.
 *   node --test toolkit/tests/llm.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const handler = require('../starter/api/llm.js');

function fakeRes() {
  return {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s; this.json = JSON.parse(s); }
  };
}
function req(body, ip, method) { return { method: method || 'POST', headers: { 'x-forwarded-for': ip || '1.1.1.1' }, body }; }
function okReply(text, model) { return { ok: true, status: 200, json: async () => ({ model, choices: [{ message: { content: text } }] }) }; }

const realFetch = global.fetch;
test.beforeEach(() => {
  handler._reset();
  process.env.OPENROUTER_API_KEY = 'sk-test-not-real';
  delete process.env.OPENROUTER_MODELS; delete process.env.RATE_LIMIT_PER_MIN; delete process.env.DAILY_LIMIT;
});
test.after(() => { global.fetch = realFetch; });

test('정상: 키는 서버에서만 붙고, 답과 모델 이름을 돌려준다', async () => {
  let seen;
  global.fetch = async (url, opts) => { seen = { url, opts }; return okReply('안녕하세요', 'some/model'); };
  const res = fakeRes();
  await handler(req({ prompt: '안녕', system: '짧게' }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json.text, '안녕하세요');
  assert.strictEqual(res.json.model, 'some/model');
  assert.strictEqual(seen.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.strictEqual(seen.opts.headers.Authorization, 'Bearer sk-test-not-real');
  const sent = JSON.parse(seen.opts.body);
  assert.deepStrictEqual(sent.messages, [{ role: 'system', content: '짧게' }, { role: 'user', content: '안녕' }]);
  assert.ok(!res.body.includes('sk-test-not-real'), '응답에 키가 섞이면 안 됨');
});

test('대체 모델: 429·시간 초과면 다음 모델로 넘어간다', async () => {
  process.env.OPENROUTER_MODELS = 'a:free, b:free, c:free';
  const order = [];
  global.fetch = async (url, opts) => {
    const m = JSON.parse(opts.body).model; order.push(m);
    if (m === 'a:free') return { ok: false, status: 429, json: async () => ({}) };
    if (m === 'b:free') { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    return okReply('세 번째가 답함', m);
  };
  const res = fakeRes();
  await handler(req({ prompt: 'x' }), res);
  assert.deepStrictEqual(order, ['a:free', 'b:free', 'c:free']);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json.model, 'c:free');
  assert.deepStrictEqual(res.json.tried, ['a:free: 429', 'b:free: 시간 초과']);
});

test('모든 모델 실패 → 503, 키 오류 → 502 (다음 모델을 시도하지 않음)', async () => {
  process.env.OPENROUTER_MODELS = 'a,b';
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  let res = fakeRes(); await handler(req({ prompt: 'x' }), res);
  assert.strictEqual(res.statusCode, 503);
  let n = 0;
  global.fetch = async () => { n++; return { ok: false, status: 401, json: async () => ({}) }; };
  res = fakeRes(); await handler(req({ prompt: 'x' }, '2.2.2.2'), res);
  assert.strictEqual(res.statusCode, 502);
  assert.strictEqual(n, 1);
});

test('요청 수 제한: 같은 IP 1분 10회 넘으면 429, 다른 IP는 통과', async () => {
  global.fetch = async () => okReply('ok', 'm');
  for (let i = 0; i < 10; i++) { const r = fakeRes(); await handler(req({ prompt: 'x' }, '9.9.9.9'), r); assert.strictEqual(r.statusCode, 200); }
  const blocked = fakeRes(); await handler(req({ prompt: 'x' }, '9.9.9.9'), blocked);
  assert.strictEqual(blocked.statusCode, 429);
  assert.strictEqual(blocked.headers['retry-after'], '60');
  const other = fakeRes(); await handler(req({ prompt: 'x' }, '8.8.8.8'), other);
  assert.strictEqual(other.statusCode, 200);
});

test('하루 제한(DAILY_LIMIT)', async () => {
  process.env.DAILY_LIMIT = '2';
  global.fetch = async () => okReply('ok', 'm');
  const codes = [];
  for (const ip of ['1', '2', '3']) { const r = fakeRes(); await handler(req({ prompt: 'x' }, ip), r); codes.push(r.statusCode); }
  assert.deepStrictEqual(codes, [200, 200, 429]);
});

test('잘못된 요청: GET, 키 없음, 형식 오류, 너무 긴 입력', async () => {
  let called = 0;
  global.fetch = async () => { called++; return okReply('x', 'm'); };
  let r = fakeRes(); await handler(req({ prompt: 'x' }, '1', 'GET'), r); assert.strictEqual(r.statusCode, 405);
  delete process.env.OPENROUTER_API_KEY;
  r = fakeRes(); await handler(req({ prompt: 'x' }), r); assert.strictEqual(r.statusCode, 500);
  assert.match(r.json.error, /OPENROUTER_API_KEY/);
  process.env.OPENROUTER_API_KEY = 'k';
  r = fakeRes(); await handler(req({ nothing: 1 }), r); assert.strictEqual(r.statusCode, 400);
  r = fakeRes(); await handler(req({ messages: [{ role: 'hacker', content: 'x' }] }), r); assert.strictEqual(r.statusCode, 400);
  r = fakeRes(); await handler(req({ prompt: 'ㄱ'.repeat(8001) }), r); assert.strictEqual(r.statusCode, 400);
  r = fakeRes(); await handler(req('{not json'), r); assert.strictEqual(r.statusCode, 400);
  assert.strictEqual(called, 0, '잘못된 요청은 OpenRouter를 부르지 않는다');
});

test('본문이 스트림으로 올 때도 읽는다 (req.body 없음)', async () => {
  const { Readable } = require('stream');
  global.fetch = async () => okReply('stream ok', 'm');
  const r = Readable.from([Buffer.from(JSON.stringify({ prompt: '안녕' }))]);
  r.method = 'POST'; r.headers = {};
  const res = fakeRes(); await handler(r, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json.text, 'stream ok');
});
