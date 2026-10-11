#!/bin/zsh
set -eu

preview_root="${0:A:h}"
cd "$preview_root"
exec python3 scripts/local_preview.py

