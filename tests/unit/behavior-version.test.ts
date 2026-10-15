import { describe, expect, it } from "vitest";
import { PROMPT_VERSION } from "@/lib/engine/canon";
import { buildPrompt, STABLE_INSTRUCTIONS, selectStableInstructions } from "@/lib/engine/prompt";
import { STABLE_INSTRUCTIONS_V020 } from "@/lib/engine/prompt-v020";
import { analyzePatterns } from "@/lib/engine/patterns";
import { ctxFor } from "../helpers";

function versionPrompt(version: string) {
  return buildPrompt({
    ctx: ctxFor({ promptVersion: version, userText: "안녕" }),
    lore: [], patterns: analyzePatterns([]), historyWindow: 24, disclosedTexts: [],
  });
}

describe("v0.2.0 캐릭터 행동 규칙 비교", () => {
  it("신규 대화 기본 버전은 v0.2.0 비교 실험으로 고정", () => {
    expect(PROMPT_VERSION).toBe("web-0.1.0+v0.2.0-compare");
    expect(selectStableInstructions(PROMPT_VERSION)).toBe(STABLE_INSTRUCTIONS_V020);
  });

  it("기존 v0.3.0 채팅방은 옛 설정 그대로 유지", () => {
    expect(selectStableInstructions("web-0.1.0+v0.3.0")).toBe(STABLE_INSTRUCTIONS);
    expect(versionPrompt("web-0.1.0+v0.3.0").instructions).toBe(STABLE_INSTRUCTIONS);
  });

  it("v0.2.0 채팅방은 v0.2.0 행동 프롬프트를 적용하고 캐시 버전도 분리", () => {
    const p = versionPrompt(PROMPT_VERSION);
    expect(p.instructions).toBe(STABLE_INSTRUCTIONS_V020);
    expect(p.promptCacheVersion).toBe(PROMPT_VERSION);
    expect(p.input[p.input.length - 1]).toEqual({ role: "user", content: "안녕" });
  });

  it("v0.2.0 원전의 교류 방식과 비공개 경계는 유지", () => {
    expect(STABLE_INSTRUCTIONS_V020).toContain("성격은 불친절하게");
    expect(STABLE_INSTRUCTIONS_V020).toContain("호기심과 참견");
    expect(STABLE_INSTRUCTIONS_V020).toContain("질문을 매번");
    expect(STABLE_INSTRUCTIONS_V020).toContain("설정집은 사야카의 자기소개 대본이 아니다");
    expect(STABLE_INSTRUCTIONS_V020).not.toContain("300자 안쪽");
  });

  it("웹사이트 입력에는 부모 직업, 미래 라벨, 매출 수치를 포함하지 않음", () => {
    const forbidden = ["야쿠자", "두목", "츤데레", "1조", "300평", "不撓不屈", "異常", "오야붕"];
    for (const term of forbidden) expect(STABLE_INSTRUCTIONS_V020).not.toContain(term);
  });

  it("구 버전 정보가 없는 테스트 fixture는 기존 v0.3.0 엔진 동작 유지", () => {
    expect(selectStableInstructions()).toBe(STABLE_INSTRUCTIONS);
  });
});
