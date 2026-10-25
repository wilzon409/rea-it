#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createProvider } from "./providers.js";
import { Router } from "./router.js";
import { fixUntilGreen } from "./agent.js";

const [, , cmd, ...rest] = process.argv;
const flag = (n, d) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest[i + 1] : d;
};

if (cmd !== "fix") {
  console.log(`Usage: rea fix --goal "<what to build>" --verify "<cmd>" [--cwd dir] [--config rea.config.json] [--max 15]`);
  process.exit(cmd ? 1 : 0);
}

const goal = flag("goal");
const verify = flag("verify");
if (!goal || !verify) {
  console.error("--goal and --verify are required");
  process.exit(1);
}

const config = JSON.parse(await readFile(flag("config", "rea.config.json"), "utf8"));
const router = new Router(config.providers.map(createProvider), {
  cooldownMs: config.cooldownMs,
  log: (m) => console.error(m),
});

try {
  const res = await fixUntilGreen({
    router,
    goal,
    verify,
    cwd: flag("cwd", "."),
    maxIterations: Number(flag("max", 15)),
  });
  console.log(JSON.stringify(res));
  process.exit(res.ok ? 0 : 2);
} catch (err) {
  console.error(err.message);
  process.exit(3);
}
