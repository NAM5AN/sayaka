# 구현 설계 가이드 — MVP 기술 아키텍처

## 권장 스택과 선택의 자유
- **권장 초기값:** TypeScript + Next.js(App Router) + React 기반 반응형 웹, 서버 Route Handler / Server Action, PostgreSQL 또는 Supabase를 통한 영속 저장, OpenAI 공식 JS SDK의 Responses API. 사용 가능한 환경에서 더 안정적인 대안이 있다면 근거와 migration 계획을 적고 사용 가능.
- **반드시 새 독립 프로젝트:** 기존 숙소 릴스 GitHub/Vercel/Supabase 프로젝트와 분리. 실수로 해당 저장소를 건드리지 말 것.
- **로컬 우선:** API/DB 인증정보가 없어도 화면·코어 모듈·테스트는 구동되게. 목 데이터는 UI에 데모로 명확히 표기하고 실제 AI인 척 금지.
- 프레임워크·OpenAI SDK는 **구현 시점 공식 문서 확인 후 설치**. 특정 모델 식별자·가격을 근거 없이 하드코딩하지 말고 `.env`에서 선택.

## 권장 구성
```
Browser (roleplay UI)
  -> authenticated app server (never browser -> OpenAI direct)
      -> rate limiter + request validation
      -> get chat/scene/recent messages/memory
      -> lore filter by tags, knowledge tier, time and disclosure state
      -> assemble brief stable behavior instruction and selected scene context
      -> OpenAI Responses API generation (prefer schema-validated structured output when supported)
      -> server verification: user agency, info disclosure, physical state, unwanted meta
      -> optionally one constrained retry, not unconditional extra calls
      -> persist assistant reply and validated scene/memory delta atomically
  -> Browser displays only text/narration segments
```

## 최소 데이터 엔티티
- `users` (하나의 개인 사용자 시작 가능. 외부 공개라면 인증 필수)
- `chats` (userId, title, createdAt, updatedAt, canonicalVersion, openingSceneId)
- `messages` (chatId, role, segments/body, timestamp, requestId, generationStatus)
- `scene_states` (chatId, location, time, props, characterGoal, emotion, lastConfirmedUserAction, version)
- `relationship_states` (chatId, trust, wariness, curiosity, annoyance, qualitative_notes; 수치보다 근거 사건 우선)
- `memory_entries` (chatId, subject, factText, sourceMessageId, provenance, confidence, isCanon=false, sensitivity, createdAt)
- `disclosures` (chatId, loreId, disclosedWhen, confirmedByDialogue)
- `lore_catalog` (loreId, canonStatus, timeScope, knowledgeTier, releasePolicy, tags, behavioralProjection, source)
- `generation_logs` (requestId, chatId, model, latency, approximate tokens/cost where provided, promptVersion, validationResults; private and key/비밀 원문 미포함)

## 엔드포인트 — 조정 가능
- `POST /api/chats` — 새 채팅방 + 공식 초면 상태 생성.
- `GET /api/chats` — 사용자 자신의 방 목록.
- `GET /api/chats/:id` — 메시지와 상태 재조회.
- `POST /api/chats/:id/messages` — idempotency key 포함 사용자 입력 → GPT 응답/저장.
- `DELETE /api/chats/:id` — 삭제 확인 후 사용자 자신의 데이터 삭제.
- `GET /api/health` — 서비스 준비 상태(비밀 노출 X).
- **관리자 설정 수정 API**가 필요해질 경우 별도 인증/권한; 일반 채팅 문구 'OOC:'는 관리 명령으로 간주하지 말 것.

## 요청 처리와 원자성
- 인증·대화방 소유 확인 -> 본문 길이 제한(예시 2,000자부터 조정 가능) -> rate limit -> dedup requestId.
- 동시에 여러 메시지를 보낸다면 대화방 단위로 순서/버전 제어. 재시도 시 응답이 두 번 저장되지 않도록 idempotency.
- 모델 오류·시간 초과·스키마 불일치·내용 검수 실패 각각 UX에 이해 가능한 피드백. 실패 메시지를 사야카의 극중 행동으로 허위 기록하지 말 것.
- 상태 변경은 모델 제안이 아니라 **서버 검증 후** DB 트랜잭션에서 승인. 불가능한 위치 변화나 비밀 자동 공개를 차단.
- 서버 요청·응답 샘플, 저장 스키마, 설계 결정을 README 및 ADR에 기록.

## OpenAI API 구현 주의
- 키 `OPENAI_API_KEY`는 서버에만 저장. `NEXT_PUBLIC_` 접두사 금지, HTTP 응답·JS 번들·로그에 키/원본 프롬프트/비공개 lore 미노출.
- `OPENAI_MODEL`을 환경변수로, 유효한 모델 지원 범위에 맞춰 응답 형식/속도 설정.
- 안정적인 MVP에서는 완성 응답 검수 뒤 전송(비스트리밍) 우선. 스트리밍을 하려면 비공개 정보를 화면으로 먼저 흘린 후 검수하는 문제 해결 필요.
- 구조화 출력: 서버가 `action_intent, segments, state_delta` 검증 가능하도록 구현. Structured Outputs는 JSON 구조 준수에 도움되나 **캐릭터 품질 검증을 대신하지 못함**.
- 채팅 저장은 **우리 DB가 진실의 원천**. OpenAI Responses의 `previous_response_id` 등 제공 기능에만 영구 기억을 맡기지 말 것. 저장 옵션 및 데이터 보존 정책은 실제 SDK/서비스 문서 확인.
- 프롬프트 caching/문맥 크기·응답 지연·모델 요금은 시범 대화로 계측. 검수용 재호출은 오류가 있을 때만.

## 운영/배포
- 먼저 로컬 테스트 결과 보고.
- 외부 서비스를 생성·연결·프로덕션 배포하는 행위, 비용 발생 가능 설정은 사용자 승인 필요.
- 외부 공개라면 Auth/세션·RLS/DB 권한 검사·rate limit·금전 한도·개인정보 및 채팅 삭제 기능 필수.
- UI/데이터/개발 로그는 사야카 프로젝트만의 이름공간을 사용할 것.

## API 문서 참조 (Claude가 구현 시 재확인)
- https://platform.openai.com/docs/api-reference/responses
- https://platform.openai.com/docs/guides/structured-outputs
- https://platform.openai.com/docs/guides/conversation-state
- https://platform.openai.com/docs/overview

※ 위 링크는 구현 시 참고용이며 모델 기능·가격·SDK 필드는 변동 가능. 현재 공식 문서를 기준으로 검증하고 근거를 남길 것.
