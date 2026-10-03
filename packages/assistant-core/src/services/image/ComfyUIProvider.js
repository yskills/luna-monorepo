import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isLocalUrl } from '../assistant/providers/localUrl.js';

const WORKFLOW_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,80}\.json$/i;

// Replaces "{{key}}" placeholders anywhere in a ComfyUI API-format workflow.
// A value that is exactly "{{key}}" takes the typed value (numbers stay numbers).
export function fillPlaceholders(node, values = {}) {
  if (Array.isArray(node)) return node.map((item) => fillPlaceholders(item, values));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, fillPlaceholders(value, values)]));
  }
  if (typeof node !== 'string') return node;
  const exact = node.match(/^\{\{([a-z_]+)\}\}$/);
  if (exact && Object.prototype.hasOwnProperty.call(values, exact[1])) return values[exact[1]];
  return node.replace(/\{\{([a-z_]+)\}\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  ));
}

// Adds one LoadImage -> scale -> VAEEncode -> ReferenceLatent link per reference image
// (the FLUX.2 / Kontext way to keep a face consistent) and points the consumers at the end of the chain.
export function injectReferenceChain(workflow, chain = {}, uploadedNames = []) {
  if (!uploadedNames.length || !Array.isArray(chain.conditioning) || !Array.isArray(chain.vae)) return workflow;
  const next = { ...workflow };
  let previous = chain.conditioning;
  uploadedNames.forEach((name, index) => {
    const id = `luna_ref_${index + 1}`;
    next[`${id}_load`] = { class_type: 'LoadImage', inputs: { image: name } };
    next[`${id}_scale`] = {
      class_type: 'ImageScaleToTotalPixels',
      inputs: { image: [`${id}_load`, 0], upscale_method: 'lanczos', megapixels: Number(chain.megapixels || 1) },
    };
    next[`${id}_encode`] = { class_type: 'VAEEncode', inputs: { pixels: [`${id}_scale`, 0], vae: chain.vae } };
    next[`${id}_latent`] = { class_type: 'ReferenceLatent', inputs: { conditioning: previous, latent: [`${id}_encode`, 0] } };
    previous = [`${id}_latent`, 0];
  });
  (chain.consumers || []).forEach(([nodeId, inputName]) => {
    if (next[nodeId]?.inputs) {
      next[nodeId] = { ...next[nodeId], inputs: { ...next[nodeId].inputs, [inputName]: previous } };
    }
  });
  return next;
}

// Local image generation through the ComfyUI HTTP API.
// Any checkpoint and any workflow works: workflows are API-format JSON files with placeholders.
class ComfyUIProvider {
  constructor({
    baseUrl = 'http://127.0.0.1:8188',
    workflowDirs = [],
    fetchImpl = globalThis.fetch,
    readFile = (filePath) => fs.promises.readFile(filePath),
    beforeGenerate = async () => {},
    pollIntervalMs = 1000,
    timeoutMs = 300_000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}) {
    this.id = 'comfyui';
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.workflowDirs = workflowDirs.filter(Boolean);
    this.fetchImpl = fetchImpl;
    this.readFile = readFile;
    this.beforeGenerate = beforeGenerate;
    this.pollIntervalMs = pollIntervalMs;
    this.timeoutMs = timeoutMs;
    this.sleep = sleep;
    this.clientId = crypto.randomUUID();
  }

  isLocal() {
    return isLocalUrl(this.baseUrl);
  }

  async loadWorkflow(name) {
    if (!WORKFLOW_NAME_PATTERN.test(String(name || ''))) throw new Error(`Invalid workflow name: ${name}`);
    for (const dir of this.workflowDirs) {
      const filePath = path.join(dir, name);
      try {
        // eslint-disable-next-line no-await-in-loop
        return JSON.parse(String(await this.readFile(filePath)));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    throw new Error(`Workflow not found: ${name}`);
  }

  async uploadImage(filePath) {
    const bytes = await this.readFile(filePath);
    const form = new FormData();
    form.append('image', new Blob([bytes]), `luna-ref-${path.basename(filePath)}`);
    form.append('overwrite', 'true');
    const response = await this.fetchImpl(`${this.baseUrl}/upload/image`, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`ComfyUI upload failed with ${response.status}`);
    const data = await response.json();
    return data?.subfolder ? `${data.subfolder}/${data.name}` : data?.name;
  }

  async queuePrompt(workflow) {
    const response = await this.fetchImpl(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.prompt_id) {
      const detail = data?.error?.message || JSON.stringify(data?.node_errors || {}).slice(0, 200);
      throw new Error(`ComfyUI rejected the workflow (${response.status}): ${detail}`);
    }
    return data.prompt_id;
  }

  async waitForImage(promptId) {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      const response = await this.fetchImpl(`${this.baseUrl}/history/${encodeURIComponent(promptId)}`);
      // eslint-disable-next-line no-await-in-loop
      const history = response.ok ? await response.json() : {};
      const entry = history?.[promptId];
      if (entry?.status?.status_str === 'error') throw new Error('ComfyUI failed while generating the image.');
      const image = Object.values(entry?.outputs || {}).flatMap((output) => output?.images || [])[0];
      if (image) return image;
      // eslint-disable-next-line no-await-in-loop
      await this.sleep(this.pollIntervalMs);
    }
    throw new Error('ComfyUI timed out.');
  }

  async generate({
    prompt,
    negativePrompt = '',
    workflow = 'sdxl-checkpoint.json',
    checkpoint = '',
    textEncoder = '',
    vae = '',
    referenceImages = [],
    width = 1024,
    height = 1024,
    steps = 0,
    seed = Math.floor(Math.random() * 2 ** 31),
  } = {}) {
    const template = await this.loadWorkflow(workflow);
    const { _luna: meta = {}, ...graph } = template;
    const defaults = meta.defaults || {};

    let filled = fillPlaceholders(graph, {
      prompt,
      negative_prompt: negativePrompt,
      checkpoint: checkpoint || defaults.checkpoint || '',
      text_encoder: textEncoder || defaults.text_encoder || '',
      vae: vae || defaults.vae || '',
      width: Number(width) || 1024,
      height: Number(height) || 1024,
      steps: Number(steps) || Number(defaults.steps) || 20,
      seed: Number(seed) || 0,
    });

    const supportsReferences = !!meta.referenceChain;
    if (supportsReferences && referenceImages.length) {
      const uploaded = [];
      for (const filePath of referenceImages.slice(0, Number(meta.referenceChain.max || 4))) {
        // eslint-disable-next-line no-await-in-loop
        uploaded.push(await this.uploadImage(filePath));
      }
      filled = injectReferenceChain(filled, meta.referenceChain, uploaded);
    }

    await this.beforeGenerate();
    const promptId = await this.queuePrompt(filled);
    const image = await this.waitForImage(promptId);
    const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' });
    const response = await this.fetchImpl(`${this.baseUrl}/view?${query}`);
    if (!response.ok) throw new Error(`ComfyUI image download failed with ${response.status}`);

    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers?.get?.('content-type') || 'image/png',
      width: Number(width) || 1024,
      height: Number(height) || 1024,
      referencesUsed: supportsReferences ? Math.min(referenceImages.length, Number(meta.referenceChain.max || 4)) : 0,
    };
  }
}

export default ComfyUIProvider;
