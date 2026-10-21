"""Setup, config flow and services against a test Home Assistant (pytest-homeassistant-custom-component)."""
from unittest.mock import AsyncMock, patch

from homeassistant.config_entries import ConfigEntryState
from homeassistant.data_entry_flow import FlowResultType
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.my_cellarion.const import DOMAIN

CELLARS = {"cellars": [{"_id": "c1", "name": "HK4"}]}
RACKS = {"racks": [{"name": "Cabinet", "typeConfig": {"shelfRows": [1, 1]}, "slots": [{"position": 8, "bottle": "b" * 24}]}]}
BOTTLES = {"bottles": {"total": 1, "items": [{"_id": "b" * 24, "status": "active", "vintage": "2021",
                                              "wineDefinition": {"_id": "w1", "name": "Riesling", "producer": "Anna Müller"}}]}}


def entry():
    return MockConfigEntry(domain=DOMAIN, data={"url": "https://cellarion.example", "token": "cel_x"})


def mock_api(aioclient_mock):
    aioclient_mock.get("https://cellarion.example/api/cellars", json=CELLARS)
    aioclient_mock.get("https://cellarion.example/api/racks?cellar=c1&summary=1", json=RACKS)
    aioclient_mock.get("https://cellarion.example/api/bottles?limit=200&skip=0", json=BOTTLES)
    aioclient_mock.post("https://cellarion.example/api/mcp", status=404)  # no MCP: personal fields stay empty
    aioclient_mock.get("https://cellarion.example/api/events/stream", status=404)  # no event stream in tests


async def setup(hass, aioclient_mock):
    mock_api(aioclient_mock)
    e = entry()
    e.add_to_hass(hass)
    with patch("custom_components.my_cellarion.async_register_frontend", AsyncMock()):
        assert await hass.config_entries.async_setup(e.entry_id)
        await hass.async_block_till_done()
    return e


async def test_flow_creates_entry(hass, aioclient_mock):
    aioclient_mock.get("https://cellarion.example/api/cellars", json=CELLARS)
    r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert r["type"] is FlowResultType.FORM
    with patch("custom_components.my_cellarion.async_setup_entry", return_value=True):
        r = await hass.config_entries.flow.async_configure(r["flow_id"], {"url": "https://cellarion.example/", "token": " cel_x "})
    assert r["type"] is FlowResultType.CREATE_ENTRY
    assert r["data"] == {"url": "https://cellarion.example", "token": "cel_x", "cellar_id": "c1"}


async def test_flow_asks_for_the_cellar_when_there_are_several(hass, aioclient_mock):
    aioclient_mock.get("https://cellarion.example/api/cellars", json={"cellars": [{"_id": "c1", "name": "HK4"}, {"_id": "c2", "name": "Cabin"}]})
    r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    r = await hass.config_entries.flow.async_configure(r["flow_id"], {"url": "https://cellarion.example", "token": "cel_x"})
    assert r["type"] is FlowResultType.FORM and r["step_id"] == "cellar"
    with patch("custom_components.my_cellarion.async_setup_entry", return_value=True):
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
    assert out["einstellungen"] == {} and out["sortnamen"] == {}


async def test_settings_roundtrip_and_validation(hass, aioclient_mock):
    await setup(hass, aioclient_mock)
    res = await hass.services.async_call(DOMAIN, "settings", {
        "filter_order": ["types", "p:Lage"], "filter_hidden": ["shop"], "language": "de",
        "rack_settings": {"Cabinet": {"order": "bottom", "side": "thirds"}, "Bad": {"order": "x", "side": "none"}}},
        blocking=True, return_response=True)
    assert res["settings"]["rackSettings"] == {"Cabinet": {"order": "bottom", "side": "thirds"}}
    out = await hass.services.async_call(DOMAIN, "read", blocking=True, return_response=True)
    assert out["einstellungen"]["language"] == "de" and out["einstellungen"]["filterHidden"] == ["shop"]


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
    st = hass.states.get("sensor.my_cellarion_total_bottles")
    assert st is not None and st.state == "1"
    first = st.attributes["updated"]
    await e.runtime_data.refresh()
    await hass.async_block_till_done()
    assert hass.states.get("sensor.my_cellarion_total_bottles").attributes["updated"] == first  # unchanged
    changed = {"cellar": "HK4", "total": 0, "racks": [], "fields": [], "bottles": [], "personalError": None}
    with patch("custom_components.my_cellarion.api.build_inventory", AsyncMock(return_value=changed)):
        await e.runtime_data.refresh()
    await hass.async_block_till_done()
    st = hass.states.get("sensor.my_cellarion_total_bottles")
    assert st.state == "0" and st.attributes["updated"] != first
