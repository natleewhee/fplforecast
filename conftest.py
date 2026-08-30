"""Put the repo root on sys.path so tests can import the engine/ package and
scripts/ modules without an editable install. U2 adds pyproject.toml and
`pip install -e .`; this keeps `pytest` working with or without it."""

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
