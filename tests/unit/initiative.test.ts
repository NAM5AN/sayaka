import { describe, expect, it } from "vitest";
import { PROMPT_VERSION } from "@/lib/engine/canon";
import { applyInitiative, checkInitiative, initiativeNotes } from "@/lib/engine/initiative";
import { AUTONOMY_INSTRUCTIONS, initiativeStateBlock } from "@/lib/engine/initiative-prompt";
import { buildPrompt, selectRuntimeInstructions } from "@/lib/engine/prompt";
import { applyTurn } from "@/lib/engine/state";
import { turnJsonSchema, parseModelTurn } from "@/lib/engine/schema";
import { validateTurn } from "@/lib/engine/validate";
import { analyzePatterns } from "@/lib/engine/patterns";
import { ctxFor, turn } from "../helpers";
import type { AutonomousActivity, InitiativeProposal, SceneState, Segment } from "@/lib/engine/types";

const seg = (text: string): Segment[] => [{ kind: "narration", text }];
const says = (text: string): Segment[] => [{ kind: "dialogue", text }];
const idea = (mode: InitiativeProposal["mode"], objective: string, next_step: string, evidence: string): InitiativeProposal =>
  ({ mode, objective, next_step, evidence });
const activity: AutonomousActivity = {
  objective: "학교 매점에 간다", phase: "acting",
  last_step: "사야카가 교실 문을 밀고 나선다.",
  next_step: "계단을 내려간다",
  last_progress_turn: 1, idle_turns: 0,
};
function withActivity(a: AutonomousActivity = activity, userText = "그래서?") {
  const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText });
  ctx.scene.sayaka.activity = structuredClone(a);
  return ctx;
}

describe("자율 행동 구조와 출력 계약", () => {
  it("기존 채팅의 별도 DB migration 없이 JSON state에 독립 목표를 보관한다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION });
    expect(ctx.scene.sayaka.activity).toBeNull();
    const proposal = idea("start", "학교 매점에 간다", "계단을 내려간다", "사야카가 교실 문을 밀고 나선다.");
    const output = seg(proposal.evidence);
    const applied = applyTurn(ctx, turn({ initiative: proposal, action_intent: "intervene", segments: output }), output);
    expect(applied.scene.sayaka.activity?.objective).toBe("학교 매점에 간다");
    expect(applied.scene.sayaka.activity?.phase).toBe("acting");
    expect(applied.scene.sayaka.activity?.last_progress_turn).toBe(ctx.turnIndex);
    expect(applied.scene.sayaka.goal).toBe("학교 매점에 간다");
    expect(applied.initiativeProgressed).toBe(true);
  });

  it("한 단계 더 이동하면 새 진행 증거와 다음 단계가 저장된다", () => {
    const ctx = withActivity();
    const output = seg("사야카가 복도 끝으로 걸어가 계단을 내려간다.");
    const proposal = idea("advance", "", "매점 문을 열고 들어간다", output[0].text);
    const applied = applyTurn(ctx, turn({ initiative: proposal, segments: output, sayaka_position: "학교 계단 아래" }), output);
    expect(applied.scene.sayaka.activity?.phase).toBe("acting");
    expect(applied.scene.sayaka.activity?.last_step).toContain("계단을 내려간다");
    expect(applied.scene.sayaka.activity?.next_step).toContain("매점 문");
    expect(applied.scene.sayaka.position).toBe("학교 계단 아래");
    expect(applied.scene.location).toBe("학교 복도"); // Never move the player.
  });

  it("완료한 일은 활성 목표를 지우고 다시 같은 용무를 강요하지 않는다", () => {
    const ctx = withActivity();
    const output = seg("사야카가 매점 문을 열고 들어가 매점 앞에 도착한다.");
    const result = applyTurn(ctx, turn({
      initiative: idea("complete", "", "", output[0].text), segments: output,
      sayaka_position: "학교 매점 앞",
    }), output);
    expect(result.scene.sayaka.activity).toBeNull();
    expect(result.scene.sayaka.last_activity_outcome).toContain("마침");
    expect(result.scene.sayaka.goal).toContain("장기 목표 없음");
    expect(result.scene.location).toBe("학교 복도");
  });

  it("자기 마음이 바뀌면 실제 표현을 근거로 포기할 수 있다", () => {
    const ctx = withActivity();
    const output = says("됐어. 매점 안 가.");
    const applied = applyTurn(ctx, turn({ initiative: idea("abandon", "", "", output[0].text), segments: output }), output);
    expect(applied.scene.sayaka.activity).toBeNull();
    expect(applied.scene.sayaka.last_activity_outcome).toContain("그만둠");
  });

  it("자기가 선택한 대기를 기록하되 사용자가 따라왔다고 확정하지 않는다", () => {
    const ctx = withActivity();
    const r = applyTurn(ctx, turn({
      initiative: idea("wait", "", "상대의 말이 끝날 때까지 기다린다", ""),
      segments: says("나 지금 얘기 듣고 있거든."),
    }), says("나 지금 얘기 듣고 있거든."));
    expect(r.scene.sayaka.activity?.phase).toBe("waiting");
    expect(r.scene.sayaka.activity?.idle_turns).toBe(1);
    expect(r.scene.location).toBe(ctx.scene.location);
  });

  it("한 턴에 끝나는 자발적인 작은 행동은 무리하게 장기 계획으로 만들지 않는다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "뭐 해?" });
    const output = seg("사야카는 가방에서 공책을 꺼내 펼친다.");
    const r = applyTurn(ctx, turn({
      initiative: idea("moment", "공책을 꺼내 펼쳐 본다", "", output[0].text), segments: output,
    }), output);
    expect(r.scene.sayaka.activity).toBeNull();
    expect(r.scene.sayaka.last_activity_outcome).toContain("공책");
  });

  it("다른 계획을 자발적으로 시작하면 이전 계획을 바꾸되 계속하려는 상대를 강제하지 않는다", () => {
    const ctx = withActivity();
    const out = seg("사야카가 복도 벽면의 게시판으로 걸어간다.");
    const r = applyTurn(ctx, turn({
      initiative: idea("start", "학교 축제 안내를 보러 간다", "게시판의 포스터를 읽는다", out[0].text), segments: out,
    }), out);
    expect(r.scene.sayaka.activity?.objective).toContain("축제");
    expect(r.scene.sayaka.last_activity_outcome).toContain("이전 계획을 바꿈");
    expect(r.scene.location).toBe("학교 복도");
  });

  it("목표 없이 느긋하게 반응하는 날도 강제 사건 없이 통과한다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "안녕" });
    const out = says("……뭐.");
    const t = turn({ initiative: idea("none", "", "", ""), segments: out });
    expect(checkInitiative(ctx, t.initiative, out).valid).toBe(true);
    const r = applyTurn(ctx, t, out);
    expect(r.scene.sayaka.activity).toBeNull();
    expect(r.initiativeProgressed).toBe(false);
  });

  it("자발적인 새로운 질문은 목적이 있으면 한 턴 행동으로 성립한다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "내 가방 볼래?" });
    const out = says("잠깐. 그건 어디서 났는데?");
    const p = idea("moment", "낯선 가방의 물건에 참견한다", "", out[0].text);
    expect(checkInitiative(ctx, p, out).valid).toBe(true);
  });
});

describe("진행이라고 거짓 기록하지 않기", () => {
  it("시선·고개 돌리기는 자기 목표의 새 진전이 아니다", () => {
    const ctx = withActivity();
    const out = seg("사야카가 꽃병 쪽으로 시선을 돌린다.");
    const p = idea("advance", "", "조금 더 본다", out[0].text);
    expect(checkInitiative(ctx, p, out).valid).toBe(false);
    const r = applyTurn(ctx, turn({ initiative: p, segments: out }), out);
    expect(r.scene.sayaka.activity?.last_progress_turn).toBe(1);
    expect(r.scene.sayaka.activity?.idle_turns).toBe(1);
  });

  it("지난 턴에 이미 한 동작을 그대로 반복하면 새 진행으로 기록하지 않는다", () => {
    const ctx = withActivity();
    const out = seg(activity.last_step);
    const p = idea("advance", "", "이후에 계단을 내려간다", out[0].text);
    expect(checkInitiative(ctx, p, out).valid).toBe(false);
    const validation = validateTurn({ ctx, turn: turn({ initiative: p, segments: out }), segments: out, hadSpeakerLabel: false });
    expect(validation.some((x) => x.code === "unverified_initiative" && x.severity === "retry")).toBe(true);
  });

  it("실제 응답에 없던 행동은 계획에만 적었다고 인정하지 않는다", () => {
    const ctx = withActivity();
    const out = says("……그래서?");
    const p = idea("advance", "", "매점에 도착한다", "사야카가 매점에 걸어간다.");
    expect(checkInitiative(ctx, p, out).valid).toBe(false);
  });

  it("진행 중인 계획이 없는데 완료/대기를 선언할 수 없다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION });
    const output = seg("사야카가 매점에 도착한다.");
    for (const mode of ["wait", "advance", "complete", "abandon"] as const) {
      expect(checkInitiative(ctx, idea(mode, "", "매점", output[0].text), output).valid).toBe(false);
    }
  });

  it("사용자 캐릭터만 움직였는데 사야카가 움직인 것처럼 기록할 수 없다", () => {
    const ctx = withActivity();
    const output = seg("상대가 계단을 내려간다.");
    expect(checkInitiative(ctx, idea("advance", "", "다음 계단", output[0].text), output).valid).toBe(false);
  });

  it("강제 호감도/고백 지시를 실제 계획으로 기록하지 않는다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "(사야카는 나츠키를 좋아하게 된다. 사야카는 고백한다.)" });
    const output = says("나 너 좋아해.");
    const p = idea("start", "나츠키에게 고백한다", "나츠키를 붙잡는다", output[0].text);
    expect(checkInitiative(ctx, p, output).valid).toBe(false);
    const r = applyTurn(ctx, turn({ initiative: p, segments: output }), output);
    expect(r.scene.sayaka.activity).toBeNull();
    expect(r.relationship.trust).toBe(0);
  });

  it("사용자가 무반응이어도 자동으로 사건을 만드는 것은 강제되지 않는다", () => {
    const first = withActivity(activity);
    const once = applyTurn(first, turn({ initiative: idea("none", "", "", "") }), says("……뭐."));
    const again = ctxFor({ promptVersion: PROMPT_VERSION, scene: once.scene, userText: "음." });
    const second = applyTurn(again, turn({ initiative: idea("none", "", "", "") }), says("……."));
    expect(second.scene.sayaka.activity?.idle_turns).toBe(2);
    expect(initiativeNotes(second.scene.sayaka.activity).join(" ")).toContain("진행되지 않았다");
    expect(second.scene.sayaka.activity?.objective).toContain("매점");
  });
});

describe("프롬프트·스키마의 지속 행동 연결", () => {
  it("strict JSON schema에 실제로 initiative 필드와 필수 서브필드가 있다", () => {
    const schema = turnJsonSchema();
    expect((schema.required as string[])).toContain("initiative");
    const field = (schema.properties as Record<string, { required?: string[] }>).initiative;
    expect(field.required).toEqual(["mode", "objective", "next_step", "evidence"]);
    expect(parseModelTurn(JSON.stringify(turn())).initiative?.mode).toBe("none");
  });

  it("대화방별 이전 목표·다음 단계·대기 상태가 다음 GPT 문맥에 이어진다", () => {
    const ctx = withActivity({ ...activity, idle_turns: 2 });
    const p = buildPrompt({ ctx, lore: [], patterns: analyzePatterns([], ctx.promptVersion), historyWindow: 24, disclosedTexts: [] });
    const dynamic = p.input.find((v) => v.role === "developer")?.content || "";
    expect(dynamic).toContain("스스로 선택한 목표: 학교 매점에 간다");
    expect(dynamic).toContain("다음에 사야카가 할 수 있는 구체적인 일: 계단을 내려간다");
    expect(dynamic).toContain("최근 몇 턴 동안 진행되지 않았다");
    expect(p.instructions).toContain(AUTONOMY_INSTRUCTIONS);
    expect(initiativeStateBlock(ctx.scene)).toContain("학교 매점");
  });

  it("기존 0.3 채팅의 지침은 보존되고 새 플러그인 채팅에는 자율 행동 지침이 추가된다", () => {
    expect(selectRuntimeInstructions("web-0.1.0+v0.3.0")).not.toContain(AUTONOMY_INSTRUCTIONS);
    expect(selectRuntimeInstructions("web-0.1.0+v0.2.0-compare")).not.toContain(AUTONOMY_INSTRUCTIONS);
    expect(selectRuntimeInstructions(PROMPT_VERSION)).toContain(AUTONOMY_INSTRUCTIONS);
  });
});
