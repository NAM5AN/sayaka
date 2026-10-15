import { cookies } from "next/headers";
import { loadConfig, authStatus } from "@/lib/config";
import { SESSION_COOKIE, credentialFor, sessionFromCookieValue } from "@/lib/auth";
import { getServices } from "@/lib/services";
import { ChatApp } from "@/components/ChatApp";
import { LoginForm } from "@/components/LoginForm";
import { Crest } from "@/components/Crest";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cfg = loadConfig();
  const mode = authStatus(cfg);
  if (mode === "not_configured") return <SetupNotice />;
  if (mode === "open_local") return <ChatApp role="admin" openLocal />;

  let services: Awaited<ReturnType<typeof getServices>>;
  try {
    services = await getServices();
  } catch {
    return <DbErrorNotice />;
  }
  const repo = services.service.repo;
  const jar = await cookies();
  const session = await sessionFromCookieValue(cfg, repo, jar.get(SESSION_COOKIE)?.value ?? null);
  if (!session) return <LoginForm hasAdmin={!!(await credentialFor(cfg, repo, "admin"))} />;
  return <ChatApp role={session.role} openLocal={false} />;
}

function SetupNotice() {
  return (
    <main className="login-wrap">
      <div className="login setup">
        <span className="crest-big">
          <Crest size={34} />
        </span>
        <h1>서버 설정이 필요해요</h1>
        <p>운영 모드에서는 비밀번호 없이 열 수 없어요. 배포 환경변수에 아래 값을 넣은 뒤 다시 배포해 주세요.</p>
        <pre>{`APP_PASSWORD=접속 비밀번호
SESSION_SECRET=32자 이상 임의 문자열
(선택) ADMIN_PASSWORD=관리자 비밀번호`}</pre>
      </div>
    </main>
  );
}

function DbErrorNotice() {
  return (
    <main className="login-wrap">
      <div className="login setup">
        <span className="crest-big">
          <Crest size={34} />
        </span>
        <h1>데이터베이스에 연결하지 못했어요</h1>
        <p>DATABASE_URL 값과 DB 상태를 확인한 뒤 새로고침해 주세요. /api/health 에서 연결 상태를 볼 수 있어요.</p>
      </div>
    </main>
  );
}
