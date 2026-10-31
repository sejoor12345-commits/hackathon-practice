"""practice_01 평가 채점기 (파이썬 판, Google Colab 용). grade.js 와 같은 규칙이다.

에이전트 코드(agent.py)를 불러오지 않는다. 같은 버그를 함께 갖지 않도록 따로 썼다.

사용:  python grade.py <run.json> [memos.md] [answers.md] [gold.json]
       (기본값은 이 폴더의 memos.md / answers.md / gold.json)
채점 항목 설명은 grade.js 머리말을 본다.
"""
import json
import math
import os
import re
import sys

TIMING = ['지난달', '이번 달', '이번달', '다음 달', '다음달', '지난주', '이번 주', '다음 주', '개월', '연속',
          '매일', '매주', '매번', '항상', '처음', '최근', '요즘', '앞으로', '작년', '올해', '학기', '방학',
          '지난번', '그동안', '꾸준히', '계속', '이전', '점점']
CAUSAL = ['때문', '덕분', '덕택', '덕에', '그래서', '따라서', '그 결과', '결과로', '영향으로', '인해', '바람에', '탓',
          '으므로', '니까']
COMPARE = ['다른 애들', '다른 학생', '다른 친구', '다른 아이', '반 평균', '친구들']
GREETING = re.compile(r'^안녕하세요\. [^0-9]+ 학생의 학습 상황을 안내드립니다\.$')


def norm(s):
    return re.sub(r'\s+', ' ', '' if s is None else str(s)).strip()


def nums(s):
    return re.findall(r'[0-9]+(?:\.[0-9]+)?', str(s))


def hits(text, words):
    return [w for w in words if w in text]


def parse_memos(md):
    out = {}
    for line in str(md).splitlines():
        m = re.match(r'^\s*([0-9]+)\.\s*\[\s*([^/\]]+?)\s*/\s*([^\]]+?)\s*\]\s*(.+?)\s*$', line)
        if m:
            out[int(m.group(1))] = {'student': m.group(2), 'teacher': m.group(3), 'text': m.group(4)}
    return out


def parse_answers(md):
    out = {}
    for line in str(md).splitlines():
        c = [x.strip() for x in line.split('|')]
        if len(c) >= 5 and re.fullmatch(r'[0-9]+', c[1]) and c[3]:
            out[int(c[1])] = c[3]
    return out


def ratio(a, b):
    return {'got': a, 'total': b, 'pct': (math.floor(1000 * a / b + 0.5) / 10 if b else None)}


def grade(run, memos_md, answers_md, gold):
    memos, answers = parse_memos(memos_md), parse_answers(answers_md)
    issues = []
    g = {x['no']: x for x in gold['memos']}
    nos = [x['no'] for x in gold['memos']]

    correct = tp = fp = fn = crit_ok = 0
    for no in nos:
        j = next((x for x in run.get('judgments', []) if x['memo'] == no), None)
        v = j['verdict'] if j else '(없음)'
        if v == g[no]['verdict']:
            correct += 1
        else:
            issues.append({'memo': no, 'kind': '판정', 'detail': f"정답 {g[no]['verdict']}, 에이전트 {v}"})
        if g[no]['verdict'] == '애매' and v == '애매':
            tp += 1
            a, b = ','.join(sorted(j.get('criteria') or [])), ','.join(sorted(g[no]['criteria']))
            if a == b:
                crit_ok += 1
            else:
                issues.append({'memo': no, 'kind': '기준', 'detail': f'정답 {b}, 에이전트 {a}'})
        if g[no]['verdict'] != '애매' and v == '애매':
            fp += 1
        if g[no]['verdict'] == '애매' and v != '애매':
            fn += 1

    q_need = q_ok = q_extra = 0
    qs = run.get('questions', [])
    for no in nos:
        if g[no]['verdict'] != '애매':
            if any(q['memo'] == no for q in qs):
                q_extra += 1
            continue
        for k in g[no]['criteria']:
            q_need += 1
            ok = any(q['memo'] == no and memos[no]['student'] in norm(q['question']) and hits(norm(q['question']), gold['keywords'][k]) for q in qs)
            if ok:
                q_ok += 1
            else:
                issues.append({'memo': no, 'kind': '질문', 'detail': f'{k} 근거를 묻는 질문 없음'})

    atoms = atoms_ok = must_not_hits = sentences = fabricated = cite_ok = cmp_total = cmp_flagged = greet_ok = unsupported = 0
    fab_list = []
    for no in nos:
        rep = next((r for r in run.get('reports', []) if r['memo'] == no), None) or {'sentences': [], 'greeting': ''}
        sources = {f'메모 {no}': memos[no]['text']}
        if no in answers:
            sources[f'답변 {no}'] = answers[no]
        alltext = memos[no]['text'] + ' ' + answers.get(no, '')
        all_nums = nums(alltext)
        body = ' '.join(norm(s['text']) for s in rep['sentences'])

        gr = norm(rep.get('greeting'))
        if GREETING.match(gr) and memos[no]['student'] in gr and not hits(rep.get('greeting') or '', TIMING):
            greet_ok += 1
        else:
            issues.append({'memo': no, 'kind': '인사말', 'detail': rep.get('greeting')})

        for a in g[no]['must_include']:
            atoms += 1
            if a in body:
                atoms_ok += 1
            else:
                issues.append({'memo': no, 'kind': '빠진 사실', 'detail': a})
        for a in g[no]['must_not']:
            if a in body:
                must_not_hits += 1
                issues.append({'memo': no, 'kind': '보류 위반', 'detail': a})
        if g[no].get('claim') and g[no]['claim'] in body and not all(a in body for a in g[no].get('needs', [])):
            unsupported += 1
            issues.append({'memo': no, 'kind': '근거 없는 평가', 'detail': f'"{g[no]["claim"]}"이(가) 근거(' + ', '.join(g[no]['needs']) + ') 없이 나감'})

        for s in rep['sentences']:
            sentences += 1
            t = norm(s['text'])
            problems = [f'숫자 {n}' for n in nums(t) if n not in all_nums]
            problems += [f'시점 "{w}"' for w in hits(t, TIMING) if w not in alltext]
            problems += [f'인과 "{w}"' for w in hits(t, CAUSAL) if w not in alltext]
            if problems:
                fabricated += 1
                fab_list.append({'memo': no, 'text': t, 'problems': problems})
                issues.append({'memo': no, 'kind': '지어내기', 'detail': t + ' → ' + ', '.join(problems)})
            cites = s.get('cites') or []
            cited = ''
            valid = len(cites) > 0
            for c in cites:
                if c.get('src') not in sources:
                    valid = False
                    break
                cited += ' ' + sources[c['src']]
                if norm(c.get('quote')) == '' or norm(c.get('quote')) not in norm(sources[c['src']]):
                    valid = False
                    break
            if valid:
                cn = nums(cited)
                valid = all(n in cn for n in nums(t))
            if valid:
                cite_ok += 1
            else:
                issues.append({'memo': no, 'kind': '인용', 'detail': t})
            if hits(t, COMPARE):
                cmp_total += 1
                if any('비교' in f for f in (s.get('flags') or [])):
                    cmp_flagged += 1
                else:
                    issues.append({'memo': no, 'kind': '비교 표시 없음', 'detail': t})

    scores = {
        '판정_정확도': ratio(correct, len(nos)),
        '애매_재현율': ratio(tp, tp + fn),
        '애매_정밀도': ratio(tp, tp + fp),
        '위반기준_일치': ratio(crit_ok, tp),
        '질문_적합': ratio(q_ok, q_need),
        '불필요한_질문': q_extra,
        '사실_커버리지': ratio(atoms_ok, atoms),
        '보류_위반': must_not_hits,
        '근거_없는_평가': unsupported,
        '지어낸_문장': ratio(fabricated, sentences),
        '인용_유효': ratio(cite_ok, sentences),
        '비교_표시': ratio(cmp_flagged, cmp_total),
        '인사말_틀': ratio(greet_ok, len(nos)),
    }
    return {'scores': scores, 'issues': issues, 'fabricated': fab_list}


def fmt(r):
    if isinstance(r, int):
        return str(r)
    pct = '' if r['pct'] is None else f" ({r['pct']:g}%)"
    return f"{r['got']}/{r['total']}{pct}"


def to_markdown(result, title=None):
    L = ['## ' + (title or '채점 결과'), '', '| 항목 | 점수 |', '|---|---|']
    for k, v in result['scores'].items():
        L.append(f"| {k.replace('_', ' ')} | {fmt(v)} |")
    L += ['', '| 메모 | 문제 종류 | 내용 |', '|---|---|---|']
    if not result['issues']:
        L.append('| - | - | 문제 없음 |')
    for i in result['issues']:
        L.append(f"| {i['memo']} | {i['kind']} | {str(i['detail']).replace('|', chr(92) + '|')} |")
    return '\n'.join(L)


def main(argv):
    here = os.path.dirname(os.path.abspath(__file__))
    if not argv:
        print('사용: python grade.py <run.json> [memos.md] [answers.md] [gold.json]', file=sys.stderr)
        return 2
    def rd(p):
        with open(p, encoding='utf-8') as f:
            return f.read()
    res = grade(json.loads(rd(argv[0])),
                rd(argv[1] if len(argv) > 1 else os.path.join(here, 'memos.md')),
                rd(argv[2] if len(argv) > 2 else os.path.join(here, 'answers.md')),
                json.loads(rd(argv[3] if len(argv) > 3 else os.path.join(here, 'gold.json'))))
    print(to_markdown(res))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
