# 브라우저 E2E 점검 (선택)

`npm test` 에는 포함되지 않는 수동 실행 스크립트예요. 실제 브라우저(Chromium)로 화면 흐름을 확인합니다.

준비: `npm i -D playwright-core` 그리고 Chromium 경로를 `CHROMIUM_PATH` 로 지정(없으면 Playwright 기본 경로).

| 파일 | 하는 일 |
|---|---|
| `browser-flow.mjs` | 로그인 → 새 대화 → 전송 → 진단/상태 → 새로고침 복원 → 삭제, 모바일 폭(375px) 확인. 서버를 `AI_MODE=stub APP_PASSWORD=play-1234 ADMIN_PASSWORD=admin-5678 SESSION_SECRET=<32자+>` 로 `:3100` 에 띄운 뒤 실행 |
| `mock-openai.mjs` | OpenAI HTTP API 흉내 서버(`:4010`). 실제 SDK 요청 형식을 `mock-requests.jsonl` 에 기록하고, 첫 응답에 일부러 비밀 누출을 넣어 재생성 경로를 확인 |
| `browser-errors.mjs` | 시간 초과 → 오류 배너 → 같은 요청 ID 로 다시 보내기, API 키 미설정 안내. 앱을 `OPENAI_BASE_URL=http://127.0.0.1:4010/v1 OPENAI_TIMEOUT_MS=5000` 로 `:3101`, 키 없는 앱을 `:3102` 에 띄운 뒤 실행 |

| `browser-settings.mjs` | 설정 보기 모달(캐릭터·지침·등급표·첫 장면·출력 형식·상태 블록), 비밀번호 변경·옛 비밀번호 거부·일반 사용자 차단, 모바일 모달 크기. `browser-flow.mjs` 와 같은 서버(:3100)를 **새 DB 로** 띄운 뒤 실행(비밀번호를 바꾸므로) |

스크린샷은 `OUT=<폴더>` 에 저장돼요. 스텁·모의 서버 응답은 실제 GPT 품질 검증이 아니에요.
