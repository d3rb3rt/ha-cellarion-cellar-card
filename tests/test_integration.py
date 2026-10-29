"""Setup, config flow and services against a test Home Assistant (pytest-homeassistant-custom-component)."""
from unittest.mock import AsyncMock, patch

from homeassistant.config_entries import ConfigEntryState
from homeassistant.data_entry_flow import FlowResultType
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.cellarion_cellar_card.const import DOMAIN

CELLARS = {"cellars": [{"_id": "c1", "name": "HK4"}]}
RACKS = {"racks": [{"_id": "r1", "name": "Cabinet", "typeConfig": {"shelfRows": [1, 1]}}]}
INVENTORY = {"schema": 1, "cellars": [{"id": "c1", "name": "HK4", "role": "owner"}],
             "racks": [{"id": "r1", "cellar": "c1", "name": "Cabinet"}],
             "wines": {"w1": {"name": "Riesling", "producer": "Anna Müller"}},
             "bottles": [{"id": "b" * 24, "wine": "w1", "cellar": "c1", "vintage": "2021", "window": {},
                          "location": {"rack": "r1", "rackName": "Cabinet", "position": 8, "shelf": 2, "row": 1, "col": 2},
                          "personal": [{"key": "Stil", "value": "Sekt", "level": "wine"}]}]}
INV_URL = "https://cellarion.example/api/inventory"
RACKS_URL = "https://cellarion.example/api/racks?cellar=c1&summary=1"


def entry():
    return MockConfigEntry(domain=DOMAIN, data={"url": "https://cellarion.example", "token": "cel_x"})


def mock_api(aioclient_mock):
    aioclient_mock.get("https://cellarion.example/api/cellars", json=CELLARS)
    aioclient_mock.get(INV_URL, json=INVENTORY, headers={"ETag": 'W/"v1"'})
    aioclient_mock.get(RACKS_URL, json=RACKS)
    aioclient_mock.post("https://cellarion.example/api/mcp", status=404)  # no MCP: no bottle extras
    aioclient_mock.get("https://cellarion.example/api/events/stream", status=404)  # no event stream in tests


async def setup(hass, aioclient_mock):
    mock_api(aioclient_mock)
    e = entry()
    e.add_to_hass(hass)
    with patch("custom_components.cellarion_cellar_card.async_register_frontend", AsyncMock()):
        assert await hass.config_entries.async_setup(e.entry_id)
        await hass.async_block_till_done()
    return e


async def test_flow_creates_entry(hass, aioclient_mock):
    aioclient_mock.get("https://cellarion.example/api/cellars", json=CELLARS)
    r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert r["type"] is FlowResultType.FORM
    with patch("custom_components.cellarion_cellar_card.async_setup_entry", return_value=True):
        r = await hass.config_entries.flow.async_configure(r["flow_id"], {"url": "https://cellarion.example/", "token": " cel_x "})
    assert r["type"] is FlowResultType.CREATE_ENTRY
    assert r["data"] == {"url": "https://cellarion.example", "token": "cel_x", "cellar_id": "c1"}


async def test_flow_asks_for_the_cellar_when_there_are_several(hass, aioclient_mock):
    aioclient_mock.get("https://cellarion.example/api/cellars", json={"cellars": [{"_id": "c1", "name": "HK4"}, {"_id": "c2", "name": "Cabin"}]})
    r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    r = await hass.config_entries.flow.async_configure(r["flow_id"], {"url": "https://cellarion.example", "token": "cel_x"})
    assert r["type"] is FlowResultType.FORM and r["step_id"] == "cellar"
    with patch("custom_components.cellarion_cellar_card.async_setup_entry", return_value=True):
        r = await hass.config_entries.flow.async_configure(r["flow_id"], {"cellar_id": "c2"})
    assert r["type"] is FlowResultType.CREATE_ENTRY and r["data"]["cellar_id"] == "c2"


async def test_flow_rejects_bad_token(hass, aioclient_mock):
    aioclient_mock.get("https://cellarion.example/api/cellars", status=401)
    r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    r = await hass.config_entries.flow.async_configure(r["flow_id"], {"url": "https://cellarion.example", "token": "bad"})
    assert r["type"] is FlowResultType.FORM and r["errors"] == {"base": "invalid_auth"}


async def test_read_returns_inventory_and_settings(hass, aioclient_mock):
    e = await setup(hass, aioclient_mock)
    assert e.state is ConfigEntryState.LOADED
    out = await hass.services.async_call(DOMAIN, "read", blocking=True, return_response=True)
    assert out["cellar"] == "HK4" and out["total"] == 1
    b = out["bottles"][0]
    assert b["location"] == "Cabinet · Fach 2" and b["where"]["fach"] == 1 and b["producer"] == "Anna Müller"
    assert b["p"] == {"Stil": "Sekt"} and out["fields"] == ["Stil"]
    assert out["einstellungen"] == {} and out["sortnamen"] == {}


async def test_settings_roundtrip_and_validation(hass, aioclient_mock):
    await setup(hass, aioclient_mock)
    res = await hass.services.async_call(DOMAIN, "settings", {
        "filter_order": ["types", "p:Lage"], "filter_hidden": ["shop"], "language": "de",
        "rack_settings": {"Cabinet": {"order": "bottom", "side": "thirds"}, "Bad": {"order": "x", "side": "none"}}},
        blocking=True, return_response=True)
    assert res["settings"]["rackSettings"] == {"Cabinet": {"order": "bottom", "side": "thirds"}}
    assert "keepState" not in res["settings"]
    out = await hass.services.async_call(DOMAIN, "read", blocking=True, return_response=True)
    assert out["einstellungen"]["language"] == "de" and out["einstellungen"]["filterHidden"] == ["shop"]
    res = await hass.services.async_call(DOMAIN, "settings", {"filter_order": [], "filter_hidden": [], "keep_state": True}, blocking=True, return_response=True)
    assert res["settings"]["keepState"] is True


async def test_producer_sort(hass, aioclient_mock):
    await setup(hass, aioclient_mock)
    res = await hass.services.async_call(DOMAIN, "producer_sort", {"name": "Anna Müller", "index": 1}, blocking=True, return_response=True)
    assert res["map"] == {"Anna Müller": 1}
    with pytest.raises(Exception):
        await hass.services.async_call(DOMAIN, "producer_sort", {"name": "Unknown", "index": 0}, blocking=True, return_response=True)


async def test_bottle_rejects_bad_id(hass, aioclient_mock):
    await setup(hass, aioclient_mock)
    with pytest.raises(Exception):
        await hass.services.async_call(DOMAIN, "bottle", {"id": "../x"}, blocking=True, return_response=True)


async def test_consume_posts_to_cellarion(hass, aioclient_mock):
    await setup(hass, aioclient_mock)
    aioclient_mock.post(f"https://cellarion.example/api/bottles/{'b' * 24}/consume", json={})
    await hass.services.async_call(DOMAIN, "consume_bottle", {"bottle_id": "b" * 24, "reason": "gifted"}, blocking=True)
    call = [c for c in aioclient_mock.mock_calls if c[0] == "POST" and str(c[1]).endswith("/consume")][0]
    assert call[2] == {"reason": "gifted"}


async def test_sensor_updates_when_inventory_changes(hass, aioclient_mock):
    e = await setup(hass, aioclient_mock)
    await hass.async_block_till_done()
    st = hass.states.get("sensor.cellarion_cellar_card_total_bottles")
    assert st is not None and st.state == "1"
    first = st.attributes["updated"]
    await e.runtime_data.refresh()
    await hass.async_block_till_done()
    assert hass.states.get("sensor.cellarion_cellar_card_total_bottles").attributes["updated"] == first  # unchanged
    changed = {"cellar": "HK4", "total": 0, "racks": [], "fields": [], "bottles": []}
    with patch("custom_components.cellarion_cellar_card.api.build_inventory", AsyncMock(return_value=changed)):
        await e.runtime_data.refresh()
    await hass.async_block_till_done()
    st = hass.states.get("sensor.cellarion_cellar_card_total_bottles")
    assert st.state == "0" and st.attributes["updated"] != first


def calls(aioclient_mock, url):
    return [c for c in aioclient_mock.mock_calls if c[0] == "GET" and str(c[1]) == url]


async def test_unchanged_inventory_answers_304_and_reads_nothing_else(hass, aioclient_mock):
    e = await setup(hass, aioclient_mock)
    first = calls(aioclient_mock, INV_URL)[0]
    assert "If-None-Match" not in first[3]  # nothing known yet: a full read
    assert len(calls(aioclient_mock, RACKS_URL)) == 1
    aioclient_mock.clear_requests()
    aioclient_mock.get(INV_URL, status=304)
    res = await e.runtime_data.refresh()
    assert res["total"] == 1
    assert calls(aioclient_mock, INV_URL)[0][3]["If-None-Match"] == 'W/"v1"'
    assert not calls(aioclient_mock, RACKS_URL)  # the rack layout is not read again


async def test_rack_layout_is_read_again_after_a_day(hass, aioclient_mock):
    e = await setup(hass, aioclient_mock)
    hub = e.runtime_data
    aioclient_mock.clear_requests()
    aioclient_mock.get(RACKS_URL, json=RACKS)
    hub._geo_at -= 25 * 3600
    answers = [(None, 'W/"v1"'), (INVENTORY, 'W/"v2"')]  # first 304, then the full read without If-None-Match
    with patch.object(hub, "_get_inventory", AsyncMock(side_effect=answers)) as get_inventory:
        await hub.refresh()
    assert [c.args[0] for c in get_inventory.call_args_list] == ['W/"v1"', None]
    assert len(calls(aioclient_mock, RACKS_URL)) == 1
    assert hub._etag == 'W/"v2"'


async def test_old_server_without_inventory_endpoint_gives_a_clear_error(hass, aioclient_mock):
    from custom_components.cellarion_cellar_card.hub import CellarionError, Hub

    hub = Hub(hass, "x", "https://cellarion.example", "cel_x")
    aioclient_mock.get(INV_URL, status=404)
    with pytest.raises(CellarionError, match="v1.275"):
        await hub.refresh()
