import fs from 'fs';
import path from 'path';

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Resolves a configured reference image strictly inside the reference directory.
export function resolveReferencePath(referenceDir, relativePath) {
  const base = path.resolve(referenceDir);
  const resolved = path.resolve(base, String(relativePath || ''));
  if (!resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Reference image must stay inside the reference folder: ${relativePath}`);
  }
  return resolved;
}

// Generates images for a character: checks the prompt, renders it with the configured
// provider, checks the result, and only then stores it. Blocked images are never written.
class ImageService {
  constructor({
    providers = {},
    contentPolicy,
    store,
    getConfig = () => ({}),
    referenceDir = '',
  } = {}) {
    if (!contentPolicy) throw new Error('ImageService requires a contentPolicy.');
    if (!store) throw new Error('ImageService requires a store.');
    this.providers = providers;
    this.contentPolicy = contentPolicy;
    this.store = store;
    this.getConfig = getConfig;
    this.referenceDir = referenceDir;
  }

  getCharacterImageConfig(characterId = '') {
    const config = this.getConfig() || {};
    const global = isPlainObject(config.imageGeneration) ? config.imageGeneration : {};
    const character = isPlainObject(config.characterProfiles?.[characterId]?.image)
      ? config.characterProfiles[characterId].image
      : {};
    return { ...(global.defaults || {}), ...character, defaultProvider: global.defaultProvider || 'comfyui' };
  }

  pickProvider(imageConfig, level) {
    const wanted = this.providers[imageConfig.provider || imageConfig.defaultProvider];
    if (wanted && (!level.localOnly || wanted.isLocal())) return wanted;
    const local = Object.values(this.providers).find((provider) => provider.isLocal());
    if (local && level.localOnly) return local;
    if (wanted) return wanted;
    throw new Error('No image provider is configured.');
  }

  async generate({ prompt = '', mode = 'normal', characterId = 'luna', characterName = '', characterAge = '' } = {}) {
    const userPrompt = String(prompt || '').trim().slice(0, 1000);
    if (!userPrompt) throw new Error('prompt is required.');

    const context = { mode, characterId, characterAge, allowedNames: [characterName, characterId].filter(Boolean) };
    const level = this.contentPolicy.resolveLevel(context);
    const imageConfig = this.getCharacterImageConfig(characterId);
    const fullPrompt = [imageConfig.stylePrompt, userPrompt].filter(Boolean).join(', ');

    const promptCheck = await this.contentPolicy.checkText({ text: userPrompt, stage: 'image-prompt', ...context });
    if (!promptCheck.allowed) return { blocked: true, stage: promptCheck.stage, category: promptCheck.category, level: level.name };

    const provider = this.pickProvider(imageConfig, level);
    const configuredReferences = (Array.isArray(imageConfig.referenceImages) ? imageConfig.referenceImages : [])
      .map((item) => resolveReferencePath(this.referenceDir, item));
    // Missing reference files are skipped (reported back) instead of failing the image.
    const referenceImages = configuredReferences.filter((filePath) => fs.existsSync(filePath));

    const result = await provider.generate({
      prompt: fullPrompt,
      negativePrompt: imageConfig.negativePrompt || '',
      workflow: imageConfig.workflow,
      checkpoint: imageConfig.checkpoint,
      textEncoder: imageConfig.textEncoder,
      vae: imageConfig.vae,
      referenceImages,
      width: imageConfig.width,
      height: imageConfig.height,
      steps: imageConfig.steps,
    });

    const imageCheck = await this.contentPolicy.checkImage({ base64: result.buffer.toString('base64'), ...context });
    if (!imageCheck.allowed) {
      return { blocked: true, stage: imageCheck.stage, category: imageCheck.category, level: level.name };
    }

    const saved = this.store.save(result.buffer, {
      mimeType: result.mimeType,
      characterId,
      mode,
      level: level.name,
      // Adult images must never be posted or mailed (see ContentPolicy.checkOutbound).
      localOnly: level.localOnly,
      provider: provider.id,
      prompt: userPrompt,
      createdAt: new Date().toISOString(),
    });

    return {
      blocked: false,
      image: {
        id: saved.id,
        url: `/assistant/image/${saved.id}`,
        mimeType: saved.mimeType,
        width: result.width,
        height: result.height,
        provider: provider.id,
        level: level.name,
        localOnly: level.localOnly,
        referencesUsed: result.referencesUsed || 0,
        referencesMissing: configuredReferences.length - referenceImages.length,
        unchecked: !!imageCheck.unchecked,
      },
    };
  }

  getImage(id) {
    return this.store.get(id);
  }
}

export default ImageService;
