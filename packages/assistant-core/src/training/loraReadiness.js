import { MIN_CURATED_FOR_LORA } from '../config/runtimeConfig.js';

// Memory (history, summaries, notes) is Luna's main learning path.
// A LoRA run only makes sense once enough curated pairs exist.
export function describeLoraReadiness(curatedCount = 0, required = MIN_CURATED_FOR_LORA) {
  const curated = Math.max(0, Number(curatedCount) || 0);
  const minimum = Math.max(MIN_CURATED_FOR_LORA, Number(required) || MIN_CURATED_FOR_LORA);
  const missing = Math.max(0, minimum - curated);
  return {
    curated,
    required: minimum,
    missing,
    ready: missing === 0,
    message: missing === 0
      ? `Curated samples: ${curated}/${minimum}. Enough for a LoRA run.`
      : `Curated samples: ${curated}/${minimum}. ${missing} more needed before LoRA training; keep learning through memory until then.`,
  };
}

export default describeLoraReadiness;
