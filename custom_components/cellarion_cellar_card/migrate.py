"""Take over a 1.x setup (integration "my_cellarion") when 2.x is added."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import CONF_TAKEN_OVER, LEGACY_DOMAIN, LEGACY_STORAGE_KEY, STORAGE_KEY, STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)


def legacy_entries(hass: HomeAssistant) -> list[ConfigEntry]:
    """Config entries of the 1.x integration that are still in this Home Assistant."""
    return list(hass.config_entries.async_entries(LEGACY_DOMAIN))


def takeover_data(old: ConfigEntry) -> dict[str, Any]:
    """Data for the new entry: address, token and cellar of the old one."""
    data = {k: v for k, v in old.data.items() if k in ("url", "token", "cellar_id")}
    data[CONF_TAKEN_OVER] = old.entry_id
    return data


async def async_complete_takeover(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Copy the shared card settings of the old entry, then remove the old entry (once, on first setup)."""
    old_id = entry.data.get(CONF_TAKEN_OVER)
    if not old_id:
        return
    old_store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, f"{LEGACY_STORAGE_KEY}.{old_id}")
    new_store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, f"{STORAGE_KEY}.{entry.entry_id}")
    try:
        settings = await old_store.async_load()
        if settings and not await new_store.async_load():
            await new_store.async_save(settings)
        if hass.config_entries.async_get_entry(old_id):
            await hass.config_entries.async_remove(old_id)
        await old_store.async_remove()
    except Exception:  # the new setup works without the old settings, never block it
        _LOGGER.warning("Could not finish taking over the old Cellar Card setup", exc_info=True)
    hass.config_entries.async_update_entry(entry, data={k: v for k, v in entry.data.items() if k != CONF_TAKEN_OVER})
