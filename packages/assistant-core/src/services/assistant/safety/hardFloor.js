// The fixed floor. These two rules have no config switch and run in every mode,
// before and after the guard models:
//   1. no sexual content involving minors or anyone who looks underage
//   2. no sexual or intimate images of real, identifiable people
// The word lists are a fast first line (German + English); the local guard
// models are the second line for what keywords miss.

export const FLOOR_CATEGORIES = Object.freeze({
  MINORS: 'floor.minors-sexual',
  REAL_PERSON_IMAGE: 'floor.real-person-intimate-image',
});

const SEXUAL_TERMS = [
  'sex', 'sexy', 'sexual*', 'sexuell*', 'nackt*', 'nude*', 'naked', 'nsfw', 'porn*', 'erotic*', 'erotik',
  'erotisch*', 'horny', 'geil*', 'lewd', 'explicit', 'explizit*', 'intim*', 'lingerie', 'dessous',
  'unterwäsche', 'underwear', 'bikini', 'topless', 'oben ohne', 'orgasm*', 'masturb*', 'blowjob*',
  'fuck*', 'fick*', 'bdsm', 'fetish*', 'fetisch*', 'seduc*', 'verführ*', 'undress*', 'auszieh*', 'strip*',
  'breasts', 'brüste', 'boobs', 'titten', 'pussy', 'penis', 'vagina', 'cum', 'onlyfans', 'deepnude', 'nudify*',
];

// Terms that mark a minor or an underage look. "teen" alone is left out
// because 18/19-year-olds are teens too; explicit ages under 18 are matched below.
const MINOR_TERMS = [
  'child', 'children', 'kid', 'kids', 'minor', 'minors', 'underage', 'under age', 'preteen', 'pre-teen',
  'young teen', 'early teen', 'little girl', 'little boy', 'schoolgirl', 'schoolboy', 'loli', 'lolita', 'shota',
  'toddler', 'infant', 'ein kind', 'einem kind', 'einen kind', 'das kind', 'dem kind', 'kindes', 'kinder',
  'kindlich*', 'minderjährig*', 'jugendliche*', 'schulmädchen', 'schuljunge*', 'kleines mädchen',
  'kleiner junge', 'grundschul*', 'mittelstufe', 'middle school', 'elementary school', 'junior high',
  'looks underage', 'looks young', 'childlike', 'flat chested', 'jailbait',
];

const UNDERAGE_AGE_PATTERN = /\b(?:[1-9]|1[0-7])\s*(?:-|\s)?(?:years?\s*old|y\/?o|jahre?\s*alt|jährige?r?|jaehrige?r?|yrs?)\b/i;

// Phrases that point to a real, identifiable person rather than a fictional character.
const REAL_PERSON_TERMS = [
  'celebrity', 'celeb', 'famous', 'promi', 'prominent', 'star ', 'actress', 'actor', 'schauspieler',
  'singer', 'sängerin', 'sänger', 'influencer', 'streamer', 'youtuber', 'tiktoker', 'politician', 'politiker',
  'my ex', 'meine ex', 'mein ex', 'my girlfriend', 'meine freundin', 'my boyfriend', 'mein freund',
  'my wife', 'meine frau', 'my husband', 'mein mann', 'my neighbor', 'my neighbour', 'nachbarin', 'nachbar',
  'coworker', 'colleague', 'kollegin', 'kollege', 'classmate', 'mitschülerin', 'my teacher', 'lehrerin',
  'my boss', 'chefin', 'real person', 'echte person', 'real woman', 'real man', 'from instagram', 'von instagram',
  'photo of her', 'foto von ihr', 'lookalike', 'face of', 'gesicht von',
  'deepfake', 'face swap', 'faceswap',
];

function normalize(text = '') {
  return ` ${String(text || '').toLowerCase().replace(/\s+/g, ' ')} `;
}

// Terms match whole words; a trailing "*" marks a stem that may continue ("nackt*" matches "nackte").
function containsTerm(source, terms) {
  return terms.some((term) => {
    const isStem = term.endsWith('*');
    const escaped = term.replace(/\*$/, '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}])${escaped}${isStem ? '' : '(?![\\p{L}])'}`, 'iu').test(source);
  });
}

// "of/von/like/wie" followed by two capitalized words that are not a configured
// character name, e.g. "picture of Taylor Swift" or "Bild von Anna Müller".
// The preposition is required because German capitalizes every noun.
function containsPersonName(rawText = '', allowedNames = []) {
  const allowed = new Set(allowedNames.map((name) => String(name || '').toLowerCase()));
  const matches = [...String(rawText || '').matchAll(/(?:^|\s)(?:of|von|like|wie|as|als)\s+(\p{Lu}\p{Ll}+(?:[-\s]\p{Lu}\p{Ll}+)+)/gu)]
    .map((match) => match[1]);
  return matches.some((match) => !match.split(/[-\s]/).some((part) => allowed.has(part.toLowerCase())));
}

export function isSexual(text = '') {
  return containsTerm(normalize(text), SEXUAL_TERMS);
}

export function referencesMinor(text = '') {
  const source = normalize(text);
  return containsTerm(source, MINOR_TERMS) || UNDERAGE_AGE_PATTERN.test(source);
}

// kind: 'text' | 'image-prompt'. Returns { blocked, category }.
export function checkHardFloor(text = '', { kind = 'text', allowedNames = [] } = {}) {
  if (!isSexual(text)) return { blocked: false, category: '' };

  if (referencesMinor(text)) {
    return { blocked: true, category: FLOOR_CATEGORIES.MINORS };
  }

  if (kind === 'image-prompt') {
    const source = normalize(text);
    if (containsTerm(source, REAL_PERSON_TERMS) || containsPersonName(text, allowedNames)) {
      return { blocked: true, category: FLOOR_CATEGORIES.REAL_PERSON_IMAGE };
    }
  }

  return { blocked: false, category: '' };
}

// Floor applied to an image classifier verdict ({ minorSuspected, realPersonSuspected, sexual }).
export function checkImageVerdictFloor(verdict = {}) {
  if (verdict.minorSuspected && verdict.sexual) return { blocked: true, category: FLOOR_CATEGORIES.MINORS };
  if (verdict.minorSuspected && verdict.nudity) return { blocked: true, category: FLOOR_CATEGORIES.MINORS };
  if (verdict.realPersonSuspected && (verdict.sexual || verdict.nudity)) {
    return { blocked: true, category: FLOOR_CATEGORIES.REAL_PERSON_IMAGE };
  }
  return { blocked: false, category: '' };
}
