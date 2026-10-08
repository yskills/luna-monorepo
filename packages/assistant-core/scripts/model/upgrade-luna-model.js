import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ensureDirectory, resolveRuntimeConfig } from '../../src/config/runtimeConfig.js';
import { GUARD_MODEL, parseNvidiaSmi, pickBaseModel, renderModelfile } from './modelUpgrade.js';

// Rebuilds luna:latest on a newer local base model. Run on the machine with the GPU:
//   npm run model:upgrade              (detect VRAM, back up, pull, rebuild)
//   npm run model:upgrade -- --dry-run (print the plan only)
//   npm run model:upgrade -- --base=huihui_ai/qwen3.5-abliterated:9b-q4_K
// Afterwards: npm run eval:compare -- --old=luna-legacy:latest --new=luna:latest
const here = path.dirname(fileURLToPath(import.meta.url));
const configDir = path.resolve(here, '..', '..', 'config', 'ollama');
const runtime = resolveRuntimeConfig();
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const baseOverride = (args.find((item) => item.startsWith('--base=')) || '').slice('--base='.length);
const targetModel = 'luna:latest';
const legacyModel = 'luna-legacy:latest';

function run(command, commandArgs, { allowFail = false } = {}) {
  console.log(`$ ${command} ${commandArgs.join(' ')}`);
  if (dryRun) return { status: 0, stdout: '' };
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.error || (result.status !== 0 && !allowFail)) {
    throw new Error(`${command} failed: ${result.error?.message || `exit ${result.status}`}`);
  }
  return result;
}

function detectVram() {
  const result = spawnSync('nvidia-smi', ['--query-gpu=name,memory.total,memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  console.log(`nvidia-smi: ${result.stdout.trim()}`);
  return parseNvidiaSmi(result.stdout)[0] || null;
}

function main() {
  const gpu = detectVram();
  if (!gpu && !baseOverride) console.warn('nvidia-smi not found; assuming 8 GB VRAM.');
  const pick = pickBaseModel(gpu ? gpu.totalMiB : 8188);
  const base = baseOverride || pick.tag;
  console.log(`Base model: ${base}${baseOverride ? ' (override)' : ` (${pick.note})`}`);

  // Keep the old model for the old-vs-new eval, and reuse its SYSTEM prompt if it has one.
  const existing = run('ollama', ['show', targetModel, '--system'], { allowFail: true });
  const hasExisting = existing.status === 0;
  const existingSystem = hasExisting ? String(existing.stdout || '').trim() : '';
  if (hasExisting) run('ollama', ['cp', targetModel, legacyModel]);

  const system = existingSystem || fs.readFileSync(path.join(configDir, 'luna.system.txt'), 'utf8');
  console.log(`System prompt: ${existingSystem ? `reused from ${targetModel}` : 'config/ollama/luna.system.txt'}`);

  run('ollama', ['pull', base]);
  const modelfile = renderModelfile(fs.readFileSync(path.join(configDir, 'Modelfile.luna.template'), 'utf8'), {
    from: base,
    system,
    numCtx: pick.numCtx,
  });
  const outDir = path.join(runtime.memoryDir, 'ollama');
  const modelfilePath = path.join(outDir, 'Modelfile.luna');
  if (!dryRun) {
    ensureDirectory(outDir);
    fs.writeFileSync(modelfilePath, modelfile, 'utf8');
  }
  console.log(`Modelfile: ${modelfilePath}`);
  run('ollama', ['create', targetModel, '-f', modelfilePath]);
  run('ollama', ['pull', GUARD_MODEL]);

  console.log('\nNext: npm run eval:compare -- --old=luna-legacy:latest --new=luna:latest');
  if (!hasExisting) console.log(`(No previous ${targetModel} found, so there is nothing to compare against.)`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
