/**
 * db/schema.sql 생성: `npm run db:sql`
 * Supabase SQL Editor 등에 그대로 붙여 넣을 수 있는 사본. 원본은 src/lib/db/migrations.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS, MIGRATION_TABLE_SQL } from "../src/lib/db/migrations";

export function schemaSql(): string {
  const header = `-- sayaka-chat DB 스키마 (자동 생성: npm run db:sql)\n-- 원본: src/lib/db/migrations.ts — 이 파일을 직접 고치지 마세요.\n-- 앱이 첫 요청 때 같은 내용을 자동 적용하므로 보통은 실행할 필요가 없어요.\n`;
  const body = [MIGRATION_TABLE_SQL.trim(), ...MIGRATIONS.map((m) => `-- ${m.version}\n${m.sql.trim()}\nINSERT INTO sayaka.schema_migrations (version) VALUES ('${m.version}') ON CONFLICT DO NOTHING;`)];
  return `${header}\nBEGIN;\n\n${body.join("\n\n")}\n\nCOMMIT;\n`;
}

if (process.argv[1] && process.argv[1].endsWith("write-schema-sql.ts")) {
  const out = path.join(__dirname, "..", "db", "schema.sql");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, schemaSql());
  console.log(`작성: ${out}`);
}
