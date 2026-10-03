import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { parseNvidiaSmi, pickBaseModel, renderModelfile } from '../scripts/model/modelUpgrade.js';
import { evaluateReply, detectLanguage, runGate, compareGateResults } from '../scripts/eval/evalGate.js';

const modeConfig = {
  assistant: { language: 'de', defaultCharacterId: 'luna' },
  assistantProfile: { age: '21' },
  consistencyProfile: { avoidPhrases: ['als KI kann ich'] },
  characterProfiles: { luna: { name: 'Luna', definition: { assistantProfile: {} } }, eva: { name: 'Eva', definition: {} } },
};

test('model upgrade: reads nvidia-smi and picks a model that fits the RTX 4060', () => {
  const [gpu] = parseNvidiaSmi('NVIDIA GeForce RTX 4060 Laptop GPU, 8188, 412\n');
  assert.deepEqual(gpu, { name: 'NVIDIA GeForce RTX 4060 Laptop GPU', totalMiB: 8188, usedMiB: 412 });
  assert.equal(pickBaseModel(gpu.totalMiB).tag, 'huihui_ai/qwen3.5-abliterated:9b-q4_K');
  assert.equal(pickBaseModel(6144).tag, 'huihui_ai/qwen3.5-abliterated:4b');
  assert.equal(pickBaseModel(24576).tag, 'huihui_ai/qwen3.5-abliterated:27b');
  assert.deepEqual(parseNvidiaSmi('command not found'), []);
});

test('model upgrade: Modelfile keeps the system prompt and cannot be broken out of', () => {
  const template = fs.readFileSync(path.resolve('config/ollama/Modelfile.luna.template'), 'utf8');
  const rendered = renderModelfile(template, { from: 'base:tag', system: 'Du bist Luna. """ PARAMETER x', numCtx: 8192 });
  assert.match(rendered, /^FROM base:tag$/m);
  assert.match(rendered, /^PARAMETER num_ctx 8192$/m);
  assert.equal(rendered.match(/"""/g).length, 2);
  assert.throws(() => renderModelfile(template, { system: 'x' }), /FROM/);
});

test('eval: config-driven persona checks (name, age, language, avoid phrases)', () => {
  const checks = { mustIncludeCharacterName: true, mustIncludeConfigAge: true, mustNotIncludeAvoidPhrases: true, expectConfigLanguage: true };
  assert.equal(evaluateReply('Ich bin Luna und ich bin 21, schön dich heute zu sehen.', checks, { modeConfig, characterId: 'luna' }).passed, true);
  const drift = evaluateReply('I am Qwen, a large language model, and you are welcome.', checks, { modeConfig, characterId: 'luna' });
  assert.equal(drift.passed, false);
  assert.equal(drift.languagePass, false);
  assert.equal(evaluateReply('Ich bin Luna, 21. Als KI kann ich das nicht.', checks, { modeConfig, characterId: 'luna' }).mustNotIncludePass, false);
  assert.equal(detectLanguage('Das ist für dich und mich'), 'de');
});

function fakeService(replies) {
  const characters = {};
  return {
    setCharacter: (userId, id) => { characters[userId] = id; },
    resetUserState: () => {},
    chat: async ({ userId, mode }) => ({ reply: replies[`${characters[userId]}:${mode}`] || '' }),
  };
}

test('eval: the same prompts run per character/mode and old vs new is compared', async () => {
  const config = {
    minOverallPassRate: 0.5,
    suites: [{
      id: 'persona-consistency',
      minPassRate: 0.5,
      cases: [
        { id: 'luna-normal', characterId: 'luna', mode: 'normal', checks: { mustIncludeCharacterName: true } },
        { id: 'luna-uncensored', characterId: 'luna', mode: 'uncensored', checks: { mustIncludeCharacterName: true } },
        { id: 'eva-normal', characterId: 'eva', mode: 'normal', checks: { mustIncludeCharacterName: true } },
      ],
    }],
  };
  const oldReport = await runGate(config, fakeService({ 'luna:normal': 'Luna hier', 'luna:uncensored': 'I am an AI', 'eva:normal': 'Eva hier' }), { modeConfig });
  const newReport = await runGate(config, fakeService({ 'luna:normal': 'Luna hier', 'luna:uncensored': 'Luna, immer', 'eva:normal': 'Eva hier' }), { modeConfig });
  const comparison = compareGateResults(oldReport, newReport);
  assert.equal(comparison.old.personaPassRate, 2 / 3);
  assert.equal(comparison.new.personaPassRate, 1);
  assert.deepEqual(comparison.fixes.map((item) => item.id), ['luna-uncensored']);
  assert.equal(comparison.regressions.length, 0);
  assert.equal(comparison.newModelAccepted, true);

  const worse = compareGateResults(newReport, oldReport);
  assert.equal(worse.newModelAccepted, false);
  assert.deepEqual(worse.regressions.map((item) => item.id), ['luna-uncensored']);
});

test('eval: the shipped gate config has persona cases for every character and mode', () => {
  const gate = JSON.parse(fs.readFileSync(path.resolve('config/eval/gate.config.json'), 'utf8'));
  const persona = gate.suites.find((suite) => suite.id === 'persona-consistency');
  const covered = new Set(persona.cases.map((item) => `${item.characterId}:${item.mode}`));
  for (const key of ['luna:normal', 'luna:uncensored', 'eva:normal']) assert.ok(covered.has(key), key);
});
