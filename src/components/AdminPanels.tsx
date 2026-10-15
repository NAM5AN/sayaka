"use client";

import { useEffect, useState } from "react";

/** 관리자용: 캐릭터·지침·설정 등급표·첫 장면·출력 형식·상태 블록 보기, 비밀번호 변경 */

export type ViewerKind = "character" | "instructions" | "lore" | "openings" | "schema" | "preview";

interface LoreEntry {
  id: string;
  canon_status: string;
  visibility_tier: "A" | "B" | "C" | "D";
  tags: string[];
  fact: string;
  behavioral_projection: string;
  runtime: { send: string; projection?: string; redacted?: string; min_trust?: number };
  source?: string;
}
interface ConfigData {
  versions: { character: string; prompt: string; lore: string };
  instructions: string;
  canon: Record<string, unknown>;
  lore: LoreEntry[];
  leakGuards: Record<string, string[]>;
  openings: { id: string; label: string; description: string; segments: { kind: string; text: string }[] }[];
  schema: unknown;
}
interface PreviewData {
  stateBlock: string;
  historyCount: number;
  historyTotal: number;
  lore: { id: string; tier: string; mode: string }[];
  patternNotes: string[];
  model: string | null;
}

let configCache: ConfigData | null = null;

const TITLES: Record<ViewerKind, string> = {
  character: "캐릭터 정보",
  instructions: "고정 지침",
  lore: "설정 등급표",
  openings: "첫 장면",
  schema: "출력 형식",
  preview: "이 대화방의 현재 상태 블록",
};

export const VIEWER_BUTTONS: { kind: ViewerKind; label: string; hint: string }[] = [
  { kind: "character", label: "캐릭터 정보", hint: "공식 캐논 데이터" },
  { kind: "instructions", label: "고정 지침", hint: "매 턴 보내는 행동 지침" },
  { kind: "lore", label: "설정 등급표", hint: "정보별로 GPT 에 보내는 방식" },
  { kind: "openings", label: "첫 장면", hint: "새 대화 시작문" },
  { kind: "schema", label: "출력 형식", hint: "GPT 가 돌려주는 내부 구조" },
];

export function ConfigViewer({ kind, chatId, onClose }: { kind: ViewerKind; chatId?: string; onClose: () => void }) {
  const [data, setData] = useState<ConfigData | null>(configCache);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        if (kind === "preview") {
          if (!chatId) return;
          const r = await fetch(`/api/admin/chats/${chatId}/prompt`, { cache: "no-store" });
          const b = await r.json();
          if (!r.ok) throw new Error(b?.error?.message ?? "불러오지 못했어요.");
          if (alive) setPreview(b);
        } else if (!configCache) {
          const r = await fetch("/api/admin/config", { cache: "no-store" });
          const b = await r.json();
          if (!r.ok) throw new Error(b?.error?.message ?? "불러오지 못했어요.");
          configCache = b;
          if (alive) setData(b);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "불러오지 못했어요.");
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [kind, chatId]);

  const sub =
    kind === "preview"
      ? "다음 턴에 GPT 로 보낼 서버 기록이에요. 사용자 입력 전 기준이라, 입력 주제에 따라 참고 정보는 달라져요."
      : data
        ? subtitle(kind, data)
        : "";

  return (
    <div className="overlay" style={{ zIndex: 70 }} onClick={onClose}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="viewer-title" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-head">
          <div>
            <h3 id="viewer-title">{TITLES[kind]}</h3>
            {sub && <p className="viewer-sub">{sub}</p>}
          </div>
          <button className="ghost-btn" onClick={onClose} autoFocus>
            닫기
          </button>
        </div>
        <div className="viewer-body">
          {error && <p className="banner error">{error}</p>}
          {!error && kind !== "preview" && !data && <p className="fineprint">불러오는 중…</p>}
          {!error && kind === "preview" && !preview && <p className="fineprint">불러오는 중…</p>}
          {data && kind === "character" && <ValueView value={data.canon} top />}
          {data && kind === "instructions" && <TextBlock text={data.instructions} />}
          {data && kind === "lore" && <LoreView lore={data.lore} guards={data.leakGuards} />}
          {data && kind === "openings" && <OpeningsView openings={data.openings} />}
          {data && kind === "schema" && <pre className="viewer-pre">{JSON.stringify(data.schema, null, 2)}</pre>}
          {preview && kind === "preview" && <PreviewView p={preview} />}
        </div>
      </div>
    </div>
  );
}

function subtitle(kind: ViewerKind, d: ConfigData): string {
  switch (kind) {
    case "character":
      return `data/character_canon.json, 캐논 버전 ${d.versions.character}. 여기 있는 정보가 그대로 GPT 에 가지는 않아요. 무엇을 보내는지는 설정 등급표에서 볼 수 있어요.`;
    case "instructions":
      return `매 턴 GPT 에 똑같이 보내는 행동 지침이에요(프롬프트 버전 ${d.versions.prompt}). 사적인 비밀이나 제작자용 라벨은 들어 있지 않아요.`;
    case "lore":
      return `data/lore_registry.json (${d.versions.lore}). 대화 주제와 관계에 맞는 항목만 골라 보내요.`;
    case "openings":
      return "새 대화를 만들 때 고를 수 있는 시작 장면이에요.";
    case "schema":
      return "GPT 가 돌려줘야 하는 내부 JSON 구조예요. 화면에는 대사와 지문만 보여요.";
    default:
      return "";
  }
}

// ───────── 캐릭터 정보 ─────────

const KEY_LABELS: Record<string, string> = {
  character_id: "캐릭터 ID",
  name: "이름",
  ko: "한국어",
  kanji: "한자",
  hiragana: "히라가나",
  canonical_version: "캐논 버전",
  present_time_scope: "현재 시점",
  age: "나이",
  gender: "성별",
  pronoun_japanese: "1인칭",
  visual: "외형",
  tagline: "캐치프레이즈",
  baseline: "기본 성격",
  traits: "특성",
  default_emotion: "기본 감정",
  likes: "좋아하는 것",
  dislikes: "싫어하는 것",
  family: "가족",
  home: "집",
  school: "학교",
  friends: "친구",
  items: "소지품",
  future: "성장 후 (현재 시점에는 미사용)",
  not_yet_canon: "미확정 항목",
  behavioral_constitution: "행동 원칙",
};

function label(k: string): string {
  return KEY_LABELS[k] ?? k.replace(/_/g, " ");
}

function ValueView({ value, top }: { value: unknown; top?: boolean }) {
  if (value === null || value === undefined) return <span className="v-muted">미정</span>;
  if (typeof value === "boolean") return <span>{value ? "예" : "아니오"}</span>;
  if (typeof value === "number") return <span>{value.toLocaleString("ko-KR")}</span>;
  if (typeof value === "string") return <span>{value}</span>;
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== "object" || v === null)) {
      return (
        <ul className="v-list">
          {value.map((v, i) => (
            <li key={i}>
              <ValueView value={v} />
            </li>
          ))}
        </ul>
      );
    }
    return (
      <div className="v-cards">
        {value.map((v, i) => (
          <div key={i} className="v-card">
            <ValueView value={v} />
          </div>
        ))}
      </div>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (top) {
    return (
      <div className="v-sections">
        {entries.map(([k, v]) => (
          <section key={k} className="v-section">
            <h4>{label(k)}</h4>
            <ValueView value={v} />
          </section>
        ))}
      </div>
    );
  }
  return (
    <dl className="v-dl">
      {entries.map(([k, v]) => (
        <div key={k} className="v-row">
          <dt>{label(k)}</dt>
          <dd>
            <ValueView value={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ───────── 고정 지침 · 상태 블록 ─────────

function TextBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="v-text">
      {lines.map((l, i) => {
        if (l.startsWith("# ")) return <h4 key={i}>{l.slice(2)}</h4>;
        if (!l.trim()) return null;
        return (
          <p key={i} className={/^\s*(?:-|\d+\.)\s/.test(l) ? "v-item" : undefined}>
            {l}
          </p>
        );
      })}
    </div>
  );
}

function PreviewView({ p }: { p: PreviewData }) {
  return (
    <>
      <dl className="kv">
        <dt>모델</dt>
        <dd>{p.model ?? "미설정"}</dd>
        <dt>원문으로 보내는 대화</dt>
        <dd>
          최근 {p.historyCount}개 (이 방 전체 {p.historyTotal}개)
        </dd>
        <dt>지금 고른 참고 정보</dt>
        <dd>{p.lore.map((l) => `${l.id}(${l.tier})`).join(", ") || "없음"}</dd>
      </dl>
      <TextBlock text={p.stateBlock} />
    </>
  );
}

// ───────── 설정 등급표 ─────────

const TIER_INFO: Record<string, { name: string; rule: string }> = {
  A: { name: "A. 관찰 가능", rule: "관련 주제가 나오면 사실과 행동 지침을 보내요." },
  B: { name: "B. 사야카만 아는 사적인 정보", rule: "신뢰가 기준 이상이면 사실을 보내고(말할지는 사야카가 선택), 아니면 비밀 단어가 없는 가린 문장만 보내요." },
  C: { name: "C. 제작자용 메타·미래", rule: "라벨은 보내지 않아요. 행동으로 바꾼 문장만 보내거나 아예 빼요." },
  D: { name: "D. 사야카도 모르거나 미정", rule: "상대가 직접 물었을 때만 '모른다·미정' 지침을 보내요." },
};

const STATUS_KO: Record<string, string> = {
  approved: "확정",
  approved_worldbuilding_estimate: "확정(창작 추정치)",
  undecided: "미정",
  suggestion: "추천안",
};

function sendKo(e: LoreEntry): string {
  switch (e.runtime.send) {
    case "fact_and_projection":
      return "사실과 행동 지침";
    case "projection_only":
      return "행동 지침만";
    case "gated_fact":
      return `신뢰 ${e.runtime.min_trust ?? 5} 이상이면 사실`;
    case "never":
      return "보내지 않음";
    default:
      return e.runtime.send;
  }
}

function LoreView({ lore, guards }: { lore: LoreEntry[]; guards: Record<string, string[]> }) {
  return (
    <>
      {(["A", "B", "C", "D"] as const).map((tier) => {
        const items = lore.filter((e) => e.visibility_tier === tier);
        return (
          <section key={tier} className="v-section">
            <h4>{TIER_INFO[tier].name}</h4>
            <p className="fineprint" style={{ margin: "0 0 8px" }}>
              {TIER_INFO[tier].rule}
            </p>
            {items.map((e) => (
              <details key={e.id} className="lore-item">
                <summary>
                  <span className="lore-id">{e.id}</span>
                  <span className={`tag tag-${e.canon_status}`}>{STATUS_KO[e.canon_status] ?? e.canon_status}</span>
                  <span className="lore-send">{sendKo(e)}</span>
                </summary>
                <dl className="v-dl">
                  <div className="v-row">
                    <dt>제작자용 원문</dt>
                    <dd>{e.fact}</dd>
                  </div>
                  {e.runtime.send !== "never" && (
                    <div className="v-row">
                      <dt>GPT 에 보내는 문장</dt>
                      <dd>
                        {e.runtime.send === "fact_and_projection"
                          ? `${e.fact} — ${e.runtime.projection ?? e.behavioral_projection}`
                          : e.runtime.projection ?? e.behavioral_projection}
                      </dd>
                    </div>
                  )}
                  {e.runtime.redacted && (
                    <div className="v-row">
                      <dt>신뢰 미달일 때</dt>
                      <dd>{e.runtime.redacted}</dd>
                    </div>
                  )}
                  <div className="v-row">
                    <dt>주제 태그</dt>
                    <dd>{e.tags.join(", ")}</dd>
                  </div>
                  {e.source && (
                    <div className="v-row">
                      <dt>근거</dt>
                      <dd>{e.source}</dd>
                    </div>
                  )}
                </dl>
              </details>
            ))}
          </section>
        );
      })}
      <section className="v-section">
        <h4>출력 검수 금지어</h4>
        <p className="fineprint" style={{ margin: "0 0 8px" }}>
          사야카의 응답에 이 단어가 나오면 저장하기 전에 걸러서 다시 생성해요(이미 털어놓은 정보·상대가 먼저 꺼낸 메타 단어는 예외).
        </p>
        <dl className="v-dl">
          <div className="v-row">
            <dt>집안 비밀</dt>
            <dd>{guards.family_secret_terms?.join(", ")}</dd>
          </div>
          <div className="v-row">
            <dt>모르는 수치</dt>
            <dd>{guards.unknown_figure_terms?.join(", ")}</dd>
          </div>
          <div className="v-row">
            <dt>제작자·시스템 용어</dt>
            <dd>{guards.meta_terms?.join(", ")}</dd>
          </div>
          <div className="v-row">
            <dt>미래 설정</dt>
            <dd>{guards.future_terms?.join(", ")}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}

function OpeningsView({ openings }: { openings: ConfigData["openings"] }) {
  return (
    <>
      {openings.map((o) => (
        <section key={o.id} className="v-section">
          <h4>{o.label}</h4>
          <p className="fineprint" style={{ margin: "0 0 10px" }}>
            {o.description}
          </p>
          <div className="opening-sample">
            {o.segments.map((s, i) => (
              <p key={i} className={`seg seg-${s.kind}`}>
                {s.kind === "narration" ? `(${s.text})` : `"${s.text}"`}
              </p>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

// ───────── 비밀번호 변경 ─────────

export function PasswordDialog({
  sources,
  onClose,
  onChanged,
}: {
  sources: { player: string; admin: string } | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const single = sources?.admin === "none";
  const [target, setTarget] = useState<"player" | "admin">("player");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.trim().length < 8;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || mismatch || tooShort || !current || !next) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, currentPassword: current, newPassword: next }),
      });
      const b = await r.json().catch(() => null);
      if (!r.ok) {
        setError(b?.error?.message ?? "비밀번호를 바꾸지 못했어요.");
        return;
      }
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
      onChanged();
    } catch {
      setError("서버에 연결하지 못했어요. 네트워크를 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  const srcKo = (s: string | undefined) => (s === "site" ? "사이트에서 바꾼 비밀번호" : s === "env" ? "환경변수 비밀번호" : "없음");

  return (
    <div className="overlay" style={{ zIndex: 70 }} onClick={onClose}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="pw-title" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3 id="pw-title">비밀번호 바꾸기</h3>
        {done ? (
          <>
            <p>비밀번호를 바꿨어요. 이 기기는 로그인이 유지되고, 다른 기기에서는 새 비밀번호로 다시 로그인해야 해요.</p>
            <div className="dialog-actions">
              <button type="button" className="primary" onClick={onClose} autoFocus>
                확인
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              지금 접속 비밀번호는 {srcKo(sources?.player)}, 관리자 비밀번호는 {srcKo(sources?.admin)}를 쓰고 있어요.
            </p>
            <fieldset className="pw-target">
              <legend className="sr-only">바꿀 비밀번호</legend>
              <label>
                <input type="radio" name="target" checked={target === "player"} onChange={() => setTarget("player")} /> 접속 비밀번호
              </label>
              <label>
                <input type="radio" name="target" checked={target === "admin"} onChange={() => setTarget("admin")} /> 관리자 비밀번호
              </label>
            </fieldset>
            {single && (
              <p className="fineprint">
                {target === "player"
                  ? "지금은 관리자 비밀번호가 따로 없어서, 접속 비밀번호로 들어오면 관리자예요."
                  : "관리자 비밀번호를 만들면 접속 비밀번호로는 진단·설정 보기·비밀번호 변경을 할 수 없어요."}
              </p>
            )}
            <label className="field">
              <span>지금 로그인한 비밀번호</span>
              <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
            </label>
            <label className="field">
              <span>새 비밀번호 (8자 이상)</span>
              <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={tooShort} />
            </label>
            <label className="field">
              <span>새 비밀번호 확인</span>
              <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} />
            </label>
            {(mismatch || tooShort || error) && (
              <p className="field-err" role="alert">
                {error ?? (tooShort ? "새 비밀번호는 8자 이상이어야 해요." : "새 비밀번호가 서로 달라요.")}
              </p>
            )}
            <p className="fineprint">바꾸면 다른 기기의 로그인은 모두 끊겨요.</p>
            <div className="dialog-actions">
              <button type="button" className="ghost-btn" onClick={onClose}>
                취소
              </button>
              <button type="submit" className="primary" disabled={busy || !current || !next || !confirm || mismatch || tooShort}>
                {busy ? "바꾸는 중…" : "비밀번호 바꾸기"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
