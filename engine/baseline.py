"""U5: the composite baseline projection (R7, KD1).

A transparent bar the model must clear: historical scoring average, recent
ICT, and recent form, combined with ``engine.config.BASELINE_WEIGHTS``. It
takes no fixture-difficulty term and no game-time term -- those belong to the
model (R8). A cold-start player is returned as a marker, never a number
(KTD11).

The three terms are summed at their configured weights *without* normalising
(the documented default -- see the plan's Open Question on term scaling).
"""

from __future__ import annotations

from collections.abc import Mapping

import pandas as pd

from engine.config import BASELINE_WEIGHTS
from engine.history import ColdStart


def project(feature_row: Mapping) -> float | ColdStart:
    """Weighted sum of the baseline's three terms, or ``ColdStart`` when the
    feature row is flagged as having no resolvable history (KTD11)."""
    if feature_row["cold_start"]:
        return ColdStart()
    w = BASELINE_WEIGHTS
    return (
        w["hist_scoring_avg"] * feature_row["hist_scoring_avg"]
        + w["ict_recent"] * feature_row["ict_recent"]
        + w["form_recent"] * feature_row["form_recent"]
    )


def project_pool(feature_frame: pd.DataFrame) -> pd.DataFrame:
    """``project`` mapped over every player. Columns (indexed by ``player_id``):
    ``points`` (``None`` for a cold-start player) and ``cold_start``."""
    out: list[dict] = []
    for player_id, row in feature_frame.iterrows():
        result = project(row)
        cold = isinstance(result, ColdStart)
        out.append(
            {
                "player_id": player_id,
                "points": None if cold else float(result),
                "cold_start": cold,
            }
        )
    frame = pd.DataFrame.from_records(out)
    if not frame.empty:
        frame = frame.set_index("player_id")
    return frame
