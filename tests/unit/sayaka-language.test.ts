import { describe, expect, it } from "vitest";
import { PROMPT_VERSION } from "@/lib/engine/canon";
import { validateTurn } from "@/lib/engine/validate";
import { ctxFor, turn } from "../helpers";

describe("사야카 말투와 일본어 혼입 방어", () => {
  it("한국어 반말에 예기치 않은 히라가나가 끼어들면 재생성한다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "로봇 여기 둬도 돼?" });
    const segments = [{ kind: "dialogue" as const, text: "로봇은そこ에 두지 마." }];
    const issues = validateTurn({ ctx, turn: turn({ segments }), segments, hadSpeakerLabel: false });
    expect(issues.some((i) => i.code === "mixed_japanese_dialogue" && i.severity === "retry")).toBe(true);
  });
  it("사용자가 직접 일본어로 말한 인용 상황이나 정상 한국어는 강제 수정하지 않는다", () => {
    const korean = [{ kind: "dialogue" as const, text: "거기 두지 말라니까." }];
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "여기 둬도 돼?" });
    expect(validateTurn({ ctx, turn: turn({ segments: korean }), segments: korean, hadSpeakerLabel: false })
      .some((i) => i.code === "mixed_japanese_dialogue")).toBe(false);
    const mixed = [{ kind: "dialogue" as const, text: "そこ? 왜." }];
    const quotedCtx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "そこ라는 말이 무슨 뜻이야?" });
    expect(validateTurn({ ctx: quotedCtx, turn: turn({ segments: mixed }), segments: mixed, hadSpeakerLabel: false })
      .some((i) => i.code === "mixed_japanese_dialogue")).toBe(false);
  });
});
