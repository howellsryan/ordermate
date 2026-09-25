import { spawnSync } from "node:child_process";

const run = (args) => {
  const result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["wrangler@latest", ...args], {
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

console.log("OrderMate Cloudflare bootstrap");
console.log("1) Creating EU-jurisdiction control-plane D1 database through Wrangler...");
run(["d1", "create", "ordermate-control", "--jurisdiction", "eu"]);
console.log("\nCopy the generated D1 binding/database_id into CONTROL_DB in wrangler.jsonc if Wrangler did not write it automatically.");
console.log("\n2) Creating EU-jurisdiction R2 bucket through Wrangler...");
run(["r2", "bucket", "create", "ordermate-documents", "--jurisdiction", "eu"]);
console.log("\n3) Creating event queue through Wrangler...");
run(["queues", "create", "ordermate-events"]);
console.log("\nDurable Object storage is created by `wrangler deploy` from the v1 SQLite migration in wrangler.jsonc.");
