import { loadConfig, aiStatus, authStatus } from "@/lib/config";
import { json } from "@/lib/http";
import { getServices } from "@/lib/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 서비스 준비 상태. 비밀값·모델 응답·대화 내용은 포함하지 않는다. */
export async function GET() {
  const cfg = loadConfig();
  let db: "ok" | "error" = "ok";
  let dbKind: string | null = null;
  try {
    const s = await getServices();
    await s.db.query("SELECT 1");
    dbKind = s.db.kind;
  } catch {
    db = "error";
  }
  const ai = aiStatus(cfg);
  const auth = authStatus(cfg);
  const ok = db === "ok" && ai !== "not_configured" && auth !== "not_configured";
  return json({ ok, db, dbKind, ai, auth }, { status: ok ? 200 : 503 });
}
