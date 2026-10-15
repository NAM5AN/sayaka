import { describe, expect, it } from "vitest";
import { applyTurn, claimGrounded } from "@/lib/engine/state";
import { createSessionToken, verifySessionToken, passwordMatches, sessionFromCookieValue, readCookie } from "@/lib/auth";
import { ctxFor, turn, testConfig } from "../helpers";

describe("상태 반영: 물건·장면", () => {
  it("상대가 받았다고 하지 않았으면 with_user → offered_to_user 로 낮춘다", () => {
    const r = applyTurn(ctxFor({ userText: "안녕" }), turn({ item_changes: [{ item: "mychew", location: "with_user", reason: "" }] }), []);
    expect(r.scene.items.mychew.location).toBe("offered_to_user");
    expect(r.corrections.join()).toContain("offered_to_user");
  });

  it("상대가 '받는다'고 쓴 다음 턴에 내밀어 둔 물건은 상대 소유가 된다", () => {
    const ctx = ctxFor({ userText: "(마이쮸를 받는다)" });
    ctx.scene.items.mychew = { location: "offered_to_user", shown_to_user: true };
    const r = applyTurn(ctx, turn(), []);
    expect(r.scene.items.mychew.location).toBe("with_user");
  });

  it("닫힌 킨차쿠에서 회중시계를 꺼내면 킨차쿠를 연 것으로 보정", () => {
    const r = applyTurn(ctxFor(), turn({ item_changes: [{ item: "pocket_watch", location: "in_sayaka_hand", reason: "" }] }), []);
    expect(r.scene.kinchaku_open).toBe(true);
    expect(r.scene.items.pocket_watch.shown_to_user).toBe(true);
  });

  it("꽃병은 사야카 가방이나 킨차쿠로 갈 수 없다", () => {
    const r = applyTurn(ctxFor(), turn({ item_changes: [{ item: "vase", location: "inside_kinchaku", reason: "" }] }), []);
    expect(r.scene.items.vase.location).toBe("windowsill");
  });

  it("자리를 떠나면 present=false", () => {
    const r = applyTurn(ctxFor(), turn({ sayaka_present: "leaves", action_intent: "leave" }), []);
    expect(r.scene.sayaka.present).toBe(false);
  });
});

describe("상태 반영: 관계 (자동 상승 금지)", () => {
  it("이유 없는 변화는 무시", () => {
    const r = applyTurn(ctxFor(), turn({ relationship_signals: [{ axis: "trust", direction: "up", reason: "" }] }), []);
    expect(r.relationship.trust).toBe(0);
  });

  it("선물·칭찬만으로는 신뢰가 오르지 않는다", () => {
    const r = applyTurn(ctxFor(), turn({ user_move: "gift_or_offer", relationship_signals: [{ axis: "trust", direction: "up", reason: "선물을 줬다" }] }), []);
    expect(r.relationship.trust).toBe(0);
  });

  it("신뢰는 6턴에 한 번만 오른다", () => {
    const ctx = ctxFor({ turnIndex: 10 });
    ctx.relationship.last_trust_up_turn = 7;
    const r = applyTurn(ctx, turn({ relationship_signals: [{ axis: "trust", direction: "up", reason: "도와줬다" }] }), []);
    expect(r.relationship.trust).toBe(0);
    ctx.relationship.last_trust_up_turn = 2;
    const r2 = applyTurn(ctx, turn({ relationship_signals: [{ axis: "trust", direction: "up", reason: "도와줬다" }] }), []);
    expect(r2.relationship.trust).toBe(1);
  });

  it("축은 독립: 경계↑ 와 호기심↑ 가 동시에 가능", () => {
    const r = applyTurn(
      ctxFor(),
      turn({ relationship_signals: [{ axis: "wariness", direction: "up", reason: "낯선 물건" }, { axis: "curiosity", direction: "up", reason: "신기함" }] }),
      [],
    );
    expect(r.relationship.wariness).toBe(4);
    expect(r.relationship.curiosity).toBe(3);
  });

  it("짜증은 자극이 없으면 가라앉는다", () => {
    const ctx = ctxFor();
    ctx.relationship.annoyance = 3;
    expect(applyTurn(ctx, turn({ user_move: "apology" }), []).relationship.annoyance).toBe(2);
    expect(applyTurn(ctx, turn({ user_move: "provocation" }), []).relationship.annoyance).toBe(3);
  });
});

describe("상태 반영: 기억", () => {
  it("상대 주장은 이번 입력에 근거가 있을 때만 저장하고 이름을 기록", () => {
    const ctx = ctxFor({ userText: "내 이름은 아오이야" });
    const r = applyTurn(ctx, turn({ memory_candidates: [{ kind: "user_claim", target: "user_name", value: "아오이", text: "상대가 이름을 아오이라고 함" }] }), []);
    expect(r.relationship.user_name).toBe("아오이");
    expect(r.newMemories[0].text).toContain("(상대 주장)");
    const bad = applyTurn(ctxFor({ userText: "안녕" }), turn({ memory_candidates: [{ kind: "user_claim", target: "user_name", value: "하루토", text: "상대 이름은 하루토" }] }), []);
    expect(bad.relationship.user_name).toBeNull();
    expect(bad.newMemories).toHaveLength(0);
  });

  it("claimGrounded: 조사가 붙은 값도 인정", () => {
    expect(claimGrounded({ value: "아오이야", text: "" }, "내 이름은 아오이")).toBe(true);
  });

  it("즉흥 취향은 improvised_detail 로만 남는다 (전역 캐논 아님)", () => {
    const r = applyTurn(
      ctxFor({ userText: "마이쮸 무슨 맛 좋아해?" }),
      turn({ memory_candidates: [{ kind: "improvised_detail", target: "mychew", value: "포도", text: "포도맛이 좋다고 함" }] }),
      [{ kind: "dialogue", text: "포도." }],
    );
    expect(r.newMemories[0].kind).toBe("improvised_detail");
  });

  it("공개 기록은 신뢰 조건 + 대사 근거가 있어야 한다", () => {
    const ctx = ctxFor({ userText: "아빠 뭐 하셔?" });
    const noTrust = applyTurn(ctx, turn({ disclosure_ids: ["family_father"] }), [{ kind: "dialogue", text: "아빠는 조직 일 해." }]);
    expect(noTrust.newDisclosures).toEqual([]);
    ctx.relationship.trust = 4;
    const noEvidence = applyTurn(ctx, turn({ disclosure_ids: ["family_father"] }), [{ kind: "dialogue", text: "몰라." }]);
    expect(noEvidence.newDisclosures).toEqual([]);
    const ok = applyTurn(ctx, turn({ disclosure_ids: ["family_father"] }), [{ kind: "dialogue", text: "……아빠는 조직 일 해." }]);
    expect(ok.newDisclosures).toEqual(["family_father"]);
  });
});

describe("인증", () => {
  const secret = "x".repeat(40);
  it("서명 검증·변조·만료", () => {
    const t = createSessionToken("player", secret);
    expect(verifySessionToken(t, secret)?.role).toBe("player");
    const [p, s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ role: "admin", ownerId: "owner", exp: 9999999999 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${s}`, secret)).toBeNull();
    expect(verifySessionToken(`${p}.${s}`, "y".repeat(40))).toBeNull();
    const old = createSessionToken("admin", secret, Date.now() - 40 * 24 * 3600 * 1000);
    expect(verifySessionToken(old, secret)).toBeNull();
  });

  it("비밀번호 비교", () => {
    expect(passwordMatches("abc", "abc")).toBe(true);
    expect(passwordMatches("abc", "abd")).toBe(false);
  });

  it("무인증 모드는 production 이 아니고 APP_PASSWORD 가 없을 때만", () => {
    const local = testConfig();
    expect(sessionFromCookieValue(local, null)?.role).toBe("admin");
    const prod = testConfig();
    prod.isProduction = true;
    prod.auth = { appPassword: null, adminPassword: null, sessionSecret: null, openLocalAccess: false };
    expect(sessionFromCookieValue(prod, null)).toBeNull();
  });

  it("쿠키 파싱", () => {
    expect(readCookie("a=1; sayaka_session=abc.def; b=2", "sayaka_session")).toBe("abc.def");
  });
});
