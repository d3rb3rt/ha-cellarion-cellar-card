"""Parity check: the integration's data layer (api.py) must deliver the same inventory as the development setup's bestand.py.

The development setup (a separate Home Assistant setup) is the place where the card is tested; the integration re-implements its data
layer. This test feeds the same fake Cellarion responses through both and compares the resulting inventory, so the card never
waits for a field that the integration does not deliver.

Needs the path to bestand.py in CEL_DEV_BESTAND (the GitHub Action sets it); skipped otherwise.
"""
import asyncio
import importlib.util
import json
import os
import pathlib
import sys
import types

import pytest

DEV = os.environ.get("CEL_DEV_BESTAND")
pytestmark = pytest.mark.skipif(not DEV, reason="CEL_DEV_BESTAND not set")

PKG = pathlib.Path(__file__).parent.parent / "custom_components" / "cellarion_cellar_card"
pkg = types.ModuleType("mcp_par")
pkg.__path__ = [str(PKG)]
sys.modules["mcp_par"] = pkg
for _n in ("const", "api"):
    _s = importlib.util.spec_from_file_location(f"mcp_par.{_n}", PKG / f"{_n}.py")
    _m = importlib.util.module_from_spec(_s)
    sys.modules[f"mcp_par.{_n}"] = _m
    _s.loader.exec_module(_m)
api = sys.modules["mcp_par.api"]

RACKS = {"racks": [
    {"_id": "r1", "name": "R", "typeConfig": {"shelfRows": [1, 2, 1]}},
    {"_id": "r2", "name": "S", "cols": 4, "typeConfig": {"shelfRows": [2, 2]}},
]}
INVENTORY = {
    "schema": 1,
    "cellars": [{"id": "c1", "name": "HK4", "role": "owner"}, {"id": "c2", "name": "Shared", "role": "member"}],
    "racks": [{"id": "r1", "cellar": "c1", "name": "R"}, {"id": "r2", "cellar": "c1", "name": "S"}, {"id": "r3", "cellar": "c2", "name": "Other"}],
    "wines": {
        "w1": {"name": "Riesling", "producer": "Weingut", "type": "still", "colour": "white", "country": "Germany", "region": "Mosel",
               "appellation": "Mosel", "classification": "Spaetlese", "grapes": ["Riesling"]},
        "w2": {"name": "Cremant", "type": "sparkling", "grapes": []},
        "w3": {"name": "Barolo", "country": "Italy", "region": None},
        "w5": {"name": "Unplaced"},
        "w6": {"name": "Villa Magra", "type": None, "category": "other", "grapes": ["Frantoio"]},  # not wine: type is null, category is "other"
    },
    "bottles": [
        {"id": "a" * 24, "wine": "w1", "cellar": "c1", "vintage": "2019", "price": 24.5, "currency": "EUR", "purchaseLocation": "Lobenberg",
         "window": {"drinkFrom": 2024, "drinkTo": 2032, "peakFrom": 2026, "peakUntil": 2029},
         "location": {"rack": "r1", "rackName": "R", "position": 1, "shelf": 1, "row": 1, "col": 1},
         "personal": [{"key": "Stil", "value": "Sekt", "level": "wine"}, {"key": "Lage", "value": "Grosse Lage", "level": "wine"},
                      {"key": "Lage", "value": "Erste Lage", "level": "bottle"}, {"key": "Leer", "value": "", "level": "wine"}]},
        {"id": "b" * 24, "wine": "w2", "cellar": "c1", "vintage": None, "window": {},
         "location": {"rack": "r1", "rackName": "R", "position": 15, "shelf": 2, "row": 2, "col": 3}, "personal": []},
        {"id": "c" * 24, "wine": "w3", "cellar": "c1", "vintage": "2015", "window": {"drinkFrom": 2020},
         "location": {"rack": "r2", "rackName": "S", "position": 9, "shelf": 2, "row": 1, "col": 1}, "personal": []},
        {"id": "d" * 24, "wine": "w5", "cellar": "c1", "vintage": "2020", "window": {}, "location": None, "place": None, "personal": []},
        {"id": "9" * 24, "wine": "w6", "cellar": "c1", "vintage": "2025", "window": {}, "location": None, "personal": []},
        {"id": "e" * 24, "wine": "w1", "cellar": "c2", "vintage": "2018", "window": {}, "location": None, "personal": []},  # shared cellar: left out
        {"id": "f" * 24, "wine": "w3", "cellar": "c1", "vintage": "2010", "window": {},
         "location": {"rack": "r2", "rackName": "S", "position": 99, "shelf": None, "row": None, "col": None}, "personal": []},
    ],
}


def _only_first_cellar_racks(path):
    assert path.startswith("/api/racks?cellar=c1")  # the racks of the shared cellar are not read
    return RACKS


def _dev_inventory(tmp_path, inv=INVENTORY, racks=_only_first_cellar_racks, history=None):
    spec = importlib.util.spec_from_file_location("bestand_dev", DEV)
    dev = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dev)
    dev.CACHE_FILE = str(tmp_path / "bestand.json")  # the state file follows the cache file
    dev.token = lambda: "t"
    dev.get_cond = lambda path, tok, etag: (200, inv, 'W/"x"')
    dev.get = lambda path, tok: racks(path)
    dev.fetch_history_raw = lambda tok: history  # no network: the consumption log is passed in
    dev.refresh()
    return json.loads(pathlib.Path(dev.CACHE_FILE).read_text(encoding="utf-8"))


def _integration_inventory(inv=INVENTORY, racks=_only_first_cellar_racks, history=None):
    async def get(path):
        return racks(path)

    return asyncio.run(api.build_inventory(inv, get, None, history))


def test_inventory_matches_development_setup(tmp_path, capsys):
    dev = _dev_inventory(tmp_path)
    capsys.readouterr()
    integ = _integration_inventory()
    for d in (dev, integ):
        d.pop("generated", None)
    assert integ == dev
    assert dev["total"] == 6 and dev["racks"] == ["R", "S"] and dev["fields"] == ["Lage", "Stil"]
    assert [b["type"] for b in dev["bottles"] if b["name"] == "Villa Magra"] == ["other"]  # category "other" is delivered as type "other"


# Two own cellars and one shared: both setups deliver the two own cellars, each bottle knows its cellar, shared stays out
RACKS_BY_CELLAR = {
    "c1": {"racks": [{"_id": "r1", "name": "R", "typeConfig": {"shelfRows": [1, 2, 1]}}]},
    "c2": {"racks": [{"_id": "r3", "name": "Shelf", "cols": 4, "typeConfig": {"shelfRows": [2, 2]}}]},
}
INVENTORY_TWO = {
    "schema": 1,
    "cellars": [{"id": "c1", "name": "HK4", "role": "owner"}, {"id": "c2", "name": "Cabin", "role": "owner"}, {"id": "c3", "name": "Shared", "role": "member"}],
    "racks": [{"id": "r1", "cellar": "c1", "name": "R"}, {"id": "r3", "cellar": "c2", "name": "Shelf"}, {"id": "r9", "cellar": "c3", "name": "Other"}],
    "wines": {"w1": {"name": "Riesling", "type": "still", "colour": "white"}},
    "bottles": [
        {"id": "a" * 24, "wine": "w1", "cellar": "c1", "vintage": "2019", "window": {},
         "location": {"rack": "r1", "rackName": "R", "position": 1, "shelf": 1, "row": 1, "col": 1}, "personal": []},
        {"id": "b" * 24, "wine": "w1", "cellar": "c2", "vintage": "2019", "window": {},
         "location": {"rack": "r3", "rackName": "Shelf", "position": 3, "shelf": 2, "row": 1, "col": 3}, "personal": []},
        {"id": "c" * 24, "wine": "w1", "cellar": "c2", "vintage": "2020", "window": {}, "location": None, "personal": []},
        {"id": "d" * 24, "wine": "w1", "cellar": "c3", "vintage": "2021", "window": {}, "location": None, "personal": []},  # shared cellar: left out
    ],
}


def _racks_of_own_cellars(path):
    cid = path.split("cellar=")[1].split("&")[0]
    assert cid in RACKS_BY_CELLAR, "racks of a cellar that is not delivered were read"
    return RACKS_BY_CELLAR[cid]


def test_two_own_cellars_match_development_setup(tmp_path, capsys):
    dev = _dev_inventory(tmp_path, INVENTORY_TWO, _racks_of_own_cellars)
    capsys.readouterr()
    integ = _integration_inventory(INVENTORY_TWO, _racks_of_own_cellars)
    for d in (dev, integ):
        d.pop("generated", None)
    assert integ == dev
    assert [(c["id"], c["total"], c["racks"]) for c in dev["cellars"]] == [("c1", 1, ["R"]), ("c2", 2, ["Shelf"])]
    assert dev["total"] == 3 and dev["racks"] == ["R", "Shelf"]
    assert [b["cellar"] for b in dev["bottles"]] == ["c1", "c2", "c2"]
    assert dev["cellars"][1]["rackGeo"] == {"Shelf": {"cols": 4, "rows": [2, 2]}}


# Consumption log (list_history): same slim rows in both setups; rows of cellars that are not delivered stay out; without rows no key
HISTORY = [
    {"bottle_id": "1" * 24, "wine": {"name": "Mellifera", "producer": "Lointier", "type": "sparkling"}, "vintage": "NV", "status": "drank",
     "cellar_id": "c1", "price": 50, "currency": "EUR", "rating": None, "drink_from": 2024, "drink_to": 2030,
     "consumed_at": "2026-11-03T14:24:12.400Z", "consumed_reason": "drank", "consumed_rating": None, "consumed_rating_scale": None, "consumed_note": None},
    {"bottle_id": "2" * 24, "wine": {"name": "Alte Reben", "producer": "Zilliken", "type": "white"}, "vintage": "2021", "status": "gifted",
     "cellar_id": "c1", "consumed_at": "2026-11-01T19:43:12.700Z", "consumed_reason": "gifted", "consumed_rating": 4.5,
     "consumed_rating_scale": "stars", "consumed_note": "x" * 600},
    {"bottle_id": "3" * 24, "wine": {"name": "Elsewhere", "type": "red"}, "vintage": "2010", "status": "drank", "cellar_id": "c2",
     "consumed_at": "2026-10-01T10:00:00.000Z", "consumed_reason": "drank"},  # shared cellar: left out
]


def test_history_matches_development_setup(tmp_path, capsys):
    dev = _dev_inventory(tmp_path, history=HISTORY)
    capsys.readouterr()
    integ = _integration_inventory(history=HISTORY)
    for d in (dev, integ):
        d.pop("generated", None)
    assert integ == dev
    h = dev["history"]
    assert [x["name"] for x in h] == ["Mellifera", "Alte Reben"]
    assert h[0] == {"id": "1" * 24, "name": "Mellifera", "producer": "Lointier", "type": "sparkling", "vintage": "NV",
                    "at": "2026-11-03T14:24:12.400Z", "reason": "drank", "price": 50, "currency": "EUR", "drinkFrom": 2024, "drinkTo": 2030}
    assert h[1]["rating"] == 4.5 and h[1]["scale"] == "stars" and len(h[1]["note"]) == 500


def test_no_history_means_no_key(tmp_path, capsys):
    dev = _dev_inventory(tmp_path, history=[])
    capsys.readouterr()
    assert "history" not in dev and "history" not in _integration_inventory(history=[])


# Wine facts of drunk wines: from the wines of the inventory, otherwise from get_bottle (same result in both setups)
LP = {"wine_entries": [{"level": "wine", "key": "Subregion", "value": "Cote des Bar"}, {"level": "wine", "key": "Bubbles", "value": "Champagner"}]}
GB = {"wine": {"wine_id": "w9", "name": "Elsewhere", "country": "Austria", "region": "Wachau", "appellation": None,
               "grapes": ["Gruener Veltliner"], "classification": None, "classifications": ["Smaragd", "Ried"]}}


def test_history_facts_match_development_setup(tmp_path):
    spec = importlib.util.spec_from_file_location("bestand_dev", DEV)
    dev = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dev)
    rows = [{"id": "1" * 24, "name": "Elsewhere", "vintage": "2010"}, {"id": "2" * 24, "name": "Elsewhere", "vintage": "2012"},
            {"id": "3" * 24, "name": "Known", "wine": "w1", "country": "Germany"}]
    calls: list[str] = []

    def call(bid):
        calls.append(bid)
        return GB

    d = [dict(r) for r in rows]
    dev.enrich_history(d, None, call, call_p=lambda bid: LP)

    class FakeMcp:
        def __init__(self):
            self.n = []

        async def tool(self, name, args):
            if name == "list_personal_data":
                return LP
            assert name == "get_bottle"
            self.n.append(args["bottle_id"])
            return GB

    m = FakeMcp()
    i = [dict(r) for r in rows]
    asyncio.run(api.enrich_history(i, None, m))
    assert d == i and calls == ["1" * 24] and m.n == ["1" * 24]  # one call per wine
    assert d[0]["p"] == {"Subregion": "Cote des Bar", "Bubbles": "Champagner"}  # personal fields of the wine
    assert d[0]["wine"] == "w9" and d[0]["classification"] == "Smaragd, Ried" and d[1]["region"] == "Wachau" and "wine" in d[2]
    # facts of the last data are reused without a call
    d2 = [dict(rows[0])]
    dev.enrich_history(d2, d, lambda bid: 1 / 0, call_p=lambda bid: 1 / 0)
    assert d2[0]["region"] == "Wachau" and d2[0]["p"]["Subregion"] == "Cote des Bar"
    # rows of the last data without p get them with one call
    old = [{k: v for k, v in d[0].items() if k != "p"}]
    d3, i3 = [dict(rows[0])], [dict(rows[0])]
    dev.enrich_history(d3, old, lambda bid: 1 / 0, call_p=lambda bid: LP)
    asyncio.run(api.enrich_history(i3, old, FakeMcp()))
    assert d3 == i3 and d3[0]["p"]["Bubbles"] == "Champagner"
