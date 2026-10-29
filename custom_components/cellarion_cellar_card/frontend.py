"""Serve the bundled card (and cached label images) and register the card as a dashboard resource."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration
from homeassistant.util.hass_dict import HassKey

from .const import CARD_FILENAME, DOMAIN, FRONTEND_URL_BASE, IMAGE_DIR_NAME, IMAGE_URL_BASE, LEGACY_FRONTEND_URL_BASE

_LOGGER = logging.getLogger(__name__)
REGISTERED: HassKey[bool] = HassKey(f"{DOMAIN}_frontend_registered")


async def async_register_frontend(hass: HomeAssistant) -> None:
    """Serve the card folder (card + cellarion-i18n/) and the image cache, add the card as a resource once."""
    if hass.data.get(REGISTERED):
        return
    image_dir = Path(hass.config.path(IMAGE_DIR_NAME))
    await hass.async_add_executor_job(lambda: image_dir.mkdir(parents=True, exist_ok=True))
    await hass.http.async_register_static_paths([
        StaticPathConfig(FRONTEND_URL_BASE, str(Path(__file__).parent / "www"), cache_headers=False),
        StaticPathConfig(IMAGE_URL_BASE, str(image_dir), cache_headers=True),
    ])
    hass.data[REGISTERED] = True

    integration = await async_get_integration(hass, DOMAIN)
    card_url = f"{FRONTEND_URL_BASE}/{CARD_FILENAME}"
    versioned = f"{card_url}?v={integration.version}"
    try:
        lovelace = hass.data.get("lovelace")
        resources = getattr(lovelace, "resources", None) if lovelace else None
        if resources is None:
            _LOGGER.info("Lovelace resources unavailable; add %s as a dashboard resource manually", card_url)
            return
        if not resources.loaded:
            await resources.async_load()
            resources.loaded = True
        found = False
        for item in list(resources.async_items()):
            url = item.get("url", "").split("?")[0]
            if url == card_url:
                found = True
                if item["url"] != versioned and hasattr(resources, "async_update_item"):
                    await resources.async_update_item(item["id"], {"url": versioned})
            elif url.startswith(LEGACY_FRONTEND_URL_BASE + "/") and hasattr(resources, "async_delete_item"):
                await resources.async_delete_item(item["id"])  # the 1.x resource, now a dead link
        if found:
            return
        if hasattr(resources, "async_create_item"):
            await resources.async_create_item({"res_type": "module", "url": versioned})
        else:
            _LOGGER.info("Dashboards are in YAML mode; add %s as a module resource manually", card_url)
    except Exception:  # registering the resource is a convenience, never a reason to fail setup
        _LOGGER.warning("Could not register the card automatically; add %s as a dashboard resource manually", card_url, exc_info=True)
