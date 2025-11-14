#!/usr/bin/env python3
import argparse
import base64
import json
import os
import sys
from typing import Tuple

try:
    import numpy as np
except ImportError as exc:
    raise SystemExit(
        "numpy is required for melody extraction. "
        "Activate python_env or run python_env/setup.sh."
    ) from exc

try:
    import librosa
except ImportError as exc:
    raise SystemExit(
        "librosa is required for melody extraction. "
        "Activate python_env or run python_env/setup.sh."
    ) from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a melody fingerprint for Museonic.")
    parser.add_argument("--file", required=True, help="Path to audio file (wav/mp3).")
    parser.add_argument("--sample-rate", type=int, default=22050, dest="sample_rate")
    parser.add_argument("--duration", type=float, default=8.0, help="Max duration to analyse (seconds).")
    parser.add_argument("--n-mels", type=int, default=128)
    parser.add_argument("--hop-length", type=int, default=512)
    parser.add_argument("--fmax", type=int, default=8000)
    return parser.parse_args()


def ensure_audio(file_path: str) -> None:
    if not os.path.exists(file_path):
        raise SystemExit(f"Audio file not found: {file_path}")


def to_base64(array: np.ndarray) -> Tuple[str, Tuple[int, ...]]:
    data = array.astype(np.float32).tobytes()
    encoded = base64.b64encode(data).decode("ascii")
    return encoded, array.shape


def main() -> None:
    args = parse_args()
    ensure_audio(args.file)

    y, sr = librosa.load(
        args.file,
        sr=args.sample_rate,
        mono=True,
        duration=args.duration if args.duration > 0 else None,
    )

    if y.size == 0:
        raise SystemExit("Loaded audio is empty.")

    mel = librosa.feature.melspectrogram(
        y=y,
        sr=sr,
        n_mels=args.n_mels,
        hop_length=args.hop_length,
        fmax=args.fmax,
    )
    log_mel = librosa.power_to_db(mel, ref=np.max)

    fingerprint, shape = to_base64(log_mel)
    payload = {
        "fingerprint": fingerprint,
        "shape": shape,
        "sample_rate": sr,
        "duration": float(librosa.get_duration(y=y, sr=sr)),
        "hop_length": args.hop_length,
        "n_mels": args.n_mels,
        "fmax": args.fmax,
    }

    sys.stdout.write(json.dumps(payload))


if __name__ == "__main__":
    main()

