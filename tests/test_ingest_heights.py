from __future__ import annotations

import scripts.ingest_heights as heights


def _time(day: str, precision: int = 11) -> dict:
    return {"mainsnak": {"datavalue": {"value": {"time": f"+{day}T00:00:00Z", "precision": precision}}}}


def _height(amount: str, unit: str, rank: str = "normal") -> dict:
    return {
        "rank": rank,
        "mainsnak": {"datavalue": {"value": {"amount": amount, "unit": f"http://www.wikidata.org/entity/{unit}"}}},
    }


def _entity(dob=None, hts=None) -> dict:
    claims = {}
    if dob:
        claims["P569"] = [_time(dob)]
    if hts:
        claims["P2048"] = hts
    return {"claims": claims}


class FakeWikidata:
    """Answers wbsearchentities and wbgetentities from two small tables."""

    def __init__(self, search: dict[str, list[str]], entities: dict[str, dict]):
        self.search, self.entities, self.calls = search, entities, []

    def __call__(self, params: dict) -> dict:
        self.calls.append(params["action"])
        if params["action"] == "wbsearchentities":
            return {"search": [{"id": q} for q in self.search.get(params["search"], [])]}
        ids = params["ids"].split("|")
        return {"entities": {q: self.entities[q] for q in ids if q in self.entities}}


PLAYER = {"code": 1, "first_name": "Erling", "second_name": "Haaland", "known_name": "", "web_name": "Haaland", "birth_date": "2000-07-21"}


def test_parses_height_in_centimetres_and_metres():
    assert heights.parse_height_cm(_entity(hts=[_height("+194", heights.UNIT_CENTIMETRE)])) == 194
    assert heights.parse_height_cm(_entity(hts=[_height("+1.94", heights.UNIT_METRE)])) == 194


def test_ignores_unknown_units_and_implausible_heights():
    assert heights.parse_height_cm(_entity(hts=[_height("+6.4", "Q3710")])) is None  # feet: not guessed
    assert heights.parse_height_cm(_entity(hts=[_height("+19", heights.UNIT_CENTIMETRE)])) is None
    assert heights.parse_height_cm(_entity(hts=[_height("+1940", heights.UNIT_CENTIMETRE)])) is None


def test_prefers_a_preferred_rank_height():
    ent = _entity(hts=[_height("+190", heights.UNIT_CENTIMETRE), _height("+194", heights.UNIT_CENTIMETRE, "preferred")])
    assert heights.parse_height_cm(ent) == 194


def test_date_of_birth_needs_day_precision():
    assert heights.parse_dob(_entity(dob="2000-07-21")) == "2000-07-21"
    ent = {"claims": {"P569": [_time("2000-07-21", precision=9)]}}  # year only
    assert heights.parse_dob(ent) is None


def test_search_tries_the_full_name_then_web_name_without_repeats():
    p = {"first_name": "Bruno", "second_name": "Fernandes", "known_name": "", "web_name": "B.Fernandes"}
    assert heights.search_names(p) == ["Bruno Fernandes", "B.Fernandes"]
    q = {"first_name": "Raheem", "second_name": "Sterling", "known_name": "Sterling", "web_name": "Sterling"}
    assert heights.search_names(q) == ["Raheem Sterling", "Sterling"]


def test_a_namesake_with_a_different_birth_date_is_not_accepted():
    fake = FakeWikidata(
        {"Erling Haaland": ["Q1", "Q2"]},
        {"Q1": _entity("1972-08-14", [_height("+190", heights.UNIT_CENTIMETRE)]), "Q2": _entity("2000-07-21", [_height("+194", heights.UNIT_CENTIMETRE)])},
    )
    found = heights.match_player(PLAYER, fake, {})
    assert found == {"qid": "Q2", "cm": 194}


def test_no_birth_date_match_means_no_height_even_if_the_name_matches():
    fake = FakeWikidata({"Erling Haaland": ["Q1"]}, {"Q1": _entity("1999-01-01", [_height("+194", heights.UNIT_CENTIMETRE)])})
    assert heights.match_player(PLAYER, fake, {}) is None


def test_right_person_with_no_listed_height_is_reported_separately():
    fake = FakeWikidata({"Erling Haaland": ["Q2"]}, {"Q2": _entity("2000-07-21")})
    assert heights.match_player(PLAYER, fake, {}) == {"qid": "Q2", "cm": None}


def test_run_writes_heights_keeps_other_fields_and_reports_the_rate():
    fake = FakeWikidata({"Erling Haaland": ["Q2"]}, {"Q2": _entity("2000-07-21", [_height("+194", heights.UNIT_CENTIMETRE)])})
    other = {"code": 2, "first_name": "Nobody", "second_name": "Known", "known_name": "", "web_name": "Known", "birth_date": "1999-09-09"}
    existing = {"players": {"1": {"skin": 0}}, "meta": {}}
    logs: list[str] = []
    out = heights.run([PLAYER, other], existing, fake, log=logs.append)

    assert out["players"]["1"] == {"skin": 0, "cm": 194, "cmSource": "wikidata:Q2"}
    assert "2" not in out["players"]  # not found: left for the position default
    assert out["meta"]["heights"]["found_with_height"] == 1
    assert out["meta"]["heights"]["not_found"] == 1
    assert any("1/2 found (50%)" in line for line in logs)
    assert "cm" not in existing["players"]["1"]  # the input is not mutated


def test_only_missing_skips_players_that_already_have_a_height():
    fake = FakeWikidata({}, {})
    existing = {"players": {"1": {"cm": 190, "cmSource": "wikidata:Q9"}}, "meta": {}}
    out = heights.run([PLAYER], existing, fake, only_missing=True, log=lambda _: None)
    assert fake.calls == []  # nothing was looked up
    assert out["players"]["1"]["cm"] == 190


def test_entities_are_fetched_once_across_players():
    fake = FakeWikidata({"A B": ["Q5"], "C D": ["Q5"]}, {"Q5": _entity("1990-01-01")})
    cache: dict = {}
    heights.fetch_entities(["Q5"], fake, cache)
    heights.fetch_entities(["Q5"], fake, cache)
    assert fake.calls == ["wbgetentities"]
