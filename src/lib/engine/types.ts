/** 사야카 엔진 공용 타입. 서버 전용. */

export const ITEM_IDS = ["vase", "kinchaku", "pocket_watch", "mychew", "lacquer_comb", "urushi_pen"] as const;
export type ItemId = (typeof ITEM_IDS)[number];

export const ITEM_LOCATIONS = [
  "windowsill",
  "in_sayaka_hand",
  "on_sayaka_person",
  "in_sayaka_bag",
  "behind_sayaka_back",
  "inside_kinchaku",
  "on_surface",
  "offered_to_user",
  "with_user",
  "elsewhere",
] as const;
export type ItemLocation = (typeof ITEM_LOCATIONS)[number];

export const EMOTIONS = ["indifferent", "curious", "mildly_annoyed", "displeased", "angry", "relaxed", "uncertain"] as const;
export type Emotion = (typeof EMOTIONS)[number];

export const ACTION_INTENTS = [
  "reply",
  "partial_reply",
  "refuse",
  "ignore",
  "observe",
  "intervene",
  "ask",
  "leave",
  "continue_task",
  "silence",
] as const;
export type ActionIntent = (typeof ACTION_INTENTS)[number];

export const USER_MOVES = [
  "greeting",
  "small_talk",
  "question_about_sayaka",
  "personal_probe",
  "request",
  "command",
  "tease",
  "provocation",
  "compliment",
  "apology",
  "gift_or_offer",
  "action_only",
  "silence_or_watching",
  "leaving",
  "meta_or_ooc",
  "other",
] as const;
export type UserMove = (typeof USER_MOVES)[number];

export const MEMORY_KINDS = [
  "user_claim",
  "observed_event",
  "sayaka_impression",
  "improvised_detail",
  "refusal",
  "stopped_asking",
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_TARGETS = [
  "user_name",
  "user_class",
  "user_other",
  "pocket_watch",
  "kinchaku",
  "mychew",
  "lacquer_comb",
  "urushi_pen",
  "family",
  "home",
  "self_intro",
  "sayaka_other",
  "event",
  "none",
] as const;
export type MemoryTarget = (typeof MEMORY_TARGETS)[number];

export const REL_AXES = ["wariness", "curiosity", "annoyance", "trust"] as const;
export type RelAxis = (typeof REL_AXES)[number];

export interface Segment {
  kind: "dialogue" | "narration";
  text: string;
}

export interface ItemState {
  location: ItemLocation;
  /** 상대에게 한 번이라도 보였는지 */
  shown_to_user: boolean;
}

export interface SceneState {
  version: number;
  scenario: string;
  time_label: string;
  location: string;
  sayaka: {
    present: boolean;
    position: string;
    goal: string;
    current_action: string;
    emotion: Emotion;
    noticed_user: boolean;
  };
  kinchaku_open: boolean;
  items: Record<ItemId, ItemState>;
}

export interface RelationshipState {
  wariness: number;
  curiosity: number;
  annoyance: number;
  trust: number;
  stage: RelationshipStage;
  user_name: string | null;
  last_trust_up_turn: number;
  last_wariness_down_turn: number;
  history: RelationshipHistoryEntry[];
}

export type RelationshipStage = "strangers" | "acquainted" | "friendly" | "trusted";

export interface RelationshipHistoryEntry {
  turn: number;
  axis: RelAxis;
  delta: number;
  reason: string;
}

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  target: string;
  value: string;
  text: string;
  turn_index: number;
  active: boolean;
}

export interface Disclosure {
  lore_id: string;
  turn_index: number;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  source: "user" | "opening" | "model" | "stub";
  body: string;
  segments: Segment[] | null;
  turn_index: number;
}

/** 모델이 내놓는 내부 JSON (서버 검증 전 '제안') */
export interface ModelTurn {
  user_move: UserMove;
  situation_read: string;
  sayaka_want: string;
  action_intent: ActionIntent;
  emotion: Emotion;
  emotion_cause: string;
  segments: Segment[];
  item_changes: { item: ItemId; location: ItemLocation; reason: string }[];
  kinchaku_open: "unchanged" | "opened" | "closed";
  sayaka_present: "stays" | "leaves";
  sayaka_position: string;
  sayaka_goal: string;
  memory_candidates: { kind: MemoryKind; target: MemoryTarget; value: string; text: string }[];
  disclosure_ids: string[];
  relationship_signals: { axis: RelAxis; direction: "up" | "down"; reason: string }[];
  refusal_reversal_reason: string;
}

export interface TurnContext {
  chatId: string;
  /** Persisted on the chat: keeps old v0.3.0 conversations on their original behavior. */
  promptVersion?: string;
  turnIndex: number;
  scene: SceneState;
  relationship: RelationshipState;
  memories: MemoryEntry[];
  disclosures: Disclosure[];
  history: HistoryMessage[];
  userText: string;
}

export type IssueSeverity = "block" | "retry" | "log";

export interface ValidationIssue {
  code: string;
  severity: IssueSeverity;
  /** 재생성 시 모델에게 줄 수정 지시 (한국어) */
  fix: string;
  detail?: string;
}
