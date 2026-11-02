/*
 * 에이전트·채점기 자동 테스트 (설치할 것 없음)
 *   node --test practice_01/eval/test_eval.js
 * 1) 일부러 망가뜨린 리포트 10종을 채점기가 모두 잡는가
 * 2) JS 에이전트와 파이썬 에이전트, JS 채점기와 파이썬 채점기가 같은 결과를 내는가 (python3 가 있을 때만)
 * 3) llm 모드: 가짜 모델(돈 안 드는 함수)로 형식이 깨진 출력·지어낸 문장이 와도 끝까지 돌고, 자가 점검이 막는가
 * 4) 답변 파일은 질문을 다 만든 뒤에만 열리는가
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Agent = require('../agent/agent-core.js');
const Grader = require('./grade.js');

const E = __dirname;
const P1 = path.join(E, '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const evalMemos = read(path.join(E, 'memos.md'));
const evalAnswers = read(path.join(E, 'answers.md'));
const gold = JSON.parse(read(path.join(E, 'gold.json')));
const gradeRun = (run) => Grader.grade({ run, memosMd: evalMemos, answersMd: evalAnswers, gold });
const mockEval = (extra) => Agent.run(Object.assign({ memosMd: evalMemos, loadAnswers: () => evalAnswers, mode: 'mock' }, extra || {}));
const clone = (x) => JSON.parse(JSON.stringify(x));
const rep = (run, no) => run.reports.find((r) => r.memo === no);

test('채점기: 일부러 망가뜨린 10종을 모두 잡는다', async () => {
  const base = await mockEval();
  const b = gradeRun(base).scores;
  const cases = [
    ['숫자 바꾸기', (r) => { const s = rep(r, 1).sentences[0]; s.text = s.text.replace('91', '92'); }, (s) => s.지어낸_문장.got === b.지어낸_문장.got + 1 && s.인용_유효.got === b.인용_유효.got - 1],
    ['시점 덧붙이기', (r) => { const s = rep(r, 5).sentences[1]; s.text = '이번 달 ' + s.text; }, (s) => s.지어낸_문장.got === b.지어낸_문장.got + 1],
    ['인과 덧붙이기', (r) => { const s = rep(r, 10).sentences[0]; s.text = '꾸준히 노력한 덕분에 ' + s.text; }, (s) => s.지어낸_문장.got === b.지어낸_문장.got + 1],
    ['인용 바꾸기', (r) => { rep(r, 3).sentences[0].cites[0].quote = '듣기 점수가 크게 올랐어요'; }, (s) => s.인용_유효.got === b.인용_유효.got - 1],
    ['다른 학생 메모 인용', (r) => { rep(r, 7).sentences[0].cites[0].src = '메모 1'; }, (s) => s.인용_유효.got === b.인용_유효.got - 1],
    ['보류할 주장 넣기', (r) => { rep(r, 4).sentences.push({ text: '발음이 눈에 띄게 좋아졌습니다.', cites: [{ src: '메모 4', quote: '발음이 눈에 띄게 좋아졌어요' }], flags: [] }); }, (s) => s.보류_위반 === b.보류_위반 + 1],
    ['사실 빠뜨리기', (r) => { const x = rep(r, 7); x.sentences = x.sentences.filter((t) => !t.text.includes('64점')); }, (s) => s.사실_커버리지.got < b.사실_커버리지.got],
    ['인사말에 시점 넣기', (r) => { rep(r, 2).greeting = '안녕하세요. 배준혁 학생의 이번 달 학습 상황을 안내드립니다.'; }, (s) => s.인사말_틀.got === b.인사말_틀.got - 1],
    ['비교 문장에 표시 안 하기', (r) => { rep(r, 8).sentences.push({ text: '반 평균보다 낮은 79점입니다.', cites: [{ src: '메모 8', quote: '단어시험 평균 79점' }], flags: [] }); }, (s) => s.비교_표시.total === 1 && s.비교_표시.got === 0],
    ['판정 뒤집기', (r) => { const j = r.judgments.find((x) => x.memo === 1); j.verdict = '애매'; j.criteria = ['기준1']; }, (s) => s.판정_정확도.got === b.판정_정확도.got - 1 && s.애매_정밀도.got / s.애매_정밀도.total < 1]
  ];
  let caught = 0;
  for (const [name, mutate, detected] of cases) {
    const r = clone(base);
    mutate(r);
    const ok = detected(gradeRun(r).scores);
    assert.ok(ok, name + ' 을(를) 못 잡음');
    caught++;
  }
  assert.strictEqual(caught, 10);
});

test('에이전트 자가 점검: 일부러 섞은 지어낸 문장을 모두 뺀다', async () => {
  const r = await mockEval({ injectFaults: true });
  assert.strictEqual(r.selfcheck.injected, 4);
  assert.strictEqual(r.selfcheck.injected_caught, 4);
  const s = gradeRun(r).scores;
  assert.strictEqual(s.지어낸_문장.got, 0);
});

test('답변 파일은 질문 단계가 끝난 뒤에만 열린다', async () => {
  const steps = [];
  await Agent.run({
    memosMd: evalMemos, mode: 'mock',
    onStep: (n) => steps.push(n),
    loadAnswers: () => { steps.push('<<답변 열기>>'); return evalAnswers; }
  });
  assert.ok(steps.indexOf('<<답변 열기>>') > steps.indexOf('questions'));
  assert.ok(steps.indexOf('<<답변 열기>>') < steps.indexOf('reports'));
});

test('llm 모드: 가짜 모델이 지어낸 문장을 쓰면 고쳐 쓰기 → 그래도 틀리면 뺀다', async () => {
  const calls = [];
  const fake = async (messages) => {
    const p = messages[1].content;
    calls.push(p.slice(0, 20));
    if (p.startsWith('아래 강사 메모를')) return '이건 JSON이 아닙니다'; // 형식 깨짐 → 규칙으로 대신
    if (p.startsWith('각 메모를')) return JSON.stringify({ judgments: [{ no: 8, verdict: '애매', criteria: ['기준3'], reason: '더딘 편 – 시간 수치 없음' }, { no: 9, verdict: '애매', criteria: ['기준2'], reason: '딴짓 – 횟수 없음' }] });
    if (p.startsWith('애매한 메모마다')) return '```json\n{"questions":[{"no":8,"criterion":"기준3","question":"임소율 학생이 20단어를 외우는 데 몇 분 걸리는지 시간을 알려주실 수 있을까요?"}]}\n```';
    if (p.startsWith('학부모에게')) {
      return JSON.stringify({ reports: [
        { no: 1, sentences: [
          { text: '단어시험 평균은 91점으로 지난달 85점보다 올랐습니다.', cites: [{ src: '메모 1', quote: '단어시험 평균 91점(지난달 85점)' }] },
          { text: '꾸준한 노력 덕분에 10점 넘게 올랐습니다.', cites: [{ src: '메모 1', quote: '단어시험 평균 91점' }] }
        ] }
      ] });
    }
    if (p.startsWith('아래 문장들은')) return JSON.stringify({ fixed: [{ id: '1-2', text: '숙제는 4회 모두 제출했습니다.', cites: [{ src: '메모 1', quote: '숙제 4회 모두 제출' }] }] });
    throw new Error('예상 못 한 프롬프트');
  };
  const r = await Agent.run({ memosMd: evalMemos, loadAnswers: () => evalAnswers, mode: 'llm', llm: fake });
  assert.ok(r.llm.calls >= 5);
  assert.ok(r.llm.fallbacks.some((f) => f.startsWith('extract')));
  // 모델이 답한 8·9번은 모델 판정, 답하지 않은 메모는 규칙 판정으로 대신한다
  assert.deepStrictEqual(r.judgments.filter((j) => j.verdict === '애매').map((j) => j.memo), [2, 4, 6, 8, 9, 11]);
  assert.ok(r.llm.fallbacks.some((f) => f.startsWith('judge: 메모 1 ')));
  assert.ok(r.llm.disagreements.length > 0); // 규칙 판정과 다른 곳이 기록된다
  assert.ok(r.questions.find((q) => q.memo === 8).question.startsWith('임소율'));
  assert.strictEqual(r.selfcheck.rewritten, 1);
  const s1 = rep(r, 1).sentences.map((s) => s.text);
  assert.ok(!s1.some((t) => t.includes('덕분')));
  assert.ok(s1.includes('숙제는 4회 모두 제출했습니다.'));
  // 9번 답변(5번 지적)이 리포트에 들어갔는지 – 판정을 모델이 고쳐서 질문·답변이 이어졌다
  assert.ok(rep(r, 9).sentences.some((s) => s.text.includes('5번')));
  assert.strictEqual(gradeRun(r).scores.지어낸_문장.got, 0);
});

function hasPython() { try { execFileSync('python3', ['--version']); return true; } catch (e) { return false; } }

test('JS 와 파이썬이 같은 결과를 낸다 (에이전트·채점기)', { skip: !hasPython() && 'python3 없음' }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p01-'));
  const sets = [[path.join(P1, 'memos.md'), path.join(P1, 'answers.md')], [path.join(E, 'memos.md'), path.join(E, 'answers.md')]];
  for (const [m, a] of sets) {
    for (const faults of [false, true]) {
      const out = path.join(tmp, 'py.json');
      const args = [path.join(P1, 'agent', 'agent.py'), '--mode', 'mock', '--memos', m, '--answers', a, '--out', out];
      if (faults) args.push('--inject-faults');
      execFileSync('python3', args, { stdio: ['ignore', 'ignore', 'ignore'] });
      const py = JSON.parse(read(out));
      const js = clone(await Agent.run({ memosMd: read(m), loadAnswers: () => read(a), mode: 'mock', injectFaults: faults }));
      assert.deepStrictEqual(js, py, path.basename(path.dirname(m)) + ' faults=' + faults);
    }
  }
  const run = clone(await mockEval());
  const runPath = path.join(tmp, 'run.json');
  fs.writeFileSync(runPath, JSON.stringify(run));
  const pyMd = execFileSync('python3', [path.join(E, 'grade.py'), runPath]).toString().trim();
  assert.strictEqual(pyMd, Grader.toMarkdown(gradeRun(run)).trim());
});
