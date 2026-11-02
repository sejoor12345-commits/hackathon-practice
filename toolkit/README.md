# 해커톤 툴킷

브라우저만 쓸 수 있는 환경(사지방)에서 해커톤·창업경진대회를 **마지막 단계(검증·영상·피칭)까지** 끝내기 위한 도구 모음입니다.

| 파일 | 언제 쓰나 |
|---|---|
| [`templates/01-problem.md`](templates/01-problem.md) | 첫 1시간: 누가·언제·손해를 숫자로 |
| [`templates/02-scope.md`](templates/02-scope.md) | 만들 것 / 안 만들 것, 핵심 흐름 1개 |
| [`templates/03-criteria.md`](templates/03-criteria.md) | 제3자가 예/아니오로 판정하는 완료 기준 + 숨긴 평가 세트 |
| [`templates/04-demo.md`](templates/04-demo.md) | 데모 시나리오 + 2~3분 영상 대본 |
| [`templates/05-pitch.md`](templates/05-pitch.md) | 3분 피칭: 문제-해결-데모-숫자-팀-요청 |
| [`templates/06-retro.md`](templates/06-retro.md) | 끝나고 24시간 안에 회고 |
| [`timeline.md`](timeline.md) | 24시간 / 48시간 / 2주 시간표 |
| [`psst-cheatsheet.md`](psst-cheatsheet.md) | 창업경진대회 사업계획서(PSST) 한 장 정리 |
| [`pitch-timer.html`](pitch-timer.html) | 3분 피칭 연습: 구간 타이머, 심사 질문 42개 뽑기, 자기 채점 기록 |
| [`starter/`](starter/) | 설치·빌드 없이 Vercel에 올리는 웹앱 뼈대 (키는 서버 환경 변수에만) |
| `tests/llm.test.js` | `starter/api/llm.js` 테스트 (가짜 fetch, 실제 API 호출 없음) |

## Claude Code 명령 (저장소 맨 위 `.claude/commands/`)

| 명령 | 하는 일 |
|---|---|
| `/hack-start <대회, 남은 시간>` | 공고 확인표 → 작업 폴더·템플릿 복사 → 문제·범위·기준 초안 → 시간표 |
| `/scope-check` | 지금 만드는 것이 핵심 흐름 1개에 맞는지, 남은 시간에 끝나는지 예/아니오로 판정 |
| `/criteria-check` | 기준에 숫자가 있는지, 제3자가 판정할 수 있는지 보고 실제 결과로 판정 |
| `/fabrication-check <파일, 원문>` | 원문에 없는 숫자·시점·인과·비교를 문장마다 찾기 (파일은 고치지 않음) |
| `/pitch-prep <폴더, 대회 종류>` | 저장소 사실만으로 대본·슬라이드 5장·예상 질문 |

Claude Code(웹)에서 이 저장소를 열면 바로 쓸 수 있습니다. 새 대회용 저장소를 만들면 `.claude/commands/` 폴더와 `toolkit/` 폴더를 통째로 복사하세요.

## 페이지 열기 (터미널 없이)
- 저장소 Settings → Pages → Branch `main` → Save 후: `https://sejoor12345-commits.github.io/hackathon-practice/toolkit/pitch-timer.html`
- 또는 GitHub에서 `pitch-timer.html` → Raw → 내용을 복사해 내 컴퓨터에 `.html`로 저장한 뒤 열기 (파일 하나로 동작)

## 테스트 (Claude Code에서 "툴킷 테스트 돌려 줘")
```
node --test toolkit/tests/llm.test.js
```
