/*
 * Vercel 서버리스 함수: 브라우저 → /api/llm → OpenRouter
 *
 * 왜 필요한가: 브라우저에 API 키를 넣으면 누구나 볼 수 있다. 키는 Vercel 환경 변수에만 두고,
 * 이 함수가 대신 OpenRouter를 부른다. (빌드 단계 없음, 설치할 패키지 없음)
 *
 * 환경 변수 (Vercel → Project → Settings → Environment Variables)
 *   OPENROUTER_API_KEY   필수. 절대 코드나 GitHub에 쓰지 않는다
 *   ACCESS_CODE          필수. 화면에서 입력하는 접근 코드. 요청 헤더 x-access-code 와 같아야 통과
 *   SYSTEM_PROMPT        선택. 모델에게 주는 지시문. 브라우저가 보낸 지시문(system)은 무시한다
 *   OPENROUTER_MODELS    선택. 쉼표로 구분한 모델 목록. 앞에서부터 시도하고 실패(429·5xx·시간 초과)하면 다음으로
 *   RATE_LIMIT_PER_MIN   선택. IP 하나당 1분에 허용할 요청 수 (기본 10)
 *   DAILY_LIMIT          선택. 서버 인스턴스 하나가 하루에 받을 전체 요청 수 (기본 200)
 *
 * 요청:  POST /api/llm  헤더 x-access-code: <접근 코드>
 *        본문 {"prompt": "..."}  또는  {"messages": [{"role":"user"|"assistant","content":"..."}]}
 *        (system 역할 메시지와 system 칸은 버린다. 지시문은 서버에서만 정한다)
 * 응답:  200 {"text": "...", "model": "실제로 답한 모델"}
 *        4xx/5xx {"error": "한국어 설명"}
 */
'use strict';

const crypto = require('crypto');

const DEFAULT_MODELS = ['openrouter/free'];
const DEFAULT_SYSTEM = '너는 사용자를 돕는 도우미다. 입력에 없는 사실이나 숫자를 지어내지 말고, 모르면 모른다고 말한다. 한국어 존댓말로 짧게 답한다.';
const MAX_TRACKED_IPS = 5000;
const MAX_INPUT_CHARS = 8000;
const MAX_MESSAGES = 20;
const PER_MODEL_TIMEOUT_MS = 20000;
const WINDOW_MS = 60 * 1000;

// 메모리에만 있는 간단한 제한. 서버 인스턴스가 새로 뜨면 0부터 다시 센다(완벽한 제한이 아님).
// 진짜 안전장치는 OpenRouter 키에 건 사용 한도(credit limit)다.
const state = { hits: new Map(), fails: new Map(), day: '', dayCount: 0 };
const FAIL_WINDOW_MS = 10 * 60 * 1000; // 접근 코드를 틀린 기록을 보는 기간
const MAX_FAILS = 5;                    // 이 기간에 이만큼 틀리면 잠금

function models() {
  const list = String(process.env.OPENROUTER_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_MODELS;
}

// IP 는 Vercel 이 직접 붙이는 x-vercel-forwarded-for 만 믿는다.
// x-forwarded-for 맨 앞 값이나 x-real-ip 는 사용자가 마음대로 써 넣을 수 있어서 쓰지 않는다.
function clientIp(req) {
  const h = req.headers || {};
  const v = String(h['x-vercel-forwarded-for'] || '').split(',')[0].trim();
  return v || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function sameCode(given, expected) {
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

// 지웠다가 다시 넣어 "가장 최근"으로 옮기고, 너무 많아지면 가장 오래된 IP 부터 뺀다
// (한꺼번에 다 지우면 제한이 풀려 버리므로)
function remember(map, ip, list) {
  map.delete(ip);
  map.set(ip, list);
  while (map.size > MAX_TRACKED_IPS) map.delete(map.keys().next().value);
}

// 1) IP 하나당 1분 요청 수. 하루 전체 예산은 여기서 건드리지 않는다.
function ipLimited(ip, now) {
  const perMin = parseInt(process.env.RATE_LIMIT_PER_MIN || '10', 10);
  const recent = (state.hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= perMin) { remember(state.hits, ip, recent); return '요청이 너무 잦습니다. 1분 뒤에 다시 시도하세요.'; }
  recent.push(now);
  remember(state.hits, ip, recent);
  return null;
}

// 2) 접근 코드를 여러 번 틀린 IP 는 잠시 잠근다 (따로 센다)
function lockedOut(ip, now) {
  const recent = (state.fails.get(ip) || []).filter((t) => now - t < FAIL_WINDOW_MS);
  return recent.length >= MAX_FAILS;
}
function recordFail(ip, now) {
  const recent = (state.fails.get(ip) || []).filter((t) => now - t < FAIL_WINDOW_MS);
  recent.push(now);
  remember(state.fails, ip, recent);
}

// 3) 하루 전체 예산: 접근 코드와 요청 형식이 모두 맞은 요청만 센다
//    (틀린 요청으로 예산을 다 써 버리게 만드는 공격을 막기 위해)
function takeDailyBudget(now) {
  const daily = parseInt(process.env.DAILY_LIMIT || '200', 10);
  const today = new Date(now).toISOString().slice(0, 10);
  if (state.day !== today) { state.day = today; state.dayCount = 0; }
  if (state.dayCount >= daily) return false;
  state.dayCount++;
  return true;
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') return Promise.resolve(JSON.parse(req.body || '{}'));
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > MAX_INPUT_CHARS * 4) reject(new Error('too large')); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function buildMessages(body) {
  let messages;
  if (Array.isArray(body.messages)) messages = body.messages;
  else if (typeof body.prompt === 'string') messages = [{ role: 'user', content: body.prompt }];
  else return { error: 'prompt(문자열) 또는 messages(배열)가 필요합니다.' };
  if (messages.length > MAX_MESSAGES * 2) return { error: '메시지가 너무 많습니다.' };
  // 브라우저가 보낸 system 역할은 버린다 (지시문은 서버에서만 정한다). body.system 도 쓰지 않는다.
  messages = messages.filter((m) => !(m && m.role === 'system'));
  if (!messages.length || messages.length > MAX_MESSAGES) return { error: '메시지는 1~' + MAX_MESSAGES + '개여야 합니다.' };
  let chars = 0;
  for (const m of messages) {
    if (!m || typeof m.content !== 'string' || !['user', 'assistant'].includes(m.role)) return { error: '메시지 형식이 맞지 않습니다(user·assistant 만).' };
    chars += m.content.length;
  }
  if (chars > MAX_INPUT_CHARS) return { error: '입력이 너무 깁니다(최대 ' + MAX_INPUT_CHARS + '자).' };
  const system = process.env.SYSTEM_PROMPT || DEFAULT_SYSTEM;
  return { messages: [{ role: 'system', content: system }].concat(messages.map((m) => ({ role: m.role, content: m.content }))) };
}

async function callModel(model, messages, key) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_MODEL_TIMEOUT_MS);
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'hackathon-starter' },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 1500 })
    });
    if (r.status === 401 || r.status === 403) return { fatal: '서버의 OpenRouter 키가 맞지 않거나 권한이 없습니다.' };
    if (!r.ok) return { retry: model + ': ' + r.status };
    const data = await r.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) return { retry: model + ': 빈 응답' };
    return { text, model: data.model || model };
  } catch (e) {
    return { retry: model + ': ' + (e.name === 'AbortError' ? '시간 초과' : '연결 실패') };
  } finally {
    clearTimeout(timer);
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'POST만 받습니다.' }); }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return send(res, 500, { error: '서버에 OPENROUTER_API_KEY 환경 변수가 없습니다. Vercel 설정에서 넣고 다시 배포하세요.' });
  const code = process.env.ACCESS_CODE;
  if (!code) return send(res, 500, { error: '서버에 ACCESS_CODE 환경 변수가 없습니다. Vercel 설정에서 넣고 다시 배포하세요.' });
  const ip = clientIp(req), now = Date.now();
  // 1) IP 별 요청 수 (전체 예산은 아직 안 씀)
  const why = ipLimited(ip, now);
  if (why) { res.setHeader('Retry-After', '60'); return send(res, 429, { error: why }); }
  // 2) 접근 코드. 여러 번 틀리면 10분 잠금
  if (lockedOut(ip, now)) { res.setHeader('Retry-After', '600'); return send(res, 429, { error: '접근 코드를 여러 번 틀렸습니다. 10분 뒤에 다시 시도하세요.' }); }
  const h = req.headers || {};
  if (!sameCode(h['x-access-code'], code)) { recordFail(ip, now); return send(res, 401, { error: '접근 코드가 맞지 않습니다.' }); }
  // 3) 요청 형식
  let body;
  try { body = await readBody(req); } catch (e) { return send(res, 400, { error: 'JSON 형식이 아닙니다.' }); }
  const built = buildMessages(body || {});
  if (built.error) return send(res, 400, { error: built.error });
  // 4) 여기까지 통과한 요청만 하루 전체 예산을 쓴다
  if (!takeDailyBudget(now)) { res.setHeader('Retry-After', '3600'); return send(res, 429, { error: '오늘 쓸 수 있는 요청 수를 다 썼습니다. 내일 다시 시도하세요.' }); }

  const tried = [];
  for (const model of models()) {
    const out = await callModel(model, built.messages, key);
    if (out.fatal) return send(res, 502, { error: out.fatal });
    if (out.text) return send(res, 200, { text: out.text, model: out.model, tried });
    tried.push(out.retry);
  }
  return send(res, 503, { error: '모든 모델이 지금 응답하지 않습니다. 잠시 뒤 다시 시도하세요.', tried });
}

module.exports = handler;
module.exports._reset = () => { state.hits.clear(); state.fails.clear(); state.day = ''; state.dayCount = 0; };
module.exports._dayCount = () => state.dayCount;
module.exports._trackedIps = () => state.hits.size;
module.exports.MAX_TRACKED_IPS = MAX_TRACKED_IPS;
