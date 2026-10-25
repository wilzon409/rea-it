// Ordered failover across providers. When a provider's token budget is spent,
// or it fails with a rate/quota/auth/server error, the next one takes over
// with the same conversation so the work continues uninterrupted.

export class AllProvidersExhausted extends Error {}

export class Router {
  constructor(providers, { cooldownMs = 60000, log = () => {} } = {}) {
    this.providers = providers.map((p) => ({ p, used: 0, downUntil: 0 }));
    this.cooldownMs = cooldownMs;
    this.log = log;
  }

  usage() {
    return Object.fromEntries(this.providers.map(({ p, used }) => [p.name, used]));
  }

  available({ p, used, downUntil }) {
    if (p.unavailable) return false;
    if (p.budget != null && used >= p.budget) return false;
    return Date.now() >= downUntil;
  }

  async chat(messages) {
    const errors = [];
    for (const entry of this.providers) {
      if (!this.available(entry)) continue;
      try {
        const res = await entry.p.chat(messages);
        entry.used += res.usage ?? 0;
        return { ...res, provider: entry.p.name };
      } catch (err) {
        errors.push(`${entry.p.name}: ${err.message}`);
        if (err.retryable === false) throw err;
        entry.downUntil = Date.now() + this.cooldownMs;
        this.log(`provider ${entry.p.name} failed, switching (${err.message})`);
      }
    }
    const skipped = this.providers.filter((e) => e.p.unavailable).map((e) => `${e.p.name}: ${e.p.unavailable}`);
    throw new AllProvidersExhausted(
      `No provider could answer. ${[...errors, ...skipped].join("; ") || "all budgets spent or cooling down"}`,
    );
  }
}
