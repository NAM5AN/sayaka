import { aiStatus, authStatus, loadConfig } from "@/lib/config";
import { credentialFor } from "@/lib/auth";
import { json } from "@/lib/http";
import { guarded } from "@/lib/route-helpers";
import { OPENINGS } from "@/lib/engine/canon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 로그인한 사용자에게 보여 줄 연결 상태. 비밀값은 포함하지 않는다. */
export async function GET(req: Request) {
  return guarded(req, async ({ session, services }) => {
    const { cfg, db } = services;
    const repo = services.service.repo;
    const ai = aiStatus(cfg);
    const authCfg = loadConfig();
    const mode = authStatus(authCfg);
    let passwords: { player: string; admin: string } | null = null;
    if (mode === "password" && session.role === "admin") {
      const [p, a] = await Promise.all([credentialFor(authCfg, repo, "player"), credentialFor(authCfg, repo, "admin")]);
      passwords = { player: p?.source ?? "none", admin: a?.source ?? "none" };
    }
    return json({
      role: session.role,
      auth: mode,
      passwords,
      ai: { status: ai, model: ai === "openai" ? cfg.ai.model : ai === "stub" ? "stub" : null, moderation: ai === "openai" && cfg.ai.moderation },
      db: { kind: db.kind },
      limits: { maxInputChars: cfg.limits.maxInputChars, perMinute: cfg.limits.perMinute, perDay: cfg.limits.perDay },
      openings: OPENINGS.map((o) => ({ id: o.id, label: o.label, description: o.description })),
    });
  });
}
