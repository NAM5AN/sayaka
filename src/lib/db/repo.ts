import { randomUUID } from "node:crypto";
import type { Db, Queryable } from "./index";
import type { AuthStore, PasswordRecord, Role } from "../auth";
import type {
  Disclosure,
  HistoryMessage,
  MemoryEntry,
  RelationshipState,
  SceneState,
  Segment,
} from "../engine/types";

export interface ChatRow {
  id: string;
  owner_id: string;
  title: string;
  opening_id: string;
  character_version: string;
  prompt_version: string;
  turn_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface MessageRow {
  id: string;
  chat_id: string;
  seq: number;
  role: "user" | "assistant";
  source: "user" | "opening" | "model" | "stub";
  body: string;
  segments: Segment[] | null;
  client_request_id: string | null;
  reply_to: string | null;
  turn_index: number;
  created_at: Date;
}

export interface MessageDto {
  id: string;
  role: "user" | "assistant";
  source: MessageRow["source"];
  body: string;
  segments: Segment[] | null;
  createdAt: string;
}

export interface ChatSummaryDto {
  id: string;
  title: string;
  openingId: string;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

export function toMessageDto(m: MessageRow): MessageDto {
  return { id: m.id, role: m.role, source: m.source, body: m.body, segments: m.segments, createdAt: iso(m.created_at) };
}

export function toChatDto(c: ChatRow): ChatSummaryDto {
  return {
    id: c.id,
    title: c.title,
    openingId: c.opening_id,
    turnCount: c.turn_count,
    createdAt: iso(c.created_at),
    updatedAt: iso(c.updated_at),
  };
}

export class Repo implements AuthStore {
  constructor(private readonly db: Db) {}

  // ───────── 사이트 설정 (비밀번호 해시·세션 세대) ─────────

  async getSetting<T>(key: string): Promise<T | null> {
    const r = await this.db.query<{ value: T }>(`SELECT value FROM sayaka.app_settings WHERE key=$1`, [key]);
    return r.rows[0]?.value ?? null;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.query(
      `INSERT INTO sayaka.app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }

  getPassword(role: Role): Promise<PasswordRecord | null> {
    return this.getSetting<PasswordRecord>(`password.${role}`);
  }

  setPassword(role: Role, rec: PasswordRecord): Promise<void> {
    return this.setSetting(`password.${role}`, rec);
  }

  async getEpoch(): Promise<number> {
    const v = await this.getSetting<{ n: number }>("session.epoch");
    return typeof v?.n === "number" ? v.n : 0;
  }

  async bumpEpoch(): Promise<number> {
    const r = await this.db.query<{ value: { n: number } }>(
      `INSERT INTO sayaka.app_settings (key, value, updated_at) VALUES ('session.epoch', '{"n":1}'::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = jsonb_build_object('n', COALESCE((sayaka.app_settings.value->>'n')::int, 0) + 1), updated_at = now()
       RETURNING value`,
    );
    return Number(r.rows[0]?.value?.n ?? 1);
  }

  async createChat(params: {
    ownerId: string;
    title: string;
    openingId: string;
    characterVersion: string;
    promptVersion: string;
    openingSegments: Segment[];
    openingBody: string;
    scene: SceneState;
    relationship: RelationshipState;
  }): Promise<{ chat: ChatRow; messages: MessageRow[] }> {
    const id = randomUUID();
    return this.db.tx(async (q) => {
      const chat = (
        await q.query<ChatRow>(
          `INSERT INTO sayaka.chats (id, owner_id, title, opening_id, character_version, prompt_version)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [id, params.ownerId, params.title, params.openingId, params.characterVersion, params.promptVersion],
        )
      ).rows[0];
      const msg = (
        await q.query<MessageRow>(
          `INSERT INTO sayaka.messages (id, chat_id, seq, role, source, body, segments, turn_index)
           VALUES ($1,$2,1,'assistant','opening',$3,$4::jsonb,0) RETURNING *`,
          [randomUUID(), id, params.openingBody, JSON.stringify(params.openingSegments)],
        )
      ).rows[0];
      await q.query(`INSERT INTO sayaka.scene_states (chat_id, version, state) VALUES ($1,$2,$3::jsonb)`, [
        id,
        params.scene.version,
        JSON.stringify(params.scene),
      ]);
      await this.writeRelationship(q, id, params.relationship, true);
      return { chat, messages: [msg] };
    });
  }

  private async writeRelationship(q: Queryable, chatId: string, r: RelationshipState, insert: boolean) {
    const vals = [
      chatId,
      r.wariness,
      r.curiosity,
      r.annoyance,
      r.trust,
      r.stage,
      r.user_name,
      r.last_trust_up_turn,
      r.last_wariness_down_turn,
      JSON.stringify(r.history),
    ];
    if (insert) {
      await q.query(
        `INSERT INTO sayaka.relationship_states
          (chat_id, wariness, curiosity, annoyance, trust, stage, user_name, last_trust_up_turn, last_wariness_down_turn, history)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        vals,
      );
    } else {
      await q.query(
        `UPDATE sayaka.relationship_states SET wariness=$2, curiosity=$3, annoyance=$4, trust=$5, stage=$6, user_name=$7,
           last_trust_up_turn=$8, last_wariness_down_turn=$9, history=$10::jsonb, updated_at=now()
         WHERE chat_id=$1`,
        vals,
      );
    }
  }

  async listChats(ownerId: string): Promise<ChatRow[]> {
    return (
      await this.db.query<ChatRow>(`SELECT * FROM sayaka.chats WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 200`, [ownerId])
    ).rows;
  }

  async getChat(ownerId: string, chatId: string): Promise<ChatRow | null> {
    if (!isUuid(chatId)) return null;
    const r = await this.db.query<ChatRow>(`SELECT * FROM sayaka.chats WHERE id=$1 AND owner_id=$2`, [chatId, ownerId]);
    return r.rows[0] ?? null;
  }

  /** Read only the caller-owned room's time option; all legacy rooms default to OFF. */
  async getRealTimeEnabled(ownerId: string, chatId: string): Promise<boolean | null> {
    if (!isUuid(chatId)) return null;
    const r = await this.db.query<{ enabled: boolean }>(
      `SELECT COALESCE((s.state->'real_time'->>'enabled')::boolean, false) AS enabled
       FROM sayaka.chats c
       JOIN sayaka.scene_states s ON s.chat_id=c.id
       WHERE c.id=$1 AND c.owner_id=$2`,
      [chatId, ownerId],
    );
    return r.rows[0]?.enabled ?? null;
  }

  /**
   * Toggle only the owner-owned room, atomically with scene JSON.
   * Running turns hold a lease; do not allow settings writes that might be
   * overwritten by a long-running generation commit.
   */
  async setRealTimeEnabled(
    ownerId: string, chatId: string, enabled: boolean,
  ): Promise<"ok" | "not_found" | "busy"> {
    if (!isUuid(chatId)) return "not_found";
    return this.db.tx(async (q) => {
      const locked = await q.query<{ lease_until: Date | string | null }>(
        `SELECT lease_until FROM sayaka.chats WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
        [chatId, ownerId],
      );
      if (!locked.rows.length) return "not_found";
      const lease = locked.rows[0].lease_until;
      if (lease && new Date(lease).getTime() > Date.now()) return "busy";
      const current = await q.query<{ state: SceneState }>(
        `SELECT state FROM sayaka.scene_states WHERE chat_id=$1 FOR UPDATE`,
        [chatId],
      );
      if (!current.rows.length) return "not_found";
      const scene = current.rows[0].state;
      if ((scene.real_time?.enabled ?? false) === enabled) return "ok";
      scene.real_time = {
        enabled,
        anchor_at: enabled ? new Date().toISOString() : null,
      };
      await q.query(
        `UPDATE sayaka.scene_states SET state=$2::jsonb, updated_at=now() WHERE chat_id=$1`,
        [chatId, JSON.stringify(scene)],
      );
      return "ok";
    });
  }

  async getMessages(chatId: string): Promise<MessageRow[]> {
    return (await this.db.query<MessageRow>(`SELECT * FROM sayaka.messages WHERE chat_id=$1 ORDER BY seq ASC`, [chatId])).rows;
  }

  async deleteChat(ownerId: string, chatId: string): Promise<boolean> {
    if (!isUuid(chatId)) return false;
    return this.db.tx(async (q) => {
      const own = await q.query<{ id: string }>(`SELECT id FROM sayaka.chats WHERE id=$1 AND owner_id=$2`, [chatId, ownerId]);
      if (!own.rows.length) return false;
      // 로그에는 원문이 없지만, 대화방 파생 진단은 지우고 사용량 계산용 숫자만 남긴다
      await q.query(`UPDATE sayaka.generation_logs SET chat_id=NULL, message_id=NULL, diagnostics=NULL, request_id=NULL WHERE chat_id=$1`, [chatId]);
      await q.query(`DELETE FROM sayaka.chats WHERE id=$1 AND owner_id=$2`, [chatId, ownerId]);
      return true;
    });
  }

  async deleteAllChats(ownerId: string): Promise<number> {
    return this.db.tx(async (q) => {
      await q.query(
        `UPDATE sayaka.generation_logs SET chat_id=NULL, message_id=NULL, diagnostics=NULL, request_id=NULL
         WHERE chat_id IN (SELECT id FROM sayaka.chats WHERE owner_id=$1)`,
        [ownerId],
      );
      const r = await q.query<{ id: string }>(`DELETE FROM sayaka.chats WHERE owner_id=$1 RETURNING id`, [ownerId]);
      return r.rows.length;
    });
  }

  async findByRequestId(chatId: string, clientRequestId: string): Promise<{ user: MessageRow; reply: MessageRow | null } | null> {
    const u = await this.db.query<MessageRow>(
      `SELECT * FROM sayaka.messages WHERE chat_id=$1 AND client_request_id=$2 AND role='user'`,
      [chatId, clientRequestId],
    );
    const user = u.rows[0];
    if (!user) return null;
    const a = await this.db.query<MessageRow>(`SELECT * FROM sayaka.messages WHERE reply_to=$1`, [user.id]);
    return { user, reply: a.rows[0] ?? null };
  }

  /** 대화방 단위 임대(동시 전송 방지). 성공 시 true */
  async acquireLease(ownerId: string, chatId: string, seconds: number): Promise<boolean> {
    const r = await this.db.query<{ id: string }>(
      `UPDATE sayaka.chats SET lease_until = now() + make_interval(secs => $3::int)
       WHERE id=$1 AND owner_id=$2 AND (lease_until IS NULL OR lease_until < now()) RETURNING id`,
      [chatId, ownerId, seconds],
    );
    return r.rows.length > 0;
  }

  async releaseLease(chatId: string): Promise<void> {
    await this.db.query(`UPDATE sayaka.chats SET lease_until=NULL WHERE id=$1`, [chatId]);
  }

  async countGenerations(ownerId: string, seconds: number): Promise<number> {
    const r = await this.db.query<{ n: string | number }>(
      `SELECT count(*) AS n FROM sayaka.generation_logs WHERE owner_id=$1 AND created_at > now() - make_interval(secs => $2::int)`,
      [ownerId, seconds],
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  async loadState(chatId: string): Promise<{
    scene: SceneState;
    relationship: RelationshipState;
    memories: MemoryEntry[];
    disclosures: Disclosure[];
    history: HistoryMessage[];
  }> {
    const [s, r, m, d, h] = await Promise.all([
      this.db.query<{ state: SceneState }>(`SELECT state FROM sayaka.scene_states WHERE chat_id=$1`, [chatId]),
      this.db.query<RelationshipState & { chat_id: string }>(`SELECT * FROM sayaka.relationship_states WHERE chat_id=$1`, [chatId]),
      this.db.query<MemoryEntry>(
        `SELECT id, kind, target, value, text, turn_index, active FROM sayaka.memory_entries WHERE chat_id=$1 ORDER BY turn_index ASC, created_at ASC`,
        [chatId],
      ),
      this.db.query<Disclosure>(`SELECT lore_id, turn_index FROM sayaka.disclosures WHERE chat_id=$1`, [chatId]),
      this.db.query<MessageRow>(`SELECT * FROM sayaka.messages WHERE chat_id=$1 ORDER BY seq ASC`, [chatId]),
    ]);
    const rel = r.rows[0];
    if (!s.rows[0] || !rel) throw new Error("대화방 상태가 없음");
    return {
      scene: s.rows[0].state,
      relationship: {
        wariness: rel.wariness,
        curiosity: rel.curiosity,
        annoyance: rel.annoyance,
        trust: rel.trust,
        stage: rel.stage,
        user_name: rel.user_name,
        last_trust_up_turn: rel.last_trust_up_turn,
        last_wariness_down_turn: rel.last_wariness_down_turn,
        history: rel.history ?? [],
      },
      memories: m.rows,
      disclosures: d.rows,
      history: h.rows.map((x) => ({ role: x.role, source: x.source, body: x.body, segments: x.segments, turn_index: x.turn_index })),
    };
  }

  async commitTurn(params: {
    chatId: string;
    turnIndex: number;
    userText: string;
    clientRequestId: string;
    reply: { body: string; segments: Segment[]; source: "model" | "stub" };
    scene: SceneState;
    relationship: RelationshipState;
    newMemories: { kind: string; target: string; value: string; text: string }[];
    deactivateMemoryIds: string[];
    newDisclosures: string[];
    titleIfFirst: string | null;
    log: GenerationLogInput;
  }): Promise<{ user: MessageRow; reply: MessageRow }> {
    return this.db.tx(async (q) => {
      const seqRow = await q.query<{ s: number | null }>(`SELECT max(seq) AS s FROM sayaka.messages WHERE chat_id=$1`, [params.chatId]);
      const seq = Number(seqRow.rows[0]?.s ?? 0) + 1;
      const user = (
        await q.query<MessageRow>(
          `INSERT INTO sayaka.messages (id, chat_id, seq, role, source, body, segments, client_request_id, turn_index)
           VALUES ($1,$2,$3,'user','user',$4,NULL,$5,$6) RETURNING *`,
          [randomUUID(), params.chatId, seq, params.userText, params.clientRequestId, params.turnIndex],
        )
      ).rows[0];
      const reply = (
        await q.query<MessageRow>(
          `INSERT INTO sayaka.messages (id, chat_id, seq, role, source, body, segments, reply_to, turn_index)
           VALUES ($1,$2,$3,'assistant',$4,$5,$6::jsonb,$7,$8) RETURNING *`,
          [randomUUID(), params.chatId, seq + 1, params.reply.source, params.reply.body, JSON.stringify(params.reply.segments), user.id, params.turnIndex],
        )
      ).rows[0];
      await q.query(`UPDATE sayaka.scene_states SET version=$2, state=$3::jsonb, updated_at=now() WHERE chat_id=$1`, [
        params.chatId,
        params.scene.version,
        JSON.stringify(params.scene),
      ]);
      await this.writeRelationship(q, params.chatId, params.relationship, false);
      for (const mem of params.newMemories) {
        await q.query(
          `INSERT INTO sayaka.memory_entries (id, chat_id, kind, target, value, text, source_message_id, turn_index)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [randomUUID(), params.chatId, mem.kind, mem.target, mem.value, mem.text, reply.id, params.turnIndex],
        );
      }
      for (const id of params.deactivateMemoryIds) {
        await q.query(`UPDATE sayaka.memory_entries SET active=false WHERE id=$1 AND chat_id=$2`, [id, params.chatId]);
      }
      for (const loreId of params.newDisclosures) {
        await q.query(
          `INSERT INTO sayaka.disclosures (chat_id, lore_id, message_id, turn_index) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [params.chatId, loreId, reply.id, params.turnIndex],
        );
      }
      if (params.titleIfFirst) {
        await q.query(`UPDATE sayaka.chats SET title=$2 WHERE id=$1`, [params.chatId, params.titleIfFirst]);
      }
      await q.query(`UPDATE sayaka.chats SET turn_count=$2, updated_at=now() WHERE id=$1`, [params.chatId, params.turnIndex]);
      await insertLog(q, { ...params.log, messageId: reply.id });
      return { user, reply };
    });
  }

  async logGeneration(log: GenerationLogInput): Promise<void> {
    await insertLog(this.db, log);
  }

  async diagnosticsFor(chatId: string): Promise<Record<string, unknown>> {
    const r = await this.db.query<{ message_id: string; diagnostics: unknown; latency_ms: number; attempts: number; input_tokens: number | null; output_tokens: number | null; cached_tokens: number | null; model: string }>(
      `SELECT message_id, diagnostics, latency_ms, attempts, input_tokens, output_tokens, cached_tokens, model
       FROM sayaka.generation_logs WHERE chat_id=$1 AND message_id IS NOT NULL`,
      [chatId],
    );
    const out: Record<string, unknown> = {};
    for (const row of r.rows) {
      out[row.message_id] = {
        ...(row.diagnostics as object),
        latencyMs: row.latency_ms,
        attempts: row.attempts,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cachedTokens: row.cached_tokens,
        model: row.model,
      };
    }
    return out;
  }
}

export interface GenerationLogInput {
  ownerId: string;
  chatId: string | null;
  messageId?: string | null;
  requestId: string | null;
  status: "ok" | "error" | "blocked" | "safety";
  errorCode?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  attempts: number;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
  diagnostics?: unknown;
}

async function insertLog(q: Queryable, l: GenerationLogInput) {
  await q.query(
    `INSERT INTO sayaka.generation_logs
      (id, owner_id, chat_id, message_id, request_id, status, error_code, model, prompt_version, attempts, latency_ms, input_tokens, output_tokens, cached_tokens, diagnostics)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
    [
      randomUUID(),
      l.ownerId,
      l.chatId,
      l.messageId ?? null,
      l.requestId,
      l.status,
      l.errorCode ?? null,
      l.model ?? null,
      l.promptVersion ?? null,
      l.attempts,
      l.latencyMs ?? null,
      l.inputTokens ?? null,
      l.outputTokens ?? null,
      l.cachedTokens ?? null,
      l.diagnostics === undefined ? null : JSON.stringify(l.diagnostics),
    ],
  );
}

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
