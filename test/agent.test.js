import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Router, AllProvidersExhausted } from "../src/router.js";
import { fixUntilGreen, safeResolve } from "../src/agent.js";

const fake = (name, fn, budget) => ({ name, budget, chat: fn });

test("fails over when budget is spent or provider errors", async () => {
  const a = fake("a", async () => ({ text: "A", usage: 100 }), 100);
  const b = fake("b", async () => { throw new Error("429"); });
  const c = fake("c", async () => ({ text: "C", usage: 1 }));
  const r = new Router([a, b, c]);
  assert.equal((await r.chat([])).provider, "a");
  assert.equal((await r.chat([])).provider, "c");
  assert.deepEqual(r.usage(), { a: 100, b: 0, c: 1 });
});

test("throws when nothing is available", async () => {
  const r = new Router([{ name: "x", unavailable: "missing env", chat: async () => ({}) }]);
  await assert.rejects(() => r.chat([]), AllProvidersExhausted);
});

test("rejects path traversal", () => {
  assert.throws(() => safeResolve("/tmp/proj", "../evil"));
  assert.throws(() => safeResolve("/tmp/proj", "/tmp/proj-other/x"));
});

test("fix loop repairs a failing project, continuing on the next provider", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rea-"));
  await writeFile(path.join(dir, "check.mjs"), "import m from './v.mjs'; process.exit(m === 1 ? 0 : 1);");
  await writeFile(path.join(dir, "v.mjs"), "export default 0;\n");
  const fix = JSON.stringify({ summary: "set 1", files: [{ path: "v.mjs", content: "export default 1;\n" }] });
  const dead = fake("dead", async () => { throw new Error("quota"); });
  const good = fake("good", async () => ({ text: "```json\n" + fix + "\n```", usage: 5 }));
  const res = await fixUntilGreen({
    router: new Router([dead, good]), goal: "make v 1", cwd: dir,
    verify: "node check.mjs", log: () => {},
  });
  assert.equal(res.ok, true);
  assert.equal(await readFile(path.join(dir, "v.mjs"), "utf8"), "export default 1;\n");
});
