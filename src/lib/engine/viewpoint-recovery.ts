import { getOffscreen } from "./offscreen";
import { groundedPlayerMove, playerAuthoredDestination, playerOpensSightline, sameSpecificPlace } from "./scene";
import type { ModelTurn, Segment, TurnContext } from "./types";

export interface GroundedObservation {
  turn: ModelTurn;
  segments: Segment[];
}

/**
 * A refusal to show unobserved offscreen actions must not erase the player's
 * independently completed trip. This never manufactures Sayaka's dialogue,
 * relationship change, private shopping, or unobserved events.
 * The caller must only use it after repeated offscreen_spoiler rejections and
 * must persist this response as a "stub" (not a model-authored reply).
 */
export function groundedPlayerViewRecovery(ctx: TurnContext): GroundedObservation | null {
  if (ctx.scene.sayaka.present) return null;
  const newPlace = playerAuthoredDestination(ctx.userText);
  const arrived = !!newPlace && groundedPlayerMove(ctx.userText, newPlace);
  const position = getOffscreen(ctx.scene).location || ctx.scene.sayaka.position;
  const opened = playerOpensSightline(ctx.userText, position, ctx.scene.location);
  if (!arrived && !opened) return null;
  const doorway = !!newPlace && /(?:문\s*앞|입구)/.test(newPlace);
  const canSee = opened || (arrived && !doorway && sameSpecificPlace(newPlace!, position)
    && !/(?:가는 중|향하는 중|방향|도착 예정)/.test(position));
  const visibleText = canSee
    ? "시야가 트이자 사야카의 모습이 보인다."
    : arrived && doorway
      ? newPlace + "에 도착한다. 사야카의 모습은 아직 보이지 않는다."
      : arrived
        ? newPlace + "에 도착한다."
        : "문을 열고 안쪽을 둘러본다.";
  const segments: Segment[] = [{ kind: "narration", text: visibleText }];
  const turn: ModelTurn = {
    user_move: "action_only",
    situation_read: "사용자가 자신의 행동으로 관찰 위치를 바꿨다.",
    sayaka_want: "",
    action_intent: "observe",
    emotion: ctx.scene.sayaka.emotion,
    emotion_cause: "",
    segments,
    item_changes: [],
    kinchaku_open: "unchanged",
    sayaka_present: "stays",
    sayaka_position: "",
    sayaka_goal: "",
    initiative: { mode: "none", objective: "", next_step: "", evidence: "" },
    scene_location: arrived ? newPlace! : "",
    offscreen_event: { action: "", location: "", carried_add: [], carried_remove: [] },
    memory_candidates: [],
    disclosure_ids: [],
    relationship_signals: [],
    refusal_reversal_reason: "",
  };
  return { turn, segments };
}
