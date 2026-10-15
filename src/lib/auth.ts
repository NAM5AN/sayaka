import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "./config";
import { authStatus } from "./config";

/**
 * 간단한 비밀번호 세션.
 *  - player: 대화 이용
 *  - admin : 대화 이용 + 내부 진단(행동 선택·선별된 설정 id·검수 결과·상태) 열람
 * 관리자 권한은 오직 ADMIN_PASSWORD 로그인으로만 얻는다. 채팅 본문의 'OOC:' 등은 권한과 무관하다.
 * 대화방 소유자(owner_id)는 단일 사용자 운영을 전제로 'owner' 하나로 둔다 (다중 사용자 확장 시 계정 id 로 교체).
 */

export type Role = "player" | "admin";
export interface Session {
  role: Role;
  ownerId: string;
  exp: number;
}

export const SESSION_COOKIE = "sayaka_session";
export const OWNER_ID = "owner";
const MAX_AGE_SEC = 60 * 60 * 24 * 30;

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(role: Role, secret: string, now = Date.now()): string {
  const s: Session = { role, ownerId: OWNER_ID, exp: Math.floor(now / 1000) + MAX_AGE_SEC };
  const payload = b64url(JSON.stringify(s));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | null | undefined, secret: string, now = Date.now()): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (s.role !== "player" && s.role !== "admin") return null;
    if (typeof s.exp !== "number" || s.exp * 1000 < now) return null;
    if (s.ownerId !== OWNER_ID) return null;
    return s;
  } catch {
    return null;
  }
}

export function passwordMatches(input: string, expected: string): boolean {
  const a = createHmac("sha256", "cmp").update(input).digest();
  const b = createHmac("sha256", "cmp").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

/** 요청에서 세션을 구한다. 로컬 개발 무인증 모드에서는 admin 세션을 돌려준다. */
export function sessionFromCookieValue(cfg: AppConfig, token: string | null): Session | null {
  const mode = authStatus(cfg);
  if (mode === "open_local") return { role: "admin", ownerId: OWNER_ID, exp: Number.MAX_SAFE_INTEGER };
  if (mode !== "password") return null;
  return verifySessionToken(token, cfg.auth.sessionSecret!);
}

export function sessionFromRequest(cfg: AppConfig, req: Request): Session | null {
  return sessionFromCookieValue(cfg, readCookie(req.headers.get("cookie"), SESSION_COOKIE));
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookieHeader(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}
