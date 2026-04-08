const { EdgeTTS } = require('@andresaya/edge-tts');

// Voice mapping: lang → gender → Edge TTS voice ShortName
const VOICES = {
  ru: { male: 'ru-RU-DmitryNeural', female: 'ru-RU-SvetlanaNeural' },
  uz: { male: 'uz-UZ-SardorNeural', female: 'uz-UZ-MadinaNeural' },
  kz: { male: 'kk-KZ-DauletNeural', female: 'kk-KZ-AigulNeural' },
  en: { male: 'en-US-GuyNeural', female: 'en-US-JennyNeural' },
};

const DEFAULT_GENDER = 'male';

/**
 * Generate speech from text using Edge TTS (free).
 * @param {string} text - Text to synthesize
 * @param {string} lang - Language code: ru, uz, kz, en
 * @param {string} [gender='male'] - 'male' or 'female'
 * @returns {Promise<Buffer>} MP3 audio buffer
 */
async function textToSpeech(text, lang, gender) {
  const g = gender === 'female' ? 'female' : DEFAULT_GENDER;
  const voiceMap = VOICES[lang];
  if (!voiceMap) {
    throw new Error(`Edge TTS: unsupported language "${lang}". Supported: ${Object.keys(VOICES).join(', ')}`);
  }
  const voice = voiceMap[g];

  const tts = new EdgeTTS();
  await tts.synthesize(text, voice);
  return tts.toBuffer();
}

module.exports = { textToSpeech, VOICES };
