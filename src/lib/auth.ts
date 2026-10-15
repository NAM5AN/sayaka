import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "./config";
import { authStatus } from "./config";

/**
 * 비밀번호 세션.
 *  - player: 대화 이용
 *  - admin : 대화 이용 + 진단·대화방 상태·캐릭터/지침 보기·비밀번호 변경
 * 관리자 권한은 비밀번호 로그인으로만 얻는다. 채팅 본문의 'OOC:' 등은 권한과 무관하다.
 *
 * 비밀번호 출처
 *  1) 사이트에서 바꾼 비밀번호(DB, scrypt 해시) — 있으면 우선
 *  2) 없으면 환경변수 APP_PASSWORD / ADMIN_PASSWORD
 * 관리자 비밀번호가 어디에도 없으면 '단독 운영'으로 보고 접속 비밀번호 로그인을 관리자로 취급한다.
 * 비밀번호를 바꾸면 세션 세대(epoch)를 올려 다른 기기의 로그인을 모두 끊는다.
 * 대화방 소유자(owner_id)는 단일 사용자 운영을 전제로 'owner' 하나로 둔다.
 */

export type Role = "player" | "admin";
export interface Session {
  role: Role;
  ownerId: string;
  exp: number;
  /** 세션 세대. 비밀번호 변경 시 올라가며, 다르면 무효 */
  v: number;
}

export interface PasswordRecord {
  algo: "scrypt";
  salt: string;
  hash: string;
  N: number;
  r: number;
  p: number;
  updatedAt: string;
}

/** 비밀번호·세션 세대 저장소 (Repo 가 구현, 테스트에서는 메모리 구현) */
export interface AuthStore {
  getPassword(role: Role): Promise<PasswordRecord | null>;
  setPassword(role: Role, rec: PasswordRecord): Promise<void>;
  getEpoch(): Promise<number>;
  bumpEpoch(): Promise<number>;
}

export const SESSION_COOKIE = "sayaka_session";
export const OWNER_ID = "owner";
const MAX_AGE_SEC = 60 * 60 * 24 * 30;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

// ───────── 비밀번호 해시 ─────────

export function hashPassword(pw: string, now = new Date()): PasswordRecord {
  const salt = randomBytes(16).toString("base64url");
  const N = 16384;
  const r = 8;
  const p = 1;
  const hash = scryptSync(pw, salt, 32, { N, r, p }).toString("base64url");
  return { algo: "scrypt", salt, hash, N, r, p, updatedAt: now.toISOString() };
}

export function verifyPassword(pw: string, rec: PasswordRecord): boolean {
  if (rec.algo !== "scrypt") return false;
  const got = scryptSync(pw, rec.salt, 32, { N: rec.N, r: rec.r, p: rec.p });
  const want = Buffer.from(rec.hash, "base64url");
  return got.length === want.length && timingSafeEqual(got, want);
}

export function passwordMatches(input: string, expected: string): boolean {
  const a = createHmac("sha256", "cmp").update(input).digest();
  const b = createHmac("sha256", "cmp").update(expected).digest();
  return timingSafeEqual(a, b);
}

export type Credential = { source: "site"; rec: PasswordRecord } | { source: "env"; value: string };

export async function credentialFor(cfg: AppConfig, store: AuthStore, role: Role): Promise<Credential | null> {
  const rec = await store.getPassword(role);
  if (rec) return { source: "site", rec };
  const env = role === "admin" ? cfg.auth.adminPassword : cfg.auth.appPassword;
  return env ? { source: "env", value: env } : null;
}

export function credentialMatches(cred: Credential, pw: string): boolean {
  return cred.source === "site" ? verifyPassword(pw, cred.rec) : passwordMatches(pw, cred.value);
}

/** 로그인 비밀번호 → 역할. 관리자 비밀번호가 없으면 접속 비밀번호가 관리자 역할 */
export async function roleForPassword(cfg: AppConfig, store: AuthStore, pw: string): Promise<Role | null> {
  if (!pw) return null;
  const admin = await credentialFor(cfg, store, "admin");
  const player = await credentialFor(cfg, store, "player");
  if (admin && credentialMatches(admin, pw)) return "admin";
  if (player && credentialMatches(player, pw)) return admin ? "player" : "admin";
  return null;
}

/** 지금 관리자 세션이 로그인에 쓴 비밀번호 (단독 운영이면 접속 비밀번호) */
export async function adminLoginCredential(cfg: AppConfig, store: AuthStore): Promise<Credential | null> {
  return (await credentialFor(cfg, store, "admin")) ?? (await credentialFor(cfg, store, "player"));
}

// ───────── 세션 토큰 ─────────

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(role: Role, secret: string, epoch = 0, now = Date.now()): string {
  const s: Session = { role, ownerId: OWNER_ID, exp: Math.floor(now / 1000) + MAX_AGE_SEC, v: epoch };
  const payload = b64url(JSON.stringify(s));
  return `${payload}.${sign(payload, secret)}`;
}

/** 서명·만료만 확인 (세대 비교는 sessionFrom* 에서) */
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
    if (typeof s.v !== "number") s.v = 0;
    return s;
  } catch {
    return null;
  }
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

/** 쿠키 값에서 세션을 구한다. 로컬 개발 무인증 모드에서는 admin 세션을 돌려준다. */
export async function sessionFromCookieValue(cfg: AppConfig, store: AuthStore | null, token: string | null): Promise<Session | null> {
  const mode = authStatus(cfg);
  if (mode === "open_local") return { role: "admin", ownerId: OWNER_ID, exp: Number.MAX_SAFE_INTEGER, v: 0 };
  if (mode !== "password" || !store) return null;
  const s = verifySessionToken(token, cfg.auth.sessionSecret!);
  if (!s) return null;
  const epoch = await store.getEpoch();
  return s.v === epoch ? s : null;
}

export function sessionFromRequest(cfg: AppConfig, store: AuthStore | null, req: Request): Promise<Session | null> {
  return sessionFromCookieValue(cfg, store, readCookie(req.headers.get("cookie"), SESSION_COOKIE));
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookieHeader(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}
