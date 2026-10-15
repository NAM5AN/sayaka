-- sayaka-chat DB 스키마 (자동 생성: npm run db:sql)
-- 원본: src/lib/db/migrations.ts — 이 파일을 직접 고치지 마세요.
-- 앱이 첫 요청 때 같은 내용을 자동 적용하므로 보통은 실행할 필요가 없어요.

BEGIN;

CREATE SCHEMA IF NOT EXISTS sayaka;
CREATE TABLE IF NOT EXISTS sayaka.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sayaka.schema_migrations ENABLE ROW LEVEL SECURITY;

-- 001_init
CREATE SCHEMA IF NOT EXISTS sayaka;

CREATE TABLE IF NOT EXISTS sayaka.chats (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  title text NOT NULL,
  opening_id text NOT NULL,
  character_version text NOT NULL,
  prompt_version text NOT NULL,
  turn_count integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chats_owner_updated_idx ON sayaka.chats (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS sayaka.messages (
  id uuid PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES sayaka.chats(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  source text NOT NULL CHECK (source IN ('user', 'opening', 'model', 'stub')),
  body text NOT NULL,
  segments jsonb,
  client_request_id text,
  reply_to uuid REFERENCES sayaka.messages(id) ON DELETE CASCADE,
  turn_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id, seq)
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_request_idx
  ON sayaka.messages (chat_id, client_request_id) WHERE client_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sayaka.scene_states (
  chat_id uuid PRIMARY KEY REFERENCES sayaka.chats(id) ON DELETE CASCADE,
  version integer NOT NULL,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sayaka.relationship_states (
  chat_id uuid PRIMARY KEY REFERENCES sayaka.chats(id) ON DELETE CASCADE,
  wariness smallint NOT NULL CHECK (wariness BETWEEN 0 AND 5),
  curiosity smallint NOT NULL CHECK (curiosity BETWEEN 0 AND 5),
  annoyance smallint NOT NULL CHECK (annoyance BETWEEN 0 AND 5),
  trust smallint NOT NULL CHECK (trust BETWEEN 0 AND 5),
  stage text NOT NULL,
  user_name text,
  last_trust_up_turn integer NOT NULL DEFAULT -100,
  last_wariness_down_turn integer NOT NULL DEFAULT -100,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sayaka.memory_entries (
  id uuid PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES sayaka.chats(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('user_claim', 'observed_event', 'sayaka_impression', 'improvised_detail', 'refusal', 'stopped_asking')),
  target text NOT NULL DEFAULT '',
  value text NOT NULL DEFAULT '',
  text text NOT NULL,
  source_message_id uuid REFERENCES sayaka.messages(id) ON DELETE SET NULL,
  turn_index integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  -- 대화방 기억은 구조적으로 전역 캐논이 될 수 없다.
  is_canon boolean NOT NULL DEFAULT false CHECK (is_canon = false),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memory_chat_idx ON sayaka.memory_entries (chat_id, turn_index);

CREATE TABLE IF NOT EXISTS sayaka.disclosures (
  chat_id uuid NOT NULL REFERENCES sayaka.chats(id) ON DELETE CASCADE,
  lore_id text NOT NULL,
  message_id uuid REFERENCES sayaka.messages(id) ON DELETE SET NULL,
  turn_index integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, lore_id)
);

-- 생성 로그: 대화 원문·프롬프트·비밀은 저장하지 않는다. 대화방 삭제 시 chat_id/diagnostics 를 지우고
-- 토큰·상태만 남겨 하루 사용량 한도 계산에 쓴다.
CREATE TABLE IF NOT EXISTS sayaka.generation_logs (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  chat_id uuid REFERENCES sayaka.chats(id) ON DELETE SET NULL,
  message_id uuid REFERENCES sayaka.messages(id) ON DELETE SET NULL,
  request_id text,
  status text NOT NULL CHECK (status IN ('ok', 'error', 'blocked', 'safety')),
  error_code text,
  model text,
  prompt_version text,
  attempts integer NOT NULL DEFAULT 0,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  cached_tokens integer,
  diagnostics jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS genlog_owner_time_idx ON sayaka.generation_logs (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS genlog_message_idx ON sayaka.generation_logs (message_id);

ALTER TABLE sayaka.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE sayaka.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sayaka.scene_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE sayaka.relationship_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE sayaka.memory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sayaka.disclosures ENABLE ROW LEVEL SECURITY;
ALTER TABLE sayaka.generation_logs ENABLE ROW LEVEL SECURITY;
INSERT INTO sayaka.schema_migrations (version) VALUES ('001_init') ON CONFLICT DO NOTHING;

COMMIT;
