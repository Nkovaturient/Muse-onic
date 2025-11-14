const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Blob: NodeBlob } = require('buffer');
const { getConfig } = require('../utils/config');
const { createLogger } = require('../utils/logger');
const { triggerMelodySearch } = require('../../n8n/workflowHooks');

const logger = createLogger('melody-search');
const BlobImpl = typeof Blob === 'function' ? Blob : NodeBlob;

async function searchViaN8n(payload) {
  try {
    const response = await triggerMelodySearch(payload);
    if (!response) return null;
    if (response.best && response.matches) {
      return response;
    }
    if (response.url) {
      return {
        query: payload.fingerprint,
        matches: [
          {
            title: response.title || 'Unknown Track',
            url: response.url,
            snippet: response.snippet || '',
            source: response.source || 'n8n'
          }
        ],
        best: {
          title: response.title || 'Unknown Track',
          url: response.url,
          snippet: response.snippet || '',
          source: response.source || 'n8n'
        }
      };
    }
    return null;
  } catch (err) {
    logger.warn('n8n melody search failed', err.message || err);
    return null;
  }
}

function buildAcrSignature({ accessKey, accessSecret, stringToSign }) {
  return crypto
    .createHmac('sha1', accessSecret)
    .update(Buffer.from(stringToSign, 'utf8'))
    .digest('base64');
}

async function searchViaAcrCloud(filePath) {
  const config = getConfig();
  if (!config.acrHost || !config.acrAccessKey || !config.acrAccessSecret) {
    return null;
  }

  if (typeof globalThis.fetch !== 'function' || typeof globalThis.FormData !== 'function') {
    throw new Error('fetch/FormData not available in this runtime. Upgrade Node to 18+.');
  }

  const endpoint = `https://${config.acrHost}/v1/identify`;
  const method = 'POST';
  const signatureVersion = '1';
  const dataType = 'audio';
  const timestamp = Math.floor(Date.now() / 1000);

  const stringToSign = [method, '/v1/identify', dataType, signatureVersion, config.acrAccessKey, timestamp].join('\n');
  const signature = buildAcrSignature({
    accessKey: config.acrAccessKey,
    accessSecret: config.acrAccessSecret,
    stringToSign
  });

  const audioBuffer = await fs.promises.readFile(filePath);
  const form = new FormData();
  form.append('access_key', config.acrAccessKey);
  form.append('timestamp', String(timestamp));
  form.append('signature', signature);
  form.append('data_type', dataType);
  form.append('signature_version', signatureVersion);
  form.append('sample_bytes', String(audioBuffer.byteLength));
  form.append('sample', new BlobImpl([audioBuffer]), path.basename(filePath));

  const response = await fetch(endpoint, {
    method,
    body: form
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ACRCloud search failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  const music = payload?.metadata?.music;
  if (!Array.isArray(music) || music.length === 0) {
    logger.info('ACRCloud returned no matches');
    return { matches: [], best: null };
  }

  const matches = music.map((item) => ({
    title: item.title,
    artists: item.artists?.map((a) => a.name).join(', ') || '',
    album: item.album?.name || '',
    url: item.external_metadata?.deezer?.track?.link ||
      item.external_metadata?.spotify?.track?.external_urls?.spotify ||
      item.external_metadata?.youtube?.vid
        ? `https://www.youtube.com/watch?v=${item.external_metadata.youtube.vid}`
        : '',
    release_date: item.release_date || '',
    source: 'acrcloud'
  }));

  return {
    matches,
    best: matches[0]
  };
}

async function searchMelodyFallback(filePath) {
  // Fallback: Try to search YouTube with generic music queries
  // This helps when ACRCloud/n8n are not configured
  const { searchSong } = require('./lyricsSearch');
  
  try {
    // Try common music-related searches
    const fallbackQueries = [
      'popular music',
      'trending songs',
      'new music releases'
    ];
    
    // Use the first query as a basic fallback
    const result = await searchSong(fallbackQueries[0]);
    
    if (result && result.best) {
      logger.info('Melody search fallback: Using generic YouTube search');
      return {
        matches: result.matches || [],
        best: {
          ...result.best,
          source: 'youtube-fallback',
          snippet: 'Music detected but no specific match. Showing popular results.'
        }
      };
    }
  } catch (err) {
    logger.debug('Melody fallback search failed', err.message);
  }
  
  return {
    matches: [],
    best: null
  };
}

async function searchMelody({ filePath, fingerprint }) {
  const config = getConfig();

  const n8nPayload = fingerprint
    ? {
        fingerprint: fingerprint.fingerprint,
        shape: fingerprint.shape,
        sampleRate: fingerprint.sample_rate,
        duration: fingerprint.duration
      }
    : null;

  if (config.n8nEnabled && n8nPayload) {
    const viaN8n = await searchViaN8n(n8nPayload);
    if (viaN8n && viaN8n.best) {
      return viaN8n;
    }
  }

  const viaAcr = await searchViaAcrCloud(filePath);
  if (viaAcr && viaAcr.best) {
    return viaAcr;
  }

  // Fallback: If no specialized services available, use generic search
  logger.info('No specialized melody search available, using fallback');
  return await searchMelodyFallback(filePath);
}

module.exports = {
  searchMelody
};

