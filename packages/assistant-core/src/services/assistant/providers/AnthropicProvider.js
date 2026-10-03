// Anthropic Messages API. System messages are merged into the top-level
// `system` field and consecutive same-role turns are joined, as the API requires.
class AnthropicProvider {
  constructor({
    baseUrl = 'https://api.anthropic.com',
    apiKey = '',
    model,
    maxTokens = 1024,
    apiVersion = '2023-06-01',
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (!model) throw new Error('AnthropicProvider requires a model.');
    this.id = 'anthropic';
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.maxTokens = maxTokens;
    this.apiVersion = apiVersion;
    this.fetchImpl = fetchImpl;
  }

  isLocal() {
    return false;
  }

  isConfigured() {
    return !!this.apiKey;
  }

  static toAnthropicMessages(messages = []) {
    const system = [];
    const turns = [];
    messages.forEach(({ role, content }) => {
      const text = String(content || '');
      if (role === 'system') {
        system.push(text);
        return;
      }
      const normalizedRole = role === 'assistant' ? 'assistant' : 'user';
      const last = turns[turns.length - 1];
      if (last && last.role === normalizedRole) {
        last.content = `${last.content}\n\n${text}`;
      } else {
        turns.push({ role: normalizedRole, content: text });
      }
    });
    // The conversation must start with a user turn.
    if (turns[0]?.role === 'assistant') turns.unshift({ role: 'user', content: '(conversation continues)' });
    return { system: system.join('\n\n'), messages: turns };
  }

  async complete({ messages = [], temperature, topP } = {}) {
    if (!this.isConfigured()) throw new Error('ANTHROPIC_API_KEY missing for the Anthropic provider.');
    const converted = AnthropicProvider.toAnthropicMessages(messages);
    const response = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        ...(converted.system ? { system: converted.system } : {}),
        messages: converted.messages,
        // The API accepts temperature or top_p, not both.
        ...(Number.isFinite(temperature) ? { temperature } : (Number.isFinite(topP) ? { top_p: topP } : {})),
      }),
    });

    if (!response.ok) {
      const detail = String(await response.text().catch(() => '')).slice(0, 180).trim();
      throw new Error(`Anthropic request failed with ${response.status}${detail ? `: ${detail}` : ''}`);
    }

    const data = await response.json();
    const text = (Array.isArray(data?.content) ? data.content : [])
      .filter((block) => block?.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    if (!text) throw new Error('LLM returned an empty response.');
    return { text, provider: this.id, model: this.model };
  }
}

export default AnthropicProvider;
