"""Tests for the pure helpers in api.py (no Home Assistant needed)."""
import importlib.util
import pathlib
import sys
import types

PKG = pathlib.Path(__file__).parent.parent / "custom_components" / "cellarion_cellar_card"
pkg = types.ModuleType("mc")
pkg.__path__ = [str(PKG)]
sys.modules["mc"] = pkg
for name in ("const", "api"):
    spec = importlib.util.spec_from_file_location(f"mc.{name}", PKG / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[f"mc.{name}"] = mod
    spec.loader.exec_module(mod)
api = sys.modules["mc.api"]

GEO = api.geometry([{"_id": "r1", "name": "Cabinet", "typeConfig": {"shelfRows": [1, 2, 1]}}])  # 3 shelves; rows per shelf: 1, 2, 1


def loc(shelf, row, col):
    return {"rack": "r1", "rackName": "Cabinet", "shelf": shelf, "row": row, "col": col}


def test_place_top_shelf():
    text, raw = api.place(loc(1, 1, 1), GEO)
    assert text == "Cabinet · Fach 1"
    assert raw == {"rack": "Cabinet", "fach": 3, "fachen": 3, "cols": 6, "lage": 1, "platz": 1}


def test_place_second_row_of_middle_shelf():
    text, raw = api.place(loc(2, 2, 3), GEO)
    assert text == "Cabinet · Fach 2"
    assert raw["fach"] == 2 and raw["lage"] == 2 and raw["platz"] == 3


def test_place_uses_the_places_per_row_of_the_rack():
    geo = api.geometry([{"_id": "r2", "name": "Wide", "cols": 8, "typeConfig": {"shelfRows": [1]}}])
    assert api.place({"rack": "r2", "rackName": "Wide", "shelf": 1, "row": 1, "col": 7}, geo)[1]["cols"] == 8


def test_place_out_of_range_unplaced_and_unknown_layout():
    assert api.place(loc(None, None, None), GEO) == ("Cabinet · ?", {"rack": "Cabinet"})
    assert api.place(None, GEO) is None
    # rack layout not known (rack missing in /api/racks): the neutral text still works
    assert api.place(loc(2, 1, 1), {}) == ("Cabinet · Fach 2", {"rack": "Cabinet"})


def test_slim_drops_empty_and_keeps_place():
    b = {"id": "a" * 24, "wine": "w", "vintage": None, "window": {"drinkFrom": 2024, "peakUntil": 2030}}
    w = {"name": "Riesling", "grapes": ["Riesling"], "country": "Germany"}
    out = api.slim(b, w, ("Cabinet · Fach 1", {"rack": "Cabinet"}))
    assert out["vintage"] == "NV" and out["grapes"] == ["Riesling"] and out["country"] == "Germany"
    assert out["drinkFrom"] == 2024 and out["peakUntil"] == 2030 and "drinkTo" not in out
    assert out["location"] == "Cabinet · Fach 1" and "producer" not in out and "reserved" not in out


def test_personal_bottle_entry_wins_over_wine_entry():
    entries = [{"key": "Lage", "value": "Erste Lage", "level": "bottle"}, {"key": "Lage", "value": "Grosse Lage", "level": "wine"},
               {"key": "Leer", "value": ""}, {"key": "Zahl", "value": 3, "level": "wine"}]
    assert api.personal(entries) == {"Lage": "Erste Lage", "Zahl": "3"}
    assert api.personal(None) == {}


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


def test_rack_geo_lists_the_rows_per_shelf_from_the_bottom():
    geo = api.geometry([{"_id": "r1", "name": "Cabinet", "cols": 4, "typeConfig": {"shelfRows": [8, 6, 10]}}])
    assert geo["r1"]["rows"] == [10, 6, 8]  # lowest shelf first, like "fach" in the places
    inv = {"cellars": [{"id": "c1", "name": "HK4"}], "racks": [{"id": "r1", "cellar": "c1", "name": "Cabinet"}, {"id": "r9", "cellar": "c1", "name": "Unknown"}],
           "wines": {}, "bottles": []}
    assert api.build(inv, geo)["rackGeo"] == {"Cabinet": {"cols": 4, "rows": [10, 6, 8]}}  # a rack without layout has no entry
