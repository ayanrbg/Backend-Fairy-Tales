const axios = require('axios');
const FormData = require('form-data');

const API_BASE = 'https://api.elevenlabs.io/v1';
const API_KEY = process.env.ELEVENLABS_API_KEY;

const headers = { 'xi-api-key': API_KEY };

/**
 * Clone a voice from an audio buffer.
 * Returns the new voice_id.
 */
async function cloneVoice(audioBuffer, originalName, userId) {
  const form = new FormData();
  form.append('name', `user_${userId}`);
  form.append('files', audioBuffer, {
    filename: originalName || 'sample.mp3',
    contentType: 'audio/mpeg',
  });

  const response = await axios.post(`${API_BASE}/voices/add`, form, {
    headers: {
      ...headers,
      ...form.getHeaders(),
    },
  });

  return response.data.voice_id;
}

/**
 * Generate speech from text using a cloned voice.
 * Returns an audio buffer (mp3).
 */
async function textToSpeech(voiceId, text) {
  const response = await axios.post(
    `${API_BASE}/text-to-speech/${voiceId}`,
    {
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    },
    {
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
    }
  );

  return Buffer.from(response.data);
}

/**
 * Delete a cloned voice by its ID.
 */
async function deleteVoice(voiceId) {
  await axios.delete(`${API_BASE}/voices/${voiceId}`, { headers });
}

module.exports = { cloneVoice, textToSpeech, deleteVoice };
