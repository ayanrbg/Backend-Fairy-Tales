const edgeTts = require('./edgeTts');
const fishAudio = require('./fishAudio');

/**
 * Unified TTS router.
 * @param {object} opts
 * @param {string} opts.text - Text to synthesize
 * @param {string} opts.lang - Language code: ru, uz, kz, en
 * @param {'cloned'|'default'} opts.voiceType - Voice type
 * @param {string} [opts.voiceId] - Fish Audio voice ID (required when voiceType='cloned')
 * @param {'male'|'female'} [opts.gender='male'] - Gender for default voice
 * @returns {Promise<Buffer>} MP3 audio buffer
 */
async function textToSpeech({ text, lang, voiceType, voiceId, gender }) {
  if (voiceType === 'cloned') {
    return fishAudio.textToSpeech(voiceId, text);
  }
  return edgeTts.textToSpeech(text, lang, gender);
}

module.exports = { textToSpeech };
