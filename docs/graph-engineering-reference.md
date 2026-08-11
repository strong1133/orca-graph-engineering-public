# Graph Engineering reference audit

이 플러그인은 [`leaf-kit/book-graph-engineering`](https://github.com/leaf-kit/book-graph-engineering)의 현재 판 `v2026.08.02`(35장)을 설계 참고자료로 사용합니다. 책의 문장을 복제하지 않고 CC BY 4.0 저작자 표시와 함께 실행 가능한 규칙, 데이터 계약, 공개된 한계로 재구성했습니다.

상태의 의미는 다음과 같습니다.

- `동작`: UI, 정적 분석 또는 로컬 실행기가 실제로 수행
- `계약`: 데이터 모델과 UI에 표현되지만 실행 강제는 일부만 지원
- `경계`: 제품 범위 밖이거나 Orca API가 필요

| 장 | 플러그인에 반영한 판단 | 상태 |
|---:|---|---|
| 1–6 | 실행 시스템을 노드·엣지·서브그래프·실행기로 명시하고 지식 그래프와 실행 그래프의 목적을 혼동하지 않음 | 동작 |
| 7 | typed node/edge/property, 방향, 종류, branch, join과 구조 제약 | 동작 |
| 8 | 버전이 있는 JSON graph store와 adjacency 기반 캔버스 모델. CSR/대규모 저장 최적화는 대상 아님 | 계약 |
| 9 | DFS 기반 graph-call 순환 탐지, DAG cycle 검사, traversal hop 제한 | 동작 |
| 10 | 임계 경로는 제공하지만 중심성·커뮤니티 분석은 제공하지 않음 | 경계 |
| 11 | 실행 그래프 편집기이며 Cypher/SPARQL/Gremlin/GQL query engine은 아님 | 경계 |
| 12 | 검증 가능한 objective와 competency questions | 동작 |
| 13 | 구조·상태·보안·운영 제약을 실행 전에 검사 | 동작 |
| 14 | 중복 ID와 dangling edge를 검사. 지식 entity resolution은 대상 아님 | 동작·경계 |
| 15 | evidence/provenance 요구를 모델링. 문서 추출 precision/recall pipeline은 대상 아님 | 계약·경계 |
| 16 | graph version, run/node 시간, evidence 슬롯. 이중 시간·신뢰도 모델은 미지원 | 계약 |
| 17 | session/project 참조 경계는 있으나 hybrid retrieval/GraphRAG는 미지원 | 경계 |
| 18 | path/diamond/router/star/cycle/tree/tool-bipartite topology와 graph-call | 동작 |
| 19 | superstep, fan-out, critical path, 병렬 writes와 reducer 충돌 | 동작 |
| 20 | 조건 label·고정 선택·join과 loop back-edge/guard를 검사. 미선택 분기는 선행 결과 기반 AI evaluator가 판정하고, loop 재진입 scheduler는 미지원이라 live-run은 fail-closed | 동작·경계 |
| 21 | 노드별 atomic 진행 저장, checkpoint policy, retry/backoff/timeout/idempotency | 동작·계약 |
| 22 | side effect, irreversible, compensation, approval 계약. compensation 자동 실행은 미지원 | 계약 |
| 23 | human gate의 pending/approved/rejected 상태와 실행 중단 | 동작 |
| 24 | inherit/fresh/summary/reference-only context. fresh session은 실행하며 나머지는 계약 중심 | 동작·계약 |
| 25 | topology template와 tool 역할·권한 경계 | 동작 |
| 26 | read/write/network/exec, data class, evidence, 위험 권한 조합 preflight | 동작·계약 |
| 27 | context와 ephemeral/run/persistent retention 계약. 장기 memory engine은 미지원 | 계약·경계 |
| 28 | 정적 graph 편집·복제는 제공하지만 agent의 자기확장과 gate는 미지원 | 경계 |
| 29 | graph-call lineage, reads/writes/evidence로 실행 graph 연결. 별도 knowledge backbone은 미지원 | 동작·계약 |
| 30 | append형 run/node history와 idempotency key. 완전한 event sourcing/exactly-once는 미지원 | 동작·경계 |
| 31 | 원자적 파일 교체는 제공하지만 다중 실행자 CAS/lease/conflict resolution은 미지원 | 동작·경계 |
| 32 | `schemaVersion`과 typed import 경계. expand-contract migration runner는 미지원 | 계약·경계 |
| 33 | depth, max parallelism, critical path, 선언 token budget. 실제 token/latency 수집은 Orca API 필요 | 동작·경계 |
| 34 | termination, attempt/duration, permissions, side effects, data class. 개인정보 연쇄 삭제는 미지원 | 계약·경계 |
| 35 | objective, competency questions, standard/de-facto/experimental maturity와 검증 가능한 한계 공개 | 동작 |

## 검수 결론

책의 에이전트 그래프 핵심인 topology, 상태 병합, superstep, loop guard, 내구성, retry, human gate, context, 권한, 관측성, 비용 모델은 편집기·분석기·저장 경계에 연결되어 있습니다. 반면 지식 그래프 전용 query/retrieval/entity resolution, 동적 자기확장, 완전한 event sourcing/CAS, 개인정보 삭제는 구현됐다고 주장하지 않습니다. 공개 문서에서 `동작`, `계약`, `경계`를 구분해 과대평가를 피합니다.
