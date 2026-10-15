import { loadConfig, authStatus } from "@/lib/config";
import { createSessionToken, passwordMatches, sessionCookieHeader } from "@/lib/auth";
import { apiError, json, readJson, sameOrigin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 인스턴스 단위의 간단한 무차별 대입 완화 (서버리스에서는 최선 노력)
const attempts = new Map<string, { n: number; until: number }>();

export async function POST(req: Request) {
  const cfg = loadConfig();
  if (!sameOrigin(req)) return apiError("FORBIDDEN_ORIGIN", "허용되지 않은 요청 출처예요.");
  const mode = authStatus(cfg);
  if (mode === "open_local") return json({ role: "admin", mode });
  if (mode === "not_configured") {
    return apiError("AUTH_NOT_CONFIGURED", "서버에 APP_PASSWORD 와 SESSION_SECRET(32자 이상)이 설정되지 않았어요.");
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) return apiError("RATE_LIMITED", "로그인 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.");

  const body = await readJson(req);
  const password = typeof body?.password === "string" ? body.password : "";
  await new Promise((r) => setTimeout(r, 300));

  let role: "player" | "admin" | null = null;
  if (cfg.auth.adminPassword && passwordMatches(password, cfg.auth.adminPassword)) role = "admin";
  else if (cfg.auth.appPassword && passwordMatches(password, cfg.auth.appPassword)) role = "player";

  if (!role) {
    const n = (a?.n ?? 0) + 1;
    attempts.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
    return apiError("UNAUTHORIZED", "비밀번호가 맞지 않아요.");
  }
  attempts.delete(ip);
  const token = createSessionToken(role, cfg.auth.sessionSecret!);
  return json({ role }, { headers: { "set-cookie": sessionCookieHeader(token, cfg.isProduction) } });
}
