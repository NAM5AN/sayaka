import { loadConfig } from "./config";
import { sessionFromRequest, type Session } from "./auth";
import { apiError, errorToResponse, sameOrigin } from "./http";
import { getServices } from "./services";

type Handler = (args: { req: Request; session: Session; services: Awaited<ReturnType<typeof getServices>> }) => Promise<Response>;

/** 인증 + (변경 요청이면) 동일 출처 확인 + 서비스 준비 + 오류 변환 */
export async function guarded(req: Request, handler: Handler, opts: { mutate?: boolean; admin?: boolean } = {}): Promise<Response> {
  try {
    const cfg = loadConfig();
    const session = sessionFromRequest(cfg, req);
    if (!session) return apiError("UNAUTHORIZED", "로그인이 필요해요.");
    if (opts.admin && session.role !== "admin") return apiError("FORBIDDEN", "관리자만 사용할 수 있어요.");
    if (opts.mutate && !sameOrigin(req)) return apiError("FORBIDDEN_ORIGIN", "허용되지 않은 요청 출처예요.");
    const services = await getServices();
    return await handler({ req, session, services });
  } catch (e) {
    return errorToResponse(e);
  }
}
