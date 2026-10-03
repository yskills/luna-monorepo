import fs from 'fs';
import path from 'path';
import {
  assertFileExists,
  ensureDirectory,
  resolveRuntimeConfig,
} from '../../src/config/runtimeConfig.js';
import { runGate } from './evalGate.js';

const runtime = resolveRuntimeConfig();
const REPORT_DIR = runtime.evalReportsDir;
const REPORT_FILE = path.join(REPORT_DIR, 'latest.json');

function parseArgs() {
  const configArg = process.argv.slice(2).find((arg) => arg.startsWith('--config='));
  return {
    configFile: configArg ? path.resolve(process.cwd(), configArg.split('=')[1]) : runtime.evalConfigFile,
  };
}

async function main() {
  const { configFile } = parseArgs();
  assertFileExists(runtime.modeConfigFile, 'assistant mode config file');
  assertFileExists(configFile, 'eval config file');
  const { default: service } = await import('../../src/services/CompanionLLMService.js');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));

  const result = await runGate(config, service, { modeConfig: service.loadModeConfig() });
  const report = { generatedAt: new Date().toISOString(), configFile, model: service.model, ...result };

  ensureDirectory(REPORT_DIR);
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (!report.overallPassed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
