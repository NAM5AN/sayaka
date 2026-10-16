import { z } from "zod";
import {
  ACTION_INTENTS,
  EMOTIONS,
  ITEM_IDS,
  ITEM_LOCATIONS,
  MEMORY_KINDS,
  MEMORY_TARGETS,
  REL_AXES,
  USER_MOVES,
  type ModelTurn,
} from "./types";
import { DISCLOSABLE_IDS } from "./canon";

/**
 * OpenAI Responses API Structured Outputs (strict) 용 JSON Schema.
 * strict 모드 제약: 모든 속성 required, additionalProperties:false, 길이/개수 제약은 서버(zod)에서 검사.
 * 속성 순서 = 생성 순서. '판단 → 행동 선택 → 출력 → 상태 제안' 순으로 둔다.
 */
export function turnJsonSchema(): Record<string, unknown> {
  const str = { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      user_move: { type: "string", enum: [...USER_MOVES] },
      situation_read: { ...str, description: "비공개. 지금 확정된 상황과 상대 입력의 성격을 한 문장으로." },
      sayaka_want: { ...str, description: "비공개. 사야카가 지금 원하는 것 한 문장." },
      action_intent: { type: "string", enum: [...ACTION_INTENTS] },
      emotion: { type: "string", enum: [...EMOTIONS] },
      emotion_cause: { ...str, description: "기본 감정(indifferent)에서 벗어났다면 원인, 아니면 빈 문자열." },
      segments: {
        type: "array",
        description: "사용자에게 보일 대사·지문. 대사와 지문을 상황에 맞게 자연스럽게 교차해 1~12개.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["dialogue", "narration"] },
            text: str,
          },
          required: ["kind", "text"],
        },
      },
      item_changes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item: { type: "string", enum: [...ITEM_IDS] },
            location: { type: "string", enum: [...ITEM_LOCATIONS] },
            reason: str,
          },
          required: ["item", "location", "reason"],
        },
      },
      kinchaku_open: { type: "string", enum: ["unchanged", "opened", "closed"] },
      sayaka_present: { type: "string", enum: ["stays", "leaves"] },
      sayaka_position: { ...str, description: "바뀌었으면 새 위치, 아니면 빈 문자열." },
      sayaka_goal: { ...str, description: "사야카가 하려는 일이 바뀌었으면 새 목표, 아니면 빈 문자열." },
      initiative: {
        type: "object",
        additionalProperties: false,
        description: "사야카가 선택한 지속 목표의 실제 단계. 사건을 매턴 만들 의무 없음. evidence는 이번에 출력한 segments의 실제 대사·지문에서 인용.",
        properties: {
          mode: { type: "string", enum: ["none", "start", "advance", "wait", "complete", "abandon", "moment"] },
          objective: { ...str, description: "start/moment만 새 목표, 나머지는 빈 문자열이거나 이미 진행 중인 목표." },
          next_step: { ...str, description: "start/advance이면 사야카 자신이 실행할 다음 단계. wait이면 기다리는 조건, 그 밖에는 빈 문자열." },
          evidence: { ...str, description: "start/advance/complete/abandon/moment에는 실제로 출력한 사야카의 대사나 행동 일부를 그대로 인용. none/wait는 빈 문자열." },
        },
        required: ["mode", "objective", "next_step", "evidence"],
      },
      scene_location: { ...str, description: "사용자가 실제로 움직인 뒤 공유 또는 사용자 자신의 위치가 바뀐 경우 새 장소. 사용자 입력에 실제 이동 근거가 없으면 빈 문자열." },
      offscreen_event: {
        type: "object",
        additionalProperties: false,
        description: "사용자와 떨어져 있을 때 사야카 혼자 실제로 수행한 비공개 행동. 사용자에게는 절대로 서술하지 않음. 행동 없으면 빈 action/location/배열.",
        properties: {
          action: { ...str, description: "사야카의 실제 사적 행동을 짧은 3인칭 지문으로. 같은 장소에서 보이지 않는 행동도 실제로 진행할 수 있음. 사용자 캐릭터의 동작을 확정하지 않음." },
          location: { ...str, description: "사야카가 비공개 행동 후 실제로 있는 위치. 알 수 없으면 빈 문자열. 공유 위치와 무관." },
          carried_add: { type: "array", items: str, description: "해당 비공개 행동으로 사야카가 실제 손에 넣은 일반 물건. 없으면 빈 배열." },
          carried_remove: { type: "array", items: str, description: "해당 비공개 행동으로 더 이상 지니지 않는 일반 물건. 없으면 빈 배열." },
        },
        required: ["action", "location", "carried_add", "carried_remove"],
      },
      memory_candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: [...MEMORY_KINDS] },
            target: { type: "string", enum: [...MEMORY_TARGETS] },
            value: { ...str, description: "짧은 값(예: 상대가 밝힌 이름). 없으면 빈 문자열." },
            text: str,
          },
          required: ["kind", "target", "value", "text"],
        },
      },
      disclosure_ids: { type: "array", items: { type: "string", enum: DISCLOSABLE_IDS } },
      relationship_signals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            axis: { type: "string", enum: [...REL_AXES] },
            direction: { type: "string", enum: ["up", "down"] },
            reason: str,
          },
          required: ["axis", "direction", "reason"],
        },
      },
      refusal_reversal_reason: str,
    },
    required: [
      "user_move",
      "situation_read",
      "sayaka_want",
      "action_intent",
      "emotion",
      "emotion_cause",
      "segments",
      "item_changes",
      "kinchaku_open",
      "sayaka_present",
      "sayaka_position",
      "sayaka_goal",
      "initiative",
      "scene_location",
      "offscreen_event",
      "memory_candidates",
      "disclosure_ids",
      "relationship_signals",
      "refusal_reversal_reason",
    ],
  };
}

const short = (max: number) => z.string().transform((s) => s.trim().slice(0, max));

export const TurnZ = z.object({
  user_move: z.enum(USER_MOVES),
  situation_read: short(300),
  sayaka_want: short(200),
  action_intent: z.enum(ACTION_INTENTS),
  emotion: z.enum(EMOTIONS),
  emotion_cause: short(200),
  segments: z
    .array(z.object({ kind: z.enum(["dialogue", "narration"]), text: z.string().max(1200) }))
    .max(12),
  item_changes: z
    .array(z.object({ item: z.enum(ITEM_IDS), location: z.enum(ITEM_LOCATIONS), reason: short(200) }))
    .max(6),
  kinchaku_open: z.enum(["unchanged", "opened", "closed"]),
  sayaka_present: z.enum(["stays", "leaves"]),
  sayaka_position: short(60),
  sayaka_goal: short(80),
  initiative: z.object({
    mode: z.enum(["none", "start", "advance", "wait", "complete", "abandon", "moment"]),
    objective: short(120),
    next_step: short(120),
    evidence: short(180),
  }).default({ mode: "none", objective: "", next_step: "", evidence: "" }),
  scene_location: short(80).default(""),
  offscreen_event: z.object({
    action: short(360),
    location: short(80),
    carried_add: z.array(short(50)).max(5),
    carried_remove: z.array(short(50)).max(5),
  }).default({ action: "", location: "", carried_add: [], carried_remove: [] }),
  memory_candidates: z
    .array(
      z.object({
        kind: z.enum(MEMORY_KINDS),
        target: z.enum(MEMORY_TARGETS),
        value: short(40),
        text: short(160),
      }),
    )
    .max(6)
    .transform((a) => a.slice(0, 4)),
  disclosure_ids: z.array(z.string()).max(6),
  relationship_signals: z
    .array(z.object({ axis: z.enum(REL_AXES), direction: z.enum(["up", "down"]), reason: short(160) }))
    .max(6),
  refusal_reversal_reason: short(200),
});

export class ModelOutputError extends Error {
  constructor(
    message: string,
    public readonly code: "MODEL_BAD_JSON" | "MODEL_SCHEMA_MISMATCH",
  ) {
    super(message);
  }
}

export function parseModelTurn(raw: string): ModelTurn {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ModelOutputError("모델 출력이 JSON 이 아님", "MODEL_BAD_JSON");
  }
  const r = TurnZ.safeParse(data);
  if (!r.success) {
    throw new ModelOutputError(`모델 출력 스키마 불일치: ${r.error.issues.slice(0, 3).map((i) => i.path.join(".")).join(", ")}`, "MODEL_SCHEMA_MISMATCH");
  }
  return r.data as ModelTurn;
}
