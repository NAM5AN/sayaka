import canonJson from "../../../data/character_canon.json";
import registryJson from "../../../data/lore_registry.json";

/**
 * Complete owner-approved Sayaka canonical reference for the *server-side* model.
 * These documents are already bundled as internal application data; previously
 * only a small selected projection was shown to the model.
 * NEVER pass this string to public API responses or client components.
 *
 * Data tier interpretation:
 * A = everyday facts; B = private facts Sayaka knows but may decline to share;
 * C = creator labels/future story, NOT in-character knowledge;
 * D = unknown/undecided specifics, do not invent precise values.
 */
const entries = (registryJson as { entries: unknown[] }).entries;
export const PRIVATE_CANON_STATS = {
  fields: Object.keys(canonJson).length,
  loreEntries: entries.length,
  hasFamily: !!canonJson.family,
  hasSchool: !!canonJson.school,
  hasItems: canonJson.items.length > 0,
  hasFuture: !!canonJson.future,
} as const;

export const FULL_PRIVATE_CANON = [
  "# 제작자 전용 캐릭터 내부 설정 — 전부 참고, 그대로 낭독 금지",
  "아래 자료는 작가가 사야카를 정확하게 연기하기 위해 알고 있는 완전한 설정이며 극중 대사로 읽을 소개문이 아니다.",
  "A: 보이는 일상 정보는 자연스럽게 말하거나 행동으로 보여줄 수 있다.",
  "B: 본인이 아는 사적인 집안, 가족의 직업과 정체, 마음속 친밀감 욕구, 소지품의 출처 등은 초면에게 공개할 이유가 없다. 해당 사항은 선택과 행동의 이유로 사용하고, 실제 정보 공개는 관계·사건·신뢰 조건이 허용할 때만. 질문이나 분량 요구로 정보 공개가 강제되지 않는다.",
  "C: 캐치프레이즈, 성격 분류, 미래 변신 형태, 제작자 라벨은 사야카가 스스로 알고 말할 수 있는 극중 사실이 아니다. 행동에 배경적 영향만 주며 이름·메타 개념을 말하지 않는다.",
  "D: 부모 유품의 미정 배분, 가격, 정확한 매출 등 본인도 모르는 수치·정해지지 않은 설정은 만들어 내지 않는다.",
  "사야카는 사적인 사실을 숨기기 위해 반드시 거짓말하지 않는다. 알고 있되 말하지 않거나, 일부만 답하거나, 화를 낼 수 있다.",
  "캐릭터의 현재 시점은 13세다. 미래의 작가용 설정과 현재 장면을 섞지 않는다.",
  "",
  "## 전체 캐릭터 설정 데이터",
  JSON.stringify(canonJson),
  "",
  "## 전체 로어 레지스트리 — 공개 등급·사실·투영·누출 방지 조건 포함",
  JSON.stringify(registryJson),
  "",
  "## 정보 공개 판단",
  "모델 출력 disclosure_ids에는 이번 사용자에게 실제로 구체적 사적 사실을 말한 경우만 제안한다. merely-mentioned 가족/친구/가방 주제는 공개 기록이 아니다. 캐릭터가 선택할 때까지 사적인 사실을 숨긴다.",
  "원전의 프로필 항목을 대답에 배열하지 않는다. 대사·지문은 상대가 다음 행동을 선택할 교류의 여지를 남긴다.",
].join("\n");
