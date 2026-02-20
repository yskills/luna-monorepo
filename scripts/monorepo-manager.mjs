import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const targets = {
  core: 'packages/assistant-core',
  service: 'apps/assistant-service',
  sdk: 'packages/assistant-sdk',
  web: 'apps/personal-luna'
};

const task = process.argv[2];
const targetArg = process.argv[3] || 'all';

const validTasks = new Set(['install', 'build', 'update']);
if (!validTasks.has(task)) {
  printUsageAndExit(`Unbekannter Task: ${task || '(leer)'}`);
}

const selectedTargets = resolveTargets(targetArg);

for (const target of selectedTargets) {
  if (task === 'install') runNpm(target, ['install']);
  if (task === 'update') runNpm(target, ['update']);
  if (task === 'build') runBuild(target);
}

console.log(`✅ ${task} erfolgreich für: ${selectedTargets.join(', ')}`);

function resolveTargets(raw) {
  if (raw === 'all') {
    return ['core', 'service', 'sdk', 'web'];
  }

  if (!targets[raw]) {
    printUsageAndExit(`Unbekanntes Target: ${raw}`);
  }

  return [raw];
}

function runBuild(target) {
  switch (target) {
    case 'core':
      runNodeCheck('packages/assistant-core/src/index.js');
      return;
    case 'service':
      runNodeCheck('apps/assistant-service/src/server.mjs');
      return;
    case 'sdk':
      runNodeCheck('packages/assistant-sdk/src/index.js');
      return;
    case 'web':
      runNpm('web', ['run', 'build']);
      return;
    default:
      printUsageAndExit(`Build nicht unterstützt für Target: ${target}`);
  }
}

function runNodeCheck(relativeFile) {
  const filePath = path.join(rootDir, relativeFile);
  run('node', ['--check', filePath], rootDir);
}

function runNpm(target, args) {
  const cwd = path.join(rootDir, targets[target]);
  run('npm', args, cwd);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function printUsageAndExit(message) {
  console.error(`❌ ${message}`);
  console.error('Verwendung: node scripts/monorepo-manager.mjs <install|build|update> <all|core|service|sdk|web>');
  process.exit(1);
}
