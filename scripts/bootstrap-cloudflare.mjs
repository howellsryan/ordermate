import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const run = (args) => {
  const result = spawnSync(npx, ["wrangler", ...args], {
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const assertD1Configured = () => {
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const match = config.match(/"binding"\s*:\s*"CONTROL_DB"[\s\S]*?"database_id"\s*:\s*"([^"]+)"/);
  if (!match || match[1] === "00000000-0000-0000-0000-000000000000") {
    console.error("\nCONTROL_DB was not written to wrangler.jsonc. Refusing to continue with an unbound production database.");
    console.error("Run `npx wrangler d1 list --json`, then set the ordermate-control database_id in wrangler.jsonc before continuing.");
    process.exit(1);
  }
};

console.log("OrderMate Cloudflare bootstrap");
console.log("Using the Wrangler version pinned in this repository.\n");

console.log("1) Creating the EU-jurisdiction control-plane D1 database and writing its CONTROL_DB binding...");
run([
  "d1", "create", "ordermate-control",
  "--jurisdiction", "eu",
  "--binding", "CONTROL_DB",
  "--update-config",
]);
assertD1Configured();

console.log("\n2) Creating the EU-jurisdiction R2 document bucket...");
run(["r2", "bucket", "create", "ordermate-documents", "--jurisdiction", "eu"]);

console.log("\n3) Creating the application event queue...");
run(["queues", "create", "ordermate-events"]);

console.log("\n4) Creating the extraction dead-letter queue...");
run(["queues", "create", "ordermate-events-dead"]);

console.log("\nCloudflare bootstrap complete.");
console.log("Next: apply D1 migrations, configure Wrangler secrets, then deploy. Durable Object storage is created by the v1 SQLite migration during `wrangler deploy`; Workers AI is bound by wrangler.jsonc and needs no separate provider secret.");
