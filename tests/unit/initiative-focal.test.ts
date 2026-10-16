import { describe, expect, it } from "vitest";
import { PROMPT_VERSION } from "@/lib/engine/canon";
import { analyzePatterns } from "@/lib/engine/patterns";
import { selectLore } from "@/lib/engine/lore";
import { validateTurn } from "@/lib/engine/validate";
import { ctxFor, turn } from "../helpers";
import type { AutonomousActivity } from "@/lib/engine/types";

const flower = (version: string, text: string, sceneVersion = 2, activity: AutonomousActivity | null = null) => {
  const ctx = ctxFor({ promptVersion: version, userText: text });
  ctx.scene.version = sceneVersion;
  ctx.scene.sayaka.activity = activity;
  return selectLore({
    userText: text, recentTexts: [], scene: ctx.scene,
    relationship: ctx.relationship, disclosures: [],
    promptVersion: version,
  }).map((x) => x.id);
};

describe("자율 행동과 연관된 배경 소품 과다 주입 방지", () => {
  it("꽃병을 바라보던 첫 행동만으로 다음 턴에도 꽃 취향을 자동 재주입하지 않는다", () => {
    expect(flower(PROMPT_VERSION, "배고파", 1)).toContain("flower_preference");
    expect(flower(PROMPT_VERSION, "배고파", 3)).not.toContain("flower_preference");
    expect(flower(PROMPT_VERSION, "메로나 먹고 싶어", 8)).not.toContain("flower_preference");
  });

  it("사용자가 실제로 꽃을 묻거나 사야카가 꽃 관련 자기 용무를 시작하면 관련 로어를 사용한다", () => {
    expect(flower(PROMPT_VERSION, "꽃 좋아해?", 3)).toContain("flower_preference");
    const activity: AutonomousActivity = {
      objective: "꽃병의 물을 갈아준다", phase: "acting",
      next_step: "물병 가져오기", last_step: "꽃병을 집어 든다",
      last_progress_turn: 1, idle_turns: 0,
    };
    expect(flower(PROMPT_VERSION, "그건 뭐야?", 3, activity)).toContain("flower_preference");
  });

  it("원래 v0.3.0 장면의 로어 선택 규칙은 변하지 않는다", () => {
    expect(flower("web-0.1.0+v0.3.0", "배고파", 3)).toContain("flower_preference");
  });

  it("시선·고개만 돌리는 작은 동작을 반복하면 의미 있는 변화에 대한 점검을 제공한다", () => {
    const rp = (text: string, turn_index: number) => ({
      role: "assistant" as const, source: "model" as const, body: text,
      segments: [{ kind: "narration" as const, text }], turn_index,
    });
    const patterns = analyzePatterns([
      rp("사야카는 상대에게 시선을 돌린다.", 1),
      rp("사야카가 상대를 힐끗 쳐다본다.", 2),
    ], PROMPT_VERSION);
    expect(patterns.notes.join(" ")).toContain("똑같은 몸짓");
    expect(patterns.notes.join(" ")).toContain("실제로 무엇을 하려는지");
  });

  it("initiate 행동이라고 선언하고 실제 보이는 행동이 없으면 재생성 검수가 작동한다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "안녕" });
    const segments = [{ kind: "dialogue" as const, text: "……뭐." }];
    const issues = validateTurn({
      ctx, turn: turn({ action_intent: "initiate", segments }),
      segments, hadSpeakerLabel: false,
    });
    expect(issues.some((x) => x.code === "empty_initiation" && x.severity === "retry")).toBe(true);
  });
});
