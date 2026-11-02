# hackathon-practice

AI 해커톤(Pre-SKALA) 대비 미니 해커톤 연습 기록입니다.
회차마다 정해진 흐름에 따라 문제를 정의하고 범위를 줄인 뒤 구현·검증·피칭까지 연습합니다.
구현이 있는 회차는 `practice_01`, `practice_02`처럼 번호를 붙인 폴더에 결과를 남깁니다.

## 연습 흐름

1. **문제 정의** – 누구의 어떤 문제를 푸는지 한두 문장으로 정리한다.
2. **범위 줄이기** – 시간 안에 끝낼 핵심 기능만 남기고, 만들지 않을 것을 정한다.
3. **구현 준비 → 구현** – 입력 데이터와 성공 판정 기준을 정하고 최소 기능을 만든다.
4. **검증** – 성공 판정 항목별로 결과가 맞는지 확인한다.
5. **피칭** – 문제, 해결 방식, 결과를 짧게 발표한다.

## 폴더 구조

```
hackathon-practice/
├── README.md
├── CLAUDE.md                 # Claude 작업 규칙
├── .claude/commands/         # Claude Code 명령: /hack-start /scope-check /criteria-check /fabrication-check /pitch-prep
├── practice_01/              # 영어학원 월간 리포트 에이전트
│   ├── memos.md, answers.md  # 입력 (가짜)
│   ├── results/              # 4회차 결과물 (Claude가 쓴 마크다운)
│   ├── agent/                # 진짜로 돌아가는 에이전트: Colab(agent.ipynb·agent.py), 브라우저(agent.html), mock 모드
│   ├── eval/                 # 만들 때 안 본 가짜 메모 12개 + 채점기(JS·파이썬) + RESULTS.md
│   ├── pitch/                # 5회차: 3분 대본 + 슬라이드 5장 개요
│   └── log.md
├── practice_02/              # 요구가 충돌하는 교대근무표 (풀지 않은 연습 문제)
│   ├── brief.md              # 5회차 진행 방법과 채점표
│   ├── data/                 # 규칙·직원·지난주·요청 메시지 (가짜)
│   ├── answers.md            # 질문을 다 만든 뒤에만 열기
│   └── eval_hidden/          # 4회차 검증 때만 열기 (정답 + 근무표 채점기)
└── toolkit/                  # 템플릿 6종, 시간표, PSST 정리, 피칭 타이머, 배포 스타터
```

## 회차 기록

| 회차 | 주제 | 핵심 내용 | 결과 |
|------|------|-----------|------|
| practice_01 | 영어학원 월간 리포트 에이전트 | 강사 메모 중 근거가 부족한 메모를 찾아 질문하고 리포트 초안 작성 | 판정 10/10 정답, 리포트 10개 생성(지어낸 수치 0). 개선점: 다른 학생과 비교하는 표현, 부정적 내용 전달 방식, 시점·인과관계 덧붙임 |
| practice_01 (보강) | 진짜 에이전트 + 평가 + 피칭 | 코드가 6단계를 실행, 자가 점검은 코드, mock 모드 비용 0원 | [실측, mock] 만들 때 안 본 메모 12개: 판정 10/12, 애매 4/6 찾음, 근거 없는 평가 2건. 일부러 넣은 지어낸 문장 4/4 제거. 실제 모델 점수 미측정. 기존 리포트에서 '이번 달' 덧붙임 5/27문장 발견 → [`eval/RESULTS.md`](practice_01/eval/RESULTS.md) |
| practice_02 | 교대근무표 (요구 충돌) | 직원 7명·요청 8건·보호자 요청이 부딪히는 근무표 | 아직 안 풂 → [`brief.md`](practice_02/brief.md) |

## 툴킷

[`toolkit/README.md`](toolkit/README.md) – 템플릿, 24시간/48시간/2주 시간표, PSST 한 장 정리, [3분 피칭 타이머](toolkit/pitch-timer.html), 브라우저만으로 배포하는 [스타터](toolkit/starter/README.md).

## 다음에 할 일

날짜 옆 [확정]/[예상]은 대회 조사 기준(2026-10-31)입니다. 공고가 나오면 다시 확인합니다.

| # | 할 일 | 끝났다는 증거 (제3자 판정) | 언제 |
|---|---|---|---|
| 1 | practice_01 피칭을 `toolkit/pitch-timer.html`로 3번 연습하고 기록 | 연습 기록 3줄, 마지막 기록 3:00 이하 | 이번 주 |
| 2 | practice_01 평가 세트를 **실제 무료 모델**로 1번 돌리기 (Colab `agent.ipynb` 5~6번 셀) | `eval/RESULTS.md`에 날짜·모델·점수 1줄 추가 | 이번 주 |
| 3 | AI 없이 메모 10개를 직접 써서 `practice_01/eval_mine/` 만들기 (진짜 숨긴 평가) | 파일 3개(memos, answers, gold) 커밋 | 2주 안 |
| 4 | practice_02 1~2회차 (문제 정의·범위) | `practice_02/work/01-problem.md`, `02-scope.md` 자가 채점 각 /20 | 2주 안 |
| 5 | MLH Global Hack Week 참가 (온라인, 무료) – `/hack-start`로 시작 | 제출 화면 또는 참가 기록 | 11/6~12 또는 12/4~10 [확정] |
| 6 | Arbiter Hacks V1 (Beginner Friendly) 제출 – `toolkit/timeline.md` 2주 표 | Devpost 제출 완료, 2~3분 영상 링크 | ~12/20 [확정] |
| 7 | Cosmo Hacks (AI 도구 허용, AI 사용 방법 설명 필요) | Devpost 제출 완료 | 12/19~1/18 [확정] |
| 8 | 국방 Start-up 챌린지 2027 팀(2~5인) 꾸리기 + `psst-cheatsheet.md`로 사업계획서 초안 | 팀원 명단, PSST 4칸 초안 | 1~2월 공고 확인, 접수 2~5월 [예상] |
| 9 | 공군 창의·혁신 해커톤 (병영복지 분야, practice_02 주제 일반화 검토) | 서류 제출 | 5~6월 [예상] |
