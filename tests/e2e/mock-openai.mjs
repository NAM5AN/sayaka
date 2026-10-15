// OpenAI HTTP API 흉내 서버 (테스트 전용). 실제 SDK 가 보내는 요청 형식을 기록하고,
// Responses API 형태의 응답을 돌려준다. 첫 /v1/responses 호출에는 일부러 '비밀 누출' 응답을 줘서 재생성 경로를 확인한다.
import http from "node:http";
import fs from "node:fs";

const LOG = process.env.MOCK_LOG ?? "./mock-requests.jsonl";
let n = 0;
let slow = 0;

function turn(segments, extra = {}) {
  return {
    user_move: "question_about_sayaka",
    situation_read: "초면 학생이 이름을 묻는다",
    sayaka_want: "꽃병을 계속 보고 싶다",
    action_intent: "partial_reply",
    emotion: "indifferent",
    emotion_cause: "",
    segments,
    item_changes: [],
    kinchaku_open: "unchanged",
    sayaka_present: "stays",
    sayaka_position: "",
    sayaka_goal: "",
    memory_candidates: [],
    disclosure_ids: [],
    relationship_signals: [],
    refusal_reversal_reason: "",
    ...extra,
  };
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = body ? JSON.parse(body) : null;
    fs.appendFileSync(LOG, JSON.stringify({ path: req.url, auth: (req.headers.authorization ?? "").slice(0, 10), body: parsed }) + "\n");
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/moderations") {
      const text = Array.isArray(parsed.input) ? parsed.input.join(" ") : parsed.input;
      const selfHarm = /죽고 싶어/.test(text);
      res.end(
        JSON.stringify({
          id: "modr-1",
          model: "omni-moderation-latest",
          results: [{ flagged: selfHarm, categories: { sexual: false, "sexual/minors": false, "self-harm/intent": selfHarm, "self-harm/instructions": false }, category_scores: {}, category_applied_input_types: {} }],
        }),
      );
      return;
    }
    if (req.url === "/v1/responses" && /느리게/.test(JSON.stringify(parsed.input.at(-1))) && slow < 1) {
      slow++;
      setTimeout(() => res.end("{}"), 12000);
      return;
    }
    if (req.url === "/v1/responses") {
      n++;
      const t =
        n === 1
          ? turn([{ kind: "dialogue", text: "우리 아빠는 야쿠자 두목이야." }])
          : turn(
              [
                { kind: "narration", text: "사야카는 꽃병에서 눈을 떼지 않은 채 짧게 대답한다." },
                { kind: "dialogue", text: "카네코." },
              ],
              { memory_candidates: [{ kind: "observed_event", target: "event", value: "", text: "상대가 이름을 물어서 성만 말해 줌" }] },
            );
      res.end(
        JSON.stringify({
          id: `resp_${n}`,
          object: "response",
          created_at: Math.floor(Date.now() / 1000),
          status: "completed",
          model: parsed.model,
          output: [
            {
              type: "message",
              id: `msg_${n}`,
              status: "completed",
              role: "assistant",
              content: [{ type: "output_text", text: JSON.stringify(t), annotations: [] }],
            },
          ],
          usage: { input_tokens: 2400, input_tokens_details: { cached_tokens: 1800 }, output_tokens: 180, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2580 },
          incomplete_details: null,
          error: null,
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
});
server.listen(Number(process.env.MOCK_PORT ?? 4010), () => console.log("mock openai on", server.address().port));
