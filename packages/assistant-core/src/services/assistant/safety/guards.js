// Local guard models. All of them run on Ollama (or a local HTTP endpoint),
// so nothing is sent to a hosted moderation API.

// Llama Guard 3 hazard codes mapped to stable names used in the policy config.
export const LLAMA_GUARD_CATEGORIES = Object.freeze({
  S1: 'violent-crimes',
  S2: 'non-violent-crimes',
  S3: 'sex-crimes',
  S4: 'child-sexual-exploitation',
  S5: 'defamation',
  S6: 'specialized-advice',
  S7: 'privacy',
  S8: 'intellectual-property',
  S9: 'indiscriminate-weapons',
  S10: 'hate',
  S11: 'self-harm',
  S12: 'sexual-content',
  S13: 'elections',
  S14: 'code-interpreter-abuse',
});

async function postJson(fetchImpl, url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = String(await response.text().catch(() => '')).slice(0, 160);
      throw new Error(`Guard request failed with ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function parseLlamaGuardOutput(raw = '') {
  const text = String(raw || '').trim().toLowerCase();
  if (text.startsWith('safe')) return { unsafe: false, categories: [] };
  if (!text.startsWith('unsafe')) throw new Error(`Unexpected guard output: ${text.slice(0, 60)}`);
  const codes = (String(raw).match(/S\d{1,2}/gi) || []).map((code) => code.toUpperCase());
  return {
    unsafe: true,
    categories: [...new Set(codes.map((code) => LLAMA_GUARD_CATEGORIES[code] || code))],
  };
}

// Text guard with fixed hazard categories (llama-guard3:1b is ~1.6 GB and runs on CPU too).
export class LlamaGuardClassifier {
  constructor({ host = 'http://127.0.0.1:11434', model = 'llama-guard3:1b', timeoutMs = 30_000, fetchImpl = globalThis.fetch } = {}) {
    this.host = String(host).replace(/\/+$/, '');
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async classifyText({ text = '', stage = 'input', context = '' } = {}) {
    const messages = stage === 'output'
      ? [{ role: 'user', content: String(context || '(previous message)') }, { role: 'assistant', content: String(text) }]
      : [{ role: 'user', content: String(text) }];
    const data = await postJson(this.fetchImpl, `${this.host}/api/chat`, {
      model: this.model, messages, stream: false, options: { temperature: 0 },
    }, this.timeoutMs);
    return parseLlamaGuardOutput(data?.message?.content);
  }
}

// Text guard driven by your own policy sentences (ShieldGemma answers Yes/No per policy).
export class ShieldGemmaClassifier {
  constructor({ host = 'http://127.0.0.1:11434', model = 'shieldgemma:2b', timeoutMs = 30_000, fetchImpl = globalThis.fetch } = {}) {
    this.host = String(host).replace(/\/+$/, '');
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  static buildPrompt(text, policy, stage) {
    const who = stage === 'output' ? 'Chatbot Response' : 'Human Question';
    return [
      'You are a policy expert trying to help determine whether a message is in violation of the defined safety policies.',
      '',
      '<start_of_turn>',
      `${who}: ${text}`,
      '<end_of_turn>',
      '',
      'Our safety principle is defined in the below:',
      '',
      `* ${policy}`,
      '',
      `Does the ${who.toLowerCase()} violate the above principle? Your answer must start with 'Yes' or 'No'.`,
    ].join('\n');
  }

  // policies: [{ id, text }]
  async classifyText({ text = '', stage = 'input', policies = [] } = {}) {
    const violated = [];
    for (const policy of policies) {
      // eslint-disable-next-line no-await-in-loop
      const data = await postJson(this.fetchImpl, `${this.host}/api/generate`, {
        model: this.model,
        prompt: ShieldGemmaClassifier.buildPrompt(String(text), policy.text, stage),
        stream: false,
        options: { temperature: 0 },
      }, this.timeoutMs);
      if (/^\s*yes/i.test(String(data?.response || ''))) violated.push(policy.id);
    }
    return { unsafe: violated.length > 0, categories: violated };
  }
}

const IMAGE_VERDICT_KEYS = ['sexual', 'nudity', 'minorSuspected', 'realPersonSuspected', 'violence', 'gore'];

export function normalizeImageVerdict(raw = {}) {
  return IMAGE_VERDICT_KEYS.reduce((acc, key) => {
    acc[key] = raw?.[key] === true || String(raw?.[key]).toLowerCase() === 'true';
    return acc;
  }, {});
}

// Image guard using a local vision model on Ollama (e.g. the Qwen3.5 base model, which has vision).
export class OllamaVisionImageGuard {
  constructor({ host = 'http://127.0.0.1:11434', model, timeoutMs = 60_000, fetchImpl = globalThis.fetch } = {}) {
    if (!model) throw new Error('OllamaVisionImageGuard requires a vision model.');
    this.host = String(host).replace(/\/+$/, '');
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async classifyImage({ base64 = '' } = {}) {
    const data = await postJson(this.fetchImpl, `${this.host}/api/chat`, {
      model: this.model,
      stream: false,
      think: false,
      format: 'json',
      options: { temperature: 0 },
      messages: [{
        role: 'user',
        images: [base64],
        content: [
          'You are an image safety classifier. Look at the image and answer only with JSON:',
          '{"sexual":bool,"nudity":bool,"minorSuspected":bool,"realPersonSuspected":bool,"violence":bool,"gore":bool}',
          'minorSuspected: any person who is or could look under 18.',
          'realPersonSuspected: looks like a photo of a real, identifiable person (celebrity or private person), not a drawn or clearly fictional character.',
          'When unsure about minorSuspected, answer true.',
        ].join('\n'),
      }],
    }, this.timeoutMs);
    return normalizeImageVerdict(JSON.parse(String(data?.message?.content || '{}')));
  }
}

// Image guard behind your own local HTTP endpoint (e.g. a ShieldGemma 2 server).
// Expects POST { image: <base64> } -> the same JSON verdict shape as above.
export class HttpImageGuard {
  constructor({ url, timeoutMs = 60_000, fetchImpl = globalThis.fetch } = {}) {
    if (!url) throw new Error('HttpImageGuard requires a url.');
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async classifyImage({ base64 = '' } = {}) {
    return normalizeImageVerdict(await postJson(this.fetchImpl, this.url, { image: base64 }, this.timeoutMs));
  }
}

export function createTextGuard(spec = {}, { host, fetchImpl } = {}) {
  const options = { host: spec.host || host, model: spec.model, ...(fetchImpl ? { fetchImpl } : {}) };
  const kind = String(spec.provider || '').toLowerCase();
  if (kind === 'llama-guard') return new LlamaGuardClassifier(options);
  if (kind === 'shieldgemma') return new ShieldGemmaClassifier(options);
  return null;
}

export function createImageGuard(spec = {}, { host, fetchImpl } = {}) {
  const kind = String(spec.provider || '').toLowerCase();
  const shared = fetchImpl ? { fetchImpl } : {};
  if (kind === 'ollama-vision' && spec.model) return new OllamaVisionImageGuard({ host: spec.host || host, model: spec.model, ...shared });
  if (kind === 'http' && spec.url) return new HttpImageGuard({ url: spec.url, ...shared });
  return null;
}
