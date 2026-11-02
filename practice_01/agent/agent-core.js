/*
 * practice_01 리포트 에이전트 – 핵심 로직 (브라우저 + Node 공용)
 *
 * 흐름: 메모 읽기 → 1) 주장 뽑기 → 2) 근거 확인(판정) → 3) 강사 질문 만들기
 *       → 4) 강사 답변 받기(질문을 다 만든 뒤에만 answers를 연다) → 5) 리포트 쓰기
 *       → 6) 자가 점검(코드) → 실패 문장 고쳐 쓰기 1회 → 그래도 실패면 빼기
 *
 * 모드
 *  - mock: 외부 API를 부르지 않는다. 규칙 기반 대역이 각 단계를 처리한다. 비용 0원, 결과가 항상 같다.
 *  - llm : 문장을 다루는 단계(1·2·3·5·고쳐 쓰기)는 언어 모델이 하고,
 *          확인 단계(인용·숫자·시점·인과 점검, 답변이 근거가 되는지)는 항상 코드가 한다.
 *          모델 출력이 형식에 안 맞으면 그 항목만 규칙 기반으로 대신하고 기록을 남긴다.
 *
 * agent.py 는 이 파일과 같은 규칙을 파이썬으로 옮긴 것이다. 규칙을 바꾸면 둘 다 바꾸고
 * practice_01/eval/test_parity.js 로 두 결과가 같은지 확인한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReportAgent = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------ 단어 목록
  // 모두 "원문에 없으면 리포트에 넣으면 안 되는" 표현들이다.
  var TIMING = ['지난달', '이번 달', '이번달', '다음 달', '다음달', '지난주', '이번 주', '다음 주',
    '개월', '연속', '매일', '매주', '매번', '항상', '처음', '최근', '요즘', '앞으로', '작년', '올해',
    '학기', '방학'];
  var CAUSAL = ['때문', '덕분', '덕택', '그래서', '따라서', '그 결과', '결과로', '영향으로', '인해', '바람에', '탓'];
  var COMPARE = ['다른 애들', '다른 학생', '다른 친구', '다른 아이', '반 평균', '친구들'];
  var NEGATIVE = ['미제출', '결석', '하위반', '떨어', '부족', '느린', '느려', '못 '];

  // 평가 표현과 기준 분류 (practice_01/results/judgment.md 의 기준 1~3)
  var EVAL_WORDS = ['실력', '늘었', '늘어', '향상', '자신감', '집중', '태도', '성실', '산만', '속도',
    '느린', '느려', '빠른', '빨라', '열심', '좋아짐', '좋아졌', '좋습니다', '좋아요', '잘해', '잘하',
    '부족', '약한', '약해'];
  var CAT2_WORDS = ['집중', '태도', '성실', '산만', '열심', '떠드', '졸'];
  var CAT3_WORDS = ['속도', '느린', '느려', '빠른', '빨라', '오래 걸'];
  var PLAN_WORDS = ['다음 달', '다음달', '예정', '겠습니다', '할게요', '추가', '강화', '계획'];

  var CRITERIA = {
    '기준1': '실력 변화 표현 + 점수 등 숫자 지표 없음',
    '기준2': '집중·태도 평가 + 구체적 행동(횟수 등) 없음',
    '기준3': '속도 평가 + 시간·분량 수치 없음'
  };
  var EVIDENCE = {
    '기준1': /[0-9]+(?:\.[0-9]+)?\s*(?:점|%|퍼센트)/,
    '기준2': /[0-9]+\s*(?:회|번)|한 번도|없고|없음|없었|없습니다/,
    '기준3': /[0-9]+(?:\.[0-9]+)?\s*(?:분|초|시간|단어|개|문제|쪽|페이지)/
  };

  // 리포트 문장 끝맺음 바꾸기 (개조식 메모 → 존댓말). 숫자·시점은 절대 더하지 않는다.
  var ENDINGS = [
    ['미제출', '제출하지 않았습니다.'], ['제출', '제출했습니다.'], ['예정', '예정입니다.'],
    ['오름', '올랐습니다.'], ['내림', '내렸습니다.'], ['떨어짐', '떨어졌습니다.'], ['걸림', '걸렸습니다.'],
    ['동일', '같습니다.'], ['완료', '완료했습니다.'], ['배정', '배정되었습니다.'],
    ['추가', '추가할 예정입니다.'], ['강화', '강화할 예정입니다.']
  ];

  // ------------------------------------------------------------------ 작은 도구
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function includesAny(text, words) {
    for (var i = 0; i < words.length; i++) if (text.indexOf(words[i]) !== -1) return true;
    return false;
  }
  function foundWords(text, words) {
    var out = [];
    for (var i = 0; i < words.length; i++) if (text.indexOf(words[i]) !== -1) out.push(words[i]);
    return out;
  }
  function numbersIn(text) {
    var m = String(text).match(/[0-9]+(?:\.[0-9]+)?/g);
    return m ? m : [];
  }
  function uniq(arr) {
    var seen = {}, out = [];
    for (var i = 0; i < arr.length; i++) if (!seen[arr[i]]) { seen[arr[i]] = 1; out.push(arr[i]); }
    return out;
  }

  // ------------------------------------------------------------------ 입력 읽기
  // "3. [박지호 / 박강사] 요즘 영어 실력이..." 형식
  function parseMemos(md) {
    var out = [];
    var re = /^\s*([0-9]+)\.\s*\[\s*([^\/\]]+?)\s*\/\s*([^\]]+?)\s*\]\s*(.+?)\s*$/;
    String(md).split(/\r?\n/).forEach(function (line) {
      var m = line.match(re);
      if (m) out.push({ no: parseInt(m[1], 10), student: m[2], teacher: m[3], text: m[4] });
    });
    return out;
  }
  // "| 3 | 박강사 | 답변 |" 형식. 답변 칸이 비었거나 "(답변 없음)"이면 없는 것으로 본다.
  function parseAnswers(md) {
    var out = {};
    String(md).split(/\r?\n/).forEach(function (line) {
      var cells = line.split('|').map(function (s) { return s.trim(); });
      if (cells.length >= 5 && /^[0-9]+$/.test(cells[1])) {
        var text = cells[3];
        if (text && !/^\(?답변 ?없음\)?$/.test(text)) out[parseInt(cells[1], 10)] = { teacher: cells[2], text: text };
      }
    });
    return out;
  }

  // 메모를 주장 단위로 자른다: 문장 끝(. ! ? 뒤 공백), 쉼표+공백, → 에서 자른다. 괄호 안 쉼표는 자르지 않는다.
  function splitClauses(text) {
    var parts = [], buf = '', depth = 0, s = String(text);
    function push() { var t = buf.replace(/[.!?\s]+$/, '').trim(); if (t) parts.push(t); buf = ''; }
    for (var i = 0; i < s.length; i++) {
      var ch = s[i], next = s[i + 1];
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      if (ch === '→') { push(); continue; }
      if (depth === 0 && ch === ',' && (next === ' ' || next === undefined)) { push(); continue; }
      buf += ch;
      if (depth === 0 && (ch === '.' || ch === '!' || ch === '?') && (next === undefined || /\s/.test(next))) push();
    }
    push();
    return parts;
  }

  // ------------------------------------------------------------------ 규칙 기반 단계 (mock 대역 + llm 실패 시 대체)
  function classifyClause(clause) {
    if (includesAny(clause, EVAL_WORDS)) {
      var cat = includesAny(clause, CAT2_WORDS) ? '기준2' : includesAny(clause, CAT3_WORDS) ? '기준3' : '기준1';
      return { type: '평가', category: cat };
    }
    if (includesAny(clause, PLAN_WORDS)) return { type: '계획', category: null };
    return { type: '사실', category: null };
  }

  function ruleExtract(memo) {
    return splitClauses(memo.text).map(function (c, i) {
      var k = classifyClause(c);
      return { memo: memo.no, id: memo.no + '-' + (i + 1), text: c, type: k.type, category: k.category };
    });
  }

  function ruleJudge(memo, claims) {
    var lacking = [];
    claims.forEach(function (c) {
      if (c.type === '평가' && c.category && !EVIDENCE[c.category].test(memo.text)) lacking.push(c.category);
    });
    lacking = uniq(lacking).sort();
    if (!lacking.length) return { memo: memo.no, verdict: '정상', criteria: [], reason: '평가 표현이 없거나, 같은 메모에 그 평가를 받쳐 주는 숫자·행동 근거가 있음' };
    var evalClaims = claims.filter(function (c) { return c.type === '평가' && lacking.indexOf(c.category) !== -1; })
      .map(function (c) { return '"' + c.text + '"'; });
    return {
      memo: memo.no, verdict: '애매', criteria: lacking,
      reason: evalClaims.join(', ') + ' – ' + lacking.map(function (k) { return k + '(' + CRITERIA[k] + ')'; }).join(', ')
    };
  }

  function ruleQuestion(memo, criterion, claimText) {
    var n = memo.student;
    if (criterion === '기준1') return n + ' 학생의 실력이 늘었다고 보신 근거로, 비교할 수 있는 시험 점수(예: 지난달과 이번 달 점수)나 정답률을 알려주실 수 있을까요?';
    if (criterion === '기준2') return n + ' 학생에 대해 "' + claimText + '"라고 보신 구체적인 행동(예: 발표·질문 횟수, 지적 횟수, 숙제 제출 횟수)을 알려주실 수 있을까요?';
    return n + ' 학생의 속도를 그렇게 보신 근거로, 같은 분량을 하는 데 걸린 시간(분)이나 정해진 시간 안에 한 분량을 알려주실 수 있을까요?';
  }

  function toSentence(clause, from) {
    var c = norm(clause);
    if (/(요|다)$/.test(c)) return '담당 선생님께서 "' + c + '"라고 ' + (from === 'answer' ? '답해' : '전해') + ' 주셨습니다.';
    var base = c.replace(/이고$/, '');
    // 끝에 붙은 괄호 "(반 평균 약 4분)"는 떼어 두었다가 마침표 앞에 다시 붙인다
    var paren = '';
    var pm = base.match(/^(.*[^\s(])\s*(\([^()]*\))$/);
    if (pm) { base = pm[1]; paren = pm[2]; }
    for (var i = 0; i < ENDINGS.length; i++) {
      var e = ENDINGS[i][0];
      if (base.slice(-e.length) === e) {
        var done = base.slice(0, base.length - e.length) + ENDINGS[i][1];
        return paren ? done.slice(0, -1) + paren + '.' : done;
      }
    }
    if (/[0-9](점|회|분|초|개|명|%)$/.test(base)) return base + '입니다' + paren + '.';
    return '"' + c + '"라고 기록되어 있습니다.';
  }

  function flagsFor(text) {
    var f = [];
    if (includesAny(text, COMPARE)) f.push('다른 학생과 비교 – 원장 확인');
    if (includesAny(text, NEGATIVE)) f.push('부정적 내용 – 전달 방식 확인');
    return f;
  }

  function ruleReport(memo, claims, unresolved, answer) {
    var sentences = [], held = [];
    var src = '메모 ' + memo.no;
    claims.forEach(function (c) {
      if (c.type === '평가' && unresolved.indexOf(c.category) !== -1) {
        held.push({ claim: c.text, reason: answer ? '강사 답변에도 ' + c.category + ' 근거가 없음' : '강사 답변 없음' });
        return;
      }
      var text = c.type === '평가'
        ? '담당 선생님께서는 "' + c.text + '"라고 보고 계십니다.'
        : toSentence(c.text, 'memo');
      sentences.push({ text: text, cites: [{ src: src, quote: c.text }], flags: flagsFor(text) });
    });
    if (answer && answer.usable) {
      splitClauses(answer.text).forEach(function (a) {
        var t = toSentence(a, 'answer');
        sentences.push({ text: t, cites: [{ src: '답변 ' + memo.no, quote: a }], flags: flagsFor(t) });
      });
    }
    return { sentences: sentences, held: held };
  }

  // 자가 점검 시연용: 일부러 지어낸 문장 (항상 같은 위치·같은 내용)
  function injectedFaults(memo, claims, idx) {
    var n = memo.student, q = claims.length ? claims[0].text : memo.text;
    var kind = idx % 3;
    if (kind === 0) return { text: n + ' 학생은 꾸준한 노력 덕분에 성적이 크게 올랐습니다.', cites: [{ src: '메모 ' + memo.no, quote: q }], flags: [], injected: true };
    if (kind === 1) return { text: n + ' 학생은 지난 3개월 동안 단어시험 점수가 10점 올랐습니다.', cites: [{ src: '메모 ' + memo.no, quote: q }], flags: [], injected: true };
    return { text: n + ' 학생은 숙제를 항상 성실하게 해 왔습니다.', cites: [{ src: '메모 ' + memo.no, quote: '숙제를 항상 성실하게' }], flags: [], injected: true };
  }

  // ------------------------------------------------------------------ 자가 점검 (모드와 상관없이 항상 코드)
  function checkSentence(s, sources) {
    var problems = [];
    var cites = s.cites || [];
    if (!cites.length) problems.push('근거 없음');
    var cited = [];
    cites.forEach(function (c) {
      if (!Object.prototype.hasOwnProperty.call(sources, c.src)) { problems.push('없는 출처: ' + c.src); return; }
      if (norm(sources[c.src]).indexOf(norm(c.quote)) === -1 || !norm(c.quote)) problems.push('인용이 원문과 다름: ' + c.src);
      cited.push(sources[c.src]);
    });
    var citedText = cited.join(' ');
    var srcNums = numbersIn(citedText);
    numbersIn(s.text).forEach(function (x) { if (srcNums.indexOf(x) === -1) problems.push('원문에 없는 숫자: ' + x); });
    foundWords(s.text, TIMING).forEach(function (w) { if (citedText.indexOf(w) === -1) problems.push('원문에 없는 시점: ' + w); });
    foundWords(s.text, CAUSAL).forEach(function (w) { if (citedText.indexOf(w) === -1) problems.push('원문에 없는 인과: ' + w); });
    return uniq(problems);
  }

  function sourcesFor(memo, answer) {
    var s = {};
    s['메모 ' + memo.no] = memo.text;
    if (answer) s['답변 ' + memo.no] = answer.text;
    return s;
  }

  // ------------------------------------------------------------------ 언어 모델 단계 (llm 모드)
  function parseJSON(text) {
    var t = String(text || '').replace(/```(?:json)?/g, '');
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a === -1 || b <= a) throw new Error('JSON 없음');
    return JSON.parse(t.slice(a, b + 1));
  }

  var SYSTEM = '너는 영어학원 원장을 돕는 도우미다. 입력에 없는 사실, 숫자, 시점(지난달·이번 달 등), 원인·결과(덕분에·때문에 등)를 절대 만들지 않는다. 반드시 JSON 하나만 출력한다.';

  function memoList(memos) {
    return memos.map(function (m) { return m.no + '. [' + m.student + ' / ' + m.teacher + '] ' + m.text; }).join('\n');
  }

  var PROMPTS = {
    extract: function (memos) {
      return '아래 강사 메모를 "주장" 단위로 나눠라.\n' +
        '- text 는 메모에서 글자 그대로 복사한 부분 문자열이어야 한다(바꿔 쓰기 금지).\n' +
        '- type: "사실"(점수·횟수 등 기록), "평가"(실력·집중·태도·속도에 대한 판단), "계획"(앞으로 할 일)\n' +
        '- 평가이면 category: "기준1"(실력 변화), "기준2"(집중·태도), "기준3"(속도). 아니면 null\n' +
        '출력 형식: {"memos":[{"no":1,"claims":[{"text":"...","type":"사실","category":null}]}]}\n\n' + memoList(memos);
    },
    judge: function (memos, claimsByMemo) {
      var body = memos.map(function (m) {
        return m.no + '. [' + m.student + '] ' + m.text + '\n   평가 주장: ' +
          JSON.stringify((claimsByMemo[m.no] || []).filter(function (c) { return c.type === '평가'; }).map(function (c) { return [c.text, c.category]; }));
      }).join('\n');
      return '각 메모를 "정상" 또는 "애매"로 판정하라.\n' +
        '애매 = 평가 주장이 있는데 같은 메모 안에 그 평가를 받쳐 주는 근거가 없음.\n' +
        '- 기준1: 실력 변화 표현인데 점수·% 같은 숫자 지표가 없음\n' +
        '- 기준2: 집중·태도 평가인데 구체적 행동(횟수 등)이 없음 (점수는 행동 근거가 아님)\n' +
        '- 기준3: 속도 평가인데 시간·분량 수치가 없음 (점수는 속도 근거가 아님)\n' +
        '출력 형식: {"judgments":[{"no":3,"verdict":"애매","criteria":["기준1"],"reason":"한 문장"}]}\n\n' + body;
    },
    questions: function (items) {
      return '애매한 메모마다 담당 강사에게 보낼 질문을 하나씩 써라. 공손하게, 한 문장, 학생 이름을 넣고, 어떤 숫자·행동 근거가 필요한지(점수, 횟수, 시간 등) 구체적으로 묻는다.\n' +
        '출력 형식: {"questions":[{"no":3,"criterion":"기준1","question":"..."}]}\n\n' +
        items.map(function (it) { return it.memo.no + '. [' + it.memo.student + ' / ' + it.memo.teacher + '] ' + it.memo.text + ' / 부족한 기준: ' + it.criterion + '(' + CRITERIA[it.criterion] + ')'; }).join('\n');
    },
    report: function (items) {
      return '학부모에게 보낼 월간 리포트 문장을 써라. 학생마다 2~6문장, 존댓말.\n' +
        '규칙:\n- 문장마다 cites 를 단다. quote 는 출처 원문에서 글자 그대로 복사한 부분이다.\n' +
        '- quote 에 없는 숫자, 시점(지난달·이번 달·요즘 등), 원인·결과(덕분에·때문에)를 문장에 넣지 않는다.\n' +
        '- "말하지 말 것"에 있는 내용은 쓰지 않는다.\n- 인사말은 쓰지 않는다(코드가 붙인다).\n' +
        '출력 형식: {"reports":[{"no":1,"sentences":[{"text":"...","cites":[{"src":"메모 1","quote":"..."}]}]}]}\n\n' +
        items.map(function (it) {
          var lines = ['### ' + it.memo.no + '. ' + it.memo.student, '메모 ' + it.memo.no + ': ' + it.memo.text];
          if (it.answer && it.answer.usable) lines.push('답변 ' + it.memo.no + ': ' + it.answer.text);
          if (it.held.length) lines.push('말하지 말 것: ' + it.held.map(function (h) { return h.claim; }).join(' / '));
          return lines.join('\n');
        }).join('\n\n');
    },
    rewrite: function (items) {
      return '아래 문장들은 자가 점검에서 걸렸다. 문제를 고쳐 다시 써라. 고칠 수 없으면 text 를 빈 문자열로 둔다.\n' +
        'quote 는 출처 원문에서 글자 그대로 복사한다. 원문에 없는 숫자·시점·인과는 빼라.\n' +
        '출력 형식: {"fixed":[{"id":"3-2","text":"...","cites":[{"src":"메모 3","quote":"..."}]}]}\n\n' +
        items.map(function (it) {
          return 'id ' + it.id + ' / 문장: ' + it.sentence.text + ' / 문제: ' + it.problems.join(', ') +
            '\n  출처: ' + Object.keys(it.sources).map(function (k) { return k + ' = ' + it.sources[k]; }).join(' | ');
        }).join('\n');
    }
  };

  // ------------------------------------------------------------------ 실행
  /**
   * opts = {
   *   memosMd: string,
   *   loadAnswers: () => Promise<string>|string   // 질문을 다 만든 뒤에만 호출된다
   *   mode: 'mock' | 'llm',
   *   llm: async (messages) => string             // llm 모드에서만 필요
   *   injectFaults: boolean                        // 자가 점검 시연용 지어낸 문장 섞기
   *   onStep: (name, info) => void                 // 진행 상황 표시용
   *   chunk: number                                // 리포트 한 번 호출에 넣을 학생 수 (기본 5)
   * }
   */
  async function run(opts) {
    var mode = opts.mode === 'llm' ? 'llm' : 'mock';
    var onStep = opts.onStep || function () {};
    var stats = { calls: 0, fallbacks: [] };
    var memos = parseMemos(opts.memosMd);
    if (!memos.length) throw new Error('메모를 읽지 못했습니다. "1. [이름 / 강사] 내용" 형식인지 확인하세요.');

    async function ask(prompt) {
      stats.calls++;
      var text = await opts.llm([{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }]);
      return parseJSON(text);
    }

    // 1) 주장 뽑기
    onStep('extract', { total: memos.length });
    var claimsByMemo = {};
    memos.forEach(function (m) { claimsByMemo[m.no] = ruleExtract(m); });
    if (mode === 'llm') {
      var got = null;
      try { got = await ask(PROMPTS.extract(memos)); } catch (e) { stats.fallbacks.push('extract: ' + e.message); }
      if (got && Array.isArray(got.memos)) {
        got.memos.forEach(function (gm) {
          var memo = memos.filter(function (m) { return m.no === gm.no; })[0];
          if (!memo || !Array.isArray(gm.claims)) return;
          var ok = gm.claims.filter(function (c) {
            return c && c.text && norm(memo.text).indexOf(norm(c.text)) !== -1 && ['사실', '평가', '계획'].indexOf(c.type) !== -1 &&
              (c.type !== '평가' || CRITERIA[c.category]);
          });
          if (ok.length) claimsByMemo[memo.no] = ok.map(function (c, i) {
            return { memo: memo.no, id: memo.no + '-' + (i + 1), text: norm(c.text), type: c.type, category: c.type === '평가' ? c.category : null };
          });
          else stats.fallbacks.push('extract: 메모 ' + memo.no + ' 원문과 맞는 주장이 없어 규칙으로 대신함');
        });
      }
    }
    var claims = [];
    memos.forEach(function (m) { claims = claims.concat(claimsByMemo[m.no]); });

    // 2) 근거 확인 → 판정
    onStep('judge', {});
    var judgments = memos.map(function (m) { return ruleJudge(m, claimsByMemo[m.no]); });
    var disagreements = [];
    if (mode === 'llm') {
      var gj = null;
      try { gj = await ask(PROMPTS.judge(memos, claimsByMemo)); } catch (e) { stats.fallbacks.push('judge: ' + e.message); }
      if (gj && Array.isArray(gj.judgments)) {
        judgments = judgments.map(function (rj) {
          var lj = gj.judgments.filter(function (x) { return x && x.no === rj.memo; })[0];
          if (!lj || ['정상', '애매'].indexOf(lj.verdict) === -1) { stats.fallbacks.push('judge: 메모 ' + rj.memo + ' 규칙으로 대신함'); return rj; }
          var crit = (Array.isArray(lj.criteria) ? lj.criteria : []).filter(function (k) { return CRITERIA[k]; });
          crit = lj.verdict === '애매' ? uniq(crit).sort() : [];
          if (lj.verdict === '애매' && !crit.length) crit = rj.criteria.length ? rj.criteria : ['기준1'];
          if (lj.verdict !== rj.verdict) disagreements.push({ memo: rj.memo, llm: lj.verdict, rule: rj.verdict });
          return { memo: rj.memo, verdict: lj.verdict, criteria: crit, reason: norm(lj.reason || '') || rj.reason };
        });
      }
    }

    // 3) 강사 질문
    onStep('questions', {});
    var qItems = [];
    judgments.forEach(function (j) {
      if (j.verdict !== '애매') return;
      var memo = memos.filter(function (m) { return m.no === j.memo; })[0];
      j.criteria.forEach(function (k) {
        var c = claimsByMemo[memo.no].filter(function (x) { return x.type === '평가' && x.category === k; })[0];
        qItems.push({ memo: memo, criterion: k, claim: c ? c.text : '' });
      });
    });
    var questions = qItems.map(function (it) {
      return { memo: it.memo.no, teacher: it.memo.teacher, student: it.memo.student, criterion: it.criterion, question: ruleQuestion(it.memo, it.criterion, it.claim) };
    });
    if (mode === 'llm' && qItems.length) {
      var gq = null;
      try { gq = await ask(PROMPTS.questions(qItems)); } catch (e) { stats.fallbacks.push('questions: ' + e.message); }
      if (gq && Array.isArray(gq.questions)) {
        questions = questions.map(function (q) {
          var lq = gq.questions.filter(function (x) { return x && x.no === q.memo && (!x.criterion || x.criterion === q.criterion); })[0];
          if (lq && lq.question && norm(lq.question).indexOf(q.student) !== -1) return Object.assign({}, q, { question: norm(lq.question) });
          stats.fallbacks.push('questions: 메모 ' + q.memo + ' 규칙 질문으로 대신함');
          return q;
        });
      }
    }

    // 4) 강사 답변 – 질문을 다 만든 뒤에야 답변 파일을 연다 (CLAUDE.md 3번 규칙과 같은 순서)
    onStep('answers', {});
    var answersMd = typeof opts.loadAnswers === 'function' ? await opts.loadAnswers() : (opts.answersMd || '');
    var answerMap = parseAnswers(answersMd || '');
    var answers = [];
    var unresolvedBy = {};
    judgments.forEach(function (j) {
      unresolvedBy[j.memo] = [];
      if (j.verdict !== '애매') return;
      var a = answerMap[j.memo] || null;
      var still = j.criteria.filter(function (k) { return !(a && EVIDENCE[k].test(a.text)); });
      unresolvedBy[j.memo] = still;
      answers.push({ memo: j.memo, text: a ? a.text : null, usable: !!a && still.length < j.criteria.length, unresolved: still });
    });
    function answerFor(no) { return answers.filter(function (a) { return a.memo === no && a.text; })[0] || null; }

    // 5) 리포트 쓰기
    onStep('reports', {});
    var reports = memos.map(function (m, idx) {
      var r = ruleReport(m, claimsByMemo[m.no], unresolvedBy[m.no], answerFor(m.no));
      return { memo: m.no, student: m.student, greeting: '안녕하세요. ' + m.student + ' 학생의 학습 상황을 안내드립니다.', sentences: r.sentences, held: r.held, dropped: [] };
    });
    if (mode === 'llm') {
      var size = opts.chunk || 5;
      for (var start = 0; start < memos.length; start += size) {
        var part = memos.slice(start, start + size).map(function (m) {
          var rep = reports.filter(function (r) { return r.memo === m.no; })[0];
          return { memo: m, answer: answerFor(m.no), held: rep.held };
        });
        var gr = null;
        try { gr = await ask(PROMPTS.report(part)); } catch (e) { stats.fallbacks.push('reports: ' + e.message); }
        part.forEach(function (it) {
          var rep = reports.filter(function (r) { return r.memo === it.memo.no; })[0];
          var lr = gr && Array.isArray(gr.reports) ? gr.reports.filter(function (x) { return x && x.no === it.memo.no; })[0] : null;
          var ss = lr && Array.isArray(lr.sentences) ? lr.sentences.filter(function (s) { return s && s.text; }) : [];
          if (!ss.length) { stats.fallbacks.push('reports: 메모 ' + it.memo.no + ' 규칙 문장으로 대신함'); return; }
          rep.sentences = ss.map(function (s) {
            var cites = (Array.isArray(s.cites) ? s.cites : []).map(function (c) { return { src: norm(c && c.src), quote: norm(c && c.quote) }; });
            return { text: norm(s.text), cites: cites, flags: flagsFor(s.text) };
          });
        });
      }
    }
    var injectedCount = 0;
    if (opts.injectFaults) {
      reports.forEach(function (r, idx) {
        if (idx % 3 !== 0) return;
        var m = memos[idx];
        r.sentences.push(injectedFaults(m, claimsByMemo[m.no], idx / 3));
        injectedCount++;
      });
    }

    // 6) 자가 점검 → 고쳐 쓰기 1회 → 그래도 실패면 빼기
    onStep('selfcheck', {});
    var failing = [];
    var total = 0, firstPass = 0;
    reports.forEach(function (r) {
      var m = memos.filter(function (x) { return x.no === r.memo; })[0];
      var sources = sourcesFor(m, answerFor(m.no));
      r.sentences.forEach(function (s, i) {
        total++;
        var p = checkSentence(s, sources);
        if (p.length) failing.push({ id: r.memo + '-' + (i + 1), report: r, sentence: s, problems: p, sources: sources });
        else firstPass++;
      });
    });
    var fixedMap = {};
    if (mode === 'llm' && failing.length) {
      var gf = null;
      try { gf = await ask(PROMPTS.rewrite(failing)); } catch (e) { stats.fallbacks.push('rewrite: ' + e.message); }
      if (gf && Array.isArray(gf.fixed)) gf.fixed.forEach(function (f) { if (f && f.id) fixedMap[f.id] = f; });
    }
    var rewritten = 0, dropped = 0, injectedCaught = 0;
    failing.forEach(function (f) {
      var fx = fixedMap[f.id];
      var idx = f.report.sentences.indexOf(f.sentence);
      if (fx && fx.text) {
        var cand = { text: norm(fx.text), cites: (Array.isArray(fx.cites) ? fx.cites : []).map(function (c) { return { src: norm(c && c.src), quote: norm(c && c.quote) }; }) };
        cand.flags = flagsFor(cand.text);
        if (!checkSentence(cand, f.sources).length) { f.report.sentences[idx] = cand; rewritten++; return; }
      }
      f.report.dropped.push({ text: f.sentence.text, problems: f.problems, injected: !!f.sentence.injected });
      f.report.sentences[idx] = null;
      dropped++;
      if (f.sentence.injected) injectedCaught++;
    });
    reports.forEach(function (r) {
      r.sentences = r.sentences.filter(Boolean).map(function (s) { return { text: s.text, cites: s.cites, flags: s.flags || [] }; });
    });

    return {
      version: 1,
      mode: mode,
      memos: memos,
      claims: claims,
      judgments: judgments,
      questions: questions,
      answers: answers,
      reports: reports,
      selfcheck: {
        sentences: total, passed_first: firstPass, rewritten: rewritten, dropped: dropped,
        injected: injectedCount, injected_caught: injectedCaught,
        held: reports.reduce(function (n, r) { return n + r.held.length; }, 0)
      },
      llm: { calls: stats.calls, fallbacks: stats.fallbacks, disagreements: disagreements }
    };
  }

  // ------------------------------------------------------------------ 결과를 마크다운 표로
  function esc(s) { return String(s).replace(/\|/g, '\\|'); }
  function toMarkdown(r) {
    var L = [];
    L.push('# 리포트 에이전트 실행 결과 (' + r.mode + ' 모드)', '');
    L.push('| 항목 | 값 |', '|---|---|');
    L.push('| 메모 수 | ' + r.memos.length + ' |');
    L.push('| 애매 판정 | ' + r.judgments.filter(function (j) { return j.verdict === '애매'; }).length + ' |');
    L.push('| 리포트 문장 | ' + r.reports.reduce(function (n, x) { return n + x.sentences.length; }, 0) + ' |');
    L.push('| 자가 점검 1차 통과 / 전체 | ' + r.selfcheck.passed_first + ' / ' + r.selfcheck.sentences + ' |');
    L.push('| 고쳐 쓴 문장 / 뺀 문장 | ' + r.selfcheck.rewritten + ' / ' + r.selfcheck.dropped + ' |');
    L.push('| 보류한 주장(근거 없음) | ' + r.selfcheck.held + ' |');
    if (r.selfcheck.injected) L.push('| 일부러 넣은 오류 / 잡은 수 | ' + r.selfcheck.injected + ' / ' + r.selfcheck.injected_caught + ' |');
    L.push('| 모델 호출 수 | ' + r.llm.calls + ' |', '');
    L.push('## 1. 판정', '', '| 메모 | 학생 | 판정 | 기준 | 이유 |', '|---|---|---|---|---|');
    r.judgments.forEach(function (j) {
      var m = r.memos.filter(function (x) { return x.no === j.memo; })[0];
      L.push('| ' + j.memo + ' | ' + m.student + ' | ' + j.verdict + ' | ' + (j.criteria.join(', ') || '-') + ' | ' + esc(j.reason) + ' |');
    });
    L.push('', '## 2. 강사 질문', '', '| 메모 | 강사 | 기준 | 질문 |', '|---|---|---|---|');
    r.questions.forEach(function (q) { L.push('| ' + q.memo + ' | ' + q.teacher + ' | ' + q.criterion + ' | ' + esc(q.question) + ' |'); });
    L.push('', '## 3. 강사 답변 반영', '', '| 메모 | 답변 | 근거로 쓸 수 있음 | 남은 기준 |', '|---|---|---|---|');
    r.answers.forEach(function (a) { L.push('| ' + a.memo + ' | ' + esc(a.text || '(답변 없음)') + ' | ' + (a.usable ? '예' : '아니오') + ' | ' + (a.unresolved.join(', ') || '-') + ' |'); });
    L.push('', '## 4. 학부모 리포트', '');
    r.reports.forEach(function (rep) {
      L.push('### ' + rep.memo + '. ' + rep.student, '', rep.greeting, '', '| # | 문장 | 근거 | 확인 표시 |', '|---|---|---|---|');
      rep.sentences.forEach(function (s, i) {
        L.push('| ' + (i + 1) + ' | ' + esc(s.text) + ' | ' + esc(s.cites.map(function (c) { return c.src + ': "' + c.quote + '"'; }).join(' / ')) + ' | ' + (s.flags.join(', ') || '-') + ' |');
      });
      if (rep.held.length) L.push('', '보류(리포트에 넣지 않음): ' + rep.held.map(function (h) { return '"' + h.claim + '" – ' + h.reason; }).join('; '));
      if (rep.dropped.length) L.push('', '자가 점검에서 뺀 문장: ' + rep.dropped.map(function (d) { return '"' + d.text + '" – ' + d.problems.join(', '); }).join('; '));
      L.push('');
    });
    return L.join('\n');
  }

  return {
    run: run, toMarkdown: toMarkdown, parseMemos: parseMemos, parseAnswers: parseAnswers, splitClauses: splitClauses,
    checkSentence: checkSentence, classifyClause: classifyClause, CRITERIA: CRITERIA,
    TIMING: TIMING, CAUSAL: CAUSAL, COMPARE: COMPARE
  };
});
