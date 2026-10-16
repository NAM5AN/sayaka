import { afterAll, describe, expect, it } from "vitest";
import { FakeLlm, makeService, rid, turn } from "../helpers";
import { PROMPT_VERSION } from "@/lib/engine/canon";
import { groundedPlayerViewRecovery } from "@/lib/engine/viewpoint-recovery";
import { ctxFor } from "../helpers";
import type { Db } from "@/lib/db";

const dbs: Db[] = [];
afterAll(async () => { for (const db of dbs) await db.close().catch(() => undefined); });

const departed = () => turn({
  action_intent: "leave",
  sayaka_present: "leaves",
  sayaka_position: "학교 매점",
  segments: [{ kind: "narration", text: "사야카는 복도 끝 계단 쪽으로 걸어간다." }],
  offscreen_event: {
    action: "사야카는 계단을 내려가 학교 매점에 들어간다.",
    location: "학교 매점", carried_add: [], carried_remove: [],
  },
});

const remote = () => turn({
  scene_location: "학교 매점",
  segments: [{ kind: "dialogue", text: "매점 안에서 말하지도 않았는데 그냥 들리니?" }],
});

describe("actor-v2: 사용자 위치의 독립적 확정과 비공개 장면 차단", () => {
  it("실제 위치 이동은 비공개 출력 2회 오류 후에도 사라지지 않고 회복된다", async () => {
    const llm = new FakeLlm().push(departed(), remote(), remote(), turn({
      scene_location: "학교 매점", sayaka_present: "stays",
      segments: [{ kind: "dialogue", text: "왜 이제야 왔어? 난 여기 있었는데." }],
    }));
    const { db, service, repo } = await makeService({ llm });
    dbs.push(db);
    const { chat } = await service.createChat("stage3-door-owner", "quiet_v030");
    const send = (text: string) => service.sendMessage({
      ownerId: "stage3-door-owner", chatId: chat.id, text, clientRequestId: rid(), admin: true,
    });
    const first = await send("나 좀 쉬다가 갈게. 너 먼저 매점 가.");
    expect(first.assistantMessage.source).toBe("model");
    let state = (await repo.loadState(chat.id)).scene;
    expect(state.sayaka.present).toBe(false);
    expect(state.sayaka.position).toBe("학교 매점");

    const move = "(나는 벤치에서 일어나 계단을 내려 매점 문 앞에 선다. 아직 매점 안에 들어가지는 않았다.)";
    const second = await send(move);
    expect(second.assistantMessage.source).toBe("stub");
    expect(second.assistantMessage.body).not.toMatch(/진열대|고르|계산|사야카.*(샀|고른)/);
    expect(second.diagnostics?.recoveredPlayerView).toBe(true);
    expect(second.diagnostics?.recoveredFrom).toContain("offscreen_spoiler");
    state = (await repo.loadState(chat.id)).scene;
    expect(state.location).toBe("매점 문 앞");
    expect(state.sayaka.present).toBe(false);

    const third = await send("(나는 매점 문을 열고 안쪽을 둘러본다.) 사야카, 여기 있어?");
    expect(third.assistantMessage.source).toBe("model");
    expect(third.assistantMessage.body).toContain("왜 이제야 왔어");
    state = (await repo.loadState(chat.id)).scene;
    expect(state.location).toBe("매점 문 앞");
    expect(state.sayaka.present).toBe(true);
    expect(state.sayaka.position).toBe("학교 매점");
    expect(llm.prompts).toHaveLength(4);
    const promptForDoorway = llm.prompts[1].input.find(x => x.role==="developer")?.content;
    expect(promptForDoorway).toContain("이번 턴에 이미 확정된 플레이어 시점");
    expect(promptForDoorway).toContain("매점 문 앞");
    const promptForOpenedDoor = llm.prompts[3].input.find(x=>x.role==="developer")?.content;
    expect(promptForOpenedDoor).toContain("현재 장소를 실제 관찰");
  });

  it("모델의 원격 대사가 문제여도 사용자가 이동하지 않았다면 결코 복구하지 않는다", async () => {
    const llm = new FakeLlm().push(departed(), remote(), remote());
    const { db, service, repo } = await makeService({ llm });
    dbs.push(db);
    const { chat } = await service.createChat("stage3-no-teleport-owner", "quiet_v030");
    const send = (text: string) => service.sendMessage({
      ownerId: "stage3-no-teleport-owner", chatId: chat.id, text, clientRequestId: rid(), admin: true,
    });
    await send("매점 가고 싶으면 먼저 가.");
    await expect(send("사야카? 난 여기 그대로 있는데?")).rejects.toMatchObject({code:"VALIDATION_FAILED"});
    const state=(await repo.loadState(chat.id)).scene;
    expect(state.location).toBe("학교 복도");
    expect(state.sayaka.present).toBe(false);
    expect((await repo.getMessages(chat.id)).filter(m=>m.source==="stub")).toHaveLength(0);
  });

  it("확정된 자연어 이동이 아니면 서버 보완 서술을 만들지 않는다",()=>{
    const ctx=ctxFor({ promptVersion:PROMPT_VERSION, userText:"(나는 매점에 갈까 하고 생각했다.)" });
    ctx.scene.sayaka.present=false;
    ctx.scene.sayaka.position="학교 매점";
    ctx.scene.sayaka.offscreen={location:"학교 매점",carried:[],events:[]};
    expect(groundedPlayerViewRecovery(ctx)).toBeNull();
  });
});
