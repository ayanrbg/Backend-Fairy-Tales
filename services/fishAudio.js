const axios = require('axios');
const FormData = require('form-data');

const API_BASE = 'https://api.fish.audio';
const API_KEY = process.env.FISH_AUDIO_API_KEY;

const headers = { Authorization: `Bearer ${API_KEY}` };

/**
 * Clone a voice from an audio buffer.
 * Returns the new voice_id (model _id).
 */
async function cloneVoice(audioBuffer, originalName, userId) {
  const form = new FormData();
  form.append('title', `user_${userId}`);
  form.append('type', 'tts');
  form.append('train_mode', 'fast');
  form.append('visibility', 'private');
  form.append('voices', audioBuffer, {
    filename: originalName || 'sample.mp3',
    contentType: 'audio/mpeg',
  });

  const response = await axios.post(`${API_BASE}/model`, form, {
    headers: {
      ...headers,
      ...form.getHeaders(),
    },
  });

  return response.data._id;
}

/**
 * Generate speech from text using a cloned voice.
 * Returns an audio buffer (mp3).
 */
async function textToSpeech(voiceId, text) {
  const response = await axios.post(
    `${API_BASE}/v1/tts`,
    {
      text,
      reference_id: voiceId,
      format: 'mp3',
      mp3_bitrate: 128,
      model: 's2-pro',
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
  await axios.delete(`${API_BASE}/model/${voiceId}`, { headers });
}

module.exports = { cloneVoice, textToSpeech, deleteVoice };
