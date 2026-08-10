# Architecture

## 구성

```text
Orca plugin panel (sandboxed iframe)
  ├─ graph canvas / inspector
  ├─ local Domain / Milestone / Task / Todo manager
  ├─ human Draft / Meta Draft revision UI
  ├─ field-level routing inheritance
  ├─ compact sidebar toolbar
  └─ terminal.sendText(OGX1 frames)
                 │
                 ▼
visible Orca shell terminal
  └─ bridge/index.mjs
       ├─ runtime/store.json
       ├─ runtime/targets.json
       ├─ runtime/executions.json
       ├─ Data Source provider
       │    ├─ folder / local Git checkout → portable full GraphStore
       │    ├─ structured workspace v1 → remote Graph + work-item CAS mutations
       │    └─ unstructured JSON → read-only candidate catalog
       ├─ runtime/data-source.json + replaceable source-cache.json
       ├─ public orca CLI
       │    └─ fresh Codex session → built-in Meta Prompt contract
       ├─ tokenized 127.0.0.1 response bridge / wide-view server
       ├─ Orca central browser tab
       └─ rebuild dist/panel.html → Orca dev reload
```

패널은 Orca가 제공하는 `workspace.readContext`, `terminal.sendText`, `notifications.show`만 사용합니다. 브리지는 숨은 background worker가 아니라 사용자가 선택하고 종료할 수 있는 Orca terminal에서 동작합니다. 기동한 브리지는 임의 token 경로의 loopback response API를 runtime bootstrap에 주입한다. 따라서 사이드 패널도 mutation·원천 새로고침의 완료 응답과 최신 store를 즉시 받아 렌더링한다. 브리지 재시작으로 endpoint가 바뀌면 terminal channel로 한 번 fallback하고, 새 bootstrap을 다시 읽은 뒤 직렬화 queue의 완료까지 ping해 자동 재동기화한다. 넓게 보기 탭을 재사용할 때도 현재 HTML을 명시적으로 reload한다.

## 데이터 모델

`GraphDefinition`은 다음 요소를 가집니다.

- graph metadata: status, pinned, process, routine, repeat, guards, run history
- nodes: `task | condition | graph_call`
- edges: `sequence | blocks | informs | loop`, optional branch label
- execution structure: join mode, node status, condition decision
- routing defaults: project, Orca-managed worktree branch, session, model, reasoning
- model targets: agent family와 새 session에 전달 가능한 `reasoningLevels`
- graph engineering policy: topology, objective/questions, global/reserved budget, max parallelism, hop limit, checkpoint, provenance, human gate
- node execution contract: role, reads/writes/reducer, context mode, retry/timeout/budget, idempotency, side effect/compensation, permissions, evidence
- portable editor hints: `graph.engineering.editor.groupBy`, edge waypoint map, `node.engineering.layoutPinned`

`GraphStore` v1은 Graph 목록과 함께 로컬 `domains`, `milestones`, `tasks`, `todos` 컬렉션을 가진다. 기존 v1 파일에 필드가 없어도 빈 scope 목록을 만들고 node의 embedded Task payload를 Task 목록과 최초 사람 Draft revision으로 자동 승격하므로 이전 저장 파일과 호환된다.

`processEnabled=true`인 Graph는 재사용 흐름 템플릿이다. Graph 구조와 노드 Task Prompt는 방법을, `GraphRunRecord.inputPrompt`는 그 회차의 처리 대상을 나타낸다. 새 run의 입력은 필수이고 immutable이며, 재개는 현재 run의 입력을 다시 사용한다. 일반 Graph에는 이 규칙을 적용하지 않아 기존 단발 실행과 JSON의 의미를 유지한다.

업무 scope는 `Domain 1:N Milestone`이다. Task/Todo의 `domainId`, `milestoneId`는 선택 사항이지만 Milestone이 있으면 그 Milestone의 Domain과 일치해야 한다. UI와 normalize 경계가 이 규칙을 강제하며, 하위 활성 Milestone·Task·Todo가 있는 scope는 archive할 수 없다. hard delete는 제공하지 않는다.

Task/Todo는 현재 projection인 `draft`, `metaDraft`와 append-only `promptRevisions`를 함께 가진다. 사람 Draft를 바꾸면 새 `draft` revision을 current로 만들고 이전 Meta revision은 stale로 남긴다. Meta revision은 생성 근거인 `basedOnId`로 정확한 Draft revision을 가리킨다. Task의 legacy `prompt`는 실행 projection이며 current Meta가 있으면 Meta, 없으면 current 사람 Draft와 동기화된다. Task가 여러 node에서 재사용되면 이 유효 실행 projection을 모든 연결 node에 반영한다. Todo→Task 전환은 scope와 revision lineage를 새 ID 공간으로 복사하고 원래 Todo를 보존한다.

`GraphNode`는 routing 값을 부분적으로 override할 수 있습니다. `effectiveRouting`은 각 키를 독립적으로 해석하므로, 예를 들어 graph의 project/model을 상속하면서 node에서 session만 바꿀 수 있습니다. 편집기는 이 세밀한 계약을 보존하지만 실행 창은 통합 routing 또는 Task target locator별 routing으로 단순화합니다. `per_project` 모드는 같은 DTO를 각 locator마다 독립적으로 가지며, 모든 route를 먼저 live-attest한 뒤에만 세션을 생성합니다.

Task 상세의 빠른 그래프 구성은 현재 Task를 첫 노드로 고정하고 Domain·Milestone이 정확히 같은 활성 Task만 선택하게 한다. 로컬·폴더 source에서는 같은 portable Graph aggregate를 만들고, structured source에서는 source Task의 마지막-read CAS version과 순서 있는 ID 배열을 원천의 원자적 quick-create 경계에 전달한 뒤 생성된 Graph가 활성인 최신 snapshot으로 교체한다.

편집 전용 메타데이터는 새 top-level schema나 별도 endpoint를 만들지 않고 기존 `engineering` 확장 안에 둔다. 실행 provider는 이 값을 안전하게 무시할 수 있고, 보존하는 provider에서는 local·folder·structured source 사이에 그룹 방식, 엣지 꺾임점, 노드 위치 고정이 함께 왕복한다. group frame 자체는 Domain/Milestone 관계와 graph analysis에서 매번 파생하므로 별도 중복 컬렉션을 저장하지 않는다.

`graph_call`은 child graph ID, routing 결합 정책, 실패 전파 정책을 가집니다. child run에는 부모 run/graph/node ID를 기록하고 부모 run에는 child run ID 목록을 기록합니다. 실행 전에 누락·보관 대상과 graph-call 순환을 검증하며 루트 graph의 traversal hop limit로 최대 재귀 깊이를 제한합니다.

## 저장·갱신 프로토콜

iframe은 파일 시스템에 접근할 수 없습니다. 패널은 JSON 메시지를 base64url로 인코딩하고 `OGX1:<request>:<part>:<total>:<chunk>:END` 프레임으로 나눠 선택된 terminal의 raw stdin에 보냅니다. 브리지는 명시적인 `:END` 구분자를 기준으로 프레임을 재조립하고 작업을 직렬화합니다. 이 방식은 Orca가 Enter 키 이벤트를 합성하지 않는 경우에도 안정적으로 동작합니다.

저장 파일은 임시 파일 작성 후 rename하는 방식으로 교체합니다. 저장 또는 실행 상태 변경 뒤 panel bundle을 다시 만들며, Orca의 development plugin watcher가 패널을 갱신합니다.

folder source는 사용자가 선택한 기존 절대 경로의 `.orca-graph-engineering/store.json`을 정본으로 사용한다. 연결 시 파일이 없을 때만 현재 panel store로 초기화하고, 저장·실행 이력·Meta Prompt 결과를 같은 portable GraphStore에 원자적으로 반영한다. bridge terminal/workspace 같은 머신별 runtime metadata는 외부 파일에서 제외한다. 로컬 Git checkout도 동일한 파일 저장 경계로 취급하며 Git 명령은 사용자가 직접 수행한다.

structured source에서는 원격 workspace가 정본이다. snapshot을 panel용 `GraphStore` DTO로 투영하되 cache는 장애 시 표시를 위한 파생물일 뿐 병합 대상이 아니다. Graph는 aggregate 전체를 한 transaction·한 CAS로 커밋하고, Domain·Milestone·Task·Todo는 항목별 마지막-read version으로 upsert한다. Prompt revision은 append-only이며 Todo와 결합된 Task lifecycle은 `relatedVersions`로 함께 CAS한다. 성공할 때마다 snapshot을 다시 읽고 409를 로컬 값으로 덮어쓰거나 자동 재시도하지 않는다.

unstructured source에는 보편적인 쓰기 의미나 concurrency contract가 없으므로 읽기 전용 catalog로만 취급한다. 자동 탐색 또는 명시적 field mapping으로 후보를 만들고 Graph는 local store에 남긴다. 이 구분은 schema가 없는 endpoint를 임의로 양방향 동기화해 데이터를 손상시키는 것을 막는다. 세부 wire format과 보안 제한은 [Data Source contract](data-source-contract.md)에 있다.

## 사이드바와 넓게 보기

Orca plugin API v1의 panel contribution은 우측 activity bar의 sandboxed iframe으로만 렌더링됩니다. 좁은 폭에서는 inspector를 기본으로 닫고 핵심 버튼 네 개만 표시하며, 나머지 명령은 `•••` 메뉴로 모읍니다.

`⛶`는 브리지에 `open-wide`를 보내 현재 worktree의 Orca 중앙 browser tab을 엽니다. 같은 화면이 이미 열려 있으면 그 탭을 다시 활성화합니다. 브리지는 임의 포트의 `127.0.0.1`에 추측하기 어려운 일회성 경로를 만들고, 최신 panel bundle과 같은 메시지 API를 제공합니다. CORS를 허용하지 않고 응답을 캐시하지 않으며 브리지가 종료되면 넓은 화면도 함께 종료됩니다. 넓은 화면의 Graph FAB는 목록과 편집 캔버스를 전환합니다. 이는 중앙 plugin contribution이 생길 때까지의 호환 계층입니다.

상단의 고정 메뉴는 `그래프 목록`, `그래프 보기`, `실행 현황`, `Domain 관리`, `Milestone 관리`, `Task 관리`, `Todo 관리`를 명시적으로 전환한다. 실행 현황은 머신 로컬 레코드의 queued/running/completed/failed, 프로젝트별 target/session/model과 진행률을 보여 주고 활성 건수를 메뉴 badge로 표시한다. 목록 화면은 lifecycle status와 최신 run stage를 분리합니다. status는 badge, 실행 단계는 color dot와 별도 badge로 표시하며 이름·설명·ID 검색, 두 종류의 필터, 수정일·이름·상태 정렬을 클라이언트에서 수행합니다. Task/Todo 화면은 Draft·Meta·scope까지 통합 검색하고 상태·Domain·Milestone 필터, Domain/Milestone/상태/우선순위 그룹화, 우선순위·마감일·수정일 정렬을 제공한다. Task의 기본 그룹은 Domain→Milestone이고, Todo의 기본 그룹은 실행 scope와 독립적인 free-form `groupName`→`subgroupName` 계층이다. 활성 그룹화 모드의 각 그룹은 독립적으로 접고 펼칠 수 있으며, 현재 필터에 보이는 그룹 전체를 한 번에 접거나 펼칠 수도 있다. 그룹 항목 수와 접힘 상태는 유지한다. Todo의 기본 projection은 `open|in_progress`인 활성 항목이며, `done|cancelled` 이력은 삭제하지 않고 모든 상태 또는 개별 상태 필터로 노출한다. 헤더는 현재 표시 수·활성 수·전체 수를 분리해 원천 집계 의미를 보존한다.

Task·Todo와 Graph 실행 창은 `머신 → 통합/프로젝트별 배정 → project의 worktree branch 또는 기존 Orca session + model/reasoning`의 세 단계만 노출한다. 대상 갱신은 현재 Orca와 `environment list`에 저장된 원격 Orca를 각각 조회하고 environment별 project/worktree branch/agent session을 한 snapshot에 합친다. 구조화 원천의 Task 프로젝트 편집기는 registry project와 그 project가 게시한 실제 worktree branch를 여러 묶음으로 선택해 `target/folder` 관계로 한 번의 CAS에 저장한다. 대상이 여러 개면 첫 target을 cwd로 쓰는 `single_session`과 locator별 routing을 만드는 `per_project`를 지원하며, 프로젝트마다 새 session 또는 일치하는 기존 session과 model/reasoning을 검증한다. 브리지는 현재 GraphStore나 구조화 원천 snapshot에서 업무와 유효 실행 Prompt를 다시 읽고 그래프 실행과 같은 target allow-list, agent family, reasoning, live worktree/session attestation을 적용한다. Task에서 사용자가 project/session을 명시하지 않았으면 첫 `role=target`, `locatorKind=folder` 관계를 같은 environment의 Orca repo/worktree path에 대조하고 relation branch와 일치하는 기존 worktree를 선택한다. Todo 빠른 실행은 구조화 원천에서 `POST /todos/{id}/task`의 Todo CAS와 안정적인 idempotency key로 Task를 먼저 준비한다. 단건 실행은 그래프 run·node claim이나 Task/Todo lifecycle을 만들지 않는다.

실행 시작 메시지는 검증·dispatch 완료를 기다리지 않고 `RuntimeExecution`을 즉시 반환하고 실제 작업을 bridge queue에 넣는다. panel은 `execution-status`를 1.5초 간격으로 읽되 active record가 없으면 polling을 중단한다. `runtime/executions.json`은 최대 200개 머신 로컬 이력만 원자적으로 보존하고 Prompt 원문을 저장하지 않는다. GraphStore와 structured source의 실행 정본은 그대로 유지되며 이 파일은 Orca session 관찰용 projection이다. bridge 재시작 시 queued/running record는 명시적 실패로 마감한다.

호환 Workspace aggregate API를 설정하면 bridge 기동과 명시적 대상 갱신에서만 로컬 `orca repo list --json`과 `orca worktree list --json`을 읽어 장치별 project/worktree registry를 전체 교체 게시한다. Task를 열거나 실행할 때 target folder 관계가 비어 있으면 현재/활성 Orca worktree를 repo ID와 경로로 registry에 대조한다. 한 후보면 추천하고, Task 상세에서는 장치·검색·remote/path 그룹별 목록에서 여러 project/worktree branch 묶음을 체크한다. 대상 장치에 canonical Git project나 선택 branch가 없으면 versioned source registry를 근거로 provision하고 서버가 반환한 실제 경로만 관계에 쓴다. 실행 확인 뒤에만 최신 Task version과 기존 project 관계 전체를 다시 읽어 `role=target`, `locatorKind=folder` 항목을 추가하거나 branch를 바꾼다. branch selector에는 선택한 project에 실제 존재하는 Orca worktree만 표시한다. branch는 `refs/heads/`를 제거해 저장하고 Git ref 안전 규칙과 255자 상한을 적용한다. 409에서는 최신 Task/registry를 재조회하지만 stale version으로 쓰기를 자동 재시도하지 않는다.

Task 상세의 `Task 삭제`는 확인 modal을 거쳐 lifecycle을 `archived`로 바꾸는 보존형 삭제다. Prompt revision과 연결된 graph node를 제거하지 않으며 보관된 Task는 같은 상세 화면의 `Task 복원`으로 backlog에 되돌린다. 구조화 원천에서는 기존 Task CAS version으로 mutation하고 충돌 시 최신 snapshot을 다시 읽는다.

## Meta Prompt 생성 경계

Meta Prompt는 저장과 분리된 명시적 버튼 동작이다. 패널은 먼저 현재 GraphStore를 저장한 다음 raw Draft가 아닌 `itemKind`, `itemId`, `draftRevisionId`만 브리지 메시지로 보낸다. 브리지는 저장 파일에서 current revision을 다시 확인하고 사용자가 선택한 bridge terminal의 worktree에 `gpt-5.6-sol` medium effort의 새 Codex terminal을 만든다. 전송 prompt는 플러그인에 내장된 공개 9개 섹션 계약과 함께 title/scope 및 정렬된 Task project context와 사람 Draft를 JSON 값으로 감싼 untrusted input으로 전달하므로 별도 비공개 스킬이 필요하지 않다. 모델 결과가 target locator를 빠뜨리면 새 H1을 만들지 않고 `작업 컨텍스트` 내부의 `대상 프로젝트` H2로 모든 target locator를 결정적으로 보강한다.

Agent가 idle로 종료된 뒤 Orca `worktree ps`의 해당 pane `lastAssistantMessage`를 결과 정본으로 읽는다. 결과는 `역할`, `목표`, `작업 컨텍스트`, `요구사항`, `제약사항`, `실행 절차`, `출력 형식`, `품질 기준`, `입력`의 순서 있는 9개 H1 section과 1 MiB 상한을 통과해야 한다. 저장 직전에 같은 `draftRevisionId`가 여전히 current인지 다시 검사하는 CAS-style guard를 적용한다. 검증 실패나 원문 변경은 사람 Draft와 이전 Meta를 보존하고 `metaPromptRun.status=failed`로 기록한다. 성공한 결과만 새 Meta revision으로 append하고 연결 Graph node의 실행 projection을 갱신한다.

캔버스는 DAG의 level을 superstep으로 분석한다. 가장 긴 의존 경로를 critical path로, loop back-edge의 head에서 tail까지를 loop 영역으로 표시한다. condition은 CSS clip-path나 장식 아이콘에 기대지 않는 실제 160×112 SVG polygon과 동일 크기 hit area로 렌더링한다. 연결선은 상대 위치에 따라 노드의 상·우·하·좌 port를 선택하고, 둥근 직교 route·넓은 투명 hit path·색상별 marker·source 근처 Y/N 배지를 함께 그린다. 모눈은 viewport pan/zoom에 맞춰 이동·확대되며 node drag는 grid snap 뒤 좌·중앙·우 및 상·중앙·하 정렬 guide를 적용한다. 각 Task 노드는 session/project와 AI model을 본문에 표시하며 자동 condition도 evaluator의 target/model을 표시한다. 상단의 고정 실행 버튼은 세 단계 실행 창을 열고 실행 후에는 canvas 상단의 상태 banner로 전환한다. 상세 구조·안전 finding은 Problems에서 유지하되 실행 창에는 실제 blocker만 짧게 표시한다. model과 bridge의 trust boundary는 분리하되 stable validation code와 `fixtures/graph-validation-matrix.json`을 양쪽 test가 함께 소비해 drift를 막는다.

캔버스 node와 SVG edge는 focus 가능한 button semantics와 이름을 가지며 Enter/Space로 inspector를 연다. modal은 labelled dialog, initial focus, Tab 순환, Escape/닫기 후 opener focus 복원을 제공한다. 저장·bridge 상태와 toast는 polite live region이다. 동일 renderer를 side panel과 loopback wide view에서 사용하며 jsdom 회귀 검사가 두 mode를 각각 실행한다.

연결선은 자동 route 후보의 길이와 다른 node 경계 교차 비용을 함께 계산해 장애물을 피하고, 사용자가 추가한 waypoint 사이에도 직교 segment를 삽입한다. 선택한 edge는 꺾임점을 직접 움직이거나 Inspector에서 시작·도착 node를 다시 지정할 수 있으며 일반 edge가 순환을 만들면 거절한다. drag·pan·wheel 중에는 전체 HTML을 다시 만들지 않고 node/edge/world/minimap DOM만 갱신하고 pointer 종료 시 한 번 history snapshot을 남긴다.

선택은 node ID 집합과 primary node를 분리해 다중 선택과 Inspector 문맥을 함께 유지한다. 구조 변경은 graph aggregate의 before/after snapshot으로 최대 100단계 history를 만들고, 자동 정렬은 별도 preview graph에서 확인한 뒤 적용한다. graph-call 진입은 현재 graph ID를 breadcrumb trail에 쌓으며 저장되는 graph schema에는 탐색 UI 상태를 섞지 않는다. 설계/실행 보기 모드는 같은 데이터를 사용하지만 실행 보기에서 form·구조 mutation을 UI와 event boundary 양쪽에서 차단한다.

## 실행

- session 지정: cached pane identity와 fresh Orca agent pane이 일치하고 `tui-idle`인 terminal에만 Task prompt 전송
- project 지정, session 미지정: project worktree에 model 명령으로 새 terminal 생성 후 Task prompt 전송
- dry-run: live와 같은 selected graph-call tree와 모든 Task의 pure route를 먼저 검증한 뒤, Orca를 호출하거나 terminal을 변경하지 않고 routing 계획만 run history에 기록
- condition: branch가 고정되지 않았으면 선행 노드의 결과 요약을 같은 routing resolver로 선택한 evaluator session에 보내고, 허용된 outgoing label만 JSON 판정으로 수용해 후속 경로를 연다. dry-run은 자동 판정 예정과 아직 열리지 않은 경로를 `waiting`으로 표시
- branch/join: 닫힌 branch는 `skipped`, 아직 결정되지 않은 dependency는 `waiting`으로 run history에 이유와 함께 구분
- loop: 정적 분석과 dry-run 계획은 지원하지만 local bridge의 재진입 scheduler는 미지원이므로 live-run을 terminal dispatch 전에 차단
- graph-call: root hop limit과 selected branch/AND·OR 의미로 전체 child tree를 먼저 검사한 뒤 parent/child run lineage, routing 결합, 실패 전파 정책을 기록
- retry: 노드 maxAttempts까지 exponential backoff와 jitter를 적용하고 idempotency key를 요구
- timeout/budget: 노드 timeout, graph wall time, 선언 token budget을 실행 전/중 강제
- human gate: approved만 통과하며 pending/rejected는 실행을 멈춤
- irreversible boundary: 선택된 condition branch와 AND/OR join 의미로 계산한 executable non-loop DAG에서 approved human gate가 action을 dominate해야 함
- fresh context: verifier 등 fresh node는 기존 session을 재사용하지 않고 새 Orca session을 만듦
- run history: trigger, termination reason, attempt, duration, node/session/child graph 결과와 run lineage를 저장

실제 실행 전 structural warning과 dry-run 계획을 확인하는 흐름을 기본으로 합니다.

dry-run과 live execution은 먼저 Orca를 호출하지 않는 pure routing plan을 공유한다. selected executable graph-call tree를 compile해 cycle/depth와 모든 task의 field-level project/session/model/reasoning을 resolve하고, cached session/project/worktree 존재, model allow-list와 agent family, model별 reasoning capability를 검사한다. root나 descendant 어느 곳에서든 이 단계가 실패하면 관련 모든 graph의 run history와 Orca call은 그대로 비어 있다.

dry-run은 pure plan이 성공한 뒤 planned run lineage만 기록하며 여기서 종료한다. live execution만 두 번째 단계로 넘어가 fresh `worktree ps`와 `terminal list`를 조회해 project worktree와 existing-session의 `${tabId}:${leafId}` ↔ `agents[].paneKey` identity를 확인하고 bounded `terminal wait --for tui-idle`을 수행한다. existing session은 send 직전 같은 증명을 다시 거친다. agent identity나 idle을 증명하지 못하는 terminal은 shell처럼 취급해 차단하고 project route의 새 agent terminal을 요구한다.

새 Claude session은 model catalog의 `low|medium|high|xhigh|max`를 CLI `--effort`로 전달한다. 새 Codex session은 model별 `reasoningLevels`만 `model_reasoning_effort`로 전달하며 Sol/Terra는 `ultra`, Luna는 `max`까지만 허용한다. existing session에는 reasoning을 실제 적용하거나 current 값을 증명할 공개 surface가 없으므로 reasoning override를 pure plan에서 거절하고, 값을 비웠을 때만 session의 current effort를 유지한다.

panel의 실행 modal과 bridge preflight는 같은 핵심 branch label/loop/gate/idempotency/sensitive-network 계약을 각각의 신뢰 경계에서 검사합니다. 분기 미선택은 오류가 아니라 자동 evaluator 요청이며, 존재하지 않는 고정 분기만 오류입니다. 실행 대상 누락·세션/모델 불일치는 별도의 실행 설정 문제로 표시해 구조·안전 finding과 혼동하지 않습니다. `fixtures/graph-validation-matrix.json`의 stable code/severity fixture를 model unit과 bridge process suite가 함께 소비하므로 panel이 허용한 실행을 bridge가 즉시 같은 정책으로 거절하는 drift를 막습니다. panel 검사는 편집 피드백이고 bridge 검사는 UI를 우회한 요청에도 run 생성과 Orca 호출보다 먼저 적용되는 보안 경계이므로, 중복을 제거한다는 이유로 어느 한쪽을 생략하지 않습니다.

## 배포 surface

`npm pack`은 재빌드 가능한 source-only package이며 생성된 `dist/`를 제외한다. `scripts/package-plugin.mjs`는 별도 staging root에서 공개 fixture와 고정 timestamp로 panel JavaScript를 한 번 빌드하고 manifest entry, bridge/source, shrinkwrap을 포함한 Orca plugin bundle을 만든다. runtime save/reload는 compiler를 다시 실행하지 않고 HTML의 unique JSON bootstrap marker만 Node built-in으로 원자 갱신하므로 extracted plugin에 dependency install이 필요 없다. portable panel에는 contributor 절대 경로 대신 `.`이 들어가므로 압축을 푼 plugin root의 shell에서 bridge를 시작한다. runtime state와 내부 설계 작업문서는 두 package surface에서 제외한다.
