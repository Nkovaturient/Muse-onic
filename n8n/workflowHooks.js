const { getConfig } = require('../backend/utils/config');
const { createLogger } = require('../backend/utils/logger');

const logger = createLogger('n8n');

async function callN8n(endpoint, payload = {}) {
  const config = getConfig();
  if (!config.n8nEnabled) {
    return null;
  }
  const baseUrl = config.n8nBaseUrl.replace(/\/$/, '');
  const url = `${baseUrl}${endpoint}`;

  const headers = {
    'Content-Type': 'application/json'
  };

  if (config.n8nHooksToken) {
    headers.Authorization = `Bearer ${config.n8nHooksToken}`;
  }

  if (typeof globalThis.fetch !== 'function') {
    throw new Error('fetch is not available in this runtime. Upgrade Node or enable experimental fetch.');
  }

  const response = await globalThis.fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`n8n call failed: ${response.status} ${text}`);
  }

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (err) {
    logger.warn('n8n returned non-JSON payload', text);
    return text;
  }
}

async function triggerLyricsSearch(payload) {
  return callN8n('/webhook/lyrics-search', payload);
}

async function triggerMelodySearch(payload) {
  return callN8n('/webhook/melody-search', payload);
}

async function notifyPlayback(eventPayload) {
  return callN8n('/webhook/playback-events', eventPayload);
}

async function fetchPlayableSource(payload) {
  return callN8n('/webhook/fetch-playable', payload);
}

module.exports = {
  triggerLyricsSearch,
  triggerMelodySearch,
  notifyPlayback,
  fetchPlayableSource
};

