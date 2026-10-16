import { userForcesSayakaState } from "./scene";
import type {
  AutonomousActivity, HistoryMessage, InitiativeProposal, Segment, TurnContext,
} from "./types";

export interface InitiativeCheck {
  valid: boolean;
  message: string | null;
  concrete: boolean;
}

export interface InitiativeUpdate {
  activity: AutonomousActivity | null;
  lastOutcome: string;
  progressed: boolean;
  corrections: string[];
}

const norm = (s: string) => s.toLowerCase()
  .replace(/["'“”‘’()（）.,!?？!。~…\s]/g, "")
  .replace(/(?:다시|또다시|또|잠깐|살짝|조금|그냥)/g, "")
  .slice(0, 230);

const PASSIVE = /(?:바라보|쳐다보|힐끗|시선을?\s*돌리|눈을?\s*돌리|고개를?\s*돌리|눈썹을?\s*찌푸리|미간을?\s*찌푸리|한숨|가만히|멍하니|몸을?\s*돌리)/;
const ACT = /(?:걸어|걷|걸음(?:을)?\s*옮기|발(?:을)?\s*옮기|걸음을?\s*떼|나서|나가|나왔|나오|다가가|달려|뛰어|들어가|들어오|건너|도착|문을?\s*(?:열|밀|닫)|손을?\s*(?:뻗|내밀)|꺼내|꺼냈|주웠|주워|집어|들어\s*올|끌어|밀어|옮기|치우|정리|챙기|가방을?\s*(?:메|들)|기다리다\s*말|빵을?\s*고르|고르|진열대를?\s*살펴|확인|계산|샀|결제|건네|내려놓|내려\s*놓|꺼내\s*보|쥐었|잡아|찾아|찾았|적어|쓰|펼쳐|포장지를?\s*뜯|물(?:을)?\s*갈|물어\s*보)/;
const INITIATIVE_SPEECH = /[?？]|(?:내가\s*(?:할|갈|가볼|찾아|해볼)|해볼래|갈래|가자|난\s*(?:갈|할)|알아볼게|해볼게|이리\s*와|따라오|잠깐만|먼저\s*갈|그거\s*봐|안\s*해|그만둘래)/;
const DONE = /(?:도착|다\s*했|끝냈|끝났|마쳤|마친|찾았|해냈|챙겼|가져왔|들어왔|건넸|꺼냈|알았어|이제\s*알겠|됐다|완성|찾았다|물(?:을)?\s*갈았|정리했|성공했|샀(?:다|고|어|음)?|사\s*왔|구매했|결제했|계산(?:을)?\s*(?:마친|끝낸|했|완료)|다\s*골랐)/;
const CANCEL = /(?:안\s*해|못\s*하겠|싫어|됐어|그만|접겠|안\s*가|관두|포기|마음\s*바뀌|그거\s*말고|됐거든)/;

function matchingSegment(proposal: InitiativeProposal, segments: Segment[]): Segment | undefined {
  const e = norm(proposal.evidence);
  if (e.length < 3) return undefined;
  const exact = segments.find((s) => norm(s.text).includes(e));
  if (exact) return exact;
  // Some generated evidence paraphrases one visible action. Permit a narrow
  // overlap when the same actor and concrete action nouns appear; never
  // fabricate an event solely because the model wrote an internal summary.
  const nouns = (str: string) => (str.match(/[가-힣A-Za-z]{2,}/g) ?? [])
    .map((w) => w.replace(/(?:에서|으로|에게|이를|들을|을|를|이|가|은|는|에|도|과|와|다|고|며|로)$/, ""))
    .filter((w) => w.length >= 2 && !["사야카", "소녀", "그녀", "그곳", "상대", "이번", "다시"].includes(w));
  const evidenceWords = new Set(nouns(proposal.evidence));
  if (evidenceWords.size < 3) return undefined;
  return segments.find((part) => {
    if (part.kind !== "narration" && part.kind !== "dialogue") return false;
    const words = new Set(nouns(part.text));
    const shared = [...evidenceWords].filter((x) => words.has(x)).length;
    return shared >= 3 && shared / evidenceWords.size >= 0.7;
  });
}

function hasIndependentStep(seg: Segment, evidence: string): boolean {
  const text = evidence.trim();
  if (seg.kind === "narration" && /^(?:상대|당신|사용자|나츠키|모브)(?:는|가|이|의)\s/.test(text)) return false;
  if (seg.kind === "dialogue") return INITIATIVE_SPEECH.test(text);
  if (ACT.test(text)) return true;
  if (PASSIVE.test(text)) return false;
  return /(?:손|발|책|공책|휴대폰|마이쮸|사탕|매점|문|계단|가방|시계).{0,30}(?:누르|툭|넘기|거르|바꾸|가리키|던지|두드리|보여)/.test(text);
}

function sameBeat(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  if (na.length > 12 && nb.length > 12 && (na.includes(nb) || nb.includes(na))) return true;
  const tokens = (s: string) => new Set((s.match(/[가-힣A-Za-z]{2,}/g) ?? [])
    .filter((x) => !["사야카", "상대", "그녀", "잠깐", "다시", "조금", "그러고", "바로"].includes(x)));
  const ta = tokens(a), tb = tokens(b);
  const both = [...ta].filter((t) => tb.has(t)).length;
  return Math.min(ta.size, tb.size) >= 3 && both / Math.min(ta.size, tb.size) >= 0.8;
}

/** Validate a claimed autonomous step against a visible act by Sayaka. */
export function checkInitiative(
  ctx: Pick<TurnContext, "userText" | "scene" | "history">,
  proposal: InitiativeProposal | undefined,
  segments: Segment[],
): InitiativeCheck {
  const p = proposal ?? { mode: "none", objective: "", next_step: "", evidence: "" };
  const current = ctx.scene.sayaka.activity ?? null;
  if (p.mode === "none") return { valid: true, message: null, concrete: false };
  if (p.mode === "wait") {
    return current
      ? { valid: true, message: null, concrete: false }
      : { valid: false, message: "진행 중인 자율 목표가 없는데 기다림 상태를 선택했다. 일상적인 침묵이면 none으로 둔다.", concrete: false };
  }
  if (["advance", "complete", "abandon"].includes(p.mode) && !current) {
    return { valid: false, message: "진행 중인 자율 목표가 없다. 새로운 행동이면 start/moment를 사용한다.", concrete: false };
  }
  if ((p.mode === "start" || p.mode === "moment") && !p.objective.trim()) {
    return { valid: false, message: "스스로 선택한 구체적인 목표 또는 단발성 행동을 objective에 적는다.", concrete: false };
  }
  if ((p.mode === "start" || p.mode === "advance") && !p.next_step.trim()) {
    return { valid: false, message: "다음 행동을 막연히 기다리지 말고 사야카 자신이 실행할 수 있는 다음 단계를 적는다.", concrete: false };
  }
  const segment = matchingSegment(p, segments);
  if (!segment) return { valid: false, message: "자율 행동의 evidence는 이번 사용자에게 실제 보이는 대사·지문에서 그대로 인용한다.", concrete: false };
  if (userForcesSayakaState(ctx.userText)
    && /(?:사랑|좋아하게|고백|호감도|친밀도|신뢰도)/.test(p.objective + " " + p.evidence)) {
    return { valid: false, message: "상대가 강제한 사야카의 호감·고백은 자율 행동이나 목표로 확정하지 않는다.", concrete: false };
  }
  if (segment.kind === "narration"
    && /^(?:상대|당신|사용자|나츠키|모브)(?:는|가|이|의)\s/.test(p.evidence)) {
    return { valid: false, message: "사용자 캐릭터의 행동을 사야카가 실행한 행동으로 기록하지 않는다.", concrete: false };
  }
  if (["complete", "abandon"].includes(p.mode)) {
    const ending = p.mode === "complete" ? DONE : CANCEL;
    if (!ending.test(p.evidence)) {
      return { valid: false, message: p.mode === "complete"
        ? "완료라고만 기록하지 말고 사야카가 목표를 실제로 끝냈다는 묘사·대사를 보여준다."
        : "포기라고만 기록하지 말고 사야카가 마음을 바꾸거나 그만두는 모습을 보여준다.", concrete: false };
    }
    return { valid: true, message: null, concrete: true };
  }
  const concrete = hasIndependentStep(segment, p.evidence);
  if (!concrete) {
    return { valid: false, message: "눈길·고개 돌리기·한숨만으로 목표를 진행했다고 기록하지 않는다. 실제 새 행동을 하거나 none/wait를 선택한다.", concrete: false };
  }
  if (current && (p.mode === "advance" || (p.mode === "start" && norm(current.objective) === norm(p.objective)))) {
    if (sameBeat(current.last_step, p.evidence)) {
      return { valid: false, message: "지난번과 같은 행동을 다른 말로 반복했다. 실제로 다음 단계로 움직이거나 기다림/포기를 선택한다.", concrete: false };
    }
    const recent = ctx.history.filter((m) => m.role === "assistant" && m.source === "model").slice(-3);
    if (recent.some((m) => sameBeat(m.body, p.evidence))) {
      return { valid: false, message: "최근에 이미 했던 행동을 다시 진행한 것으로 기록하려 한다. 상황을 실제로 바꾸거나 진행을 멈춘다.", concrete: false };
    }
  }
  return { valid: true, message: null, concrete };
}

export function applyInitiative(
  ctx: Pick<TurnContext, "scene" | "history" | "userText" | "turnIndex">,
  proposal: InitiativeProposal | undefined,
  segments: Segment[],
): InitiativeUpdate {
  const prior = ctx.scene.sayaka.activity ?? null;
  const p = proposal ?? { mode: "none", objective: "", next_step: "", evidence: "" };
  const check = checkInitiative(ctx, p, segments);
  const result: InitiativeUpdate = {
    activity: prior ? structuredClone(prior) : null,
    lastOutcome: ctx.scene.sayaka.last_activity_outcome ?? "",
    progressed: false,
    corrections: [],
  };
  const markIdle = () => {
    if (result.activity) result.activity.idle_turns = Math.min(12, result.activity.idle_turns + 1);
  };
  if (!check.valid) {
    result.corrections.push("자율 행동 상태 불일치: " + check.message);
    markIdle();
    return result;
  }
  if (p.mode === "none") { markIdle(); return result; }
  if (p.mode === "wait") {
    if (result.activity) {
      result.activity.phase = "waiting";
      result.activity.next_step = p.next_step.trim().slice(0, 120) || result.activity.next_step;
      result.activity.idle_turns = Math.min(12, result.activity.idle_turns + 1);
    }
    return result;
  }
  const objective = p.objective.trim().slice(0, 120) || prior?.objective || "";
  if (p.mode === "start") {
    if (prior && norm(prior.objective) !== norm(objective)) {
      result.lastOutcome = ("이전 계획을 바꿈: " + prior.objective).slice(0, 150);
    }
    result.activity = {
      objective, phase: "acting", next_step: p.next_step.trim().slice(0, 120),
      last_step: p.evidence.trim().slice(0, 180),
      last_progress_turn: ctx.turnIndex, idle_turns: 0,
    };
    result.progressed = true;
    return result;
  }
  if (p.mode === "advance" && result.activity) {
    result.activity.phase = "acting";
    result.activity.last_step = p.evidence.trim().slice(0, 180);
    result.activity.next_step = p.next_step.trim().slice(0, 120);
    result.activity.last_progress_turn = ctx.turnIndex;
    result.activity.idle_turns = 0;
    result.progressed = true;
    return result;
  }
  if (p.mode === "moment") {
    result.lastOutcome = ("스스로 한 일: " + objective + " — " + p.evidence.trim()).slice(0, 200);
    markIdle();
    result.progressed = true;
    return result;
  }
  if (p.mode === "complete" || p.mode === "abandon") {
    result.lastOutcome = ((p.mode === "complete" ? "마침" : "그만둠") + ": "
      + (prior?.objective ?? objective) + " — " + p.evidence.trim()).slice(0, 200);
    result.activity = null;
    result.progressed = true;
  }
  return result;
}

/** A hint for resolving a self-chosen activity, not a per-turn event quota. */
export function initiativeNotes(activity: AutonomousActivity | null | undefined): string[] {
  if (!activity || activity.idle_turns < 2) return [];
  if (activity.phase === "waiting") return [
    "사야카가 이전에 선택한 일을 기다리는 상태로 두고 있다. 상대가 아직 움직였다고 확정하지 말 것. 계속 기다리는 게 자신의 선택인지, 혼자 진행하거나 목표를 접을지 판단한다. 매번 새로운 사건을 만들 의무는 없다.",
  ];
  return [
    "사야카가 스스로 고른 일이 최근 몇 턴 동안 진행되지 않았다. 같은 준비 동작과 재촉을 반복하지 말 것. 실제로 다음 단계를 시도하거나 잠시 중단·포기할 수 있다. 조용히 쉬는 것이 자연스러우면 그대로 있어도 된다.",
  ];
}
