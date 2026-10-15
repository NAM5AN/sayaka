import { DISCLOSABLE_IDS, LEAK_GUARDS, loreById } from "./canon";
import { dialogueText, allText } from "./format";
import type {
  ItemId,
  ItemLocation,
  MemoryEntry,
  ModelTurn,
  RelationshipStage,
  RelationshipState,
  SceneState,
  Segment,
  TurnContext,
} from "./types";

/**
 * 모델의 state 제안을 서버 규칙으로 검증해 다음 상태를 만든다. (순수 함수)
 * 모델 제안은 '제안'일 뿐이며, 불가능한 이동·근거 없는 공개·자동 호감 상승은 여기서 걸러진다.
 */

export interface NewMemory {
  kind: MemoryEntry["kind"];
  target: string;
  value: string;
  text: string;
}

export interface ApplyResult {
  scene: SceneState;
  relationship: RelationshipState;
  newMemories: NewMemory[];
  deactivateMemoryIds: string[];
  newDisclosures: string[];
  corrections: string[];
}

const ALLOWED_LOCATIONS: Record<ItemId, ItemLocation[]> = {
  vase: ["windowsill", "in_sayaka_hand", "on_surface", "offered_to_user", "with_user", "elsewhere"],
  kinchaku: ["in_sayaka_hand", "on_sayaka_person", "in_sayaka_bag", "behind_sayaka_back", "on_surface", "offered_to_user", "with_user", "elsewhere"],
  pocket_watch: ["inside_kinchaku", "in_sayaka_hand", "on_sayaka_person", "in_sayaka_bag", "behind_sayaka_back", "on_surface", "offered_to_user", "with_user", "elsewhere"],
  mychew: ["in_sayaka_hand", "on_sayaka_person", "in_sayaka_bag", "behind_sayaka_back", "on_surface", "offered_to_user", "with_user", "elsewhere"],
  lacquer_comb: ["in_sayaka_hand", "on_sayaka_person", "in_sayaka_bag", "behind_sayaka_back", "on_surface", "offered_to_user", "with_user", "elsewhere"],
  urushi_pen: ["in_sayaka_hand", "on_sayaka_person", "in_sayaka_bag", "behind_sayaka_back", "on_surface", "offered_to_user", "with_user", "elsewhere"],
};

const VISIBLE: ItemLocation[] = ["in_sayaka_hand", "on_surface", "offered_to_user", "with_user", "windowsill"];

/** 사용자 입력에 '받았다/가져갔다'는 확정 행동이 있는가 */
export function userTookSomething(userText: string): boolean {
  return /받(?:는다|았|아\s?든|아\s?들|아\s?쥔|아)|가져간|가져갔|집어\s?든|집어\s?들|낚아채|빼앗|뺏|손에\s?쥔|건네받/.test(userText);
}

export function userGaveBack(userText: string): boolean {
  return /돌려\s?준|돌려줬|돌려\s?줄|돌려\s?드|건넨다|건네준|건네줬|내민다|여기\s?있어/.test(userText);
}

function stageFor(rel: RelationshipState, turnIndex: number): RelationshipStage {
  if (rel.trust >= 4) return "trusted";
  if (rel.trust >= 2) return "friendly";
  if (rel.trust >= 1 || turnIndex >= 8) return "acquainted";
  return "strangers";
}

function clamp(n: number): number {
  return Math.max(0, Math.min(5, n));
}

/** 2글자 이상 한글/영문 토큰 */
function tokens(s: string): string[] {
  return (s.match(/[가-힣A-Za-z0-9]{2,}/g) ?? []).map((t) => t.toLowerCase());
}

/** user_claim 이 실제 사용자 입력에 근거하는지 (지어낸 사용자 정보 방지) */
export function claimGrounded(claim: { value: string; text: string }, userText: string): boolean {
  const u = userText.toLowerCase();
  if (claim.value) {
    const v = claim.value.trim().toLowerCase();
    if (v.length >= 1 && u.includes(v)) return true;
    // "아오이야" 처럼 조사가 붙은 경우
    const core = v.replace(/(?:이야|야|이에요|예요|입니다|이라고|라고|이)$/u, "");
    if (core.length >= 1 && u.includes(core)) return true;
    return false;
  }
  const ct = tokens(claim.text);
  const ut = new Set(tokens(userText));
  return ct.some((t) => ut.has(t) || [...ut].some((x) => x.length >= 2 && (t.includes(x) || x.includes(t))));
}

function hasEvidence(loreId: string, segments: Segment[]): boolean {
  const e = loreById(loreId);
  if (!e) return false;
  const d = dialogueText(segments);
  const words = e.runtime.evidence ?? [];
  if (!words.length) return d.length > 0;
  return words.some((w) => d.includes(w));
}

export function applyTurn(ctx: TurnContext, turn: ModelTurn, segments: Segment[]): ApplyResult {
  const corrections: string[] = [];
  const scene: SceneState = structuredClone(ctx.scene);
  const rel: RelationshipState = structuredClone(ctx.relationship);
  const t = ctx.turnIndex;

  // --- 장면: 사야카 ---
  scene.version += 1;
  scene.sayaka.emotion = turn.emotion;
  // 조용히 지켜보기만 했고 사야카도 반응하지 않았다면 아직 못 알아챘을 수 있다
  const quietUser = turn.user_move === "silence_or_watching" || turn.user_move === "action_only";
  const reacted = ["reply", "partial_reply", "refuse", "ask", "intervene", "leave"].includes(turn.action_intent);
  scene.sayaka.noticed_user = scene.sayaka.noticed_user || !quietUser || reacted;
  if (turn.sayaka_present === "leaves") {
    scene.sayaka.present = false;
    scene.sayaka.position = "자리를 떠남";
  } else if (!scene.sayaka.present) {
    scene.sayaka.present = true; // 다시 마주침
  }
  if (turn.sayaka_position && scene.sayaka.present) scene.sayaka.position = turn.sayaka_position;
  if (turn.sayaka_goal) scene.sayaka.goal = turn.sayaka_goal;
  const narr = segments.filter((s) => s.kind === "narration").map((s) => s.text);
  if (narr.length) scene.sayaka.current_action = narr[narr.length - 1].slice(0, 120);

  // --- 장면: 킨차쿠 열림 ---
  if (turn.kinchaku_open === "opened") scene.kinchaku_open = true;
  if (turn.kinchaku_open === "closed") scene.kinchaku_open = false;

  // --- 장면: 물건 이동 (합법 전이만) ---
  const took = userTookSomething(ctx.userText);
  const gaveBack = userGaveBack(ctx.userText);
  for (const ch of turn.item_changes) {
    const before = scene.items[ch.item];
    if (!before) continue;
    let to = ch.location;
    if (!ALLOWED_LOCATIONS[ch.item].includes(to)) {
      corrections.push(`${ch.item}: 허용되지 않는 위치(${to}) → 무시`);
      continue;
    }
    if (ch.item === "pocket_watch" && before.location === "inside_kinchaku" && to !== "inside_kinchaku" && !scene.kinchaku_open) {
      // 열지 않은 킨차쿠에서 꺼냄 → 꺼내는 행동이 있었다면 킨차쿠를 연 것으로 간주
      scene.kinchaku_open = true;
      corrections.push("pocket_watch: 킨차쿠가 닫혀 있었음 → 열린 것으로 보정");
    }
    if (to === "with_user" && before.location !== "offered_to_user" && before.location !== "with_user" && !took) {
      to = "offered_to_user";
      corrections.push(`${ch.item}: 상대가 받았는지 확정되지 않음 → offered_to_user`);
    }
    if (before.location === "with_user" && to !== "with_user" && to !== "elsewhere" && !gaveBack) {
      // 사야카가 낚아채는 '시도'는 가능하지만 결과는 상대가 정한다
      if (to === "in_sayaka_hand") {
        corrections.push(`${ch.item}: 상대가 가진 물건을 되찾았는지 미확정 → 유지`);
        continue;
      }
    }
    scene.items[ch.item] = { location: to, shown_to_user: before.shown_to_user || VISIBLE.includes(to) };
  }
  // 회중시계가 킨차쿠 밖으로 나오지 않았는데 킨차쿠가 닫히면 그대로, 시계를 다시 넣으면 OK
  // 상대가 '받았다'고 쓴 경우: 내밀어 둔 물건은 상대 소유로
  if (took) {
    for (const id of Object.keys(scene.items) as ItemId[]) {
      if (ctx.scene.items[id].location === "offered_to_user" && scene.items[id].location === "offered_to_user") {
        scene.items[id] = { location: "with_user", shown_to_user: true };
      }
    }
  }

  // --- 관계: 이벤트 기반, 축별 독립, 턴당 1단계, 신뢰는 느리게 ---
  const seen = new Set<string>();
  let annoyanceMoved = false;
  for (const sig of turn.relationship_signals) {
    if (seen.has(sig.axis)) continue;
    seen.add(sig.axis);
    const reason = sig.reason.trim();
    if (!reason) {
      corrections.push(`관계 ${sig.axis}: 이유 없는 변화 → 무시`);
      continue;
    }
    let delta = sig.direction === "up" ? 1 : -1;
    if (sig.axis === "trust" && delta > 0) {
      if (t - rel.last_trust_up_turn < 6) {
        corrections.push("관계 trust: 최근에 이미 올랐음(6턴 이내) → 보류");
        continue;
      }
      if (turn.user_move === "gift_or_offer" || turn.user_move === "compliment") {
        corrections.push("관계 trust: 선물·칭찬만으로는 신뢰가 오르지 않음 → 보류");
        continue;
      }
      rel.last_trust_up_turn = t;
    }
    if (sig.axis === "wariness" && delta < 0) {
      if (t - rel.last_wariness_down_turn < 3) {
        corrections.push("관계 wariness: 경계는 천천히 풀림(3턴 이내 재하락) → 보류");
        continue;
      }
      rel.last_wariness_down_turn = t;
    }
    if (sig.axis === "annoyance") annoyanceMoved = true;
    const before = rel[sig.axis];
    const after = clamp(before + delta);
    if (after !== before) {
      rel[sig.axis] = after;
      rel.history.push({ turn: t, axis: sig.axis, delta: after - before, reason: reason.slice(0, 120) });
    }
  }
  // 짜증은 자극이 없으면 자연히 가라앉는다
  if (!annoyanceMoved && rel.annoyance > 0 && !["tease", "provocation"].includes(turn.user_move)) {
    rel.annoyance = clamp(rel.annoyance - 1);
  }
  rel.history = rel.history.slice(-30);

  // --- 기억 후보 ---
  const newMemories: NewMemory[] = [];
  const existingTexts = new Set(ctx.memories.map((m) => `${m.kind}|${m.text}`));
  for (const mc of turn.memory_candidates) {
    const text = mc.text.trim();
    if (!text) continue;
    if (existingTexts.has(`${mc.kind}|${text}`)) continue;
    if (mc.kind === "user_claim") {
      if (!claimGrounded(mc, ctx.userText)) {
        corrections.push(`기억(user_claim) 거부: 이번 사용자 입력에 근거 없음 — ${text.slice(0, 40)}`);
        continue;
      }
      if (mc.target === "user_name" && mc.value) rel.user_name = mc.value.slice(0, 30);
      newMemories.push({ kind: "user_claim", target: mc.target, value: mc.value, text: `(상대 주장) ${text}` });
      continue;
    }
    if (mc.kind === "improvised_detail") {
      // 즉흥 발언은 이 방 기억으로만. 대사에 실제로 나온 경우만 기록
      if (!allText(segments).length) continue;
      newMemories.push({ kind: "improvised_detail", target: mc.target, value: mc.value, text });
      continue;
    }
    // 비밀·수치 단어가 기억 텍스트로 새어 들어가지 않게
    const leaky = [...LEAK_GUARDS.family_secret_terms, ...LEAK_GUARDS.unknown_figure_terms, ...LEAK_GUARDS.future_terms].some((w) => text.includes(w));
    if (leaky && !ctx.disclosures.length) {
      corrections.push("기억 후보에 비공개 단어 포함 → 거부");
      continue;
    }
    newMemories.push({ kind: mc.kind, target: mc.target, value: mc.value, text });
  }

  // 거절 번복 이유가 있으면 해당 거절 해제
  const deactivateMemoryIds: string[] = [];
  if (turn.refusal_reversal_reason.trim()) {
    const revealed = new Set(
      turn.item_changes.filter((c) => VISIBLE.includes(c.location)).map((c) => c.item as string),
    );
    for (const m of ctx.memories) {
      if (m.kind === "refusal" && m.active && (revealed.has(m.target) || turn.disclosure_ids.length)) deactivateMemoryIds.push(m.id);
    }
  }

  // --- 공개 기록: B 등급 + 대사 근거 + (가린 정보가 아니었어야 함) ---
  const newDisclosures: string[] = [];
  const already = new Set(ctx.disclosures.map((d) => d.lore_id));
  for (const id of turn.disclosure_ids) {
    if (!DISCLOSABLE_IDS.includes(id) || already.has(id)) continue;
    const e = loreById(id);
    if (!e) continue;
    if (e.runtime.send === "gated_fact" && ctx.relationship.trust < (e.runtime.min_trust ?? 5)) {
      corrections.push(`공개 ${id}: 신뢰 조건 미충족 → 기록하지 않음`);
      continue;
    }
    if (!hasEvidence(id, segments)) {
      corrections.push(`공개 ${id}: 대사에 근거 없음 → 기록하지 않음`);
      continue;
    }
    newDisclosures.push(id);
  }

  rel.stage = stageFor(rel, t);
  return { scene, relationship: rel, newMemories, deactivateMemoryIds, newDisclosures, corrections };
}
