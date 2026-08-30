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

# 5-GW window-points gain at or above which a suggested swap is worth
# surfacing prominently in the weekly view; smaller gains are shown muted.
MEANINGFUL_UPGRADE_GAP = 5.0

# Pre-deadline write window, in hours, for the prediction log (U9, KTD7).
PREDICTION_WINDOW_HOURS = 48

# Pseudo-observations that pull a player's noisy recent scoring/form means
# toward their position's average (empirical-Bayes, as in the minutes model).
# Early in a season one big gameweek would otherwise dominate every projection.
FEATURE_SHRINKAGE_GAMES = 4

# --- Team strength (scoped extension of KTD10) ---
# How much the opponent's attack/defence strength moves a projection once
# blended with the FDR multiplier: combined = fdr * (1 + WEIGHT * (strength - 1)).
TEAM_STRENGTH_WEIGHT = 0.5
# Bounds on the per-opponent strength multiplier, so one extreme rating can't
# blow up a projection.
TEAM_STRENGTH_CLAMP = (0.75, 1.35)
# Empirical-Bayes pull toward the league average for teams with few archived
# seasons (mirrors the minutes model's shrinkage).
TEAM_STRENGTH_SHRINKAGE_SEASONS = 1.5

# --- Component expected-points model (the deferred KTD10 rebuild) ---
# FPL scoring by element_type (1 GKP, 2 DEF, 3 MID, 4 FWD).
GOAL_POINTS = {1: 6, 2: 6, 3: 5, 4: 4}
CLEAN_SHEET_POINTS = {1: 4, 2: 4, 3: 1, 4: 0}
ASSIST_POINTS = 3
# Goals-conceded penalty (GKP/DEF): -1 per 2 conceded -> -0.5 in expectation.
GOALS_CONCEDED_PENALTY_PER_GOAL = 0.5
SAVE_POINTS_PER_SAVE = 1 / 3
# Defensive-contribution points (2025-26 rule): +2 once per match at the action
# threshold -- 10 for DEF, 12 (incl. recoveries) for MID/FWD; GKP not eligible.
DC_POINTS = 2
DC_THRESHOLD = {2: 10, 3: 12, 4: 12}

# Team expected goals (lambda). base * attack_ratio / opp_defence_ratio, then
# the home side's lambda is multiplied by HOME_GOALS_FACTOR (long-run home bias).
LEAGUE_AVG_GOALS_PER_TEAM = 1.45
HOME_GOALS_FACTOR = 1.15
# Bounds on a single-fixture team lambda so one extreme rating can't run away.
TEAM_LAMBDA_CLAMP = (0.3, 3.5)

# Weighting of the three windows a per-90 rate (xG/90, xA/90, ...) is blended
# from -- prior seasons / this season so far / the recent form window. The split
# the pundit models use; renormalised over whichever sources a player has.
RATE_BLEND = {"archive": 0.3, "season": 0.3, "recent": 0.4}
# Recent-form window, in gameweeks, for the "recent" slice of a rate blend.
RATE_FORM_WINDOW = 6
# Pseudo-games of the position-mean prior mixed into a blended per-90 rate.
# A player with few games of data is pulled hard toward their position's
# average; the pull fades as real minutes accumulate (empirical Bayes).
RATE_PRIOR_GAMES = 6
# A prior-seasons rate is treated as this many games of evidence.
RATE_ARCHIVE_GAMES = 8
# Ceilings on a blended per-90 rate -- no real player exceeds these, and they
# stop a freak small-sample value (a couple of penalties) running away.
RATE_CLAMP = {
    "xg90": 1.4,
    "xa90": 0.8,
    "dc90": 20.0,
    "gc90": 3.0,
    "saves90": 5.0,
    "bonus90": 1.6,
    "yellow90": 0.5,
}


if sum(BASELINE_WEIGHTS.values()) <= 0:
    raise ValueError("BASELINE_WEIGHTS must sum to a positive number")
