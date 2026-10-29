"""Sensor with the number of bottles. Its `updated` attribute changes whenever the inventory changed,
which is what open cards watch to reload (works for every Home Assistant user, no extra subscription needed)."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, signal_updated
from .hub import Hub


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([TotalBottles(entry.runtime_data, entry.entry_id)])


class TotalBottles(SensorEntity):
    """Bottles in the chosen cellar."""

    _attr_has_entity_name = True
    _attr_name = "Total bottles"
    _attr_icon = "mdi:bottle-wine"
    _attr_native_unit_of_measurement = "bottles"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_should_poll = False

    def __init__(self, hub: Hub, entry_id: str) -> None:
        self._hub = hub
        self._entry_id = entry_id
        self._attr_unique_id = f"{entry_id}_total_bottles"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry_id)}, name="Cellar Card for Cellarion", entry_type=DeviceEntryType.SERVICE)

    @property
    def native_value(self) -> int | None:
        return (self._hub.data or {}).get("total")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"updated": self._hub.changed_at, "cellar": (self._hub.data or {}).get("cellar")}

    async def async_added_to_hass(self) -> None:
        @callback
        def _changed() -> None:
            self.async_write_ha_state()

        self.async_on_remove(async_dispatcher_connect(self.hass, signal_updated(self._entry_id), _changed))
