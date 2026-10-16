import { afterAll, describe, expect, it } from "vitest";
import { FakeLlm, makeService, rid, turn } from "../helpers";
import type { Db } from "@/lib/db";
import type { ModelTurn } from "@/lib/engine/types";

const dbs: Db[] = [];
afterAll(async () => { for (const db of dbs) await db.close(); });

function makePrivateTurn(
  props: Partial<ModelTurn>,
  action = "", location = "", carried_add: string[] = [],
) {
  return turn({
    ...props,
    offscreen_event: { action, location, carried_add, carried_remove: [] },
  });
}

describe("실제 DB 채팅: 보이지 않는 사야카의 생활", () => {
  it("방과 후 혼자 매점에 가서 빵을 사더라도 대화에는 비공개 과정이 공개되지 않는다", async () => {
    const llm = new FakeLlm().push(
      makePrivateTurn({
        user_move: "small_talk", action_intent: "leave",
        segments: [
          { kind: "dialogue", text: "몰라. 매점이나 가 볼래." },
          { kind: "narration", text: "사야카는 계단 쪽으로 먼저 걸어간다." },
        ],
        sayaka_present: "leaves",
        sayaka_position: "학교 계단 쪽으로 가는 중",
        initiative: {
          mode: "start", objective: "매점에서 빵을 사온다",
          next_step: "진열대에서 남은 빵을 살펴본다",
          evidence: "사야카는 계단 쪽으로 먼저 걸어간다.",
        },
      }, "사야카는 계단을 내려가 학교 매점에 들어간다.", "학교 매점"),
      makePrivateTurn({
        user_move: "action_only", action_intent: "continue_task",
        segments: [{ kind: "narration", text: "복도에는 사야카의 모습이 보이지 않는다." }],
        initiative: {
          mode: "advance", objective: "", next_step: "빵을 사고 봉지를 챙긴다",
          evidence: "사야카는 학교 매점 진열대에서 빵을 하나 고른다.",
        },
      }, "사야카는 학교 매점 진열대에서 빵을 하나 고른다.", "학교 매점"),
      makePrivateTurn({
        user_move: "action_only", action_intent: "continue_task",
        segments: [{ kind: "narration", text: "복도에는 발소리만 들린다." }],
        initiative: {
          mode: "complete", objective: "", next_step: "",
          evidence: "사야카는 매점에서 빵을 샀고 봉지를 가방에 넣었다.",
        },
      }, "사야카는 매점에서 빵을 샀고 봉지를 가방에 넣었다.", "학교 매점", ["빵 봉지"]),
      turn({
        user_move: "action_only", action_intent: "reply",
        segments: [
          { kind: "narration", text: "사야카가 매점 입구에 서 있다. 손에는 빵 봉지가 들려 있다." },
          { kind: "dialogue", text: "……뭐야. 따라왔어?" },
        ],
        scene_location: "학교 매점",
        sayaka_present: "stays",
      }),
    );
    const { db, service, repo } = await makeService({ llm });
    dbs.push(db);
    const owner = "private-room-owner";
    const { chat } = await service.createChat(owner, "quiet_v030");
    const turns = [
      "아, 나 심심해. 너는 뭐 해?",
      "(나는 복도 벤치에 앉아 사야카가 간 곳을 바라본다.)",
      "(나는 그냥 휴대폰을 확인한다.)",
      "(나는 학교 매점으로 걸어가 도착한다.)",
    ];
    for (let i = 0; i < 4; i++) {
      const reply = await service.sendMessage({
        ownerId: owner, chatId: chat.id, text: turns[i], clientRequestId: rid(), admin: false,
      });
      expect(reply.deduped).toBe(false);
      expect(reply.diagnostics).toBeUndefined();
      if (i < 3) {
        expect(reply.assistantMessage.body).not.toMatch(/진열대|빵을 샀고|계산대/);
      }
      const state = (await repo.loadState(chat.id)).scene;
      if (i === 0) {
        expect(state.sayaka.present).toBe(false);
        expect(state.sayaka.position).toBe("학교 매점");
        expect(state.location).toBe("학교 복도");
      }
      if (i === 1) {
        expect(state.sayaka.activity?.last_step).toContain("고른다");
        expect(state.location).toBe("학교 복도");
        expect(state.sayaka.offscreen?.events).toHaveLength(2);
      }
      if (i === 2) {
        expect(state.sayaka.activity).toBeNull();
        expect(state.sayaka.offscreen?.carried).toContain("빵 봉지");
        expect(state.sayaka.offscreen?.events).toHaveLength(3);
        expect(state.location).toBe("학교 복도");
      }
      if (i === 3) {
        expect(state.sayaka.present).toBe(true);
        expect(state.location).toBe("학교 매점");
        expect(reply.assistantMessage.body).toContain("빵 봉지");
      }
    }
    const visible = await service.getChat(owner, chat.id, false);
    expect("admin" in visible).toBe(false);
    expect("state" in visible).toBe(false);
    expect(visible.messages).toHaveLength(9); // opening + four user/response pairs
    const assistant = visible.messages.filter((m) => m.source === "model");
    expect(assistant).toHaveLength(4);
    expect(assistant[1].body).toBe("(복도에는 사야카의 모습이 보이지 않는다.)");
    expect(assistant[2].body).not.toContain("빵을 샀고");
    const status = await repo.loadState(chat.id);
    expect(status.scene.sayaka.offscreen?.events).toHaveLength(3);
    expect(status.memories.some((m) => m.text.includes("빵을 샀고"))).toBe(false);
    expect(llm.prompts).toHaveLength(4);
    const hiddenContext = llm.prompts[2].input.find((m) => m.role === "developer")?.content || "";
    expect(hiddenContext).toContain("서버 내부의 사야카 비공개 행적");
    expect(hiddenContext).toContain("매점 진열대");
  });

  it("두 개의 방에서 비공개 사건과 소지품이 절대로 섞이지 않는다", async () => {
    const llm = new FakeLlm().push(
      makePrivateTurn({
        sayaka_present: "leaves", action_intent: "leave",
        segments: [{ kind: "narration", text: "사야카는 계단 쪽으로 걸어간다." }],
      }, "사야카는 학교 매점으로 걸어가 빵을 샀다.", "학교 매점", ["빵 봉지"]),
      turn({
        segments: [{ kind: "dialogue", text: "……누구야?" }],
      }),
    );
    const { db, repo, service } = await makeService({ llm });
    dbs.push(db);
    const owner = "private-isolation-owner";
    const a = await service.createChat(owner, "quiet_v030");
    const b = await service.createChat(owner, "quiet_v030");
    await service.sendMessage({ ownerId: owner, chatId: a.chat.id,
      text: "나 먼저 갈게", clientRequestId: rid(), admin: false });
    await service.sendMessage({ ownerId: owner, chatId: b.chat.id,
      text: "하이", clientRequestId: rid(), admin: false });
    expect((await repo.loadState(a.chat.id)).scene.sayaka.offscreen?.carried).toContain("빵 봉지");
    expect((await repo.loadState(b.chat.id)).scene.sayaka.offscreen?.carried).toEqual([]);
    expect(llm.prompts[1].input.find((m) => m.role === "developer")?.content).not.toContain("빵 봉지");
  });

  it("멀리 떨어진 사야카를 노출한 생성은 차단하고 실제 플레이어가 볼 수 있는 응답만 저장", async () => {
    const llm = new FakeLlm().push(
      makePrivateTurn({
        sayaka_present: "leaves", action_intent: "leave",
        segments: [{ kind: "narration", text: "사야카는 계단으로 걸어간다." }],
      }, "사야카는 매점 안으로 들어간다.", "학교 매점"),
      turn({
        segments: [{ kind: "narration", text: "사야카는 매점 안에서 빵을 골라 계산한다." }],
      }),
      turn({
        segments: [{ kind: "narration", text: "복도엔 사야카의 모습이 보이지 않는다." }],
      }),
    );
    const { db, repo, service } = await makeService({ llm });
    dbs.push(db);
    const owner = "private-no-spoiler-owner";
    const { chat } = await service.createChat(owner, "quiet_v030");
    await service.sendMessage({ ownerId: owner, chatId: chat.id,
      text: "난 여기 있을래", clientRequestId: rid(), admin: false });
    const result = await service.sendMessage({ ownerId: owner, chatId: chat.id,
      text: "(나는 조용히 앉아 있다.)", clientRequestId: rid(), admin: true });
    expect(llm.prompts).toHaveLength(3);
    expect(result.assistantMessage.body).toBe("(복도엔 사야카의 모습이 보이지 않는다.)");
    expect(result.diagnostics?.firstAttemptIssues.map((x) => x.code)).toContain("offscreen_spoiler");
    const messages = await repo.getMessages(chat.id);
    expect(messages.some((m) => m.body.includes("빵을 골라 계산한다"))).toBe(false);
  });
});
