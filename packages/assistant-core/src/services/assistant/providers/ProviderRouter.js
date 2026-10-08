import OllamaProvider from './OllamaProvider.js';
import OpenAICompatibleProvider from './OpenAICompatibleProvider.js';
import AnthropicProvider from './AnthropicProvider.js';

const PROVIDER_ALIASES = {
  ollama: 'ollama',
  openai: 'openai-compatible',
  'openai-compatible': 'openai-compatible',
  anthropic: 'anthropic',
};

const DEFAULT_KEY_ENV = {
  'openai-compatible': 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export function normalizeProviderId(value = '') {
  return PROVIDER_ALIASES[String(value || '').trim().toLowerCase()] || '';
}

export function createProvider(spec = {}, { env = process.env, fetchImpl } = {}) {
  const providerId = normalizeProviderId(spec.provider);
  // Secrets never live in config: a route may only name the env variable that holds the key.
  const keyEnv = ENV_NAME_PATTERN.test(String(spec.apiKeyEnv || '')) ? spec.apiKeyEnv : DEFAULT_KEY_ENV[providerId];
  const apiKey = keyEnv ? String(env[keyEnv] || '').trim() : '';
  const shared = fetchImpl ? { fetchImpl } : {};

  if (providerId === 'ollama') {
    return new OllamaProvider({
      host: spec.host || env.OLLAMA_HOST || 'http://127.0.0.1:11434',
      model: spec.model,
      // Qwen3.x would otherwise "think" before every reply; LLM_THINK=true or a route's "think" allows it.
      think: typeof spec.think === 'boolean' ? spec.think : ['1', 'true', 'yes', 'on'].includes(String(env.LLM_THINK || '').toLowerCase()),
      keepAlive: spec.keepAlive ?? '',
      numCtx: spec.numCtx,
      ...shared,
    });
  }
  if (providerId === 'openai-compatible') {
    return new OpenAICompatibleProvider({
      baseUrl: spec.baseUrl || env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKey,
      model: spec.model,
      retryMaxAttempts: Number(env.ASSISTANT_OPENAI_RETRY_ATTEMPTS || 3),
      retryBaseDelayMs: Number(env.ASSISTANT_OPENAI_RETRY_BASE_DELAY_MS || 1200),
      retryMaxDelayMs: Number(env.ASSISTANT_OPENAI_RETRY_MAX_DELAY_MS || 10000),
      minIntervalMs: Number(env.ASSISTANT_OPENAI_MIN_INTERVAL_MS || 1200),
      ...shared,
    });
  }
  if (providerId === 'anthropic') {
    return new AnthropicProvider({
      baseUrl: spec.baseUrl || env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
      apiKey,
      model: spec.model,
      maxTokens: Number(spec.maxTokens || 1024),
      ...shared,
    });
  }
  throw new Error(`Unknown LLM provider: ${spec.provider}`);
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Picks a provider per mode/character and always keeps a local fallback.
// Resolution order (most specific first):
//   characters.<id>.modes.<mode> > modes.<mode> > characters.<id> > default
class ProviderRouter {
  constructor({
    env = process.env,
    defaultRoute = {},
    fallbackRoute = null,
    fetchImpl,
    providerFactory = createProvider,
  } = {}) {
    this.env = env;
    this.defaultRoute = {
      provider: normalizeProviderId(defaultRoute.provider) || 'ollama',
      model: defaultRoute.model || 'luna:latest',
      ...defaultRoute,
    };
    this.defaultRoute.provider = normalizeProviderId(this.defaultRoute.provider) || 'ollama';
    this.fallbackRoute = fallbackRoute || {
      provider: 'ollama',
      model: env.LLM_FALLBACK_MODEL || (this.defaultRoute.provider === 'ollama' ? this.defaultRoute.model : 'luna:latest'),
    };
    this.fetchImpl = fetchImpl;
    this.providerFactory = providerFactory;
    this.cache = new Map();
  }

  resolveRouteSpec({ routing = {}, mode = 'normal', characterId = '' } = {}) {
    const source = isPlainObject(routing) ? routing : {};
    const characterRoute = isPlainObject(source.characters?.[characterId]) ? source.characters[characterId] : null;
    const candidates = [
      characterRoute?.modes?.[mode],
      source.modes?.[mode],
      characterRoute,
      source.default,
    ];
    const picked = candidates.find((candidate) => isPlainObject(candidate) && candidate.provider);
    const { modes: _ignored, ...route } = picked || this.defaultRoute;
    return {
      ...route,
      provider: normalizeProviderId(route.provider) || this.defaultRoute.provider,
      model: route.model || this.defaultRoute.model,
    };
  }

  resolveFallbackSpec(routing = {}) {
    const configured = isPlainObject(routing?.fallback) && routing.fallback.provider ? routing.fallback : this.fallbackRoute;
    return { ...configured, provider: normalizeProviderId(configured.provider) || 'ollama' };
  }

  getProvider(spec) {
    const key = JSON.stringify(spec);
    if (!this.cache.has(key)) {
      this.cache.set(key, this.providerFactory(spec, { env: this.env, fetchImpl: this.fetchImpl }));
    }
    return this.cache.get(key);
  }

  // Returns the ordered providers to try. With localOnly, hosted providers are dropped.
  getChain({ routing = {}, mode = 'normal', characterId = '', localOnly = false } = {}) {
    const primary = this.getProvider(this.resolveRouteSpec({ routing, mode, characterId }));
    const fallback = this.getProvider(this.resolveFallbackSpec(routing));
    const chain = [primary];
    if (fallback !== primary) chain.push(fallback);

    const allowed = localOnly ? chain.filter((provider) => provider.isLocal()) : chain;
    if (!allowed.length) {
      throw new Error('This mode is local-only, but no local LLM provider is configured.');
    }
    return allowed;
  }
}

export default ProviderRouter;
