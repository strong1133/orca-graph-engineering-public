# Architecture

## 이 설계를 규정하는 제약

Orca plugin API v1이 panel에 허용하는 것이 이 플러그인의 형태를 거의 전부 결정한다. 다른 선택을 하려면 먼저 이 표가 바뀌어야 한다.

| Orca가 panel에 주는 것 | 비고 |
| --- | --- |
| `workspace.readContext` | 현재 worktree의 branch·displayName과 **터미널 id 목록만** |
| `terminal.sendText` | 명시한 터미널 하나, 4096자, 10초에 30회, **활성 worktree 밖은 거부** |
| `notifications.show` | 데스크톱 알림 |

`storage.*`, `secrets.*`, `settings.*`, `events.subscribe`는 host API에 있지만 `panel: false`이므로 panel이 부를 수 없다. panel document는 `sandbox="allow-scripts"` iframe에 `default-src 'none'; connect-src 'none'` CSP로 감싸인다. 따라서 panel은 **네트워크·파일·브라우저 저장소가 모두 없고, 같은 플러그인의 worker와 통신할 채널도 없다**.

결론은 하나다. panel이 밖으로 나가는 통로는 `terminal.sendText` 하나뿐이고, 안으로 들어오는 통로는 자기 자신의 HTML에 박힌 bootstrap JSON 하나뿐이다.

## 구성

```text
Orca plugin panel (sandboxed iframe)
  ├─ graph canvas / inspector
  ├─ Domain / Milestone / Task / Todo 관리
  ├─ Draft / Meta Draft revision UI
  ├─ 실행 현황 (dispatch 로그)
  └─ terminal.sendText ── 명령 한 줄 ──┐
                                       ▼
                          Orca 셸 터미널 (사용자가 한 번 선택)
                                       │
                            scripts/graph-store.mjs  ← 상주 아님. 호출당 1회
                                       ├─ save     변경분을 원천 또는 로컬 파일에
                                       ├─ dispatch Orca 세션에 작업 전달
                                       ├─ source   데이터 원천 설정
                                       └─ refresh  원천·Orca 대상 다시 읽기
                                       │
                                       ├─ lib/data-source.mjs  (folder · structured · unstructured)
                                       ├─ lib/orca.mjs         (공개 orca CLI)
                                       └─ dist/panel.html의 bootstrap JSON 갱신
                                              │
                                              ▼
                                   다음에 panel을 열 때 최신 데이터
```

상주 프로세스, 포트, 토큰, 연결 상태는 없다. 저장 버튼을 누르면 명령이 한 번 돌고 끝난다.

## 읽기와 쓰기

**읽기** — Orca는 panel을 열 때마다 `dist/panel.html`을 파일에서 다시 읽는다(`main/index.js`의 panel entry 로드). CLI가 저장·dispatch·refresh 끝에 그 파일의 bootstrap JSON을 원자적으로 갱신하므로, 다음에 panel을 열면 최신 데이터가 들어 있다. 별도 watcher나 응답 채널이 필요 없다.

**쓰기** — 저장은 store 전체가 아니라 **바뀐 항목만** 보낸다. 실제 데이터에서 store 전체는 132KB이고 압축해도 터미널 한 줄에 담기지 않는다. 항목 단위로 보내면 대부분의 저장이 한 줄로 끝나고, 구조화 원천의 항목별 CAS 계약과도 그대로 맞는다. panel은 부팅 시점의 store를 기준(baseline)으로 잡고 저장할 때마다 그 기준을 갱신한다.

payload는 JSON을 gzip으로 압축한 뒤 base64url로 인코딩한다. 4096자 단위로 나눠 `enter: false`로 이어 보내고 마지막에만 Enter를 보내므로, 터미널에는 명령 **한 줄**이 만들어진다. 프레임 재조립 프로토콜은 없다.

## 저장 경계

`saveChanges`가 정본 경계다. 데이터 원천이 연결되어 있으면 **원천으로** 보내고, 없을 때만 로컬 파일에 쓴다.

- **structured** — 그래프는 aggregate 전체를 한 CAS로 커밋하고, Domain·Milestone·Task·Todo는 항목마다 마지막-read version으로 upsert한다. 커밋 뒤 반드시 snapshot을 다시 읽는다. 409는 로컬 값으로 덮어쓰거나 자동 재시도하지 않는다.
- **folder** — 지정한 절대 경로의 `.orca-graph-engineering/store.json`이 정본이다. 이 장치에서만 의미 있는 값(저장 터미널, 마지막 저장 표시, dispatch 로그)은 이식 가능한 파일에서 제외한다.
- **local** — 앱 데이터의 `store.json`.
- **unstructured** — 보편적인 쓰기 의미가 없으므로 읽기 전용 catalog로만 취급한다. schema를 모르는 endpoint를 임의로 양방향 동기화해 데이터를 손상시키는 것을 막는다.

로컬 store에 얹을 때는 보낸 항목만 id로 교체한다. 통째로 바꾸면 보내지 않은 항목의 편집이 사라진다.

세부 wire format과 보안 제한은 [Data Source contract](data-source-contract.md)에 있다.

## 실행

실행은 **대상 프로젝트의 Orca 세션에 프롬프트를 넣는 것까지**다. 그 뒤 그래프를 어떤 순서로 도는지, 조건을 어떻게 판정하는지, 결과를 어디에 기록하는지는 세션의 에이전트가 소유한다. 플러그인 안에 별도 실행기·스케줄러·재시도 루프는 없다.

panel이 직접 세션에 보내지 못하는 이유는 `terminal.sendText`가 활성 worktree 밖의 터미널을 거부하기 때문이다(`main/index.js`: `terminal is outside the active worktree`). 다른 프로젝트로 보내려면 공개 `orca` CLI를 거쳐야 하므로, dispatch도 저장과 같은 명령 경로를 탄다.

- 기존 세션 지정: `terminal show`로 연결·쓰기 가능을 확인한 뒤 `terminal send`
- 프로젝트·브랜치만 지정: 그 worktree에 `terminal create`로 claude/codex 세션을 만들고, `terminal wait --for tui-idle`로 입력 준비를 확인한 뒤 전송
- 여러 프로젝트(`per_project`): 대상마다 독립적으로 보내고, 하나가 실패해도 나머지는 계속한다. 부분 성공을 전체 실패로 접으면 이미 작업을 받은 세션이 기록에서 사라진다.

실행 전 차단은 그래프 구조 오류와 연결 오류뿐이다. 실행기 종류에 따른 제약이 없어졌으므로 원천의 실행 지원 여부는 더 이상 실행을 막지 않는다.

## 실행 현황

panel에는 세션에서 돌아오는 채널이 없다. 그래서 이 화면은 두 가지 사실만 보여 준다.

1. **dispatch 로그** — 무엇을, 어디로, 언제 보냈는가. 기존 세션인지 새 세션인지까지.
2. **graph run 이력** — 원천이나 그래프에 기록된 run과 노드별 결과.

진행률을 추정하거나 확인하지 못한 상태를 지어내지 않는다. 노드 상태도 그래프와 run 기록에서만 읽고, 보낸 사실을 "실행 중"으로 바꿔 표시하지 않는다. 보낸 뒤에도 실행 버튼은 계속 눌린다 — 끝났는지 알 수 없으므로 잠그면 다시 보낼 방법이 사라진다.

dispatch 로그는 이 장치의 로컬 파일에만 최대 200건 남고 원천이나 이식 가능한 그래프 데이터에 섞이지 않는다.

## 데이터 모델

`GraphDefinition`은 다음을 가진다.

- graph metadata: status, pinned, process, routine, repeat, guards, run history
- nodes: `task | condition | graph_call`
- edges: `sequence | blocks | informs | loop`, optional branch label
- 실행 구조: join mode, node status, condition decision
- routing 기본값: project, Orca-managed worktree branch, session, model, reasoning
- graph engineering policy: topology, objective/questions, budget, max parallelism, hop limit, checkpoint, provenance, human gate
- node 실행 계약: role, reads/writes/reducer, context mode, retry/timeout/budget, idempotency, side effect/compensation, permissions, evidence
- 이식 가능한 편집 힌트: `graph.engineering.editor.groupBy`, edge waypoint map, `node.engineering.layoutPinned`

노드 실행 계약은 이제 플러그인이 강제하지 않고 프롬프트로 세션에 전달된다. 다만 원천이 그 계약을 삼키면 사용자는 승인 게이트나 재시도 한도를 적어 두고도 사라진 줄 모르므로, 저장 응답에 경고로 싣는다(`lib/node-engineering.mjs`).

`GraphStore` v1은 Graph 목록과 함께 `domains`, `milestones`, `tasks`, `todos`, `dispatchLog`를 가진다. 기존 v1 파일에 필드가 없어도 빈 목록을 만들고 node의 embedded Task payload를 Task 목록과 최초 사람 Draft revision으로 자동 승격하므로 이전 저장 파일과 호환된다.

업무 scope는 `Domain 1:N Milestone`이다. Task/Todo의 `domainId`, `milestoneId`는 선택 사항이지만 Milestone이 있으면 그 Milestone의 Domain과 일치해야 한다. 하위 활성 항목이 있는 scope는 archive할 수 없고 hard delete는 제공하지 않는다.

Task/Todo는 현재 projection인 `draft`, `metaDraft`와 append-only `promptRevisions`를 함께 가진다. 둘 다 사람이 직접 편집하며, 고칠 때마다 새 revision이 쌓이고 이전 Meta revision은 stale로 남는다. Meta revision은 생성 근거인 `basedOnId`로 정확한 Draft revision을 가리킨다. Task의 legacy `prompt`는 실행 projection이며 Meta가 있으면 Meta, 없으면 Draft와 동기화된다. Task가 여러 node에서 재사용되면 이 유효 실행 projection을 모든 연결 node에 반영한다.

`processEnabled=true`인 Graph는 재사용 흐름 템플릿이다. Graph 구조와 노드 Prompt는 방법을, `GraphRunRecord.inputPrompt`는 그 회차의 처리 대상을 나타낸다.

`GraphNode`는 routing 값을 부분적으로 override할 수 있다. `effectiveRouting`은 각 키를 독립적으로 해석하므로 graph의 project/model을 상속하면서 node에서 session만 바꿀 수 있다. 편집기는 이 세밀한 계약을 보존하지만 실행 창은 통합 routing 또는 Task 대상별 routing으로 단순화한다.

편집 전용 메타데이터는 새 top-level schema를 만들지 않고 기존 `engineering` 확장 안에 둔다. 실행 provider는 안전하게 무시할 수 있고, 보존하는 provider에서는 그룹 방식·엣지 꺾임점·노드 위치 고정이 local·folder·structured 사이를 왕복한다.

## Task 대상 프로젝트

Task의 `projects`는 `refresh`가 읽어 둔 Orca 프로젝트 목록에서 골라 붙이고, 다른 편집과 똑같이 저장한다. 실행할 때 이 folder locator와 작업 브랜치에 일치하는 Orca worktree를 우선 선택한다.

원격 registry 조회와 다른 장치 worktree provisioning은 제거했다. 그 왕복은 panel이 응답을 받을 수 없어 성립하지 않는다.

## 캔버스

DAG의 level을 superstep으로 분석하고, 가장 긴 의존 경로를 critical path로, loop back-edge의 head에서 tail까지를 loop 영역으로 표시한다. condition은 CSS clip-path나 장식 아이콘이 아닌 실제 160×112 SVG polygon과 동일 크기 hit area로 렌더링한다. 연결선은 상대 위치에 따라 노드의 상·우·하·좌 port를 선택하고 둥근 직교 route·넓은 투명 hit path·색상별 marker·source 근처 Y/N 배지를 함께 그린다.

연결선은 자동 route 후보의 길이와 다른 node 경계 교차 비용을 함께 계산해 장애물을 피하고, 사용자가 추가한 waypoint 사이에도 직교 segment를 삽입한다. 선택한 edge는 꺾임점을 직접 움직이거나 Inspector에서 시작·도착 node를 다시 지정할 수 있으며 일반 edge가 순환을 만들면 거절한다. drag·pan·wheel 중에는 전체 HTML을 다시 만들지 않고 node/edge/world/minimap DOM만 갱신하고 pointer 종료 시 한 번 history snapshot을 남긴다.

선택은 node ID 집합과 primary node를 분리해 다중 선택과 Inspector 문맥을 함께 유지한다. 구조 변경은 graph aggregate의 before/after snapshot으로 최대 100단계 history를 만들고, 자동 정렬은 별도 preview graph에서 확인한 뒤 적용한다. graph-call 진입은 현재 graph ID를 breadcrumb trail에 쌓으며 저장되는 schema에는 탐색 UI 상태를 섞지 않는다.

캔버스 node와 SVG edge는 focus 가능한 button semantics와 이름을 가지며 Enter/Space로 inspector를 연다. modal은 labelled dialog, initial focus, Tab 순환, Escape/닫기 후 opener focus 복원을 제공한다. 저장 상태와 toast는 polite live region이다.

`fixtures/graph-validation-matrix.json`의 stable code/severity fixture를 model unit test가 소비하므로 검증 의미가 조용히 흘러가지 않는다.

## 배포 surface

`npm pack`은 재빌드 가능한 source-only package이며 생성된 `dist/`를 제외한다. `scripts/package-plugin.mjs`는 별도 staging root에서 공개 fixture와 고정 timestamp로 panel JavaScript를 한 번 빌드하고 manifest entry, `lib/`, `scripts/`, shrinkwrap을 포함한 Orca plugin bundle을 만든다. 저장은 compiler를 다시 실행하지 않고 HTML의 unique JSON bootstrap marker만 Node built-in으로 원자 갱신하므로 extracted plugin에 dependency install이 필요 없다. `scripts/verify-plugin-package.mjs`는 압축을 푼 plugin에서 저장 CLI를 실제로 실행해 store와 panel bootstrap이 갱신되는지 확인한다 — 그 경로가 panel의 유일한 쓰기 통로이기 때문이다.

portable panel에는 contributor 절대 경로 대신 `.`이 들어가므로 압축을 푼 plugin root 기준으로 저장 명령이 동작한다. runtime state와 내부 설계 작업문서는 두 package surface에서 제외한다.
