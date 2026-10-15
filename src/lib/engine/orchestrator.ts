import { createHash, randomUUID } from "node:crypto";
import type { AppConfig } from "../config";
import { aiStatus } from "../config";
import { Repo, toChatDto, toMessageDto, type ChatSummaryDto, type MessageDto, type MessageRow } from "../db/repo";
import { CHARACTER_VERSION, PROMPT_VERSION, getOpening, initialRelationship, initialScene, loreById } from "./canon";
import { normalizeSegments, renderBody, countQuestions, endsWithQuestion } from "./format";
import { LlmError, type LlmClient } from "./llm";
import { selectLore } from "./lore";
import { analyzePatterns } from "./patterns";
import { buildPrompt } from "./prompt";
import { parseModelTurn, ModelOutputError } from "./schema";
import { SAFETY_NOTICES, type Moderator } from "./safety";
import { applyTurn } from "./state";
import type { ModelTurn, Segment, TurnContext, ValidationIssue } from "./types";
import { validateTurn } from "./validate";

export type ServiceErrorCode =
  | "NOT_FOUND"
  | "EMPTY"
  | "TOO_LONG"
  | "BAD_REQUEST"
  | "BUSY"
  | "RATE_LIMITED"
  | "DAILY_LIMIT"
  | "AI_NOT_CONFIGURED"
  | "SAFETY_BLOCKED"
  | "VALIDATION_FAILED"
  | "MODEL_TIMEOUT"
  | "MODEL_ERROR"
  | "MODEL_REFUSED"
  | "MODEL_INCOMPLETE"
  | "MODEL_AUTH"
  | "MODEL_RATE_LIMIT"
  | "MODEL_BAD_REQUEST"
  | "MODEL_BAD_JSON"
  | "MODEL_SCHEMA_MISMATCH";

export class ServiceError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface TurnDiagnostics {
  userMove: string;
  actionIntent: string;
  emotion: string;
  situationRead: string;
  sayakaWant: string;
  emotionCause: string;
  loreIds: string[];
  loreModes: Record<string, string>;
  issues: { code: string; severity: string; detail?: string }[];
  firstAttemptIssues: { code: string; severity: string; detail?: string }[];
  corrections: string[];
  patternNotes: string[];
  questionCount: number;
  endsWithQuestion: boolean;
  disclosures: string[];
  relationship: { wariness: number; curiosity: number; annoyance: number; trust: number; stage: string };
  real: boolean;
}

export interface SendResult {
  userMessage: MessageDto;
  assistantMessage: MessageDto;
  deduped: boolean;
  diagnostics?: TurnDiagnostics;
}

export interface ServiceDeps {
  repo: Repo;
  cfg: AppConfig;
  llm: LlmClient | null;
  moderator: Moderator | null;
}

const MAX_ATTEMPTS = 2;

export class SayakaService {
  constructor(private readonly d: ServiceDeps) {}

  get repo() {
    return this.d.repo;
  }

  async createChat(ownerId: string, openingId?: string | null): Promise<{ chat: ChatSummaryDto; messages: MessageDto[] }> {
    const opening = getOpening(openingId);
    const now = new Date();
    const title = `새 대화 (${now.getMonth() + 1}월 ${now.getDate()}일)`;
    const { chat, messages } = await this.d.repo.createChat({
      ownerId,
      title,
      openingId: opening.id,
      characterVersion: CHARACTER_VERSION,
      promptVersion: PROMPT_VERSION,
      openingSegments: opening.segments,
      openingBody: renderBody(opening.segments),
      scene: initialScene(opening),
      relationship: initialRelationship(),
    });
    return { chat: toChatDto(chat), messages: messages.map(toMessageDto) };
  }

  async listChats(ownerId: string): Promise<ChatSummaryDto[]> {
    return (await this.d.repo.listChats(ownerId)).map(toChatDto);
  }

  async getChat(ownerId: string, chatId: string, admin: boolean) {
    const chat = await this.d.repo.getChat(ownerId, chatId);
    if (!chat) throw new ServiceError("NOT_FOUND", "대화방을 찾을 수 없어요.");
    const messages = await this.d.repo.getMessages(chatId);
    const base = { chat: toChatDto(chat), messages: messages.map(toMessageDto) };
    if (!admin) return base;
    const [diagnostics, state] = await Promise.all([this.d.repo.diagnosticsFor(chatId), this.d.repo.loadState(chatId)]);
    return {
      ...base,
      admin: {
        diagnostics,
        state: {
          scene: state.scene,
          relationship: state.relationship,
          memories: state.memories,
          disclosures: state.disclosures,
          characterVersion: chat.character_version,
          promptVersion: chat.prompt_version,
        },
      },
    };
  }

  async deleteChat(ownerId: string, chatId: string): Promise<void> {
    const ok = await this.d.repo.deleteChat(ownerId, chatId);
    if (!ok) throw new ServiceError("NOT_FOUND", "대화방을 찾을 수 없어요.");
  }

  async deleteAll(ownerId: string): Promise<number> {
    return this.d.repo.deleteAllChats(ownerId);
  }

  async sendMessage(params: {
    ownerId: string;
    chatId: string;
    text: unknown;
    clientRequestId: unknown;
    admin: boolean;
  }): Promise<SendResult> {
    const { ownerId, chatId, admin } = params;
    const cfg = this.d.cfg;
    if (typeof params.text !== "string") throw new ServiceError("BAD_REQUEST", "메시지 형식이 올바르지 않아요.");
    const text = params.text.replace(/\r\n/g, "\n").trim();
    if (!text) throw new ServiceError("EMPTY", "메시지를 입력해 주세요.");
    if (text.length > cfg.limits.maxInputChars) {
      throw new ServiceError("TOO_LONG", `메시지는 ${cfg.limits.maxInputChars}자까지 보낼 수 있어요.`);
    }
    const clientRequestId =
      typeof params.clientRequestId === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(params.clientRequestId)
        ? params.clientRequestId
        : null;
    if (!clientRequestId) throw new ServiceError("BAD_REQUEST", "요청 ID 가 올바르지 않아요.");

    const chat = await this.d.repo.getChat(ownerId, chatId);
    if (!chat) throw new ServiceError("NOT_FOUND", "대화방을 찾을 수 없어요.");

    // 중복 전송: 이미 처리된 요청이면 저장된 결과를 그대로 돌려준다 (모델 재호출 없음)
    const dup = await this.d.repo.findByRequestId(chatId, clientRequestId);
    if (dup && dup.reply) {
      return { userMessage: toMessageDto(dup.user), assistantMessage: toMessageDto(dup.reply), deduped: true };
    }

    const status = aiStatus(cfg);
    if (status === "not_configured" || !this.d.llm) {
      throw new ServiceError("AI_NOT_CONFIGURED", "OpenAI API 키 또는 모델이 설정되지 않아 응답을 만들 수 없어요.");
    }

    const perMin = await this.d.repo.countGenerations(ownerId, 60);
    if (perMin >= cfg.limits.perMinute) throw new ServiceError("RATE_LIMITED", "너무 빠르게 보내고 있어요. 잠시 후 다시 시도해 주세요.");
    const perDay = await this.d.repo.countGenerations(ownerId, 86400);
    if (perDay >= cfg.limits.perDay) throw new ServiceError("DAILY_LIMIT", "오늘 사용 한도에 도달했어요. 내일 다시 이용해 주세요.");

    const leased = await this.d.repo.acquireLease(ownerId, chatId, cfg.limits.leaseSeconds);
    if (!leased) throw new ServiceError("BUSY", "이전 메시지의 응답을 만드는 중이에요. 잠시 후 다시 시도해 주세요.");

    const started = Date.now();
    let attempts = 0;
    try {
      // 앱 안전 정책 (캐릭터 연기보다 우선)
      if (this.d.moderator) {
        const v = await this.d.moderator.check(text);
        if (v.flagged && v.category) {
          await this.d.repo.logGeneration({ ownerId, chatId, requestId: clientRequestId, status: "safety", errorCode: v.category, attempts: 0 });
          throw new ServiceError("SAFETY_BLOCKED", SAFETY_NOTICES[v.category], { category: v.category });
        }
      }

      const state = await this.d.repo.loadState(chatId);
      const ctx: TurnContext = {
        chatId,
        turnIndex: chat.turn_count + 1,
        scene: state.scene,
        relationship: state.relationship,
        memories: state.memories,
        disclosures: state.disclosures,
        history: state.history,
        userText: text,
      };
      const recentTexts = state.history.slice(-2).map((m) => m.body);
      const lore = selectLore({ userText: text, recentTexts, scene: ctx.scene, relationship: ctx.relationship, disclosures: ctx.disclosures });
      const patterns = analyzePatterns(ctx.history);
      const disclosedTexts = ctx.disclosures
        .map((d) => loreById(d.lore_id))
        .filter((e): e is NonNullable<typeof e> => !!e)
        .map((e) => e.fact);
      const safetyId = createHash("sha256").update(`sayaka:${ownerId}`).digest("hex").slice(0, 32);

      let correctionNotes: string[] = [];
      let firstIssues: ValidationIssue[] = [];
      let accepted: { turn: ModelTurn; segments: Segment[]; issues: ValidationIssue[] } | null = null;
      let lastBlockIssues: ValidationIssue[] = [];
      let usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
      let modelName = this.d.llm.model;
      let real = true;
      let lastSchemaError: ModelOutputError | null = null;

      while (attempts < MAX_ATTEMPTS && !accepted) {
        attempts++;
        const prompt = buildPrompt({ ctx, lore, patterns, historyWindow: cfg.limits.historyWindow, disclosedTexts, correctionNotes });
        const res = await this.d.llm.generate(prompt, { safetyId });
        modelName = res.model;
        real = res.real;
        usage = {
          inputTokens: usage.inputTokens + (res.usage.inputTokens ?? 0),
          outputTokens: usage.outputTokens + (res.usage.outputTokens ?? 0),
          cachedTokens: usage.cachedTokens + (res.usage.cachedTokens ?? 0),
        };
        let turn: ModelTurn;
        try {
          turn = parseModelTurn(res.rawJson);
        } catch (e) {
          if (e instanceof ModelOutputError) {
            lastSchemaError = e;
            correctionNotes = ["출력이 지정된 JSON 형식과 맞지 않았다. 스키마의 모든 필드를 정확히 채운다."];
            continue;
          }
          throw e;
        }
        const norm = normalizeSegments(turn.segments);
        const issues = validateTurn({ ctx, turn, segments: norm.segments, hadSpeakerLabel: norm.hadSpeakerLabel });
        if (attempts === 1) firstIssues = issues;
        const blocking = issues.filter((i) => i.severity === "block");
        const retryable = issues.filter((i) => i.severity === "retry");
        if (blocking.length === 0 && (retryable.length === 0 || attempts >= MAX_ATTEMPTS)) {
          accepted = { turn, segments: norm.segments, issues };
          break;
        }
        lastBlockIssues = blocking;
        correctionNotes = [...blocking, ...retryable].map((i) => i.fix);
      }

      if (!accepted) {
        const code = lastBlockIssues.length ? "VALIDATION_FAILED" : lastSchemaError?.code ?? "VALIDATION_FAILED";
        await this.d.repo.logGeneration({
          ownerId,
          chatId,
          requestId: clientRequestId,
          status: "blocked",
          errorCode: code,
          model: modelName,
          promptVersion: PROMPT_VERSION,
          attempts,
          latencyMs: Date.now() - started,
          inputTokens: usage.inputTokens || null,
          outputTokens: usage.outputTokens || null,
          cachedTokens: usage.cachedTokens || null,
          diagnostics: { issues: lastBlockIssues.map((i) => ({ code: i.code, detail: i.detail })) },
        });
        throw new ServiceError(
          code as ServiceErrorCode,
          "응답이 캐릭터 검수를 통과하지 못해 저장하지 않았어요. 같은 메시지를 다시 보내 보세요.",
        );
      }

      // 출력 안전 점검 (성적 내용 등). 걸리면 저장하지 않는다.
      if (this.d.moderator) {
        const v = await this.d.moderator.check(accepted.segments.map((s) => s.text).join("\n"));
        if (v.flagged && v.category === "sexual") {
          await this.d.repo.logGeneration({ ownerId, chatId, requestId: clientRequestId, status: "blocked", errorCode: "OUTPUT_SAFETY", attempts });
          throw new ServiceError("VALIDATION_FAILED", "생성된 응답이 안전 기준에 맞지 않아 저장하지 않았어요. 다른 방향으로 이어가 주세요.");
        }
      }

      const applied = applyTurn(ctx, accepted.turn, accepted.segments);
      const diagnostics: TurnDiagnostics = {
        userMove: accepted.turn.user_move,
        actionIntent: accepted.turn.action_intent,
        emotion: accepted.turn.emotion,
        situationRead: accepted.turn.situation_read,
        sayakaWant: accepted.turn.sayaka_want,
        emotionCause: accepted.turn.emotion_cause,
        loreIds: lore.map((l) => l.id),
        loreModes: Object.fromEntries(lore.map((l) => [l.id, `${l.tier}:${l.mode}`])),
        issues: accepted.issues.map((i) => ({ code: i.code, severity: i.severity, detail: i.detail })),
        firstAttemptIssues: attempts > 1 ? firstIssues.map((i) => ({ code: i.code, severity: i.severity, detail: i.detail })) : [],
        corrections: applied.corrections,
        patternNotes: patterns.notes,
        questionCount: countQuestions(accepted.segments),
        endsWithQuestion: endsWithQuestion(accepted.segments),
        disclosures: applied.newDisclosures,
        relationship: {
          wariness: applied.relationship.wariness,
          curiosity: applied.relationship.curiosity,
          annoyance: applied.relationship.annoyance,
          trust: applied.relationship.trust,
          stage: applied.relationship.stage,
        },
        real,
      };

      const titleIfFirst = chat.turn_count === 0 ? makeTitle(text) : null;
      const committed = await this.d.repo.commitTurn({
        chatId,
        turnIndex: ctx.turnIndex,
        userText: text,
        clientRequestId,
        reply: { body: renderBody(accepted.segments), segments: accepted.segments, source: real ? "model" : "stub" },
        scene: applied.scene,
        relationship: applied.relationship,
        newMemories: applied.newMemories,
        deactivateMemoryIds: applied.deactivateMemoryIds,
        newDisclosures: applied.newDisclosures,
        titleIfFirst,
        log: {
          ownerId,
          chatId,
          requestId: clientRequestId,
          status: "ok",
          model: modelName,
          promptVersion: PROMPT_VERSION,
          attempts,
          latencyMs: Date.now() - started,
          inputTokens: usage.inputTokens || null,
          outputTokens: usage.outputTokens || null,
          cachedTokens: usage.cachedTokens || null,
          diagnostics,
        },
      });
      return {
        userMessage: toMessageDto(committed.user),
        assistantMessage: toMessageDto(committed.reply),
        deduped: false,
        ...(admin ? { diagnostics } : {}),
      };
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      if (e instanceof LlmError) {
        await this.d.repo
          .logGeneration({ ownerId, chatId, requestId: clientRequestId, status: "error", errorCode: e.code, attempts, latencyMs: Date.now() - started, model: this.d.llm?.model ?? null, promptVersion: PROMPT_VERSION })
          .catch(() => undefined);
        throw new ServiceError(e.code, llmMessage(e.code));
      }
      // 같은 요청이 동시에 저장된 경우(유니크 제약) → 저장된 결과 반환
      if (isUniqueViolation(e)) {
        const again = await this.d.repo.findByRequestId(chatId, clientRequestId);
        if (again?.reply) return { userMessage: toMessageDto(again.user), assistantMessage: toMessageDto(again.reply), deduped: true };
      }
      await this.d.repo
        .logGeneration({ ownerId, chatId, requestId: clientRequestId, status: "error", errorCode: "INTERNAL", attempts, latencyMs: Date.now() - started })
        .catch(() => undefined);
      throw e;
    } finally {
      await this.d.repo.releaseLease(chatId).catch(() => undefined);
    }
  }
}

function makeTitle(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 24 ? `${one.slice(0, 24)}…` : one;
}

function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /duplicate key|unique constraint/i.test(msg) || (typeof e === "object" && e !== null && (e as { code?: string }).code === "23505");
}

export function llmMessage(code: string): string {
  switch (code) {
    case "MODEL_TIMEOUT":
      return "AI 응답이 너무 오래 걸려 중단했어요. 다시 보내 주세요.";
    case "MODEL_AUTH":
      return "OpenAI API 키 인증에 실패했어요. 서버 설정을 확인해 주세요.";
    case "MODEL_RATE_LIMIT":
      return "OpenAI 사용량 한도에 걸렸어요. 잠시 후 다시 시도하거나 결제/한도 설정을 확인해 주세요.";
    case "MODEL_REFUSED":
      return "AI 가 이 요청에 대한 응답을 거부했어요. 다른 방향으로 이어가 주세요.";
    case "MODEL_INCOMPLETE":
      return "AI 응답이 중간에 끊겼어요. 다시 보내 주세요.";
    case "MODEL_BAD_REQUEST":
      return "AI 요청 형식이 모델과 맞지 않아요. 모델 이름·설정을 확인해 주세요.";
    default:
      return "AI 응답을 만드는 중 오류가 났어요. 다시 보내 주세요.";
  }
}

export function newRequestId(): string {
  return randomUUID();
}

export type { MessageRow };
