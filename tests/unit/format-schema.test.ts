import { describe, expect, it } from "vitest";
import { normalizeSegments, renderBody, endsWithQuestion } from "@/lib/engine/format";
import { turnJsonSchema, parseModelTurn, ModelOutputError } from "@/lib/engine/schema";
import { turn } from "../helpers";

describe("대사·지문 정규화", () => {
  it("따옴표·괄호·이름표를 벗기고 섞인 지문을 분리한다", () => {
    const r = normalizeSegments([
      { kind: "dialogue", text: '사야카: "뭘 봐." (눈을 흘긴다) "기분 나쁘게."' },
      { kind: "narration", text: "(창밖을 본다.)" },
    ]);
    expect(r.hadSpeakerLabel).toBe(true);
    expect(r.segments).toEqual([
      { kind: "dialogue", text: "뭘 봐." },
      { kind: "narration", text: "눈을 흘긴다" },
      { kind: "dialogue", text: "기분 나쁘게." },
      { kind: "narration", text: "창밖을 본다." },
    ]);
  });

  it("본문은 (지문) + \"대사\" 형식", () => {
    expect(renderBody([{ kind: "narration", text: "꽃잎을 편다." }, { kind: "dialogue", text: "됐어." }])).toBe('(꽃잎을 편다.)\n\n"됐어."');
  });

  it("행동만 있는 응답도 유효", () => {
    const r = normalizeSegments([{ kind: "narration", text: "말없이 시든 잎을 떼어낸다." }]);
    expect(r.segments).toHaveLength(1);
    expect(endsWithQuestion(r.segments)).toBe(false);
  });

  it("빈 텍스트는 버린다", () => {
    expect(normalizeSegments([{ kind: "dialogue", text: '  ""  ' }]).segments).toHaveLength(0);
  });
});

describe("Structured Outputs 스키마", () => {
  it("strict 규칙: 모든 객체가 additionalProperties:false 이고 모든 속성이 required", () => {
    const walk = (node: Record<string, unknown>, path: string) => {
      if (node.type === "object") {
        expect(node.additionalProperties, path).toBe(false);
        const props = Object.keys(node.properties as object);
        expect([...(node.required as string[])].sort(), path).toEqual([...props].sort());
        for (const [k, v] of Object.entries(node.properties as Record<string, Record<string, unknown>>)) walk(v, `${path}.${k}`);
      }
      if (node.type === "array") walk(node.items as Record<string, unknown>, `${path}[]`);
      // strict 에서 지원이 불확실한 키워드는 쓰지 않는다
      for (const k of ["minItems", "maxItems", "maxLength", "minLength", "pattern", "format"]) expect(node[k], `${path}.${k}`).toBeUndefined();
    };
    walk(turnJsonSchema(), "$");
  });

  it("판단 필드가 출력(segments)보다 먼저 온다", () => {
    const keys = Object.keys((turnJsonSchema().properties as object));
    expect(keys.indexOf("action_intent")).toBeLessThan(keys.indexOf("segments"));
    expect(keys.indexOf("sayaka_want")).toBeLessThan(keys.indexOf("segments"));
  });

  it("정상 JSON 파싱, 잘못된 JSON/스키마 거부", () => {
    expect(parseModelTurn(JSON.stringify(turn())).action_intent).toBe("continue_task");
    expect(() => parseModelTurn("{not json")).toThrow(ModelOutputError);
    expect(() => parseModelTurn(JSON.stringify({ ...turn(), emotion: "furious" }))).toThrow(ModelOutputError);
  });
});
