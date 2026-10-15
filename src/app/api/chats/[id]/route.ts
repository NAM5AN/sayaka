import { json } from "@/lib/http";
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
