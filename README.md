# rea-it

An open-source autonomous build-and-fix agent. It runs your verify command (build/tests), asks an LLM for fixes, applies them, and repeats until the command passes. When one model's token budget runs out or its API fails (rate limit, quota, auth, 5xx), the next provider takes over with the same conversation. Cloud APIs (xAI Grok, Anthropic, OpenAI, OpenRouter) and local models (Ollama, LM Studio, llama.cpp, vLLM) are interchangeable.

## Usage

```sh
cp rea.config.example.json rea.config.json   # order = failover priority
export XAI_API_KEY=... ANTHROPIC_API_KEY=...
node src/cli.js fix --goal "app builds and tests pass" --verify "npm test" --cwd ./my-app
```

Providers whose API key isn't set are skipped; local providers need no key. `tokenBudget` caps a provider before switching. Exit codes: 0 fixed, 2 gave up after `--max` rounds, 3 no provider available.

File writes are confined to `--cwd`. The verify command runs in a shell, so only use it on projects you trust.

## Tests

```sh
npm test
```

## Prior art

Original code, informed by the design of permissively licensed projects: [elie222/rakazo](https://github.com/elie222/rakazo) (Apache-2.0, bring-your-own-model agents), [milind-soni/OpenMausBot](https://github.com/milind-soni/OpenMausBot) (Apache-2.0), [Waishnav/devspace](https://github.com/Waishnav/devspace) (MIT, coding-agent harness) and [stablyai/orca](https://github.com/stablyai/orca) (MIT, agent fleets). No code was copied or decompiled; unlicensed reconstructions of proprietary software are deliberately excluded.

