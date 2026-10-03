import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ComfyUIProvider, { fillPlaceholders, injectReferenceChain } from '../src/services/image/ComfyUIProvider.js';
import ImageService, { resolveReferencePath } from '../src/services/image/ImageService.js';
import ImageStore from '../src/services/image/ImageStore.js';
import ContentPolicy from '../src/services/assistant/safety/ContentPolicy.js';
import { createOllamaVramReleaser } from '../src/services/image/ollamaVram.js';

const WORKFLOW_DIR = path.resolve('config', 'comfyui');
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'luna-image-test-'));
}

function okPolicy(overrides = {}) {
  return new ContentPolicy({
    textGuard: { classifyText: async () => ({ unsafe: false, categories: [] }) },
    imageGuard: { classifyImage: async () => ({}) },
    ...overrides,
  });
}

test('workflows: bundled FLUX.2 klein and SDXL files are valid and use placeholders', () => {
  for (const name of ['flux2-klein-4b-gguf.json', 'sdxl-checkpoint.json']) {
    const workflow = JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, name), 'utf8'));
    const text = JSON.stringify(workflow);
    assert.match(text, /\{\{prompt\}\}/, name);
    assert.match(text, /\{\{checkpoint\}\}/, name);
    assert.ok(workflow._luna?.defaults?.checkpoint, name);
  }
});

test('placeholders keep numbers typed and leave unknown keys alone', () => {
  const filled = fillPlaceholders({ a: { inputs: { seed: '{{seed}}', text: 'style, {{prompt}}', other: '{{unknown}}' } } }, { seed: 42, prompt: 'Luna' });
  assert.deepEqual(filled.a.inputs, { seed: 42, text: 'style, Luna', other: '{{unknown}}' });
});

test('reference chain links every reference image into the sampler conditioning', () => {
  const graph = { 6: { class_type: 'KSampler', inputs: { positive: ['4', 0] } } };
  const chained = injectReferenceChain(graph, { conditioning: ['4', 0], vae: ['3', 0], consumers: [['6', 'positive']] }, ['a.png', 'b.png']);
  assert.deepEqual(chained.luna_ref_1_latent.inputs.conditioning, ['4', 0]);
  assert.deepEqual(chained.luna_ref_2_latent.inputs.conditioning, ['luna_ref_1_latent', 0]);
  assert.deepEqual(chained[6].inputs.positive, ['luna_ref_2_latent', 0]);
  assert.equal(chained.luna_ref_2_load.inputs.image, 'b.png');
});

test('comfyui provider: uploads references, queues the workflow, frees VRAM first, downloads the image', async () => {
  const dir = tempDir();
  const refPath = path.join(dir, 'face.png');
  fs.writeFileSync(refPath, PNG);
  const calls = [];
  let queued;
  const fetchImpl = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${new URL(url).pathname}`);
    if (url.endsWith('/upload/image')) return Response.json({ name: 'luna-ref-face.png', subfolder: '' });
    if (url.endsWith('/prompt')) { queued = JSON.parse(init.body).prompt; return Response.json({ prompt_id: 'p1' }); }
    if (url.includes('/history/p1')) return Response.json({ p1: { outputs: { 9: { images: [{ filename: 'luna_0001.png', subfolder: '', type: 'output' }] } } } });
    if (url.includes('/view?')) return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    throw new Error(`unexpected ${url}`);
  };
  let released = false;
  const provider = new ComfyUIProvider({ workflowDirs: [WORKFLOW_DIR], fetchImpl, beforeGenerate: async () => { released = true; }, sleep: async () => {} });
  const result = await provider.generate({ prompt: 'Luna smiling', workflow: 'flux2-klein-4b-gguf.json', referenceImages: [refPath], seed: 7 });

  assert.equal(released, true);
  assert.deepEqual(calls, ['POST /upload/image', 'POST /prompt', 'GET /history/p1', 'GET /view']);
  assert.equal(queued[1].inputs.unet_name, 'flux-2-klein-4b-Q4_K_M.gguf');
  assert.equal(queued[4].inputs.text, 'Luna smiling');
  assert.equal(queued[6].inputs.seed, 7);
  assert.equal(queued[6].inputs.steps, 4);
  assert.deepEqual(queued[6].inputs.positive, ['luna_ref_1_latent', 0]);
  assert.equal(queued._luna, undefined);
  assert.equal(result.referencesUsed, 1);
  assert.equal(result.mimeType, 'image/png');
});

test('comfyui provider: your own workflow dir wins and names cannot escape it', async () => {
  const own = tempDir();
  fs.writeFileSync(path.join(own, 'sdxl-checkpoint.json'), JSON.stringify({ 1: { inputs: { mine: true } } }));
  const provider = new ComfyUIProvider({ workflowDirs: [own, WORKFLOW_DIR] });
  assert.equal((await provider.loadWorkflow('sdxl-checkpoint.json'))[1].inputs.mine, true);
  await assert.rejects(provider.loadWorkflow('../secrets.json'), /Invalid workflow name/);
});

test('reference images must stay inside the reference folder', () => {
  assert.equal(resolveReferencePath('/data/refs', 'luna/front.png'), path.resolve('/data/refs/luna/front.png'));
  assert.throws(() => resolveReferencePath('/data/refs', '../../etc/passwd'), /inside the reference folder/);
});

function buildService({ policy = okPolicy(), providers, config } = {}) {
  const dir = tempDir();
  const generated = [];
  const fakeLocal = {
    id: 'comfyui',
    isLocal: () => true,
    generate: async (opts) => { generated.push(opts); return { buffer: PNG, mimeType: 'image/png', width: 512, height: 512, referencesUsed: 0 }; },
  };
  const service = new ImageService({
    providers: providers || { comfyui: fakeLocal },
    contentPolicy: policy,
    store: new ImageStore({ dir: path.join(dir, 'images') }),
    referenceDir: path.join(dir, 'refs'),
    getConfig: () => config || {
      imageGeneration: { defaultProvider: 'comfyui' },
      characterProfiles: { luna: { image: { stylePrompt: 'Luna, adult woman', checkpoint: 'my-own.safetensors', workflow: 'sdxl-checkpoint.json' } } },
    },
  });
  return { service, generated, dir };
}

const luna = { characterId: 'luna', characterName: 'Luna', characterAge: '21' };

test('image service: uses the per-character checkpoint and style, stores the result', async () => {
  const { service, generated } = buildService();
  const result = await service.generate({ prompt: 'at the beach', mode: 'normal', ...luna });
  assert.equal(result.blocked, false);
  assert.equal(generated[0].checkpoint, 'my-own.safetensors');
  assert.equal(generated[0].prompt, 'Luna, adult woman, at the beach');
  assert.match(result.image.url, /^\/assistant\/image\/[0-9a-f-]{36}$/);
  const stored = service.getImage(result.image.id);
  assert.equal(stored.meta.level, 'standard');
  assert.equal(fs.readFileSync(stored.filePath).equals(PNG), true);
});

test('image service: a floor-blocked prompt never reaches the image model', async () => {
  const { service, generated } = buildService();
  const result = await service.generate({ prompt: 'nude photo of Taylor Swift', mode: 'uncensored', ...luna });
  assert.equal(result.blocked, true);
  assert.equal(result.category, 'floor.real-person-intimate-image');
  assert.equal(generated.length, 0);
});

test('image service: a blocked image is discarded, not stored', async () => {
  const policy = okPolicy({ imageGuard: { classifyImage: async () => ({ nudity: true }) } });
  const { service, dir } = buildService({ policy });
  const result = await service.generate({ prompt: 'Luna on the beach', mode: 'normal', ...luna });
  assert.equal(result.blocked, true);
  assert.equal(result.category, 'nudity');
  assert.equal(fs.existsSync(path.join(dir, 'images')), false);
});

test('image service: adult mode never uses a hosted image provider', async () => {
  const hostedCalls = [];
  const hosted = { id: 'openai-images', isLocal: () => false, generate: async () => { hostedCalls.push(1); return { buffer: PNG, mimeType: 'image/png' }; } };
  const local = { id: 'comfyui', isLocal: () => true, generate: async () => ({ buffer: PNG, mimeType: 'image/png' }) };
  const { service } = buildService({
    providers: { comfyui: local, 'openai-images': hosted },
    config: { imageGeneration: { defaultProvider: 'openai-images' }, characterProfiles: {} },
  });
  const adult = await service.generate({ prompt: 'Luna', mode: 'uncensored', ...luna });
  assert.equal(adult.image.provider, 'comfyui');
  assert.equal(adult.image.localOnly, true);
  const normal = await service.generate({ prompt: 'Luna', mode: 'normal', ...luna });
  assert.equal(normal.image.provider, 'openai-images');
  assert.equal(hostedCalls.length, 1);
});

test('image store rejects ids that are not uuids', () => {
  const store = new ImageStore({ dir: tempDir() });
  assert.equal(store.get('../../etc/passwd'), null);
});

test('vram releaser unloads every model Ollama has loaded', async () => {
  const unloaded = [];
  const release = createOllamaVramReleaser({
    fetchImpl: async (url, init) => {
      if (url.endsWith('/api/ps')) return Response.json({ models: [{ name: 'luna:latest' }, { name: 'llama-guard3:1b' }] });
      unloaded.push(JSON.parse(init.body));
      return Response.json({});
    },
  });
  assert.deepEqual(await release(), ['luna:latest', 'llama-guard3:1b']);
  assert.deepEqual(unloaded.map((b) => b.keep_alive), [0, 0]);
});

test('image service: missing reference files are skipped and reported, not fatal', async () => {
  const { service, generated, dir } = buildService({
    config: { characterProfiles: { luna: { image: { referenceImages: ['luna/front.png', 'luna/missing.png'] } } } },
  });
  fs.mkdirSync(path.join(dir, 'refs', 'luna'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'refs', 'luna', 'front.png'), PNG);
  const result = await service.generate({ prompt: 'Luna smiling', mode: 'normal', ...luna });
  assert.equal(generated[0].referenceImages.length, 1);
  assert.equal(result.image.referencesMissing, 1);
});
