import { checkHardFloor, checkImageVerdictFloor } from './hardFloor.js';
import { LLAMA_GUARD_CATEGORIES } from './guards.js';

const ALL_TEXT_CATEGORIES = Object.values(LLAMA_GUARD_CATEGORIES);
const IMAGE_CATEGORIES = ['sexual-content', 'nudity', 'violent-content', 'gore'];

// Always blocked, whatever the config says (backs up the keyword floor with the guard model).
const FLOOR_GUARD_CATEGORIES = ['child-sexual-exploitation'];

// Defaults per level. The mode config can override `block`, `policies`, `onGuardError`
// and `allowWebSearch`; `localOnly` for adult cannot be switched off.
export const DEFAULT_LEVELS = Object.freeze({
  public: {
    block: [...ALL_TEXT_CATEGORIES, ...IMAGE_CATEGORIES],
    localOnly: false,
    allowWebSearch: true,
    onGuardError: 'block',
  },
  standard: {
    block: [
      'violent-crimes', 'non-violent-crimes', 'sex-crimes', 'child-sexual-exploitation', 'defamation',
      'privacy', 'indiscriminate-weapons', 'hate', 'self-harm', 'sexual-content', 'nudity', 'gore',
    ],
    localOnly: false,
    allowWebSearch: true,
    onGuardError: 'allow',
  },
  adult: {
    block: ['sex-crimes', 'child-sexual-exploitation', 'indiscriminate-weapons', 'self-harm'],
    localOnly: true,
    allowWebSearch: false,
    onGuardError: 'allow',
  },
});

const DEFAULT_MODE_LEVELS = { normal: 'standard', uncensored: 'adult' };

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toList(value) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : null;
}

function parseAge(value) {
  const match = String(value ?? '').match(/\d{1,3}/);
  return match ? Number(match[0]) : NaN;
}

// Luna's own content policy: fixed floor + local guard models + per-mode/character levels.
class ContentPolicy {
  constructor({
    textGuard = null,
    imageGuard = null,
    blockLog = null,
    getPolicyConfig = () => ({}),
  } = {}) {
    this.textGuard = textGuard;
    this.imageGuard = imageGuard;
    this.blockLog = blockLog;
    this.getPolicyConfig = getPolicyConfig;
  }

  getConfig() {
    const config = this.getPolicyConfig();
    return isPlainObject(config) ? config : {};
  }

  // Picks the level name for a mode/character. Adult needs a character configured as 18+.
  resolveLevelName({ mode = 'normal', characterId = '', characterAge = '' } = {}) {
    const config = this.getConfig();
    const fromCharacter = config.characters?.[characterId]?.[mode];
    const fromMode = config.modes?.[mode];
    let name = String(fromCharacter || fromMode || DEFAULT_MODE_LEVELS[mode] || 'standard').toLowerCase();
    if (!DEFAULT_LEVELS[name]) name = 'standard';
    if (name === 'adult') {
      const age = parseAge(characterAge);
      if (!Number.isFinite(age) || age < 18) name = 'standard';
    }
    return name;
  }

  getLevel(name = 'standard') {
    const base = DEFAULT_LEVELS[name] || DEFAULT_LEVELS.standard;
    const override = isPlainObject(this.getConfig().levels?.[name]) ? this.getConfig().levels[name] : {};
    const block = toList(override.block) || base.block;
    return {
      name,
      block: [...new Set([...block, ...FLOOR_GUARD_CATEGORIES])],
      policies: Array.isArray(override.policies)
        ? override.policies.filter((p) => isPlainObject(p) && p.id && p.text).map((p) => ({ id: String(p.id), text: String(p.text) }))
        : [],
      // Adult content never leaves the device, regardless of config.
      localOnly: name === 'adult' ? true : (override.localOnly ?? base.localOnly),
      allowWebSearch: name === 'adult' ? false : (override.allowWebSearch ?? base.allowWebSearch),
      onGuardError: ['allow', 'block'].includes(override.onGuardError) ? override.onGuardError : base.onGuardError,
    };
  }

  resolveLevel(context = {}) {
    return this.getLevel(this.resolveLevelName(context));
  }

  block(result, context) {
    this.blockLog?.record({
      stage: result.stage,
      category: result.category,
      level: result.level,
      mode: context.mode,
      characterId: context.characterId,
    });
    return result;
  }

  async runTextGuard(text, stage, level, context) {
    if (!this.textGuard) return null;
    try {
      const verdict = await this.textGuard.classifyText({
        text, stage, context: context.previousMessage || '', policies: level.policies,
      });
      const hit = (verdict?.categories || []).find((category) => level.block.includes(category)
        || level.policies.some((policy) => policy.id === category));
      return hit ? { category: hit } : null;
    } catch {
      return level.onGuardError === 'block' ? { category: 'guard-unavailable' } : null;
    }
  }

  // stage: 'input' | 'output' | 'image-prompt'
  async checkText({ text = '', stage = 'input', levelName = '', ...context } = {}) {
    const level = levelName ? this.getLevel(levelName) : this.resolveLevel(context);
    const floor = checkHardFloor(text, {
      kind: stage === 'image-prompt' ? 'image-prompt' : 'text',
      allowedNames: context.allowedNames || [],
    });
    if (floor.blocked) {
      return this.block({ allowed: false, stage, level: level.name, category: floor.category }, context);
    }
    const guardHit = await this.runTextGuard(text, stage === 'image-prompt' ? 'input' : stage, level, context);
    if (guardHit) {
      return this.block({ allowed: false, stage, level: level.name, category: guardHit.category }, context);
    }
    return { allowed: true, stage, level: level.name, category: '' };
  }

  async checkImage({ base64 = '', levelName = '', ...context } = {}) {
    const level = levelName ? this.getLevel(levelName) : this.resolveLevel(context);
    const stage = 'image-output';
    const imageOnError = this.getConfig().imageGuard?.onError === 'allow' && level.name !== 'public' ? 'allow' : 'block';

    if (!this.imageGuard) {
      // Without an image guard only the prompt was checked; public output needs a real check.
      if (level.name === 'public' || imageOnError === 'block') {
        return this.block({ allowed: false, stage, level: level.name, category: 'image-guard-missing' }, context);
      }
      return { allowed: true, stage, level: level.name, category: '', unchecked: true };
    }

    let verdict;
    try {
      verdict = await this.imageGuard.classifyImage({ base64 });
    } catch {
      if (imageOnError === 'block') {
        return this.block({ allowed: false, stage, level: level.name, category: 'guard-unavailable' }, context);
      }
      return { allowed: true, stage, level: level.name, category: '', unchecked: true };
    }

    const floor = checkImageVerdictFloor(verdict);
    if (floor.blocked) return this.block({ allowed: false, stage, level: level.name, category: floor.category }, context);

    const hits = [
      verdict.sexual && 'sexual-content',
      verdict.nudity && 'nudity',
      verdict.violence && 'violent-content',
      verdict.gore && 'gore',
    ].filter(Boolean);
    const hit = hits.find((category) => level.block.includes(category));
    if (hit) return this.block({ allowed: false, stage, level: level.name, category: hit }, context);
    return { allowed: true, stage, level: level.name, category: '' };
  }

  // Anything that leaves the device (posts, mails) is checked at "public", and
  // content created in an adult (local-only) level can never be queued for sending.
  async checkOutbound({ text = '', originLevel = '', ...context } = {}) {
    if (String(originLevel) === 'adult') {
      return this.block({ allowed: false, stage: 'outbound', level: 'public', category: 'adult-origin' }, context);
    }
    return this.checkText({ text, stage: 'outbound', levelName: 'public', ...context });
  }

  getRecentBlocks(limit = 50) {
    return this.blockLog ? this.blockLog.readRecent(limit) : [];
  }
}

export default ContentPolicy;
