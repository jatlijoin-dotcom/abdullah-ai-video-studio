'use strict';
/**
 * storyboard.js — the story engine.
 *
 * A REAL, deterministic, rule-based storyboard builder. It needs no API key:
 * given one story prompt it produces a title, a logline and a full scene
 * plan (4 scenes for 30s, 8 scenes for 60s) with, per scene:
 * setting, action, camera movement, transition, a narration line in the
 * requested language (Roman Urdu / Roman Hindi / English) and a complete
 * videoPrompt for the AI clip model.
 *
 * CHARACTER LOCK: the character description block is repeated VERBATIM in
 * every scene's videoPrompt so the clip model gets the same identity
 * reference every time. This is the strongest consistency signal available
 * to text-to-video models; for image-to-video models the reference image
 * is additionally passed by the provider adapters.
 *
 * Honest limits (also stated in README.md): this engine writes the plan;
 * it does NOT generate video. Real clips still need a configured provider
 * (Omni / Veo GA / Runway / Kling / Luma). Without one, the backend runs in
 * Demo Mode and returns this storyboard as a downloadable plan — never a
 * fake video.
 *
 * PER-CHARACTER VOICES: each scene also carries dialogue[] — 1–2 short
 * spoken lines for the story's characters (Abdullah and his father Abbu),
 * each with its own voiceId, plus the narration (narrator voice, separate
 * from dialogue). See DEFAULT_VOICES and DIALOGUE below.
 */

const MODES = ['realistic', 'cartoon'];
const LANGUAGES = ['ur', 'hi', 'en'];
const ASPECTS = ['9:16', '16:9'];
const DURATIONS = [30, 60];

const MODE_STYLE = {
  realistic:
    'Photorealistic cinematic live-action video, natural human faces, ' +
    'realistic skin texture, natural lighting, 35mm film look, ' +
    'shallow depth of field, lifelike motion.',
  cartoon:
    'High-quality 3D Pixar-style cartoon animation, expressive big eyes, ' +
    'smooth character animation, vibrant colours, soft studio lighting, ' +
    'charming storybook look.',
};

const LANGUAGE_LABEL = { ur: 'Urdu (Roman Urdu)', hi: 'Hindi (Roman Hindi)', en: 'English' };

const NEGATIVE_PROMPT = {
  realistic:
    'blurry, distorted face, extra fingers, deformed hands, warped body, ' +
    'watermark, text, logo, subtitles, low quality, duplicate characters, ' +
    'changing clothes, changing face, plastic skin, cartoon, animation',
  cartoon:
    'photorealistic, live action, real human, blurry, distorted face, ' +
    'extra fingers, deformed hands, watermark, text, logo, low quality, ' +
    'duplicate characters, changing clothes, changing face, scary, horror',
};

/** Story beats. 60s uses all 8; 30s uses beats 0, 1, 6, 7. */
const BEATS = [
  {
    key: 'hook',
    setting: 'A dramatic opening wide shot, golden morning light, the hero stands facing a vast landscape',
    action: 'The hero looks straight at the camera with determination, wind in his hair, as the story begins',
    camera: 'Slow push-in from a wide shot to a close-up of the hero’s face',
    transition: 'cut',
  },
  {
    key: 'intro',
    setting: 'A peaceful village street in the morning, birds, warm sunlight, everyday life around the hero',
    action: 'The hero walks through the village, greeting people, full of energy and hope for the day',
    camera: 'Tracking shot following the hero from behind, then circling to the front',
    transition: 'dissolve',
  },
  {
    key: 'rising',
    setting: 'A winding path leading into a forest / hills, light breaking through the trees',
    action: 'The hero starts his journey, stepping onto the path with a small bag, looking ahead with curiosity',
    camera: 'Wide establishing shot, slow pan right following the hero’s walk',
    transition: 'cut',
  },
  {
    key: 'challenge',
    setting: 'The path grows dark and quiet, shadows move, tension in the air',
    action: 'Something unexpected blocks the hero’s way — he stops, surprised, and studies the danger',
    camera: 'Low-angle shot, slow tilt up to reveal the obstacle',
    transition: 'cut',
  },
  {
    key: 'conflict',
    setting: 'Close quarters, the hero face to face with the danger, dust and dramatic light',
    action: 'The hero struggles, steps back, breathes hard, but refuses to give up',
    camera: 'Handheld-style close-up with slight shake, cutting between hero and danger',
    transition: 'dissolve',
  },
  {
    key: 'turning',
    setting: 'A shaft of light breaks through, the hero’s expression changes from fear to courage',
    action: 'The hero remembers his purpose, stands tall, and takes one brave step forward',
    camera: 'Slow dolly-in on the hero’s face as his eyes light up',
    transition: 'fade',
  },
  {
    key: 'climax',
    setting: 'The big moment — open ground, dramatic sky, the hero against the danger in full action',
    action: 'The hero acts with all his courage and turns the situation around in a single bold move',
    camera: 'Crane shot rising above the action, then a fast push-in on the hero’s triumphant face',
    transition: 'wipe',
  },
  {
    key: 'resolution',
    setting: 'Warm sunset, the village / home again, peaceful and golden, the hero smiles',
    action: 'The hero returns safe, hugs his loved ones, and the moral of the story appears on screen',
    camera: 'Slow zoom out to a wide sunset shot, the hero waving at the camera',
    transition: 'fade to black',
  },
];

const NARRATION = {
  ur: {
    hook: [
      'Ruko! Ye kahani aap ko end tak baandh kar rakhegi.',
      'Ek aisi kahani, jo aap kabhi nahi bhoolenge.',
    ],
    intro: [
      'Ek din, Abdullah ek naye safar par nikla.',
      'Gaon mein ek bahadur ladka rehta tha — Abdullah.',
    ],
    rising: [
      'Rasta mushkil tha, lekin us ne himmat nahi haari.',
      'Aage badhte hue, use ek ajeeb si awaaz sunai di.',
    ],
    challenge: [
      'Achanak, us ke saamne ek bada khatra aa gaya.',
      'Tabhi sab kuch badal gaya — mushkil us ke saamne thi.',
    ],
    conflict: [
      'Abdullah darr gaya, lekin us ne peeche hatne se inkaar kar diya.',
      'Mushkil lamha tha, magar us ka dil mazboot tha.',
    ],
    turning: [
      'Phir us ne ek aisi himmat dikhai ke sab hairan reh gaye.',
      'Us lamhe mein, us ne faisla kar liya — ab peeche nahi hatna.',
    ],
    climax: [
      'Aur phir, Abdullah ne woh kar dikhaya jo koi soch bhi nahi sakta tha!',
      'Aakhir mein, us ki bahaduri ne sab kuch badal diya.',
    ],
    resolution: [
      'Moral: sachhi bahaduri dil mein hoti hai, taqat mein nahi.',
      'Agar kahani pasand aayi to like karein aur subscribe karein — Abdullah Ki Duniya.',
    ],
  },
  hi: {
    hook: [
      'Ruko! Ye kahani aapko ant tak bandhe rakhegi.',
      'Ek aisi kahani, jo aap kabhi nahi bhoolenge.',
    ],
    intro: [
      'Ek din, Abdullah ek naye safar par nikla.',
      'Gaon mein ek bahadur ladka rehta tha — Abdullah.',
    ],
    rising: [
      'Raasta mushkil tha, lekin usne himmat nahi haari.',
      'Aage badhte hue, use ek ajeeb si awaaz sunai di.',
    ],
    challenge: [
      'Achanak, uske saamne ek bada khatra aa gaya.',
      'Tabhi sab kuch badal gaya — mushkil uske saamne thi.',
    ],
    conflict: [
      'Abdullah darr gaya, lekin usne peeche hatne se inkaar kar diya.',
      'Mushkil lamha tha, magar uska dil mazboot tha.',
    ],
    turning: [
      'Phir usne aisi himmat dikhayi ke sab hairan reh gaye.',
      'Us lamhe mein, usne faisla kar liya — ab peeche nahi hatna.',
    ],
    climax: [
      'Aur phir, Abdullah ne woh kar dikhaya jo koi soch bhi nahi sakta tha!',
      'Aakhir mein, uski bahaduri ne sab kuch badal diya.',
    ],
    resolution: [
      'Seekh: sachhi bahaduri dil mein hoti hai, taakat mein nahi.',
      'Agar kahani pasand aayi to like karein aur subscribe karein — Abdullah Ki Duniya.',
    ],
  },
  en: {
    hook: [
      'Wait! This story will keep you watching till the very end.',
      'A story you will never forget.',
    ],
    intro: [
      'One day, Abdullah set out on a brand-new journey.',
      'In a small village lived a brave boy — Abdullah.',
    ],
    rising: [
      'The road was hard, but he never lost courage.',
      'As he walked on, he heard a strange sound ahead.',
    ],
    challenge: [
      'Suddenly, a great danger appeared before him.',
      'In that moment, everything changed — trouble stood in his way.',
    ],
    conflict: [
      'Abdullah was afraid, but he refused to step back.',
      'It was a hard moment, but his heart stayed strong.',
    ],
    turning: [
      'Then he showed a courage that left everyone amazed.',
      'In that moment he decided — there is no going back.',
    ],
    climax: [
      'And then, Abdullah did what nobody thought possible!',
      'In the end, his bravery changed everything.',
    ],
    resolution: [
      'Moral: true bravery lives in the heart, not in strength.',
      'If you liked the story, like and subscribe — Abdullah Ki Duniya.',
    ],
  },
};

/**
 * DIALOGUE — real spoken lines per beat, for Abdullah and his father Abbu.
 * Each beat has 1–2 lines in the requested language (Roman Urdu / Roman
 * Hindi / English). These are story lines, not filler. The voice for each
 * line comes from DEFAULT_VOICES[language][key] unless the project or the
 * character profile overrides it (see resolveVoices).
 */
const DIALOGUE = {
  ur: {
    hook: [
      { character: 'Abdullah', key: 'abdullah', line: 'Aaj ka din meri zindagi badal dega!' },
      { character: 'Abbu', key: 'abbu', line: 'Beta, sambhal kar jana, main dua karoon ga.' },
    ],
    intro: [
      { character: 'Abbu', key: 'abbu', line: 'Beta, gaon ke log tum par fakhar karte hain.' },
      { character: 'Abdullah', key: 'abdullah', line: 'Abbu, aap ki dua saath hai to kuch mushkil nahi.' },
    ],
    rising: [
      { character: 'Abdullah', key: 'abdullah', line: 'Rasta mushkil hai, lekin main rukoon ga nahi.' },
      { character: 'Abbu', key: 'abbu', line: 'Himmat mat haarna, beta, main tumhare saath hoon.' },
    ],
    challenge: [
      { character: 'Abdullah', key: 'abdullah', line: 'Ye kya hai? Aage khatra hai!' },
      { character: 'Abbu', key: 'abbu', line: 'Beta, peeche hat jao, ye khatarnak hai!' },
    ],
    conflict: [
      { character: 'Abdullah', key: 'abdullah', line: 'Main darr raha hoon, lekin Abbu ko akela nahi chhod sakta.' },
      { character: 'Abbu', key: 'abbu', line: 'Beta, main yahin hoon, himmat rakho!' },
    ],
    turning: [
      { character: 'Abdullah', key: 'abdullah', line: 'Ab bas! Ab main peeche nahi hatoon ga.' },
      { character: 'Abbu', key: 'abbu', line: 'Shabash beta, mujhe tum par fakhar hai.' },
    ],
    climax: [
      { character: 'Abdullah', key: 'abdullah', line: 'Abbu, main aa gaya! Aap ko kuch nahi hoga!' },
      { character: 'Abbu', key: 'abbu', line: 'Beta, tum ne kar dikhaya, tum bahadur ho!' },
    ],
    resolution: [
      { character: 'Abbu', key: 'abbu', line: 'Mera beta mera fakhar hai.' },
      { character: 'Abdullah', key: 'abdullah', line: 'Maa baap ki dua hi sab se badi taqat hai.' },
    ],
  },
  hi: {
    hook: [
      { character: 'Abdullah', key: 'abdullah', line: 'Aaj ka din meri zindagi badal dega!' },
      { character: 'Abbu', key: 'abbu', line: 'Beta, sambhal kar jana, main dua karunga.' },
    ],
    intro: [
      { character: 'Abbu', key: 'abbu', line: 'Beta, gaon ke log tum par fakhar karte hain.' },
      { character: 'Abdullah', key: 'abdullah', line: 'Abbu, aap ki dua saath hai to kuch mushkil nahi.' },
    ],
    rising: [
      { character: 'Abdullah', key: 'abdullah', line: 'Raasta mushkil hai, lekin main rukunga nahi.' },
      { character: 'Abbu', key: 'abbu', line: 'Himmat mat haarna, beta, main tumhare saath hoon.' },
    ],
    challenge: [
      { character: 'Abdullah', key: 'abdullah', line: 'Ye kya hai? Aage khatra hai!' },
      { character: 'Abbu', key: 'abbu', line: 'Beta, peeche hat jao, ye khatarnak hai!' },
    ],
    conflict: [
      { character: 'Abdullah', key: 'abdullah', line: 'Main darr raha hoon, lekin Abbu ko akela nahi chhod sakta.' },
      { character: 'Abbu', key: 'abbu', line: 'Beta, main yahin hoon, himmat rakho!' },
    ],
    turning: [
      { character: 'Abdullah', key: 'abdullah', line: 'Ab bas! Ab main peeche nahi hatunga.' },
      { character: 'Abbu', key: 'abbu', line: 'Shabash beta, mujhe tum par fakhar hai.' },
    ],
    climax: [
      { character: 'Abdullah', key: 'abdullah', line: 'Abbu, main aa gaya! Aap ko kuch nahi hoga!' },
      { character: 'Abbu', key: 'abbu', line: 'Beta, tum ne kar dikhaya, tum bahadur ho!' },
    ],
    resolution: [
      { character: 'Abbu', key: 'abbu', line: 'Mera beta mera fakhar hai.' },
      { character: 'Abdullah', key: 'abdullah', line: 'Maa baap ki dua hi sab se badi taakat hai.' },
    ],
  },
  en: {
    hook: [
      { character: 'Abdullah', key: 'abdullah', line: 'Today will change my life!' },
      { character: 'Abbu', key: 'abbu', line: 'Go carefully, son, I will pray for you.' },
    ],
    intro: [
      { character: 'Abbu', key: 'abbu', line: 'Son, the whole village is proud of you.' },
      { character: 'Abdullah', key: 'abdullah', line: 'Abbu, with your prayers nothing is difficult.' },
    ],
    rising: [
      { character: 'Abdullah', key: 'abdullah', line: 'The road is hard, but I will not stop.' },
      { character: 'Abbu', key: 'abbu', line: 'Do not lose courage, son, I am with you.' },
    ],
    challenge: [
      { character: 'Abdullah', key: 'abdullah', line: 'What is that? Danger ahead!' },
      { character: 'Abbu', key: 'abbu', line: 'Son, step back, it is dangerous!' },
    ],
    conflict: [
      { character: 'Abdullah', key: 'abdullah', line: 'I am afraid, but I cannot leave Abbu alone.' },
      { character: 'Abbu', key: 'abbu', line: 'Son, I am right here, stay strong!' },
    ],
    turning: [
      { character: 'Abdullah', key: 'abdullah', line: 'Enough! I will not step back now.' },
      { character: 'Abbu', key: 'abbu', line: 'Well done, son, I am proud of you.' },
    ],
    climax: [
      { character: 'Abdullah', key: 'abdullah', line: 'Abbu, I am here! Nothing will happen to you!' },
      { character: 'Abbu', key: 'abbu', line: 'Son, you did it, you are brave!' },
    ],
    resolution: [
      { character: 'Abbu', key: 'abbu', line: 'My son is my pride.' },
      { character: 'Abdullah', key: 'abdullah', line: "A parent's prayer is the greatest strength." },
    ],
  },
};

/**
 * DEFAULT_VOICES — the voice for each role, per language.
 * Narrator and Abdullah share a voice on purpose: the narration is
 * first-person (Abdullah telling his own story). Abbu is an older man's
 * voice (Standard-B, pitched down slightly).
 * Google Cloud TTS offers Urdu ONLY as ur-IN — there is NO ur-PK locale.
 * A Pakistani-accent Urdu voice is available from Microsoft Azure
 * (ur-PK-UzmaNeural / ur-PK-AsadNeural) or ElevenLabs.
 * Voice shape: { provider: 'google-tts' | 'elevenlabs', voiceId, pitch }.
 */
const DEFAULT_VOICES = {
  ur: {
    narrator: { provider: 'google-tts', voiceId: 'ur-IN-Wavenet-B', pitch: 0 },
    abdullah: { provider: 'google-tts', voiceId: 'ur-IN-Wavenet-B', pitch: 0 },
    abbu: { provider: 'google-tts', voiceId: 'ur-IN-Standard-B', pitch: -2 },
  },
  hi: {
    narrator: { provider: 'google-tts', voiceId: 'hi-IN-Wavenet-B', pitch: 0 },
    abdullah: { provider: 'google-tts', voiceId: 'hi-IN-Wavenet-B', pitch: 0 },
    abbu: { provider: 'google-tts', voiceId: 'hi-IN-Standard-B', pitch: -2 },
  },
  en: {
    narrator: { provider: 'google-tts', voiceId: 'en-US-Wavenet-D', pitch: 0 },
    abdullah: { provider: 'google-tts', voiceId: 'en-US-Wavenet-D', pitch: 0 },
    abbu: { provider: 'google-tts', voiceId: 'en-US-Standard-D', pitch: -2 },
  },
};

/** Merge default voices with project/character overrides. */
function resolveVoices(input, language) {
  const base = DEFAULT_VOICES[language] || DEFAULT_VOICES.en;
  const voices = {
    narrator: { ...base.narrator },
    abdullah: { ...base.abdullah },
    abbu: { ...base.abbu },
  };
  // Narrator override from settings (passed in as input.narratorVoice).
  if (input.narratorVoice && input.narratorVoice.voiceId) {
    voices.narrator = {
      provider: input.narratorVoice.provider || 'google-tts',
      voiceId: input.narratorVoice.voiceId,
      pitch: typeof input.narratorVoice.pitch === 'number' ? input.narratorVoice.pitch : 0,
    };
  }
  // Explicit per-role overrides (input.voices = { narrator, abdullah, abbu }).
  if (input.voices) {
    for (const role of ['narrator', 'abdullah', 'abbu']) {
      if (input.voices[role] && input.voices[role].voiceId) {
        voices[role] = {
          provider: input.voices[role].provider || 'google-tts',
          voiceId: input.voices[role].voiceId,
          pitch: typeof input.voices[role].pitch === 'number' ? input.voices[role].pitch : 0,
        };
      }
    }
  }
  // Character profile voice: the linked character IS Abdullah.
  if (input.character && input.character.voice_provider && input.character.voice_id) {
    voices.abdullah = {
      provider: input.character.voice_provider,
      voiceId: input.character.voice_id,
      pitch: 0,
    };
  }
  return voices;
}

/**
 * Place dialogue lines inside a scene's time window.
 * Narration takes the first ~45% of the scene; dialogue takes the rest.
 * Scenes shorter than 5s get one dialogue line only.
 */
function buildDialogueWindows(lines, dur, startSec, voices) {
  const r1 = (n) => Math.round(n * 10) / 10;
  if (dur < 5) {
    const line = lines[0];
    const voice = voices[line.key] || voices.abdullah;
    return [
      {
        character: line.character,
        line: line.line,
        voiceId: voice.voiceId,
        voiceProvider: voice.provider,
        startSec: r1(startSec + dur * 0.5),
        endSec: r1(startSec + dur * 0.95),
      },
    ];
  }
  return lines.slice(0, 2).map((line, i) => {
    const voice = voices[line.key] || voices.abdullah;
    const [a, b] = i === 0 ? [0.5, 0.72] : [0.76, 0.97];
    return {
      character: line.character,
      line: line.line,
      voiceId: voice.voiceId,
      voiceProvider: voice.provider,
      startSec: r1(startSec + dur * a),
      endSec: r1(startSec + dur * b),
    };
  });
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
  'ek', 'ka', 'ki', 'ke', 'ko', 'se', 'mein', 'main', 'aur', 'jo', 'ye',
  'yeh', 'hai', 'tha', 'thi', 'ne', 'kya', 'story', 'video', 'kahani',
  'make', 'create', 'generate', 'about', 'short', 'please', 'mujhe',
]);

/** Simple deterministic hash — same prompt always gives the same storyboard. */
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Pull up to 3 meaningful keywords from the prompt for scene flavour. */
function extractKeywords(prompt) {
  const words = prompt
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 3);
}

function defaultCharacterLock(mode) {
  if (mode === 'realistic') {
    return (
      'CHARACTER LOCK — the same hero in every scene, do not change him: ' +
      'Abdullah, a young man in his early twenties, black wavy hair, neatly ' +
      'trimmed beard, warm brown eyes, wearing a black Levi\'s hoodie, blue ' +
      'jeans and blue-grey sneakers. Same face, same hair, same beard, same ' +
      'clothes, same body proportions in every single scene.'
    );
  }
  return (
    'CHARACTER LOCK — the same hero in every scene, do not change him: ' +
    'Abdullah, a 3D cartoon young man, big expressive brown eyes, black ' +
    'wavy hair, neatly trimmed beard, gentle smile, wearing a black Levi\'s ' +
    'hoodie, blue jeans and blue-grey sneakers. Same face, same hair, same ' +
    'beard, same clothes, same body proportions in every single scene.'
  );
}

function buildCharacterLock(mode, character) {
  if (!character) return defaultCharacterLock(mode);
  const desc = (character.description || character.name || 'Abdullah').trim();
  return (
    'CHARACTER LOCK — the same character in every scene, do not change ' +
    `them: ${desc}. Same face, same hairstyle, same clothes, same ` +
    'accessories and same body proportions in every single scene. Never ' +
    'change the character’s appearance between scenes.'
  );
}

function makeTitle(prompt) {
  const words = prompt
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length ? words.join(' ') : 'Untitled Story';
}

function validateInput(input) {
  const errors = [];
  if (!input || typeof input.prompt !== 'string' || input.prompt.trim().length < 3) {
    errors.push('prompt must be at least 3 characters long');
  }
  if (!MODES.includes(input.mode)) errors.push(`mode must be one of: ${MODES.join(', ')}`);
  if (!DURATIONS.includes(input.durationSeconds)) {
    errors.push(`durationSeconds must be one of: ${DURATIONS.join(', ')}`);
  }
  if (!LANGUAGES.includes(input.language)) {
    errors.push(`language must be one of: ${LANGUAGES.join(', ')}`);
  }
  if (!ASPECTS.includes(input.aspect)) errors.push(`aspect must be one of: ${ASPECTS.join(', ')}`);
  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
}

/**
 * Build a storyboard from one prompt.
 * @param {Object} input
 * @param {string} input.prompt            The user's story prompt (one line).
 * @param {'realistic'|'cartoon'} input.mode
 * @param {30|60} input.durationSeconds
 * @param {'ur'|'hi'|'en'} input.language
 * @param {'9:16'|'16:9'} input.aspect
 * @param {string} [input.quality]        '720p' | '1080p' | '4K'
 * @param {Object} [input.character]      { name, description, voice_provider, voice_id, voice_name } or null
 * @param {Object} [input.narratorVoice]  { provider, voiceId, pitch } — narrator override from settings
 * @param {Object} [input.voices]         { narrator, abdullah, abbu } — per-role voice overrides
 * @returns {Object} storyboard — each scene also carries dialogue[] (character
 *          lines with their own voiceId + timings) and narrationStartSec /
 *          narrationEndSec / narrationVoice.
 */
function buildStoryboard(input) {
  validateInput(input);
  const prompt = input.prompt.trim();
  const { mode, durationSeconds, language, aspect } = input;
  const quality = input.quality || '1080p';
  const seed = hashString(prompt + mode + durationSeconds + language);
  const keywords = extractKeywords(prompt);
  const keywordNote = keywords.length ? ` Story elements: ${keywords.join(', ')}.` : '';

  const beatIndexes = durationSeconds === 60 ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 6, 7];
  // 60s: 7 x 8s + 4s finale = 60s.  30s: 3 x 8s + 6s finale = 30s.
  const sceneDurations =
    durationSeconds === 60 ? [8, 8, 8, 8, 8, 8, 8, 4] : [8, 8, 8, 6];

  const characterLock = buildCharacterLock(mode, input.character || null);
  const style = MODE_STYLE[mode];
  const negativePrompt = NEGATIVE_PROMPT[mode];
  const langLabel = LANGUAGE_LABEL[language];
  const voices = resolveVoices(input, language);

  let t = 0;
  const scenes = beatIndexes.map((beatIdx, i) => {
    const beat = BEATS[beatIdx];
    const dur = sceneDurations[i];
    const startSec = t;
    const endSec = t + dur;
    t = endSec;
    const variant = (seed + i) % 2;
    const narration = NARRATION[language][beat.key][variant];
    const narrationStartSec = Math.round((startSec + 0.3) * 10) / 10;
    const narrationEndSec = Math.round((startSec + dur * 0.45) * 10) / 10;
    const dialogue = buildDialogueWindows(
      DIALOGUE[language][beat.key],
      dur,
      startSec,
      voices
    );
    const videoPrompt =
      `${style} ${characterLock} ` +
      `Story: ${prompt}.${keywordNote} ` +
      `Scene ${i + 1}: ${beat.setting}. ${beat.action} ` +
      `Camera: ${beat.camera}. ` +
      `Cinematic lighting, smooth motion, no text on screen. ` +
      `Narration language: ${langLabel}.`;
    return {
      index: i,
      startSec,
      endSec,
      durationSec: dur,
      setting: beat.setting,
      action: beat.action,
      cameraMovement: beat.camera,
      transition: beat.transition,
      narration,
      narrationStartSec,
      narrationEndSec,
      narrationVoice: voices.narrator,
      dialogue,
      negativePrompt,
      videoPrompt,
    };
  });

  return {
    title: makeTitle(prompt),
    logline: `A ${mode === 'realistic' ? 'realistic cinematic' : '3D cartoon'} ${durationSeconds}-second story: ${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}`,
    mode,
    durationSeconds,
    totalSeconds: t,
    language,
    aspect,
    quality,
    characterLock,
    keywords,
    scenes,
  };
}

module.exports = {
  buildStoryboard,
  hashString,
  extractKeywords,
  resolveVoices,
  DEFAULT_VOICES,
  DIALOGUE,
  MODES,
  LANGUAGES,
  ASPECTS,
  DURATIONS,
};
