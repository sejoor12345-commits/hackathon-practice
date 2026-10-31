/*
 * practice_01 평가 채점기 (Node + 브라우저 공용). grade.py 는 같은 규칙의 파이썬 판(Colab용).
 *
 * 에이전트 코드(agent-core.js)를 불러오지 않는다. 같은 버그를 함께 갖지 않도록 따로 썼다.
 *
 * 사용 (Node):  node grade.js <run.json> [memos.md] [answers.md] [gold.json]
 *   기본값은 이 폴더의 memos.md / answers.md / gold.json
 *
 * 채점 항목
 *  1. 판정: 정상/애매 정확도, 애매 찾기 재현율·정밀도, 위반 기준 일치
 *  2. 질문: 정답이 애매인 (메모, 기준)마다 학생 이름 + 필요한 근거 단어가 들어간 질문이 있는가
 *  3. 커버리지: 꼭 들어가야 할 사실(must_include)이 리포트에 있는가
 *  4. 보류 지키기: 근거가 끝내 없는 주장(must_not)이 리포트에 없는가.
 *     근거 없는 평가: 애매 메모의 평가 표현(claim)이 강사 답변 근거(needs) 없이 리포트에 나갔는가
 *  5. 지어내기: 그 학생의 메모·답변에 없는 숫자 / 시점 / 인과 표현이 들어간 문장
 *  6. 인용 유효성: 출처가 그 학생 것이고, 인용이 원문 그대로이고, 문장 속 숫자가 인용한 출처에 있는가
 *  7. 비교 표시: 다른 학생과 비교하는 문장에 원장 확인 표시가 붙었는가
 *  8. 인사말: 정해진 틀 그대로인가(숫자·시점이 끼어들지 않았는가)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EvalGrader = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TIMING = ['지난달', '이번 달', '이번달', '다음 달', '다음달', '지난주', '이번 주', '다음 주', '개월', '연속',
    '매일', '매주', '매번', '항상', '처음', '최근', '요즘', '앞으로', '작년', '올해', '학기', '방학',
    '지난번', '그동안', '꾸준히', '계속', '이전', '점점'];
  var CAUSAL = ['때문', '덕분', '덕택', '덕에', '그래서', '따라서', '그 결과', '결과로', '영향으로', '인해', '바람에', '탓',
    '으므로', '니까'];
  var COMPARE = ['다른 애들', '다른 학생', '다른 친구', '다른 아이', '반 평균', '친구들'];
  var GREETING = /^안녕하세요\. [^0-9]+ 학생의 학습 상황을 안내드립니다\.$/;

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function nums(s) { return String(s).match(/[0-9]+(?:\.[0-9]+)?/g) || []; }
  function hits(text, words) { return words.filter(function (w) { return text.indexOf(w) !== -1; }); }

  function parseMemos(md) {
    var out = {};
    String(md).split(/\r?\n/).forEach(function (line) {
      var m = line.match(/^\s*([0-9]+)\.\s*\[\s*([^\/\]]+?)\s*\/\s*([^\]]+?)\s*\]\s*(.+?)\s*$/);
      if (m) out[+m[1]] = { student: m[2], teacher: m[3], text: m[4] };
    });
    return out;
  }
  function parseAnswers(md) {
    var out = {};
    String(md).split(/\r?\n/).forEach(function (line) {
      var c = line.split('|').map(function (s) { return s.trim(); });
      if (c.length >= 5 && /^[0-9]+$/.test(c[1]) && c[3]) out[+c[1]] = c[3];
    });
    return out;
  }
  function ratio(a, b) { return { got: a, total: b, pct: b ? Math.round(1000 * a / b) / 10 : null }; }

  function grade(opts) {
    var run = opts.run, gold = opts.gold;
    var memos = parseMemos(opts.memosMd), answers = parseAnswers(opts.answersMd);
    var issues = [];
    var g = {};
    gold.memos.forEach(function (x) { g[x.no] = x; });
    var nos = gold.memos.map(function (x) { return x.no; });

    // 1. 판정
    var correct = 0, tp = 0, fp = 0, fn = 0, critOk = 0;
    nos.forEach(function (no) {
      var j = (run.judgments || []).filter(function (x) { return x.memo === no; })[0];
      var v = j ? j.verdict : '(없음)';
      if (v === g[no].verdict) correct++;
      else issues.push({ memo: no, kind: '판정', detail: '정답 ' + g[no].verdict + ', 에이전트 ' + v });
      if (g[no].verdict === '애매' && v === '애매') {
        tp++;
        var a = (j.criteria || []).slice().sort().join(','), b = g[no].criteria.slice().sort().join(',');
        if (a === b) critOk++; else issues.push({ memo: no, kind: '기준', detail: '정답 ' + b + ', 에이전트 ' + a });
      }
      if (g[no].verdict !== '애매' && v === '애매') fp++;
      if (g[no].verdict === '애매' && v !== '애매') fn++;
    });

    // 2. 질문
    var qNeed = 0, qOk = 0, qExtra = 0;
    var qs = run.questions || [];
    nos.forEach(function (no) {
      if (g[no].verdict !== '애매') {
        if (qs.some(function (q) { return q.memo === no; })) qExtra++;
        return;
      }
      g[no].criteria.forEach(function (k) {
        qNeed++;
        var ok = qs.some(function (q) {
          var t = norm(q.question);
          return q.memo === no && t.indexOf(memos[no].student) !== -1 && hits(t, gold.keywords[k]).length > 0;
        });
        if (ok) qOk++; else issues.push({ memo: no, kind: '질문', detail: k + ' 근거를 묻는 질문 없음' });
      });
    });

    // 3~8. 리포트
    var atoms = 0, atomsOk = 0, mustNotHits = 0, sentences = 0, fabricated = 0, citeOk = 0, cmpTotal = 0, cmpFlagged = 0;
    var greetOk = 0, unsupported = 0;
    var fabList = [];
    nos.forEach(function (no) {
      var rep = (run.reports || []).filter(function (r) { return r.memo === no; })[0] || { sentences: [], greeting: '' };
      var sources = {};
      sources['메모 ' + no] = memos[no].text;
      if (answers[no]) sources['답변 ' + no] = answers[no];
      var all = memos[no].text + ' ' + (answers[no] || '');
      var allNums = nums(all);
      var body = rep.sentences.map(function (s) { return norm(s.text); }).join(' ');

      if (GREETING.test(norm(rep.greeting)) && norm(rep.greeting).indexOf(memos[no].student) !== -1 && !hits(rep.greeting, TIMING).length) greetOk++;
      else issues.push({ memo: no, kind: '인사말', detail: rep.greeting });

      g[no].must_include.forEach(function (a) {
        atoms++;
        if (body.indexOf(a) !== -1) atomsOk++; else issues.push({ memo: no, kind: '빠진 사실', detail: a });
      });
      g[no].must_not.forEach(function (a) {
        if (body.indexOf(a) !== -1) { mustNotHits++; issues.push({ memo: no, kind: '보류 위반', detail: a }); }
      });
      if (g[no].claim && body.indexOf(g[no].claim) !== -1 &&
          !(g[no].needs || []).every(function (a) { return body.indexOf(a) !== -1; })) {
        unsupported++;
        issues.push({ memo: no, kind: '근거 없는 평가', detail: '"' + g[no].claim + '"이(가) 근거(' + g[no].needs.join(', ') + ') 없이 나감' });
      }

      rep.sentences.forEach(function (s) {
        sentences++;
        var t = norm(s.text), problems = [];
        nums(t).forEach(function (n) { if (allNums.indexOf(n) === -1) problems.push('숫자 ' + n); });
        hits(t, TIMING).forEach(function (w) { if (all.indexOf(w) === -1) problems.push('시점 "' + w + '"'); });
        hits(t, CAUSAL).forEach(function (w) { if (all.indexOf(w) === -1) problems.push('인과 "' + w + '"'); });
        if (problems.length) {
          fabricated++;
          fabList.push({ memo: no, text: t, problems: problems });
          issues.push({ memo: no, kind: '지어내기', detail: t + ' → ' + problems.join(', ') });
        }
        var cites = s.cites || [];
        var cited = '';
        var valid = cites.length > 0 && cites.every(function (c) {
          if (!Object.prototype.hasOwnProperty.call(sources, c.src)) return false;
          cited += ' ' + sources[c.src];
          return norm(c.quote) !== '' && norm(sources[c.src]).indexOf(norm(c.quote)) !== -1;
        });
        if (valid) {
          var cn = nums(cited);
          valid = nums(t).every(function (n) { return cn.indexOf(n) !== -1; });
        }
        if (valid) citeOk++; else issues.push({ memo: no, kind: '인용', detail: t });
        if (hits(t, COMPARE).length) {
          cmpTotal++;
          if ((s.flags || []).some(function (f) { return f.indexOf('비교') !== -1; })) cmpFlagged++;
          else issues.push({ memo: no, kind: '비교 표시 없음', detail: t });
        }
      });
    });

    var scores = {
      판정_정확도: ratio(correct, nos.length),
      애매_재현율: ratio(tp, tp + fn),
      애매_정밀도: ratio(tp, tp + fp),
      위반기준_일치: ratio(critOk, tp),
      질문_적합: ratio(qOk, qNeed),
      불필요한_질문: qExtra,
      사실_커버리지: ratio(atomsOk, atoms),
      보류_위반: mustNotHits,
      근거_없는_평가: unsupported,
      지어낸_문장: ratio(fabricated, sentences),
      인용_유효: ratio(citeOk, sentences),
      비교_표시: ratio(cmpFlagged, cmpTotal),
      인사말_틀: ratio(greetOk, nos.length)
    };
    return { scores: scores, issues: issues, fabricated: fabList };
  }

  function fmt(r) { return typeof r === 'number' ? String(r) : r.got + '/' + r.total + (r.pct == null ? '' : ' (' + r.pct + '%)'); }
  function toMarkdown(result, title) {
    var L = ['## ' + (title || '채점 결과'), '', '| 항목 | 점수 |', '|---|---|'];
    Object.keys(result.scores).forEach(function (k) { L.push('| ' + k.replace(/_/g, ' ') + ' | ' + fmt(result.scores[k]) + ' |'); });
    L.push('', '| 메모 | 문제 종류 | 내용 |', '|---|---|---|');
    if (!result.issues.length) L.push('| - | - | 문제 없음 |');
    result.issues.forEach(function (i) { L.push('| ' + i.memo + ' | ' + i.kind + ' | ' + String(i.detail).replace(/\|/g, '\\|') + ' |'); });
    return L.join('\n');
  }

  return { grade: grade, toMarkdown: toMarkdown, fmt: fmt };
});

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  var fs = require('fs'), path = require('path');
  var here = __dirname, a = process.argv.slice(2);
  if (!a[0]) { console.error('사용: node grade.js <run.json> [memos.md] [answers.md] [gold.json]'); process.exit(2); }
  var G = module.exports;
  var res = G.grade({
    run: JSON.parse(fs.readFileSync(a[0], 'utf8')),
    memosMd: fs.readFileSync(a[1] || path.join(here, 'memos.md'), 'utf8'),
    answersMd: fs.readFileSync(a[2] || path.join(here, 'answers.md'), 'utf8'),
    gold: JSON.parse(fs.readFileSync(a[3] || path.join(here, 'gold.json'), 'utf8'))
  });
  console.log(G.toMarkdown(res));
}
