# ADR-001: sayaka-chat 초기 구조 결정

- 상태: 채택 (2026-10-15)
- 범위: MVP (인수인계 패키지 01~09 문서 기준)

## 1. 스택
**Next.js 16 (App Router) + TypeScript + OpenAI 공식 JS SDK(Responses API) + Postgres.**
- 근거: 패키지 04 권장값과 일치, 사용자가 Vercel/GitHub 웹 UI 로 운영하는 방식에 맞음, 서버 라우트에서 키를 보관하기 쉬움.
- SDK: `openai@7` 의 타입 정의로 `responses.create` 필드(`instructions`, `input`, `store`, `text.format`, `reasoning`, `safety_identifier`, `prompt_cache_key`)와 오류 클래스를 확인한 뒤 사용.

## 2. DB: Postgres + 로컬 내장 PGlite 이중 어댑터
- `DATABASE_URL` 이 있으면 `pg`, 없으면 PGlite(WASM Postgres, `.data/pglite`).
- 같은 SQL 을 쓰므로 키·DB 없이도 실제와 같은 저장 로직을 실행·테스트할 수 있음. Vercel 에서는 PGlite 사용을 막음(휘발성 파일시스템).
- 전용 스키마 `sayaka` + 모든 테이블 RLS 활성(정책 없음). Supabase 를 써도 Data API(anon 키)로 노출되지 않게.
- 마이그레이션은 앱이 첫 요청 때 advisory lock 아래에서 자동 적용(비개발자 운영 편의). `db/schema.sql` 은 같은 내용의 사본.

## 3. 캐논 저장 위치: DB 가 아니라 저장소 JSON
- `data/character_canon.json`, `data/lore_registry.json`. 관리자만 수정(Git 커밋), 수정 이력 = Git 이력.
- 대화방 기억(`memory_entries`)은 `is_canon=false` CHECK 제약으로 캐논 승격이 구조적으로 불가.
- 대안(DB `lore_catalog` + 관리자 화면)은 후속. MVP 에서는 편집 UI 보다 버전 관리가 안전.

## 4. 한 턴 = 기본 1회 호출
- 패키지 03 의 권장대로 "행동 선택 + 출력 + 상태 제안"을 한 번의 구조화 출력으로 받음.
- 스키마 속성 순서를 `user_move → situation_read → sayaka_want → action_intent → emotion → segments → 상태 제안` 으로 두어 말보다 행동을 먼저 정하게 함.
- 검수에서 문제가 있을 때만 반려 사유를 붙여 1회 재생성. 별도 검수 모델 호출은 두지 않음(비용·지연). 재생성 후에도 block 등급이면 저장하지 않고 오류.

## 5. 정보 차단은 "말하지 마"보다 "보내지 않기"
- C(제작자 라벨·미래)는 런타임 입력에서 제외, 행동 투영만.
- B(아버지 직업 등)는 신뢰 기준 미만이면 비밀 단어가 없는 '가린 문장'만 전송 → 모델이 꾸며내지 않고 피하도록.
- D(모르는 수치·미정)는 사실을 보내지 않고 "모른다/미정" 지침만.
- 고정 지침에도 B/C/D 단어가 없음을 단위 테스트로 보장. 출력 쪽에서도 같은 단어 목록으로 누출 검사(이중 방어).

## 6. 상태 변경은 서버가 승인
- 모델의 `item_changes`, `relationship_signals`, `memory_candidates`, `disclosure_ids` 는 제안.
- 서버 규칙: 허용 위치표, 닫힌 킨차쿠 보정, 상대가 받지 않은 물건은 '내밀어 둠', 이유 없는 관계 변화 무시, 신뢰 상승 6턴 간격·선물/칭찬 단독 불인정, 짜증 자연 감소, 상대 주장은 이번 입력에 근거가 있을 때만, 공개 기록은 신뢰 기준 + 대사 근거.

## 7. 인증: 단일 소유자 + 비밀번호 세션
- 자캐커뮤 캐입용 개인 사이트라는 사용 맥락에 맞춰 계정 시스템 대신 `APP_PASSWORD`(이용) / `ADMIN_PASSWORD`(진단) 두 비밀번호, HMAC 서명 쿠키.
- 모든 데이터에 `owner_id` 를 두고 쿼리마다 소유 확인 → 다중 사용자 확장 시 세션의 owner 만 바꾸면 됨.
- 관리자 권한은 채팅 텍스트로 절대 얻을 수 없음(OOC 는 극 중 발화).

## 8. 스트리밍하지 않음
- 검수 전에 비공개 정보가 화면에 흘러나가는 것을 막기 위해 완성 응답을 검수한 뒤 전송.

## 9. 동시성·중복
- 대화방 임대(`lease_until`)로 한 방에 한 생성만. 클라이언트 요청 ID + 유니크 인덱스로 재전송 시 모델 재호출 없이 저장된 응답 반환.
- 실패 시 사용자 메시지도 저장하지 않음(실패를 사야카의 극 중 행동으로 기록하지 않음). 입력창에 글을 되돌려 같은 요청 ID 로 재시도.

## 10. 안전
- OpenAI Moderation(`omni-moderation-latest`, 무료)으로 입력(성적 내용·자해 의도)과 출력(성적 내용) 점검. 점검 API 실패 시 막지 않고(fail-open) 캐릭터 지침의 안전 규칙이 2차 방어.

## 11. 디자인
- 패키지 06 기본값(먹색·버건디·미색)을 따르되, 사야카의 턴은 말풍선 없이 소설 본문처럼, 사용자 턴은 여백의 메모처럼 구분.
- 꽃 문양은 특정 꽃이 아닌 추상 다섯 잎 문양. 상징꽃(동백·홍매화)은 미확정 캐논이므로 UI 가 캐논을 암시하지 않게 함.

## 미결정·후속
- 모델 ID·추론 노력은 라이브 평가 후 결정.
- 장기 대화 LLM 요약, 재생성, 기억 편집 UI, 다중 사용자, 관리자 캐논 편집.
