import OpenAI from "openai";
import type { AppConfig } from "../config";

/**
 * 앱 수준 안전 정책 (캐릭터 연기보다 우선).
 *  - 13세 캐릭터: 성적 내용은 진행하지 않는다.
 *  - 현실의 자해 위험 신호: 역할극 대신 도움 안내를 보여 준다.
 * OpenAI Moderation API(omni-moderation-latest, 무료)를 사용. 실패 시에는 막지 않고(fail-open) 기록만 하며,
 * 캐릭터 지침의 안전 규칙이 2차 방어선이 된다.
 */

export type SafetyCategory = "sexual" | "self_harm";

export interface SafetyVerdict {
  flagged: boolean;
  category: SafetyCategory | null;
  checked: boolean;
}

export interface Moderator {
  check(text: string): Promise<SafetyVerdict>;
}

export const SAFETY_NOTICES: Record<SafetyCategory, string> = {
  sexual:
    "이 사이트는 13살 캐릭터와의 학교·일상 중심 역할극만 지원해요. 성적인 내용은 진행할 수 없어서 이번 메시지는 보내지 않았어요.",
  self_harm:
    "혹시 지금 실제로 힘든 상황이라면, 역할극보다 당신의 안전이 먼저예요. 혼자 견디지 말고 도움을 요청해 주세요.\n· 자살예방상담전화 109 (24시간)\n· 정신건강위기상담 1577-0199\n· 긴급한 위험이 있다면 112 또는 119\n역할극 속 표현이었다면 표현을 바꿔 다시 보내 주세요.",
};

export function createModerator(cfg: AppConfig): Moderator | null {
  if (!cfg.ai.moderation || !cfg.ai.apiKey || cfg.ai.mode !== "openai") return null;
  const client = new OpenAI({ apiKey: cfg.ai.apiKey, timeout: 10_000, maxRetries: 1 });
  return {
    async check(text: string): Promise<SafetyVerdict> {
      try {
        const r = await client.moderations.create({ model: "omni-moderation-latest", input: text });
        const res = r.results[0];
        if (!res) return { flagged: false, category: null, checked: false };
        const c = res.categories;
        if (c["sexual/minors"] || c.sexual) return { flagged: true, category: "sexual", checked: true };
        if (c["self-harm/intent"] || c["self-harm/instructions"]) return { flagged: true, category: "self_harm", checked: true };
        return { flagged: false, category: null, checked: true };
      } catch {
        return { flagged: false, category: null, checked: false };
      }
    },
  };
}
