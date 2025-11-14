const { transcribeAudio } = require('../whisper/transcribe');
const { extractFingerprint } = require('../melody/extract');
const { searchSong } = require('../search/lyricsSearch');
const { searchMelody } = require('../search/melodySearch');
const { determineIntent } = require('../../ollama/promptRouter');
const { fetchPlayableSource, notifyPlayback } = require('../../n8n/workflowHooks');
const { createLogger } = require('../utils/logger');

const logger = createLogger('pipeline');

const INTENT_THRESHOLD = 0.55;

async function resolvePlayable(bestMatch, options = {}) {
  if (!bestMatch) return null;

  try {
    const response = await fetchPlayableSource({
      track: bestMatch,
      options
    });

    if (!response) {
      return {
        url: bestMatch.url || null,
        source: bestMatch.source || 'direct'
      };
    }

    return {
      url: response.url || bestMatch.url || null,
      expiresAt: response.expiresAt || null,
      source: response.source || bestMatch.source || 'n8n'
    };
  } catch (err) {
    logger.warn('Failed to fetch playable source via n8n', err.message || err);
    return {
      url: bestMatch.url || null,
      source: bestMatch.source || 'fallback'
    };
  }
}

async function processRecording({ filePath }) {
  logger.info('Processing capture', { filePath });

  const transcript = await transcribeAudio(filePath);
  const intent = await determineIntent(transcript || '');

  const treatAsMelody =
    intent.intent === 'melody' ||
    (intent.intent === 'unknown' && (!transcript || transcript.trim().length === 0)) ||
    (typeof intent.confidence === 'number' && intent.confidence < INTENT_THRESHOLD);

  let searchResult;
  let fingerprint = null;

  if (treatAsMelody) {
    logger.info('Routing capture through melody pipeline', { intent });
    fingerprint = await extractFingerprint(filePath);
    searchResult = await searchMelody({ filePath, fingerprint });
  } else {
    logger.info('Routing capture through lyrics pipeline', { intent });
    searchResult = await searchSong(transcript);
  }

  const playable = await resolvePlayable(searchResult.best, {
    intent: intent.intent,
    transcript
  });

  if (playable?.url) {
    await notifyPlayback({
      event: 'prepared',
      track: searchResult.best,
      playable,
      intent,
      transcript
    });
  }

  return {
    transcript,
    intent,
    search: searchResult,
    fingerprint,
    playable
  };
}

module.exports = {
  processRecording
};

