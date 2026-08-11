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

### 준비 사항 — 브리지

패널은 Orca 플러그인 API v1의 sandbox 안에서 돕니다. 파일을 저장하거나 에이전트 터미널을 만들려면 **로컬 브리지**가 필요합니다.

1. 이 저장소 디렉터리에서 Orca 터미널을 하나 엽니다.
2. 그 터미널에서 브리지를 실행합니다.

```bash
node ./bridge/index.mjs
```

3. 패널 상단에서 그 터미널을 브리지로 지정합니다.
4. `Graph Engineering bridge ready`가 보이면 준비 완료입니다. 플러그인을 쓰는 동안 이 터미널은 열어 둡니다.

브리지 없이도 그래프를 그리고 살펴볼 수 있지만, 저장·실행·Meta Prompt 생성은 되지 않습니다.

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

`Meta Prompt 만들기`는 선택한 브리지 워크트리에 새 에이전트 세션을 만들어, 내장된 공개 프롬프트 계약으로 실행용 프롬프트를 생성합니다. 고정된 9개 섹션 구조를 통과하고 그 사이 사람 Draft가 바뀌지 않았을 때만 저장합니다.

## 6. 라우팅

노드의 `project`, `branch`, `session`, `model`, `reasoning`은 필드마다 이 순서로 정해집니다.

1. 노드 값
2. 그래프 기본값
3. Orca 또는 에이전트 기본값

기존 세션을 고르면 그 세션의 프로젝트·워크트리·브랜치가 실제 실행 위치가 됩니다. 이때 model은 세션의 에이전트 종류와 호환되는지만 검사하고 실행 중인 model을 바꾸지 않습니다. 세션 없이 프로젝트와 브랜치를 고르면 그 브랜치의 기존 Orca 워크트리에 새 에이전트 터미널을 만듭니다. **없는 워크트리를 플러그인이 만들어 내지는 않습니다.**

새 세션의 reasoning은 모델 catalog가 선언한 값만 고를 수 있습니다. Claude CLI는 `--effort`, Codex는 `model_reasoning_effort`로 받습니다. catalog에 없는 값은 터미널을 만들기 전에 거절합니다.

## 7. 실행

`▶ 실행`은 라우팅과 안전 계약을 먼저 검사하고, 통과한 것만 Orca 터미널로 보냅니다. dry-run 계획은 Orca도 원천도 건드리지 않습니다.

**실행 전 차단** — 구조 오류, 라벨 없는 조건 분기, 위험 권한 조합, 민감 데이터의 network 정책 위반, idempotency key 누락, 승인 게이트 누락, 토큰 예산 초과, 사용할 수 없는 워크트리·세션.

**에이전트 결과 계약** — 배정된 에이전트는 마지막 응답 첫 줄에 `RESULT: done` 또는 `RESULT: failed — <이유>`를 남깁니다. 굵게 쓰거나 목록 기호가 붙어도 같게 읽습니다. 결과 줄이 아예 없는 응답은 기본적으로 성공으로 보며, `ORCA_GRAPH_REQUIRE_RESULT_CONTRACT=1`을 켜면 그것도 실패로 닫습니다.

**일시적 실패 회복** — 대화형 에이전트 터미널은 Orca 메인 창 렌더러가 준비된 상태에서만 만들 수 있습니다. 브리지는 `orca status`를 먼저 확인하고 일시적 실패에 한해 지수 백오프로 다시 시도합니다(기본 90초). 일시적이지 않은 실패는 기다리지 않고 보고합니다.

**재시도** — 노드의 재시도 예산만큼 다시 보냅니다. 실패한 턴을 남긴 세션은 재사용하지 않고 그 경로의 세션만 새로 만듭니다. 다른 경로의 세션과 문맥 연속성은 유지됩니다.

**가드** — run 시간 한도를 노드 경계에서 검사합니다. 승인 게이트는 사람 승인 없이 통과하지 않습니다.

**중단** — 진행 중인 실행에 `■ 실행 중단`이 있습니다. 노드 경계에서 관측되므로 진행 중인 노드가 끝난 뒤 멈추며, 이미 보낸 에이전트 작업은 되돌리지 않습니다. 에이전트 턴을 중간에 끊으면 원격 노드가 점유된 채 남기 때문에 이 경계를 택했습니다. 중단으로 끝난 실행은 실패가 아니라 취소로 기록하며, `graph_call`로 들어간 자식 그래프도 같은 경계에서 멈춥니다.

**초기화** — `↺ 실행 초기화`는 노드와 연결을 그대로 두고 실행 상태만 되돌립니다. 지난 run 이력은 지우지 않습니다. 실행 중에는 거절하며 먼저 중단해야 합니다.

## 8. 실행 현황과 이력

`실행 현황`은 실행 레코드와 함께 **노드별 진행 경과**를 보여 줍니다. run마다 회차·상태·집계·업무 입력 원문이 있고, 노드마다 상태·시도 횟수·소요 시간·실행된 Orca 세션·결과 또는 실패 사유 원문이 나옵니다. 캔버스 노드에 마우스를 올리면 같은 내용이 툴팁으로 뜹니다.

실행 레코드는 앱 데이터의 `executions.json`에만 저장되고 그래프 데이터나 외부 원천에 섞이지 않습니다. 브리지를 다시 시작하면 끝나지 않은 레코드를 실패로 마감해 유령 상태를 남기지 않습니다.

## 9. 그래프에서 그래프 호출

`graph_call` 노드는 보관되지 않은 다른 그래프를 자식으로 부릅니다. 호출 순환, 없는 대상, 보관된 대상은 실행 전에 차단합니다. 기본 재귀 깊이는 8이며 루트 그래프에서 바꿀 수 있습니다.

라우팅 결합 정책은 `자식 그래프 설정만`, `부모를 채우고 자식 우선`, `호출 노드 값 우선` 세 가지입니다. 자식 내부에서는 언제나 자식 노드 값이 최종 우선입니다. 자식 run에는 부모 run·그래프·노드가, 부모 run에는 자식 run 목록이 기록됩니다.

## 10. 데이터 원천 연결

`구조화 Workspace`는 공개 Data Source contract v1을 따르는 어떤 HTTP 구현과도 연결됩니다. 계약은 [docs/data-source-contract.md](docs/data-source-contract.md)에 있습니다.

인증 토큰 값은 저장하지 않습니다. 브리지를 실행할 터미널에 토큰을 환경변수로 두고, UI에는 그 **환경변수 이름만** 입력합니다. 연결 snapshot은 교체 가능한 `source-cache.json`에 저장되며 Git과 배포 패키지에서 제외됩니다.

노드 단위 실행 계약(`role`, `maxAttempts`, `permissions`, `dataClass`, `idempotencyKey`, `timeoutSeconds` 등)은 Graph aggregate로 왕복하지만 계약상 provider가 무시해도 됩니다. 저장 직후 원천이 그 값을 돌려주지 않으면 무엇이 보존되지 않았는지 알립니다 — 그 노드의 승인 게이트·재시도·권한 검사는 실행 시 적용되지 않습니다.

## 11. 환경변수

| 이름 | 기본값 | 뜻 |
| --- | --- | --- |
| `ORCA_GRAPH_RUNTIME_DIR` | Orca 앱 데이터 | 브리지 상태 저장 위치 |
| `ORCA_GRAPH_TERMINAL_CREATE_TIMEOUT_MS` | `90000` | 터미널 생성 재시도 예산 |
| `ORCA_GRAPH_AGENT_READY_TIMEOUT_MS` | `60000` | 새 에이전트 세션 준비 대기 |
| `ORCA_GRAPH_WORK_ITEM_TIMEOUT_SECONDS` | `900` | Task·Todo 단건 실행 제한 시간 |
| `ORCA_GRAPH_REQUIRE_RESULT_CONTRACT` | 꺼짐 | 결과 줄 없는 응답을 실패로 처리 |
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

- **loop 엣지 실행** — 편집·검사·계획까지만 제공하고 live 실행은 차단합니다. routine scheduler도 아직 메타데이터입니다.
- **원격 `graph_call`** — 구조화 원천 실행에서는 자식 그래프 run 계약이 없어 차단합니다. 자식 그래프를 직접 실행하거나 로컬·폴더 원천을 쓰십시오.
- **중단 지점** — 노드 경계에서만 관측됩니다. Task·Todo 단건 실행은 dispatch가 하나뿐이라 중단 지점이 없습니다.
- **넓게 보기 탭** — 공식 editor contribution이 아니라, 사용자가 실행한 로컬 브리지가 loopback 주소를 Orca 브라우저 탭에 여는 호환 계층입니다.

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
