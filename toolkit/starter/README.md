# 브라우저만으로 쓰는 해커톤 스타터

설치·빌드 없이 **GitHub 웹 + Vercel 웹**만으로 "AI를 부르는 웹앱"을 배포하는 최소 뼈대입니다.

| 파일 | 하는 일 |
|---|---|
| `index.html` | 화면. 입력 → `/api/llm` 호출 → 결과 표시. "데모 모드"는 서버를 안 부릅니다(영상 녹화 대비) |
| `api/llm.js` | Vercel 서버 함수. 키는 **환경 변수**에만 두고 OpenRouter를 대신 부릅니다. 접근 코드 확인, 모델 여러 개 차례로 시도, IP당 1분·하루 요청 수 제한 |

API 키는 **절대** `index.html`이나 GitHub에 쓰지 않습니다. 브라우저 코드는 누구나 볼 수 있기 때문입니다.

## 먼저 알아 둘 것: 진짜 안전장치는 "OpenRouter 사용 한도"
배포 주소는 누구나 열 수 있습니다. 이 스타터는 ① 접근 코드(`ACCESS_CODE`), ② 요청 수 제한, ③ 모델 지시문을 서버에서만 정하기(브라우저가 보낸 지시문은 버림)로 남용을 줄이지만, 모두 **완벽한 차단은 아닙니다.**
**OpenRouter 키에 사용 한도(credit limit)를 꼭 걸어 두세요.** 무료 모델만 쓸 거면 0으로 두면, 무슨 일이 있어도 돈이 나가지 않습니다.

## 배포하기 (클릭 순서)

> 화면의 버튼 이름은 바뀔 수 있습니다. 비슷한 이름을 찾으세요.

### 1. 내 GitHub 저장소 만들기
1. github.com → 오른쪽 위 **+** → **New repository**
2. 이름 입력(예: `my-hack`), **Public**, **Add a README file** 체크 → **Create repository**
3. 새 저장소 화면에서 **Add file** → **Upload files**
4. 이 폴더의 `index.html`을 끌어다 놓고 **Commit changes**
5. 다시 **Add file** → **Create new file** → 이름 칸에 `api/llm.js` 입력(슬래시를 치면 폴더가 생김) → 이 저장소의 `toolkit/starter/api/llm.js` 내용을 그대로 붙여 넣기 → **Commit changes**

### 2. OpenRouter 키 만들기
1. openrouter.ai 로그인 → **Keys** → **Create Key**
2. **Credit limit**(사용 한도)을 작게 걸기 (무료 모델만 쓸 거면 0)
3. 키를 복사해 둡니다. **어디에도 저장하지 말고** 다음 단계에서 바로 붙여 넣습니다

### 3. Vercel에 올리기
1. vercel.com → **Continue with GitHub**로 로그인
2. **Add New…** → **Project** → 1번에서 만든 저장소 옆 **Import**
3. **Framework Preset**: `Other` (빌드 명령은 비워 둠)
4. 이 저장소(hackathon-practice) 통째로 올린 경우에만: **Root Directory** → **Edit** → `toolkit/starter`
5. **Environment Variables** 펼치기 → Key `OPENROUTER_API_KEY`, Value에 키 붙여 넣기 → **Add**
   - 한 줄 더: Key `ACCESS_CODE`, Value에 나만 아는 긴 문구(예: 단어 4개를 이어 붙인 것) → **Add**. 심사위원에게는 이 코드를 따로 알려 주거나, 데모 모드로 보여 줍니다
6. **Deploy** → 1~2분 뒤 나오는 주소(`https://my-hack-xxx.vercel.app`)를 엽니다

### 4. 확인
- **접근 코드** 칸에 `ACCESS_CODE` 값을 넣고, 입력에 "안녕하세요"를 넣고 **보내기** → 답이 나오고 아래에 실제로 답한 모델 이름이 보이면 성공
- "서버에 OPENROUTER_API_KEY(또는 ACCESS_CODE) 환경 변수가 없습니다" → 3-5를 다시 하고 **Deployments → 맨 위 → Redeploy**
- "접근 코드가 맞지 않습니다" → 화면의 접근 코드 칸 확인
- "모든 모델이 지금 응답하지 않습니다" → 무료 모델이 붐비는 것. 잠시 뒤 다시, 또는 아래 `OPENROUTER_MODELS`에 다른 무료 모델 추가

## 설정 (Vercel → Project → Settings → Environment Variables)

| 이름 | 기본값 | 뜻 |
|---|---|---|
| `OPENROUTER_API_KEY` | (필수) | OpenRouter 키 |
| `ACCESS_CODE` | (필수) | 화면에서 넣는 접근 코드. 없으면 서버가 모든 요청을 거절 |
| `SYSTEM_PROMPT` | 지어내지 말라는 기본 지시문 | 모델에게 주는 지시문. 제품이 할 일을 여기 씁니다(브라우저에서는 못 바꿈) |
| `OPENROUTER_MODELS` | `openrouter/free` | 쉼표로 여러 개. 앞에서부터 시도하고 429·5xx·시간 초과면 다음 모델 |
| `RATE_LIMIT_PER_MIN` | `10` | IP 하나가 1분에 보낼 수 있는 요청 수 |
| `DAILY_LIMIT` | `200` | 서버 인스턴스 하나가 하루에 받을 요청 수 |

무료 모델 이름은 자주 바뀝니다. openrouter.ai/models 에서 가격이 0인 모델의 id(예: `...:free`)를 넣으세요. 바꾼 뒤에는 **Redeploy**.

## 한계
- IP는 Vercel이 붙여 주는 `x-vercel-forwarded-for`만 믿습니다(사용자가 바꿀 수 있는 `x-forwarded-for`는 무시). Vercel이 아닌 곳에 올리면 이 부분을 그 플랫폼에 맞게 바꿔야 합니다.
- 요청 수 제한은 서버 메모리에만 있어서, Vercel이 서버를 새로 띄우면 0부터 다시 셉니다. 공개 대회 데모 정도에는 충분하지만 완벽한 차단은 아닙니다. **OpenRouter 쪽 사용 한도**를 꼭 같이 거세요.
- 모델 하나에 20초까지 기다립니다. 모델 여러 개가 모두 느리면 Vercel 함수 시간 제한에 걸릴 수 있습니다.
- 발표·영상 녹화 중에는 **데모 모드**를 켜 두면 서버 상태와 상관없이 화면이 동작합니다(단, "데모 모드"라고 화면에 표시됨).
