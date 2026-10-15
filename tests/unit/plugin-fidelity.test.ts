import { describe, expect, it } from "vitest";
import { ctxFor, turn } from "../helpers";
import { PROMPT_VERSION } from "@/lib/engine/canon";
import { selectLore } from "@/lib/engine/lore";
import { applyTurn } from "@/lib/engine/state";
import { analyzePatterns } from "@/lib/engine/patterns";
import { validateTurn } from "@/lib/engine/validate";

describe("플러그인 교류·장면 상태·정보 공개 회귀", () => {
  it("현재 장면에서 다른 관심이 생기면 꽃병 관찰 목표를 내려놓는다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "너 왜 그래?" });
    const reply = turn({
      sayaka_want: "상대가 왜 말을 거는지 궁금하다",
      action_intent: "ask",
      segments: [{ kind: "narration", text: "사야카가 손가락으로 상대를 가리킨다." }, { kind: "dialogue", text: "너 뭐야." }],
    });
    const changed = applyTurn(ctx, reply, reply.segments);
    expect(changed.scene.sayaka.goal).toBe("상대가 왜 말을 거는지 궁금하다");
    const selected = selectLore({
      userText: "너 누구야", recentTexts: [], scene: changed.scene,
      relationship: changed.relationship, disclosures: [], promptVersion: PROMPT_VERSION,
    });
    expect(selected.map((x) => x.id)).not.toContain("flower_preference");
  });

  it("옛 버전의 꽃병 주제 자동 선별은 보존된다", () => {
    const ctx = ctxFor({ promptVersion: "web-0.1.0+v0.3.0", userText: "안녕" });
    ctx.scene.sayaka.goal = "상대에게 질문하기";
    ctx.scene.sayaka.current_action = "상대를 쳐다본다";
    const selected = selectLore({
      userText: "안녕", recentTexts: [], scene: ctx.scene,
      relationship: ctx.relationship, disclosures: [], promptVersion: ctx.promptVersion,
    });
    expect(selected.map((x) => x.id)).toContain("flower_preference");
  });

  it("반복적으로 꽃병으로 시선을 돌린 지문을 다음 턴에 진단한다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION });
    const assistant = (body: string, turn_index: number) => ({
      role: "assistant" as const, source: "model" as const, body,
      segments: [{ kind: "narration" as const, text: body }], turn_index,
    });
    const report = analyzePatterns([
      assistant("꽃병 쪽으로 시선을 돌린다.", 1),
      assistant("사야카가 다시 꽃병을 바라본다.", 2),
    ], PROMPT_VERSION);
    expect(report.notes.join(" ")).toContain("꽃병");
  });

  it("첫 인사를 기계적으로 따라 하기만 하는 한 줄을 검수한다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "하이" });
    const segments = [{ kind: "dialogue" as const, text: "안녕." }];
    const issues = validateTurn({ ctx, turn: turn({ segments }), segments, hadSpeakerLabel: false });
    expect(issues.some((issue) => issue.code === "mechanical_greeting")).toBe(true);
  });

  it("마이쮸 유래는 공개 대상이 아니므로 비슷한 대사가 있어도 공개 기록을 만들지 않는다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "너 누구야" });
    const proposed = turn({ disclosure_ids: ["mychew_origin"], segments: [{ kind: "dialogue", text: "카네코 사야카. 너는?" }] });
    const result = applyTurn(ctx, proposed, proposed.segments);
    expect(result.newDisclosures).toEqual([]);
  });

  it("아빠라는 단어만 언급한 사실로 가족의 비밀을 공개 기록에 추가하지 않는다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "아빠는?" });
    ctx.relationship.trust = 4;
    const segments = [{ kind: "dialogue" as const, text: "우리 아빠? 왜." }];
    const result = applyTurn(ctx, turn({ disclosure_ids: ["family_father"], segments }), segments);
    expect(result.newDisclosures).toEqual([]);
  });

  it("비공개 가족 정보는 첫 대화에서 실제로 말하면 차단한다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "아버지 뭐 해?" });
    const segments = [{ kind: "dialogue" as const, text: "아빠는 야쿠자 두목이야." }];
    const issues = validateTurn({ ctx, turn: turn({ segments }), segments, hadSpeakerLabel: false });
    expect(issues.some((issue) => issue.code === "secret_leak" && issue.severity === "block")).toBe(true);
  });
});
