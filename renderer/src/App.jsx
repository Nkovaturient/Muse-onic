import React, { useEffect, useState } from 'react';
import MicRecorder from './components/MicRecorder.jsx';
import ResultCard from './components/ResultCard.jsx';
import PlayerControls from './components/PlayerControls.jsx';

const logger = {
  info: (...args) => console.log('[App]', ...args),
  error: (...args) => console.error('[App]', ...args)
};

const fallbackBridge = {
  __mock: true,
  onRecordTrigger: () => {},
  recordStart: async () => {
    throw new Error('Museonic bridge unavailable in this environment.');
  },
  recordStop: async () => {
    throw new Error('Museonic bridge unavailable in this environment.');
  },
  transcribeAudio: async () => {
    throw new Error('Museonic bridge unavailable in this environment.');
  },
  determineIntent: async () => ({
    intent: 'unknown',
    confidence: 0,
    reason: 'Bridge unavailable in this environment.'
  }),
  searchSong: async () => ({
    query: '',
    matches: [],
    best: null
  }),
  processRecording: async () => {
    throw new Error('Museonic bridge unavailable in this environment.');
  },
  playSong: async () => {
    throw new Error('Museonic bridge unavailable in this environment.');
  },
  stopSong: async () => {}
};

export default function App() {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | recording | transcribing | searching | playing
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState(null); // {url, title}
  const [recordFile, setRecordFile] = useState(null);
  const [intent, setIntent] = useState(null);
  const [bridgeMessage, setBridgeMessage] = useState(null);

  const museonic = window.museonic ?? fallbackBridge;
  const bridgeIsMock = Boolean(museonic.__mock);

  useEffect(() => {
    // handle global shortcut trigger from main
    if (!bridgeIsMock && museonic.onRecordTrigger) {
      museonic.onRecordTrigger(() => {
      setIsOpen(true);
    });
  } else {
      setBridgeMessage('Run Museonic via Electron to enable recording.');
      setIsOpen(true);
  }
  }, [bridgeIsMock, museonic]);

  async function handleStart() {
    setStatus('recording');
    setBridgeMessage(null);
    try {
      if (bridgeIsMock) {
        setStatus('idle');
        setBridgeMessage('Recording is only available in the Electron app.');
        return;
      }
      const filePath = await museonic.recordStart();
      setRecordFile(filePath);
      logger.info('Recording started', filePath);
    } catch (e) {
      console.error('start error', e);
      setBridgeMessage(`Recording failed: ${e.message || 'Unknown error'}`);
      setStatus('idle');
    }
  }

  async function handleStop() {
    setStatus('transcribing');
    setBridgeMessage(null);
    try {
      if (bridgeIsMock) {
        throw new Error('Museonic bridge unavailable');
      }

      if (!museonic?.recordStop || !museonic?.processRecording || !museonic?.playSong) {
        throw new Error('Museonic bridge unavailable');
      }

      const filePath = await museonic.recordStop();
      setRecordFile(filePath);
      
      setStatus('transcribing');
      setBridgeMessage('Processing audio... This may take a moment on first run.');

      const pipeline = await museonic.processRecording(filePath);
      
      setBridgeMessage(null);
      setStatus('searching');

      setTranscript(pipeline?.transcript || '');
      setIntent(pipeline?.intent || null);

      const bestMatch = pipeline?.search?.best;
      const url = pipeline?.playable?.url || bestMatch?.url;

      if (!url) {
        let feedbackMessage = 'No match found';
        if (pipeline?.intent?.intent === 'melody' || !pipeline?.transcript) {
          feedbackMessage = 'Music detected but no match found. Try:\n1. Using system audio mode (see SYSTEM_AUDIO_SETUP.md)\n2. Humming or singing the melody\n3. Speaking the lyrics';
        } else if (pipeline?.transcript) {
          feedbackMessage = `No match for "${pipeline.transcript}". Try different lyrics or humming the melody.`;
        }
        
        setResult({
          url: null,
          title: bestMatch?.title || 'No Match Found',
          snippet: bestMatch?.snippet || feedbackMessage,
          search: pipeline?.search,
          playable: pipeline?.playable
        });
        setStatus('idle');
        return;
      }

      const title =
        bestMatch?.title ||
        extractTitleFromUrl(url) ||
        pipeline?.transcript ||
        'Unknown Track';

      const playResponse = await museonic.playSong({
        url,
        meta: {
          track: bestMatch,
          playable: pipeline?.playable
        }
      });
      setResult({
        url,
        title,
        snippet: bestMatch?.snippet,
        playResponse,
        search: pipeline?.search,
        intent: pipeline?.intent,
        fingerprint: pipeline?.fingerprint,
        playable: pipeline?.playable
      });
      setStatus('playing');
    } catch (err) {
      console.error(err);
      setBridgeMessage(err.message);
      setStatus('idle');
    }
  }

  function extractTitleFromUrl(url) {
    try {
      if (!url) return null;
      const u = new URL(url);
      if (u.hostname.includes('youtube')) {
        const v = u.searchParams.get('v');
        return v ? `YouTube Video (${v})` : 'YouTube Track';
      }
      return u.pathname.split('/').pop() || url;
    } catch {
      return url;
    }
  }

  function closeModal() {
    setIsOpen(false);
    setStatus('idle');
    setTranscript('');
    setIntent(null);
    setBridgeMessage(null);
  }

  function openModal() {
    setIsOpen(true);
    setBridgeMessage(null);
  }

  return (
    <>
      {!isOpen && (
        <div className="landing">
          <div className="landing-card">
            <div className="brand">Museonic</div>
            <p className="landing-text">Press the button below or use Ctrl+M inside the Electron app to start humming.</p>
            <button className="btn" onClick={openModal}>Open Recorder</button>
            {bridgeMessage && <p className="hint warning">{bridgeMessage}</p>}
          </div>
        </div>
      )}
      {isOpen && (
        <div className="modal-root" role="dialog" aria-modal="true">
          <div className="panel">
            <div className="panel-header">
              <div className="brand">Museonic</div>
              <button className="close-btn" onClick={closeModal}>✕</button>
            </div>

            <div className="panel-body">
              <MicRecorder
                status={status}
                onStart={handleStart}
                onStop={handleStop}
              />

              <div className="status-area">
                {status === 'idle' && <p className="hint">Press & hold record to hum or say lyrics.</p>}
                {status === 'recording' && <p className="hint">🎤 Listening... keep humming or speaking.</p>}
                {status === 'transcribing' && (
                  <p className="hint">
                    🧠 Transcribing with Whisper...
                    <br />
                    <small style={{ opacity: 0.7, fontSize: '0.85em' }}>
                      First run may download the model (~140MB)
                    </small>
                  </p>
                )}
                {status === 'searching' && <p className="hint">🔍 Searching for a match…</p>}
                {status === 'playing' && <p className="hint">🎵 Playing now — enjoy!</p>}
                {bridgeMessage && (
                  <p className={`hint ${bridgeMessage.includes('error') || bridgeMessage.includes('failed') ? 'warning' : ''}`}>
                    {bridgeMessage}
                  </p>
                )}
              </div>

              <ResultCard transcript={transcript} result={result} intent={intent} />

            </div>

            <div className="panel-footer">
              <PlayerControls result={result} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}