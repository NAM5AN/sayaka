import { LEAK_GUARDS } from "./canon";
import { groundedReunion, groundedPlayerMove, playerAuthoredDestination, sameSpecificPlace, sayakaActuallyReturned, userForcesSayakaState } from "./scene";
import type { ModelTurn, OffscreenProposal, OffscreenState, SceneState, Segment, TurnContext } from "./types";

const empty = (): OffscreenProposal => ({ action: "", location: "", carried_add: [], carried_remove: [] });

export function getOffscreen(scene: SceneState): OffscreenState {
  const data = scene.sayaka.offscreen;
  return {
    location: data?.location || (scene.sayaka.present ? "" : scene.sayaka.position),
    carried: (data?.carried ?? []).slice(0, 10),
    events: (data?.events ?? []).slice(-8),
  };
}

export function willReunite(ctx: Pick<TurnContext, "userText" | "scene">, turn: ModelTurn, segments: Segment[]): boolean {
  if (ctx.scene.sayaka.present || turn.sayaka_present === "leaves") return false;
  const authored = playerAuthoredDestination(ctx.userText);
  // The user can stand at an entrance while the model proposes "inside".
  const next = authored && /(?:문\s*앞|입구)/.test(authored)
    ? authored : (turn.scene_location?.trim() || authored || ctx.scene.location);
  const known = getOffscreen(ctx.scene).location || ctx.scene.sayaka.position;
  return groundedReunion(ctx.userText, next, known, segments, ctx.scene.location);
}

const privateActionOwner = /^(?:사야카|소녀|그녀)(?:는|가|의)?(?:\s|[,，])/;
const forcedPlayer = /(?:상대|사용자|모브|나츠키|플레이어)(?:는|가|이|의).{0,85}(?:따라|걷|달려|들어가|도착|받아|웃|놀라|움직|넘어|기다려|좋아|말하|대답)/;
const privateAction = /(?:걸어|걷|옮기|나서|나가|나왔|다가가|내려|올라|도착|들어가|고르|고른|골랐|계산|구매|샀|사서|챙기|챙겼|담아|넣|꺼내|꺼낸|빼|집어|살펴|살핀|관찰|찾아|기다리|읽|적어|멈추|앉아|쉬|돌아|물(?:을)?\s*갈|고개|따져|생각)/;
const acquireVerb = /(?:샀|산다|사서|구매|집|집었|받|챙|넣|가져|담|주웠|줍|꺼내)/;
const releaseVerb = /(?:놓|버리|건넸|떨어뜨|두고|줬|내려놓|남겨)/;

function concretePlaceWords(place: string): string[] {
  return (place.match(/[가-힣A-Za-z]{2,}/g) ?? [])
    .filter((w) => !["학교", "근처", "주변", "바깥", "동네", "방향", "가는", "중인", "앞쪽", "안쪽", "자리를", "떠남"].includes(w));
}

function namedItemInAction(item: string, action: string): boolean {
  const tokens = (item.match(/[가-힣A-Za-z0-9]{1,}/g) ?? [])
    .filter((s) => !["개", "봉지", "물건", "하나", "한쪽"].includes(s));
  return tokens.length > 0 && tokens.some((s) => action.includes(s) || (s.length >= 2 && action.includes(s.slice(0, -1))));
}

export interface PrivateEventCheck {
  valid: boolean;
  reason: string | null;
  action: string;
}

/** Private events must describe Sayaka's actual independent action, not the player. */
export function checkPrivateEvent(
  ctx: Pick<TurnContext, "userText" | "scene">,
  turn: ModelTurn,
  segments: Segment[],
): PrivateEventCheck {
  const p = turn.offscreen_event ?? empty();
  const action = p.action.trim();
  if (!action) {
    if (p.location || p.carried_add.length || p.carried_remove.length)
      return { valid: false, action: "", reason: "비공개 행동 없이 위치·소지품만 변경하려 했다." };
    return { valid: true, action: "", reason: null };
  }
  if (ctx.scene.sayaka.present && turn.sayaka_present !== "leaves") {
    return { valid: false, action: "", reason: "사야카가 바로 앞에 있을 때는 비공개 사건을 만들지 않는다." };
  }
  if (willReunite(ctx, turn, segments)) {
    return { valid: false, action: "", reason: "실제로 다시 만난 장면은 채팅 지문으로 보이고 별도 비공개 사건으로 중복 생성하지 않는다." };
  }
  if (!privateActionOwner.test(action) || !privateAction.test(action)) {
    return { valid: false, action: "", reason: "사야카 본인이 실제로 한 구체적 행동인지 확인할 수 없다." };
  }
  if (forcedPlayer.test(action) || (userForcesSayakaState(ctx.userText) && /좋아하게|고백|호감도|사랑하게/.test(action))) {
    return { valid: false, action: "", reason: "비공개 기록으로 사용자 행동 또는 강제 호감·감정을 확정할 수 없다." };
  }
  const forbidden = [...LEAK_GUARDS.future_terms, ...LEAK_GUARDS.unknown_figure_terms];
  if (forbidden.some((s) => action.includes(s))) {
    return { valid: false, action: "", reason: "사야카가 알 수 없는 수치·미래 설정을 비공개 사건으로 단정했다." };
  }
  const previous = getOffscreen(ctx.scene).location;
  const next = p.location.trim();
  if (next && previous && previous !== "자리를 떠남" && !sameSpecificPlace(previous, next)
    && !concretePlaceWords(next).some((w) => action.includes(w))) {
    return { valid: false, action: "", reason: "비공개 위치 변경을 뒷받침하는 이동·도착 행동이 없다." };
  }
  for (const item of p.carried_add) {
    if (!namedItemInAction(item, action) || !acquireVerb.test(action)) {
      return { valid: false, action: "", reason: "획득한 물건에 대해 실제 행동 근거가 없다." };
    }
  }
  for (const item of p.carried_remove) {
    if (!namedItemInAction(item, action) || !releaseVerb.test(action)) {
      return { valid: false, action: "", reason: "내려놓은 물건에 대한 행동 근거가 없다." };
    }
  }
  return { valid: true, action, reason: null };
}

export interface VisibilityCheck {
  leaks: boolean;
  reason: string | null;
  reunited: boolean;
}

const visibleAbsent = /(?:보이지\s*않|모습이?\s*없|자리에\s*없|목소리.*들리지\s*않|부재|찾을\s*수\s*없)/;
const remoteNarration = /(?:사야카|그녀|소녀)(?:는|가|의)?.{0,85}(?:걸어|걷|물건을|빵을|고르|계산|집어|읽|내려가|들어가|들어오|가지|봉지|살펴|돌아다니|따지|구매|쓰|웃|앉아|꺼내|꺼낸|들춰|챙기|챙겼|문을\s*열|빗을)/;

/** Prevent hidden actions from being serialized into player-facing segments. */
export function checkVisibility(
  ctx: Pick<TurnContext, "scene" | "userText">,
  turn: ModelTurn,
  segments: Segment[],
): VisibilityCheck {
  const reunited = willReunite(ctx, turn, segments);
  // Moving the player's viewpoint elsewhere must not leave Sayaka's old
  // location visible like a remote camera after the departure.
  const playerMovedAway = ctx.scene.sayaka.present && turn.sayaka_present !== "leaves"
    && !!turn.scene_location && turn.scene_location !== ctx.scene.location
    && groundedPlayerMove(ctx.userText, turn.scene_location)
    && !/(?:사야카|그녀|소녀).{0,60}(?:함께|같이|옆에서).{0,60}(?:도착|걸어|들어가)/.test(segments.map((s) => s.text).join(" "));
  if (playerMovedAway && segments.some((s) =>
    s.kind === "dialogue" || (s.kind === "narration" && remoteNarration.test(s.text) && !visibleAbsent.test(s.text))
  )) {
    return { leaks: true, reason: "플레이어가 혼자 떠난 뒤 사야카의 이전 장소에서 벌어지는 일을 보여 주었다.", reunited };
  }
  if (!ctx.scene.sayaka.present && !reunited) {
    if (segments.some((s) => s.kind === "dialogue")) {
      return { leaks: true, reason: "사야카가 사용자 곁에 없는데 직접 대사를 출력했다.", reunited };
    }
    const text = segments.map((s) => s.text).join(" ");
    if (remoteNarration.test(text) && !visibleAbsent.test(text)) {
      return { leaks: true, reason: "사야카와 떨어져 있는데 보이지 않는 곳의 행동을 지문으로 노출했다.", reunited };
    }
    const place = getOffscreen(ctx.scene).location;
    if (concretePlaceWords(place).some((word) => text.includes(word))
       && /(?:매점|진열대|계산대|물건|빵|가방|학교 밖).{0,60}(?:고르|계산|샀|살펴|도착|챙겼|들어갔)/.test(text)) {
      return { leaks: true, reason: "플레이어가 볼 수 없는 별도 장소의 진행 과정을 출력했다.", reunited };
    }
  }
  if (ctx.scene.sayaka.present && turn.sayaka_present === "leaves" && turn.offscreen_event?.action) {
    const text = segments.map((s) => s.text).join(" ");
    // After the departure is visible, a private purchase or other
    // post-departure action must not be narrated in that same public turn.
    if (/(?:사라지|떠나|나갔|나가|나온|복도\s*밖|계단을\s*내려가|문밖으로).{0,170}(?:빵을?\s*고르|계산을?\s*마치|샀|구매|결제|집어\s*들|진열대)/.test(text)) {
      return { leaks: true, reason: "퇴장 이후 보이지 않는 행동을 같은 공개 지문에 이어 썼다.", reunited };
    }
  }
  if (turn.offscreen_event?.action && segments.some((s) =>
    s.text.includes(turn.offscreen_event!.action) || turn.offscreen_event!.action.includes(s.text) && s.text.length > 16
  )) {
    return { leaks: true, reason: "비공개 사건과 동일한 내용을 사용자 지문에 노출했다.", reunited };
  }
  return { leaks: false, reason: null, reunited };
}

export interface OffscreenUpdate {
  state: OffscreenState;
  accepted: boolean;
  correction: string | null;
}

export function applyPrivateEvent(
  ctx: Pick<TurnContext, "scene" | "turnIndex" | "userText">,
  turn: ModelTurn,
  segments: Segment[],
): OffscreenUpdate {
  const state = getOffscreen(ctx.scene);
  const p = turn.offscreen_event ?? empty();
  const check = checkPrivateEvent(ctx, turn, segments);
  if (!check.valid) return { state, accepted: false, correction: check.reason };
  if (!check.action) return { state, accepted: false, correction: null };
  state.location = p.location.trim() || state.location;
  for (const item of p.carried_remove) state.carried = state.carried.filter((x) => x !== item);
  for (const item of p.carried_add) {
    const x = item.trim();
    if (x && !state.carried.includes(x)) state.carried.push(x);
  }
  state.carried = state.carried.slice(-10);
  state.events.push({ turn: ctx.turnIndex, action: check.action.slice(0, 360), location: state.location });
  state.events = state.events.slice(-8);
  return { state, accepted: true, correction: null };
}

/** Private state is server-only and never exposed in player-facing messages. */
export function offscreenStateBlock(scene: SceneState): string | null {
  if (scene.sayaka.present) {
    const old = getOffscreen(scene);
    return old.carried.length
      ? "# 사야카가 지니고 있는 일반 물건 (일부는 사용자에게 아직 보이지 않음)\n- " + old.carried.join(", ")
      : null;
  }
  const state = getOffscreen(scene);
  return [
    "# 서버 내부의 사야카 비공개 행적 — 사용자에게 직접 노출 금지",
    "- 사용자가 있는 공간: " + scene.location,
    "- 사야카가 실제 있는 곳(내부): " + (state.location || "최종 위치 미정"),
    "- 비공개로 지닌 일반 물건: " + (state.carried.join(", ") || "확인된 추가 소지품 없음"),
    ...state.events.slice(-4).map((event) => "- 내부 사건: " + event.action),
    "- 이 정보는 사야카의 상태·소지품·의사결정에만 이용한다. 플레이어가 실제로 마주치거나 직접 목격하기 전에는 대사·지문에 비공개 사건을 공개하지 않는다.",
  ].join("\n");
}
