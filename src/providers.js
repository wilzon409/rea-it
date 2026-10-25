// Provider adapters. Each exposes: name, chat(messages) -> { text, usage }.
// "openai" type covers OpenAI, xAI Grok, OpenRouter, Ollama, LM Studio, llama.cpp, vLLM.

export class ProviderError extends Error {
  constructor(message, { status, retryable = true } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

async function post(url, headers, body, timeoutMs) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ProviderError(`network error: ${err.message}`);
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    // Other 4xx codes are request bugs; switching provider will not help.
    const retryable = [401, 402, 403, 408, 429].includes(res.status) || res.status >= 500;
    throw new ProviderError(`HTTP ${res.status}: ${detail}`, { status: res.status, retryable });
  }
  return res.json();
}

function openaiCompatible(cfg) {
  const key = cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : undefined;
  return {
    async chat(messages) {
      const data = await post(
        `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`,
        key ? { authorization: `Bearer ${key}` } : {},
        { model: cfg.model, messages, temperature: cfg.temperature ?? 0.2 },
        cfg.timeoutMs ?? 120000,
      );
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new ProviderError("empty response");
      const u = data.usage ?? {};
      return { text, usage: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0) };
    },
  };
}

function anthropic(cfg) {
  return {
    async chat(messages) {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
      const data = await post(
        `${(cfg.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`,
        { "x-api-key": process.env[cfg.apiKeyEnv] ?? "", "anthropic-version": "2023-06-01" },
        {
          model: cfg.model,
          max_tokens: cfg.maxOutputTokens ?? 8192,
          system,
          messages: messages.filter((m) => m.role !== "system"),
        },
        cfg.timeoutMs ?? 120000,
      );
      const text = data.content?.map((c) => c.text ?? "").join("");
      if (!text) throw new ProviderError("empty response");
      const u = data.usage ?? {};
      return { text, usage: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) };
    },
  };
}

export function createProvider(cfg) {
  const impl =
    cfg.type === "anthropic" ? anthropic(cfg) : cfg.type === "openai" ? openaiCompatible(cfg) : null;
  if (!impl) throw new Error(`Unknown provider type "${cfg.type}" for "${cfg.name}"`);
  const unavailable =
    cfg.apiKeyEnv && !process.env[cfg.apiKeyEnv] ? `missing env ${cfg.apiKeyEnv}` : undefined;
  return { name: cfg.name, budget: cfg.tokenBudget, unavailable, chat: impl.chat };
}
