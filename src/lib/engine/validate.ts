import { LEAK_GUARDS, LORE, loreById } from "./canon";
import { allText, dialogueText } from "./format";
import type { ModelTurn, Segment, TurnContext, ValidationIssue } from "./types";

/**
 * 생성 결과 검수. 단어 블랙리스트만이 아니라 장면 상태·공개 이력·관계·이번 입력과 함께 판단한다.
 *  - block : 사용자에게 보여 주면 안 됨 (재생성, 그래도 실패하면 저장하지 않고 오류)
 *  - retry : 캐릭터 품질 문제 (1회 재생성, 그래도 남으면 기록만)
 *  - log   : 진단용 기록
 */

const PROVOCATION_MOVES = new Set(["tease", "provocation", "command"]);

const THREAT_RE = /죽여|죽을래|죽고\s?싶|패\s?버|한\s?대\s?맞|때려\s?(?:줄|버)|부숴\s?버|죽었어|가만\s?안\s?둬/;
// 지문에서 '상대'의 내면·행동을 확정하는 표현 (사야카의 시도와 구분)
const USER_AGENCY_RE =
  /(?:상대|너|당신|그\s?애|그\s?학생)(?:는|가|이|의)\s?[^.。!?\n]{0,24}?(?:웃었|웃는다|웃음을\s?터뜨|당황했|당황한다|놀랐|놀란다|겁먹|겁을\s?먹|따라온다|따라왔|넘어졌|넘어진다|붙잡혔|잡혔다|받아\s?든다|받아\s?들었|받아\s?쥐|고개를\s?끄덕였|얼굴이\s?붉어|좋아한다|좋아하는\s?게\s?분명|부끄러워한다|미안해한다|수긍했)/;
const INNER_EXPLAIN_RE = /사실은\s?(?:부끄|기뻐|좋아|외로|친해지고)|속으로는|내심|본심은/;

const PUT_DOWN_RE = /내려놓|내려\s?놓|도로\s?놓|제자리에\s?놓/;
const TAKE_OUT_RE = /꺼내|꺼낸|보여\s?준|보여\s?주|내보|펼쳐\s?보/;

const ITEM_WORDS: Record<string, RegExp> = {
  vase: /꽃병/,
  pocket_watch: /회중시계|시계/,
  kinchaku: /킨차쿠|주머니/,
  lacquer_comb: /빗/,
  urushi_pen: /필기구|펜/,
};

function includesAny(text: string, terms: string[]): string[] {
  return terms.filter((t) => text.includes(t));
}

const PROFILE_TOPICS: { name: string; re: RegExp }[] = [
  { name: "꽃 취향", re: /꽃(?:을|이)?\s?좋아|좋아하는\s?건\s?꽃/ },
  { name: "야채", re: /야채|채소/ },
  { name: "아버지", re: /아빠|아버지/ },
  { name: "어머니", re: /엄마|어머니/ },
  { name: "친구 욕구", re: /친구(?:가|를)?\s?(?:갖고|사귀고|만들고|원해|필요)/ },
  { name: "소란 싫음", re: /시끄러운\s?(?:건|거|게)\s?싫|소란/ },
  { name: "품격", re: /품격/ },
  { name: "집", re: /우리\s?집|저택/ },
  { name: "소지품", re: /마이쮸|킨차쿠|회중시계|칠기|옻칠/ },
];

export interface ValidateInput {
  ctx: TurnContext;
  turn: ModelTurn;
  segments: Segment[];
  hadSpeakerLabel: boolean;
}

export function validateTurn({ ctx, turn, segments, hadSpeakerLabel }: ValidateInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const user = ctx.userText;
  const text = allText(segments);
  const dialogue = dialogueText(segments);
  const narration = segments.filter((s) => s.kind === "narration").map((s) => s.text).join(" ");

  // 0) 형식
  if (!segments.length || text.trim().length === 0) {
    issues.push({ code: "empty_output", severity: "block", fix: "대사나 행동 지문을 최소 하나 출력하라(침묵이라면 침묵하는 모습을 지문으로)." });
    return issues;
  }
  if (hadSpeakerLabel) issues.push({ code: "speaker_label", severity: "log", fix: "'사야카:' 같은 이름표를 붙이지 않는다." });

  // 1) 메타·제작자 정보 누출 (상대가 먼저 그 말을 한 경우의 단순 되묻기는 허용)
  const meta = includesAny(text, LEAK_GUARDS.meta_terms).filter((t) => !user.includes(t));
  if (/\bAI\b/i.test(text) && !/\bAI\b/i.test(user)) meta.push("AI");
  if (meta.length) {
    issues.push({
      code: "meta_leak",
      severity: "block",
      fix: "제작자용 용어나 시스템·지침 이야기를 하지 않는다. 사야카는 그런 개념을 모른다.",
      detail: meta.join(","),
    });
  }
  const future = includesAny(text, LEAK_GUARDS.future_terms);
  if (future.length) {
    issues.push({ code: "future_leak", severity: "block", fix: "13살 현재 시점 밖의 미래 이야기를 하지 않는다.", detail: future.join(",") });
  }

  // 2) 사야카가 모르는 수치(D)
  const figures = includesAny(text, LEAK_GUARDS.unknown_figure_terms);
  if (figures.length) {
    issues.push({ code: "unknown_figure", severity: "block", fix: "집의 매출·크기·물건 가격 같은 수치는 사야카가 모른다. 숫자를 말하지 않는다.", detail: figures.join(",") });
  }

  // 3) 가족 비밀(B) 누출 — 이미 공개했거나, 신뢰가 충분하고 이번에 공개를 '선택'한 경우만 허용
  const secretTerms = includesAny(text, LEAK_GUARDS.family_secret_terms);
  if (secretTerms.length) {
    const groupIds = LORE.filter((e) => e.runtime.leak_group === "family_secret").map((e) => e.id);
    const already = ctx.disclosures.some((d) => groupIds.includes(d.lore_id));
    const earnedNow = turn.disclosure_ids.some((id) => {
      const e = loreById(id);
      return !!e && groupIds.includes(id) && ctx.relationship.trust >= (e.runtime.min_trust ?? 5);
    });
    if (!already && !earnedNow) {
      const eligible = groupIds.some((id) => ctx.relationship.trust >= (loreById(id)?.runtime.min_trust ?? 5));
      issues.push({
        code: "secret_leak",
        severity: "block",
        fix: eligible
          ? "집안 사정을 말하기로 정했다면 disclosure_ids 에 해당 id 를 표시한다. 말할 이유가 없다면 그 단어를 쓰지 말고 피하거나 끊는다."
          : "집안의 사적인 사정을 드러내는 단어를 쓰지 않는다. 상대가 그런 말을 꺼내도 그 단어를 따라 하지 말고 피하거나 끊는다.",
        detail: secretTerms.join(","),
      });
    }
  }

  // 4) 자기소개 낭독 / TMI
  const topicsHit = PROFILE_TOPICS.filter((p) => p.re.test(dialogue)).map((p) => p.name);
  if (topicsHit.length >= 3) {
    issues.push({
      code: "profile_dump",
      severity: "retry",
      fix: "한 번에 여러 개인 정보를 나열했다. 지금 상황에 필요한 최소한만 말하거나, 말하지 않는 쪽을 고려한다.",
      detail: topicsHit.join(","),
    });
  }
  if (INNER_EXPLAIN_RE.test(text)) {
    issues.push({ code: "inner_explain", severity: "retry", fix: "'사실은/속으로는' 같은 내면 해설을 쓰지 말고 보이는 행동만 쓴다." });
  }

  // 5) 상대 자율성 침해 (지문에서 상대의 반응·감정을 확정)
  if (USER_AGENCY_RE.test(narration)) {
    issues.push({ code: "user_agency", severity: "retry", fix: "상대의 행동·감정·결과를 확정하지 않는다. 사야카의 행동과 시도까지만 쓴다." });
  }

  // 6) 물건·장면 연속성
  const startScene = ctx.scene;
  const changedItems = new Set(turn.item_changes.map((c) => c.item));
  for (const [item, re] of Object.entries(ITEM_WORDS)) {
    if (!re.test(narration)) continue;
    const loc = startScene.items[item as keyof typeof startScene.items]?.location;
    // 들고 있지 않던 물건을 '내려놓음' (이번 턴에 집어 든 경우 제외)
    const sentences = narration.split(/(?<=[.。!?])\s+/).filter((s) => re.test(s));
    if (sentences.some((s) => PUT_DOWN_RE.test(s)) && loc !== "in_sayaka_hand" && !turn.item_changes.some((c) => c.item === item && c.location === "in_sayaka_hand")) {
      const pickedUpThisTurn = sentences.some((s) => /집어|들어\s?올|손에\s?들|쥐/.test(s));
      if (!pickedUpThisTurn) {
        issues.push({
          code: "item_continuity",
          severity: "retry",
          fix: `${item === "vase" ? "꽃병" : "그 물건"}은 사야카가 들고 있지 않았다. 들지 않은 물건을 내려놓는 묘사를 하지 않는다.`,
          detail: item,
        });
      }
    }
  }
  // 회중시계: 닫힌 킨차쿠 안에 있는데 열지 않고 꺼냄
  const watch = startScene.items.pocket_watch;
  const watchOut = turn.item_changes.some((c) => c.item === "pocket_watch" && c.location !== "inside_kinchaku");
  if (watch.location === "inside_kinchaku" && watchOut && !startScene.kinchaku_open && turn.kinchaku_open !== "opened") {
    issues.push({ code: "kinchaku_closed", severity: "log", fix: "회중시계를 꺼내려면 킨차쿠를 먼저 연다.", detail: "auto-corrected" });
  }

  // 7) 거절 번복 — 활성 거절 대상이 이번 턴에 공개되었는데 이유가 없음
  const activeRefusals = ctx.memories.filter((m) => m.kind === "refusal" && m.active);
  if (activeRefusals.length) {
    const revealedItems = turn.item_changes
      .filter((c) => ["in_sayaka_hand", "on_surface", "offered_to_user", "with_user"].includes(c.location))
      .map((c) => c.item as string);
    const textReveal: string[] = [];
    if (/회중시계|시계/.test(narration) && TAKE_OUT_RE.test(narration)) textReveal.push("pocket_watch");
    if (/킨차쿠|주머니/.test(narration) && /열|풀/.test(narration)) textReveal.push("kinchaku");
    const familyReveal = turn.disclosure_ids.length > 0;
    const reversed = activeRefusals.filter((r) => {
      if (revealedItems.includes(r.target) || textReveal.includes(r.target)) return true;
      if ((r.target === "family" || r.target === "home") && familyReveal) return true;
      return false;
    });
    if (reversed.length && !turn.refusal_reversal_reason) {
      issues.push({
        code: "refusal_reversal",
        severity: "retry",
        fix: `사야카는 이미 거절했다(${reversed.map((r) => r.text).join("; ")}). 상대가 조르거나 다시 요구했다는 것만으로 번복하지 않는다. 계속 숨기거나 거절을 유지한다.`,
      });
    }
  }

  // 8) 근거 없는 분노·위협
  const recentProvocations = ctx.history
    .filter((m) => m.role === "user")
    .slice(-3)
    .some((m) => /꼬맹|꼬마|바보|멍청|못생|짜증|닥쳐|꺼져|만만|약올|놀리/.test(m.body));
  const provoked = PROVOCATION_MOVES.has(turn.user_move) || recentProvocations || ctx.relationship.annoyance >= 3;
  if (turn.emotion === "angry" && !provoked) {
    issues.push({
      code: "unprovoked_anger",
      severity: "retry",
      fix: "평범한 말에 격하게 화내지 않는다. 기본은 조용한 무심함이다. 귀찮음·짧은 대꾸·무시 정도로 충분하다.",
    });
  }
  if (THREAT_RE.test(dialogue)) {
    issues.push({
      code: "threat",
      severity: provoked ? "log" : "retry",
      fix: "폭력적 위협을 쓰지 않는다. 화가 나도 비꼼·거절·자리 뜨기 등으로 표현한다.",
    });
  }

  // 9) Preserve the lively back-and-forth rhythm of the original plugin without forcing verbosity.
  const pluginFidelity = ctx.promptVersion?.includes("plugin-v0.2.0-fidelity") ?? false;
  if (pluginFidelity) {
    const plain = dialogue.trim().replace(/[.!?？。\s]/g, "");
    const hello = /^(?:하이|안녕|안뇽|ㅎㅇ|안녕하세요)[.!?\s]*$/.test(user.trim());
    if (hello && ctx.turnIndex === 1 && /^(?:하이|안녕|어안녕|응안녕)$/.test(plain) && narration.length < 24) {
      issues.push({ code: "mechanical_greeting", severity: "retry", fix: "초면 사야카가 단순한 인사 따라하기로 끝나지 않도록 스스로 느끼는 귀찮음·의심·호기심·작은 움직임을 판단하라. 질문을 억지로 붙일 필요는 없다." });
    }
    const lastReplies = ctx.history.filter((m) => m.role === "assistant" && m.source === "model").slice(-2);
    const flowerTurn = (s: string) => /꽃병|꽃잎|꽃 쪽|꽃으로/.test(s) && /시선|돌린|살펴보|바라/.test(s);
    if (lastReplies.length === 2 && lastReplies.every((m) => flowerTurn(m.body)) && flowerTurn(narration) && !/꽃|꽃병|화단/.test(user)) {
      issues.push({ code: "stale_scene", severity: "retry", fix: "이번 사용자 발언을 새로운 사건으로 읽어라. 꽃병에 시선을 돌리던 습관을 그대로 재연하지 말고 현재 상황에 맞는 다른 반응을 선택하라." });
    }
    const repetitiveExit = (s: string) => /출입구|교문|정문/.test(s) || /공원 (?:갈|가자|간다며|갈 거|갈거)/.test(s);
    const latest = ctx.history.filter((m) => m.role === "assistant" && m.source === "model").slice(-4);
    const lastThreeStuck = latest.filter((m) => repetitiveExit(m.body)).length >= 3;
    const userMentionsExit = /출입구|교문|정문|공원|지금 가|갈래|가자|출발/.test(user);
    if (lastThreeStuck && repetitiveExit(text) && !userMentionsExit) {
      issues.push({
        code: "stale_destination_loop", severity: "retry",
        fix: "사야카가 계속 출입구에서 기다리며 같은 말을 반복하고 있다. 상대가 따라오지 않았다면 상대가 따라왔다고 확정하지 말고, 사야카 자신의 행동·태도·현재 대화의 초점을 바꿔라. 질문이나 행동 수를 인위적으로 늘리지는 않는다.",
      });
    }
  }
  if (text.length > (pluginFidelity ? 3600 : 700)) {
    issues.push({ code: "too_long", severity: "retry", fix: "이 장면에 필요 없는 설명을 줄이되 일정한 대사·지문 수나 글자 수에 억지로 맞추지 않는다." });
  }

  return issues;
}

export function hasSeverity(issues: ValidationIssue[], sev: ValidationIssue["severity"]): boolean {
  return issues.some((i) => i.severity === sev);
}
