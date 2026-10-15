import { loadConfig } from "@/lib/config";
import { clearSessionCookieHeader } from "@/lib/auth";
import { apiError, json, sameOrigin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return apiError("FORBIDDEN_ORIGIN", "허용되지 않은 요청 출처예요.");
  const cfg = loadConfig();
  return json({ ok: true }, { headers: { "set-cookie": clearSessionCookieHeader(cfg.isProduction) } });
}
