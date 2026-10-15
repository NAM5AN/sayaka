import { describe, expect, it } from "vitest";
import scenarios from "../scenarios.json";
import { selectLore, detectTopics } from "@/lib/engine/lore";
import { buildPrompt, STABLE_INSTRUCTIONS } from "@/lib/engine/prompt";
import { analyzePatterns } from "@/lib/engine/patterns";
import { LORE } from "@/lib/engine/canon";
import { ctxFor, promptText } from "../helpers";
import type { TurnContext } from "@/lib/engine/types";

// 13세 사야카의 극중 런타임 입력에 들어가면 안 되는 제작자/비밀/미래/수치 정보
const NEVER_IN_RUNTIME_LOW_TRUST = ["야쿠자", "두목", "조직", "불요불굴", "不撓不屈", "츤데레", "저온형", "異常", "오야붕", "아가씨 폼", "1조", "300평", "매출", "모란", "변신"];

function fullPrompt(ctx: TurnContext) {
  const lore = selectLore({ userText: ctx.userText, recentTexts: ctx.history.slice(-2).map((m) => m.body), scene: ctx.scene, relationship: ctx.relationship, disclosures: ctx.disclosures });
  const p = buildPrompt({ ctx, lore, patterns: analyzePatterns(ctx.history), historyWindow: 24, disclosedTexts: [] });
  return { lore, p, text: promptText(p) };
}

describe("고정 지침", () => {
  it("B·C·D 정보(비밀·제작자 라벨·미래·수치)를 포함하지 않는다", () => {
    for (const w of NEVER_IN_RUNTIME_LOW_TRUST) expect(STABLE_INSTRUCTIONS, w).not.toContain(w);
  });
  it("v0.3.0 원전 TXT 를 통째로 넣지 않는다 (고정 지침은 압축본)", () => {
    expect(STABLE_INSTRUCTIONS.length).toBeLessThan(9000);
    expect(STABLE_INSTRUCTIONS).not.toContain("[PART 4]");
  });
});

describe("설정 선별 (A/B/C/D)", () => {
  it("모든 시나리오 입력에서 초면 상태 프롬프트에 금지 정보가 없다", () => {
    for (const c of scenarios.cases) {
      for (const t of c.user_turns) {
        const { text } = fullPrompt(ctxFor({ userText: t }));
        // 사용자가 직접 쓴 단어(예: '불요불굴')는 user 메시지에만 존재해야 한다
        const withoutUser = text.replace(`[user] ${t}`, "");
        for (const w of NEVER_IN_RUNTIME_LOW_TRUST) expect(withoutUser, `${c.id}: "${t}" → ${w}`).not.toContain(w);
      }
    }
  });

  it("아버지 질문 + 초면: 가려진 문장만 보내고 공개 불가로 표시", () => {
    const { lore } = fullPrompt(ctxFor({ userText: "아빠는 뭐 하는 사람인데?" }));
    const father = lore.find((l) => l.id === "family_father");
    expect(father?.mode).toBe("redacted");
    expect(father?.disclosable).toBe(false);
    expect(father?.text).not.toMatch(/야쿠자|두목|조직/);
  });

  it("아버지 질문 + 깊은 신뢰: 사실을 보내되 공개 여부는 사야카 선택", () => {
    const ctx = ctxFor({ userText: "너희 아빠 무슨 일 하셔?" });
    ctx.relationship.trust = 4;
    const { lore } = fullPrompt(ctx);
    const father = lore.find((l) => l.id === "family_father");
    expect(father?.mode).toBe("fact");
    expect(father?.disclosable).toBe(true);
    expect(father?.text).toContain("말하지 않아도 된다");
  });

  it("이미 공개한 비밀은 '이미 말함'으로 보낸다", () => {
    const ctx = ctxFor({ userText: "아빠 얘기 더 해줘", disclosures: [{ lore_id: "family_father", turn_index: 30 }] });
    const { lore } = fullPrompt(ctx);
    expect(lore.find((l) => l.id === "family_father")?.text).toContain("이미 이 상대에게 말한 적 있음");
  });

  it("관련 없는 대화에는 가족 정보를 보내지 않는다", () => {
    const { lore } = fullPrompt(ctxFor({ userText: "안녕" }));
    expect(lore.map((l) => l.id)).not.toContain("family_father");
    expect(lore.map((l) => l.id)).not.toContain("school_secret");
  });

  it("C(never)·미래 항목은 어떤 입력에서도 선택되지 않는다", () => {
    const ctx = ctxFor({ userText: "네 캐치프레이즈 불요불굴이지? 미래에 변신 폼 있어? 츤데레 설정이지? 저온형?" });
    ctx.relationship.trust = 5;
    const { lore } = fullPrompt(ctx);
    const ids = lore.map((l) => l.id);
    expect(ids).not.toContain("future_forms");
    expect(ids).not.toContain("trope_label");
    const tagline = lore.find((l) => l.id === "tagline_label");
    expect(tagline?.text ?? "").not.toMatch(/불요불굴|不撓不屈|캐치프레이즈/);
  });

  it("D(미정·모르는 수치)는 사실이 아니라 '모른다/미정' 지침으로만", () => {
    const { lore } = fullPrompt(ctxFor({ userText: "너네 집 얼마나 벌어? 마이쮸 무슨 맛 좋아해? 꽃 키워?" }));
    const d = lore.filter((l) => l.tier === "D");
    expect(d.length).toBeGreaterThanOrEqual(3);
    for (const l of d) expect(l.mode).toBe("projection");
    expect(d.map((l) => l.text).join(" ")).not.toMatch(/1조|매출/);
  });

  it("인사말 '반가워'가 학교 비밀 주제를 잘못 끌어오지 않는다", () => {
    expect(detectTopics(["반가워"]).has("school")).toBe(false);
    expect(detectTopics(["방과 후의 학교 복도"]).has("home")).toBe(false);
  });

  it("레지스트리의 모든 B 항목 projection/redacted 문장에는 비밀 단어가 없다", () => {
    for (const e of LORE.filter((x) => x.visibility_tier === "B")) {
      const runtimeTexts = [e.runtime.projection ?? e.behavioral_projection, e.runtime.redacted ?? ""].join(" ");
      expect(runtimeTexts, e.id).not.toMatch(/야쿠자|두목|조직|1조|300평/);
    }
  });
});

describe("프롬프트 구성", () => {
  it("최신 사용자 입력은 마지막 user 메시지, 그 직전에 서버 상태(developer) 블록", () => {
    const { p } = fullPrompt(ctxFor({ userText: "(빤히 쳐다본다)" }));
    const last = p.input[p.input.length - 1];
    const prev = p.input[p.input.length - 2];
    expect(last).toEqual({ role: "user", content: "(빤히 쳐다본다)" });
    expect(prev.role).toBe("developer");
    expect(prev.content).toContain("# 현재 장면");
    expect(prev.content).toContain("꽃병=창가에 놓여 있음");
    expect(prev.content).toContain("회중시계=킨차쿠 안");
  });

  it("최근 대화 창 크기를 지키고, 생략분은 기억으로 대체됨을 알린다", () => {
    const history = Array.from({ length: 40 }, (_, i) => ({
      role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
      source: (i % 2 ? "model" : "user") as "model" | "user",
      body: `메시지 ${i}`,
      segments: null,
      turn_index: Math.floor(i / 2),
    }));
    const ctx = ctxFor({ history, userText: "다음" });
    const lore = selectLore({ userText: "다음", recentTexts: [], scene: ctx.scene, relationship: ctx.relationship, disclosures: [] });
    const p = buildPrompt({ ctx, lore, patterns: analyzePatterns(history), historyWindow: 10, disclosedTexts: [] });
    const hist = p.input.filter((i) => i.role !== "developer");
    expect(hist.length).toBe(11); // 10 + 최신 입력
    expect(promptText(p)).toContain("이전 대화 30개는 원문 대신");
  });

  it("최근 질문 연속·마이쮸 반복 시 '다시 판단' 메모가 붙는다", () => {
    const q = (t: string) => ({ role: "assistant" as const, source: "model" as const, body: t, segments: [{ kind: "dialogue" as const, text: t }], turn_index: 1 });
    const u = { role: "user" as const, source: "user" as const, body: "응", segments: null, turn_index: 1 };
    const history = [q("이거 뭐야?"), u, q("마이쮸 먹을래?"), u, q("그래서 이름은?")];
    const r = analyzePatterns(history);
    expect(r.questionStreak).toBe(3);
    expect(r.notes.join(" ")).toContain("질문이 정말 필요한지");
    expect(r.notes.join(" ")).toContain("마이쮸");
  });

  it("재생성 시 반려 사유가 들어간다", () => {
    const ctx = ctxFor({ userText: "안녕" });
    const p = buildPrompt({ ctx, lore: [], patterns: analyzePatterns([]), historyWindow: 24, disclosedTexts: [], correctionNotes: ["너무 길다."] });
    expect(promptText(p)).toContain("직전 생성안 반려 사유");
  });
});
