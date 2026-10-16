import type { Segment } from "./types";

const SPEAKER_LABEL = /^\s*(?:사야카|카네코\s*사야카|카네코|Sayaka|金子\s*沙也加|沙也加)\s*[:：]\s*/i;
const OPEN_QUOTES = ['"', "“", "「", "『", "'", "‘"];
const CLOSE_QUOTES = ['"', "”", "」", "』", "'", "’"];

function stripWrapping(text: string, opens: string[], closes: string[]): string {
  let t = text.trim();
  let changed = true;
  while (changed && t.length >= 2) {
    changed = false;
    const first = t[0];
    const last = t[t.length - 1];
    const oi = opens.indexOf(first);
    if (oi >= 0 && closes.includes(last)) {
      t = t.slice(1, -1).trim();
      changed = true;
    }
  }
  return t;
}

/**
 * 한 덩어리 텍스트를 대사/지문으로 쪼갠다.
 * 괄호 ( ) / （ ） 안은 지문, 나머지는 대사. 모델이 dialogue 안에 지문을 섞어 낸 경우를 바로잡는다.
 */
function splitMixed(text: string, defaultKind: Segment["kind"]): Segment[] {
  const out: Segment[] = [];
  const re = /[(（]([^()（）]*)[)）]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = re.exec(text))) {
    found = true;
    const before = text.slice(last, m.index).trim();
    if (before) out.push({ kind: defaultKind === "narration" ? "narration" : "dialogue", text: before });
    const inner = m[1].trim();
    if (inner) out.push({ kind: "narration", text: inner });
    last = m.index + m[0].length;
  }
  const rest = text.slice(last).trim();
  if (rest) out.push({ kind: found && defaultKind === "narration" ? "narration" : defaultKind, text: rest });
  return out;
}

/**
 * Some roleplay models put audible speech inside a narration field:
 * "사야카는 등을 돌린다. \"나 간다.\" 문쪽으로 걸어간다."
 * Extract the spoken beat as dialogue, preserving surrounding physical action.
 * Object labels without a sentence (e.g. "마이쮸") are still narration.
 */
function splitNarrationSpeech(text: string): Segment[] {
  const out: Segment[] = [];
  const speech = /["“「]([^"”」\n]+)["”」]/g;
  let cursor = 0;
  let found = false;
  let m: RegExpExecArray | null;
  while ((m = speech.exec(text))) {
    const phrase = m[1].trim();
    const isUtterance = /[.!?。？！…]$/.test(phrase)
      || /(?:해|했어|하자|가자|간다|갈게|됐어|싫어|뭐야|왜|응|아니)(?:[.。!?？！…]*)$/.test(phrase);
    if (!isUtterance) continue;
    found = true;
    const before = text.slice(cursor, m.index).trim();
    if (before) out.push({ kind: "narration", text: before });
    out.push({ kind: "dialogue", text: phrase });
    cursor = m.index + m[0].length;
  }
  if (!found) return [{ kind: "narration", text }];
  const after = text.slice(cursor).trim();
  if (after) out.push({ kind: "narration", text: after });
  return out;
}

export interface NormalizeResult {
  segments: Segment[];
  hadSpeakerLabel: boolean;
}

export function normalizeSegments(raw: Segment[]): NormalizeResult {
  let hadSpeakerLabel = false;
  const out: Segment[] = [];
  for (const seg of raw) {
    if (!seg || typeof seg.text !== "string") continue;
    let text = seg.text.replace(/\r/g, "").trim();
    if (!text) continue;
    if (SPEAKER_LABEL.test(text)) {
      hadSpeakerLabel = true;
      text = text.replace(SPEAKER_LABEL, "");
    }
    const kind: Segment["kind"] = seg.kind === "narration" ? "narration" : "dialogue";
    const parts = kind === "narration" ? splitNarrationSpeech(stripWrapping(text, ["(", "（"], [")", "）"])) : splitMixed(text, kind);
    for (const p of parts) {
      let t = p.text.trim();
      if (p.kind === "dialogue") {
        if (SPEAKER_LABEL.test(t)) {
          hadSpeakerLabel = true;
          t = t.replace(SPEAKER_LABEL, "");
        }
        t = stripWrapping(t, OPEN_QUOTES, CLOSE_QUOTES);
      } else {
        t = stripWrapping(t, ["(", "（"], [")", "）"]);
      }
      t = t.replace(/\n{3,}/g, "\n\n").trim();
      if (t) out.push({ kind: p.kind, text: t });
    }
  }
  // 같은 종류가 연속되면 합친다 (지문+지문)
  const merged: Segment[] = [];
  for (const s of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === "narration" && s.kind === "narration") prev.text = `${prev.text} ${s.text}`;
    else merged.push({ ...s });
  }
  return { segments: merged, hadSpeakerLabel };
}

/** 저장·히스토리·복사용 본문: 지문은 (소괄호), 대사는 "큰따옴표" */
export function renderBody(segments: Segment[]): string {
  return segments.map((s) => (s.kind === "narration" ? `(${s.text})` : `"${s.text}"`)).join("\n\n");
}

export function dialogueText(segments: Segment[]): string {
  return segments
    .filter((s) => s.kind === "dialogue")
    .map((s) => s.text)
    .join(" ");
}

export function allText(segments: Segment[]): string {
  return segments.map((s) => s.text).join(" ");
}

/** 응답이 질문으로 끝나는지 (마지막 대사 기준) */
export function endsWithQuestion(segments: Segment[] | null | undefined): boolean {
  if (!segments) return false;
  const dialogues = segments.filter((s) => s.kind === "dialogue");
  const last = dialogues[dialogues.length - 1];
  return !!last && /[?？]\s*$/.test(last.text);
}

export function countQuestions(segments: Segment[]): number {
  return (dialogueText(segments).match(/[?？]/g) ?? []).length;
}
