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

PKG = pathlib.Path(__file__).parent.parent / "custom_components" / "my_cellarion"
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


def _dev_inventory(tmp_path):
    spec = importlib.util.spec_from_file_location("bestand_dev", DEV)
    dev = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dev)
    dev.CACHE_FILE = str(tmp_path / "bestand.json")  # the state file follows the cache file
    dev.token = lambda: "t"
    dev.get_cond = lambda path, tok, etag: (200, INVENTORY, 'W/"x"')
    dev.get = lambda path, tok: RACKS
    dev.refresh()
    return json.loads(pathlib.Path(dev.CACHE_FILE).read_text(encoding="utf-8"))


def _integration_inventory():
    async def get(path):
        assert path.startswith("/api/racks?cellar=c1")
        return RACKS

    return asyncio.run(api.build_inventory(INVENTORY, get))


def test_inventory_matches_development_setup(tmp_path, capsys):
    dev = _dev_inventory(tmp_path)
    capsys.readouterr()
    integ = _integration_inventory()
    for d in (dev, integ):
        d.pop("generated", None)
    assert integ == dev
    assert dev["total"] == 5 and dev["racks"] == ["R", "S"] and dev["fields"] == ["Lage", "Stil"]
