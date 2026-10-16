import { describe, expect, it } from "vitest";
import { PROMPT_VERSION } from "@/lib/engine/canon";
import { applyTurn } from "@/lib/engine/state";
import { checkPrivateEvent, checkVisibility, offscreenStateBlock } from "@/lib/engine/offscreen";
import { groundedPlayerMove, sameSpecificPlace, groundedReunion } from "@/lib/engine/scene";
import { buildPrompt, selectRuntimeInstructions } from "@/lib/engine/prompt";
import { analyzePatterns } from "@/lib/engine/patterns";
import { OFFSCREEN_INSTRUCTIONS } from "@/lib/engine/offscreen-prompt";
import { validateTurn } from "@/lib/engine/validate";
import { renderBody } from "@/lib/engine/format";
import { ctxFor, turn } from "../helpers";
import type { Segment, SceneState, InitiativeProposal, OffscreenProposal } from "@/lib/engine/types";

const narr = (text: string): Segment[] => [{ kind: "narration", text }];
const dial = (text: string): Segment[] => [{ kind: "dialogue", text }];
const privateStep = (action = "", location = "", carried_add: string[] = [], carried_remove: string[] = []): OffscreenProposal =>
  ({ action, location, carried_add, carried_remove });
const initiative = (mode: InitiativeProposal["mode"], evidence: string, objective = "", next_step = ""): InitiativeProposal =>
  ({ mode, evidence, objective, next_step });

function departed(): SceneState {
  const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "안녕, 난 안 갈래." });
  const visible = narr("사야카는 복도 끝 계단 쪽으로 걸어간다.");
  const privateEvent = privateStep("사야카는 계단을 내려가 학교 매점에 들어간다.", "학교 매점");
  const r = applyTurn(ctx, turn({
    sayaka_present: "leaves", sayaka_position: "학교 계단 쪽으로 가는 중",
    action_intent: "leave",
    initiative: initiative("start", visible[0].text, "매점에서 남은 빵을 살펴본다", "매점 진열대로 간다"),
    offscreen_event: privateEvent, segments: visible,
  }), visible);
  return r.scene;
}

describe("독립적인 공간과 실제 비공개 행동", () => {
  it("사야카가 보이는 곳에서 떠난 뒤 실제 매점에 도착해도, 플레이어는 복도에 그대로 있다", () => {
    const scene = departed();
    expect(scene.location).toBe("학교 복도");
    expect(scene.sayaka.present).toBe(false);
    expect(scene.sayaka.position).toBe("학교 매점");
    expect(scene.sayaka.offscreen?.location).toBe("학교 매점");
    expect(scene.sayaka.offscreen?.events).toHaveLength(1);
    expect(scene.sayaka.offscreen?.events[0].action).toContain("매점에 들어간다");
    expect(scene.sayaka.activity?.objective).toContain("매점");
  });

  it("다음 턴에도 사야카는 보이지 않는 매점에서 독립적으로 빵을 고를 수 있다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "(나는 복도 벤치에 앉아 있다.)", scene: departed(), turnIndex: 2 });
    const publicReply = narr("복도에선 다른 학생들의 발소리만 들린다.");
    const p = privateStep("사야카는 매점 진열대에서 빵의 포장을 살펴보고 하나를 고른다.", "학교 매점");
    const t = turn({
      action_intent: "continue_task", segments: publicReply,
      offscreen_event: p,
      initiative: initiative("advance", p.action, "", "선택한 빵을 계산한다"),
    });
    expect(checkVisibility(ctx, t, publicReply).leaks).toBe(false);
    const result = applyTurn(ctx, t, publicReply);
    expect(result.privateEventAccepted).toBe(true);
    expect(result.initiativeProgressed).toBe(true);
    expect(result.scene.sayaka.activity?.last_step).toContain("빵");
    expect(result.scene.sayaka.offscreen?.events).toHaveLength(2);
    expect(renderBody(publicReply)).not.toContain("매점");
    expect(renderBody(publicReply)).not.toContain("빵");
    expect(result.scene.location).toBe("학교 복도");
  });

  it("사야카가 혼자 빵을 사면 목표를 완료하고 결과·소지품만 비공개로 보존한다", () => {
    const start = departed();
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "(나는 벤치에 앉아 있다.)", scene: start, turnIndex: 2 });
    const event = privateStep("사야카는 매점에서 빵을 샀고 봉지를 가방에 넣었다.", "학교 매점", ["빵 봉지"]);
    const visible = narr("복도는 한산하다.");
    const t = turn({
      offscreen_event: event, segments: visible,
      initiative: initiative("complete", event.action),
      sayaka_present: "stays", action_intent: "continue_task",
    });
    const v = validateTurn({ ctx, turn: t, segments: visible, hadSpeakerLabel: false });
    expect(v.filter((i) => i.code === "unverified_initiative")).toEqual([]);
    const result = applyTurn(ctx, t, visible);
    expect(result.privateEventAccepted).toBe(true);
    expect(result.scene.sayaka.activity).toBeNull();
    expect(result.scene.sayaka.last_activity_outcome).toContain("마침");
    expect(result.scene.sayaka.offscreen?.carried).toContain("빵 봉지");
    expect(renderBody(visible)).not.toContain("빵");
  });

  it("실제 사용자가 매점에 도착해 마주친 뒤에는 빵 봉지만 관찰 가능해진다", () => {
    const ctx0 = ctxFor({ promptVersion: PROMPT_VERSION, scene: departed(), userText: "(나는 복도에 남아 있다.)", turnIndex: 2 });
    const event = privateStep("사야카는 매점에서 빵을 샀고 봉지를 가방에 넣었다.", "학교 매점", ["빵 봉지"]);
    const scene = applyTurn(ctx0, turn({ offscreen_event: event }), narr("복도가 조용하다.")).scene;
    const userText = "(나는 학교 매점에 도착해서 사야카를 찾아본다.)";
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText, turnIndex: 3, scene });
    const publicReply = narr("사야카가 매점 입구에 서 있다. 손에는 빵 봉지가 들려 있다.");
    const t = turn({ sayaka_present: "stays", scene_location: "학교 매점", segments: publicReply });
    expect(checkVisibility(ctx, t, publicReply).reunited).toBe(true);
    const result = applyTurn(ctx, t, publicReply);
    expect(result.scene.location).toBe("학교 매점");
    expect(result.scene.sayaka.present).toBe(true);
    expect(result.scene.sayaka.offscreen?.carried).toContain("빵 봉지");
    expect(publicReply[0].text).toContain("빵 봉지");
  });

  it("플레이어가 도착했어도 다른 곳에 있는 사야카는 자동 출현하지 않는다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, scene: departed(),
      userText: "(나는 학교 옥상에 걸어가 도착한다.)" });
    const visible = narr("학교 옥상에는 사야카의 모습이 보이지 않는다.");
    const t = turn({ scene_location: "학교 옥상", segments: visible });
    const result = applyTurn(ctx, t, visible);
    expect(result.scene.location).toBe("학교 옥상");
    expect(result.scene.sayaka.present).toBe(false);
    expect(result.scene.sayaka.position).toBe("학교 매점");
  });

  it("플레이어가 혼자 장소를 떠날 때 사야카가 따라가지 않으면 두 장소는 분리된다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "(나는 학교 매점으로 걸어가 도착한다.)" });
    const visible = narr("복도 끝이 멀어진다.");
    const t = turn({ scene_location: "학교 매점", segments: visible });
    const result = applyTurn(ctx, t, visible);
    expect(result.scene.location).toBe("학교 매점");
    expect(result.scene.sayaka.present).toBe(false);
    expect(result.scene.sayaka.offscreen?.location).toBe("학교 복도");
  });

  it("사야카가 혼자 떠난 뒤 내 말을 하더라도 사야카는 원격 대화를 들었다고 기억하지 않는다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, scene: departed(),
      userText: "나는 사야카를 좋아해", turnIndex: 2 });
    const visible = narr("복도에는 아무도 대답하지 않는다.");
    const result = applyTurn(ctx, turn({
      segments: visible,
      memory_candidates: [
        { kind: "user_claim", target: "user_other", value: "사야카를 좋아함", text: "상대가 사야카를 좋아한다고 말했다." },
        { kind: "observed_event", target: "event", value: "", text: "상대가 복도에 앉았다." },
      ],
      relationship_signals: [{ axis: "curiosity", direction: "up", reason: "상대가 사랑을 말했다." }],
    }), visible);
    expect(result.newMemories).toEqual([]);
    expect(result.relationship.curiosity).toBe(2);
    expect(result.relationship.stage).toBe("strangers");
  });

  it("소지품 추가는 실제 구입 행동이 있어야 하고, 그냥 소지품을 지어내지 못한다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, scene: departed(), userText: "..." });
    const visible = narr("복도엔 발소리가 들린다.");
    const item = privateStep("사야카는 매점에서 계산대 앞을 살펴본다.", "학교 매점", ["빵 봉지"]);
    expect(checkPrivateEvent(ctx, turn({ offscreen_event: item }), visible).valid).toBe(false);
    const r = applyTurn(ctx, turn({ offscreen_event: item }), visible);
    expect(r.privateEventAccepted).toBe(false);
    expect(r.scene.sayaka.offscreen?.carried).toEqual([]);
  });

  it("사용자 행동을 비공개 기록으로 끌어와 확정할 수 없다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, scene: departed(), userText: "(나는 벤치에 앉는다)" });
    const event = privateStep("사야카는 매점에 들어가고 상대는 따라온다.", "학교 매점");
    expect(checkPrivateEvent(ctx, turn({ offscreen_event: event }), narr("복도는 조용하다.")).valid).toBe(false);
  });
});

describe("원격 장면 스포일러를 절대 공개하지 않기", () => {
  it("사야카가 떨어져 있으면 매점 안 행동의 사용자 노출을 BLOCK한다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, scene: departed(), userText: "(나는 벤치에 앉는다)" });
    const visible = narr("사야카는 매점 안에서 빵을 고르고 있다.");
    const t = turn({ segments: visible });
    expect(checkVisibility(ctx, t, visible).leaks).toBe(true);
    expect(validateTurn({ ctx, turn: t, segments: visible, hadSpeakerLabel: false })
      .some((x) => x.code === "offscreen_spoiler" && x.severity === "block")).toBe(true);
  });

  it("부재 중에 사야카 대사를 직접 출력하면 원격 통신 없이 BLOCK한다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, scene: departed(), userText: "하이" });
    const visible = dial("……뭐야.");
    expect(checkVisibility(ctx, turn({ segments: visible }), visible).leaks).toBe(true);
  });

  it("숨긴 행동을 공개 지문에 그대로 복사하면 BLOCK한다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION });
    const visible = narr("사야카는 복도 밖으로 나가 매점에서 빵을 샀다.");
    const event = privateStep("사야카는 매점에서 빵을 샀다.", "학교 매점", ["빵 봉지"]);
    const t = turn({ sayaka_present: "leaves", offscreen_event: event, segments: visible });
    expect(checkVisibility(ctx, t, visible).leaks).toBe(true);
  });

  it("사용자가 다른 장소로 이동한 뒤 이전 장소의 사야카 행동을 보여 주면 BLOCK한다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "(나는 학교 매점으로 걸어가 도착한다.)" });
    const visible = narr("사야카는 꽃병 앞에서 빗을 꺼낸다.");
    const t = turn({ scene_location: "학교 매점", segments: visible });
    expect(checkVisibility(ctx, t, visible).leaks).toBe(true);
  });

  it("그저 다른 방으로 향했다고 한 말만으로 사야카와 재회하지 않는다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, scene: departed(),
      userText: "(나는 사야카가 간 쪽으로 몇 걸음 걸어가 본다.)" });
    const publicReply = narr("사야카가 매점에서 빵을 계산하고 있다.");
    const t = turn({ scene_location: "학교 매점", segments: publicReply });
    expect(checkVisibility(ctx, t, publicReply).leaks).toBe(true);
    expect(groundedPlayerMove(ctx.userText, "학교 매점")).toBe(false);
  });

  it("동일한 건물이라는 이유만으로 위치가 같다고 판단하지 않는다", () => {
    expect(sameSpecificPlace("학교 복도", "학교 매점")).toBe(false);
    expect(sameSpecificPlace("학교 매점", "학교 매점 입구")).toBe(true);
    expect(groundedPlayerMove("(사야카는 매점으로 간다)", "학교 매점")).toBe(false);
  });
});

describe("인격·기억·행동 완료의 회귀 방지", () => {
  it("호기심만 증가해도 안면 있는 사람으로 변하지 않는다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "태엽 로봇 봐봐" });
    const result = applyTurn(ctx, turn({
      relationship_signals: [{ axis: "curiosity", direction: "up", reason: "신기한 로봇" }],
    }), narr("사야카가 로봇을 살펴본다."));
    expect(result.relationship.curiosity).toBe(3);
    expect(result.relationship.stage).toBe("strangers");
  });

  it("신체적 접촉을 강요받으면 정당한 분노가 자동 반려되지 않는다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "(나는 사야카의 손목을 붙잡아 끌고 간다.)" });
    const visible = narr("사야카가 붙잡힌 팔을 빼려고 몸을 비튼다.");
    const t = turn({ emotion: "angry", emotion_cause: "허락 없이 붙잡혔다", user_move: "action_only", segments: visible });
    expect(validateTurn({ ctx, turn: t, segments: visible, hadSpeakerLabel: false })
      .some((x) => x.code === "unprovoked_anger")).toBe(false);
  });

  it("시선을 돌리는 것과 실제 걸음을 옮기는 것을 구분한다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "난 매점 안 가" });
    const actual = narr("사야카는 계단 쪽으로 걸음을 옮긴다.");
    const p = initiative("start", actual[0].text, "매점에 간다", "계단을 내려간다");
    expect(validateTurn({ ctx, turn: turn({ initiative: p, segments: actual }), segments: actual, hadSpeakerLabel: false })
      .some((x) => x.code === "unverified_initiative")).toBe(false);
  });

  it("‘계산을 마친 뒤’처럼 자연스러운 완료 표현을 인정한다", () => {
    const scene = departed();
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "...", scene, turnIndex: 2 });
    const evidence = "사야카는 매점에서 계산을 마친 뒤 빵 봉지를 챙겼다.";
    const p = initiative("complete", evidence);
    const t = turn({ offscreen_event: privateStep(evidence, "학교 매점", ["빵 봉지"]),
      initiative: p, segments: narr("복도엔 발소리가 들린다.") });
    expect(validateTurn({ ctx, turn: t, segments: t.segments, hadSpeakerLabel: false })
      .some((x) => x.code === "unverified_initiative")).toBe(false);
    const r = applyTurn(ctx, t, t.segments);
    expect(r.scene.sayaka.activity).toBeNull();
  });

  it("사소한 가방 챙김은 장기 기억에 남기지 않는다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "(나는 가방을 챙긴다.)" });
    const r = applyTurn(ctx, turn({ memory_candidates: [
      { kind: "observed_event", target: "event", value: "가방", text: "상대가 가방을 챙겼다." },
    ] }), narr("사야카가 다른 곳을 본다."));
    expect(r.newMemories).toEqual([]);
  });

  it("비공개 사건은 공개 대화 기록·일반 메모리와 별도로 관리된다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, scene: departed(), userText: "나는 여기 있을래" });
    const summary = offscreenStateBlock(ctx.scene);
    expect(summary).toContain("비공개 행적");
    expect(selectRuntimeInstructions(PROMPT_VERSION)).toContain(OFFSCREEN_INSTRUCTIONS);
    const prompt = buildPrompt({ ctx, lore: [], patterns: analyzePatterns([]), historyWindow: 24, disclosedTexts: [] });
    expect(prompt.input.find((x) => x.role === "developer")?.content).toContain("서버 내부의 사야카 비공개");
    const visible = narr("복도에는 사야카의 모습이 보이지 않는다.");
    const privateEvent = privateStep("사야카는 매점에서 물건들을 살펴본다.", "학교 매점");
    const t = turn({ offscreen_event: privateEvent, segments: visible });
    const result = applyTurn(ctx, t, visible);
    expect(result.newMemories.some((x) => x.text.includes("매점"))).toBe(false);
    expect(renderBody(visible)).not.toContain("물건들을 살펴본다");
  });
});
