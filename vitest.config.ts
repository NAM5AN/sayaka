import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@data": path.resolve(__dirname, "data"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // PGlite 인스턴스를 테스트 파일마다 따로 띄우므로 파일 단위 병렬은 유지하되 과도한 동시성은 제한
    maxWorkers: 2,
  },
});
