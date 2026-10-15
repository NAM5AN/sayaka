import { cookies } from "next/headers";
import { loadConfig, authStatus } from "@/lib/config";
import { SESSION_COOKIE, sessionFromCookieValue } from "@/lib/auth";
import { ChatApp } from "@/components/ChatApp";
import { LoginForm } from "@/components/LoginForm";
import { Crest } from "@/components/Crest";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cfg = loadConfig();
  const mode = authStatus(cfg);
  if (mode === "not_configured") return <SetupNotice />;
  const jar = await cookies();
  const session = sessionFromCookieValue(cfg, jar.get(SESSION_COOKIE)?.value ?? null);
  if (!session) return <LoginForm hasAdmin={!!cfg.auth.adminPassword} />;
  return <ChatApp role={session.role} openLocal={mode === "open_local"} />;
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
(선택) ADMIN_PASSWORD=진단 화면용 비밀번호`}</pre>
      </div>
    </main>
  );
}
