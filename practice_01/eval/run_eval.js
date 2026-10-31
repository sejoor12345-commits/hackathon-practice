/*
 * mock 모드로 에이전트를 돌리고 채점해서 output/ 에 결과를 남긴다. (비용 0원)
 *   node practice_01/eval/run_eval.js
 * 만드는 파일
 *   practice_01/agent/output/mock_practice01.json / .md   (원래 메모 10개)
 *   practice_01/eval/output/mock_eval.json / .md          (평가 세트 12개)
 *   practice_01/eval/output/mock_eval_faults.json         (지어낸 문장 섞기 시연)
 *   practice_01/eval/output/old_reports_check.md          (기존 results/reports.md 를 같은 기준으로 다시 본 결과)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Agent = require('../agent/agent-core.js');
const Grader = require('./grade.js');

const P1 = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s.endsWith('\n') ? s : s + '\n'); };

async function runSet(memos, answers, injectFaults) {
  return Agent.run({ memosMd: read(memos), loadAnswers: () => read(answers), mode: 'mock', injectFaults });
}

// 기존 results/reports.md (practice_01 4회차 결과물)를 문장 단위로 다시 본다.
// 인용 형식이 달라 인용 검사는 못 하고, 원문(메모+답변)에 없는 숫자·시점·인과만 센다.
function checkOldReports() {
  const memos = Agent.parseMemos(read(path.join(P1, 'memos.md')));
  const answers = Agent.parseAnswers(read(path.join(P1, 'answers.md')));
  const md = read(path.join(P1, 'results', 'reports.md'));
  const T = ['지난달', '이번 달', '다음 달', '개월', '연속', '항상', '요즘', '처음', '최근', '꾸준히', '계속'];
  const C = ['때문', '덕분', '덕택', '덕에', '그래서', '따라서', '인해', '결과로'];
  const rows = [];
  let total = 0;
  md.split(/\n## /).slice(1).forEach((sec) => {
    const m = sec.match(/^([0-9]+)\. (\S+)/);
    if (!m) return;
    const no = +m[1];
    const memo = memos.find((x) => x.no === no);
    const src = memo.text + ' ' + (answers[no] ? answers[no].text : '');
    const para = sec.split('\n').filter((l) => l && !l.startsWith('>') && !/^[0-9]+\. /.test(l)).join(' ');
    para.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean).forEach((s) => {
      if (s === '안녕하세요.' || /학생의 이번 달 학습 상황을 안내드립니다\.$/.test(s)) return; // 인사 문장
      total++;
      const p = [];
      (s.match(/[0-9]+/g) || []).forEach((n) => { if (!(src.match(/[0-9]+/g) || []).includes(n)) p.push('숫자 ' + n); });
      T.forEach((w) => { if (s.includes(w) && !src.includes(w)) p.push('시점 "' + w + '"'); });
      C.forEach((w) => { if (s.includes(w) && !src.includes(w)) p.push('인과 "' + w + '"'); });
      if (p.length) rows.push({ no, s, p });
    });
  });
  const L = ['# 기존 practice_01 리포트(results/reports.md) 다시 보기', '',
    '> 인사 문장은 빼고 셌습니다. 인용 형식이 달라 인용 검사는 하지 않았고, 원문(메모+답변)에 없는 숫자·시점·인과 표현만 셌습니다.', '',
    '| 항목 | 값 |', '|---|---|', '| 검사한 문장 | ' + total + ' |', '| 원문에 없는 표현이 든 문장 | ' + rows.length + ' |', '',
    '| 메모 | 문장 | 원문에 없는 표현 |', '|---|---|---|'];
  rows.forEach((r) => L.push('| ' + r.no + ' | ' + r.s + ' | ' + r.p.join(', ') + ' |'));
  return { md: L.join('\n'), total, flagged: rows.length };
}

async function main() {
  const evalDir = __dirname;
  const gold = JSON.parse(read(path.join(evalDir, 'gold.json')));
  const g = (run) => Grader.grade({ run, memosMd: read(path.join(evalDir, 'memos.md')), answersMd: read(path.join(evalDir, 'answers.md')), gold });

  const p1 = await runSet(path.join(P1, 'memos.md'), path.join(P1, 'answers.md'), false);
  write(path.join(P1, 'agent', 'output', 'mock_practice01.json'), JSON.stringify(p1, null, 2));
  write(path.join(P1, 'agent', 'output', 'mock_practice01.md'), Agent.toMarkdown(p1));

  const ev = await runSet(path.join(evalDir, 'memos.md'), path.join(evalDir, 'answers.md'), false);
  const evRes = g(ev);
  write(path.join(evalDir, 'output', 'mock_eval.json'), JSON.stringify(ev, null, 2));
  write(path.join(evalDir, 'output', 'mock_eval.md'), Agent.toMarkdown(ev) + '\n\n' + Grader.toMarkdown(evRes, '채점 결과 (mock, 평가 세트)'));

  const evf = await runSet(path.join(evalDir, 'memos.md'), path.join(evalDir, 'answers.md'), true);
  const evfRes = g(evf);
  write(path.join(evalDir, 'output', 'mock_eval_faults.json'), JSON.stringify(evf, null, 2));

  const old = checkOldReports();
  write(path.join(evalDir, 'output', 'old_reports_check.md'), old.md);

  const summary = {
    practice01: { judged_ambiguous: p1.judgments.filter((j) => j.verdict === '애매').map((j) => j.memo), selfcheck: p1.selfcheck },
    eval: evRes.scores,
    eval_faults_selfcheck: evf.selfcheck,
    eval_faults_scores: { 지어낸_문장: evfRes.scores.지어낸_문장, 인용_유효: evfRes.scores.인용_유효 },
    old_reports: { sentences: old.total, flagged: old.flagged }
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
