import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["run", "build"], {
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    CLOUDFLARE_ENV: "staging",
  },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
