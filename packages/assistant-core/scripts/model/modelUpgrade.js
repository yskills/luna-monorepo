// Pure helpers for `npm run model:upgrade` (kept separate so they are unit-tested).

// Uncensored (abliterated) Qwen3.5: strong German + English, roleplay-capable, vision built in.
// Sizes from ollama.com/huihui_ai/qwen3.5-abliterated (9b-q4_K is 6.6 GB).
export const BASE_MODELS = [
  { minVramMiB: 20000, tag: 'huihui_ai/qwen3.5-abliterated:27b', numCtx: 16384, note: '27B for 24 GB cards' },
  { minVramMiB: 7500, tag: 'huihui_ai/qwen3.5-abliterated:9b-q4_K', numCtx: 8192, note: '9B Q4_K_M, 6.6 GB, fits an 8 GB RTX 4060' },
  { minVramMiB: 0, tag: 'huihui_ai/qwen3.5-abliterated:4b', numCtx: 8192, note: '4B for GPUs under 8 GB' },
];

export const GUARD_MODEL = 'llama-guard3:1b';

// Parses `nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader,nounits`.
export function parseNvidiaSmi(output = '') {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.split(',').map((part) => part.trim()))
    .filter((parts) => parts.length >= 2 && parts[0] && Number.isFinite(Number(parts[1])))
    .map(([name, total, used]) => ({ name, totalMiB: Number(total), usedMiB: Number(used) || 0 }));
}

// "8 GB" cards report ~8188 MiB, so thresholds sit a little under the marketing size.
export function pickBaseModel(totalMiB = 0) {
  return BASE_MODELS.find((model) => Number(totalMiB) >= model.minVramMiB) || BASE_MODELS[BASE_MODELS.length - 1];
}

export function renderModelfile(template = '', { from, system, numCtx }) {
  if (!from) throw new Error('renderModelfile needs a FROM model.');
  // A literal """ would end the SYSTEM block early.
  const safeSystem = String(system || '').trim().replace(/"""/g, '"​""');
  return String(template)
    .replace('{{FROM}}', from)
    .replace('{{NUM_CTX}}', String(Number(numCtx) || 8192))
    .replace('{{SYSTEM}}', safeSystem);
}
