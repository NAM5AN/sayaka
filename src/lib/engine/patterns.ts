import { allText, endsWithQuestion } from "./format";
import type { HistoryMessage } from "./types";

/** 최근 사야카 응답의 반복 패턴을 진단해, 다음 생성에 '다시 판단하라'는 짧은 메모를 만든다. 강제 비율은 두지 않는다. */
export interface PatternReport {
  questionStreak: number;
  mychewRecent: number;
  repeatedGestures: string[];
  nameAskRecent: number;
  ellipsisStarts: number;
  notes: string[];
}

const GESTURES: { word: string; re: RegExp }[] = [
  { word: "미간/눈썹 찌푸리기", re: /찌푸|미간/ },
  { word: "노려보기/흘겨보기", re: /노려|흘겨|째려/ },
  { word: "팔짱", re: /팔짱/ },
  { word: "한숨", re: /한숨/ },
  { word: "혀 차기", re: /혀를?\s?차|쯧/ },
  { word: "고개 갸웃", re: /갸웃/ },
];

export function analyzePatterns(history: HistoryMessage[], promptVersion?: string): PatternReport {
  const sayaka = history.filter((m) => m.role === "assistant").slice(-4);
  let questionStreak = 0;
  for (let i = sayaka.length - 1; i >= 0; i--) {
    if (endsWithQuestion(sayaka[i].segments)) questionStreak++;
    else break;
  }
  const last3 = sayaka.slice(-3);
  const texts = last3.map((m) => (m.segments ? allText(m.segments) : m.body));
  const mychewRecent = texts.filter((t) => /마이쮸/.test(t)).length;
  const repeatedGestures = GESTURES.filter((g) => texts.filter((t) => g.re.test(t)).length >= 2).map((g) => g.word);
  const nameAskRecent = last3.filter((m) => {
    const d = (m.segments ?? []).filter((s) => s.kind === "dialogue").map((s) => s.text).join(" ");
    return /이름/.test(d) && /[?？]/.test(d);
  }).length;
  const ellipsisStarts = last3.filter((m) => {
    const d = (m.segments ?? []).filter((s) => s.kind === "dialogue");
    return d.length > 0 && d.every((s) => /^(……|\.\.\.|…)/.test(s.text));
  }).length;

  const notes: string[] = [];
  const pluginFidelity = promptVersion?.includes("plugin-v0.2.0-fidelity") ?? false;
  if (pluginFidelity) {
    const staleFlowers = texts.filter((t) => /꽃병|꽃잎|꽃 쪽|꽃으로/.test(t) && /시선|돌린|살펴보|바라/.test(t)).length;
    if (staleFlowers >= 2) notes.push("최근 꽃병이나 꽃으로 시선을 돌리는 행동이 반복됐다. 지금도 그 행동이 필요할까? 상대의 말·자기 행동에 따라 장면을 선택하되 꽃 자체를 금지하지 않는다.");
    const atExit = texts.filter((t) => /출입구|교문|정문/.test(t) || /공원 (?:갈|가자|간다며|갈 거|갈거)/.test(t)).length;
    if (atExit >= 2) notes.push("최근에도 학교 출입구나 공원으로 가자고 반복했다. 아직 상대가 따라갔다는 사실은 없지만, 사야카 자신의 다음 행동을 실제로 진행하거나 마음을 바꾸거나 대화를 다르게 이어갈 수 있다. 동일한 재촉을 매번 반복하지 말라.");
    if (questionStreak >= 3) notes.push("최근 질문이 많았다. 이번에도 궁금한 게 있다면 물어봐도 좋다. 다만 무의미한 끝 질문을 자동으로 추가하지 않는다.");
    if (mychewRecent >= 2) notes.push("최근 마이쮸에 지나치게 의존했다. 다른 행동이나 관심을 고려하되 마이쮸 자체를 금지하지 않는다.");
  }
  if (!pluginFidelity && questionStreak >= 2) {
    notes.push(
      `최근 ${questionStreak}턴 연속으로 사야카의 응답이 질문으로 끝났다. 이번 턴에 질문이 정말 필요한지 다시 판단하라. 행동·침묵·짧은 대꾸·자기 일 계속하기로도 충분하다.`,
    );
  }
  if (!pluginFidelity && mychewRecent >= 1) notes.push("마이쮸가 최근 응답에 이미 나왔다. 이번에는 장면에 있는 다른 것(꽃, 자기 행동, 시선, 침묵 등)을 쓴다.");
  if (repeatedGestures.length) notes.push(`최근 지문에서 반복된 동작: ${repeatedGestures.join(", ")}. 이번에는 다른 몸짓이나 행동을 고른다.`);
  if (nameAskRecent >= 2) notes.push("상대 이름을 이미 여러 번 물었다. 계속 캐묻지 말고, 모르는 채로 두거나 관심을 접을 수 있다.");
  if (ellipsisStarts >= 2) notes.push("최근 대사가 계속 '……'로 시작했다. 말줄임표 대신 어휘와 태도로 무뚝뚝함을 보여라.");
  return { questionStreak, mychewRecent, repeatedGestures, nameAskRecent, ellipsisStarts, notes };
}
