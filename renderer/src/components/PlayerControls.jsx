import React, { useState } from 'react';

export default function PlayerControls({ result }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  async function replay() {
    if (!result?.url) return;
    
    setIsPlaying(true);
    try {
      await window.museonic?.playSong({
        url: result.url,
        meta: {
          track: result?.search?.best || null,
          playable: result?.playable || null
        }
      });
    } catch (err) {
      console.error('Playback error', err);
      setIsPlaying(false);
    }
  }

  async function stop() {
    setIsStopping(true);
    try {
      await window.museonic?.stopSong();
      setIsPlaying(false);
    } catch (err) {
      console.error('Stop error', err);
    } finally {
      setTimeout(() => setIsStopping(false), 300);
    }
  }

  return (
    <div className="player-controls">
      <button 
        className="btn" 
        onClick={replay} 
        disabled={!result?.url || isPlaying}
        title={result?.url ? 'Replay track' : 'No track available'}
      >
        {isPlaying ? '▶ Playing...' : '▶ Replay'}
      </button>
      <button 
        className="btn ghost" 
        onClick={stop}
        disabled={isStopping}
        title="Stop playback"
      >
        {isStopping ? '⏹ Stopping...' : '⏹ Stop'}
      </button>
    </div>
  );
}