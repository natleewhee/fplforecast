"""compress_deploy_data ships the two newest pool-context weeks, by number."""

from __future__ import annotations

import scripts.compress_deploy_data as cdd


def test_ships_the_two_newest_weeks_by_number(tmp_path, monkeypatch):
    data, out = tmp_path / "data", tmp_path / "data-deploy"
    (data / "pool-context").mkdir(parents=True)
    for gw in (9, 10, 11):
        (data / "pool-context" / f"gw{gw}.pkl").write_bytes(b"x")
    monkeypatch.setattr(cdd, "DATA_DIR", data)
    monkeypatch.setattr(cdd, "OUT_DIR", out)
    cdd.main()
    shipped = sorted(p.name for p in (out / "pool-context").glob("*.gz"))
    assert shipped == ["gw10.pkl.gz", "gw11.pkl.gz"]  # a string sort would have kept gw9
