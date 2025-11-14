const { getConfig } = require('../backend/utils/config');
const { createLogger } = require('../backend/utils/logger');

const logger = createLogger('ollama');

async function checkOllamaAvailable() {
  const config = getConfig();
  const url = `${config.ollamaBaseUrl.replace(/\/$/, '')}/api/tags`;
  
  try {
    const response = await globalThis.fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(2000) // 2 second timeout
    });
    if (!response.ok) return false;
    
    // Also check if the model is available
    const data = await response.json();
    const availableModels = data.models?.map(m => m.name) || [];
    const requestedModel = config.ollamaModel;
    const modelAvailable = availableModels.some(name => 
      name === requestedModel || 
      name === `${requestedModel}:latest` ||
      name.startsWith(`${requestedModel}:`)
    );
    
    if (!modelAvailable && availableModels.length > 0) {
      logger.warn(`Model ${requestedModel} not found. Available: ${availableModels.join(', ')}`);
      // Try to find a compatible model (same base name)
      const compatibleModel = availableModels.find(name => 
        name.startsWith(requestedModel.split(':')[0])
      ) || availableModels[0];
      
      logger.info(`Using available model: ${compatibleModel}`);
      // Update config to use available model (store without :latest for consistency)
      const baseModelName = compatibleModel.split(':')[0];
      config.ollamaModel = baseModelName;
    }
    
    return response.ok;
  } catch (err) {
    logger.debug('Ollama availability check failed', err.message);
    return false;
  }
}

async function callOllama(prompt, options = {}) {
  const config = getConfig();
  const url = `${config.ollamaBaseUrl.replace(/\/$/, '')}/api/generate`;
  
  // Use the model from config (may have been updated by checkOllamaAvailable)
  let modelName = config.ollamaModel;
  // Ollama accepts both "model" and "model:latest" - try :latest first, fallback to base name
  if (!modelName.includes(':')) {
    modelName = `${modelName}:latest`;
  }

  const body = {
    model: modelName,
    prompt,
    stream: false,
    options: {
      temperature: 0.1,  // Slightly higher for better classification
      top_p: 0.9,
      ...options
    }
  };

  if (typeof globalThis.fetch !== 'function') {
    throw new Error('fetch is not available in this runtime. Upgrade Node or enable experimental fetch.');
  }

  try {
    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama request failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    return data.response || '';
  } catch (err) {
    if (err.name === 'AbortError' || err.code === 'ECONNREFUSED') {
      throw new Error('Ollama is not running. Please start it with: ollama serve');
    }
    throw err;
  }
}

function buildIntentPrompt(transcript) {
  return [
    'You are a classifier for a voice-to-song assistant.',
    'Determine if the user audio contains lyrics (spoken/sung words) or melody/humming.',
    'Respond strictly as JSON with keys intent, confidence, reason.',
    'Intent must be one of: "lyrics", "melody", "unknown".',
    'Confidence is a float between 0 and 1.',
    'Reason is a short human-readable explanation.',
    '',
    `Audio transcript or summary:\n"""${transcript || ''}"""`,
    '',
    'Example response:',
    '{"intent":"lyrics","confidence":0.82,"reason":"Recognized clear lyric phrases."}'
  ].join('\n');
}

async function determineIntent(transcript) {
  // Quick check if Ollama is available
  const isAvailable = await checkOllamaAvailable();
  if (!isAvailable) {
    logger.warn('Ollama not available, using fallback intent detection');
    return determineIntentFallback(transcript);
  }

  try {
    const prompt = buildIntentPrompt(transcript);
    const responseText = await callOllama(prompt, { temperature: 0.1 });

    const safeText = responseText.trim();
    const jsonStart = safeText.indexOf('{');
    const jsonEnd = safeText.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error(`Unexpected Ollama response: ${safeText}`);
    }

    const payload = JSON.parse(safeText.slice(jsonStart, jsonEnd + 1));
    if (!payload.intent) {
      payload.intent = 'unknown';
    }
    return payload;
  } catch (error) {
    logger.error('Failed to classify intent with Ollama', error);
    // Fallback to rule-based detection
    return determineIntentFallback(transcript);
  }
}

function determineIntentFallback(transcript) {
  // Simple rule-based fallback when Ollama is unavailable
  if (!transcript || transcript.trim().length === 0) {
    return {
      intent: 'melody',
      confidence: 0.6,
      reason: 'Empty transcript suggests humming/melody'
    };
  }

  const text = transcript.toLowerCase().trim();
  const wordCount = text.split(/\s+/).length;
  
  // If very short or mostly non-alphabetic, likely melody
  if (wordCount < 3 || text.length < 10) {
    return {
      intent: 'melody',
      confidence: 0.7,
      reason: 'Short or minimal text suggests humming'
    };
  }

  // Check for common lyric patterns
  const lyricIndicators = ['the', 'and', 'you', 'i', 'to', 'a', 'that', 'it', 'is', 'of'];
  const words = text.split(/\s+/);
  const lyricWordCount = words.filter(w => lyricIndicators.includes(w)).length;
  const lyricRatio = lyricWordCount / Math.max(wordCount, 1);

  if (lyricRatio > 0.2 && wordCount > 5) {
    return {
      intent: 'lyrics',
      confidence: 0.75,
      reason: 'Contains common lyric words and sufficient length'
    };
  }

  // Default to lyrics if we have substantial text
  if (wordCount > 10) {
    return {
      intent: 'lyrics',
      confidence: 0.65,
      reason: 'Substantial text suggests lyrics'
    };
  }

  return {
    intent: 'unknown',
    confidence: 0.5,
    reason: 'Unable to determine with fallback method'
  };
}

module.exports = {
  determineIntent
};

