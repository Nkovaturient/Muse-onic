import React from 'react';

export default function ResultCard({ transcript, result, intent }) {
  const getIntentColor = (intentType) => {
    switch(intentType) {
      case 'lyrics': return 'rgba(124,242,199,0.2)';
      case 'melody': return 'rgba(147,197,253,0.2)';
      default: return 'rgba(255,255,255,0.1)';
    }
  };

  const getIntentLabel = (intentType) => {
    switch(intentType) {
      case 'lyrics': return '🎵 Lyrics';
      case 'melody': return '🎶 Melody';
      default: return '❓ Unknown';
    }
  };

  return (
    <div className="result-card">
      <div className="transcript">
        <div className="label">You sang</div>
        <div className="text">
          {transcript ? (
            <span style={{ animation: 'fadeIn 0.5s ease-out' }}>{transcript}</span>
          ) : (
            <i style={{ opacity: 0.5 }}>— nothing transcribed yet —</i>
          )}
        </div>
      </div>

      <div className="match">
        <div className="label">Match</div>
        {intent && (
          <div className="intent">
            <span 
              className="intent-pill"
              style={{ 
                background: getIntentColor(intent.intent),
                borderColor: intent.intent === 'lyrics' ? 'rgba(124,242,199,0.3)' : 
                            intent.intent === 'melody' ? 'rgba(147,197,253,0.3)' : 
                            'rgba(255,255,255,0.1)'
              }}
            >
              {getIntentLabel(intent.intent)}
            </span>
            {typeof intent.confidence === 'number' && (
              <span className="intent-confidence">
                {(intent.confidence * 100).toFixed(0)}% confidence
              </span>
            )}
          </div>
        )}
        {result ? (
          <div className="match-body">
            <div className="title">{result.title}</div>
            {result.snippet && (
              <div className="snippet">"{result.snippet}"</div>
            )}
            {result.playable?.source && (
              <div className="meta">
                <span style={{ opacity: 0.6 }}>Source:</span> {result.playable.source}
              </div>
            )}
            {result.url && (
              <div className="meta" style={{ fontSize: '10px', marginTop: '4px' }}>
                {result.url.length > 60 ? `${result.url.substring(0, 60)}...` : result.url}
              </div>
            )}
          </div>
        ) : (
          <div className="no-match">
            {transcript ? '🔍 Searching for matches...' : 'No match yet'}
          </div>
        )}
      </div>
    </div>
  );
}