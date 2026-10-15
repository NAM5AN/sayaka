"use client";

import { useState } from "react";
import { Crest } from "./Crest";

export function LoginForm({ hasAdmin }: { hasAdmin: boolean }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (r.ok) {
        window.location.reload();
        return;
      }
      const b = await r.json().catch(() => null);
      setError(b?.error?.message ?? "로그인하지 못했어요.");
    } catch {
      setError("서버에 연결하지 못했어요. 네트워크를 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-wrap">
      <form className="login" onSubmit={submit}>
        <span className="crest-big">
          <Crest size={34} />
        </span>
        <h1>사야카와의 대화</h1>
        <p>방과 후 학교 복도에서, 처음 보는 아이와 마주쳐요.</p>
        <label htmlFor="pw">비밀번호</label>
        <input
          id="pw"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={busy || !password}>
          {busy ? "확인 중…" : "들어가기"}
        </button>
        {hasAdmin && <p className="fineprint" style={{ marginTop: 14, marginBottom: 0 }}>관리자 비밀번호로 들어가면 응답 진단을 볼 수 있어요.</p>}
      </form>
    </main>
  );
}
