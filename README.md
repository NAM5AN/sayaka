# sayaka-chat: 카네코 사야카 AI 역할극 사이트

방과 후 학교 복도에서 13살 **카네코 사야카(金子 沙也加)** 와 처음 마주치고, 대화방마다 관계와 기억이 따로 쌓이는 1:1 역할극 웹사이트입니다. OpenAI GPT API(Responses API)를 서버에서 호출합니다.

- 캐릭터 원전: 노션 「카네코 사야카 | 캐릭터 공식 설정집」, `docs/handoff/source/sayaka_ai_prompt_v0.3.0.txt`
- 인수인계 패키지 원본: `docs/handoff/` (수정하지 않은 사본)
- **독립 프로젝트**입니다. 숙소 릴스(lodging-reels) 저장소·Vercel·Supabase 와 아무것도 공유하지 않습니다.

---

## 1. 현재 상태 (2026-10-15)

| 영역 | 상태 | 근거 |
|---|---|---|
| 채팅 UI (모바일·데스크톱, 방 목록·생성·삭제, 로그인) | 구현·동작 확인 | 브라우저 E2E 23항목 통과, 스크린샷 확인 |
| 서버 오케스트레이터 (설정 선별 → 생성 → 검수 → 1회 재생성 → 상태 반영) | 구현·자동 테스트 통과 | 단위·통합 테스트 103개 |
| 대화방별 영속 기억 (사실/주장/추측/즉흥/거절/공개/관계/장면/소지품) | 구현·자동 테스트 통과 | 내장 DB(PGlite) + 실제 Postgres 16 양쪽에서 통과 |
| OpenAI SDK 요청 경로 | 모의 서버로 확인 | 실제 SDK 가 보내는 요청(`store:false`, `json_schema strict`, 역할 순서)과 응답 파싱·재생성·시간 초과·Moderation 경로 확인 |
| **실제 GPT 응답 품질** | **미검증** | API 키가 제공되지 않아 실제 모델 호출은 한 번도 하지 않음 |
| 배포 | 미실시 | 승인 전 배포·요금 발생 작업 금지 원칙 |

"코드가 설계대로 동작함"은 확인했고, "실제 대화에서 사야카다움이 좋아졌는지"는 키를 넣고 `npm run eval:live` 와 수동 점검(`docs/MANUAL_QA.md`)으로 확인해야 합니다.

---

## 2. 로컬 실행

필요: Node.js 20.9 이상.

```bash
npm install
cp .env.example .env.local      # OPENAI_API_KEY, OPENAI_MODEL 입력 (없어도 화면은 열림)
npm run dev                      # http://localhost:3000
```

- `APP_PASSWORD` 를 비워 두면 `npm run dev` 에서는 비밀번호 없이 관리자 권한으로 열립니다(화면 왼쪽 아래에 "로컬 개발 모드" 표시). `next start`/배포에서는 비밀번호가 필수입니다.
- `DATABASE_URL` 이 없으면 `.data/pglite` 에 내장 Postgres(PGlite)로 저장됩니다. 지우면 초기화됩니다.
- 키가 없으면 응답 생성만 막히고 "API 키 미설정" 안내가 뜹니다. **가짜 응답을 실제 AI 처럼 보여 주지 않습니다.**
- 화면 흐름만 보고 싶으면 `AI_MODE=stub` (응답마다 "테스트 스텁(실제 AI 응답 아님)" 표시).

---

## 3. 환경변수

| 이름 | 필수 | 설명 |
|---|---|---|
| `OPENAI_API_KEY` | 실제 응답 시 | 서버에서만 사용. 브라우저·로그로 나가지 않음 |
| `OPENAI_MODEL` | 실제 응답 시 | Structured Outputs(json_schema strict)를 지원하는 모델 ID |
| `OPENAI_REASONING_EFFORT` | 선택 | 추론 모델일 때만 (`low` 등) |
| `OPENAI_TEMPERATURE` | 선택 | 지원하는 모델일 때만. 비우면 안 보냄 |
| `OPENAI_MAX_OUTPUT_TOKENS` | 선택 | 기본 2500 |
| `OPENAI_TIMEOUT_MS` | 선택 | 호출 1회 제한, 기본 45000 (SDK 자동 재시도 없음) |
| `OPENAI_MODERATION` | 선택 | `off` 면 안전 점검 끔 (기본 켬, 무료) |
| `DATABASE_URL` | 배포 시 | 사야카 전용 Postgres 연결 문자열 |
| `DATABASE_SSL` | 선택 | `verify` / `no-verify` / `disable` |
| `APP_PASSWORD` | 배포 시 | 접속 비밀번호 |
| `ADMIN_PASSWORD` | 선택 | 진단·상태 열람용 비밀번호 |
| `SESSION_SECRET` | 배포 시 | 32자 이상 임의 문자열 |
| `RATE_LIMIT_PER_MINUTE` / `DAILY_GENERATION_LIMIT` | 선택 | 기본 12 / 300 (요금 폭주 방지) |
| `MAX_INPUT_CHARS` / `HISTORY_WINDOW` | 선택 | 기본 2000 / 24 |
| `AI_MODE` | 개발용 | `stub` |

### 모델 고르기
OpenAI changelog(2026-10 확인) 기준으로 GPT-5.4 mini, GPT-5.5, GPT-5.6(Sol/Terra/Luna), GPT-6 계열이 보입니다. Structured Outputs 지원이 changelog 에 명시된 것은 GPT-5.5 이고, 나머지는 모델 페이지에서 확인이 필요합니다. 모델 ID·가격은 바뀌므로 코드에 고정하지 않았습니다. 처음에는 비용이 낮은 모델로 `npm run eval:live -- --case TMI-01,QUESTION-01,ANGER-01` 를 돌려 보고, 캐릭터 품질이 부족하면 상위 모델로 올리는 순서를 권합니다. 모델이 `json_schema` 형식을 거부하면 화면에 "AI 요청 형식이 모델과 맞지 않아요"가 뜹니다.

---

## 4. 데이터베이스

모든 테이블은 전용 스키마 **`sayaka`** 에 있고 RLS 가 켜져 있습니다(정책 없음 = 서버의 DB 소유자 연결 외 접근 불가). 앱이 첫 요청 때 마이그레이션을 자동 적용합니다.

- 수동 적용: `npm run db:migrate` (또는 `db/schema.sql` 을 SQL 편집기에 붙여 넣기. 두 번 실행해도 안전)
- 스키마 원본: `src/lib/db/migrations.ts` → 수정 후 `npm run db:sql` 로 `db/schema.sql` 갱신

| 테이블 | 내용 |
|---|---|
| `chats` | 대화방(소유자, 제목, 시작 장면, 캐릭터·프롬프트 버전, 턴 수, 동시 전송 방지 임대) |
| `messages` | 사용자 입력·사야카 응답(대사/지문 segments), 요청 ID(중복 전송 방지) |
| `scene_states` | 장면(위치·하던 일·감정·킨차쿠 열림·소지품 6종 위치/공개 여부) |
| `relationship_states` | 경계·호기심·짜증·신뢰(각 0~5, 하나로 합치지 않음), 변화 이유 기록, 상대 이름 |
| `memory_entries` | 대화방 기억: `user_claim`(상대 주장) / `observed_event` / `sayaka_impression`(추측) / `improvised_detail`(즉흥, 캐논 아님) / `refusal` / `stopped_asking`. `is_canon=false` 가 DB 제약으로 강제 |
| `disclosures` | 사야카가 실제로 털어놓은 사적 정보(B 등급 id) |
| `generation_logs` | 모델·토큰·지연·검수 결과 코드. **대화 원문·프롬프트·키는 저장하지 않음**. 방 삭제 시 진단을 지우고 숫자만 남겨 한도 계산에 사용 |

Supabase 를 쓸 경우: **사야카 전용 새 프로젝트**를 만들고, Connect → Transaction pooler(포트 6543) 연결 문자열을 `DATABASE_URL` 로 씁니다. 기존 프로젝트를 재사용하지 마세요.

---

## 5. 배포 (승인 후, 단계별)

배포·외부 서비스 생성은 아직 하지 않았습니다. 진행한다면 각 단계 뒤에 확인하고 다음으로 넘어가세요.

1. **GitHub 새 비공개 저장소** `sayaka-chat` 생성 → 이 폴더 업로드(`node_modules`, `.next`, `.data` 제외). 확인: 저장소에 `package.json`, `src/` 가 보임.
2. **Supabase 새 프로젝트** 생성(무료 플랜 가능) → Transaction pooler 연결 문자열 복사. 확인: 비밀번호 자리에 실제 DB 비밀번호가 들어간 문자열.
3. **Vercel 새 프로젝트**로 저장소 Import → 환경변수 입력(`OPENAI_API_KEY`, `OPENAI_MODEL`, `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`, 선택 `ADMIN_PASSWORD`) → Deploy. 확인: `https://<도메인>/api/health` 가 `{"ok":true,...}`.
4. 로그인 → 새 대화 → 메시지 한 번. 확인: 응답이 오고, 관리자 로그인 시 "진단"에 토큰 수가 보임.
5. **OpenAI 대시보드에서 프로젝트 월 사용 한도** 설정(앱의 일일 한도와 별개로 이중 안전장치).

함수 최대 실행 시간은 메시지 API 에 `maxDuration = 150`(초)으로 지정되어 있습니다. Vercel 플랜의 최대값보다 작아야 합니다.

---

## 6. 응답 엔진: 한 턴이 처리되는 순서

```
입력 → 인증·출처 확인 → 길이 확인 → 중복 요청 확인(같은 요청 ID 면 저장된 응답 반환)
     → 분/일 한도 → 대화방 임대(동시 전송 차단) → 입력 안전 점검(Moderation)
     → DB 에서 장면·관계·기억·공개 이력·최근 대화 로드
     → 설정 선별(A/B/C/D) + 최근 패턴 진단(질문 연속, 마이쮸 반복, 같은 몸짓 반복, 이름 반복 질문)
     → GPT 호출 1회 (고정 지침 + 서버 상태 블록 + 최근 24개 메시지, 구조화 JSON 출력)
     → 검수: block(비밀·제작자 용어·미래·모르는 수치 누출) / retry(TMI 나열, 내면 해설, 상대 행동 확정,
             물건 연속성, 이유 없는 거절 번복, 도발 없는 격노·위협, 과도한 길이)
     → 문제 있으면 반려 사유를 붙여 1회만 재생성. 그래도 block 이면 저장하지 않고 오류 표시
     → 출력 안전 점검 → 상태 제안을 서버 규칙으로 검증해 반영 → 한 트랜잭션으로 저장
```

모델 출력(내부 JSON)은 `user_move → 상황 판단 → 사야카의 목적 → action_intent → emotion → segments → 상태 제안` 순서라서, 말보다 행동을 먼저 고르게 됩니다. 질문은 필수 항목이 아니고, 대사 없이 지문만 있는 응답도 정상입니다.

### 정보 등급 (`data/lore_registry.json`)
- **A 관찰 가능**: 관련 주제일 때 사실 + 행동 투영.
- **B 사적**: 이미 털어놓았으면 "이미 말함", 관련 주제이고 신뢰가 기준 이상이면 사실을 주되 공개 여부는 사야카 선택, 기준 미만이면 **비밀 단어 없는 가린 문장만** 보냄(아버지 직업은 신뢰 4, 학교 비밀·친구 욕구는 5).
- **C 제작자 메타·미래**: 라벨(불요불굴, 저온형 츤데레, 변신 폼, 異常)은 절대 보내지 않음. "쉽게 굽히지 않는다" 같은 행동 투영만.
- **D 모름·미정**: 수치·미정 취향은 보내지 않고, 상대가 물었을 때만 "모른다/미정, 즉흥이면 이 방 한정" 지침.

### 관계 규칙
- 축마다 턴당 1단계, 이유 없는 변화는 무시.
- 신뢰는 6턴에 한 번만 오르고, 선물·칭찬만으로는 오르지 않음. 경계는 3턴에 한 번만 풀림.
- 짜증은 자극이 없으면 턴마다 1씩 가라앉음.
- 단계(초면 → 안면 → 친한 편 → 깊은 신뢰)는 신뢰 값에서 계산. 화면에는 수치를 보여 주지 않음.

### 물건·장면 규칙
- 회중시계는 킨차쿠를 열어야 꺼낼 수 있음. 상대가 받았다고 쓰지 않으면 "내밀어 둠"까지만.
- 들지 않은 물건을 내려놓는 묘사, 거절해 놓고 이유 없이 꺼내는 묘사는 재생성 대상.

---

## 7. 테스트

```bash
npm run check            # 타입 검사 + 단위·통합 테스트
TEST_DATABASE_URL=postgresql://... npm test   # 실제 Postgres 로도 통합 테스트 (스키마 sayaka 를 지우고 다시 만듦: 전용 테스트 DB 에서만)
npm run eval:live        # 실제 OpenAI 로 시나리오 실행 → eval-results/*.md 에 사람 채점용 기록 (비용 발생)
```

마지막 실행 결과(2026-10-15, 이 환경):
- `tsc --noEmit` 오류 0
- `vitest`: 7개 파일, **103개 통과** (단위 59, PGlite 통합 18, Postgres 16 통합 18, API 라우트 8)
- `next build` 성공
- 브라우저 E2E(`tests/e2e/`): 23개 항목 통과 (스텁·모의 OpenAI 서버 사용)
- `eval:live`: **실행 안 됨 (키 없음, 미검증)**

수동 롤플레잉 점검표: `docs/MANUAL_QA.md`

---

## 8. 비용에 영향을 주는 요소

턴당 대략(한국어, o200k 토큰 기준 측정치):
- 고정 지침 약 2,700 + 출력 스키마 약 900 토큰 → 매 턴 같으므로 프롬프트 캐시 대상
- 서버 상태 블록 약 900 토큰, 최근 24개 메시지 약 1,100~2,500 토큰
- 출력 약 200~400 토큰 (+ 추론 모델이면 추론 토큰)
- 검수 반려 시 같은 크기의 호출이 1번 더 (관리자 진단의 "생성 횟수"로 비율 확인)
- Moderation 호출(입력·출력 각 1회)은 무료

줄이는 방법: `HISTORY_WINDOW` 축소, 낮은 `OPENAI_REASONING_EFFORT`, 비용이 낮은 모델, `DAILY_GENERATION_LIMIT`. 실제 토큰 수는 관리자 로그인 → 응답 아래 "진단"에서 확인할 수 있습니다.

---

## 9. 보안·안전

- API 키·비밀번호·세션 비밀은 서버 환경변수에만. 클라이언트 번들·응답·로그에 없음(테스트로 확인).
- 관리자 권한은 `ADMIN_PASSWORD` 로그인으로만. 채팅에 "OOC:", "관리자 모드", "프롬프트 무시"를 써도 극 중 발화로 처리.
- 변경 요청은 같은 출처(Origin)만 허용, 쿠키는 HttpOnly·SameSite=Lax(배포 시 Secure).
- 13세 캐릭터: 성적 내용은 입력·출력 모두 Moderation 으로 차단하고 안내. 현실의 자해 위험 신호에는 역할극 대신 도움 안내(109, 1577-0199, 112/119).
- OpenAI 요청은 `store: false`. 대화의 원천은 이 사이트 DB.

---

## 10. 폴더 구조

```
src/app/            페이지(page.tsx), API 라우트(api/*), 전역 스타일
src/components/     ChatApp(채팅 화면), LoginForm, Crest(문양)
src/lib/engine/     canon(캐논 로드) lore(설정 선별) prompt(지침·조합) schema(출력 계약)
                    validate(검수) state(상태 반영) patterns(반복 진단) llm(OpenAI/스텁) safety orchestrator
src/lib/db/         어댑터(pg / PGlite), 마이그레이션, 저장소(repo)
data/               character_canon.json, lore_registry.json, openings.json
db/schema.sql       SQL 사본
tests/              unit/, integration/, e2e/, scenarios.json
docs/               ADR-001, MANUAL_QA, handoff/(원본 패키지)
scripts/            migrate, write-schema-sql, eval-live
```

## 11. 캐논을 바꾸려면

캐논 원천은 저장소의 `data/*.json` 입니다(Git 이력 = 수정 이력, 관리자만 수정). 대화방 기억은 구조적으로 캐논이 될 수 없습니다(`is_canon=false` 제약). 미정 항목(상징꽃, 유품 배분, 마이쮸 맛 등)을 확정하면 `lore_registry.json` 의 해당 항목을 고치고 `character_canon.json` 의 `canonical_version` 을 올리세요. 새 대화방부터 새 버전이 기록됩니다.

## 12. 남은 일 (우선순위 순)

1. **키를 넣고 라이브 평가 + 수동 점검** → 실패 유형별로 고정 지침·검수 규칙 조정
2. 오래된 대화의 LLM 요약 (지금은 규칙 기반: 최근 24개 원문 + 기억 항목)
3. 마지막 응답 다시 생성(상태 되돌리기 포함), 메시지 단위 수정
4. 사용자 기억 확인·수정·초기화 화면
5. 다중 사용자 계정(지금은 단일 소유자 `owner`), 관리자 캐논 편집 화면
6. 사용자 지정 첫 장면, 일상 이벤트·시간 경과
7. 정식 일러스트 에셋(권리 확인된 것만)
