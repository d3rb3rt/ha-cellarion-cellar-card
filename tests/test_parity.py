"""Parity check: the integration's data layer (api.py) must deliver the same inventory as the development setup's bestand.py.

The development setup (private ha-config repo) is the place where the card is tested; the integration re-implements its data
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
    {"name": "R", "typeConfig": {"shelfRows": [1, 2, 1]}, "slots": [{"position": 1, "bottle": "a" * 24}, {"position": 15, "bottle": "b" * 24}]},
    {"name": "S", "cols": 4, "typeConfig": {"shelfRows": [2, 2]}, "slots": [{"position": 5, "bottle": "c" * 24}, {"position": 99, "bottle": "d" * 24}]},
]}
BOTTLES = [
    {"_id": "a" * 24, "vintage": 2019, "price": 24.5, "currency": "EUR", "drinkFrom": 2024, "drinkTo": 2032, "peakFrom": 2026, "peakUntil": 2029,
     "purchaseLocation": "Lobenberg", "reservation": {"x": 1}, "status": "active",
     "wineDefinition": {"_id": "w1", "name": "Riesling", "producer": "Weingut", "type": "still", "colour": "white", "appellation": "Mosel",
                        "grapes": [{"name": "Riesling"}], "classification": "Spaetlese", "country": {"name": "Germany"}, "region": {"name": "Mosel"}}},
    {"_id": "b" * 24, "vintage": None, "status": "active", "wineDefinition": {"_id": "w2", "name": "Cremant", "type": "sparkling", "grapes": []}},
    {"_id": "c" * 24, "vintage": 2015, "status": "active", "wineDefinition": {"_id": "w3", "name": "Barolo", "country": "Italy", "region": None}},
    {"_id": "d" * 24, "vintage": 2010, "status": "consumed", "wineDefinition": {"_id": "w4", "name": "Gone"}},
    {"_id": "e" * 24, "vintage": 2020, "reserved": True, "wineDefinition": {"_id": "w5", "name": "Unplaced"}},
]
CELLARS = {"cellars": [{"_id": "c1", "name": "HK4"}]}
PERS = ({"a" * 24: {"Stil": "Sekt"}}, ["Stil"])


def _dev_inventory(tmp_path):
    spec = importlib.util.spec_from_file_location("bestand_dev", DEV)
    dev = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dev)
    dev.CACHE_FILE = str(tmp_path / "bestand.json")
    dev.token = lambda: "t"
    dev.personal_fields = lambda tok: PERS

    def get(path, tok):
        if path.startswith("/api/cellars"):
            return CELLARS
        if path.startswith("/api/racks"):
            return RACKS
        return {"bottles": {"total": len(BOTTLES), "items": BOTTLES}}

    dev.get = get
    dev.refresh()
    return json.loads(pathlib.Path(dev.CACHE_FILE).read_text(encoding="utf-8"))


def _integration_inventory(monkeypatch):
    async def get(path):
        if path.startswith("/api/cellars"):
            return CELLARS
        if path.startswith("/api/racks"):
            return RACKS
        return {"bottles": {"total": len(BOTTLES), "items": BOTTLES}}

    async def pers(mcp):
        return PERS

    monkeypatch.setattr(api, "personal_fields", pers)
    return asyncio.run(api.build_inventory(get, object()))


def test_inventory_matches_development_setup(tmp_path, monkeypatch, capsys):
    dev = _dev_inventory(tmp_path)
    capsys.readouterr()
    integ = _integration_inventory(monkeypatch)
    for d in (dev, integ):
        d.pop("generated", None)
        d.pop("personalError", None)
    assert integ == dev
