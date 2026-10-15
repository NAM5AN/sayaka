/**
 * DB 마이그레이션 수동 실행: `npm run db:migrate`
 * DATABASE_URL 이 있으면 그 DB, 없으면 로컬 내장 DB(.data/pglite)에 적용한다.
 * (앱도 첫 요청 때 자동으로 같은 마이그레이션을 실행한다.)
 */
import { loadConfig } from "../src/lib/config";
import { createDbFromConfig, migrate } from "../src/lib/db";

async function main() {
  const cfg = loadConfig();
  const db = await createDbFromConfig(cfg);
  const applied = await migrate(db);
  console.log(`[${db.kind}] 적용된 마이그레이션: ${applied.length ? applied.join(", ") : "없음(최신 상태)"}`);
  await db.close();
}

main().catch((e) => {
  console.error("마이그레이션 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
