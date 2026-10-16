import { DISCLOSABLE_IDS, LEAK_GUARDS, loreById } from "./canon";
import { dialogueText, allText } from "./format";
import { groundedSharedSceneMove, groundedPlayerMove, groundedSayakaDeparture, sayakaActuallyReturned, userForcesSayakaState , playerAuthoredDestination } from "./scene";
import { applyPrivateEvent, getOffscreen, willReunite } from "./offscreen";
import { applyInitiative } from "./initiative";
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
  initiativeProgressed?: boolean;
  privateEventAccepted?: boolean;
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

function stageFor(rel: RelationshipState, turnIndex: number, pluginFidelity: boolean): RelationshipStage {
  if (rel.trust >= 4) return "trusted";
  if (rel.trust >= 2) return "friendly";
  // The plugin-fidelity branch never upgrades familiarity merely from turn count.
  // A known name or a witnessed relaxation of boundaries is an actual event.
  // Remembering a self-introduced name is not equivalent to acquaintance.
  const witnessedConnection = rel.history.some((event) => event.axis === "wariness" && event.delta < 0);
  if (rel.trust >= 1 || (pluginFidelity ? witnessedConnection : turnIndex >= 8)) return "acquainted";
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
export function claimGrounded(claim: { value: string; text: string; target?: string }, userText: string): boolean {
  const u = userText.toLowerCase();
  // A first-person statement of affection is a *user claim*, not evidence
  // that Sayaka returns the feeling or that trust has increased.
  const explicitUserLike = /(?:나는|난|내가|저는|전|제가)\s*(?:사야카|너|널|네가|니가)(?:를|이|가)?\s*(?:좋아|마음에\s*들|호감)/.test(u);
  if (claim.target === "user_other" && explicitUserLike && /좋아|호감|마음/.test(claim.text + " " + claim.value)) return true;
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

/** Model-supplied disclosure IDs are untrusted. A mention of a topic alone is not proof of disclosure. */
function hasEvidence(loreId: string, segments: Segment[]): boolean {
  const e = loreById(loreId);
  if (!e || e.runtime.send !== "gated_fact") return false;
  const d = dialogueText(segments);
  const words = e.runtime.evidence ?? [];
  if (!words.length || !words.some((w) => d.includes(w))) return false;
  const factAssertions: Record<string, RegExp> = {
    family_father: /(?:아빠|아버지).{0,35}(?:조직|두목|보스|우두머리)|(?:조직|두목|보스).{0,35}(?:아빠|아버지)/,
    family_mother: /(?:엄마|어머니).{0,35}(?:기품|품위|우아|아가씨|동경)/,
    friend_wish: /친구.{0,35}(?:사귀|갖고|있었으면|원하|만들|필요)/,
    school_secret: /(?:등교|학교|아저씨|기사).{0,40}(?:조직|경호|차|태워|데려)|(?:조직|경호).{0,40}(?:등교|학교|아저씨|기사)/,
    home_mansion: /(?:우리 집|집|저택).{0,35}(?:저택|넓|정원|크|큰|오래된)|(?:정원|저택).{0,25}(?:우리 집|집)/,
    inherited_items: /(?:부모|아빠|엄마|아버지|어머니).{0,35}(?:물려|유품|선물|받은)|(?:물려받|유품).{0,35}(?:부모|아빠|엄마)/,
  };
  return factAssertions[loreId]?.test(d) ?? false;
}

export function applyTurn(ctx: TurnContext, turn: ModelTurn, segments: Segment[]): ApplyResult {
  const corrections: string[] = [];
  const scene: SceneState = structuredClone(ctx.scene);
  const rel: RelationshipState = structuredClone(ctx.relationship);
  const t = ctx.turnIndex;

  // --- 두 인물의 위치와 사야카의 비공개 생활 ---
  const pluginFidelity = ctx.promptVersion?.includes("plugin-v0.2.0-fidelity") ?? false;
  scene.version += 1;
  scene.sayaka.emotion = turn.emotion;
  const privateResult = pluginFidelity
    ? applyPrivateEvent(ctx, turn, segments)
    : { state: getOffscreen(ctx.scene), accepted: false, correction: null };
  if (privateResult.correction) corrections.push("비공개 행동 상태 불일치: " + privateResult.correction);
  scene.sayaka.offscreen = privateResult.state;
  const privateEvidence = privateResult.accepted
    ? [{ kind: "narration" as const, text: turn.offscreen_event!.action }]
    : [];
  const actionEvidence = [...segments, ...privateEvidence];

  // Player-owned location never changes because Sayaka alone left.
  // Independent movement by the player can separate the two characters.
  let confirmedSharedMove = false;
  let playerMovedAlone = false;
  // A model can omit scene_location. A completed, player-authored arrival
  // still changes the player's own viewpoint when the destination is explicit.
  const playerLocation = pluginFidelity ? playerAuthoredDestination(ctx.userText) : null;
  // Being at the shop door is not the same thing as entering its interior.
  // A model-suggested location must never override this explicit boundary.
  const proposedLocation = playerLocation && /(?:문\s*앞|입구)/.test(playerLocation)
    ? playerLocation : (turn.scene_location?.trim() || playerLocation || "");
  if (proposedLocation && proposedLocation !== ctx.scene.location) {
    const shared = ctx.scene.sayaka.present
      && groundedSharedSceneMove(ctx.userText, proposedLocation, segments, turn.sayaka_position);
    if (shared) {
      scene.location = proposedLocation;
      confirmedSharedMove = true;
    } else if (pluginFidelity && groundedPlayerMove(ctx.userText, proposedLocation)) {
      scene.location = proposedLocation;
      playerMovedAlone = ctx.scene.sayaka.present;
    } else {
      corrections.push("공유 장소 변경 거부: 플레이어의 실제 이동 근거가 없음");
    }
  }

  const reunited = pluginFidelity && !ctx.scene.sayaka.present
    && turn.sayaka_present !== "leaves"
    && (willReunite(ctx, turn, segments) || sayakaActuallyReturned(segments));
  const reacted = ["reply", "partial_reply", "refuse", "ask", "initiate", "intervene", "leave"].includes(turn.action_intent);
  const quietUser = turn.user_move === "silence_or_watching" || turn.user_move === "action_only";
  scene.sayaka.noticed_user = scene.sayaka.noticed_user || !quietUser || reacted;

  if (turn.sayaka_present === "leaves") {
    scene.sayaka.present = false;
    const departure = groundedSayakaDeparture(turn.sayaka_position, segments)
      ? turn.sayaka_position.trim().slice(0, 60) : "";
    if (privateResult.accepted && privateResult.state.location) {
      scene.sayaka.position = privateResult.state.location;
    } else if (departure) {
      scene.sayaka.position = departure;
      scene.sayaka.offscreen.location = departure;
    } else if (ctx.scene.sayaka.present) {
      // Keep a last-known position rather than erasing it forever.
      scene.sayaka.position = "자리를 떠남";
      if (!scene.sayaka.offscreen.location) scene.sayaka.offscreen.location = departure;
    } else {
      scene.sayaka.position = ctx.scene.sayaka.position;
    }
  } else if (reunited) {
    scene.sayaka.present = true;
    scene.sayaka.position = turn.sayaka_position || scene.location;
    scene.sayaka.offscreen.location = scene.sayaka.position;
    // Private events remain internal; only newly visible props may be
    // depicted in the current response.
  } else if (playerMovedAlone) {
    scene.sayaka.present = false;
    const whereSheStayed = ctx.scene.sayaka.position || ctx.scene.location;
    scene.sayaka.position = whereSheStayed;
    scene.sayaka.offscreen.location = ctx.scene.location;
  } else if (ctx.scene.sayaka.present) {
    scene.sayaka.present = true;
    if (turn.sayaka_position) scene.sayaka.position = turn.sayaka_position;
    else if (confirmedSharedMove) scene.sayaka.position = scene.location;
  } else {
    scene.sayaka.present = false;
    // Model-authored public position updates are never accepted in absent
    // scenes. Only a verified private action can move Sayaka independently.
    if (privateResult.accepted && privateResult.state.location) {
      scene.sayaka.position = privateResult.state.location;
    }
  }

  if (turn.sayaka_goal) scene.sayaka.goal = turn.sayaka_goal;
  else if (pluginFidelity && turn.action_intent !== "continue_task" && turn.sayaka_want.trim()) {
    scene.sayaka.goal = turn.sayaka_want.trim().slice(0, 80);
  }
  const narr = segments.filter((seg) => seg.kind === "narration").map((seg) => seg.text);
  if (privateResult.accepted && !scene.sayaka.present) {
    scene.sayaka.current_action = turn.offscreen_event!.action.slice(0, 120);
  } else if (scene.sayaka.present && narr.length) {
    scene.sayaka.current_action = narr[narr.length - 1].slice(0, 120);
  } else if (scene.sayaka.present && pluginFidelity && dialogueText(segments).trim() && turn.action_intent !== "continue_task") {
    scene.sayaka.current_action = "상대에게 말을 건넸다";
  }

  let initiativeProgressed = false;
  if (pluginFidelity) {
    const initiative = applyInitiative(ctx, turn.initiative, actionEvidence);
    scene.sayaka.activity = initiative.activity;
    scene.sayaka.last_activity_outcome = initiative.lastOutcome;
    initiativeProgressed = initiative.progressed;
    corrections.push(...initiative.corrections);
    if (initiative.activity) scene.sayaka.goal = initiative.activity.objective;
    else if (initiative.progressed) scene.sayaka.goal = "현재 진행 중인 장기 목표 없음";
  }

  // --- 장면: 킨차쿠 열림 ---
  if (scene.sayaka.present || privateResult.accepted) {
    if (turn.kinchaku_open === "opened") scene.kinchaku_open = true;
    if (turn.kinchaku_open === "closed") scene.kinchaku_open = false;
  }

  // --- 장면: 물건 이동 (합법 전이만) ---
  const took = userTookSomething(ctx.userText);
  const gaveBack = userGaveBack(ctx.userText);
  for (const ch of turn.item_changes) {
    if (!scene.sayaka.present && !privateResult.accepted) {
      corrections.push(ch.item + ": 비공개 행동의 증거 없이 소지품 상태를 바꾸려 함");
      continue;
    }
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
    scene.items[ch.item] = { location: to, shown_to_user: before.shown_to_user || (scene.sayaka.present && VISIBLE.includes(to)) };
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
    if (pluginFidelity && !ctx.scene.sayaka.present && !reunited) {
      corrections.push("사야카가 떨어져 있으므로 목격하지 못한 사용자 행동으로 관계를 변경하지 않음");
      continue;
    }
    let delta = sig.direction === "up" ? 1 : -1;
    if (pluginFidelity && userForcesSayakaState(ctx.userText) &&
      (sig.axis === "trust" || (sig.axis === "wariness" && delta < 0) || (sig.axis === "curiosity" && delta > 0))) {
      corrections.push("관계 변경 거부: 상대가 사야카의 감정·신뢰를 직접 지정한 입력");
      continue;
    }
    if (pluginFidelity && sig.axis === "trust" && delta > 0) {
      // A meaningful shared event must be visible in the player's message;
      // a model-written explanation by itself cannot mint trust.
      const sharedExperience = /도와|도움|구해|챙겨|돌려주|지켜줬|함께\s*걸|같이\s*걷|함께\s*도착|같이\s*도착|함께\s*만들/.test(ctx.userText);
      if (!sharedExperience) {
        corrections.push("관계 trust: 함께 겪은 사건이 아닌 모델 설명만으로는 신뢰를 올릴 수 없음");
        continue;
      }
    }
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
    // Sayaka has not heard the player speaking in another room.
    // Do not persist otherwise grounded user claims or observations as
    // knowledge of a character who is currently out of sight and earshot.
    if (pluginFidelity && !ctx.scene.sayaka.present && !reunited
      && ["user_claim", "observed_event", "sayaka_impression"].includes(mc.kind)) {
      corrections.push("서로 다른 공간의 사용자 행동·말은 사야카의 기억으로 전파하지 않음");
      continue;
    }
    // Nothing Sayaka did in another location becomes an *observed* event
    // in the player's memory. These private facts live in scene.offscreen.
    if (!scene.sayaka.present && mc.kind === "observed_event"
      && /(?:사야카|그녀|소녀).{0,75}(?:갔|나갔|샀|골랐|계산|받았|만났|도착|살펴|들어갔|챙겼)/.test(text)) {
      corrections.push("비공개 사건을 플레이어가 목격한 기억으로 저장하지 않음");
      continue;
    }
    // Merely packing a bag or glancing aside rarely warrants permanent
    // memory unless an actual relationship or plot event occurred.
    if (mc.kind === "observed_event"
      && /(?:상대|사용자|학생).{0,20}(?:가방을?\s*챙|고개를?\s*돌|잠깐\s*앉|자리에\s*앉|휴대폰을?\s*확인)/.test(text)
      && !/사야카와|함께|도와|나눠|돌려줬|넘어|다쳐|다툼|사과|밀치|때려/.test(text)) {
      corrections.push("일상적인 순간 행동은 장기 사건 기억에서 제외");
      continue;
    }
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
      const actualDialogue = dialogueText(segments);
      if (!mc.value.trim() || !actualDialogue.includes(mc.value.trim())) {
        corrections.push("즉흥 기억은 실제 사야카 대사에 근거해야 함 → 무시");
        continue;
      }
      newMemories.push({ kind: "improvised_detail", target: mc.target, value: mc.value, text });
      continue;
    }
    // 비밀·수치 단어가 기억 텍스트로 새어 들어가지 않게
    const leaky = [...LEAK_GUARDS.family_secret_terms, ...LEAK_GUARDS.unknown_figure_terms, ...LEAK_GUARDS.future_terms].some((w) => text.includes(w));
    if (leaky && !ctx.disclosures.length) {
      corrections.push("기억 후보에 비공개 단어 포함 → 거부");
      continue;
    }
    if (userForcesSayakaState(ctx.userText) && mc.kind === "observed_event" &&
      /사야카.{0,50}(?:고백|사랑|호감도|친밀|좋아하게)/.test(text)) {
      corrections.push("기억 후보 거부: 상대가 사야카의 감정을 일방적으로 확정함");
      continue;
    }
    newMemories.push({ kind: mc.kind, target: mc.target, value: mc.value, text });
  }

  // Actual first-person statements are remembered even when a model
  // proposes an over-paraphrased user_claim that fails its source match.
  const actualLiking = /(?:나는|난|내가|저는|전|제가)\s*(?:사야카|너|널|네가|니가)(?:를|이|가)?\s*좋아/.test(ctx.userText);
  const likingClaimText = "(상대 주장) 자신이 사야카를 좋아한다고 말했다.";
  if (actualLiking && (!pluginFidelity || ctx.scene.sayaka.present || reunited) && !ctx.memories.some((m) => m.kind === "user_claim" && m.text === likingClaimText)
      && !newMemories.some((m) => m.kind === "user_claim" && /사야카.{0,15}좋아|좋아.{0,15}사야카/.test(m.text))) {
    newMemories.push({ kind: "user_claim", target: "user_other", value: "좋아한다고 주장", text: likingClaimText });
  }

  if (confirmedSharedMove) {
    const description = "상대와 사야카가 " + scene.location + "에 함께 도착했다.";
    if (!ctx.memories.some((m) => m.kind === "observed_event" && m.text === description)
        && !newMemories.some((m) => m.kind === "observed_event" && m.text === description)) {
      newMemories.push({ kind: "observed_event", target: "event", value: "", text: description });
    }
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
    if (!DISCLOSABLE_IDS.includes(id) || already.has(id)) {
      corrections.push("공개 " + id + ": 공개 대상이 아니거나 이미 기록되어 무시");
      continue;
    }
    const e = loreById(id);
    if (!e || e.runtime.send !== "gated_fact") continue;
    if (ctx.relationship.trust < (e.runtime.min_trust ?? 5)) {
      corrections.push(`공개 ${id}: 신뢰 조건 미충족 → 기록하지 않음`);
      continue;
    }
    if (!hasEvidence(id, segments)) {
      corrections.push(`공개 ${id}: 대사에 근거 없음 → 기록하지 않음`);
      continue;
    }
    newDisclosures.push(id);
  }

  rel.stage = stageFor(rel, t, ctx.promptVersion?.includes("plugin-v0.2.0-fidelity") ?? false);
  return { scene, relationship: rel, newMemories, deactivateMemoryIds, newDisclosures, corrections, initiativeProgressed, privateEventAccepted: privateResult.accepted };
}
