import React, { useState, useEffect, useRef } from 'react';

export default function MicRecorder({ status, onStart, onStop }) {
  const [pressed, setPressed] = useState(false);
  const holdTimer = useRef(null);

  async function handleMouseDown() {
    setPressed(true);
    setTimeout(() => {
      if (pressed) {
        onStart();
      }
    }, 120);
  }

  async function handleMouseUp() {
    setPressed(false);
    if (status === 'recording') {
      await onStop();
    } else {
      await onStart();
      setTimeout(async () => {
        await onStop();
      }, 10000);
    }
  }

  useEffect(() => {
    function onKey(e) {
      if (e.code === 'Space') {
        e.preventDefault();
        if (pressed) {
          handleMouseUp();
        } else {
          handleMouseDown();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [pressed, status]);

  return (
    <div className="recorder-root">
      <div
        className={`mic-3d ${status === 'recording' ? 'listening' : ''} ${pressed ? 'active' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchEnd={handleMouseUp}
        role="button"
        aria-pressed={pressed}
        aria-label="Hold to record"
      >
        <div className="mic-body">
          <div className="mic-head" />
          <div className="mic-grill" />
        </div>
      </div>

      <div className="pulse-area">
        <div className={`pulse ${status === 'recording' ? 'on' : ''}`} />
      </div>
    </div>
  );
}