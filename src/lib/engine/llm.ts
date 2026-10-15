import OpenAI from "openai";
import type { AppConfig } from "../config";
import { turnJsonSchema } from "./schema";
import type { BuiltPrompt } from "./prompt";
import { PROMPT_VERSION } from "./canon";

export interface LlmUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
}

export interface LlmResult {
  rawJson: string;
  model: string;
  usage: LlmUsage;
  /** 실제 OpenAI 모델 응답인지 (stub 이면 false) */
  real: boolean;
}

export interface LlmClient {
  readonly kind: "openai" | "stub" | "fake";
  readonly model: string;
  generate(prompt: BuiltPrompt, opts: { safetyId: string }): Promise<LlmResult>;
}

export type LlmErrorCode = "MODEL_TIMEOUT" | "MODEL_ERROR" | "MODEL_REFUSED" | "MODEL_INCOMPLETE" | "MODEL_AUTH" | "MODEL_RATE_LIMIT" | "MODEL_BAD_REQUEST";

export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function createOpenAiClient(cfg: AppConfig): LlmClient {
  if (!cfg.ai.apiKey || !cfg.ai.model) throw new Error("OpenAI 설정 없음");
  // SDK 자동 재시도는 끈다: 한 턴의 총 시간이 함수 제한(maxDuration)을 넘지 않게. 실패는 사용자가 같은 요청 ID 로 다시 보낸다.
  const client = new OpenAI({ apiKey: cfg.ai.apiKey, timeout: cfg.ai.timeoutMs, maxRetries: 0 });
  const model = cfg.ai.model;
  return {
    kind: "openai",
    model,
    async generate(prompt, { safetyId }) {
      try {
        const resp = await client.responses.create({
          model,
          instructions: prompt.instructions,
          input: prompt.input,
          store: false,
          max_output_tokens: cfg.ai.maxOutputTokens,
          text: {
            format: { type: "json_schema", name: "sayaka_turn", schema: turnJsonSchema(), strict: true },
          },
          ...(cfg.ai.reasoningEffort ? { reasoning: { effort: cfg.ai.reasoningEffort as "low" } } : {}),
          ...(cfg.ai.temperature !== null ? { temperature: cfg.ai.temperature } : {}),
          safety_identifier: safetyId,
          prompt_cache_key: `sayaka-${prompt.promptCacheVersion ?? PROMPT_VERSION}`,
        });

        for (const item of resp.output ?? []) {
          if (item.type === "message") {
            for (const c of item.content) {
              if (c.type === "refusal") throw new LlmError("MODEL_REFUSED", "모델이 응답을 거부함");
            }
          }
        }
        if (resp.status === "incomplete") {
          throw new LlmError("MODEL_INCOMPLETE", `응답이 중간에 끊김(${resp.incomplete_details?.reason ?? "unknown"})`);
        }
        const raw = resp.output_text;
        if (!raw) throw new LlmError("MODEL_ERROR", "빈 응답");
        return {
          rawJson: raw,
          model: resp.model ?? model,
          real: true,
          usage: {
            inputTokens: resp.usage?.input_tokens ?? null,
            outputTokens: resp.usage?.output_tokens ?? null,
            cachedTokens: resp.usage?.input_tokens_details?.cached_tokens ?? null,
          },
        };
      } catch (e) {
        throw toLlmError(e);
      }
    },
  };
}

export function toLlmError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  if (e instanceof OpenAI.APIConnectionTimeoutError) return new LlmError("MODEL_TIMEOUT", "OpenAI 응답 시간 초과");
  if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError) return new LlmError("MODEL_AUTH", "OpenAI 키 인증 실패");
  if (e instanceof OpenAI.RateLimitError) return new LlmError("MODEL_RATE_LIMIT", "OpenAI 사용량 한도 또는 요청 과다");
  if (e instanceof OpenAI.BadRequestError) return new LlmError("MODEL_BAD_REQUEST", `요청 형식 거부: ${(e as Error).message.slice(0, 200)}`);
  if (e instanceof OpenAI.APIError) return new LlmError("MODEL_ERROR", `OpenAI 오류 ${e.status ?? ""}`);
  if (e instanceof Error && e.name === "AbortError") return new LlmError("MODEL_TIMEOUT", "요청 중단");
  return new LlmError("MODEL_ERROR", e instanceof Error ? e.message.slice(0, 200) : "알 수 없는 오류");
}

/**
 * 테스트/개발용 스텁 (AI_MODE=stub). 실제 GPT 가 아니며 UI 에 '스텁'으로 표시된다.
 * 출력 문장 자체에도 실제 응답이 아님을 밝힌다.
 */
export function createStubClient(): LlmClient {
  return {
    kind: "stub",
    model: "stub",
    async generate(prompt) {
      const last = prompt.input[prompt.input.length - 1]?.content ?? "";
      const out = {
        user_move: "other",
        situation_read: "스텁",
        sayaka_want: "스텁",
        action_intent: "continue_task",
        emotion: "indifferent",
        emotion_cause: "",
        segments: [
          { kind: "narration", text: "[테스트 스텁 응답 — 실제 GPT가 만든 문장이 아니에요] 사야카는 꽃병 쪽을 본 채 그대로 서 있다." },
          { kind: "dialogue", text: `[스텁] 입력 ${Math.min(last.length, 9999)}자 받음.` },
        ],
        item_changes: [],
        kinchaku_open: "unchanged",
        sayaka_present: "stays",
        sayaka_position: "",
        sayaka_goal: "",
        memory_candidates: [],
        disclosure_ids: [],
        relationship_signals: [],
        refusal_reversal_reason: "",
      };
      return { rawJson: JSON.stringify(out), model: "stub", real: false, usage: { inputTokens: null, outputTokens: null, cachedTokens: null } };
    },
  };
}
