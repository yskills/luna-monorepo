import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CompanionLLMService } from '../src/services/CompanionLLMService.js';
import ContentPolicy from '../src/services/assistant/safety/ContentPolicy.js';
import BlockLog from '../src/services/assistant/safety/BlockLog.js';
import createAssistantServiceApp from '../src/service/createAssistantServiceApp.js';
import { clampMinCurated } from '../src/routes/assistantRoutes.js';
import { describeLoraReadiness } from '../src/training/loraReadiness.js';
import { resolveRuntimeConfig } from '../src/config/runtimeConfig.js';

const CONFIG = path.resolve('config', 'assistant-mode-config.example.json');
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function createService({ textVerdict = () => ({ unsafe: false, categories: [] }) } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-chat-test-'));
  const llmCalls = [];
  const providerRouter = {
    getChain: ({ mode, localOnly }) => [{
      id: 'ollama',
      isLocal: () => true,
      isConfigured: () => true,
      complete: async ({ messages }) => {
        llmCalls.push({ mode, localOnly, system: messages[0].content });
        return { text: `Reply ${llmCalls.length}`, provider: 'ollama', model: 'luna:latest' };
      },
    }],
  };
  const contentPolicy = new ContentPolicy({
    textGuard: { classifyText: async (args) => textVerdict(args) },
    imageGuard: { classifyImage: async () => ({}) },
    blockLog: new BlockLog(),
    getPolicyConfig: () => service.loadModeConfig().contentPolicy,
  });
  const service = new CompanionLLMService({
    env: { MEMORY_BACKEND: 'sqlite' },
    runtime: {
      modeConfigFile: CONFIG,
      memorySqliteFile: path.join(dir, 'memory.sqlite'),
      memoryKey: 'test',
      imageDir: path.join(dir, 'images'),
      imageReferenceDir: path.join(dir, 'refs'),
    },
    providerRouter,
    contentPolicy,
  });
  service.imageService.providers = {
    comfyui: { id: 'comfyui', isLocal: () => true, generate: async () => ({ buffer: PNG, mimeType: 'image/png', width: 1024, height: 1024 }) },
  };
  return { service, llmCalls };
}

test('chat: personas and modes still reach the model unchanged, uncensored runs local-only', async () => {
  const { service, llmCalls } = createService();
  const normal = await service.chat({ message: 'Plan my day', userId: 'luna', mode: 'normal' });
  assert.equal(normal.reply, 'Reply 1');
  assert.equal(normal.meta.provider, 'ollama');
  assert.equal(normal.meta.contentLevel, 'standard');
  assert.match(llmCalls[0].system, /Assistant name: Luna\./);
  assert.match(llmCalls[0].system, /Active mode: normal\./);

  const secret = await service.chat({ message: 'Hey', userId: 'luna', mode: 'uncensored' });
  assert.equal(secret.meta.contentLevel, 'adult');
  assert.equal(llmCalls[1].localOnly, true);
  assert.match(llmCalls[1].system, /Active mode: uncensored\./);
});

test('chat: a floor-blocked message gets a refusal, the LLM is not called, nothing is stored', async () => {
  const { service, llmCalls } = createService();
  const result = await service.chat({ message: 'sexy story about a 13 year old', userId: 'luna', mode: 'uncensored' });
  assert.equal(llmCalls.length, 0);
  assert.equal(result.meta.blocked.category, 'floor.minors-sexual');
  assert.match(result.reply, /blocked|gesperrt/);
  assert.equal(service.getSafetyBlocks().length, 1);
  const { user } = service.memoryManager.getUserState('luna');
  assert.equal((user.uncensoredHistory || []).length, 0);
});

test('chat: an output flagged by the guard is replaced before it is shown or stored', async () => {
  const { service, llmCalls } = createService({
    textVerdict: ({ stage }) => (stage === 'output' ? { unsafe: true, categories: ['hate'] } : { unsafe: false, categories: [] }),
  });
  const result = await service.chat({ message: 'hello', userId: 'luna', mode: 'normal' });
  assert.equal(llmCalls.length, 1);
  assert.equal(result.meta.blocked.stage, 'output');
  assert.equal(result.meta.blocked.category, 'hate');
  assert.notEqual(result.reply, 'Reply 1');
  const { user } = service.memoryManager.getUserState('luna');
  assert.equal((user.history || []).length, 0);
});

async function withServer(service, run) {
  const app = createAssistantServiceApp({ CompanionService: service });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/assistant`;
  try {
    await run(base);
  } finally {
    server.close();
  }
}

test('route: POST /assistant/image returns an image message and GET serves the file', async () => {
  const { service } = createService();
  await withServer(service, async (base) => {
    const response = await fetch(`${base}/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Luna waving', mode: 'normal', characterId: 'luna' }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.type, 'image');
    assert.equal(body.image.mimeType, 'image/png');
    assert.equal(body.image.level, 'standard');

    const file = await fetch(`${base.replace('/assistant', '')}${body.image.url}`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await file.arrayBuffer()).equals(PNG), true);

    const missing = await fetch(`${base}/image/not-a-uuid`);
    assert.equal(missing.status, 404);

    const blocked = await (await fetch(`${base}/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'nude picture of Taylor Swift', mode: 'uncensored', characterId: 'luna' }),
    })).json();
    assert.equal(blocked.type, 'text');
    assert.equal(blocked.meta.blocked.category, 'floor.real-person-intimate-image');

    const blocks = await (await fetch(`${base}/safety/blocks`)).json();
    assert.equal(blocks.blocks[0].category, 'floor.real-person-intimate-image');

    const chat = await (await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hi', characterId: 'luna' }),
    })).json();
    assert.equal(chat.type, 'text');
  });
});

test('lora: training never starts below 300 curated samples, export reports the count', () => {
  assert.equal(clampMinCurated(1), 300);
  assert.equal(clampMinCurated(500), 500);
  assert.equal(clampMinCurated('x'), 300);
  assert.equal(resolveRuntimeConfig({ env: { TRAIN_MIN_CURATED: '20' } }).trainMinCurated, 300);
  assert.equal(resolveRuntimeConfig({ env: {} }).trainMinCurated, 300);
  const readiness = describeLoraReadiness(5);
  assert.deepEqual({ curated: readiness.curated, required: readiness.required, missing: readiness.missing, ready: readiness.ready }, { curated: 5, required: 300, missing: 295, ready: false });
  assert.match(readiness.message, /5\/300/);
  assert.equal(describeLoraReadiness(320).ready, true);
});
