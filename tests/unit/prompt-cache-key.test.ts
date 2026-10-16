import { describe, expect, it } from "vitest";
import { promptCacheKeyForVersion } from "@/lib/engine/llm";

describe("OpenAI API 프롬프트 캐시 키 길이 회귀", () => {
  it("긴 프롬프트 버전에도 API 허용 길이 64자를 넘지 않는다", () => {
    const version = "web-0.1.0+plugin-v0.2.0-fidelity-fullcanon-voice-v2-autonomy-v1";
    const oldKey = "sayaka-" + version;
    expect(oldKey.length).toBeGreaterThan(64);
    const key = promptCacheKeyForVersion(version);
    expect(key.length).toBeLessThanOrEqual(64);
    expect(key).toMatch(/^sayaka-[a-f0-9]{24}$/);
  });
  it("같은 버전은 캐시 재사용 가능하게 동일한 키, 다른 버전은 서로 다른 키", () => {
    expect(promptCacheKeyForVersion("v1")).toBe(promptCacheKeyForVersion("v1"));
    expect(promptCacheKeyForVersion("v1")).not.toBe(promptCacheKeyForVersion("v1-added"));
  });
});
