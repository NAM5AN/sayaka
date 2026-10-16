import { describe, expect, it } from "vitest";
import { PROMPT_VERSION } from "@/lib/engine/canon";
import { applyTurn } from "@/lib/engine/state";
import { userCatchesUpToSayaka, groundedSayakaDeparture } from "@/lib/engine/scene";
import { ctxFor, turn } from "../helpers";

const narration = (text: string) => [{ kind: "narration" as const, text }];

function leftScene() {
  const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "나 아직 안 갈 건데" });
  const segs = narration("사야카는 교문 밖으로 걸어 나간다.");
  return applyTurn(ctx, turn({
    action_intent: "leave", sayaka_present: "leaves",
    sayaka_position: "학교 교문 밖으로 가는 중",
    segments: segs,
  }), segs).scene;
}

describe("사야카의 독립적 퇴장과 플레이어의 재합류", () => {
  it("자발적으로 혼자 떠난 경우 마지막 확인 위치만 보관하고 공유 장소는 그대로 둔다", () => {
    const scene = leftScene();
    expect(scene.sayaka.present).toBe(false);
    expect(scene.sayaka.position).toBe("학교 교문 밖으로 가는 중");
    expect(scene.location).toBe("학교 복도");
  });

  it("모델이 실제 보여 주지 않은 장소로 도착했다고 주장할 수는 없다", () => {
    const a = narration("사야카는 교문 밖으로 걸어 나간다.");
    expect(groundedSayakaDeparture("공원", a)).toBe(false);
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION });
    const scene = applyTurn(ctx, turn({
      sayaka_present: "leaves", sayaka_position: "공원", segments: a,
    }), a).scene;
    expect(scene.sayaka.position).toBe("자리를 떠남");
  });

  it("사용자가 자기 행동으로 사야카를 뒤따라 실제로 마주친 경우에만 합류한다", () => {
    const prior = leftScene();
    const userText = "(나는 사야카를 따라 교문 밖까지 걸어가 도착한다.)";
    const narrationNow = narration("사야카는 교문 앞에 서 있다.");
    expect(userCatchesUpToSayaka(userText, narrationNow, prior.sayaka.position)).toBe(true);
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, scene: prior, userText });
    const scene = applyTurn(ctx, turn({
      sayaka_present: "stays", scene_location: "학교 교문 앞",
      segments: narrationNow,
    }), narrationNow).scene;
    expect(scene.sayaka.present).toBe(true);
    expect(scene.location).toBe("학교 교문 앞");
    expect(scene.sayaka.position).toBe("학교 교문 앞");
  });

  it("사용자는 따라가지 않았는데 사야카가 되돌아온 것처럼 멋대로 처리하지 않는다", () => {
    const prior = leftScene();
    const visible = narration("사야카는 교문 앞에 서 있다.");
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, scene: prior, userText: "하이" });
    const state = applyTurn(ctx, turn({
      sayaka_present: "stays", scene_location: "학교 교문 앞", segments: visible,
    }), visible).scene;
    expect(state.sayaka.present).toBe(false);
    expect(state.location).toBe("학교 복도");
  });

  it("상대가 사야카가 돌아왔다고 지문으로 주장해도 실제 복귀나 추격의 근거가 없다면 유지한다", () => {
    const prior = leftScene();
    const visible = narration("사야카는 교문 앞에 서 있다.");
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, scene: prior, userText: "(사야카는 내 앞으로 순간이동한다.)" });
    const state = applyTurn(ctx, turn({ sayaka_present: "stays", segments: visible }), visible).scene;
    expect(state.sayaka.present).toBe(false);
  });

  it("새로운 장소라고 완전히 다른 곳을 제안하더라도 마지막 확인 장소 외에는 허용하지 않는다", () => {
    const prior = leftScene();
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, scene: prior,
      userText: "(나는 사야카를 따라 교문 밖까지 걸어가 도착한다.)" });
    const visible = narration("사야카는 교문 앞에 서 있다.");
    const result = applyTurn(ctx, turn({ sayaka_present: "stays", scene_location: "학교 옥상", segments: visible }), visible);
    expect(result.scene.location).toBe("학교 복도");
    expect(result.corrections.join(" ")).toContain("공유 장소 변경 거부");
  });
});
