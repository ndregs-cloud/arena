import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  // `server-only` sengaja melempar di luar runtime Next; di test cukup modul kosong.
  "server-only": fileURLToPath(new URL("./tests/helpers/noop-module.ts", import.meta.url)),
};

/**
 * Piramida testing mengikuti Blueprint §17.1.
 * - unit: pricing, kupon, rounding, transisi order, stok, cap refund, RBAC.
 * - integration: Postgres nyata (pglite) - migration, constraint, transaksi stok, webhook dedup, IDOR.
 * - components: state komponen, aksesibilitas (axe-core), format IDR.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    reporters: process.env.CI ? ["default"] : ["dot"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          // pg-lite boot + migration butuh waktu pada cold run.
          fileParallelism: false,
          maxWorkers: 2,
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          include: ["tests/components/**/*.test.tsx"],
        },
      },
    ],
  },
});
