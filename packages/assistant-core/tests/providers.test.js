import test from 'node:test';
import assert from 'node:assert/strict';
import ProviderRouter from '../src/services/assistant/providers/ProviderRouter.js';
import AnthropicProvider from '../src/services/assistant/providers/AnthropicProvider.js';
import OllamaProvider from '../src/services/assistant/providers/OllamaProvider.js';
import OpenAICompatibleProvider from '../src/services/assistant/providers/OpenAICompatibleProvider.js';
import LLMClient from '../src/services/assistant/LLMClient.js';
import ModeConfigRepository from '../src/services/assistant/ModeConfigRepository.js';
import { isLocalUrl } from '../src/services/assistant/providers/localUrl.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const routing = {
  modes: { uncensored: { provider: 'ollama', model: 'luna:latest' } },
  characters: {
    eva: { provider: 'anthropic', model: 'claude-haiku-4-5', modes: { normal: { provider: 'openai', model: 'gpt-x' } } },
  },
};

test('router: character+mode beats mode beats character beats default', () => {
  const router = new ProviderRouter({ env: {}, defaultRoute: { provider: 'ollama', model: 'base' } });
  assert.deepEqual(router.resolveRouteSpec({ routing, mode: 'normal', characterId: 'eva' }), { provider: 'openai-compatible', model: 'gpt-x' });
  assert.equal(router.resolveRouteSpec({ routing, mode: 'uncensored', characterId: 'eva' }).provider, 'ollama');
  assert.equal(router.resolveRouteSpec({ routing: { characters: { eva: { provider: 'anthropic', model: 'm' } } }, mode: 'normal', characterId: 'eva' }).provider, 'anthropic');
  assert.deepEqual(router.resolveRouteSpec({ routing, mode: 'normal', characterId: 'luna' }), { provider: 'ollama', model: 'base' });
});

test('router: local-only drops hosted providers but keeps the local fallback', () => {
  const router = new ProviderRouter({ env: { ANTHROPIC_API_KEY: 'k' }, defaultRoute: { provider: 'ollama', model: 'base' } });
  const hosted = router.getChain({ routing: { default: { provider: 'anthropic', model: 'm' } }, mode: 'normal' });
  assert.deepEqual(hosted.map((p) => p.id), ['anthropic', 'ollama']);
  const local = router.getChain({ routing: { default: { provider: 'anthropic', model: 'm' } }, mode: 'uncensored', localOnly: true });
  assert.deepEqual(local.map((p) => p.id), ['ollama']);

  const noLocal = new ProviderRouter({ env: {}, fallbackRoute: { provider: 'anthropic', model: 'm' }, defaultRoute: { provider: 'anthropic', model: 'm' } });
  assert.throws(() => noLocal.getChain({ localOnly: true }), /local-only/);
});

test('router: OpenAI-compatible servers on localhost count as local (LM Studio, KoboldCpp)', () => {
  assert.equal(isLocalUrl('http://127.0.0.1:1234/v1'), true);
  assert.equal(isLocalUrl('http://ollama:11434'), true);
  assert.equal(isLocalUrl('http://192.168.1.20:5001/v1'), true);
  assert.equal(isLocalUrl('https://api.openai.com/v1'), false);
  assert.equal(isLocalUrl('https://openrouter.ai/api/v1'), false);
});

test('router: API keys come only from the env variable named in apiKeyEnv', () => {
  const router = new ProviderRouter({ env: { MY_KEY: 'from-env' } });
  const provider = router.getProvider({ provider: 'openai', model: 'x', apiKeyEnv: 'MY_KEY', baseUrl: 'https://example.com/v1' });
  assert.equal(provider.apiKey, 'from-env');
});

test('router: Ollama thinking is off unless LLM_THINK or the route turns it on', () => {
  assert.equal(new ProviderRouter({ env: {} }).getProvider({ provider: 'ollama', model: 'm' }).think, false);
  assert.equal(new ProviderRouter({ env: { LLM_THINK: 'true' } }).getProvider({ provider: 'ollama', model: 'm' }).think, true);
  assert.equal(new ProviderRouter({ env: {} }).getProvider({ provider: 'ollama', model: 'm', think: true }).think, true);
});

test('mode config refuses secrets inside routing, policy or image blocks', () => {
  assert.throws(() => ModeConfigRepository.optionalObject({ characters: { eva: { apiKey: 'sk-123' } } }, 'llmRouting'), /secrets are not allowed/);
  assert.deepEqual(ModeConfigRepository.optionalObject({ default: { apiKeyEnv: 'OPENAI_API_KEY' } }, 'llmRouting'), { default: { apiKeyEnv: 'OPENAI_API_KEY' } });
});

test('llm client: falls back to the local provider when the routed one fails', async () => {
  const calls = [];
  const fakeRouter = {
    getChain: () => [
      { id: 'anthropic', isLocal: () => false, isConfigured: () => true, complete: async () => { calls.push('anthropic'); throw new Error('Anthropic request failed with 529'); } },
      { id: 'ollama', isLocal: () => true, isConfigured: () => true, complete: async ({ messages }) => { calls.push('ollama'); return { text: `ok ${messages.length}`, provider: 'ollama', model: 'luna:latest' }; } },
    ],
  };
  const client = new LLMClient({ providerRouter: fakeRouter, buildSystemPrompt: () => 'persona' });
  const result = await client.chat({ profile: { characterId: 'luna' } }, 'hi', {}, [], 'normal');
  assert.deepEqual(calls, ['anthropic', 'ollama']);
  assert.equal(result.meta.provider, 'ollama');
  assert.equal(result.meta.fallbackUsed, true);
  assert.match(result.meta.fallbackReason, /529/);
});

test('llm client: no web search in local-only modes', () => {
  const client = new LLMClient({
    providerRouter: { getChain: () => [] },
    webSearchEnabled: true,
    isWebSearchAllowedForMode: (_user, mode) => mode !== 'uncensored',
  });
  const user = { profile: { characterId: 'luna' } };
  assert.equal(client.previewWebSearch(user, 'news heute', 'normal').shouldSearch, true);
  assert.equal(client.previewWebSearch(user, 'news heute', 'uncensored').shouldSearch, false);
});

test('ollama provider: posts to /api/chat with thinking off and returns the text', async () => {
  let sent;
  const provider = new OllamaProvider({
    host: 'http://127.0.0.1:11434/',
    model: 'luna:latest',
    think: false,
    fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return jsonResponse({ message: { content: ' Hallo ' } }); },
  });
  const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }], temperature: 0.7, topP: 0.9 });
  assert.equal(sent.url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(sent.body.think, false);
  assert.equal(sent.body.stream, false);
  assert.deepEqual(sent.body.options, { temperature: 0.7, top_p: 0.9 });
  assert.equal(result.text, 'Hallo');
});

test('openai-compatible provider: retries 429 then succeeds', async () => {
  let attempts = 0;
  const provider = new OpenAICompatibleProvider({
    baseUrl: 'https://example.com/v1',
    apiKey: 'k',
    model: 'm',
    minIntervalMs: 0,
    sleep: async () => {},
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1 ? new Response('slow down', { status: 429 }) : jsonResponse({ choices: [{ message: { content: 'done' } }] });
    },
  });
  assert.equal((await provider.complete({ messages: [] })).text, 'done');
  assert.equal(attempts, 2);
});

test('anthropic provider: system prompts move to `system`, same-role turns merge', async () => {
  const converted = AnthropicProvider.toAnthropicMessages([
    { role: 'system', content: 'persona' },
    { role: 'system', content: 'snapshot' },
    { role: 'user', content: 'web data' },
    { role: 'user', content: 'question' },
    { role: 'assistant', content: 'answer' },
  ]);
  assert.equal(converted.system, 'persona\n\nsnapshot');
  assert.deepEqual(converted.messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal(converted.messages[0].content, 'web data\n\nquestion');

  let headers;
  const provider = new AnthropicProvider({
    apiKey: 'k',
    model: 'claude-haiku-4-5',
    fetchImpl: async (_url, init) => { headers = init.headers; return jsonResponse({ content: [{ type: 'text', text: 'hi' }] }); },
  });
  assert.equal((await provider.complete({ messages: [{ role: 'user', content: 'x' }] })).text, 'hi');
  assert.equal(headers['x-api-key'], 'k');
  assert.equal(headers['anthropic-version'], '2023-06-01');
});

test('ollama provider: retries without the think flag when an older model rejects it', async () => {
  const bodies = [];
  const provider = new OllamaProvider({
    model: 'llama3-old',
    think: false,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      return 'think' in body
        ? new Response('"llama3-old" does not support thinking', { status: 400 })
        : jsonResponse({ message: { content: 'ok' } });
    },
  });
  assert.equal((await provider.complete({ messages: [] })).text, 'ok');
  assert.deepEqual(bodies.map((b) => 'think' in b), [true, false]);
});
