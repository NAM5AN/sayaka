import { afterAll, describe, expect, it } from "vitest";
import { FakeLlm, makeService, rid, turn } from "../helpers";
import type { Db } from "@/lib/db";

const dbs: Db[] = [];
afterAll(async () => { for (const db of dbs) await db.close(); });

describe("채팅별 현실 시간 ON/OFF 영속성", () => {
  it("새 방과 기존 방은 OFF이고, 한 방만 ON으로 바꿔도 다른 방에는 영향이 없다", async () => {
    const { db, service, repo } = await makeService({ llm: new FakeLlm() });
    dbs.push(db);
    const owner = "time-test-owner";
    const first = await service.createChat(owner, "quiet_v030");
    const second = await service.createChat(owner, "quiet_v030");
    expect(first.settings.realTimeEnabled).toBe(false);
    expect((await service.getChat(owner, first.chat.id, false)).settings.realTimeEnabled).toBe(false);
    expect((await repo.getRealTimeEnabled(owner, second.chat.id))).toBe(false);

    expect(await service.setRealTimeEnabled(owner, first.chat.id, true)).toEqual({ realTimeEnabled: true });
    const state = (await repo.loadState(first.chat.id)).scene;
    expect(state.real_time?.enabled).toBe(true);
    expect(Date.parse(state.real_time?.anchor_at ?? "")).toBeGreaterThan(0);
    expect((await service.getChat(owner, first.chat.id, false)).settings.realTimeEnabled).toBe(true);
    expect((await repo.getRealTimeEnabled(owner, second.chat.id))).toBe(false);

    const anchor = state.real_time?.anchor_at;
    await service.setRealTimeEnabled(owner, first.chat.id, true);
    expect((await repo.loadState(first.chat.id)).scene.real_time?.anchor_at).toBe(anchor);
    await service.setRealTimeEnabled(owner, first.chat.id, false);
    expect((await repo.loadState(first.chat.id)).scene.real_time).toEqual({ enabled: false, anchor_at: null });
    expect((await repo.getChat(owner, first.chat.id))?.turn_count).toBe(0);
  });

  it("OFF인 방은 시간 정보 없이 응답하고, ON은 시간 정보를 제공한 뒤 성공 시 체크포인트를 새로 저장한다", async () => {
    const llm = new FakeLlm().push(
      turn({ segments: [{ kind: "dialogue", text: "뭐." }] }),
      turn({ segments: [{ kind: "dialogue", text: "아, 또 왔어?" }] }),
    );
    const { db, service, repo } = await makeService({ llm });
    dbs.push(db);
    const owner = "time-inference-owner";
    const { chat } = await service.createChat(owner, "quiet_v030");
    await service.sendMessage({ ownerId: owner, chatId: chat.id, text: "안녕", clientRequestId: rid(), admin: false });
    expect(llm.lastPromptText()).not.toContain("# 현실 시간 흐름");

    await service.setRealTimeEnabled(owner, chat.id, true);
    const priorAnchor = (await repo.loadState(chat.id)).scene.real_time?.anchor_at;
    await service.sendMessage({ ownerId: owner, chatId: chat.id, text: "나 돌아왔어", clientRequestId: rid(), admin: false });
    expect(llm.lastPromptText()).toContain("# 현실 시간 흐름");
    const stored = await repo.loadState(chat.id);
    expect(stored.scene.real_time?.enabled).toBe(true);
    expect(Date.parse(stored.scene.real_time?.anchor_at ?? "")).toBeGreaterThanOrEqual(Date.parse(priorAnchor ?? ""));
    expect(stored.history.filter(x => x.role === "assistant")).toHaveLength(3);
    expect(stored.scene.sayaka.activity).toBeNull();
    expect(stored.relationship.trust).toBe(0);
  });

  it("다른 사용자가 변경할 수 없고 응답 생성 중에는 설정 변경이 차단된다", async () => {
    const { db, service, repo } = await makeService({ llm: new FakeLlm() });
    dbs.push(db);
    const { chat } = await service.createChat("right-owner", "quiet_v030");
    await expect(service.setRealTimeEnabled("wrong-owner", chat.id, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await repo.getRealTimeEnabled("wrong-owner", chat.id)).toBeNull();

    expect(await repo.acquireLease("right-owner", chat.id, 60)).toBe(true);
    await expect(service.setRealTimeEnabled("right-owner", chat.id, true)).rejects.toMatchObject({ code: "BUSY" });
    expect((await repo.loadState(chat.id)).scene.real_time?.enabled).toBe(false);
    await repo.releaseLease(chat.id);
    expect(await service.setRealTimeEnabled("right-owner", chat.id, true)).toEqual({ realTimeEnabled: true });
  });

  it("과거에 만들어진 실험용 scene JSON에 설정 항목이 없어도 OFF로 읽고 ON 설정 가능", async () => {
    const { db, repo, service } = await makeService({ llm: new FakeLlm() });
    dbs.push(db);
    const owner = "legacy-timestamp-owner";
    const { chat } = await service.createChat(owner, "quiet_v030");
    const scene = (await repo.loadState(chat.id)).scene;
    delete scene.real_time;
    await db.query("UPDATE sayaka.scene_states SET state=$2::jsonb WHERE chat_id=$1", [chat.id, JSON.stringify(scene)]);
    expect(await repo.getRealTimeEnabled(owner, chat.id)).toBe(false);
    expect(await service.setRealTimeEnabled(owner, chat.id, true)).toEqual({ realTimeEnabled: true });
    expect((await repo.loadState(chat.id)).scene.real_time?.enabled).toBe(true);
  });
});
