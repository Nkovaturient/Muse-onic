#!/bin/bash
echo "Setting up Museonic python environment..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_PATH="$PROJECT_ROOT/venv"

if [ ! -d "$VENV_PATH" ]; then
  python3 -m venv "$VENV_PATH"
fi

source "$VENV_PATH/bin/activate"
python -m pip install --upgrade pip
python -m pip install -r "$SCRIPT_DIR/requirements.txt"

echo "✅ Museonic python environment ready!"
