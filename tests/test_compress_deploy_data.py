"""scripts/compress_deploy_data.py ships every pool-context cache kept (this
week's and next week's), not only the 'latest' by filename."""

from __future__ import annotations

import gzip

import scripts.compress_deploy_data as cdd


def test_both_pool_context_caches_are_shipped(tmp_path, monkeypatch):
    data, out = tmp_path / "data", tmp_path / "out"
    (data / "pool-context").mkdir(parents=True)
    for gw in (9, 10):  # "gw9" sorts after "gw10" as a string: both must ship anyway
        (data / "pool-context" / f"gw{gw}.pkl").write_bytes(f"ctx{gw}".encode())
    monkeypatch.setattr(cdd, "DATA_DIR", data)
    monkeypatch.setattr(cdd, "OUT_DIR", out)
    cdd.main()
    shipped = sorted(p.name for p in (out / "pool-context").glob("*.gz"))
    assert shipped == ["gw10.pkl.gz", "gw9.pkl.gz"]
    assert gzip.decompress((out / "pool-context" / "gw9.pkl.gz").read_bytes()) == b"ctx9"
