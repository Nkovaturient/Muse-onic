#!/usr/bin/env python3
import argparse
import json
import os
import sys

try:
    import whisper
except ImportError as exc:
    raise SystemExit(
        "Whisper python package not found. Activate the python_env virtual environment or run python_env/setup.sh."
    ) from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Whisper transcription for Museonic.")
    parser.add_argument("--file", dest="file_path", required=True, help="Path to the audio file to transcribe.")
    parser.add_argument("--model", dest="model", default=os.environ.get("WHISPER_MODEL", "base"))
    parser.add_argument("--language", dest="language", default=os.environ.get("WHISPER_LANGUAGE"))
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--json", action="store_true", help="Output JSON payload instead of plain text.")
    return parser.parse_args()


def ensure_audio_exists(file_path: str) -> None:
    if not os.path.exists(file_path):
        raise SystemExit(f"Audio file not found: {file_path}")


def load_model(model_name: str):
    return whisper.load_model(model_name)


def main() -> None:
    args = parse_args()
    ensure_audio_exists(args.file_path)

    model = load_model(args.model)
    
    # Optimized transcription parameters for better accuracy
    # Lower no_speech_threshold for humming/quiet audio
    # Lower logprob_threshold to catch more speech
    result = model.transcribe(
        args.file_path,
        language=args.language,
        temperature=args.temperature,
        fp16=False,
        verbose=False,  # Reduce noise in output
        no_speech_threshold=0.4,  # Lower threshold to catch humming/quiet speech (default: 0.6)
        logprob_threshold=-1.2,  # Lower threshold for better detection (default: -1.0)
        compression_ratio_threshold=2.6,  # Slightly higher to avoid repetition (default: 2.4)
        condition_on_previous_text=True,  # Better context
    )

    if args.json:
        print(json.dumps(result))
    else:
        text = (result.get("text") or "").strip()
        
        # If no text but we have segments, try to extract from segments
        if not text and result.get("segments"):
            segments_text = " ".join([seg.get("text", "").strip() for seg in result["segments"] if seg.get("text")])
            text = segments_text.strip()
        
        # Log warning if still empty but audio exists
        if not text:
            import sys
            print("", file=sys.stderr)  # Empty line to stderr as warning signal
            print("WARNING: No speech detected in audio. Check audio quality and duration.", file=sys.stderr)
        
        print(text)


if __name__ == "__main__":
    main()

