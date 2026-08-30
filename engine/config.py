"""Tunable parameters for the projection engine, in one place (KTD5).

Every constant here is imported by name from ``engine/*`` and ``scripts/*`` --
no scattered literals. Each carries the Key Decision (KD) or Key Technical
Decision (KTD) it inherits its value from. The one deliberate exception is
``scripts/minutes_model.py``, which keeps its own ``ROLLING_WINDOW`` literal so
it stays reused-unchanged (KTD5).
"""

from __future__ import annotations

# Rolling window, in gameweeks, for transfer evaluation and recent-form means
# (captaincy is still scored on the single upcoming gameweek). Inherits KD8.
ROLLING_WINDOW = 5

# Completed seasons the multi-season archive and backtest cover -- the same list
# as scripts/resolve_entities.py's PAST_SEASONS. Inherits KTD3.
ARCHIVE_SEASONS = ["2025-26", "2024-25", "2023-24"]

# Pooled model-minus-baseline squad-points delta, per gameweek per squad, at or
# above which the backtest flags the difference as meaningful. Reported, never
# gated. Inherits KD9.
MEANINGFUL_EDGE_PER_GW = 0.3

# pStart below this raises the minutes-risk flag (R13). Inherits KTD9.
MINUTES_RISK_PSTART = 0.65

# Composite-baseline term weights (R7): historical scoring average, recent ICT,
# recent form. Documented default is an equal split; per-season tuning is
# Deferred to Follow-Up Work. Whether the terms are normalised before weighting
# is an Open Question resolved in U5 -- the equal split is the default either
# way. Inherits KTD5.
BASELINE_WEIGHTS = {
    "hist_scoring_avg": 1 / 3,
    "ict_recent": 1 / 3,
    "form_recent": 1 / 3,
}

# FDR -> multiplier as ``intercept + slope * (difficulty - 1)``: 1.2 at
# difficulty 1 (easiest), symmetric around 3 -> 1.0x. Lifted from the interim
# ``fdr_multiplier`` in engine/features.py; the real expected-goals λ model is
# Deferred to Follow-Up Work (KTD10).
FDR_MULTIPLIER = {"intercept": 1.2, "slope": -0.1}

# Comparable-price window, in £m, for squad-vs-pool gap ranking (U7).
PRICE_BAND_M = 0.3

# Gap rows shown per column in the weekly three-column view (U8/U13).
DISPLAY_GAP_ROWS = 3

# Pre-deadline write window, in hours, for the prediction log (U9, KTD7).
PREDICTION_WINDOW_HOURS = 48


if sum(BASELINE_WEIGHTS.values()) <= 0:
    raise ValueError("BASELINE_WEIGHTS must sum to a positive number")
