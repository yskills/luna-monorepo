import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  assertFileExists,
  ensureDirectory,
  resolveRuntimeConfig,
} from '../../src/config/runtimeConfig.js';
import { CompanionLLMService } from '../../src/services/CompanionLLMService.js';
import { runGate, compareGateResults } from './evalGate.js';

// Usage: npm run eval:compare -- --old=luna-legacy:latest --new=luna:latest
// Runs the eval gate (same prompts per mode) against both Ollama models and
// accepts the new one only if it passes the gate and keeps persona consistency.
const runtime = resolveRuntimeConfig();

function arg(name, fallback = '') {
  const found = process.argv.slice(2).find((item) => item.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

async function evaluateModel(model, config) {
  // A throwaway memory file per model, so the eval never touches Luna's real memory.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-eval-'));
  const service = new CompanionLLMService({
    env: { ...process.env, LLM_PROVIDER: 'ollama', LLM_MODEL: model, LLM_FALLBACK_MODEL: model },
    runtime: { memorySqliteFile: path.join(tempDir, 'memory.sqlite'), memoryKey: 'eval' },
  });
  const started = Date.now();
  const report = await runGate(config, service, { modeConfig: service.loadModeConfig() });
  return { model, durationMs: Date.now() - started, ...report };
}

async function main() {
  const oldModel = arg('old', 'luna-legacy:latest');
  const newModel = arg('new', 'luna:latest');
  const configFile = path.resolve(process.cwd(), arg('config', runtime.evalConfigFile));
  assertFileExists(configFile, 'eval config file');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));

  console.error(`Evaluating old model ${oldModel} ...`);
  const oldReport = await evaluateModel(oldModel, config);
  console.error(`Evaluating new model ${newModel} ...`);
  const newReport = await evaluateModel(newModel, config);

  const comparison = compareGateResults(oldReport, newReport);
  const report = { generatedAt: new Date().toISOString(), configFile, oldModel, newModel, comparison, oldReport, newReport };

  ensureDirectory(runtime.evalReportsDir);
  const reportFile = path.join(runtime.evalReportsDir, 'compare-latest.json');
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.table(comparison.cases.map(({ suite, id, mode, old, new: next, change }) => ({ suite, id, mode, old, new: next, change })));
  console.log(JSON.stringify({ reportFile, old: comparison.old, new: comparison.new, newModelAccepted: comparison.newModelAccepted }, null, 2));
  if (!comparison.newModelAccepted) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
