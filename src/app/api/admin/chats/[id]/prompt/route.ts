import { json } from "@/lib/http";
import { guarded } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 관리자용: 이 대화방에서 다음 턴에 GPT 로 보낼 서버 상태 블록 미리보기 (모델 호출 없음) */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return guarded(req, async ({ session, services }) => json(await services.service.previewPrompt(session.ownerId, id)), { admin: true });
}
