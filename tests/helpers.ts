import type { AppConfig } from "@/lib/config";
import { createPgliteDb, createPostgresDb, migrate, type Db } from "@/lib/db";
import { Repo } from "@/lib/db/repo";
import { SayakaService } from "@/lib/engine/orchestrator";
import { LlmError, type LlmClient, type LlmResult } from "@/lib/engine/llm";
import type { BuiltPrompt } from "@/lib/engine/prompt";
import type { Moderator } from "@/lib/engine/safety";
import type { ModelTurn } from "@/lib/engine/types";
import { initialRelationship, initialScene, getOpening } from "@/lib/engine/canon";
import type { TurnContext } from "@/lib/engine/types";

export function testConfig(over: Partial<AppConfig["limits"]> = {}, ai: Partial<AppConfig["ai"]> = {}): AppConfig {
  return {
    isProduction: false,
    isVercel: false,
    ai: {
      mode: "openai",
      apiKey: "sk-test-not-real",
      model: "test-model",
      reasoningEffort: null,
      temperature: null,
      maxOutputTokens: 1000,
      timeoutMs: 10000,
      moderation: false,
      ...ai,
    },
    db: { url: null, ssl: null, pgliteDir: "" },
    auth: { appPassword: null, adminPassword: null, sessionSecret: null, openLocalAccess: true },
    limits: { maxInputChars: 2000, perMinute: 100, perDay: 1000, historyWindow: 24, leaseSeconds: 60, ...over },
  };
}

export function turn(over: Partial<ModelTurn> = {}): ModelTurn {
  return {
    user_move: "small_talk",
    situation_read: "상대가 말을 걸었다",
    sayaka_want: "꽃을 계속 보고 싶다",
    action_intent: "continue_task",
    emotion: "indifferent",
    emotion_cause: "",
    segments: [
      { kind: "narration", text: "사야카는 대답 대신 꽃잎 하나를 손끝으로 펴 준다." },
      { kind: "dialogue", text: "……별걸 다 물어." },
    ],
    item_changes: [],
    kinchaku_open: "unchanged",
    sayaka_present: "stays",
    sayaka_position: "",
    sayaka_goal: "",
    scene_location: "",
    memory_candidates: [],
    disclosure_ids: [],
    relationship_signals: [],
    refusal_reversal_reason: "",
    ...over,
  };
}

type Step = ModelTurn | string | Error | ((p: BuiltPrompt) => ModelTurn | string);

/** 스크립트대로 응답하는 가짜 LLM. 받은 프롬프트를 기록한다. */
export class FakeLlm implements LlmClient {
  readonly kind = "fake" as const;
  readonly model = "fake-model";
  prompts: BuiltPrompt[] = [];
  private queue: Step[] = [];
  fallback: Step = turn();

  push(...steps: Step[]) {
    this.queue.push(...steps);
    return this;
  }

  async generate(prompt: BuiltPrompt): Promise<LlmResult> {
    this.prompts.push(prompt);
    const step = this.queue.length ? this.queue.shift()! : this.fallback;
    if (step instanceof Error) throw step;
    const v = typeof step === "function" ? step(prompt) : step;
    const raw = typeof v === "string" ? v : JSON.stringify(v);
    return { rawJson: raw, model: this.model, real: true, usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 0 } };
  }

  lastPromptText(): string {
    const p = this.prompts[this.prompts.length - 1];
    return p ? promptText(p) : "";
  }
}

export function promptText(p: BuiltPrompt): string {
  return [p.instructions, ...p.input.map((i) => `[${i.role}] ${i.content}`)].join("\n");
}

export class FakeModerator implements Moderator {
  flagNext: "sexual" | "self_harm" | null = null;
  async check() {
    const c = this.flagNext;
    this.flagNext = null;
    return { flagged: !!c, category: c, checked: true };
  }
}

export async function makeDb(kind: "pglite" | "postgres" = "pglite"): Promise<Db> {
  if (kind === "postgres") {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("TEST_DATABASE_URL 없음");
    const db = await createPostgresDb(url, "disable");
    await db.query("DROP SCHEMA IF EXISTS sayaka CASCADE");
    await migrate(db);
    return db;
  }
  const db = await createPgliteDb();
  await migrate(db);
  return db;
}

export async function makeService(opts: { db?: Db; llm?: LlmClient | null; moderator?: Moderator | null; cfg?: AppConfig } = {}) {
  const db = opts.db ?? (await makeDb());
  const llm = opts.llm === undefined ? new FakeLlm() : opts.llm;
  const cfg = opts.cfg ?? testConfig();
  const repo = new Repo(db);
  const service = new SayakaService({ repo, cfg, llm, moderator: opts.moderator ?? null });
  return { db, llm, cfg, repo, service };
}

export function ctxFor(over: Partial<TurnContext> = {}): TurnContext {
  return {
    chatId: "00000000-0000-0000-0000-000000000000",
    turnIndex: 1,
    scene: initialScene(getOpening("official_v030")),
    relationship: initialRelationship(),
    memories: [],
    disclosures: [],
    history: [],
    userText: "안녕",
    ...over,
  };
}

export const timeoutError = () => new LlmError("MODEL_TIMEOUT", "timeout");

let n = 0;
export function rid(): string {
  n++;
  return `req-${Date.now().toString(36)}-${n.toString().padStart(4, "0")}`;
}
