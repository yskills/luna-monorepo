import { isLocalUrl } from '../assistant/providers/localUrl.js';

// Optional hosted (or local OpenAI-compatible) image endpoint: POST /images/generations.
// Never used for adult/local-only levels unless the endpoint itself is local.
class OpenAIImagesProvider {
  constructor({ baseUrl = 'https://api.openai.com/v1', apiKey = '', model = 'gpt-image-1', fetchImpl = globalThis.fetch } = {}) {
    this.id = 'openai-images';
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
  }

  isLocal() {
    return isLocalUrl(this.baseUrl);
  }

  async generate({ prompt, width = 1024, height = 1024 } = {}) {
    if (!this.isLocal() && !this.apiKey) throw new Error('API key missing for the hosted image provider.');
    const response = await this.fetchImpl(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.model, prompt, n: 1, size: `${width}x${height}` }),
    });
    if (!response.ok) {
      const detail = String(await response.text().catch(() => '')).slice(0, 160);
      throw new Error(`Image request failed with ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const data = await response.json();
    const item = data?.data?.[0] || {};
    if (item.b64_json) {
      return { buffer: Buffer.from(item.b64_json, 'base64'), mimeType: 'image/png', width, height, referencesUsed: 0 };
    }
    if (item.url) {
      const download = await this.fetchImpl(item.url);
      return {
        buffer: Buffer.from(await download.arrayBuffer()),
        mimeType: download.headers?.get?.('content-type') || 'image/png',
        width,
        height,
        referencesUsed: 0,
      };
    }
    throw new Error('Image provider returned no image.');
  }
}

export default OpenAIImagesProvider;
