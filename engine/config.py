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

# 5-GW window-points gain at or above which a suggested swap is worth
# surfacing prominently in the weekly view; smaller gains are shown muted.
MEANINGFUL_UPGRADE_GAP = 5.0

# Before this gameweek the model runs on thin current-season data, so the
# recent-form slice of a rate blend is scaled down toward it and the
# "worth a transfer" bar is raised -- two gameweeks shouldn't recommend nine
# swaps. Both effects fade to nothing by SETTLE_GAMEWEEK.
SETTLE_GAMEWEEK = 8
# Extra "worth a transfer" gap required per gameweek the season is short of
# SETTLE_GAMEWEEK: effective_gap = MEANINGFUL_UPGRADE_GAP * (1 + RAMP * weeks_early).
EARLY_SEASON_GAP_RAMP = 0.25

# Pre-deadline write window, in hours, for the prediction log (U9, KTD7).
PREDICTION_WINDOW_HOURS = 48

# Live-tracker "par" score: the gameweek total that holds the manager's overall
# rank is the live gameweek average plus their baked hold-rank margin. The
# margin needs at least this many completed gameweeks of the manager's own
# scoring before it is trusted; below that it is zero and the tracker shows the
# wider provisional buffer so a top-decile manager is not told they are safe on
# the average alone (KTD2).
PAR_BUFFER_POINTS = 4.0
PAR_BUFFER_PROVISIONAL_POINTS = 2 * PAR_BUFFER_POINTS
PAR_MARGIN_MIN_GAMEWEEKS = 3

# Pseudo-observations that pull a player's noisy recent scoring/form means
# toward their position's average (empirical-Bayes, as in the minutes model).
# Early in a season one big gameweek would otherwise dominate every projection.
FEATURE_SHRINKAGE_GAMES = 4

# --- Newcomers (players with no Premier League history) ---
# Understat leagues pulled for cross-league xG/xA of foreign signings.
UNDERSTAT_LEAGUES = ["EPL", "La_liga", "Bundesliga", "Serie_A", "Ligue_1"]
# Per-90 output multiplier vs the Premier League -- a goal in that league is
# worth this fraction of a PL goal. EPL is 1.0 (a player already in the FPL
# data that resolution simply missed). Championship / smaller leagues have no
# Understat coverage and fall back to the price-tier prior.
LEAGUE_DISCOUNT = {
    "EPL": 1.0,
    "La_liga": 0.92,
    "Serie_A": 0.90,
    "Bundesliga": 0.90,
    "Ligue_1": 0.86,
}
# Minimum minutes in a prior league before its rates are trusted over the
# price prior.
UNDERSTAT_MIN_MINUTES = 600
# Weight of FPL's own ep_next when blended into a newcomer's provisional xP.
EP_NEXT_BLEND = 0.35

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

# --- Real-goals team strength (Phase 2 of the 2026-09-04 team-strength plan,
# engine/team_goals.py) --- shrinkage is in MATCHES, not seasons: a single
# match's goal count is far noisier than a season-aggregated admin rating
# (engine.strength.team_strength_table's signal), so this needs a much larger
# prior-equivalent before trusting the raw sample. Execution-tunable -- not
# yet calibrated against a real backtest.
TEAM_GOALS_SHRINKAGE_MATCHES = 20

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
# Games of a player's own minutes needed before their season-to-date per-90
# rate earns its full RATE_BLEND["season"] weight; below this it's scaled down
# linearly. Without it, a single-minute cameo's FPL-extrapolated per-90 (total
# / actual-minutes-played, blown up to a per-90 rate) enters the blend at full
# weight -- see the "recent" slice, scaled the same way by the player's own
# minutes within RATE_FORM_WINDOW.
RATE_SEASON_FULL_GAMES = 10
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


# --- Transfer scenarios / chip optimiser (2026-09-05 plan) ---
# Cap on banked free transfers. Confirmed for the 2025-26 season (2026-09-05);
# this has changed before (it was 2 pre-2024/25) so re-confirm each season.
FT_MAX_BANKED = 5
# Points cost of a transfer beyond the free allowance.
HIT_COST = 4
# Squad composition by element_type (1 GKP, 2 DEF, 3 MID, 4 FWD).
SQUAD_COMPOSITION = {1: 2, 2: 5, 3: 5, 4: 3}
SQUAD_SIZE = sum(SQUAD_COMPOSITION.values())
# Legal starting-XI formation bounds by element_type, (min, max); GKP is fixed at 1.
XI_FORMATION_BOUNDS = {1: (1, 1), 2: (3, 5), 3: (2, 5), 4: (1, 3)}
XI_SIZE = 11
# Max squad members from a single club.
CLUB_LIMIT = 3
# Tiny bias against taking a hit when it is exactly net-neutral (a swap worth
# precisely HIT_COST points over the horizon): without it CBC can land on
# either side of a tie, and KD1 wants hits taken only when strictly
# net-positive. Negligible next to real point deltas (~0.01 precision).
HIT_TIEBREAK_EPSILON = 1e-6

if sum(BASELINE_WEIGHTS.values()) <= 0:
    raise ValueError("BASELINE_WEIGHTS must sum to a positive number")


# Safety-score floor/ceiling band (Part A of the 2026-09-03 safety-score and
# calibration plan). Width is one standard deviation of realised per-position
# projection error either side of the point estimate (~68% band), from
# data/record/residuals.json (scripts/score_predictions.py, UA1).
SAFETY_BAND_Z = 1.0
# A position needs this many scored residuals before its own realised stdev
# is trusted; below it the band falls back to SAFETY_BAND_PROVISIONAL_STDEV
# and is flagged provisional -- the same shape as PAR_MARGIN_MIN_GAMEWEEKS.
SAFETY_MIN_SAMPLE_PER_POSITION = 20
# Placeholder width (points) used before a position has enough scored history;
# execution tunes this against real residuals once the season has enough data.
SAFETY_BAND_PROVISIONAL_STDEV = 4.0
