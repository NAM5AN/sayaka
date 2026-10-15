import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setServicesForTest } from "@/lib/services";
import { makeService, rid } from "../helpers";
import * as login from "@/app/api/auth/login/route";
import * as password from "@/app/api/auth/password/route";
import * as status from "@/app/api/status/route";
import * as config from "@/app/api/admin/config/route";
import * as preview from "@/app/api/admin/chats/[id]/prompt/route";
import * as chats from "@/app/api/chats/route";
import * as messages from "@/app/api/chats/[id]/messages/route";
import type { Db } from "@/lib/db";

const BASE = "http://localhost:3000";
let db: Db;

function req(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost:3000", origin: BASE, "content-type": "application/json" };
  if (init.cookie) headers.cookie = init.cookie;
  return new Request(`${BASE}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function login_(pw: string): Promise<{ status: number; cookie: string | null; role?: string }> {
  const r = await login.POST(req("/api/auth/login", { method: "POST", body: { password: pw } }));
  const set = r.headers.get("set-cookie");
  const b = await r.json();
  return { status: r.status, cookie: set ? set.split(";")[0] : null, role: b.role };
}

function setEnv(app: string, admin: string | null) {
  process.env.APP_PASSWORD = app;
  if (admin) process.env.ADMIN_PASSWORD = admin;
  else delete process.env.ADMIN_PASSWORD;
  process.env.SESSION_SECRET = "z".repeat(48);
}

beforeAll(async () => {
  const s = await makeService();
  db = s.db;
  setServicesForTest({ cfg: s.cfg, db: s.db, service: s.service });
});
afterAll(async () => {
  setServicesForTest(undefined);
  for (const k of ["APP_PASSWORD", "ADMIN_PASSWORD", "SESSION_SECRET"]) delete process.env[k];
  await db.close();
});

describe("단독 운영 (관리자 비밀번호 없음)", () => {
  it("접속 비밀번호로 로그인하면 관리자", async () => {
    setEnv("only-pass-1234", null);
    const r = await login_("only-pass-1234");
    expect(r.role).toBe("admin");
    const st = await (await status.GET(req("/api/status", { cookie: r.cookie! }))).json();
    expect(st.passwords).toEqual({ player: "env", admin: "none" });
  });
});

describe("캐릭터·지침 보기 (관리자 전용)", () => {
  it("일반 사용자는 403, 관리자는 지침·캐릭터·등급표·첫 장면·출력 형식을 받는다", async () => {
    setEnv("player-pass-1234", "admin-pass-5678");
    const player = await login_("player-pass-1234");
    expect(player.role).toBe("player");
    expect((await config.GET(req("/api/admin/config", { cookie: player.cookie! }))).status).toBe(403);

    const admin = await login_("admin-pass-5678");
    const r = await config.GET(req("/api/admin/config", { cookie: admin.cookie! }));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.instructions).toContain("# 역할");
    expect(b.canon.name.ko).toBe("카네코 사야카");
    expect(b.lore.length).toBeGreaterThan(10);
    expect(b.openings.length).toBe(2);
    expect(b.schema.type).toBe("object");
    expect(JSON.stringify(b)).not.toContain("sk-test-not-real");
    expect(JSON.stringify(b)).not.toContain("admin-pass-5678");
  });

  it("대화방 상태 블록 미리보기 (모델 호출 없음)", async () => {
    const admin = await login_("admin-pass-5678");
    const c = await (await chats.POST(req("/api/chats", { method: "POST", body: {}, cookie: admin.cookie! }))).json();
    await messages.POST(req(`/api/chats/${c.chat.id}/messages`, { method: "POST", body: { text: "안녕", clientRequestId: rid() }, cookie: admin.cookie! }), params(c.chat.id));
    const r = await preview.GET(req(`/api/admin/chats/${c.chat.id}/prompt`, { cookie: admin.cookie! }), params(c.chat.id));
    const b = await r.json();
    expect(b.stateBlock).toContain("# 현재 장면");
    expect(b.historyCount).toBe(3);
    const player = await login_("player-pass-1234");
    expect((await preview.GET(req(`/api/admin/chats/${c.chat.id}/prompt`, { cookie: player.cookie! }), params(c.chat.id))).status).toBe(403);
  });
});

describe("비밀번호 변경", () => {
  it("일반 사용자는 바꿀 수 없다", async () => {
    const player = await login_("player-pass-1234");
    const r = await password.POST(req("/api/auth/password", { method: "POST", cookie: player.cookie!, body: { target: "player", currentPassword: "player-pass-1234", newPassword: "x".repeat(10) } }));
    expect(r.status).toBe(403);
  });

  it("현재 비밀번호 확인·길이·중복 검사", async () => {
    const admin = await login_("admin-pass-5678");
    const call = (body: object) => password.POST(req("/api/auth/password", { method: "POST", cookie: admin.cookie!, body }));
    expect((await call({ target: "player", currentPassword: "wrong", newPassword: "new-player-9999" })).status).toBe(401);
    expect((await call({ target: "player", currentPassword: "admin-pass-5678", newPassword: "short" })).status).toBe(400);
    expect((await call({ target: "player", currentPassword: "admin-pass-5678", newPassword: "admin-pass-5678" })).status).toBe(400);
    expect((await call({ target: "player", currentPassword: "admin-pass-5678", newPassword: "player-pass-1234" })).status).toBe(400);
  });

  it("바꾸면 새 비밀번호로만 로그인되고, 다른 기기 세션은 끊기며, 지금 기기는 유지", async () => {
    const other = await login_("player-pass-1234"); // 다른 기기
    const admin = await login_("admin-pass-5678");
    const r = await password.POST(
      req("/api/auth/password", { method: "POST", cookie: admin.cookie!, body: { target: "player", currentPassword: "admin-pass-5678", newPassword: "new-player-9999" } }),
    );
    expect(r.status).toBe(200);
    const fresh = r.headers.get("set-cookie")!.split(";")[0];

    expect((await chats.GET(req("/api/chats", { cookie: other.cookie! }))).status).toBe(401);
    expect((await chats.GET(req("/api/chats", { cookie: admin.cookie! }))).status).toBe(401);
    expect((await chats.GET(req("/api/chats", { cookie: fresh }))).status).toBe(200);

    expect((await login_("player-pass-1234")).status).toBe(401);
    expect((await login_("new-player-9999")).role).toBe("player");

    const st = await (await status.GET(req("/api/status", { cookie: fresh }))).json();
    expect(st.passwords).toEqual({ player: "site", admin: "env" });

    // DB 에는 원문이 없고 해시만
    const rows = await db.query<{ value: unknown }>(`SELECT value FROM sayaka.app_settings WHERE key='password.player'`);
    expect(JSON.stringify(rows.rows[0].value)).not.toContain("new-player-9999");
  });

  it("관리자 비밀번호도 바꿀 수 있다", async () => {
    const admin = await login_("admin-pass-5678");
    const r = await password.POST(
      req("/api/auth/password", { method: "POST", cookie: admin.cookie!, body: { target: "admin", currentPassword: "admin-pass-5678", newPassword: "new-admin-7777" } }),
    );
    expect(r.status).toBe(200);
    expect((await login_("admin-pass-5678")).status).toBe(401);
    expect((await login_("new-admin-7777")).role).toBe("admin");
  });
});
