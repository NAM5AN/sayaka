# sayaka-chat 작업 지침 (Claude Code 용)

카네코 사야카(13살) 1:1 역할극 사이트. Next.js 16 + OpenAI Responses API + Postgres(로컬은 PGlite).
원본 요구사항: `docs/handoff/` (수정 금지), 구조 결정: `docs/ADR-001-architecture.md`.

## 반드시 지킬 것
- 숙소 릴스(lodging-reels) 저장소·Vercel·Supabase 와 섞지 않는다. 배포·요금 발생 작업은 사용자 승인 후에만.
- `OPENAI_API_KEY` 등 비밀값은 서버 전용. `NEXT_PUBLIC_` 금지. 클라이언트 컴포넌트에서 `src/lib/*` 서버 모듈 import 금지.
- `src/lib/engine/prompt.ts` 의 고정 지침과 `lore_registry.json` 의 runtime 문장에 B/C/D 정보(야쿠자·두목·조직·불요불굴·츤데레·異常·1조·300평 등)를 넣지 않는다. `tests/unit/lore-prompt.test.ts` 가 검사한다.
- v0.3.0 TXT 를 통째로 API 에 넣지 않는다. 설정은 `lore.ts` 가 턴마다 골라서 보낸다.
- 모델의 상태 제안은 `state.ts` 에서 서버 규칙으로 검증한 뒤 반영한다. 관계 자동 상승·근거 없는 사용자 정보·캐논 승격 금지.
- 실패를 사야카의 극 중 응답으로 저장하지 않는다. 키가 없을 때 가짜 응답을 실제처럼 보여 주지 않는다.
- 특정 질문에 정해진 대답을 하드코딩하지 않는다(시나리오는 속성 검사용).

## 명령
- `npm run dev` / `npm run build`
- `npm run check` (tsc + vitest). 실제 Postgres: `TEST_DATABASE_URL=... npm test`
- `npm run db:sql` (마이그레이션 수정 후 db/schema.sql 갱신 — 테스트가 일치 여부를 검사)
- `npm run eval:live` (실제 OpenAI, 비용 발생)
