"""Tests for the pure helpers in api.py (no Home Assistant needed)."""
import importlib.util
import pathlib
import sys
import types

PKG = pathlib.Path(__file__).parent.parent / "custom_components" / "my_cellarion"
pkg = types.ModuleType("mc")
pkg.__path__ = [str(PKG)]
sys.modules["mc"] = pkg
for name in ("const", "api"):
    spec = importlib.util.spec_from_file_location(f"mc.{name}", PKG / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[f"mc.{name}"] = mod
    spec.loader.exec_module(mod)
api = sys.modules["mc.api"]

RACK = {"name": "Cabinet", "typeConfig": {"shelfRows": [1, 2, 1]}}  # 4 shelves rows: top shelf 1 row, middle 2 rows, bottom 1 row


def test_location_top_shelf():
    text, raw = api.location(RACK, 1)
    assert text == "Cabinet · Fach 1"
    assert raw == {"rack": "Cabinet", "fach": 3, "fachen": 3, "cols": 6, "lage": 1, "platz": 1}


def test_location_second_row_of_middle_shelf():
    text, raw = api.location(RACK, 6 + 6 + 3)
    assert text == "Cabinet · Fach 2"
    assert raw["fach"] == 2 and raw["lage"] == 2 and raw["platz"] == 3


def test_location_out_of_range():
    assert api.location(RACK, 999) == ("Cabinet · ?", {"rack": "Cabinet"})


def test_slim_drops_empty_and_keeps_place():
    b = {"_id": "a" * 24, "vintage": None, "wineDefinition": {"_id": "w", "name": "Riesling", "grapes": [{"name": "Riesling"}],
                                                            "country": {"name": "Germany"}}, "reservation": None}
    out = api.slim(b, ("Cabinet · Fach 1", {"rack": "Cabinet"}))
    assert out["vintage"] == "NV" and out["grapes"] == ["Riesling"] and out["country"] == "Germany"
    assert out["location"] == "Cabinet · Fach 1" and "producer" not in out and out["reserved"] is False


def test_image_name_accepts_only_plain_uploads():
    assert api.image_name("/api/uploads/processed/abc-1.webp") == "abc-1.webp"
    assert api.image_name("/api/uploads/processed/../../etc/passwd") is None
    assert api.image_name("https://evil.example/x.png") is None
    assert api.image_name(None) is None


def test_profile_from_get_bottle():
    g = {"wine": {"tasting_profile": {"body": "light", "flavors": ["lime"], "description": "x", "verifiedAt": "2026-01-01"}},
         "rating": 90, "occasion": ""}
    out = api.profile_from_get_bottle(g)
    assert out["profile"] == {"body": "light", "flavors": ["lime"], "description": "x", "verified": True}
    assert out["rating"] == 90 and "occasion" not in out


def test_pick_cellar_by_id_or_first():
    cellars = [{"_id": "c1", "name": "HK4"}, {"_id": "c2", "name": "Cabin"}]
    assert api.pick_cellar(cellars, None)["name"] == "HK4"
    assert api.pick_cellar(cellars, "c2")["name"] == "Cabin"


def test_pick_cellar_unknown_id_or_none_at_all():
    import pytest
    with pytest.raises(RuntimeError):
        api.pick_cellar([{"_id": "c1"}], "gone")
    with pytest.raises(RuntimeError):
        api.pick_cellar([], None)
