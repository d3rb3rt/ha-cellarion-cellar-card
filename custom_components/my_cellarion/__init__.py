"""My Cellarion: inventory browser card and the services behind it for Cellarion (cellarion.app)."""

from __future__ import annotations

from datetime import timedelta
import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.typing import ConfigType

from .const import CONF_CELLAR_ID, CONF_SCAN_INTERVAL, CONF_TOKEN, CONF_URL, DEFAULT_SCAN_INTERVAL, DOMAIN
from .frontend import async_register_frontend
from .hub import CellarionAuthError, CellarionError, Hub
from .services import async_setup_services

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type MyCellarionConfigEntry = ConfigEntry[Hub]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Services exist as soon as the component is loaded."""
    async_setup_services(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: MyCellarionConfigEntry) -> bool:
    """Set up one Cellarion account."""
    await async_register_frontend(hass)

    # Last 1.x release: tell users that 2.0 renames the integration (new domain, services, sensor and card tag)
    ir.async_create_issue(
        hass, DOMAIN, "renamed", is_fixable=False, severity=ir.IssueSeverity.WARNING, translation_key="renamed",
        learn_more_url="https://github.com/d3rb3rt/ha-cellarion-cellar-card#upgrading-from-1x")

    cellar_id = entry.options.get(CONF_CELLAR_ID) or entry.data.get(CONF_CELLAR_ID)  # none: the first cellar (older entries)
    hub = Hub(hass, entry.entry_id, entry.data[CONF_URL], entry.data[CONF_TOKEN], cellar_id)
    await hub.async_load()
    entry.runtime_data = hub
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    async def _refresh(_now=None) -> None:
        try:
            await hub.refresh()
        except CellarionAuthError:
            entry.async_start_reauth(hass)
        except (CellarionError, RuntimeError) as err:
            _LOGGER.warning("Could not refresh the Cellarion inventory: %s", err)

    # Do not block startup on the first fetch
    entry.async_create_background_task(hass, _refresh(), name="my_cellarion_first_refresh")
    entry.async_create_background_task(hass, hub.stream_listener(), name="my_cellarion_event_stream")
    interval = entry.options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
    entry.async_on_unload(async_track_time_interval(hass, _refresh, timedelta(seconds=interval)))
    entry.async_on_unload(entry.add_update_listener(_reload))
    return True


async def _reload(hass: HomeAssistant, entry: MyCellarionConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: MyCellarionConfigEntry) -> bool:
    """Unload the sensor; the timers and the stream task are cancelled by HA."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_remove_entry(hass: HomeAssistant, entry: MyCellarionConfigEntry) -> None:
    """The rename notice is no longer needed once the integration has been removed."""
    ir.async_delete_issue(hass, DOMAIN, "renamed")
