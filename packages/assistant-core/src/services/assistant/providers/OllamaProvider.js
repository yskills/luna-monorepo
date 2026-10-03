import { isLocalUrl } from './localUrl.js';

// Talks to Ollama's REST API directly (no SDK), so the host project
// does not need the `ollama` npm package and tests can inject fetch.
class OllamaProvider {
  constructor({
    host = 'http://127.0.0.1:11434',
    model,
    think = undefined,
    keepAlive = '',
    numCtx = 0,
    timeoutMs = 120_000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (!model) throw new Error('OllamaProvider requires a model.');
    this.id = 'ollama';
    this.host = String(host).replace(/\/+$/, '');
    this.model = model;
    // undefined = let the model decide; false turns off hidden reasoning on Qwen3.x.
    this.think = typeof think === 'boolean' ? think : undefined;
    this.keepAlive = keepAlive;
    this.numCtx = Number(numCtx) || 0;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  isLocal() {
    return isLocalUrl(this.host);
  }

  isConfigured() {
    return true;
  }

  async complete(request = {}) {
    try {
      return await this.send(request, this.think);
    } catch (error) {
      // Older models without thinking support may reject the `think` flag; retry once without it.
      if (this.think !== undefined && /think/i.test(String(error?.message || ''))) {
        return this.send(request, undefined);
      }
      throw error;
    }
  }

  async send({ messages = [], temperature, topP, images } = {}, think = undefined) {
    const body = {
      model: this.model,
      messages: images?.length
        ? messages.map((m, i) => (i === messages.length - 1 ? { ...m, images } : m))
        : messages,
      stream: false,
      ...(think !== undefined ? { think } : {}),
      options: {
        ...(Number.isFinite(temperature) ? { temperature } : {}),
        ...(Number.isFinite(topP) ? { top_p: topP } : {}),
        ...(this.numCtx ? { num_ctx: this.numCtx } : {}),
      },
      ...(this.keepAlive !== '' ? { keep_alive: this.keepAlive } : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = String(await response.text().catch(() => '')).slice(0, 180).trim();
      throw new Error(`Ollama request failed with ${response.status}${detail ? `: ${detail}` : ''}`);
    }

    const data = await response.json();
    const text = String(data?.message?.content || '').trim();
    if (!text) throw new Error('LLM returned an empty response.');
    return { text, provider: this.id, model: this.model };
  }
}

export default OllamaProvider;
