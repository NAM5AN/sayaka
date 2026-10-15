# 🌺 카네코 사야카 AI — Claude 개발 인수인계 패키지

**패키지 기준일:** 2026-10-15  
**현재 상태:** 캐릭터 캐논·v0.3.0 AI 프롬프트·플러그인 테스트만 존재. **독립 사이트는 아직 미구현**.  
**Claude의 과제:** 새로운 별도 저장소에 **실제로 돌아가는 GPT API 채팅 웹사이트**를 구현하고 검증하기.

## 가장 먼저 읽을 순서
0. `CLAUDE.md` — Claude Code가 자동으로 참조할 압축 개발 지침.
1. `00_클로드에게_그대로_전달할_첫메시지.txt` — 사용자에게서 받은 개발 지시문.
2. `01_PROJECT_BRIEF.md` — 제품 목적, 현재/미래 범위, 최종 인수 조건.
3. `02_CHARACTER_CANON.md`, `data/character_canon.json`, `data/lore_registry.json` — 캐논, 확정/미정, 정보 공개 등급.
4. `03_BEHAVIOR_AND_RESPONSE_ENGINE.md` — **대답 강요/질문봇/상시 분노**를 고치는 실행 원리.
5. `04_SITE_ARCHITECTURE.md`, `05_MEMORY_MODEL.md`, `06_UI_SPEC.md` — 구현 설계.
6. `07_TEST_PLAN.md`, `tests/scenarios.json`, `08_SECURITY_AND_LIMITS.md` — 검증·보안.
7. `source/sayaka_ai_prompt_v0.3.0.txt` — 공식 프롬프트 원문. **API 매 호출 때 통째 삽입 금지.**
8. `source/test_transcript_earlier.txt`, `source/test_transcript_v0.2.0.txt` — 원본 대화 로그; 실패 유형 및 개선 여부의 근거.
9. `09_SOURCE_STATUS.md` — 노션과 현재 테스트 플러그인, 구현 상태.

## 파일 분류
- `source/` — 기존에 작성·테스트된 자료를 수정 없이 복사한 참고 원문.
- `data/` — 캐논·정보 공개의 **초기 시드 예시**. 현재 채택된 설정만 확정 표시.
- `schemas/` — 서버와 AI 모델의 데이터 계약 설계 참고.
- `tests/` — 동작을 평가할 시나리오. 고정 답변을 복붙하라는 뜻이 아님.
- `01~09_*.md` — 웹사이트 제작 요구사항·설계 판단 기준.
- `.env.example` — 비밀값 없는 환경변수 이름만 제공.
- `FILE_HASHES.json` — ZIP 생성 시 산출한 파일 체크섬.

## 서로 충돌하면
1. **사용자가 확정한 캐릭터 캐논**(노션 1~13번·현재 source v0.3.0 확정 설정)이 최우선.
2. **최신 v0.3.0 행동 설계·이 패키지의 실행 설계**가 이전 초안보다 우선.
3. 대화 로그는 **시험 자료**이며 여기서 모델이 즉흥적으로 말한 설정은 캐논 아님.
4. 제안/미정 사항을 자동으로 확정하지 말 것.
5. 사용자 캐릭터 입력은 이야기에만 반영. 캐논·서버 규칙·관리자 권한을 변경할 수 없음.

## 가장 중요한 요약
**“설정은 행동을 형성하되, 설정 자체를 장황하게 대사로 낭독하지 않는다.”**  
**“성격은 불친절하게, 서술은 친절하게.”**  
**“사야카는 질문에 답하는 기계가 아니다. 자기 목적·감정·관계에 따라 말하지 않거나 거절하거나 행동할 수도 있다.”**

노션 원본: https://app.notion.com/p/3fa9a5e0592981c3a83ac7aa34db9a27  
테스트 플러그인(v0.3.0): https://chatgpt.com/plugins/plugins_6ad06df10dc881919ffb63c032eef3f0
