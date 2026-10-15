import { authStatus, loadConfig } from "@/lib/config";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  adminLoginCredential,
  createSessionToken,
  credentialFor,
  credentialMatches,
  hashPassword,
  sessionCookieHeader,
  type Role,
} from "@/lib/auth";
import { apiError, json, readJson } from "@/lib/http";
import { guarded } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 비밀번호 변경 (관리자 세션 전용).
 * 현재 로그인 비밀번호로 다시 확인한 뒤 새 비밀번호의 scrypt 해시만 DB 에 저장한다.
 * 저장 후 세션 세대를 올려 다른 기기의 로그인을 끊고, 지금 기기에는 새 쿠키를 준다.
 */
export async function POST(req: Request) {
  return guarded(
    req,
    async ({ services }) => {
      const cfg = loadConfig();
      const repo = services.service.repo;
      if (authStatus(cfg) !== "password") {
        return apiError("BAD_REQUEST", "로컬 개발 모드에는 비밀번호가 없어요. 배포 환경에서 바꿀 수 있어요.");
      }
      const body = await readJson(req);
      if (!body) return apiError("BAD_JSON", "요청 형식이 올바르지 않아요.");
      const target = body.target === "admin" ? "admin" : body.target === "player" ? "player" : null;
      const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
      const next = typeof body.newPassword === "string" ? body.newPassword : "";
      if (!target) return apiError("BAD_REQUEST", "바꿀 비밀번호 종류를 골라 주세요.");

      await new Promise((r) => setTimeout(r, 300));
      const loginCred = await adminLoginCredential(cfg, repo);
      if (!loginCred || !credentialMatches(loginCred, current)) {
        return apiError("UNAUTHORIZED", "현재 비밀번호가 맞지 않아요.");
      }
      if (next.trim().length < PASSWORD_MIN || next.length > PASSWORD_MAX) {
        return apiError("BAD_REQUEST", `새 비밀번호는 ${PASSWORD_MIN}자 이상 ${PASSWORD_MAX}자 이하로 정해 주세요.`);
      }
      const other: Role = target === "admin" ? "player" : "admin";
      const otherCred = await credentialFor(cfg, repo, other);
      if (otherCred && credentialMatches(otherCred, next)) {
        return apiError("BAD_REQUEST", "접속 비밀번호와 관리자 비밀번호는 서로 달라야 해요.");
      }
      const sameCred = await credentialFor(cfg, repo, target);
      if (sameCred && credentialMatches(sameCred, next)) {
        return apiError("BAD_REQUEST", "지금 비밀번호와 같아요. 다른 비밀번호를 정해 주세요.");
      }

      await repo.setPassword(target, hashPassword(next));
      const epoch = await repo.bumpEpoch();
      const token = createSessionToken("admin", cfg.auth.sessionSecret!, epoch);
      return json({ ok: true, target }, { headers: { "set-cookie": sessionCookieHeader(token, cfg.isProduction) } });
    },
    { admin: true, mutate: true },
  );
}
