# Orca Graph Engineering

한국어 · [English](README.en.md)

## 1. 빠른 설치

### 요구 사항

| 항목 | 버전 |
| --- | --- |
| Orca | `1.4.176` 이상 |
| Node.js | `22` 이상 |

### 설치

```bash
git clone https://github.com/strong1133/orca-graph-engineering-public.git
cd orca-graph-engineering-public
corepack enable
corepack npm ci
corepack npm run build
```

`corepack npm run build`가 `dist/panel.html`을 만듭니다. 이 파일이 없으면 Orca가 패널을 열지 못합니다.

### Orca에 추가

1. Orca 설정에서 플러그인 시스템을 켭니다.
2. Development plugin 경로로 이 저장소 디렉터리를 지정합니다. 매니페스트는 최상위 `orca-plugin.json`입니다.
3. 사이드바에 `Graph Engineering` 패널이 나타나면 설치가 끝난 것입니다.

배포용 아카이브가 필요하면 `corepack npm run package:plugin`으로 만들고 `corepack npm run verify:plugin`으로 검증합니다. 압축을 푼 `package/` 디렉터리를 그대로 Development plugin 경로로 쓸 수 있습니다.

### 저장 터미널

패널은 Orca 플러그인 API v1의 sandbox 안에서 돕니다. 그 sandbox에는 네트워크도, 파일도, 브라우저 저장소도 없습니다. 패널이 밖으로 나갈 수 있는 통로는 `terminal.sendText` 하나뿐이므로, **저장과 실행은 터미널로 명령 한 줄을 보내** 수행합니다.

이 플러그인은 **자기 전용 터미널**을 씁니다. 탭 이름은 `Graph Engineering`이고, `corepack npm run build`가 설치할 때 하나 만들어 둡니다. 고를 것도, 신경 쓸 것도 없습니다.

닫아도 됩니다 — 다음에 명령이 돌 때 다시 만듭니다. 아직 전용 터미널이 없는 워크트리에서는 에이전트가 돌지 않는 터미널 하나로 한 번만 보내고, 그 명령이 그 워크트리의 전용 터미널을 만듭니다. **Codex·Claude가 실행 중인 pane에는 보내지 않습니다** — 그 터미널은 작업을 받는 쪽입니다.

터미널이 하나도 없으면 패널은 보낼 곳이 없습니다. 패널은 터미널을 만들 수 없습니다 — Orca가 sandbox 패널에 여는 액션은 `workspace.readContext`·`terminal.sendText`·`notifications.show` 셋뿐입니다. 이때 패널은 명령을 버리지 않고 들고 있다가, **터미널 탭이 열리는 즉시 저절로 이어서 보냅니다**(알림도 함께 띄웁니다). 사용자가 할 일은 터미널 탭을 하나 여는 것뿐입니다.

상주 프로세스는 없습니다. 켜 두어야 하는 것도, 연결 상태도 없습니다. 저장 버튼을 누르면 그때 명령이 한 번 돌고 끝납니다.

이어질 명령은 **한 줄로 묶어** 보냅니다. 앞 명령이 도는 동안 다음 줄을 타이핑하면 그 입력은 셸이 아니라 tty의 정규 모드 버퍼로 들어가는데, 그 버퍼는 작아서 긴 payload가 소리 없이 잘립니다. 잘린 줄은 셸 문법 오류가 되고 실행은 일어나지 않습니다. 그래서 저장과 실행은 `&&`로 이어 한 번에 보냅니다 — 저장이 실패하면 실행도 가지 않습니다.

```bash
# 전용 터미널에서 도는 명령의 형태 — 직접 칠 일은 없습니다
node ./scripts/graph-store.mjs save <payload>
```

### 데이터를 어디에 둘지 고르기

패널의 `데이터 원천`에서 셋 중 하나를 고릅니다. 외부 서버 없이도 완전히 동작합니다.

| 모드 | 저장 위치 | 쓰는 경우 |
| --- | --- | --- |
| **로컬 JSON**(기본) | Orca 앱 데이터의 `plugin-runtime/orca-graph-engineering/store.json` | 혼자 쓰거나 바로 시작할 때 |
| **폴더** | 지정한 디렉터리의 `.orca-graph-engineering/store.json` | 일반 저장소나 폴더에 업무 데이터를 함께 두고 Git으로 관리할 때 |
| **구조화 Workspace** | 외부 HTTP 원천 | 여러 사람·여러 장치가 같은 그래프를 CAS로 공유할 때 |

폴더 모드는 어떤 Git 저장소든 일반 디렉터리든 가리킬 수 있습니다. 첫 연결 시 파일이 없으면 현재 패널 내용으로 한 번 만들고, 이미 있으면 그 파일이 항상 우선합니다.

## 2. 이 플러그인은 무엇인가

Orca 안에서 **여러 에이전트 작업을 하나의 실행 그래프로 설계하고, 각 노드를 실제 Orca 프로젝트·워크트리·세션·모델로 라우팅해 실행**하는 플러그인입니다. 업무 정의(Domain·Milestone·Task·Todo)와 실행 이력을 같은 화면에서 관리합니다.

## 3. 지향하는 바

**추측해서 실행하지 않습니다.** 라우팅 대상이 모호하거나 안전 계약이 충족되지 않으면 실행 전에 멈춥니다. 존재하지 않는 워크트리를 만들어 내지 않고, 지정되지 않은 세션에 작업을 보내지 않습니다.

**무슨 일이 있었는지 남깁니다.** 노드마다 어떤 세션에서 몇 번 시도해 얼마나 걸렸고 무엇을 반환했는지 기록합니다. 실패는 사유 원문과 함께 남고, 사용자가 멈춘 것은 실패가 아니라 취소로 구분합니다.

**되돌릴 수 없는 일에는 사람을 세웁니다.** 비가역 노드는 승인 게이트가 실행 경로를 지배해야 통과하며, 그 게이트는 에이전트가 대신 통과할 수 없습니다.

**로컬에서 완결됩니다.** 외부 서비스 없이 로컬 JSON만으로 전부 동작합니다. 외부 원천은 선택이며, 공개 계약을 따르는 어떤 구현과도 연결할 수 있습니다.

**파괴하지 않습니다.** hard delete 대신 보관을 씁니다. 실행 이력은 초기화해도 지난 run을 지우지 않습니다.

## 4. 그래프 편집

- Task 노드, 마름모 조건 노드, 그래프 호출 노드를 만들고 4면 포트를 드래그해 연결합니다.
- 장애물을 피하는 직교 connector, 편집 가능한 꺾임점, 분기별 색상과 Y/N 배지.
- Shift 영역 선택과 보조키 다중 선택, 정렬·균등 배치, 복사/붙여넣기/복제, 100단계 undo/redo.
- 고정한 노드와 선택 영역을 보존하는 자동 배치 미리보기.
- 확대·이동에 연동되는 모눈, semantic zoom, 정렬 가이드, 벡터 미니맵.
- `path`, `diamond`, `router`, `star`, `cycle`, `tree`, `tool-bipartite` topology 템플릿.
- 노드 검색, 그래프 호출 breadcrumb 탐색, 단축키 도움말.

엣지는 `sequence`, `blocks`, `informs`, `loop` 네 가지이고 조건 분기와 AND/OR join을 지원합니다.

## 5. 업무 관리 — Domain·Milestone·Task·Todo

데이터 원천을 연결하지 않아도 상단 메뉴의 관리 화면을 그대로 씁니다.

- Domain은 목표·제약·owner를 갖고 여러 Milestone을 포함합니다. Milestone은 반드시 한 Domain에 속합니다.
- Task와 Todo는 독립 항목일 수도, Domain이나 Milestone에 속할 수도 있습니다.
- 제목·ID·태그·사람 Draft·Meta Draft를 함께 검색하며, 상태·우선순위로 묶고 접을 수 있습니다.
- 사람 Draft를 고치면 새 immutable revision이 쌓이고 이전 Meta Draft는 지우지 않은 채 stale로 표시됩니다.
- 하나의 Task를 여러 그래프 노드에 재사용할 수 있고, 제목이나 실행 지시문이 바뀌면 연결된 노드가 함께 갱신됩니다.
- Task 상세의 `빠른 그래프 구성`은 같은 범위의 Task를 고른 순서대로 이어 그래프를 만듭니다.
- hard delete 없이 Domain/Milestone 보관, 복원 가능한 Task 보관, Todo 취소를 씁니다.

사람 Draft와 Meta Draft는 둘 다 직접 편집합니다. Meta Draft는 실행에 실제로 쓰이는 프롬프트이고, 비워 두면 사람 Draft를 그대로 보냅니다. 고칠 때마다 새 revision이 쌓입니다.

## 6. 라우팅

노드의 `project`, `branch`, `session`, `model`, `reasoning`은 필드마다 이 순서로 정해집니다.

1. 노드 값
2. 그래프 기본값
3. Orca 또는 에이전트 기본값

기존 세션을 고르면 그 세션의 프로젝트·워크트리·브랜치가 실제 실행 위치가 됩니다. 이때 model은 세션의 에이전트 종류와 호환되는지만 검사하고 실행 중인 model을 바꾸지 않습니다. 세션 없이 프로젝트와 브랜치를 고르면 그 브랜치의 기존 Orca 워크트리에 새 에이전트 터미널을 만듭니다. **없는 워크트리를 플러그인이 만들어 내지는 않습니다.**

새 세션의 reasoning은 모델 catalog가 선언한 값만 고를 수 있습니다. Claude CLI는 `--effort`, Codex는 `model_reasoning_effort`로 받습니다. catalog에 없는 값은 터미널을 만들기 전에 거절합니다.

## 7. 실행

`▶ 실행`은 **대상 프로젝트의 Orca 세션에 작업을 전달**합니다. 기존 세션을 고르면 그 세션에, 워크트리를 고르면 그 체크아웃에 claude/codex 세션을 새로 띄워 프롬프트를 넣습니다.

**실행 대상 고르기** — 실행 창은 Orca 사이드바와 같은 묶음으로 보여 줍니다: 머신 → 프로젝트 → 워크트리. 고르는 단위는 워크트리이고, 핀·활성·열린 터미널 수가 Orca와 같은 순서로 붙습니다. 다른 머신의 워크트리를 고르면 실행 머신이 그쪽으로 옮겨 갑니다 — 한 번의 실행은 한 머신에서 돕니다.

**통합 · 프로젝트별** — 워크트리를 둘 이상 고르면 배정 방식을 고를 수 있습니다. 통합은 세션과 모델을 한 곳에서 정해 첫 워크트리에서 한 번 돌고, 프로젝트별은 워크트리마다 세션·모델·reasoning을 따로 정해 각각 실행합니다.

**승인 없이 실행** — 새로 여는 세션은 기본적으로 권한·승인 질문을 끄고 띄웁니다(claude `--permission-mode bypassPermissions`, codex `-a never --dangerously-bypass-approvals-and-sandbox`). 사람이 지켜보지 않는 세션이 승인 프롬프트에서 멈추면 원격 실행이 성립하지 않기 때문입니다. 실행 창에서 끄면 그 세션은 평소처럼 물어봅니다.

그 다음 진행은 세션의 에이전트가 소유합니다. 그래프의 노드를 순서대로 도는 것도, 조건을 판정하고 결과를 기록하는 것도 에이전트가 합니다. **플러그인 안에 별도 실행기는 없습니다.**

이 경계를 택한 이유는 단순합니다. 패널에는 세션에서 돌아오는 채널이 없습니다. 진행률을 추정하거나 완료를 짐작해 보여 주면, 확인되지 않은 것을 사실로 표시하게 됩니다.

**실행 전 차단** — 그래프 구조 오류와 연결 오류만 실행을 막습니다. 실행 대상이나 모델을 고르지 않은 것은 별도의 실행 설정 문제로 표시합니다.

**결과 계약** — 전달하는 프롬프트는 마지막 응답 첫 줄에 `RESULT: done` 또는 `RESULT: failed — <이유>`를 남기도록 요청합니다.

**세션이 뜨지 않으면 보내지 않습니다** — 에이전트는 `exec`로 띄웁니다. 명령이 잘못되어 즉시 죽으면 셸이 남지 않고 터미널이 함께 닫히므로, 프롬프트가 에이전트 대신 셸에 타이핑되는 일이 없습니다. 보내기 직전에 세션이 살아 있는지 확인하고, 죽어 있으면 그 화면의 마지막 줄을 이유와 함께 알립니다.

**실행 현황** — 카드를 누르면 그 실행의 상세가 열립니다. 보낸 프롬프트 전문, 대상별 세션 상태(작업 중·대기·닫힘)와 그 세션 화면의 마지막 줄, 같은 항목의 이전 실행이 함께 보입니다. 세션 상태는 마지막 `Orca 대상 갱신` 시점의 관측값입니다.

**초기화** — `↺ 실행 초기화`는 노드와 연결을 그대로 두고 실행 상태만 되돌립니다. 지난 run 이력은 지우지 않습니다. 저장하면 데이터 원천에도 반영됩니다.

## 8. 실행 현황

`실행 현황`은 **패널이 무엇을 어디로 언제 보냈는지**를 보여 주는 로그 화면입니다. 항목마다 그래프·Task 이름, 대상 프로젝트와 브랜치, 기존 세션인지 새 세션인지, 보낸 시각이 남습니다.

같은 화면에서 그래프에 기록된 run 이력도 함께 봅니다. 원천이 노드별 결과를 남기면 회차·상태·업무 입력 원문과 노드별 상태·시도 횟수·소요 시간·실패 사유까지 펼쳐집니다.

이 화면은 어떤 연결도 요구하지 않고, 폴링하지도, 별도 탭을 열지도 않습니다. dispatch 기록은 이 장치의 로컬 파일에만 최대 200건 남고 그래프 데이터나 외부 원천에 섞이지 않습니다.

## 9. 그래프에서 그래프 호출

`graph_call` 노드는 보관되지 않은 다른 그래프를 자식으로 부릅니다. 호출 순환, 없는 대상, 보관된 대상은 실행 전에 차단합니다. 기본 재귀 깊이는 8이며 루트 그래프에서 바꿀 수 있습니다.

라우팅 결합 정책은 `자식 그래프 설정만`, `부모를 채우고 자식 우선`, `호출 노드 값 우선` 세 가지입니다. 자식 내부에서는 언제나 자식 노드 값이 최종 우선입니다. 자식 run에는 부모 run·그래프·노드가, 부모 run에는 자식 run 목록이 기록됩니다.

## 10. 데이터 원천 연결

`구조화 Workspace`는 공개 Data Source contract v1을 따르는 어떤 HTTP 구현과도 연결됩니다. 계약은 [docs/data-source-contract.md](docs/data-source-contract.md)에 있습니다.

인증 토큰 값은 저장하지 않습니다. 저장 명령을 보낼 터미널에 토큰을 환경변수로 두고, UI에는 그 **환경변수 이름만** 입력합니다. 연결 snapshot은 교체 가능한 `source-cache.json`에 저장되며 Git과 배포 패키지에서 제외됩니다.

노드 단위 실행 계약(`role`, `maxAttempts`, `permissions`, `dataClass`, `idempotencyKey`, `timeoutSeconds` 등)은 Graph aggregate로 왕복하지만 계약상 provider가 무시해도 됩니다. 저장 직후 원천이 그 값을 돌려주지 않으면 무엇이 보존되지 않았는지 알립니다 — 그 노드의 승인 게이트·재시도·권한 검사는 실행 시 적용되지 않습니다.

## 11. 환경변수

| 이름 | 기본값 | 뜻 |
| --- | --- | --- |
| `ORCA_GRAPH_RUNTIME_DIR` | Orca 앱 데이터 | 저장 상태 위치 |
| `ORCA_GRAPH_PANEL_PATH` | 이 패키지의 `dist/panel.html` | 스냅샷을 실을 패널 파일 |
| `ORCA_GRAPH_LOCAL_ENVIRONMENT_NAME` | 호스트 이름 | 이 장치의 표시 이름 |
| `ORCA_CLI_COMMAND` | 플랫폼 기본값 | Orca CLI 실행 파일 |
| `ORCA_GRAPH_WORKSPACE_BASE_URL` | 없음 | 구조화 원천 base URL (HTTPS) |
| `ORCA_GRAPH_WORKSPACE_ENVIRONMENT` | 호스트 이름 | 이 장치의 실행 환경 이름 |
| `ORCA_GRAPH_PRIMARY_ENVIRONMENT` | 이 장치 | 프로젝트 registry의 기준 장치 |
| `ORCA_GRAPH_WORKSPACE_API_PATH` | `/api/plugins/orca-graph-engineering` | 원천 API 경로 |
| `ORCA_GRAPH_WORKSPACE_CLIENT_HEADER` | `X-Orca-Graph-Client` | 클라이언트 식별 헤더 이름 |
| `ORCA_GRAPH_WORKSPACE_SESSION_TOKEN_VAR` | 없음 | base page의 세션 토큰 전역 변수. 설정해야 bootstrap을 시도합니다 |
| `ORCA_GRAPH_WORKSPACE_SESSION_HEADER` | `X-Session-Token` | 세션 토큰 헤더 이름 |

원천 연결에 필요한 값은 전부 위 환경변수로 받습니다. 플러그인 소스에는 특정 배포처의 주소·이름·토큰 규칙이 들어 있지 않으며, 설정하지 않은 기능은 켜지지 않습니다. 장치 이름도 코드가 아는 목록이 아니라 사용자가 정한 값과 원천 registry에서 옵니다.

## 12. 알려진 경계

이 경계들은 대부분 Orca 플러그인 API v1이 패널에 허용하는 것에서 곧바로 나옵니다.

- **전달 후에는 관측할 수 없습니다** — 패널에는 세션에서 돌아오는 채널이 없습니다. 진행률·완료 여부는 각 Orca 세션에서 직접 확인하십시오. 실행 현황은 보낸 사실만 기록합니다.
- **저장에는 터미널이 필요합니다** — 패널 iframe은 `connect-src 'none'`이고 `storage` 호스트 API는 패널에 열려 있지 않습니다. 파일을 쓸 수 있는 통로가 `terminal.sendText` 하나뿐입니다.
- **최신 데이터는 패널을 다시 열 때 반영됩니다** — 저장·다시 읽기 명령이 `dist/panel.html`의 bootstrap을 갱신하고, Orca는 패널을 열 때 그 파일을 다시 읽습니다.
- **중단 기능이 없습니다** — 이미 세션에 들어간 프롬프트는 되돌릴 수 없습니다. 멈추려면 해당 Orca 세션에서 직접 중단하십시오.
- **routine scheduler** — 아직 메타데이터입니다.

## 개발

```bash
corepack npm run check      # typecheck + test + build
corepack npm run typecheck
corepack npm test
corepack npm run build
```

기여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md), 취약점 신고는 [SECURITY.md](SECURITY.md), 내부 구조는 [docs/architecture.md](docs/architecture.md)를 보십시오.

## 라이선스

MIT
