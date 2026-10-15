import { apiError, json, readJson } from "@/lib/http";
import { guarded } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 모델 응답(최대 45초) + 1회 재생성 + 안전 점검까지 기다릴 수 있게 (Vercel 함수 최대 실행 시간, 초)
export const maxDuration = 150;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return guarded(
    req,
    async ({ session, services }) => {
      const body = await readJson(req);
      if (body === null) return apiError("BAD_JSON", "요청 형식이 올바르지 않아요.");
      const result = await services.service.sendMessage({
        ownerId: session.ownerId,
        chatId: id,
        text: body.text,
        clientRequestId: body.clientRequestId,
        admin: session.role === "admin",
      });
      return json(result);
    },
    { mutate: true },
  );
}
