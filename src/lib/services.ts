import { loadConfig, aiStatus, type AppConfig } from "./config";
import { createDbFromConfig, migrate, type Db } from "./db";
import { Repo } from "./db/repo";
import { SayakaService } from "./engine/orchestrator";
import { createOpenAiClient, createStubClient, type LlmClient } from "./engine/llm";
import { createModerator } from "./engine/safety";

/**
 * 프로세스 단위 싱글턴. 서버리스 인스턴스마다 한 번 DB 연결·마이그레이션을 한다.
 * 테스트에서는 setServicesForTest 로 교체한다.
 */
interface Services {
  cfg: AppConfig;
  db: Db;
  service: SayakaService;
}

const g = globalThis as unknown as { __sayakaServices?: Promise<Services> };

export function getServices(): Promise<Services> {
  if (!g.__sayakaServices) {
    g.__sayakaServices = init().catch((e) => {
      g.__sayakaServices = undefined;
      throw e;
    });
  }
  return g.__sayakaServices;
}

async function init(): Promise<Services> {
  const cfg = loadConfig();
  const db = await createDbFromConfig(cfg);
  await migrate(db);
  let llm: LlmClient | null = null;
  const status = aiStatus(cfg);
  if (status === "stub") llm = createStubClient();
  else if (status === "openai") llm = createOpenAiClient(cfg);
  const service = new SayakaService({ repo: new Repo(db), cfg, llm, moderator: createModerator(cfg) });
  return { cfg, db, service };
}

export function setServicesForTest(s: Services | undefined): void {
  g.__sayakaServices = s ? Promise.resolve(s) : undefined;
}
