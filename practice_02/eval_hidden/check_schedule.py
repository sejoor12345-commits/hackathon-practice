"""practice_02 근무표 채점기 (숨긴 평가용 – 4회차 검증 전에는 열지 않기)

사용 (Colab 셀이나 Claude Code):
    python check_schedule.py 내_근무표.csv
근무표 CSV 형식 (첫 줄은 제목):
    이름,월,화,수,목,금,토,일
    가람,D,D,D,D,D,-,D
    ...
D=주간, E=저녁, N=야간, -=휴무. 표준 라이브러리만 씁니다.
"""
import csv
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'data')
DAYS = ['월', '화', '수', '목', '금', '토', '일']
NEED = {'D': 2, 'E': 2, 'N': 1}


def read_csv(path):
    with open(path, encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


def check(rows, after_answers=True):
    staff = {r['이름']: r for r in read_csv(os.path.join(DATA, 'staff.csv'))}
    last = {r['이름']: [r['금'], r['토'], r['일']] for r in read_csv(os.path.join(DATA, 'last_week.csv'))}
    sched = {}
    problems = []
    for r in rows:
        name = (r.get('이름') or '').strip()
        vals = [(r.get(d) or '').strip().upper() or '-' for d in DAYS]
        if name not in staff:
            problems.append(('형식', f'모르는 이름: {name}'))
            continue
        for d, v in zip(DAYS, vals):
            if v not in ('D', 'E', 'N', '-'):
                problems.append(('형식', f'{name} {d}: "{v}" 는 D/E/N/- 가 아님'))
        sched[name] = vals
    for name in staff:
        if name not in sched:
            problems.append(('형식', f'{name} 이(가) 근무표에 없음'))
            sched[name] = ['-'] * 7

    hard = []
    need = {d: dict(NEED) for d in DAYS}
    if after_answers:
        need['토']['D'] = 3  # 원장 답변
    for i, d in enumerate(DAYS):
        for k in 'DEN':
            n = sum(1 for s in sched.values() if s[i] == k)
            if n < need[d][k]:
                hard.append(('규칙 1', f'{d} {k} {n}명 (최소 {need[d][k]}명)'))
    for name, s in sched.items():
        seq = last[name] + s
        for j in range(3, 10):
            if seq[j - 1] == 'N' and seq[j] in ('D', 'E'):
                hard.append(('규칙 3', f'{name} {DAYS[j - 3]}: 야간 다음 날 {seq[j]}'))
        run = 0
        for j, v in enumerate(seq):
            run = run + 1 if v == 'N' else 0
            if run > 3 and j >= 3:
                hard.append(('규칙 4', f'{name} {DAYS[j - 3]}: 야간 {run}일 연속'))
        work = sum(1 for v in s if v != '-')
        if work > 6:
            hard.append(('규칙 5', f'{name} 주 {work}근무'))
        if staff[name]['야간 가능'] == '아니오' and 'N' in s:
            hard.append(('규칙 6', f'{name} 야간 불가인데 야간 배정'))
    # 확정 요청
    firm = [
        ('가람 토요일 휴무', sched['가람'][5] == '-'),
        ('마루 목요일 저녁·야간 없음', sched['마루'][3] in ('D', '-')),
    ]
    if after_answers:
        firm += [
            ('다온 일요일 휴무 (답변)', sched['다온'][6] == '-'),
            ('나래 야간 1회 이하 (답변)', sched['나래'].count('N') <= 1),
        ]
    # 바람 (지키면 좋은 것)
    def max_run(s):
        best = cur = 0
        for v in s:
            cur = cur + 1 if v != '-' else 0
            best = max(best, cur)
        return best
    soft = [
        ('사랑 연속 근무 4일 이하', max_run(sched['사랑']) <= 4),
        ('라온 수·목·금 야간', [sched['라온'][i] for i in (2, 3, 4)] == ['N', 'N', 'N']),
        ('라온 토·일 휴무', sched['라온'][5] == '-' and sched['라온'][6] == '-'),
        ('바다 토요일 주간 (가람 대신, 원장 승인 전)', sched['바다'][5] == 'D'),
        ('원장: 6근무인 사람 수 (적을수록 좋음)', sum(1 for s in sched.values() if sum(1 for v in s if v != '-') == 6)),
    ]
    return problems, hard, firm, soft


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    with open(argv[0], encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))
    problems, hard, firm, soft = check(rows)
    print('## 형식'); print('문제 없음' if not problems else '\n'.join(f'- {a}: {b}' for a, b in problems))
    print('\n## 꼭 지킬 규칙 위반 (0이어야 함)')
    print(f'위반 {len(hard)}개')
    for a, b in hard:
        print(f'- {a}: {b}')
    print('\n## 확정 요청')
    for a, ok in firm:
        print(f"- {'지킴' if ok else '어김'}: {a}")
    print(f"확정 요청 {sum(1 for _, ok in firm if ok)}/{len(firm)}")
    print('\n## 바람')
    for a, v in soft:
        print(f"- {a}: {v if isinstance(v, int) and not isinstance(v, bool) else ('지킴' if v else '어김')}")
    return 0 if not hard and not problems else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
