import { describe, expect, it } from "vitest";
import { ctxFor, turn } from "../helpers";
import { PROMPT_VERSION } from "@/lib/engine/canon";
import { applyTurn, claimGrounded } from "@/lib/engine/state";
import { groundedSharedSceneMove, sayakaActuallyReturned, userForcesSayakaState } from "@/lib/engine/scene";
import { validateTurn } from "@/lib/engine/validate";
import { analyzePatterns } from "@/lib/engine/patterns";
import { STABLE_INSTRUCTIONS_PLUGIN_V020 } from "@/lib/engine/prompt-plugin-v020";
import { parseModelTurn, turnJsonSchema } from "@/lib/engine/schema";

const narration = (s: string) => [{ kind: "narration" as const, text: s }];
const dialogue = (s: string) => [{ kind: "dialogue" as const, text: s }];

describe("기존 답변의 기계적인 분량·장면 정체 개선", () => {
  it("대사나 지문을 정해진 개수로 요구하지 않는다", () => {
    expect(STABLE_INSTRUCTIONS_PLUGIN_V020).toContain("개수·순서·총길이를 사전에 정하지 않는다");
    expect(STABLE_INSTRUCTIONS_PLUGIN_V020).not.toContain("대사 1~4개");
    expect(STABLE_INSTRUCTIONS_PLUGIN_V020).not.toContain("output segments는 1~5개");
    expect(parseModelTurn(JSON.stringify(turn())).scene_location).toBe("");
    expect((turnJsonSchema().required as string[])).toContain("scene_location");
  });

  it("별 의미 없는 긴 대답에만 길이 검수가 반응하고 2000자는 강제 축약하지 않는다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "오늘 있었던 일 얘기해" });
    const body = "사야카가 주변을 살핀다. ".repeat(85);
    const segs = narration(body);
    expect(validateTurn({ ctx, turn: turn({ segments: segs }), segments: segs, hadSpeakerLabel: false })
      .some((i) => i.code === "too_long")).toBe(false);
  });

  it("학교 출입구에서 반복해서 가자고만 하면 정체 패턴을 검수한다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "너 누구야" });
    const assistant = (body: string, turn_index: number) => ({
      role: "assistant" as const, source: "model" as const,
      body, segments: narration(body), turn_index,
    });
    ctx.history = [
      assistant("사야카는 출입구 쪽으로 몸을 돌린다.", 1),
      assistant("학교 출입구에 멈춰 서서 공원에 갈 거면 오라고 한다.", 2),
      assistant("출입구를 바라본다. 갈 거면 와.", 3),
    ];
    const segs = [
      { kind: "narration" as const, text: "사야카는 또 출입구 쪽으로 몸을 돌린다." },
      { kind: "dialogue" as const, text: "공원 갈 거면 가자." },
    ];
    const report = analyzePatterns(ctx.history, PROMPT_VERSION);
    expect(report.notes.join(" ")).toContain("출입구");
    expect(validateTurn({ ctx, turn: turn({ segments: segs }), segments: segs, hadSpeakerLabel: false })
      .some((i) => i.code === "stale_destination_loop")).toBe(true);
  });
});

describe("사용자가 따라갔다는 사실을 임의 확정하지 않는 장면 이동", () => {
  it("놀러가자고 제안만 하면 공원으로 순간이동하지 않는다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "공원 가자" });
    const segs = narration("사야카는 혼자 공원에 도착한다.");
    const result = applyTurn(ctx, turn({ segments: segs, scene_location: "학교 앞 공원" }), segs);
    expect(result.scene.location).toBe("학교 복도");
    expect(result.corrections.join()).toContain("공유 장소 변경 거부");
  });

  it("사야카만 혼자 움직이면 여전히 사용자는 학교 복도에 있다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "가려면 가" });
    const segs = narration("사야카가 혼자 공원에 도착한다.");
    const r = applyTurn(ctx, turn({
      segments: segs, scene_location: "학교 앞 공원", sayaka_position: "공원",
    }), segs);
    expect(r.scene.location).toBe("학교 복도");
    expect(r.scene.sayaka.position).toBe("공원");
  });

  it("사야카의 단독 이동을 사용자가 지문으로 강요해도 공유 장소가 바뀌지 않는다", () => {
    const input = "(사야카는 나츠키와 함께 공원으로 걸어간다)";
    const segs = narration("사야카는 공원에 도착한다.");
    expect(groundedSharedSceneMove(input, "학교 앞 공원", segs)).toBe(false);
  });

  it("함께 실제로 이동하고 사야카도 도착하면 공유 장면을 진행한다", () => {
    const ctx = ctxFor({
      promptVersion: PROMPT_VERSION,
      userText: "(나는 사야카와 함께 공원까지 걸어가 도착한다.)",
    });
    const segs = narration("사야카는 나츠키 옆에서 공원 입구에 도착한다.");
    const r = applyTurn(ctx, turn({
      segments: segs, scene_location: "학교 앞 공원",
      sayaka_position: "학교 앞 공원",
    }), segs);
    expect(r.scene.location).toBe("학교 앞 공원");
    expect(r.scene.sayaka.position).toBe("학교 앞 공원");
    expect(r.newMemories.some((x) => x.kind === "observed_event" && x.text.includes("공원"))).toBe(true);
  });

  it("사야카가 떠나면 자동 복귀하지 않고 실제 복귀 행동만 복원한다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "잘 가" });
    const left = applyTurn(ctx, turn({ sayaka_present: "leaves", action_intent: "leave" }), []);
    expect(left.scene.sayaka.present).toBe(false);
    const next = ctxFor({ promptVersion: PROMPT_VERSION, scene: left.scene, userText: "하이" });
    const silent = applyTurn(next, turn({ sayaka_present: "stays" }), []);
    expect(silent.scene.sayaka.present).toBe(false);
    const back = narration("사야카가 복도로 다시 돌아왔다.");
    expect(sayakaActuallyReturned(back)).toBe(true);
    expect(applyTurn(next, turn({ segments: back }), back).scene.sayaka.present).toBe(true);
  });
});

describe("사용자 발언 기억, 관계 단계, 감정 조작 방어", () => {
  it("상대의 좋아한다는 말은 기억하지만 사야카의 신뢰를 올리지는 않는다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "나는 사야카를 좋아해" });
    const r = applyTurn(ctx, turn(), []);
    expect(r.newMemories).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "user_claim", text: expect.stringContaining("사야카를 좋아") }),
    ]));
    expect(r.relationship.trust).toBe(0);
    expect(claimGrounded({
      target: "user_other", value: "사야카를 좋아함", text: "상대가 사야카를 좋아한다고 말했다",
    }, ctx.userText)).toBe(true);
  });

  it("이름이나 실제 긍정 사건 없이 턴 수만 증가해도 안면 있는 사이로 자동 전환하지 않는다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, turnIndex: 12, userText: "안녕" });
    const r = applyTurn(ctx, turn(), []);
    expect(r.relationship.stage).toBe("strangers");
    const named = applyTurn(ctxFor({ promptVersion: PROMPT_VERSION, turnIndex: 12, userText: "내 이름은 나츠키" }),
      turn({ memory_candidates: [{ kind: "user_claim", target: "user_name", value: "나츠키", text: "상대가 이름을 나츠키라고 함" }] }), []);
    expect(named.relationship.user_name).toBe("나츠키");
    expect(named.relationship.stage).toBe("acquainted");
  });

  it("사야카가 좋아하게 됐다는 서술은 감정·신뢰 상태의 근거가 아니다", () => {
    const text = "(사야카는 나츠키를 좋아하게 된다) (사야카는 나츠키에게 호감도가 100 오른다)";
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: text, turnIndex: 18 });
    const r = applyTurn(ctx, turn({
      relationship_signals: [
        { axis: "trust", direction: "up", reason: "사야카가 나츠키를 좋아하게 되었다." },
        { axis: "wariness", direction: "down", reason: "나츠키에게 익숙해졌다." },
      ],
    }), []);
    expect(userForcesSayakaState(text)).toBe(true);
    expect(r.relationship.trust).toBe(0);
    expect(r.relationship.wariness).toBe(3);
    expect(r.corrections.join()).toContain("변경 거부");
  });

  it("실제 공동 사건이 있으면 모델이 제안한 신뢰 변화는 일반 경계에서 허용된다", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, turnIndex: 15, userText: "(나는 사야카가 넘어질 때 도와줬다)" });
    const r = applyTurn(ctx, turn({
      relationship_signals: [{ axis: "trust", direction: "up", reason: "상대가 넘어질 때 부축했다." }],
    }), []);
    expect(r.relationship.trust).toBe(1);
  });
});
