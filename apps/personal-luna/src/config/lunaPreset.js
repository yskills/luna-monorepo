export const LUNA_PRESET = {
  characterId: 'luna',
  mode: 'normal',
  profile: {
    name: 'Luna',
    style: 'tsundere-playful-direct',
    voicePreset: 'egirl-cute',
    avatarProfileImage: 'https://api.dicebear.com/9.x/lorelei/svg?seed=luna-cute-egirl',
  },
  modePresetMap: {
    normal: 'luna-tsundere',
    uncensored: 'luna-uncensored-explicit',
  },
}

const SUPPORTED_MODES = new Set(['normal', 'uncensored'])

export class LunaPresetRegistry {
  constructor(config = LUNA_PRESET) {
    this.config = config
  }

  getCharacterId() {
    return String(this.config?.characterId || 'luna').trim().toLowerCase() || 'luna'
  }

  getDefaultMode() {
    const mode = String(this.config?.mode || 'normal').trim().toLowerCase()
    return SUPPORTED_MODES.has(mode) ? mode : 'normal'
  }

  resolvePresetId(mode = 'normal') {
    const normalizedMode = String(mode || '').trim().toLowerCase()
    if (!SUPPORTED_MODES.has(normalizedMode)) return ''
    return String(this.config?.modePresetMap?.[normalizedMode] || '').trim()
  }

  getProfile() {
    return {
      name: String(this.config?.profile?.name || 'Luna').trim() || 'Luna',
      style: String(this.config?.profile?.style || '').trim(),
      voicePreset: String(this.config?.profile?.voicePreset || '').trim(),
      avatarProfileImage: String(this.config?.profile?.avatarProfileImage || '').trim(),
    }
  }
}

export const lunaPresetRegistry = new LunaPresetRegistry()
