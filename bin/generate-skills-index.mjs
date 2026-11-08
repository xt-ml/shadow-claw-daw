import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const localCli = "/packages/xt-ml/shadow-claw/bin/cli.mjs";
const cliCmd = existsSync(localCli) ? `node "${localCli}"` : "npx shadow-claw";

execSync(`${cliCmd} skills:index`, {
  cwd: ROOT_DIR,
  stdio: "inherit",
});
