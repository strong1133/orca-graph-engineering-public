# Orca Graph Engineering

Orca 안에서 실행 그래프를 설계하고 Task·Todo를 관리하며 각 업무를 Orca 프로젝트, 워크트리, 기존 세션, 모델로 라우팅하는 오픈소스 플러그인입니다. 외부 서비스 없이 로컬 JSON만으로 완전히 동작하고, 선택적으로 공개 Data Source contract나 임의 JSON을 연결할 수 있습니다.

## 주요 기능

- Task, 마름모 condition, graph-call 노드의 생성·편집과 포트 드래그 연결, 빈 캔버스 즉시 생성
- 실제 SVG 도형, 4면 연결 포트, 장애물 회피 직교 connector, 편집 가능한 꺾임점·시작/도착, 색상별 화살촉과 Y/N 분기 배지
- Shift 영역/보조키 다중 선택, 정렬·균등 배치·일괄 라우팅, 복사/붙여넣기/복제, 100단계 undo/redo
- 고정 노드와 선택 영역을 보존하는 자동 배치 미리보기, Domain·Milestone·superstep·loop 파생 그룹 프레임
- 확대·이동에 연동되는 점·주요선 모눈, semantic zoom, 정렬 가이드, 벡터 미니맵과 선택 노드 중앙 맞춤
- 설계/실행 보기 분리, 기본·Task·실행·안전 Inspector 탭, 선택 문맥 툴바와 구조 Problems 패널
- 그래프 호출 breadcrumb 탐색, 노드 검색, 단축키 도움말, 대형 그래프 드래그·이동 중 DOM 직접 갱신
- Domain→Milestone→Task/Todo 업무 계층과 Domain·Milestone 독립 관리 화면
- Task/Todo 목록의 Draft·Meta·Domain·Milestone 통합 검색, 범위·상태 필터, Task의 Domain→Milestone 및 Todo의 그룹→하위그룹 기본 계층, 상태/우선순위 그룹화·개별/전체 접기·펼치기와 정렬
- 사람 Draft와 Meta Draft의 분리 저장, revision lineage, stale 감지, 자체 포함형 Meta Prompt 생성
- 독립적인 Task/Todo 상태·우선순위·마감일·태그 관리와 Todo→Task 전환
- 하나의 Task를 여러 그래프 노드에 연결하고 관리 화면에서 연결 위치로 이동
- sequence, blocks, informs, loop 엣지와 조건 분기, AND/OR join
- 그래프 목록 검색, lifecycle·실행 단계 필터, 정렬, color dot, 상태 badge, 진행률
- 그래프 생성, 복제, 보관, 초기화, pin, routine 메타데이터, JSON import/export
- 🧭 업무프로세스 그래프, 실행별 원문 업무 입력과 회차별 입력 이력
- 그래프와 노드의 project, Orca worktree branch, session, model, reasoning 라우팅
- 장치의 Orca repo registry 게시, Task 대상 folder 프로젝트 감지·확인 연결과 작업 브랜치 편집
- path, diamond, router, star, cycle, tree, tool-bipartite topology template
- superstep, critical path, 병렬 writer/reducer, loop guard, 예산, 권한, provenance 검사
- retry, timeout, idempotency, compensation, human gate, 실행 이력
- 그래프에서 다른 그래프를 호출하는 재귀 실행, 라우팅 결합 정책, 실패 전파 정책, 부모/자식 run lineage
- 좁은 우측 패널과 Orca 중앙 탭 넓게 보기, `목록 보기`/`그래프 보기` FAB

## 로컬 Domain·Milestone·Task·Todo 관리

상단 메뉴의 `Domain 관리`, `Milestone 관리`, `Task 관리`, `Todo 관리`는 데이터 원천을 연결하지 않아도 사용할 수 있습니다. 업무 데이터는 Graph와 함께 `runtime/store.json`에 저장되며 다음 관계를 가집니다.

- Domain은 목표, 공통 메모, 제약사항과 owner를 가지며 여러 Milestone을 포함합니다. Milestone은 반드시 하나의 Domain에 속하고 목표, 성공 기준, 상태, 우선순위, 마감일을 가집니다.
- Task와 Todo는 독립 항목일 수도 있고 Domain 또는 같은 Domain의 Milestone에 속할 수도 있습니다. Milestone을 선택하면 Domain이 자동으로 일치하며, 연결된 업무가 있는 Milestone의 Domain은 임의로 바꿀 수 없습니다.
- Task/Todo 검색은 제목·ID·태그·사람 Draft·Meta Draft를 함께 찾고, Task는 Domain/Milestone, Todo는 그룹/하위그룹 이름까지 검색합니다. Task는 기본적으로 Domain→Milestone, Todo는 원천의 그룹→하위그룹별로 묶이며 상태와 우선순위 그룹으로 바꿀 수 있습니다. Todo 그룹 계층은 실행 scope인 Domain/Milestone과 독립적입니다. Todo는 원천 화면과 같은 활성 상태(할 일·진행 중)를 기본으로 표시하며, 완료·취소 이력은 `모든 상태` 또는 개별 상태 필터에서 확인할 수 있습니다.
- 사람 Draft를 고치면 새 immutable revision을 추가하고 이전 Meta Draft는 삭제하지 않은 채 stale로 표시합니다. `Meta Prompt 만들기`는 선택된 Orca bridge worktree에 새 Codex 세션을 만들고 플러그인에 내장된 공개 prompt 계약으로 결과를 생성합니다. Task의 project 관계도 정렬된 context로 전달하며 target locator가 빠진 결과는 9개 H1 구조를 유지한 채 `작업 컨텍스트` 안에 결정적으로 보강합니다. 결과가 고정 9개 섹션 계약을 통과하고 실행 중 사람 Draft revision이 바뀌지 않았을 때만 Meta Draft로 저장합니다.
- 하나의 Task를 여러 Graph의 Task 노드에 재사용할 수 있습니다. 최신 Meta Draft가 있으면 실행 payload로 사용하고, 없거나 stale이면 현재 사람 Draft를 사용합니다. 제목이나 유효 실행 지시문이 바뀌면 연결된 모든 노드도 함께 갱신됩니다.
- Task·Todo 목록의 ⚡ 버튼과 상세의 `워크트리 빠른 실행`은 그래프를 만들지 않고 현재 Meta Draft 또는 사람 Draft를 단건으로 보냅니다. 실행 전에 연결된 Orca 환경, 그 환경의 project·실제 Orca worktree branch·기존 session, AI model, reasoning을 고르며 그래프 run·node claim이나 원천 상태 변경은 만들지 않습니다. 현재 활성 Orca worktree를 먼저 감지하며 구조화 Workspace Task에 target folder가 없으면 사용자가 확인한 프로젝트 하나와 브랜치를 실행 직전에 기존 Task project 관계에 CAS로 추가합니다. Todo 실행은 Todo 관계나 상태를 변경하지 않습니다. 연결된 Task target folder와 branch는 단건 실행과 해당 Task를 쓰는 그래프 노드의 기본 추천이 되며, 정확한 기존 Orca worktree가 없으면 실행 전에 차단합니다. 로컬 환경 이름은 `ORCA_GRAPH_LOCAL_ENVIRONMENT_NAME`으로 지정할 수 있고 저장된 원격 Orca 환경은 대상 갱신 때 자동으로 합쳐집니다.
- Todo는 워크트리에 직접 빠른 실행할 수 있고, 선택적으로 Task에 연결하거나 새 Task로 전환할 수도 있습니다. 전환 뒤에도 원래 Todo는 보존되고 Domain·Milestone과 Prompt revision lineage도 새 Task에 복사됩니다.
- hard delete 대신 Domain/Milestone 보관, 확인 창이 있는 `Task 삭제`(복원 가능한 보관), Todo 취소를 사용합니다. 활성 하위 Milestone·Task·Todo가 남은 Domain이나 Milestone은 보관할 수 없습니다.

기존 Graph에 이미 들어 있던 Task는 처음 열 때 로컬 Task 목록과 사람 Draft revision에 자동 편입됩니다. `로컬 JSON`과 `구조 없음` 모드에서는 로컬 저장소를 직접 편집합니다. 양방향 capability를 제공하는 `구조화 Workspace`에서는 같은 관리 GUI가 Domain·Milestone·Task·Todo·Draft/Meta revision을 원천에 CAS 저장하고, 성공 직후 정본 snapshot으로 교체합니다. 파일 영속화와 Meta Prompt 생성에는 로컬 브리지가 필요하지만 별도의 데이터 원천 서버는 필요하지 않습니다.

## 그래프 라우팅

일반 Task 노드의 `project`, `branch`, `session`, `model`, `reasoning`은 필드별로 계산합니다.

1. 노드 값
2. 그래프 기본값
3. Orca 또는 에이전트 기본값

기존 session은 실제 실행 위치와 branch를 결정합니다. 이때 model 값은 session agent family와의 호환성 제약으로만 검사하며 실행 중인 model을 바꾸지 않습니다. 기존 session의 현재 effort를 조회하거나 변경하는 공개 primitive가 없으므로 reasoning 값이 있으면 계획과 실행을 모두 사전 거절합니다. reasoning을 비우면 session의 현재 effort를 그대로 유지합니다. session 없이 project와 branch를 선택하면 그 branch의 기존 Orca-managed worktree에 새 에이전트 terminal을 만듭니다. 아직 Orca worktree가 없는 임의 branch를 플러그인이 묵시적으로 만들지는 않습니다.

새 session의 reasoning은 model catalog에 선언된 capability만 선택할 수 있습니다. Claude CLI는 `low`, `medium`, `high`, `xhigh`, `max`를 `--effort`로 받습니다. Codex는 Sol/Terra에서 `low`부터 `ultra`까지, Luna에서 `low`부터 `max`까지를 `model_reasoning_effort`로 받습니다. catalog에 없거나 model이 지원하지 않는 값은 terminal 생성 전에 fail-closed합니다.

## 그래프 → 그래프

`graph_call` 노드는 보관되지 않은 다른 그래프를 자식으로 선택합니다. 호출 순환, 누락된 대상, 보관된 대상은 계획과 실행 전에 차단합니다. 기본 재귀 깊이는 8이며 루트 그래프의 `탐색 hop 제한`으로 바꿀 수 있습니다.

라우팅 결합 정책은 세 가지입니다.

- `자식 그래프 설정만`: 자식 그래프 기본값 사용
- `부모를 채우고 자식 우선`: 부모와 호출 노드 값을 빈칸의 기본값으로 사용하고 자식 값 우선
- `호출 노드 값 우선`: 부모와 자식 값을 합친 뒤 호출 노드 값 우선

자식 그래프 내부에서는 각 자식 노드의 값이 언제나 최종 우선순위입니다. 자식 run에는 `parentRunId`, `parentGraphId`, `parentNodeId`가, 부모 run에는 `childRunIds`가 기록됩니다. 실패 정책은 부모 실패 또는 실패 기록 후 계속 중에서 선택합니다.

## 개발 설치

요구 사항은 Orca `1.4.176+`와 Node.js `22+`입니다.

```bash
corepack enable
corepack install
corepack npm ci
corepack npm run check
```

Orca의 Settings → Plugins에서 Plugin system을 켜고 Development plugin 경로로 이 저장소 루트를 추가합니다. 플러그인 패널에서 다음 순서로 로컬 브리지를 연결합니다.

1. `브리지`를 누릅니다.
2. 현재 Orca worktree의 쓰기 가능한 shell terminal을 고릅니다.
3. `브리지 시작`을 누르고 terminal을 열어 둡니다.
4. `저장` 후 `대상 새로고침`으로 Orca project/session 목록을 불러옵니다.

브리지는 Git에서 제외된 `runtime/`의 로컬 상태와 생성된 `dist/`만 사용합니다. 사이드바가 좁으면 상단 `⛶`로 같은 편집기를 Orca 중앙 탭에 엽니다.

## 데이터 원천 연결

상단 `데이터 원천`에서 다음 네 모드를 선택할 수 있습니다.

- `로컬 JSON`: 기존처럼 Graph를 `runtime/store.json`에 저장합니다.
- `폴더 / 로컬 Git 저장소`: 이미 존재하는 절대 경로 아래 `.orca-graph-engineering/store.json`에 Graph·Domain·Milestone·Task·Todo를 함께 저장합니다. 파일이 없으면 현재 화면의 데이터를 최초 정본으로 만들고, 이후 `새로고침`은 Git pull이나 외부 편집으로 바뀐 파일을 다시 읽습니다. Git commit·push는 자동 실행하지 않습니다.
- `구조화 Workspace`: [Data Source contract v1](docs/data-source-contract.md)을 구현한 서버의 Graph·Domain·Milestone·Task·Todo·Prompt lineage와 CAS 버전을 원격 정본으로 사용합니다. Graph aggregate와 플러그인 지원 업무 필드는 모두 양방향이며 stale version은 409로 거절되고 자동 재시도하지 않습니다.
- `구조 없음`: 임의 JSON의 레코드 배열을 자동 탐색하거나 필드 경로를 지정해 읽기 전용 Task 후보로 사용합니다. 쓰기/CAS 계약이 없으므로 Graph 정본은 로컬에 남습니다.

인증 토큰 값은 저장하지 않습니다. 브리지를 시작할 terminal에 토큰을 환경변수로 설정하고 UI에는 그 환경변수 이름만 입력합니다. 연결 snapshot은 교체 가능한 `runtime/source-cache.json`에 저장되며 Git과 배포 package에서 제외됩니다. 폴더 모드는 단일 사용자 파일 저장 방식이라 분산 CAS를 제공하지 않으며, 같은 파일을 여러 프로세스가 동시에 수정하지 않는 것을 전제로 합니다.

### 호환 Workspace aggregate API

업무프로세스 run과 장치별 repo registry, Task project 관계를 제공하는 호환 Workspace에 연결할 때 bridge terminal에 다음 공개 설정을 둡니다.

```bash
export ORCA_GRAPH_WORKSPACE_BASE_URL="https://your-workspace.ts.net"
export ORCA_GRAPH_WORKSPACE_ENVIRONMENT="정석맥1" # 정석맥1 | 정석맥2 | Hermes
export ORCA_GRAPH_WORKSPACE_CLIENT_ID="orca-graph-engineering"
```

기본 API prefix가 다른 호환 서버는 `ORCA_GRAPH_WORKSPACE_API_PATH`로 바꿀 수 있습니다. 브리지는 base page에서 짧은 session bootstrap을 얻고 값을 파일·Graph·로그에 남기지 않습니다. 기동 시 `orca repo list --json`의 repo ID, 표시 이름, 로컬 경로, kind, canonical remote를 `PUT /orca-projects/{environment}`에 전체 교체 게시합니다. 이후에는 사용자가 `대상 새로고침`을 실행한 변경 이벤트에서만 다시 비교하며 같은 payload는 보내지 않아 주기 polling을 만들지 않습니다.

구조화 snapshot이 업무프로세스 확장을 아직 직접 투영하지 않더라도 aggregate Graph 조회의 `process_enabled`, `current_run.input_prompt`, `recent_runs[].input_prompt`를 같은 CAS 정본에서 보강합니다. 새 업무프로세스 run은 입력이 비어 있으면 시작할 수 없고, 재개는 저장된 입력을 읽기 전용으로 표시합니다. 클라이언트는 입력 문자열을 trim하거나 줄바꿈을 바꾸지 않고 요청 JSON에 그대로 넣습니다.

## 배포 artifact

이 프로젝트의 npm tarball은 TypeScript, bridge, 테스트, 문서를 전달하는 **source-only package**입니다. `npm pack`에는 `orca-plugin.json`이 들어가지만 생성물인 `dist/panel.html`은 들어가지 않으므로 그 tarball 자체를 Orca 설치물로 사용하지 않습니다.

Orca에서 바로 읽을 수 있는 별도 plugin bundle은 다음 명령으로 만듭니다.

```bash
corepack npm run package:plugin
# release/orca-graph-engineering-plugin-0.2.0.tgz
```

bundle에는 manifest가 선언한 `dist/panel.html`, bridge, source, fixture, tests, CI와 `npm-shrinkwrap.json`이 함께 들어갑니다. 빌드는 공개 fixture만 사용하고 contributor의 절대 경로를 넣지 않습니다. 압축을 푼 `package/` 디렉터리는 추가 설치 없이 Orca Development plugin 경로로 사용할 수 있으며 기본 bridge의 ping, 저장, reload도 Node.js 내장 모듈과 이미 번들된 panel만 사용합니다. 저장 시 TypeScript를 다시 compile하지 않고 `dist/panel.html`의 안전한 JSON bootstrap만 원자적으로 갱신합니다. `corepack npm ci && corepack npm run check`는 기여자용 전체 source/test 재검증 경로이지 plugin 사용 전제조건이 아닙니다. 브리지를 선택할 때는 plugin root에서 열린 shell terminal을 사용해야 portable `node ./bridge/index.mjs` 시작 명령이 정확히 동작합니다.

artifact를 만들지 않고 내용 계약만 검사하려면 `corepack npm run package:plugin -- --dry-run`을 사용합니다. 만들어진 tgz 자체를 독립적으로 검사하려면 `corepack npm run verify:plugin -- release/orca-graph-engineering-plugin-0.2.0.tgz`를 실행하십시오. plugin tar는 정렬된 경로, 고정 timestamp/owner/mode와 canonical gzip header로 생성되며 npm의 `pack` 구현에 의존하지 않습니다. CI는 실제 tgz를 dependency install 전에 추출해 manifest schema, entry, 금지 경로, bridge ping과 realistic save/`dist/panel.html` 갱신을 확인합니다. 그 뒤 pinned `corepack npm ci`/`corepack npm run check`를 별도로 확인하고, 별도 clean directory의 npm 10/11 결과가 byte-for-byte 같은지도 비교합니다. 일부 Node 배포는 기존 bare `npm`을 Corepack shim으로 바꾸지 않으므로 재현 가능한 명령은 `corepack npm ...` 형식을 사용합니다.

## 안전한 실행

그래프 보기 상단의 고정 `실행` 버튼에서 기본 project/session/model/reasoning과 노드별 override를 함께 설정할 수 있습니다. 현재 브리지 작업공간과 이름이 같은 project가 하나뿐이면 새 session 대상으로 제안하고, Task와 자동 condition evaluator가 실제로 사용할 대상을 실행 전에 한 화면에서 보여 줍니다. `실행 계획`과 실제 `실행`은 선택된 condition branch 또는 런타임 자동 판정, AND/OR join과 graph-call routing 결합을 따라 전체 execution plan을 먼저 계산하고, 선택된 모든 descendant Task와 자동 condition evaluator의 pure route를 같은 resolver로 검사합니다. graph-call 순환·누락·보관·root hop limit, session/project/worktree, model allow-list/agent family/reasoning capability를 어떤 run record나 Orca call보다 먼저 검사하므로 invalid dry-run도 run history를 남기지 않습니다. dry-run이 생략하는 것은 `worktree ps`, `terminal list`, `terminal wait` 같은 live attestation과 terminal mutation뿐이며 성공한 pure plan은 Orca call 0회로 planned run을 기록합니다.

구조 오류, 존재하지 않는 조건 분기, 위험 권한 조합, loop guard 누락, idempotency·승인 gate 누락, 민감/제한 데이터의 network 정책 위반, token budget 초과도 같은 경계에서 차단됩니다. 조건 분기를 비워 두면 선행 노드의 완료 결과를 별도 evaluator가 읽어 허용된 branch 중 하나를 JSON으로 판정하고, 실행 창에서 branch를 고정하면 evaluator 없이 그 경로를 사용합니다. panel의 실행 modal은 실행 대상 문제를 엔지니어링 finding과 분리해서 보여 주고 idempotency와 sensitive-network 위반은 bridge와 같은 error로 차단합니다. 비가역 노드는 선택된 모든 non-loop 실행 경로를 지배하는 approved human gate가 있어야 하며, unrelated/downstream/pending gate는 승인 경계로 인정되지 않습니다. 로컬 브리지가 아직 지원하지 않는 loop 재진입도 live-run 전에 fail-closed로 차단하며 dry-run 계획과 정적 검사는 계속 제공합니다.

기존 session route는 일반 shell terminal에 전송하지 않습니다. Orca 1.4.176의 `worktree ps` agent pane과 `terminal list`의 tab/leaf identity가 일치하고 agent가 idle이며 `terminal wait --for tui-idle`이 성공해야만 허용합니다. 이 증명은 전체 preflight와 실제 send 직전에 반복하며, target cache가 오래됐거나 agent가 busy이거나 identity를 증명할 수 없으면 fail-closed합니다. 그런 경우 `대상 갱신` 후 다시 시도하거나 project route로 새 agent terminal을 생성하십시오. 이 이중 확인은 경쟁 구간을 줄이지만 Orca가 atomic idle-and-send를 제공하기 전까지 매우 짧은 TOCTOU 가능성은 남습니다.

```bash
npm run typecheck
npm test
npm run build
npm run check
npm run bridge
```

## Orca UI 위치

Orca plugin API v1의 `panels` contribution은 우측 activity bar에만 표시됩니다. 현재 API에는 좌측 사이드바 상단 메뉴 contribution이 없고 manifest의 `contributes` 객체도 strict schema이므로 비공식 필드를 추가할 수 없습니다. 이 플러그인은 지원되는 `blocks` 아이콘으로 우측 진입점을 표시하며, 좌측 메뉴와 중앙 editor contribution은 [upstream proposal](docs/upstream-proposal.md)에 제안 항목으로 기록합니다.

Graph Engineering을 우측 activity bar에서 한 번 선택한 뒤 Orca의 기본 `Mod+L`로 우측 패널을 빠르게 열고 닫을 수 있습니다. macOS에서는 `⌘L`, Windows/Linux에서는 `Ctrl+L`입니다. Orca API가 특정 plugin panel을 직접 선택하는 action은 아직 제공하지 않으므로, 다른 우측 탭을 선택했다면 그 탭이 열립니다.

## 편집기 빠른 사용

- 캔버스에서 노드를 한 번 클릭하면 우측 Inspector가 해당 노드의 `Task/조건/호출` 편집 탭으로 바로 열립니다. Task 탭에서 사람 Draft·Meta Prompt·Meta Draft·Domain·Milestone·상태와 Orca 프로젝트/세션/모델 override를 한 번에 관리하며, 구조화 원천의 Task도 같은 CAS 양방향 저장 경로를 사용합니다.
- `Task 관리`는 목록과 상세를 분리합니다. 목록의 Task를 누르거나 노드의 `Task 풀페이지 상세 열기`를 누르면 목록 없이 전체 상세 화면이 열리고, `← Task 목록`으로 돌아가기 전까지 상세 편집에 집중합니다.
- 그래프 설정은 캔버스를 가리지 않도록 기본으로 닫혀 있으며 툴바의 `그래프 설정`에서 명시적으로 엽니다. 그래프 설정과 노드/Task 설정은 한 번에 하나만 열리고, `×`는 다른 설정으로 전환하지 않고 Inspector를 닫습니다.
- 목록의 두 상태는 `상태 · …`(그래프 lifecycle)와 `최근 실행 · …`(최신 run)으로 구분합니다. `running` run에 30분 이상 실행 중·대기 노드가 없으면 `확인 필요`로 표시하고 `남은 실행 상태 정리`로 run을 취소 마감한 뒤 저장할 수 있습니다.
- 노드의 네 방향 포트를 끌어 다른 노드에 놓으면 바로 연결됩니다. 빈 캔버스에 놓으면 연결된 Task·Condition·Graph call을 고르는 빠른 생성 메뉴가 열리며, 빈 캔버스 우클릭으로도 같은 메뉴를 열 수 있습니다.
- `Shift` 드래그는 영역 선택, `⌘/Ctrl` 또는 `Shift` 클릭은 선택 추가/해제입니다. `⌘/Ctrl+C/V/D`, `⌘/Ctrl+Z`, `⌘/Ctrl+Shift+Z`, Delete, 방향키를 지원하며 `?`에서 전체 단축키를 확인합니다.
- 자동 정렬은 즉시 덮어쓰지 않고 미리보기를 표시합니다. 선택 노드만 정렬할 수 있고 `위치 고정` 노드는 유지됩니다.
- `설계`는 구조와 라우팅을 편집하고, `실행 보기`는 Inspector와 구조 편집을 잠근 채 상태·시도 횟수·소요 시간·오류·Human gate를 강조합니다.
- 축소하면 부가 정보가 단계적으로 사라지는 semantic zoom이 적용됩니다. `Problems`는 구조·라우팅 문제를 한곳에 모으고 항목을 누르면 해당 노드로 이동합니다.

## 현재 한계

- 중앙 탭 넓게 보기는 공식 editor contribution이 아니라 사용자가 실행한 로컬 브리지가 loopback 주소를 Orca browser tab에 여는 호환 계층입니다.
- condition 판정은 사용자가 branch label을 지정합니다.
- routine scheduler와 loop edge 재진입은 아직 편집·검사 모델만 제공합니다.
- 체크포인트, 권한, provenance의 일부는 선언과 사전 검사 단계이며 Orca가 결과·사용량 API를 제공해야 완전하게 강제할 수 있습니다.
- 로컬 단일 사용자 저장소는 분산 CAS/claim을 제공하지 않습니다.
- 구조화 원천의 기존 Domain·Milestone·Task·Todo·Draft/Meta는 capability가 켜져 있으면 플러그인에서도 편집할 수 있습니다. 원천 고유의 Reference·Journal·Execution 같은 메뉴까지 복제하지 않습니다.
- Data Source contract v1은 분산 실행 claim/complete를 아직 정의하지 않습니다. 구조화 원천 연결 중 실제 실행은 원천 Workspace에서 시작하며 로컬 브리지는 실행 상태가 갈라지지 않도록 fail-closed합니다.

설계는 [Architecture](docs/architecture.md), Orca 제안은 [Upstream proposal](docs/upstream-proposal.md), 책의 장별 반영 검수는 [Graph Engineering reference](docs/graph-engineering-reference.md)를 참고하십시오.

기여 절차와 재현 가능한 품질 게이트는 [Contributing](CONTRIBUTING.md), 보안 제보와 신뢰 경계는 [Security policy](SECURITY.md)를 참고하십시오. 모든 pull request는 Node.js 22에서 `npm ci`와 `npm run check`를 실행하는 CI를 통과해야 합니다.

Orca 공식 upstream은 [`stablyai/orca`](https://github.com/stablyai/orca)입니다. 이 저장소는 MIT License로 배포합니다.
