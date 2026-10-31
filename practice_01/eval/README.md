# practice_01 평가 세트와 채점기

> 여기 있는 메모·답변은 모두 **가짜 데이터**입니다.

| 파일 | 하는 일 |
|---|---|
| `memos.md` | 평가용 강사 메모 12개 (에이전트 규칙을 만든 뒤에 따로 작성) |
| `answers.md` | 평가용 강사 답변. **에이전트가 질문을 다 만든 뒤에만** 읽습니다 |
| `gold.json` | 정답: 메모별 판정, 꼭 들어갈 사실(`must_include`), 나가면 안 되는 표현(`must_not`), 근거가 필요한 평가(`claim`/`needs`) |
| `grade.js` / `grade.py` | 채점기 (Node·브라우저 / Colab). 같은 점수를 냅니다 |
| `run_eval.js` | mock 모드로 돌리고 채점해서 `output/`에 저장 |
| `test_eval.js` | 자동 테스트 (채점기가 망가뜨린 리포트 10종을 잡는지 등) |
| `RESULTS.md` | 점수와 해석 (실측/목표/가설 구분) |

## 실행하는 방법 (터미널 없이)

| 어디서 | 어떻게 |
|---|---|
| Google Colab | `practice_01/agent/agent.ipynb`를 열고 위에서부터 실행 → "4. 평가 세트 채점" 셀 |
| 브라우저 | `agent.html`에서 "데이터: 평가 세트" 고르고 실행 → "채점하기" 버튼 (GitHub Pages·Vercel처럼 주소로 열었을 때만) |
| Claude Code (웹) | "practice_01 평가 돌려 줘"라고 하면 `node practice_01/eval/run_eval.js`와 `node --test practice_01/eval/test_eval.js`를 실행 |

## 나만의 숨긴 평가 세트 만들기 (가장 중요)

지금 평가 세트는 에이전트 규칙을 아는 사람이 만들어서 진짜로 숨긴 시험이 아닙니다.

1. `practice_01/eval_mine/` 폴더를 만들고 `memos.md`, `answers.md`, `gold.json`을 **AI 도움 없이** 직접 씁니다. 형식은 이 폴더 파일을 그대로 따라 합니다.
2. AI에게 작업을 시킬 때 "eval_mine 은 열지 마"라고 말합니다(CLAUDE.md 3번 규칙).
3. 에이전트를 고친 다음에만 채점합니다. 채점 결과를 보고 에이전트를 고쳤다면, 그 사실을 RESULTS에 적습니다.
