import { json, readJson, apiError } from "@/lib/http";
import { guarded } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return guarded(req, async ({ session, services }) => {
    const chats = await services.service.listChats(session.ownerId);
    return json({ chats });
  });
}

export async function POST(req: Request) {
  return guarded(
    req,
    async ({ session, services }) => {
      const body = await readJson(req);
      if (body === null) return apiError("BAD_JSON", "요청 형식이 올바르지 않아요.");
      const openingId = typeof body.openingId === "string" ? body.openingId : null;
      const created = await services.service.createChat(session.ownerId, openingId);
      return json(created, { status: 201 });
    },
    { mutate: true },
  );
}

/** 내 대화 전체 삭제 */
export async function DELETE(req: Request) {
  return guarded(
    req,
    async ({ session, services }) => {
      const body = await readJson(req);
      if (body?.confirm !== "DELETE_ALL") return apiError("BAD_REQUEST", "삭제 확인 값이 필요해요.");
      const deleted = await services.service.deleteAll(session.ownerId);
      return json({ deleted });
    },
    { mutate: true },
  );
}
