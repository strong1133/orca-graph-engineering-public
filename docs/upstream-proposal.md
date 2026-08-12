# Upstream proposal notes

이 플러그인을 사용해 본 뒤 Orca에 제안할 때의 핵심 항목입니다.

## 제안 대상과 방식

- 공식 upstream: [`stablyai/orca`](https://github.com/stablyai/orca)
- 라이선스: MIT, 외부 기여와 Pull Request 허용
- 1차 제안: 이 저장소의 화면 캡처와 로컬 사용 결과를 첨부한 기능 제안 Issue
- 후속 PR: `panel ↔ worker/storage`와 `project/session/model` API를 각각 작고 독립적인 변경으로 분리

Orca의 기여 지침에 따라 UI PR에는 화면 자료, 회귀 테스트, macOS/Linux/Windows 및 local/SSH 호환성 메모, AI 코드 리뷰 요약을 포함합니다. 버전 변경은 maintainer가 담당하므로 PR에 넣지 않습니다.

## 제품 제안

1. Graph panel을 위한 공식 node/edge canvas primitive
2. graph와 node 양쪽에서 project/session/model을 선택하고 node 값이 필드별로 우선하는 routing model
3. Orca project/worktree/session/model 목록을 읽는 panel API
4. 기존 session으로 prompt를 보내거나 지정 project에 agent session을 만드는 명시적 execution API
5. graph run, node run, condition branch, loop/retry를 표시하는 실행 timeline
6. graph JSON import/export와 reusable graph template
7. sidebar panel을 중앙 workspace tab으로 승격하거나 동일 contribution을 양쪽 위치에서 여는 명령
8. superstep/critical-path 분석, reducer 충돌, loop guard, checkpoint를 위한 graph runtime primitive
9. role/context/permissions/evidence/idempotency를 가진 node execution contract
10. human approval gate, compensation, run/node event와 Reads lineage API

## Plugin API 제안

현재 plugin API v1 panel은 `connect-src 'none'`이고 panel에서 worker로 메시지를 보낼 수 없습니다. 이 때문에 플러그인이 로컬 상태를 저장하고 Orca 리소스를 조회하려면 `terminal.sendText`로 CLI 명령을 보내는 우회로가 필요합니다.

가장 아픈 한 가지는 **panel이 터미널을 만들 수 없다**는 것입니다. host가 sandbox panel에 여는 액션은 `workspace.readContext`·`terminal.sendText`·`notifications.show` 셋뿐이고 나머지는 `panel: false`입니다. 그래서 활성 worktree에 터미널이 하나도 없는 순간에는 플러그인이 아무것도 할 수 없습니다 — 저장할 방법도, 자기 전용 터미널을 만들 방법도 없습니다. 이 플러그인은 명령을 들고 있다가 터미널이 생기면 이어서 보내는 것으로 버티지만, 사용자가 터미널 탭을 한 번 열어 주어야 합니다.

최소 API 후보:

- `terminal.create`의 panel 노출 (제목 지정, 활성 worktree 한정). 이것 하나면 위 공백이 사라집니다
- `storage.get/set`의 panel 노출
- `projects.list`, `worktrees.list`, `sessions.list`, `models.list`
- `sessions.create`, `sessions.send`, `sessions.wait`
- `sessions.usage`, `sessions.result`, `sessions.cancel` 및 evidence/result reference
- `graphs.claim`, `graphs.checkpoint`, `graphs.events`, `graphs.runs` 또는 플러그인이 같은 semantics를 구현할 storage/CAS API
- panel ↔ plugin worker request/response channel
- panel state 변경 시 안전한 refresh 또는 host-provided persistent webview
- `workspaceTab`/`editorTab` contribution과 `panels.openInWorkspace` 같은 승격 API
- `leftSidebar`/`primarySidebar` activity contribution과 위치·정렬 우선순위. 현재 strict manifest의 panel contribution은 우측 activity bar 전용이므로 좌측 상단 메뉴는 플러그인에서 선언할 수 없음
- `panels.open`/`panels.focus`처럼 특정 plugin panel tab key를 직접 여는 built-in action. 현재 공개 action은 `sidebar.right.toggle`뿐이라 마지막으로 선택한 우측 탭만 복원함

권한은 읽기와 실행을 분리해 사용자에게 보여주는 편이 좋습니다. 예를 들어 `sessions:list`, `sessions:create`, `sessions:send`를 별도 capability로 선언하면 그래프 편집 전용 플러그인과 실행 가능한 플러그인을 구분할 수 있습니다.

## 검증할 질문

- project/session/model 세 축을 사용자가 실제로 얼마나 자주 node에서 override하는가
- 기존 session 선택 시 model 필드를 숨길지, 경고만 할지
- condition을 사람이 판정하는 흐름과 agent가 판정하는 흐름 중 기본값
- graph-call의 `child`/`inherit`/`override` 라우팅 정책 중 어떤 기본값이 실제 사용에 가장 안전한가
- graph-call 실패를 부모에 전파할지 계속할지, run lineage를 Orca가 어느 수준까지 표시할지
- loop/retry에 필요한 한도와 정체 감지 UX
- run history를 repo 파일, Orca storage, 중앙 서비스 중 어디에 둘지
