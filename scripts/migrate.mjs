import { loadEnv, openDb, migrate } from "./db-lib.mjs";

const env = { ...(await loadEnv()), ...process.env };
const db = await openDb({
  driver: env.DATA_DRIVER ?? "pglite",
  databaseUrl: env.DATABASE_URL,
  pgliteDir: env.PGLITE_DIR ?? ".data/pglite",
});
console.log(
  `ndre.gstore migration - driver=${db.driver}${db.target ? ` target=${db.target}` : ""}`,
);
let count = 0;
try {
  count = await migrate(db);
} catch (error) {
  const msg = String(error?.message ?? error)
    .split("\n")
    .slice(0, 6)
    .join("\n");
  console.error("MIGRATION GAGAL:\n" + msg);
  await db.close();
  process.exit(1);
}
console.log(`Selesai: ${count} migration diterapkan.`);
await db.close();
