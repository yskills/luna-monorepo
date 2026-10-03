// Shared eval-gate logic: runs the same prompts per character/mode against a
// CompanionLLMService and scores the replies with simple, explainable checks.

const GERMAN_MARKERS = ['und', 'ich', 'du', 'nicht', 'ist', 'der', 'die', 'das', 'mit', 'für', 'dein', 'heute'];
const ENGLISH_MARKERS = ['and', 'the', 'you', 'not', 'is', 'with', 'for', 'your', 'today', 'this', 'are'];

export function normalizeText(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function includesAny(text = '', terms = []) {
  if (!Array.isArray(terms) || !terms.length) return true;
  const source = normalizeText(text);
  return terms.some((term) => source.includes(normalizeText(term)));
}

export function includesAll(text = '', terms = []) {
  if (!Array.isArray(terms) || !terms.length) return true;
  const source = normalizeText(text);
  return terms.every((term) => source.includes(normalizeText(term)));
}

// Rough language guess from common function words; enough to catch a model that drifts to English.
export function detectLanguage(text = '') {
  const words = normalizeText(text).split(/[^\p{L}]+/u);
  const count = (markers) => words.filter((word) => markers.includes(word)).length;
  const de = count(GERMAN_MARKERS);
  const en = count(ENGLISH_MARKERS);
  if (!de && !en) return 'unknown';
  return de >= en ? 'de' : 'en';
}

function resolveCharacter(modeConfig = {}, characterId = '') {
  const id = characterId || modeConfig?.assistant?.defaultCharacterId || 'luna';
  const character = modeConfig?.characterProfiles?.[id] || {};
  return {
    name: character.name || id,
    age: character.definition?.assistantProfile?.age || modeConfig?.assistantProfile?.age || '',
  };
}

// Expands config-driven checks (character name, age, language, avoid phrases) into plain term lists.
export function evaluateReply(reply = '', checks = {}, { modeConfig = {}, characterId = '' } = {}) {
  const character = resolveCharacter(modeConfig, characterId);
  const mustIncludeAll = [...(checks.mustIncludeAll || [])];
  if (checks.mustIncludeCharacterName) mustIncludeAll.push(character.name);
  if (checks.mustIncludeConfigAge && /\d/.test(character.age)) mustIncludeAll.push(String(character.age).match(/\d+/)[0]);

  const forbidden = [...(checks.mustNotIncludeAny || [])];
  if (checks.mustNotIncludeAvoidPhrases) forbidden.push(...(modeConfig?.consistencyProfile?.avoidPhrases || []));

  const expectedLanguage = checks.expectConfigLanguage ? String(modeConfig?.assistant?.language || '').slice(0, 2) : '';
  const detected = expectedLanguage ? detectLanguage(reply) : '';

  const result = {
    mustIncludePass: includesAny(reply, checks.mustIncludeAny || []),
    mustIncludeAllPass: includesAll(reply, mustIncludeAll),
    mustNotIncludePass: !forbidden.length || !includesAny(reply, forbidden),
    maxCharsPass: Number.isFinite(Number(checks.maxChars)) ? reply.length <= Number(checks.maxChars) : true,
    languagePass: !expectedLanguage || detected === expectedLanguage,
  };
  return { ...result, passed: Object.values(result).every(Boolean), detectedLanguage: detected || undefined };
}

export async function runCase(testCase, service, { modeConfig = {} } = {}) {
  const characterId = String(testCase.characterId || '').toLowerCase();
  const userId = `eval-${characterId || 'default'}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  let reply = '';
  let error = null;
  let meta = {};

  try {
    if (characterId && typeof service.setCharacter === 'function') service.setCharacter(userId, characterId);
    const result = await service.chat({
      message: String(testCase.message || ''),
      snapshot: {},
      userId,
      mode: String(testCase.mode || 'normal'),
    });
    reply = String(result?.reply || '');
    meta = result?.meta || {};
  } catch (err) {
    error = String(err?.message || err);
  } finally {
    try {
      service.resetUserState(userId);
    } catch {
      // ignore reset failures in eval cleanup
    }
  }

  const checks = evaluateReply(reply, testCase.checks || {}, { modeConfig, characterId });
  return {
    id: testCase.id,
    characterId,
    mode: testCase.mode || 'normal',
    passed: !error && checks.passed,
    error,
    checks,
    blocked: meta.blocked || null,
    reply,
    replyLength: reply.length,
  };
}

export async function runSuite(suite, service, options = {}) {
  const cases = Array.isArray(suite?.cases) ? suite.cases : [];
  const caseResults = [];
  for (const testCase of cases) {
    // eslint-disable-next-line no-await-in-loop
    caseResults.push(await runCase(testCase, service, options));
  }
  const casesPassed = caseResults.filter((item) => item.passed).length;
  const passRate = cases.length ? casesPassed / cases.length : 0;
  return {
    id: suite.id,
    description: suite.description || '',
    weight: Number(suite.weight || 1),
    minPassRate: Number(suite.minPassRate || 0),
    casesTotal: cases.length,
    casesPassed,
    passRate,
    passed: passRate >= Number(suite.minPassRate || 0),
    caseResults,
  };
}

export async function runGate(config = {}, service, options = {}) {
  const suites = Array.isArray(config?.suites) ? config.suites : [];
  const suiteResults = [];
  for (const suite of suites) {
    // eslint-disable-next-line no-await-in-loop
    suiteResults.push(await runSuite(suite, service, options));
  }
  const weightSum = suiteResults.reduce((sum, item) => sum + Math.max(0, item.weight), 0) || 1;
  const weightedPassRate = suiteResults.reduce((sum, item) => sum + item.passRate * Math.max(0, item.weight), 0) / weightSum;
  const suitesPassed = suiteResults.every((suite) => suite.passed);
  const minOverallPassRate = Number(config?.minOverallPassRate || 0);
  return {
    minOverallPassRate,
    weightedPassRate,
    suitesPassed,
    overallPassed: suitesPassed && weightedPassRate >= minOverallPassRate,
    suiteResults,
  };
}

// Old vs new on the same prompts. The new model must pass the gate and must not
// lose persona consistency compared to the old one.
export function compareGateResults(oldReport, newReport, { personaSuiteId = 'persona-consistency' } = {}) {
  const personaRate = (report) => report.suiteResults.find((suite) => suite.id === personaSuiteId)?.passRate ?? 0;
  const cases = newReport.suiteResults.flatMap((suite) => suite.caseResults.map((item) => {
    const before = oldReport.suiteResults.find((s) => s.id === suite.id)?.caseResults.find((c) => c.id === item.id);
    return {
      suite: suite.id,
      id: item.id,
      mode: item.mode,
      characterId: item.characterId,
      old: before ? before.passed : null,
      new: item.passed,
      change: before && before.passed !== item.passed ? (item.passed ? 'fixed' : 'regressed') : 'same',
    };
  }));
  const oldPersona = personaRate(oldReport);
  const newPersona = personaRate(newReport);
  return {
    old: { weightedPassRate: oldReport.weightedPassRate, personaPassRate: oldPersona, overallPassed: oldReport.overallPassed },
    new: { weightedPassRate: newReport.weightedPassRate, personaPassRate: newPersona, overallPassed: newReport.overallPassed },
    regressions: cases.filter((item) => item.change === 'regressed'),
    fixes: cases.filter((item) => item.change === 'fixed'),
    cases,
    newModelAccepted: newReport.overallPassed && newPersona >= oldPersona,
  };
}
