"""scripts/residual_analysis.py: summary shape and the attacker tercile split."""

from __future__ import annotations

from scripts.residual_analysis import summarise


def rec(position, residual, played=True, lam=1.5, season="S"):
    return {
        "season": season,
        "gw": 1,
        "position": position,
        "projected": 2.0,
        "actual": 2.0 + residual,
        "residual": residual,
        "played": played,
        "lambdaFor": lam,
        "components": {"appearance": 2.0, "saves": 0.0},
    }


def test_summarise_reports_bias_by_position():
    out = summarise([rec("GKP", 1.0), rec("GKP", 3.0), rec("DEF", -1.0)])

    assert out["byPosition"]["GKP"]["bias"] == 2.0
    assert out["byPosition"]["DEF"]["bias"] == -1.0
    assert out["overall"]["n"] == 3


def test_attacker_terciles_order_by_lambda_and_skip_defenders():
    records = [rec("MID", float(i), lam=1.0 + i / 10) for i in range(9)] + [rec("DEF", 99.0, lam=3.0)]
    out = summarise(records)["attackersByLambdaFor"]

    assert out["low"]["avgLambdaFor"] < out["mid"]["avgLambdaFor"] < out["high"]["avgLambdaFor"]
    assert out["high"]["bias"] == 7.0  # residuals 6, 7, 8 -- the defender is excluded


def test_components_only_average_gameweeks_played():
    out = summarise([rec("GKP", 0.0), rec("GKP", 0.0, played=False)])

    assert out["componentsWhenPlayed"]["GKP"]["n"] == 1
