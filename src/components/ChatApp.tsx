"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Crest } from "./Crest";
import { ConfigViewer, PasswordDialog, VIEWER_BUTTONS, type ViewerKind } from "./AdminPanels";

type Role = "player" | "admin";
interface Segment {
  kind: "dialogue" | "narration";
  text: string;
}
interface Message {
  id: string;
  role: "user" | "assistant";
  source: "user" | "opening" | "model" | "stub";
  body: string;
  segments: Segment[] | null;
  createdAt: string;
  pending?: boolean;
  fresh?: boolean;
}
interface ChatSummary {
  id: string;
  title: string;
  openingId: string;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
}
interface AdminData {
  diagnostics: Record<string, Record<string, unknown>>;
  state: {
    scene: Record<string, unknown>;
    relationship: Record<string, unknown>;
    memories: { kind: string; target: string; text: string; turn_index: number; active: boolean }[];
    disclosures: { lore_id: string; turn_index: number }[];
    characterVersion: string;
    promptVersion: string;
  };
}
interface ChatView {
  chat: ChatSummary;
  messages: Message[];
  admin?: AdminData;
}
interface Status {
  role: Role;
  auth: string;
  ai: { status: "openai" | "stub" | "not_configured"; model: string | null; moderation: boolean };
  db: { kind: string };
  limits: { maxInputChars: number; perMinute: number; perDay: number };
  openings: { id: string; label: string; description: string }[];
  passwords: { player: string; admin: string } | null;
}
interface ApiErr {
  code: string;
  message: string;
  retryable: boolean;
}

class HttpError extends Error {
  constructor(
    public status: number,
    public body: ApiErr,
  ) {
    super(body.message);
  }
}

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new HttpError(0, { code: "NETWORK", message: "서버에 연결하지 못했어요. 네트워크 상태를 확인하고 다시 보내 주세요.", retryable: true });
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 401) {
      window.location.reload();
    }
    throw new HttpError(r.status, data?.error ?? { code: "SERVER_ERROR", message: "알 수 없는 오류가 났어요.", retryable: true });
  }
  return data as T;
}

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

const safeStorage = {
  get(k: string): string | null {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null || v === "") window.localStorage.removeItem(k);
      else window.localStorage.setItem(k, v);
    } catch {
      /* 저장 불가 환경: 무시 */
    }
  },
};

/** 서버의 제목 규칙과 같게: 첫 메시지 앞 24자 */
function titleFrom(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 24 ? `${one.slice(0, 24)}…` : one;
}

function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "방금";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 사용자 입력 안의 (행동) 부분을 옅게 */
function UserText({ text }: { text: string }) {
  const parts = text.split(/([(（][^()（）]*[)）])/g);
  return (
    <>
      {parts.map((p, i) =>
        /^[(（].*[)）]$/.test(p) ? (
          <span key={i} className="act">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function ChatApp({ role, openLocal }: { role: Role; openLocal: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<ChatView | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<(ApiErr & { retryId?: string; retryText?: string; kind: "error" | "info" | "safety" }) | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stateOpen, setStateOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<ChatSummary | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [diagOpen, setDiagOpen] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerKind | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  // Esc 는 맨 위에 열린 창부터 닫는다
  const layers = useRef({ viewer: false, pw: false });
  layers.current = { viewer: viewer !== null, pw: pwOpen };

  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const forceScroll = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const isAdmin = role === "admin";

  // ── 초기 로드 ──
  useEffect(() => {
    api<Status>("/api/status")
      .then(setStatus)
      .catch(() => setStatus(null));
    api<{ chats: ChatSummary[] }>("/api/chats")
      .then((r) => {
        setChats(r.chats);
        const last = safeStorage.get("sayaka:lastChat");
        const pick = r.chats.find((c) => c.id === last) ?? r.chats[0];
        if (pick) setActiveId(pick.id);
      })
      .catch((e: HttpError) => {
        setChats([]);
        setError({ ...e.body, kind: "error" });
      });
  }, []);

  // ── 대화방 열기 ──
  const loadChat = useCallback(async (id: string) => {
    setLoadingChat(true);
    try {
      const v = await api<ChatView>(`/api/chats/${id}`);
      setView(v);
      forceScroll.current = true;
      safeStorage.set("sayaka:lastChat", id);
    } catch (e) {
      const err = e as HttpError;
      if (err.status === 404) {
        setChats((cs) => cs?.filter((c) => c.id !== id) ?? null);
        setActiveId(null);
        setView(null);
      } else setError({ ...err.body, kind: "error" });
    } finally {
      setLoadingChat(false);
    }
  }, []);

  useEffect(() => {
    if (!activeId) {
      setView(null);
      return;
    }
    setError(null);
    setDraft(safeStorage.get(`sayaka:draft:${activeId}`) ?? "");
    void loadChat(activeId);
  }, [activeId, loadChat]);

  useEffect(() => {
    if (activeId) safeStorage.set(`sayaka:draft:${activeId}`, draft);
  }, [draft, activeId]);

  // ── 스크롤: 아래쪽을 보고 있을 때만 따라 내려간다 ──
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (forceScroll.current || nearBottom.current) {
      el.scrollTop = el.scrollHeight;
      forceScroll.current = false;
    }
  }, [view?.messages.length, sending]);

  // ── 입력창 높이 ──
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [draft]);

  // ── Esc 로 닫기 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (layers.current.viewer) return setViewer(null);
      if (layers.current.pw) return setPwOpen(false);
      setNewOpen(false);
      setSettingsOpen(false);
      setStateOpen(false);
      setConfirmDel(null);
      setConfirmAll(false);
      setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function createChat(openingId: string) {
    setNewOpen(false);
    setDrawer(false);
    try {
      const r = await api<ChatView>("/api/chats", { method: "POST", body: { openingId } });
      setChats((cs) => [r.chat, ...(cs ?? [])]);
      setView(r);
      setActiveId(r.chat.id);
      forceScroll.current = true;
      setTimeout(() => taRef.current?.focus(), 50);
    } catch (e) {
      setError({ ...(e as HttpError).body, kind: "error" });
    }
  }

  async function deleteChat(c: ChatSummary) {
    setConfirmDel(null);
    try {
      await api(`/api/chats/${c.id}`, { method: "DELETE" });
      setChats((cs) => cs?.filter((x) => x.id !== c.id) ?? null);
      safeStorage.set(`sayaka:draft:${c.id}`, null);
      if (activeId === c.id) {
        setActiveId(null);
        setView(null);
      }
    } catch (e) {
      setError({ ...(e as HttpError).body, kind: "error" });
    }
  }

  async function deleteAll() {
    setConfirmAll(false);
    setSettingsOpen(false);
    try {
      await api("/api/chats", { method: "DELETE", body: { confirm: "DELETE_ALL" } });
      setChats([]);
      setActiveId(null);
      setView(null);
    } catch (e) {
      setError({ ...(e as HttpError).body, kind: "error" });
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.reload();
  }

  async function send(retry?: { id: string; text: string }) {
    if (sending || !view) return;
    const text = (retry?.text ?? draft).trim();
    if (!text) return;
    const max = status?.limits.maxInputChars ?? 2000;
    if (text.length > max) {
      setError({ code: "TOO_LONG", message: `메시지는 ${max}자까지 보낼 수 있어요.`, retryable: false, kind: "error" });
      return;
    }
    const requestId = retry?.id ?? uuid();
    const chatId = view.chat.id;
    const temp: Message = { id: `pending-${requestId}`, role: "user", source: "user", body: text, segments: null, createdAt: new Date().toISOString(), pending: true };
    setError(null);
    setSending(true);
    setDraft("");
    forceScroll.current = true;
    setView((v) => (v && v.chat.id === chatId ? { ...v, messages: [...v.messages, temp] } : v));
    try {
      const r = await api<{ userMessage: Message; assistantMessage: Message; deduped: boolean; diagnostics?: Record<string, unknown> }>(
        `/api/chats/${chatId}/messages`,
        { method: "POST", body: { text, clientRequestId: requestId } },
      );
      setView((v) => {
        if (!v || v.chat.id !== chatId) return v;
        const msgs = v.messages.filter((m) => m.id !== temp.id && m.id !== r.userMessage.id && m.id !== r.assistantMessage.id);
        const admin = v.admin && r.diagnostics ? { ...v.admin, diagnostics: { ...v.admin.diagnostics, [r.assistantMessage.id]: r.diagnostics } } : v.admin;
        const title = v.chat.turnCount === 0 && !r.deduped ? titleFrom(text) : v.chat.title;
        const chat = { ...v.chat, title, turnCount: v.chat.turnCount + (r.deduped ? 0 : 1) };
        return { ...v, chat, admin, messages: [...msgs, r.userMessage, { ...r.assistantMessage, fresh: true }] };
      });
      setChats((cs) => {
        if (!cs) return cs;
        const cur = cs.find((c) => c.id === chatId);
        if (!cur) return cs;
        const title = cur.turnCount === 0 && !r.deduped ? titleFrom(text) : cur.title;
        const updated = { ...cur, title, turnCount: cur.turnCount + (r.deduped ? 0 : 1), updatedAt: new Date().toISOString() };
        return [updated, ...cs.filter((c) => c.id !== chatId)];
      });
      if (isAdmin && stateOpen) void loadChat(chatId);
    } catch (e) {
      const err = (e as HttpError).body;
      setView((v) => (v && v.chat.id === chatId ? { ...v, messages: v.messages.filter((m) => m.id !== temp.id) } : v));
      setDraft((d) => (d ? d : text));
      const kind = err.code === "SAFETY_BLOCKED" ? "safety" : err.code === "AI_NOT_CONFIGURED" ? "info" : "error";
      setError({ ...err, kind, retryId: err.retryable ? requestId : undefined, retryText: err.retryable ? text : undefined });
    } finally {
      setSending(false);
      setTimeout(() => taRef.current?.focus(), 0);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 한글 IME 조합 중 Enter 는 전송하지 않는다
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      if (error?.retryId && error.retryText === draft.trim()) void send({ id: error.retryId, text: error.retryText });
      else void send();
    }
  }

  async function copy(m: Message) {
    try {
      await navigator.clipboard.writeText(m.body);
      setCopied(m.id);
      setTimeout(() => setCopied((c) => (c === m.id ? null : c)), 1400);
    } catch {
      /* 클립보드 권한 없음 */
    }
  }

  const aiState = status?.ai.status;
  const conn = useMemo(() => {
    if (!status) return { cls: "", text: "연결 상태 확인 중" };
    if (aiState === "openai") return { cls: "ok", text: `GPT 연결됨 (${status.ai.model})` };
    if (aiState === "stub") return { cls: "warn", text: "테스트 스텁 모드 (실제 AI 아님)" };
    return { cls: "bad", text: "API 키 미설정: 응답 생성 불가" };
  }, [status, aiState]);

  const max = status?.limits.maxInputChars ?? 2000;
  const scene = view?.admin?.state.scene as { time_label?: string; location?: string } | undefined;

  return (
    <div className="app">
      <div className={`drawer-scrim ${drawer ? "open" : ""}`} onClick={() => setDrawer(false)} aria-hidden="true" />
      <aside className={`side ${drawer ? "open" : ""}`} aria-label="대화 목록">
        <div className="brand">
          <Crest size={30} />
          <div>
            <h1 className="brand-name">카네코 사야카</h1>
            <p className="brand-sub">金子 沙也加</p>
          </div>
        </div>
        <button
          className="side-new"
          onClick={() => {
            setDrawer(false);
            setNewOpen(true);
          }}
        >
          + 새 대화
        </button>
        {chats && chats.length === 0 && <p className="side-empty">아직 대화가 없어요.</p>}
        <ul className="chat-list">
          {(chats ?? []).map((c) => (
            <li key={c.id} className={`chat-item ${c.id === activeId ? "active" : ""}`}>
              <button
                className="chat-open"
                onClick={() => {
                  setActiveId(c.id);
                  setDrawer(false);
                }}
                aria-current={c.id === activeId ? "true" : undefined}
              >
                <span className="chat-title">{c.title}</span>
                <span className="chat-meta">
                  {relTime(c.updatedAt)}, {c.turnCount}턴
                </span>
              </button>
              <button
                className="chat-del"
                onClick={() => {
                  setDrawer(false);
                  setConfirmDel(c);
                }} aria-label={`${c.title} 삭제`} title="삭제">
                <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V4h6v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
        <div className="side-foot">
          <div className="conn" role="status">
            <span className={`dot ${conn.cls}`} />
            <span>{conn.text}</span>
          </div>
          {openLocal && <div className="conn">로컬 개발 모드 (비밀번호 없음)</div>}
          <button
            className="side-link"
            onClick={() => {
              setDrawer(false);
              setSettingsOpen(true);
            }}
          >
            설정과 데이터
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setDrawer(true)} aria-label="대화 목록 열기">
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <div className="topbar-title">
            <h2>{view ? view.chat.title : "사야카와의 대화"}</h2>
            <div className="scene-line">{scene?.location ? `${scene.time_label}, ${scene.location}` : "방과 후, 학교 복도"}</div>
          </div>
          {isAdmin && view && (
            <button className="ghost-btn" onClick={() => setStateOpen(true)}>
              상태
            </button>
          )}
        </header>

        <div className="scroll" ref={scrollRef} onScroll={onScroll}>
          {!activeId && chats !== null && (
            <div className="empty">
              <span className="crest-big">
                <Crest size={44} />
              </span>
              <h2>아직 마주치지 않았어요</h2>
              <p>새 대화를 시작하면 방과 후 복도에서 사야카와 처음 만나요. 대화방마다 관계와 기억은 따로예요.</p>
              <button className="primary" onClick={() => setNewOpen(true)}>
                새 대화 시작
              </button>
            </div>
          )}
          {activeId && !view && loadingChat && <p className="page typing">불러오는 중…</p>}
          {view && (
            <div className="page" aria-live="polite">
              {view.messages.map((m) =>
                m.role === "assistant" ? (
                  <article key={m.id} className={`turn-sayaka ${m.fresh ? "fresh" : ""}`}>
                    <span className="crest-mark">
                      <Crest size={18} />
                    </span>
                    {m.source === "opening" && <p className="turn-label">시작 장면</p>}
                    {m.source === "stub" && <span className="badge-stub">테스트 스텁 (실제 AI 응답 아님)</span>}
                    {(m.segments ?? [{ kind: "narration", text: m.body } as Segment]).map((s, i) => (
                      <p key={i} className={`seg seg-${s.kind}`}>
                        {s.kind === "narration" ? `(${s.text})` : `"${s.text}"`}
                      </p>
                    ))}
                    {m.source !== "opening" && (
                      <div className="turn-tools">
                        <button className="tool-btn" onClick={() => copy(m)}>
                          {copied === m.id ? "복사됨" : "복사"}
                        </button>
                        {isAdmin && view.admin?.diagnostics[m.id] && (
                          <button
                            className="tool-btn"
                            aria-expanded={diagOpen.has(m.id)}
                            onClick={() =>
                              setDiagOpen((s) => {
                                const n = new Set(s);
                                if (n.has(m.id)) n.delete(m.id);
                                else n.add(m.id);
                                return n;
                              })
                            }
                          >
                            진단
                          </button>
                        )}
                      </div>
                    )}
                    {isAdmin && diagOpen.has(m.id) && view.admin?.diagnostics[m.id] && <Diag d={view.admin.diagnostics[m.id]} />}
                  </article>
                ) : (
                  <div key={m.id} className="turn-user">
                    <div className={`note ${m.pending ? "pending" : ""}`}>
                      <UserText text={m.body} />
                    </div>
                  </div>
                ),
              )}
              {sending && (
                <p className="typing" role="status">
                  응답을 만드는 중<span>…</span>
                </p>
              )}
            </div>
          )}
        </div>

        {view && (
          <div className="composer">
            <div className="composer-inner">
              {error && (
                <div className={`banner ${error.kind}`} role="alert">
                  <p>{error.message}</p>
                  {error.retryId && error.retryText && (
                    <button onClick={() => send({ id: error.retryId!, text: error.retryText! })} disabled={sending}>
                      다시 보내기
                    </button>
                  )}
                  <button onClick={() => setError(null)} aria-label="알림 닫기">
                    닫기
                  </button>
                </div>
              )}
              {!error && aiState === "not_configured" && (
                <div className="banner info">
                  <p>OPENAI_API_KEY 와 OPENAI_MODEL 이 설정되지 않아 사야카의 응답을 만들 수 없어요. 화면과 대화방 관리는 그대로 쓸 수 있어요.</p>
                </div>
              )}
              <div className="compose-row">
                <label htmlFor="composer" className="sr-only">
                  사야카에게 보낼 말이나 행동
                </label>
                <textarea
                  id="composer"
                  ref={taRef}
                  rows={1}
                  value={draft}
                  placeholder="대사나 (행동)을 적어 주세요"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={sending}
                  maxLength={max + 200}
                />
                <button
                  className="primary"
                  onClick={() => (error?.retryId && error.retryText === draft.trim() ? send({ id: error.retryId, text: error.retryText }) : send())}
                  disabled={sending || !draft.trim() || draft.trim().length > max}
                >
                  {sending ? "보내는 중" : "보내기"}
                </button>
              </div>
              <div className="compose-hint">
                <span>Enter 보내기, Shift+Enter 줄바꿈</span>
                <span className={draft.length > max ? "over" : ""}>{draft.length > max * 0.8 ? `${draft.length}/${max}` : ""}</span>
              </div>
            </div>
          </div>
        )}
      </main>

      {newOpen && (
        <div className="overlay" onClick={() => setNewOpen(false)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="new-title">새 대화</h3>
            <p>사야카와 초면에서 시작해요. 다른 대화방의 기억은 이어지지 않아요.</p>
            {(status?.openings ?? [{ id: "official_v030", label: "공식 시작문", description: "" }]).map((o, i) => (
              <button key={o.id} className="choice" onClick={() => createChat(o.id)} autoFocus={i === 0}>
                <strong>{o.label}</strong>
                <span>{o.description}</span>
              </button>
            ))}
            <div className="dialog-actions">
              <button className="ghost-btn" onClick={() => setNewOpen(false)}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="overlay" onClick={() => setConfirmDel(null)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="del-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="del-title">이 대화를 삭제할까요?</h3>
            <p>「{confirmDel.title}」의 메시지, 기억, 관계 기록이 모두 지워지고 되돌릴 수 없어요.</p>
            <div className="dialog-actions">
              <button className="ghost-btn" onClick={() => setConfirmDel(null)} autoFocus>
                취소
              </button>
              <button className="danger" onClick={() => deleteChat(confirmDel)}>
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="overlay" onClick={() => setSettingsOpen(false)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="set-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="set-title">설정과 데이터</h3>
            <dl className="kv">
              <dt>AI 연결</dt>
              <dd>{conn.text}</dd>
              <dt>안전 점검</dt>
              <dd>{status?.ai.moderation ? "켜짐 (OpenAI Moderation)" : "꺼짐"}</dd>
              <dt>저장소</dt>
              <dd>{status?.db.kind === "postgres" ? "Postgres 데이터베이스" : status?.db.kind === "pglite" ? "로컬 내장 DB (개발용)" : "확인 중"}</dd>
              <dt>권한</dt>
              <dd>{role === "admin" ? "관리자 (진단 보기 가능)" : "일반"}</dd>
              <dt>사용 한도</dt>
              <dd>{status ? `분당 ${status.limits.perMinute}회, 하루 ${status.limits.perDay}회` : ""}</dd>
            </dl>

            <h4 className="set-h">캐릭터와 지침</h4>
            {isAdmin ? (
              <div className="btn-grid">
                {VIEWER_BUTTONS.map((b) => (
                  <button key={b.kind} className="tile-btn" onClick={() => setViewer(b.kind)}>
                    <strong>{b.label}</strong>
                    <span>{b.hint}</span>
                  </button>
                ))}
                {view && (
                  <button className="tile-btn" onClick={() => setViewer("preview")}>
                    <strong>현재 상태 블록</strong>
                    <span>이 대화방에서 다음에 보낼 내용</span>
                  </button>
                )}
              </div>
            ) : (
              <p className="fineprint">관리자 비밀번호로 로그인하면 볼 수 있어요.</p>
            )}

            {isAdmin && !openLocal && (
              <>
                <h4 className="set-h">비밀번호</h4>
                <div className="set-row">
                  <span className="fineprint">접속 비밀번호와 관리자 비밀번호를 바꿀 수 있어요.</span>
                  <button className="ghost-btn" onClick={() => setPwOpen(true)}>
                    비밀번호 바꾸기
                  </button>
                </div>
              </>
            )}

            <h4 className="set-h">데이터</h4>
            <p className="fineprint">
              대화 내용은 이 사이트의 데이터베이스에 저장돼요. 응답을 만들 때는 최근 대화와 현재 상태만 OpenAI API 로 보내고, 응답 저장 옵션(store)은 끈 채로 요청해요. OpenAI 자체의 보관 정책은 별도로 적용돼요. 대화방을 삭제하면 메시지, 기억, 관계 기록이 바로 지워지고 사용량 계산용 숫자만 남아요.
            </p>
            <div className="dialog-actions">
              <button className="ghost-btn" onClick={logout} disabled={openLocal}>
                로그아웃
              </button>
              <button className="danger" onClick={() => setConfirmAll(true)} disabled={!chats?.length}>
                모든 대화 삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmAll && (
        <div className="overlay" onClick={() => setConfirmAll(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="all-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="all-title">모든 대화를 삭제할까요?</h3>
            <p>대화 {chats?.length ?? 0}개와 각 방의 기억, 관계 기록이 모두 지워지고 되돌릴 수 없어요.</p>
            <div className="dialog-actions">
              <button className="ghost-btn" onClick={() => setConfirmAll(false)} autoFocus>
                취소
              </button>
              <button className="danger" onClick={deleteAll}>
                모두 삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {stateOpen && isAdmin && view?.admin && <StateSheet admin={view.admin} onClose={() => setStateOpen(false)} />}

      {viewer && isAdmin && <ConfigViewer kind={viewer} chatId={view?.chat.id} onClose={() => setViewer(null)} />}

      {pwOpen && isAdmin && (
        <PasswordDialog
          sources={status?.passwords ?? null}
          onClose={() => setPwOpen(false)}
          onChanged={() => {
            api<Status>("/api/status")
              .then(setStatus)
              .catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}

const DIAG_LABELS: [string, string][] = [
  ["userMove", "입력 성격"],
  ["actionIntent", "행동 선택"],
  ["emotion", "감정"],
  ["emotionCause", "감정 원인"],
  ["sayakaWant", "사야카의 목적"],
  ["situationRead", "상황 판단"],
  ["loreIds", "보낸 설정"],
  ["issues", "검수"],
  ["firstAttemptIssues", "1차 반려"],
  ["corrections", "상태 보정"],
  ["patternNotes", "패턴 메모"],
  ["questionCount", "물음표 수"],
  ["disclosures", "새 공개"],
  ["relationship", "관계"],
  ["attempts", "생성 횟수"],
  ["latencyMs", "지연(ms)"],
  ["inputTokens", "입력 토큰"],
  ["outputTokens", "출력 토큰"],
  ["cachedTokens", "캐시 토큰"],
  ["model", "모델"],
];

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "없음";
  if (Array.isArray(v)) {
    if (!v.length) return "없음";
    return v.map((x) => (typeof x === "object" ? Object.values(x as object).filter(Boolean).join(":") : String(x))).join(", ");
  }
  if (typeof v === "object") return Object.entries(v as object).map(([k, x]) => `${k} ${x}`).join(", ");
  return String(v);
}

function Diag({ d }: { d: Record<string, unknown> }) {
  return (
    <dl className="diag">
      {DIAG_LABELS.filter(([k]) => k in d).map(([k, label]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{label}</dt>
          <dd>{fmt(d[k])}</dd>
        </div>
      ))}
    </dl>
  );
}

function StateSheet({ admin, onClose }: { admin: AdminData; onClose: () => void }) {
  const s = admin.state;
  return (
    <>
      <div className="overlay" style={{ background: "#120f1566" }} onClick={onClose} />
      <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="state-title">
        <div className="sheet-head">
          <h3 id="state-title">대화방 상태 (관리자)</h3>
          <button className="ghost-btn" onClick={onClose} autoFocus>
            닫기
          </button>
        </div>
        <div className="sheet-body">
          <p className="fineprint">캐릭터 {s.characterVersion}, 프롬프트 {s.promptVersion}</p>
          <h4>관계</h4>
          <pre>{JSON.stringify(s.relationship, null, 2)}</pre>
          <h4>장면</h4>
          <pre>{JSON.stringify(s.scene, null, 2)}</pre>
          <h4>기억 ({s.memories.length})</h4>
          {s.memories.length ? (
            <ul>
              {s.memories.map((m, i) => (
                <li key={i} style={{ opacity: m.active ? 1 : 0.5 }}>
                  [{m.kind}
                  {m.target ? `/${m.target}` : ""}] {m.turn_index}턴: {m.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="fineprint">아직 없음</p>
          )}
          <h4>공개한 사적 정보</h4>
          {s.disclosures.length ? (
            <ul>
              {s.disclosures.map((d) => (
                <li key={d.lore_id}>
                  {d.lore_id} ({d.turn_index}턴)
                </li>
              ))}
            </ul>
          ) : (
            <p className="fineprint">없음</p>
          )}
        </div>
      </aside>
    </>
  );
}
