import { describe, expect, it } from "vitest";
import { getOpening, initialScene, PROMPT_VERSION } from "@/lib/engine/canon";
import { realTimeElapsedMinutes, realTimePromptBlock, resetRealTimeCheckpoint } from "@/lib/engine/time-flow";
import { buildPrompt } from "@/lib/engine/prompt";
import { analyzePatterns } from "@/lib/engine/patterns";
import { ctxFor } from "../helpers";

const baseDate = new Date("2026-10-16T11:30:00.000Z");

describe("채팅방별 현실 시간 옵션 (기본 OFF)", () => {
  it("새 채팅은 OFF이며, 기본/과거 채팅 모두 시간 힌트가 없다", () => {
    const scene = initialScene(getOpening("quiet_v030"));
    expect(scene.real_time).toEqual({ enabled: false, anchor_at: null });
    expect(realTimeElapsedMinutes(scene, baseDate)).toBeNull();
    expect(realTimePromptBlock(scene, baseDate)).toBeNull();
    const legacy = { ...scene, real_time: undefined };
    expect(realTimePromptBlock(legacy, baseDate)).toBeNull();
  });

  it("켜면 마지막 기록부터 실제로 지난 시간을 계산하되 이벤트를 자동 생성하지 않는다", () => {
    const scene = initialScene(getOpening("quiet_v030"));
    scene.real_time = { enabled: true, anchor_at: "2026-10-16T10:00:00.000Z" };
    expect(realTimeElapsedMinutes(scene, baseDate)).toBe(90);
    const text = realTimePromptBlock(scene, baseDate)!;
    expect(text).toContain("1시간 30분");
    expect(text).toContain("비공개 사건을 자동 생성하지 않는다");
    expect(text).toContain("상대가 어떤 행동을 했는지 확정하지 않는다");
  });

  it("OFF는 날짜가 남았어도 전혀 반영하지 않으며 ON의 체크포인트는 성공 시에만 갱신", () => {
    const scene = initialScene(getOpening("quiet_v030"));
    scene.real_time = { enabled: true, anchor_at: "2026-10-16T10:00:00.000Z" };
    resetRealTimeCheckpoint(scene, baseDate);
    expect(scene.real_time.anchor_at).toBe(baseDate.toISOString());
    const next = new Date(baseDate.getTime() + 35 * 60_000);
    expect(realTimeElapsedMinutes(scene, next)).toBe(35);
    scene.real_time = { enabled: false, anchor_at: "2026-10-16T10:00:00.000Z" };
    resetRealTimeCheckpoint(scene, next);
    expect(scene.real_time.anchor_at).toBe("2026-10-16T10:00:00.000Z");
    expect(realTimeElapsedMinutes(scene, next)).toBeNull();
  });

  it("장시간 방치해도 최대 30일까지만 시간 힌트를 계산한다", () => {
    const scene = initialScene(getOpening("quiet_v030"));
    scene.real_time = { enabled: true, anchor_at: "2025-01-01T00:00:00Z" };
    expect(realTimeElapsedMinutes(scene, baseDate)).toBe(30 * 24 * 60);
    expect(realTimePromptBlock(scene, baseDate)).toContain("30일 이상");
  });

  it("이상한 체크포인트나 아직 오지 않은 시각으로 세계관을 망치지 않는다", () => {
    const scene = initialScene(getOpening("quiet_v030"));
    scene.real_time = { enabled: true, anchor_at: "invalid" };
    expect(realTimePromptBlock(scene, baseDate)).toBeNull();
    scene.real_time.anchor_at = "2026-10-17T00:00:00Z";
    expect(realTimeElapsedMinutes(scene, baseDate)).toBe(0);
  });

  it("동일한 대화 이력이라도 ON일 때만 GPT에 현실 시간 참고 정보를 제공", () => {
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "안녕" });
    const without = buildPrompt({
      ctx, lore: [], patterns: analyzePatterns([]),
      historyWindow: 24, disclosedTexts: [],
    });
    expect(without.input.find(x => x.role === "developer")?.content).not.toContain("현실 시간 흐름");
    ctx.scene.real_time = { enabled: true, anchor_at: "2026-10-16T10:00:00Z" };
    const withClock = buildPrompt({
      ctx, lore: [], patterns: analyzePatterns([]),
      historyWindow: 24, disclosedTexts: [],
    });
    const dynamic = withClock.input.find(x => x.role === "developer")?.content;
    expect(dynamic).toContain("현실 시간 흐름");
    expect(dynamic).toContain("다음 대화에서 시간 차이를 참고");
  });
});
