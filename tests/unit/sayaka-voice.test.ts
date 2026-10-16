import { describe, expect, it } from "vitest";
import { VOICE_INSTRUCTIONS, voicePatternNotes, overlyTeacherlyReply } from "@/lib/engine/voice";
import { selectRuntimeInstructions, buildPrompt } from "@/lib/engine/prompt";
import { selectLore } from "@/lib/engine/lore";
import { PROMPT_VERSION } from "@/lib/engine/canon";
import { ctxFor, turn } from "../helpers";
import { analyzePatterns } from "@/lib/engine/patterns";
import { validateTurn } from "@/lib/engine/validate";

function modelReply(body: string, turnIndex: number) {
  return { role: "assistant" as const, source: "model" as const, body, segments: [{ kind: "dialogue" as const, text: body }], turn_index: turnIndex };
}
function currentLore(userText: string) {
  const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText });
  return selectLore({
    userText, recentTexts: [], scene: ctx.scene,
    relationship: ctx.relationship, disclosures: [], promptVersion: PROMPT_VERSION,
  });
}

describe("사야카 말투 원형 복원", () => {
  it("현재 엔진은 사용자 승인 말투 지침을 전체 설정 뒤에 적용한다", () => {
    const instructions = selectRuntimeInstructions(PROMPT_VERSION);
    expect(instructions).toContain(VOICE_INSTRUCTIONS);
    expect(instructions).toContain("성격은 불친절하게");
    expect(instructions).toContain("13살 여학생");
    expect(instructions.indexOf("## 전체 로어 레지스트리")).toBeLessThan(instructions.indexOf("# 사야카의 살아 있는 말투"));
    expect(instructions).toContain("가족에 대한 감정은 집안의 비밀과 다르다");
  });

  it("기존 플러그인 계열 채팅도 이어 말할 때 개선된 말투를 사용한다", () => {
    expect(selectRuntimeInstructions("web-0.1.0+plugin-v0.2.0-fidelity-fullcanon")).toContain(VOICE_INSTRUCTIONS);
    expect(selectRuntimeInstructions("web-0.1.0+v0.2.0-compare")).not.toContain(VOICE_INSTRUCTIONS);
    expect(selectRuntimeInstructions("web-0.1.0+v0.3.0")).not.toContain(VOICE_INSTRUCTIONS);
  });

  it("말투는 특정 감탄사·질문·길이를 매번 강제하지 않는다", () => {
    expect(VOICE_INSTRUCTIONS).toContain("매 대사 앞에 붙이거나");
    expect(VOICE_INSTRUCTIONS).toContain("대사·지문 개수에 맞춰 만들지 않는다");
    expect(VOICE_INSTRUCTIONS).toContain("문장 수");
    expect(VOICE_INSTRUCTIONS).toContain("가능한 해석");
  });

  it("훈계만 하는 답변을 도발 상황에서 검수하도록 판정한다", () => {
    const line = [{ kind: "dialogue" as const, text: "너부터 예의 좀 갖춰. 그런 말 하면 안 되잖아." }];
    expect(overlyTeacherlyReply("provocation", "짐승 같아서 말이야.", line)).toBe(true);
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "너 짐승 같아." });
    const issues = validateTurn({ ctx, turn: turn({ user_move: "provocation", segments: line }), segments: line, hadSpeakerLabel: false });
    expect(issues.some((i) => i.code === "teacherly_provocation" && i.severity === "retry")).toBe(true);
  });

  it("자기 불쾌함을 분명히 표현하는 불평은 강제 재생성하지 않는다", () => {
    const angry = [{ kind: "dialogue" as const, text: "뭘 그렇게 봐? 기분 나쁘게!" }];
    expect(overlyTeacherlyReply("provocation", "(빤히 쳐다본다) 너 꼬맹이네", angry)).toBe(false);
    const ctx = ctxFor({ promptVersion: PROMPT_VERSION, userText: "너 짐승 같아" });
    const issues = validateTurn({ ctx, turn: turn({ user_move: "provocation", segments: angry }), segments: angry, hadSpeakerLabel: false });
    expect(issues.some((i) => i.code === "teacherly_provocation")).toBe(false);
  });

  it("평범한 대화에서 가끔 예의를 지적해도 자동 차단하지 않는다", () => {
    const line = [{ kind: "dialogue" as const, text: "예의 좀 갖춰. 진짜 짜증 나거든." }];
    expect(overlyTeacherlyReply("small_talk", "점심 뭐 먹을래?", line)).toBe(false);
    expect(overlyTeacherlyReply("provocation", "너 바보야?", line)).toBe(false);
  });

  it("반복되는 훈계조와 결정 떠넘기기에 대해서만 다음 턴 점검 메모를 만든다", () => {
    const history = [
      modelReply("그런 식으로 말하면 안 되잖아. 예의 좀 갖춰.", 1),
      modelReply("네가 정해. 그건 좀 그렇잖아.", 2),
      modelReply("그런 식으로 하는 건 무례한 행동이야. 네가 결정해.", 3),
    ];
    const notes = voicePatternNotes(history).join(" ");
    expect(notes).toContain("어른 말투");
    expect(notes).toContain("계속 상대에게 결정");
    expect(notes).toContain("비슷한 문장 종결");
    expect(voicePatternNotes([modelReply("꽃은 조용하니까.", 1)])).toEqual([]);
  });

  it("새 채팅의 developer 블록에 최근 말투 반복 점검이 포함된다", () => {
    const ctx = ctxFor({
      promptVersion: PROMPT_VERSION,
      userText: "그런데 너는?",
      history: [
        modelReply("네가 정해. 뭐.", 1),
        modelReply("그건 네가 결정해.", 2),
      ],
    });
    const built = buildPrompt({
      ctx, lore: [], patterns: analyzePatterns(ctx.history, ctx.promptVersion),
      historyWindow: 24, disclosedTexts: [],
    });
    const context = built.input.find((i) => i.role === "developer")?.content || "";
    expect(context).toContain("# 대사 어조 점검");
    expect(context).toContain("상대에게 결정");
  });
});

describe("일상적인 부모 애정 표현과 집안 비밀 분리", () => {
  it("부모가 좋냐는 일상 질문은 허용 가능한 태도·말투 정보로 제공한다", () => {
    const father = currentLore("엄마아빠는 좋아해?").find((x) => x.id === "family_father");
    const mother = currentLore("엄마아빠는 좋아해?").find((x) => x.id === "family_mother");
    expect(father?.mode).toBe("projection");
    expect(mother?.mode).toBe("projection");
    expect(father?.disclosable).toBe(false);
    expect(father?.text).toContain("부모를 좋아하냐는 단순한 감정 질문");
    expect(father?.text).not.toMatch(/야쿠자|두목|조직/);
  });

  it("부모의 직업이나 신상을 물으면 이전처럼 비공개 처리한다", () => {
    expect(currentLore("아빠는 무슨 일 해?").find((x) => x.id === "family_father")?.mode).toBe("redacted");
    expect(currentLore("엄마 좋아해? 직업도 알려줘").find((x) => x.id === "family_mother")?.mode).toBe("redacted");
  });

  it("옛 v0.3.0 채팅의 공개 규칙은 달라지지 않는다", () => {
    const ctx = ctxFor({ promptVersion: "web-0.1.0+v0.3.0", userText: "엄마 좋아해?" });
    const out = selectLore({ userText: ctx.userText, recentTexts: [], scene: ctx.scene, relationship: ctx.relationship, disclosures: [], promptVersion: ctx.promptVersion });
    expect(out.find((x) => x.id === "family_mother")?.mode).toBe("redacted");
  });
});
