"""Services used by the card (the card talks to them over the websocket call_service API)."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
import voluptuous as vol

from .const import DOMAIN
from .hub import CellarionAuthError, CellarionError, Hub

BOTTLE_ID = vol.All(cv.string, vol.Match(r"^[0-9a-fA-F]{24}$"))
REASONS = ["drank", "gifted", "sold", "other"]


def _hub(hass: HomeAssistant) -> Hub:
    entries = [e for e in hass.config_entries.async_entries(DOMAIN) if e.state is ConfigEntryState.LOADED]
    if not entries:
        raise ServiceValidationError("My Cellarion is not set up")
    return entries[0].runtime_data


async def _guard(coro) -> Any:
    try:
        return await coro
    except CellarionAuthError as err:
        raise HomeAssistantError(f"Cellarion rejected the token: {err}") from err
    except (CellarionError, ValueError) as err:
        raise HomeAssistantError(str(err)) from err


@callback
def async_setup_services(hass: HomeAssistant) -> None:
    """Register the services once."""

    async def read(call: ServiceCall) -> dict[str, Any]:
        return _hub(call.hass).read()

    async def refresh(call: ServiceCall) -> dict[str, Any]:
        return await _guard(_hub(call.hass).refresh())

    async def sync(call: ServiceCall) -> dict[str, Any]:
        return await _guard(_hub(call.hass).sync(call.data["max_age"]))

    async def bottle(call: ServiceCall) -> dict[str, Any]:
        return await _guard(_hub(call.hass).bottle(call.data["id"].lower()))

    async def settings(call: ServiceCall) -> dict[str, Any]:
        d = call.data
        return {"ok": True, "settings": await _guard(_hub(call.hass).set_settings(
            d["filter_order"], d["filter_hidden"], d.get("language"), d.get("rack_settings"), d.get("keep_state"), d.get("hide_other")))}

    async def producer_sort(call: ServiceCall) -> dict[str, Any]:
        return await _guard(_hub(call.hass).producer_sort(call.data["name"], call.data["index"]))

    async def consume(call: ServiceCall) -> None:
        hub = _hub(call.hass)
        await _guard(hub.consume(call.data["bottle_id"].lower(), call.data["reason"], call.data.get("rating"), call.data.get("note")))
        hass.async_create_task(hub.refresh())

    only = SupportsResponse.ONLY
    hass.services.async_register(DOMAIN, "read", read, schema=vol.Schema({}), supports_response=only)
    hass.services.async_register(DOMAIN, "refresh", refresh, schema=vol.Schema({}), supports_response=only)
    hass.services.async_register(DOMAIN, "sync", sync, supports_response=only,
                                 schema=vol.Schema({vol.Optional("max_age", default=300): vol.All(vol.Coerce(int), vol.Range(min=0))}))
    hass.services.async_register(DOMAIN, "bottle", bottle, schema=vol.Schema({vol.Required("id"): BOTTLE_ID}), supports_response=only)
    hass.services.async_register(DOMAIN, "settings", settings, supports_response=only, schema=vol.Schema({
        vol.Required("filter_order"): [cv.string],
        vol.Required("filter_hidden"): [cv.string],
        vol.Optional("language"): cv.string,
        vol.Optional("rack_settings"): dict,
        vol.Optional("keep_state"): cv.boolean,
        vol.Optional("hide_other"): cv.boolean,
    }))
    hass.services.async_register(DOMAIN, "producer_sort", producer_sort, supports_response=only, schema=vol.Schema({
        vol.Required("name"): vol.All(cv.string, vol.Length(max=200)),
        vol.Required("index"): vol.All(vol.Coerce(int), vol.Range(min=-1, max=20)),
    }))
    hass.services.async_register(DOMAIN, "consume_bottle", consume, schema=vol.Schema({
        vol.Required("bottle_id"): BOTTLE_ID,
        vol.Optional("reason", default="drank"): vol.In(REASONS),
        vol.Optional("rating"): vol.All(vol.Coerce(float), vol.Range(min=0, max=100)),
        vol.Optional("note"): vol.All(cv.string, vol.Length(max=1000)),
    }))
