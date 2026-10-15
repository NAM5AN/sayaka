import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { schemaSql } from "../../scripts/write-schema-sql";
import { MIGRATIONS, MIGRATION_TABLE_SQL } from "@/lib/db/migrations";
import { splitSql } from "@/lib/db";

describe("DB 스키마 파일", () => {
  it("db/schema.sql 이 마이그레이션 원본과 같다 (npm run db:sql 로 갱신)", () => {
    const file = fs.readFileSync(path.join(__dirname, "..", "..", "db", "schema.sql"), "utf8");
    expect(file).toBe(schemaSql());
  });

  it("모든 테이블은 sayaka 스키마에 있고 RLS 가 켜져 있다", () => {
    const all = [MIGRATION_TABLE_SQL, ...MIGRATIONS.map((m) => m.sql)].join("\n");
    const tables = [...all.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_.]+)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(5);
    for (const t of tables) {
      expect(t.startsWith("sayaka."), t).toBe(true);
      expect(all, t).toContain(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
    }
  });

  it("SQL 분리기는 주석 줄을 지우고 빈 문장을 만들지 않는다", () => {
    const parts = splitSql("-- 주석\nSELECT 1;\n\n-- x\nSELECT 2;\n");
    expect(parts).toEqual(["SELECT 1", "SELECT 2"]);
  });
});
