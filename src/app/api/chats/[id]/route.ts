import { json, readJson, apiError } from "@/lib/http";
import { guarded } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return guarded(req, async ({ session, services }) => {
    const data = await services.service.getChat(session.ownerId, id, session.role === "admin");
    return json(data);
  });
}

/** Per-chat wall-clock switch; boolean only, no client-controlled state patches. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return guarded(
    req,
    async ({ session, services }) => {
      const body = await readJson(req);
      if (!body || typeof body.realTimeEnabled !== "boolean" || Object.keys(body).length !== 1) {
        return apiError("BAD_REQUEST", "현실 시간 옵션은 ON/OFF 중 하나로 설정해야 해요.");
      }
      const settings = await services.service.setRealTimeEnabled(session.ownerId, id, body.realTimeEnabled);
      return json({ settings });
    },
    { mutate: true },
  );
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return guarded(
    req,
    async ({ session, services }) => {
      await services.service.deleteChat(session.ownerId, id);
      return json({ ok: true });
    },
    { mutate: true },
  );
}
