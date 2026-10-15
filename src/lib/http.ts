import { ServiceError, type ServiceErrorCode } from "./engine/orchestrator";
import { DbConfigError } from "./db";

export type ApiErrorCode = ServiceErrorCode | "UNAUTHORIZED" | "FORBIDDEN" | "FORBIDDEN_ORIGIN" | "SERVER_ERROR" | "DB_NOT_CONFIGURED" | "AUTH_NOT_CONFIGURED" | "BAD_JSON";

const STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  EMPTY: 400,
  TOO_LONG: 400,
  BAD_REQUEST: 400,
  BAD_JSON: 400,
  BUSY: 409,
  RATE_LIMITED: 429,
  DAILY_LIMIT: 429,
  AI_NOT_CONFIGURED: 503,
  DB_NOT_CONFIGURED: 503,
  AUTH_NOT_CONFIGURED: 503,
  SAFETY_BLOCKED: 422,
  VALIDATION_FAILED: 502,
  MODEL_TIMEOUT: 504,
  MODEL_ERROR: 502,
  MODEL_REFUSED: 502,
  MODEL_INCOMPLETE: 502,
  MODEL_AUTH: 502,
  MODEL_RATE_LIMIT: 503,
  MODEL_BAD_REQUEST: 502,
  MODEL_BAD_JSON: 502,
  MODEL_SCHEMA_MISMATCH: 502,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  FORBIDDEN_ORIGIN: 403,
  SERVER_ERROR: 500,
};

/** 재시도해도 되는 오류인지 (클라이언트가 같은 요청 ID 로 재전송) */
const RETRYABLE = new Set([
  "BUSY",
  "RATE_LIMITED",
  "VALIDATION_FAILED",
  "MODEL_TIMEOUT",
  "MODEL_ERROR",
  "MODEL_INCOMPLETE",
  "MODEL_RATE_LIMIT",
  "MODEL_BAD_JSON",
  "MODEL_SCHEMA_MISMATCH",
  "SERVER_ERROR",
]);

export function json(data: unknown, init?: ResponseInit & { headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function apiError(code: ApiErrorCode, message: string, extra?: Record<string, unknown>): Response {
  return json({ error: { code, message, retryable: RETRYABLE.has(code), ...(extra ?? {}) } }, { status: STATUS[code] ?? 500 });
}

export function errorToResponse(e: unknown): Response {
  if (e instanceof ServiceError) return apiError(e.code, e.message, e.extra);
  if (e instanceof DbConfigError) return apiError("DB_NOT_CONFIGURED", e.message);
  // 내부 오류 상세(스택·SQL·키)는 응답에 싣지 않는다
  console.error("[sayaka] unexpected error:", e instanceof Error ? `${e.name}: ${e.message}` : "unknown");
  return apiError("SERVER_ERROR", "서버 오류가 났어요. 잠시 후 다시 시도해 주세요.");
}

/** 쿠키 기반 변경 요청의 CSRF 방어: Origin(또는 Referer)이 같은 호스트인지 확인 */
export function sameOrigin(req: Request): boolean {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) return req.headers.get("sec-fetch-site") === "same-origin";
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function readJson(req: Request, maxBytes = 32_000): Promise<Record<string, unknown> | null> {
  const textBody = await req.text();
  if (textBody.length > maxBytes) return null;
  if (!textBody) return {};
  try {
    const v = JSON.parse(textBody);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
