"""practice_01 리포트 에이전트 (파이썬 판, Google Colab 용)

agent-core.js 와 같은 규칙을 파이썬으로 옮긴 것이다. 설치할 패키지는 없다(표준 라이브러리만).

흐름: 메모 → 1) 주장 뽑기 → 2) 근거 확인(판정) → 3) 강사 질문 → 4) 강사 답변(질문을 다 만든 뒤에만 연다)
      → 5) 리포트 쓰기 → 6) 자가 점검(코드) → 고쳐 쓰기 1회 → 그래도 실패면 빼기

사용 예
    python agent.py --mode mock                       # 비용 0원, 항상 같은 결과
    python agent.py --mode mock --inject-faults       # 자가 점검 시연(일부러 지어낸 문장 섞기)
    OPENROUTER_API_KEY=... python agent.py --mode llm # 실제 모델 (키는 파일에 저장하지 않는다)
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

TIMING = ['지난달', '이번 달', '이번달', '다음 달', '다음달', '지난주', '이번 주', '다음 주',
          '개월', '연속', '매일', '매주', '매번', '항상', '처음', '최근', '요즘', '앞으로', '작년', '올해',
          '학기', '방학']
CAUSAL = ['때문', '덕분', '덕택', '그래서', '따라서', '그 결과', '결과로', '영향으로', '인해', '바람에', '탓']
COMPARE = ['다른 애들', '다른 학생', '다른 친구', '다른 아이', '반 평균', '친구들']
NEGATIVE = ['미제출', '결석', '하위반', '떨어', '부족', '느린', '느려', '못 ']

EVAL_WORDS = ['실력', '늘었', '늘어', '향상', '자신감', '집중', '태도', '성실', '산만', '속도',
              '느린', '느려', '빠른', '빨라', '열심', '좋아짐', '좋아졌', '좋습니다', '좋아요', '잘해', '잘하',
              '부족', '약한', '약해']
CAT2_WORDS = ['집중', '태도', '성실', '산만', '열심', '떠드', '졸']
CAT3_WORDS = ['속도', '느린', '느려', '빠른', '빨라', '오래 걸']
PLAN_WORDS = ['다음 달', '다음달', '예정', '겠습니다', '할게요', '추가', '강화', '계획']

CRITERIA = {
    '기준1': '실력 변화 표현 + 점수 등 숫자 지표 없음',
    '기준2': '집중·태도 평가 + 구체적 행동(횟수 등) 없음',
    '기준3': '속도 평가 + 시간·분량 수치 없음',
}
EVIDENCE = {
    '기준1': re.compile(r'[0-9]+(?:\.[0-9]+)?\s*(?:점|%|퍼센트)'),
    '기준2': re.compile(r'[0-9]+\s*(?:회|번)|한 번도|없고|없음|없었|없습니다'),
    '기준3': re.compile(r'[0-9]+(?:\.[0-9]+)?\s*(?:분|초|시간|단어|개|문제|쪽|페이지)'),
}
ENDINGS = [
    ('미제출', '제출하지 않았습니다.'), ('제출', '제출했습니다.'), ('예정', '예정입니다.'),
    ('오름', '올랐습니다.'), ('내림', '내렸습니다.'), ('떨어짐', '떨어졌습니다.'), ('걸림', '걸렸습니다.'),
    ('동일', '같습니다.'), ('완료', '완료했습니다.'), ('배정', '배정되었습니다.'),
    ('추가', '추가할 예정입니다.'), ('강화', '강화할 예정입니다.'),
]


# ------------------------------------------------------------------ 작은 도구
def norm(s):
    return re.sub(r'\s+', ' ', '' if s is None else str(s)).strip()


def includes_any(text, words):
    return any(w in text for w in words)


def found_words(text, words):
    return [w for w in words if w in text]


def numbers_in(text):
    return re.findall(r'[0-9]+(?:\.[0-9]+)?', str(text))


def uniq(arr):
    seen, out = set(), []
    for x in arr:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


# ------------------------------------------------------------------ 입력 읽기
MEMO_RE = re.compile(r'^\s*([0-9]+)\.\s*\[\s*([^/\]]+?)\s*/\s*([^\]]+?)\s*\]\s*(.+?)\s*$')


def parse_memos(md):
    out = []
    for line in str(md).splitlines():
        m = MEMO_RE.match(line)
        if m:
            out.append({'no': int(m.group(1)), 'student': m.group(2), 'teacher': m.group(3), 'text': m.group(4)})
    return out


def parse_answers(md):
    out = {}
    for line in str(md).splitlines():
        cells = [c.strip() for c in line.split('|')]
        if len(cells) >= 5 and re.fullmatch(r'[0-9]+', cells[1]):
            text = cells[3]
            if text and not re.fullmatch(r'\(?답변 ?없음\)?', text):
                out[int(cells[1])] = {'teacher': cells[2], 'text': text}
    return out


def split_clauses(text):
    parts, buf, depth = [], [''], [0]
    s = str(text)

    def push():
        t = re.sub(r'[.!?\s]+$', '', buf[0]).strip()
        if t:
            parts.append(t)
        buf[0] = ''

    for i, ch in enumerate(s):
        nxt = s[i + 1] if i + 1 < len(s) else None
        if ch in '([':
            depth[0] += 1
        if ch in ')]':
            depth[0] = max(0, depth[0] - 1)
        if ch == '→':
            push()
            continue
        if depth[0] == 0 and ch == ',' and (nxt == ' ' or nxt is None):
            push()
            continue
        buf[0] += ch
        if depth[0] == 0 and ch in '.!?' and (nxt is None or nxt.isspace()):
            push()
    push()
    return parts


# ------------------------------------------------------------------ 규칙 기반 단계
def classify_clause(clause):
    if includes_any(clause, EVAL_WORDS):
        if includes_any(clause, CAT2_WORDS):
            cat = '기준2'
        elif includes_any(clause, CAT3_WORDS):
            cat = '기준3'
        else:
            cat = '기준1'
        return {'type': '평가', 'category': cat}
    if includes_any(clause, PLAN_WORDS):
        return {'type': '계획', 'category': None}
    return {'type': '사실', 'category': None}


def rule_extract(memo):
    out = []
    for i, c in enumerate(split_clauses(memo['text'])):
        k = classify_clause(c)
        out.append({'memo': memo['no'], 'id': f"{memo['no']}-{i + 1}", 'text': c, 'type': k['type'], 'category': k['category']})
    return out


def rule_judge(memo, claims):
    lacking = sorted(uniq([c['category'] for c in claims
                           if c['type'] == '평가' and c['category'] and not EVIDENCE[c['category']].search(memo['text'])]))
    if not lacking:
        return {'memo': memo['no'], 'verdict': '정상', 'criteria': [],
                'reason': '평가 표현이 없거나, 같은 메모에 그 평가를 받쳐 주는 숫자·행동 근거가 있음'}
    ev = ['"' + c['text'] + '"' for c in claims if c['type'] == '평가' and c['category'] in lacking]
    return {'memo': memo['no'], 'verdict': '애매', 'criteria': lacking,
            'reason': ', '.join(ev) + ' – ' + ', '.join(f'{k}({CRITERIA[k]})' for k in lacking)}


def rule_question(memo, criterion, claim_text):
    n = memo['student']
    if criterion == '기준1':
        return n + ' 학생의 실력이 늘었다고 보신 근거로, 비교할 수 있는 시험 점수(예: 지난달과 이번 달 점수)나 정답률을 알려주실 수 있을까요?'
    if criterion == '기준2':
        return n + ' 학생에 대해 "' + claim_text + '"라고 보신 구체적인 행동(예: 발표·질문 횟수, 지적 횟수, 숙제 제출 횟수)을 알려주실 수 있을까요?'
    return n + ' 학생의 속도를 그렇게 보신 근거로, 같은 분량을 하는 데 걸린 시간(분)이나 정해진 시간 안에 한 분량을 알려주실 수 있을까요?'


def to_sentence(clause, frm):
    c = norm(clause)
    if re.search(r'(요|다)$', c):
        return '담당 선생님께서 "' + c + '"라고 ' + ('답해' if frm == 'answer' else '전해') + ' 주셨습니다.'
    base = re.sub(r'이고$', '', c)
    paren = ''
    pm = re.match(r'^(.*[^\s(])\s*(\([^()]*\))$', base)
    if pm:
        base, paren = pm.group(1), pm.group(2)
    for e, rep in ENDINGS:
        if base.endswith(e):
            done = base[:len(base) - len(e)] + rep
            return done[:-1] + paren + '.' if paren else done
    if re.search(r'[0-9](점|회|분|초|개|명|%)$', base):
        return base + '입니다' + paren + '.'
    return '"' + c + '"라고 기록되어 있습니다.'


def flags_for(text):
    f = []
    if includes_any(text, COMPARE):
        f.append('다른 학생과 비교 – 원장 확인')
    if includes_any(text, NEGATIVE):
        f.append('부정적 내용 – 전달 방식 확인')
    return f


def rule_report(memo, claims, unresolved, answer):
    sentences, held = [], []
    src = f"메모 {memo['no']}"
    for c in claims:
        if c['type'] == '평가' and c['category'] in unresolved:
            held.append({'claim': c['text'], 'reason': ('강사 답변에도 ' + c['category'] + ' 근거가 없음') if answer else '강사 답변 없음'})
            continue
        text = ('담당 선생님께서는 "' + c['text'] + '"라고 보고 계십니다.') if c['type'] == '평가' else to_sentence(c['text'], 'memo')
        sentences.append({'text': text, 'cites': [{'src': src, 'quote': c['text']}], 'flags': flags_for(text)})
    if answer and answer.get('usable'):
        for a in split_clauses(answer['text']):
            t = to_sentence(a, 'answer')
            sentences.append({'text': t, 'cites': [{'src': f"답변 {memo['no']}", 'quote': a}], 'flags': flags_for(t)})
    return sentences, held


def injected_fault(memo, claims, idx):
    n = memo['student']
    q = claims[0]['text'] if claims else memo['text']
    kind = idx % 3
    src = f"메모 {memo['no']}"
    if kind == 0:
        return {'text': n + ' 학생은 꾸준한 노력 덕분에 성적이 크게 올랐습니다.', 'cites': [{'src': src, 'quote': q}], 'flags': [], 'injected': True}
    if kind == 1:
        return {'text': n + ' 학생은 지난 3개월 동안 단어시험 점수가 10점 올랐습니다.', 'cites': [{'src': src, 'quote': q}], 'flags': [], 'injected': True}
    return {'text': n + ' 학생은 숙제를 항상 성실하게 해 왔습니다.', 'cites': [{'src': src, 'quote': '숙제를 항상 성실하게'}], 'flags': [], 'injected': True}


# ------------------------------------------------------------------ 자가 점검 (항상 코드)
def check_sentence(s, sources):
    problems = []
    cites = s.get('cites') or []
    if not cites:
        problems.append('근거 없음')
    cited = []
    for c in cites:
        if c.get('src') not in sources:
            problems.append('없는 출처: ' + str(c.get('src')))
            continue
        if norm(c.get('quote')) not in norm(sources[c['src']]) or not norm(c.get('quote')):
            problems.append('인용이 원문과 다름: ' + c['src'])
        cited.append(sources[c['src']])
    cited_text = ' '.join(cited)
    src_nums = numbers_in(cited_text)
    for x in numbers_in(s['text']):
        if x not in src_nums:
            problems.append('원문에 없는 숫자: ' + x)
    for w in found_words(s['text'], TIMING):
        if w not in cited_text:
            problems.append('원문에 없는 시점: ' + w)
    for w in found_words(s['text'], CAUSAL):
        if w not in cited_text:
            problems.append('원문에 없는 인과: ' + w)
    return uniq(problems)


def sources_for(memo, answer):
    s = {f"메모 {memo['no']}": memo['text']}
    if answer:
        s[f"답변 {memo['no']}"] = answer['text']
    return s


# ------------------------------------------------------------------ 언어 모델 단계
def parse_json(text):
    t = re.sub(r'```(?:json)?', '', str(text or ''))
    a, b = t.find('{'), t.rfind('}')
    if a == -1 or b <= a:
        raise ValueError('JSON 없음')
    return json.loads(t[a:b + 1])


SYSTEM = '너는 영어학원 원장을 돕는 도우미다. 입력에 없는 사실, 숫자, 시점(지난달·이번 달 등), 원인·결과(덕분에·때문에 등)를 절대 만들지 않는다. 반드시 JSON 하나만 출력한다.'


def memo_list(memos):
    return '\n'.join(f"{m['no']}. [{m['student']} / {m['teacher']}] {m['text']}" for m in memos)


def p_extract(memos):
    return ('아래 강사 메모를 "주장" 단위로 나눠라.\n'
            '- text 는 메모에서 글자 그대로 복사한 부분 문자열이어야 한다(바꿔 쓰기 금지).\n'
            '- type: "사실"(점수·횟수 등 기록), "평가"(실력·집중·태도·속도에 대한 판단), "계획"(앞으로 할 일)\n'
            '- 평가이면 category: "기준1"(실력 변화), "기준2"(집중·태도), "기준3"(속도). 아니면 null\n'
            '출력 형식: {"memos":[{"no":1,"claims":[{"text":"...","type":"사실","category":null}]}]}\n\n' + memo_list(memos))


def p_judge(memos, claims_by):
    body = '\n'.join(
        f"{m['no']}. [{m['student']}] {m['text']}\n   평가 주장: " +
        json.dumps([[c['text'], c['category']] for c in claims_by.get(m['no'], []) if c['type'] == '평가'], ensure_ascii=False)
        for m in memos)
    return ('각 메모를 "정상" 또는 "애매"로 판정하라.\n'
            '애매 = 평가 주장이 있는데 같은 메모 안에 그 평가를 받쳐 주는 근거가 없음.\n'
            '- 기준1: 실력 변화 표현인데 점수·% 같은 숫자 지표가 없음\n'
            '- 기준2: 집중·태도 평가인데 구체적 행동(횟수 등)이 없음 (점수는 행동 근거가 아님)\n'
            '- 기준3: 속도 평가인데 시간·분량 수치가 없음 (점수는 속도 근거가 아님)\n'
            '출력 형식: {"judgments":[{"no":3,"verdict":"애매","criteria":["기준1"],"reason":"한 문장"}]}\n\n' + body)


def p_questions(items):
    return ('애매한 메모마다 담당 강사에게 보낼 질문을 하나씩 써라. 공손하게, 한 문장, 학생 이름을 넣고, 어떤 숫자·행동 근거가 필요한지(점수, 횟수, 시간 등) 구체적으로 묻는다.\n'
            '출력 형식: {"questions":[{"no":3,"criterion":"기준1","question":"..."}]}\n\n' +
            '\n'.join(f"{it['memo']['no']}. [{it['memo']['student']} / {it['memo']['teacher']}] {it['memo']['text']} / 부족한 기준: {it['criterion']}({CRITERIA[it['criterion']]})" for it in items))


def p_report(items):
    blocks = []
    for it in items:
        m = it['memo']
        lines = [f"### {m['no']}. {m['student']}", f"메모 {m['no']}: {m['text']}"]
        if it['answer'] and it['answer'].get('usable'):
            lines.append(f"답변 {m['no']}: {it['answer']['text']}")
        if it['held']:
            lines.append('말하지 말 것: ' + ' / '.join(h['claim'] for h in it['held']))
        blocks.append('\n'.join(lines))
    return ('학부모에게 보낼 월간 리포트 문장을 써라. 학생마다 2~6문장, 존댓말.\n'
            '규칙:\n- 문장마다 cites 를 단다. quote 는 출처 원문에서 글자 그대로 복사한 부분이다.\n'
            '- quote 에 없는 숫자, 시점(지난달·이번 달·요즘 등), 원인·결과(덕분에·때문에)를 문장에 넣지 않는다.\n'
            '- "말하지 말 것"에 있는 내용은 쓰지 않는다.\n- 인사말은 쓰지 않는다(코드가 붙인다).\n'
            '출력 형식: {"reports":[{"no":1,"sentences":[{"text":"...","cites":[{"src":"메모 1","quote":"..."}]}]}]}\n\n' +
            '\n\n'.join(blocks))


def p_rewrite(items):
    return ('아래 문장들은 자가 점검에서 걸렸다. 문제를 고쳐 다시 써라. 고칠 수 없으면 text 를 빈 문자열로 둔다.\n'
            'quote 는 출처 원문에서 글자 그대로 복사한다. 원문에 없는 숫자·시점·인과는 빼라.\n'
            '출력 형식: {"fixed":[{"id":"3-2","text":"...","cites":[{"src":"메모 3","quote":"..."}]}]}\n\n' +
            '\n'.join(f"id {it['id']} / 문장: {it['sentence']['text']} / 문제: {', '.join(it['problems'])}\n  출처: " +
                      ' | '.join(f'{k} = {v}' for k, v in it['sources'].items()) for it in items))


def _cites(lst):
    return [{'src': norm((c or {}).get('src')), 'quote': norm((c or {}).get('quote'))} for c in (lst if isinstance(lst, list) else [])]


# ------------------------------------------------------------------ 실행
def run(memos_md, load_answers, mode='mock', llm=None, inject_faults=False, on_step=None, chunk=5):
    """load_answers 는 함수다. 질문을 다 만든 뒤에만 부른다."""
    mode = 'llm' if mode == 'llm' else 'mock'
    on_step = on_step or (lambda name, info: None)
    stats = {'calls': 0, 'fallbacks': []}
    memos = parse_memos(memos_md)
    if not memos:
        raise ValueError('메모를 읽지 못했습니다. "1. [이름 / 강사] 내용" 형식인지 확인하세요.')
    by_no = {m['no']: m for m in memos}

    def ask(prompt):
        stats['calls'] += 1
        return parse_json(llm([{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': prompt}]))

    def try_ask(step, prompt):
        try:
            return ask(prompt)
        except Exception as e:  # 모델 실패는 기록만 하고 규칙으로 대신한다
            stats['fallbacks'].append(f'{step}: {e}')
            return None

    # 1) 주장 뽑기
    on_step('extract', {'total': len(memos)})
    claims_by = {m['no']: rule_extract(m) for m in memos}
    if mode == 'llm':
        got = try_ask('extract', p_extract(memos))
        if isinstance(got, dict) and isinstance(got.get('memos'), list):
            for gm in got['memos']:
                memo = by_no.get((gm or {}).get('no'))
                if not memo or not isinstance(gm.get('claims'), list):
                    continue
                ok = [c for c in gm['claims'] if isinstance(c, dict) and c.get('text') and norm(c['text']) in norm(memo['text'])
                      and c.get('type') in ('사실', '평가', '계획') and (c['type'] != '평가' or c.get('category') in CRITERIA)]
                if ok:
                    claims_by[memo['no']] = [{'memo': memo['no'], 'id': f"{memo['no']}-{i + 1}", 'text': norm(c['text']), 'type': c['type'],
                                              'category': c['category'] if c['type'] == '평가' else None} for i, c in enumerate(ok)]
                else:
                    stats['fallbacks'].append(f"extract: 메모 {memo['no']} 원문과 맞는 주장이 없어 규칙으로 대신함")
    claims = [c for m in memos for c in claims_by[m['no']]]

    # 2) 근거 확인 → 판정
    on_step('judge', {})
    judgments = [rule_judge(m, claims_by[m['no']]) for m in memos]
    disagreements = []
    if mode == 'llm':
        gj = try_ask('judge', p_judge(memos, claims_by))
        if isinstance(gj, dict) and isinstance(gj.get('judgments'), list):
            new = []
            for rj in judgments:
                lj = next((x for x in gj['judgments'] if isinstance(x, dict) and x.get('no') == rj['memo']), None)
                if not lj or lj.get('verdict') not in ('정상', '애매'):
                    stats['fallbacks'].append(f"judge: 메모 {rj['memo']} 규칙으로 대신함")
                    new.append(rj)
                    continue
                crit = [k for k in (lj.get('criteria') if isinstance(lj.get('criteria'), list) else []) if k in CRITERIA]
                crit = sorted(uniq(crit)) if lj['verdict'] == '애매' else []
                if lj['verdict'] == '애매' and not crit:
                    crit = rj['criteria'] or ['기준1']
                if lj['verdict'] != rj['verdict']:
                    disagreements.append({'memo': rj['memo'], 'llm': lj['verdict'], 'rule': rj['verdict']})
                new.append({'memo': rj['memo'], 'verdict': lj['verdict'], 'criteria': crit, 'reason': norm(lj.get('reason') or '') or rj['reason']})
            judgments = new

    # 3) 강사 질문
    on_step('questions', {})
    q_items = []
    for j in judgments:
        if j['verdict'] != '애매':
            continue
        memo = by_no[j['memo']]
        for k in j['criteria']:
            c = next((x for x in claims_by[memo['no']] if x['type'] == '평가' and x['category'] == k), None)
            q_items.append({'memo': memo, 'criterion': k, 'claim': c['text'] if c else ''})
    questions = [{'memo': it['memo']['no'], 'teacher': it['memo']['teacher'], 'student': it['memo']['student'],
                  'criterion': it['criterion'], 'question': rule_question(it['memo'], it['criterion'], it['claim'])} for it in q_items]
    if mode == 'llm' and q_items:
        gq = try_ask('questions', p_questions(q_items))
        if isinstance(gq, dict) and isinstance(gq.get('questions'), list):
            new = []
            for q in questions:
                lq = next((x for x in gq['questions'] if isinstance(x, dict) and x.get('no') == q['memo']
                           and (not x.get('criterion') or x.get('criterion') == q['criterion'])), None)
                if lq and lq.get('question') and q['student'] in norm(lq['question']):
                    new.append(dict(q, question=norm(lq['question'])))
                else:
                    stats['fallbacks'].append(f"questions: 메모 {q['memo']} 규칙 질문으로 대신함")
                    new.append(q)
            questions = new

    # 4) 강사 답변 – 질문을 다 만든 뒤에야 연다
    on_step('answers', {})
    answer_map = parse_answers((load_answers() if callable(load_answers) else load_answers) or '')
    answers, unresolved_by = [], {}
    for j in judgments:
        unresolved_by[j['memo']] = []
        if j['verdict'] != '애매':
            continue
        a = answer_map.get(j['memo'])
        still = [k for k in j['criteria'] if not (a and EVIDENCE[k].search(a['text']))]
        unresolved_by[j['memo']] = still
        answers.append({'memo': j['memo'], 'text': a['text'] if a else None, 'usable': bool(a) and len(still) < len(j['criteria']), 'unresolved': still})

    def answer_for(no):
        return next((a for a in answers if a['memo'] == no and a['text']), None)

    # 5) 리포트 쓰기
    on_step('reports', {})
    reports = []
    for m in memos:
        ss, held = rule_report(m, claims_by[m['no']], unresolved_by[m['no']], answer_for(m['no']))
        reports.append({'memo': m['no'], 'student': m['student'], 'greeting': f"안녕하세요. {m['student']} 학생의 학습 상황을 안내드립니다.",
                        'sentences': ss, 'held': held, 'dropped': []})
    rep_by = {r['memo']: r for r in reports}
    if mode == 'llm':
        for start in range(0, len(memos), chunk):
            part = [{'memo': m, 'answer': answer_for(m['no']), 'held': rep_by[m['no']]['held']} for m in memos[start:start + chunk]]
            gr = try_ask('reports', p_report(part))
            for it in part:
                rep = rep_by[it['memo']['no']]
                lr = None
                if isinstance(gr, dict) and isinstance(gr.get('reports'), list):
                    lr = next((x for x in gr['reports'] if isinstance(x, dict) and x.get('no') == it['memo']['no']), None)
                ss = [s for s in (lr.get('sentences') if lr and isinstance(lr.get('sentences'), list) else []) if isinstance(s, dict) and s.get('text')]
                if not ss:
                    stats['fallbacks'].append(f"reports: 메모 {it['memo']['no']} 규칙 문장으로 대신함")
                    continue
                rep['sentences'] = [{'text': norm(s['text']), 'cites': _cites(s.get('cites')), 'flags': flags_for(s['text'])} for s in ss]
    injected = 0
    if inject_faults:
        for idx, r in enumerate(reports):
            if idx % 3 != 0:
                continue
            m = memos[idx]
            r['sentences'].append(injected_fault(m, claims_by[m['no']], idx // 3))
            injected += 1

    # 6) 자가 점검 → 고쳐 쓰기 1회 → 빼기
    on_step('selfcheck', {})
    failing, total, first_pass = [], 0, 0
    for r in reports:
        m = by_no[r['memo']]
        sources = sources_for(m, answer_for(m['no']))
        for i, s in enumerate(r['sentences']):
            total += 1
            p = check_sentence(s, sources)
            if p:
                failing.append({'id': f"{r['memo']}-{i + 1}", 'report': r, 'index': i, 'sentence': s, 'problems': p, 'sources': sources})
            else:
                first_pass += 1
    fixed = {}
    if mode == 'llm' and failing:
        gf = try_ask('rewrite', p_rewrite(failing))
        if isinstance(gf, dict) and isinstance(gf.get('fixed'), list):
            for f in gf['fixed']:
                if isinstance(f, dict) and f.get('id'):
                    fixed[f['id']] = f
    rewritten = dropped = caught = 0
    for f in failing:
        fx = fixed.get(f['id'])
        if fx and fx.get('text'):
            cand = {'text': norm(fx['text']), 'cites': _cites(fx.get('cites'))}
            cand['flags'] = flags_for(cand['text'])
            if not check_sentence(cand, f['sources']):
                f['report']['sentences'][f['index']] = cand
                rewritten += 1
                continue
        f['report']['dropped'].append({'text': f['sentence']['text'], 'problems': f['problems'], 'injected': bool(f['sentence'].get('injected'))})
        f['report']['sentences'][f['index']] = None
        dropped += 1
        if f['sentence'].get('injected'):
            caught += 1
    for r in reports:
        r['sentences'] = [{'text': s['text'], 'cites': s['cites'], 'flags': s.get('flags') or []} for s in r['sentences'] if s]

    return {
        'version': 1, 'mode': mode, 'memos': memos, 'claims': claims, 'judgments': judgments,
        'questions': questions, 'answers': answers, 'reports': reports,
        'selfcheck': {'sentences': total, 'passed_first': first_pass, 'rewritten': rewritten, 'dropped': dropped,
                      'injected': injected, 'injected_caught': caught, 'held': sum(len(r['held']) for r in reports)},
        'llm': {'calls': stats['calls'], 'fallbacks': stats['fallbacks'], 'disagreements': disagreements},
    }


# ------------------------------------------------------------------ 마크다운 표
def _esc(s):
    return str(s).replace('|', '\\|')


def to_markdown(r):
    L = [f"# 리포트 에이전트 실행 결과 ({r['mode']} 모드)", '', '| 항목 | 값 |', '|---|---|']
    sc = r['selfcheck']
    L.append(f"| 메모 수 | {len(r['memos'])} |")
    L.append(f"| 애매 판정 | {sum(1 for j in r['judgments'] if j['verdict'] == '애매')} |")
    L.append(f"| 리포트 문장 | {sum(len(x['sentences']) for x in r['reports'])} |")
    L.append(f"| 자가 점검 1차 통과 / 전체 | {sc['passed_first']} / {sc['sentences']} |")
    L.append(f"| 고쳐 쓴 문장 / 뺀 문장 | {sc['rewritten']} / {sc['dropped']} |")
    L.append(f"| 보류한 주장(근거 없음) | {sc['held']} |")
    if sc['injected']:
        L.append(f"| 일부러 넣은 오류 / 잡은 수 | {sc['injected']} / {sc['injected_caught']} |")
    L += [f"| 모델 호출 수 | {r['llm']['calls']} |", '']
    L += ['## 1. 판정', '', '| 메모 | 학생 | 판정 | 기준 | 이유 |', '|---|---|---|---|---|']
    names = {m['no']: m['student'] for m in r['memos']}
    for j in r['judgments']:
        L.append(f"| {j['memo']} | {names[j['memo']]} | {j['verdict']} | {', '.join(j['criteria']) or '-'} | {_esc(j['reason'])} |")
    L += ['', '## 2. 강사 질문', '', '| 메모 | 강사 | 기준 | 질문 |', '|---|---|---|---|']
    for q in r['questions']:
        L.append(f"| {q['memo']} | {q['teacher']} | {q['criterion']} | {_esc(q['question'])} |")
    L += ['', '## 3. 강사 답변 반영', '', '| 메모 | 답변 | 근거로 쓸 수 있음 | 남은 기준 |', '|---|---|---|---|']
    for a in r['answers']:
        L.append(f"| {a['memo']} | {_esc(a['text'] or '(답변 없음)')} | {'예' if a['usable'] else '아니오'} | {', '.join(a['unresolved']) or '-'} |")
    L += ['', '## 4. 학부모 리포트', '']
    for rep in r['reports']:
        L += [f"### {rep['memo']}. {rep['student']}", '', rep['greeting'], '', '| # | 문장 | 근거 | 확인 표시 |', '|---|---|---|---|']
        for i, s in enumerate(rep['sentences']):
            cites = ' / '.join(f"{c['src']}: \"{c['quote']}\"" for c in s['cites'])
            L.append(f"| {i + 1} | {_esc(s['text'])} | {_esc(cites)} | {', '.join(s['flags']) or '-'} |")
        if rep['held']:
            L += ['', '보류(리포트에 넣지 않음): ' + '; '.join(f"\"{h['claim']}\" – {h['reason']}" for h in rep['held'])]
        if rep['dropped']:
            L += ['', '자가 점검에서 뺀 문장: ' + '; '.join(f"\"{d['text']}\" – {', '.join(d['problems'])}" for d in rep['dropped'])]
        L.append('')
    return '\n'.join(L)


# ------------------------------------------------------------------ OpenRouter 호출
DEFAULT_MODELS = ['openrouter/free']


def openrouter_llm(api_key, models=None, max_tokens=3000, timeout=120):
    """키는 인자로만 받는다. 파일에 쓰지 않는다. 앞 모델이 실패(429 등)하면 다음 모델로 넘어간다."""
    models = models or DEFAULT_MODELS
    used = []

    def call(messages):
        last = None
        for model in models:
            body = json.dumps({'model': model, 'messages': messages, 'temperature': 0, 'max_tokens': max_tokens}).encode('utf-8')
            req = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions', data=body, headers={
                'Authorization': 'Bearer ' + api_key, 'Content-Type': 'application/json', 'X-Title': 'practice01-report-agent'})
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    data = json.load(resp)
                text = ((data.get('choices') or [{}])[0].get('message') or {}).get('content')
                if text:
                    used.append(data.get('model') or model)
                    return text
                last = f'{model}: 빈 응답'
            except urllib.error.HTTPError as e:
                last = f'{model}: HTTP {e.code}'
            except Exception as e:  # 네트워크 오류 등
                last = f'{model}: {e}'
        raise RuntimeError('모든 모델 호출 실패 (' + str(last) + ')')

    call.used = used
    return call


def main(argv=None):
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description='practice_01 리포트 에이전트')
    ap.add_argument('--mode', choices=['mock', 'llm'], default='mock')
    ap.add_argument('--memos', default=os.path.join(here, '..', 'memos.md'))
    ap.add_argument('--answers', default=os.path.join(here, '..', 'answers.md'))
    ap.add_argument('--out', default=None, help='결과 JSON 경로')
    ap.add_argument('--md', default=None, help='결과 마크다운 경로')
    ap.add_argument('--inject-faults', action='store_true')
    ap.add_argument('--models', default=os.environ.get('OPENROUTER_MODELS', ','.join(DEFAULT_MODELS)))
    a = ap.parse_args(argv)
    llm = None
    if a.mode == 'llm':
        key = os.environ.get('OPENROUTER_API_KEY')
        if not key:
            import getpass
            key = getpass.getpass('OpenRouter 키 (화면에 안 보임, 저장 안 함): ')
        llm = openrouter_llm(key, [m.strip() for m in a.models.split(',') if m.strip()])
    with open(a.memos, encoding='utf-8') as f:
        memos_md = f.read()

    def load_answers():
        with open(a.answers, encoding='utf-8') as f:
            return f.read()

    result = run(memos_md, load_answers, mode=a.mode, llm=llm, inject_faults=a.inject_faults,
                 on_step=lambda n, i: print('…', n, file=sys.stderr))
    if llm is not None:
        result['llm']['models_used'] = llm.used
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if a.out:
        with open(a.out, 'w', encoding='utf-8') as f:
            f.write(text + '\n')
    if a.md:
        with open(a.md, 'w', encoding='utf-8') as f:
            f.write(to_markdown(result) + '\n')
    if not a.out and not a.md:
        print(to_markdown(result))
    return result


if __name__ == '__main__':
    main()
