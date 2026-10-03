import { isLocalUrl } from './localUrl.js';

// Any /chat/completions endpoint: OpenAI, OpenRouter, or local servers
// such as LM Studio, KoboldCpp or llama.cpp (those count as local).
class OpenAICompatibleProvider {
  constructor({
    baseUrl = 'https://api.openai.com/v1',
    apiKey = '',
    model,
    retryMaxAttempts = 3,
    retryBaseDelayMs = 1200,
    retryMaxDelayMs = 10000,
    minIntervalMs = 1200,
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}) {
    if (!model) throw new Error('OpenAICompatibleProvider requires a model.');
    this.id = 'openai-compatible';
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.retryMaxAttempts = Math.max(1, Number(retryMaxAttempts) || 1);
    this.retryBaseDelayMs = Math.max(0, Number(retryBaseDelayMs) || 0);
    this.retryMaxDelayMs = Math.max(this.retryBaseDelayMs, Number(retryMaxDelayMs) || 0);
    this.minIntervalMs = Math.max(0, Number(minIntervalMs) || 0);
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.lastRequestAt = 0;
    this.requestChain = Promise.resolve();
  }

  isLocal() {
    return isLocalUrl(this.baseUrl);
  }

  // Local servers usually need no key; hosted ones do.
  isConfigured() {
    return this.isLocal() || !!this.apiKey;
  }

  parseRetryAfterMs(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
    const at = Date.parse(raw);
    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
  }

  getRetryDelayMs(attempt = 1, retryAfterMs = null) {
    const exponential = Math.min(this.retryMaxDelayMs, this.retryBaseDelayMs * (2 ** Math.max(0, attempt - 1)));
    const computed = exponential + Math.floor(Math.random() * 350);
    if (!Number.isFinite(retryAfterMs) || retryAfterMs === null) return computed;
    return Math.max(computed, Math.min(this.retryMaxDelayMs, Math.max(0, retryAfterMs)));
  }

  // Serializes requests and keeps a minimum gap between them (free tiers rate-limit hard).
  enqueue(task) {
    const run = async () => {
      const waitMs = this.minIntervalMs - (Date.now() - this.lastRequestAt);
      if (waitMs > 0) await this.sleep(waitMs);
      this.lastRequestAt = Date.now();
      return task();
    };
    const queued = this.requestChain.then(run, run);
    this.requestChain = queued.then(() => undefined, () => undefined);
    return queued;
  }

  async complete({ messages = [], temperature, topP } = {}) {
    if (!this.isConfigured()) {
      throw new Error('API key missing for the OpenAI-compatible provider.');
    }

    const payload = {
      model: this.model,
      messages,
      ...(Number.isFinite(temperature) ? { temperature } : {}),
      ...(Number.isFinite(topP) ? { top_p: topP } : {}),
    };

    let lastStatus = 0;
    let lastBody = '';
    for (let attempt = 1; attempt <= this.retryMaxAttempts; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const response = await this.enqueue(() => this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
      }));

      if (response.ok) {
        // eslint-disable-next-line no-await-in-loop
        const data = await response.json();
        const text = String(data?.choices?.[0]?.message?.content || '').trim();
        if (!text) throw new Error('LLM returned an empty response.');
        return { text, provider: this.id, model: this.model };
      }

      lastStatus = response.status;
      // eslint-disable-next-line no-await-in-loop
      lastBody = await response.text().catch(() => '');
      const retryable = response.status === 429 || (response.status >= 500 && response.status <= 599);
      if (!retryable || attempt >= this.retryMaxAttempts) break;
      const retryAfterMs = this.parseRetryAfterMs(response.headers?.get?.('retry-after'));
      // eslint-disable-next-line no-await-in-loop
      await this.sleep(this.getRetryDelayMs(attempt, retryAfterMs));
    }

    if (lastStatus === 429) {
      throw new Error('LLM request failed with 429 (rate limited). Please retry in a few seconds.');
    }
    const shortBody = String(lastBody || '').slice(0, 180).trim();
    throw new Error(shortBody ? `LLM request failed with ${lastStatus}: ${shortBody}` : `LLM request failed with ${lastStatus}`);
  }
}

export default OpenAICompatibleProvider;
