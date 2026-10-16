import { describe, expect, it } from "vitest";
import { PROMPT_VERSION } from "@/lib/engine/canon";
import {
  buildPrompt, STABLE_INSTRUCTIONS, selectStableInstructions, selectRuntimeInstructions,
} from "@/lib/engine/prompt";
import { STABLE_INSTRUCTIONS_V020 } from "@/lib/engine/prompt-v020";
import { STABLE_INSTRUCTIONS_PLUGIN_V020 } from "@/lib/engine/prompt-plugin-v020";
import { ACTOR_CONSTITUTION } from "@/lib/engine/actor-constitution";
import { FULL_PRIVATE_CANON, PRIVATE_CANON_STATS } from "@/lib/engine/private-canon";
import { analyzePatterns } from "@/lib/engine/patterns";
import { ctxFor } from "../helpers";

function versionPrompt(version: string) {
  return buildPrompt({
    ctx: ctxFor({ promptVersion: version, userText: "안녕" }),
    lore: [], patterns: analyzePatterns([]), historyWindow: 24, disclosedTexts: [],
  });
}

describe("사야카 플러그인 지침·설정 전체 이식", () => {
  it("새 채팅은 승인 캐릭터 판단 헌장 + 전체 비공개 캐논 버전, 기존 채팅은 구 규칙 보존", () => {
    expect(PROMPT_VERSION).toBe("web-0.1.0+plugin-v0.2.0-fidelity-fullcanon-voice-v2-autonomy-v1-offscreen-v1-actor-v2");
    expect(selectStableInstructions(PROMPT_VERSION)).toBe(ACTOR_CONSTITUTION);
    expect(selectStableInstructions(PROMPT_VERSION.replace("-actor-v2", ""))).toBe(STABLE_INSTRUCTIONS_PLUGIN_V020);
    expect(selectStableInstructions(PROMPT_VERSION.replace("-actor-v2", "-actor-v1"))).toBe(ACTOR_CONSTITUTION);
    const p = versionPrompt(PROMPT_VERSION);
    expect(p.instructions).toContain(ACTOR_CONSTITUTION);
    expect(p.instructions).not.toContain(STABLE_INSTRUCTIONS_PLUGIN_V020);
    expect(p.instructions).toContain(FULL_PRIVATE_CANON);
    expect(p.promptCacheVersion).toBe(PROMPT_VERSION);
    expect(p.input[p.input.length - 1]).toEqual({ role: "user", content: "안녕" });
  });

  it("기존 v0.3.0 채팅방은 기존 지침만 사용", () => {
    expect(selectStableInstructions("web-0.1.0+v0.3.0")).toBe(STABLE_INSTRUCTIONS);
    expect(versionPrompt("web-0.1.0+v0.3.0").instructions).toBe(STABLE_INSTRUCTIONS);
  });

  it("기존 v0.2.0 비교 채팅방도 저장된 규칙 유지", () => {
    expect(selectStableInstructions("web-0.1.0+v0.2.0-compare")).toBe(STABLE_INSTRUCTIONS_V020);
    expect(versionPrompt("web-0.1.0+v0.2.0-compare").instructions).toBe(STABLE_INSTRUCTIONS_V020);
  });

  it("설정 전체가 서버 내부 모델에 전달됨", () => {
    expect(PRIVATE_CANON_STATS.fields).toBeGreaterThan(15);
    expect(PRIVATE_CANON_STATS.loreEntries).toBeGreaterThanOrEqual(25);
    expect(PRIVATE_CANON_STATS.hasFamily).toBe(true);
    expect(PRIVATE_CANON_STATS.hasSchool).toBe(true);
    expect(PRIVATE_CANON_STATS.hasItems).toBe(true);
    expect(PRIVATE_CANON_STATS.hasFuture).toBe(true);
    expect(FULL_PRIVATE_CANON).toContain("family_father");
    expect(FULL_PRIVATE_CANON).toContain("mychew_origin");
    expect(FULL_PRIVATE_CANON).toContain("아버지");
    expect(FULL_PRIVATE_CANON).toContain("킨차쿠");
    expect(FULL_PRIVATE_CANON).toContain("제작자 전용");
    expect(FULL_PRIVATE_CANON).toContain("알고 있되 말하지 않거나");
  });

  it("플러그인 행동 지침 자체는 설정의 세부 비밀을 포함하지 않는다", () => {
    for (const forbidden of ["야쿠자", "두목", "300평", "1조", "不撓不屈", "異常"]) {
      expect(STABLE_INSTRUCTIONS_PLUGIN_V020).not.toContain(forbidden);
    }
    expect(STABLE_INSTRUCTIONS_PLUGIN_V020).toContain("성격은 불친절하게");
  });

  it("구 버전이 없는 테스트 fixture는 기존 지침으로 유지", () => {
    expect(selectStableInstructions()).toBe(STABLE_INSTRUCTIONS);
    expect(selectRuntimeInstructions()).toBe(STABLE_INSTRUCTIONS);
  });
});
