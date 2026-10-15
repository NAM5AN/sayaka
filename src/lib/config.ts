/**
 * 서버 전용 환경변수 해석. 이 파일은 클라이언트 컴포넌트에서 import 하지 않는다.
 * 비밀값(OPENAI_API_KEY, 비밀번호, SESSION_SECRET)은 여기서만 읽고 응답·로그로 내보내지 않는다.
 */

export type AiMode = "openai" | "stub";
export type DbSslMode = "verify" | "no-verify" | "disable";

export interface AppConfig {
  isProduction: boolean;
  isVercel: boolean;
  ai: {
    mode: AiMode;
    apiKey: string | null;
    model: string | null;
    reasoningEffort: string | null;
    temperature: number | null;
    maxOutputTokens: number;
    timeoutMs: number;
    moderation: boolean;
  };
  db: {
    url: string | null;
    ssl: DbSslMode | null;
    pgliteDir: string;
  };
  auth: {
    appPassword: string | null;
    adminPassword: string | null;
    sessionSecret: string | null;
    /** 비밀번호 없이 열어 두는 로컬 개발 모드 (production 에서는 절대 켜지지 않음) */
    openLocalAccess: boolean;
  };
  limits: {
    maxInputChars: number;
    perMinute: number;
    perDay: number;
    historyWindow: number;
    leaseSeconds: number;
  };
}

function str(name: string): string | null {
  const v = process.env[name];
  if (v === undefined) return null;
  const t = v.trim();
  return t.length ? t : null;
}

function int(name: string, fallback: number, min: number, max: number): number {
  const v = str(name);
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function num(name: string): number | null {
  const v = str(name);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

export function loadConfig(): AppConfig {
  const isProduction = process.env.NODE_ENV === "production";
  const isVercel = !!process.env.VERCEL;
  const mode: AiMode = str("AI_MODE") === "stub" ? "stub" : "openai";
  const effort = str("OPENAI_REASONING_EFFORT");
  const sslRaw = str("DATABASE_SSL");
  const ssl: DbSslMode | null =
    sslRaw === "verify" || sslRaw === "no-verify" || sslRaw === "disable" ? sslRaw : null;
  const appPassword = str("APP_PASSWORD");

  return {
    isProduction,
    isVercel,
    ai: {
      mode,
      apiKey: str("OPENAI_API_KEY"),
      model: str("OPENAI_MODEL"),
      reasoningEffort: effort && REASONING_EFFORTS.has(effort) ? effort : null,
      temperature: num("OPENAI_TEMPERATURE"),
      maxOutputTokens: int("OPENAI_MAX_OUTPUT_TOKENS", 2500, 300, 16000),
      timeoutMs: int("OPENAI_TIMEOUT_MS", 45000, 5000, 120000),
      moderation: str("OPENAI_MODERATION") !== "off",
    },
    db: {
      url: str("DATABASE_URL"),
      ssl,
      pgliteDir: str("PGLITE_DIR") ?? ".data/pglite",
    },
    auth: {
      appPassword,
      adminPassword: str("ADMIN_PASSWORD"),
      sessionSecret: str("SESSION_SECRET"),
      openLocalAccess: !isProduction && !appPassword,
    },
    limits: {
      maxInputChars: int("MAX_INPUT_CHARS", 2000, 100, 8000),
      perMinute: int("RATE_LIMIT_PER_MINUTE", 12, 1, 600),
      perDay: int("DAILY_GENERATION_LIMIT", 300, 1, 100000),
      historyWindow: int("HISTORY_WINDOW", 24, 4, 80),
      leaseSeconds: int("CHAT_LEASE_SECONDS", 120, 30, 600),
    },
  };
}

/** AI 호출이 실제로 가능한 상태인지 (stub 모드는 실제 AI 가 아님) */
export function aiStatus(cfg: AppConfig): "openai" | "stub" | "not_configured" {
  if (cfg.ai.mode === "stub") return "stub";
  if (cfg.ai.apiKey && cfg.ai.model) return "openai";
  return "not_configured";
}

/** 인증이 운영 가능한 상태인지 */
export function authStatus(cfg: AppConfig): "password" | "open_local" | "not_configured" {
  if (cfg.auth.openLocalAccess) return "open_local";
  if (cfg.auth.appPassword && cfg.auth.sessionSecret && cfg.auth.sessionSecret.length >= 32) return "password";
  return "not_configured";
}
