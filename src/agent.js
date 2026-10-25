import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const SYSTEM = `You are an autonomous build-fixing engineer. You get a goal, a project file listing,
and the output of the failing verify command. Reply with ONLY a JSON object:
{"summary": string, "files": [{"path": string, "content": string}]}
Each file is written in full (relative path, no ".."). Return an empty "files" array only if no change can help.`;

export function runCommand(cmd, cwd, timeoutMs = 600000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true });
    let out = "";
    const add = (d) => {
      out += d;
      if (out.length > 200000) out = out.slice(-100000);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output: out });
    });
  });
}

async function listFiles(root, dir = root, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "build"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await listFiles(root, full, acc);
    else acc.push(path.relative(root, full));
  }
  return acc;
}

export function parseEdits(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("model did not return JSON");
  const obj = JSON.parse(match[0]);
  if (!Array.isArray(obj.files)) throw new Error("missing files array");
  return obj;
}

// Writes are confined to the project directory.
export function safeResolve(root, rel) {
  const base = path.resolve(root);
  const abs = path.resolve(base, rel);
  if (!abs.startsWith(base + path.sep)) throw new Error(`path escapes project: ${rel}`);
  return abs;
}

async function relevantContext(root, files, output) {
  const mentioned = files.filter((f) => output.includes(f)).slice(0, 8);
  const parts = [];
  for (const f of mentioned) {
    const body = await readFile(path.join(root, f), "utf8").catch(() => "");
    parts.push(`--- ${f}\n${body.slice(0, 12000)}`);
  }
  return parts.join("\n\n");
}

export async function fixUntilGreen({ router, goal, cwd, verify, maxIterations = 15, log = console.log }) {
  const root = path.resolve(cwd);
  const messages = [{ role: "system", content: SYSTEM }];
  for (let i = 1; i <= maxIterations; i++) {
    const result = await runCommand(verify, root);
    if (result.ok) {
      log(`verify passed after ${i - 1} fix round(s)`);
      return { ok: true, iterations: i - 1, usage: router.usage() };
    }
    const files = await listFiles(root);
    const context = await relevantContext(root, files, result.output);
    messages.push({
      role: "user",
      content: `Goal: ${goal}\n\nFiles:\n${files.join("\n")}\n\nVerify command \`${verify}\` failed:\n${result.output.slice(-8000)}\n\n${context}`,
    });
    const reply = await router.chat(messages);
    messages.push({ role: "assistant", content: reply.text });
    let edits;
    try {
      edits = parseEdits(reply.text);
    } catch (err) {
      messages.push({ role: "user", content: `Invalid reply (${err.message}). Return only the JSON object.` });
      continue;
    }
    log(`[${reply.provider}] round ${i}: ${edits.summary ?? ""} (${edits.files.length} file(s))`);
    for (const f of edits.files) {
      const abs = safeResolve(root, f.path);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, f.content);
    }
  }
  return { ok: false, iterations: maxIterations, usage: router.usage() };
}
