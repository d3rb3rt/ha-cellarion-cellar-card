"""The hub: one Cellarion account, cached inventory, shared settings, actions."""

from __future__ import annotations

import asyncio
import logging
import re
import time
from pathlib import Path
from typing import Any

import aiohttp
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store

from . import api
from .const import IMAGE_DIR_NAME, IMAGE_URL_BASE, STORAGE_KEY, STORAGE_VERSION, USER_AGENT

_LOGGER = logging.getLogger(__name__)

JsonDict = dict[str, Any]
RACK_ORDERS = ("top", "bottom")
RACK_SIDES = ("none", "thirds", "slot")


class CellarionAuthError(Exception):
    """The token was rejected or lacks the needed scope."""


class CellarionError(Exception):
    """Any other API problem."""


class Hub:
    """Talks to Cellarion and holds what the card reads."""

    def __init__(self, hass: HomeAssistant, entry_id: str, url: str, token: str, cellar_id: str | None = None) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self.url = url.rstrip("/")
        self._token = token
        self._cellar_id = cellar_id
        self._session = async_get_clientsession(hass)
        self._store: Store[JsonDict] = Store(hass, STORAGE_VERSION, f"{STORAGE_KEY}.{entry_id}")
        self._settings: JsonDict = {}
        self.data: JsonDict | None = None
        self.updated: float = 0.0
        self._lock = asyncio.Lock()
        self._mcp: api.McpClient | None = None

    # ----- transport -----

    async def request(self, method: str, path: str, body: JsonDict | None = None) -> JsonDict:
        """Authenticated JSON request against the Cellarion REST API."""
        try:
            async with self._session.request(
                method, self.url + path, json=body,
                headers={"User-Agent": USER_AGENT, "Authorization": f"Bearer {self._token}", "Accept": "application/json"},
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                if resp.status == 401:
                    raise CellarionAuthError("token rejected")
                if resp.status == 403:
                    raise CellarionAuthError(f"token lacks the scope for {method} {path}")
                if resp.status == 429:
                    await asyncio.sleep(min(int(resp.headers.get("Retry-After", "10")), 30))
                    return await self.request(method, path, body)
                if not 200 <= resp.status < 300:
                    raise CellarionError(f"{method} {path} returned {resp.status}")
                if resp.status == 204:
                    return {}
                data = await resp.json(content_type=None)
                return data if isinstance(data, dict) else {}
        except (aiohttp.ClientError, TimeoutError) as err:
            raise CellarionError(f"request failed: {err}") from err

    async def _get(self, path: str) -> JsonDict:
        return await self.request("GET", path)

    async def _mcp_client(self) -> api.McpClient | None:
        """MCP session (for personal data fields and profiles); None when the server does not offer it."""
        if self._mcp is None:
            client = api.McpClient(self._session, self.url, self._token)
            try:
                await client.start()
            except (aiohttp.ClientError, TimeoutError, ValueError) as err:
                _LOGGER.debug("MCP unavailable: %s", err)
                return None
            self._mcp = client
        return self._mcp

    # ----- settings -----

    async def async_load(self) -> None:
        self._settings = await self._store.async_load() or {}

    async def _save_settings(self) -> None:
        await self._store.async_save(self._settings)

    @property
    def settings(self) -> JsonDict:
        return self._settings

    async def set_settings(self, filter_order: list[str], filter_hidden: list[str], language: str | None,
                           rack_settings: JsonDict | None) -> JsonDict:
        """Settings shared by all devices: filter order/visibility, language, per-rack place display."""
        s = self._settings
        s["filterOrder"] = [str(x) for x in filter_order][:60]
        s["filterHidden"] = [str(x) for x in filter_hidden][:60]
        if language and re.fullmatch(r"[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?", language):
            s["language"] = language
        else:
            s.pop("language", None)  # empty = automatic (language of the Home Assistant user)
        if rack_settings is not None:
            s["rackSettings"] = {
                str(name): {"order": v["order"], "side": v["side"]}
                for name, v in rack_settings.items()
                if isinstance(v, dict) and v.get("order") in RACK_ORDERS and v.get("side") in RACK_SIDES and name
            }
        await self._save_settings()
        return dict(s)

    async def producer_sort(self, name: str, index: int) -> JsonDict:
        """Sort word of a producer (word number from 0, -1 removes the entry)."""
        sort: JsonDict = dict(self._settings.get("winzerSort") or {})
        known = set(sort) | {b.get("producer") for b in (self.data or {}).get("bottles", []) if b.get("producer")}
        if name not in known:
            raise CellarionError("unknown producer")
        if index < 0:
            sort.pop(name, None)
        elif index < len(name.split()):
            sort[name] = index
        else:
            raise CellarionError("word number does not fit the name")
        self._settings["winzerSort"] = sort
        await self._save_settings()
        return {"map": sort}

    # ----- inventory -----

    async def refresh(self) -> JsonDict:
        """Fetch the inventory from Cellarion (one run at a time)."""
        async with self._lock:
            mcp = await self._mcp_client()
            self.data = await api.build_inventory(self._get, mcp, self._cellar_id)
            self.updated = time.time()
        placed = sum(1 for b in self.data["bottles"] if b.get("location"))
        return {"total": self.data["total"], "placed": placed, "unplaced": self.data["total"] - placed,
                "personal": {"fields": self.data["fields"], "error": self.data.get("personalError")}}

    async def sync(self, max_age: int = 300) -> JsonDict:
        """Refresh only when the inventory is older than max_age seconds."""
        if self.data is not None and time.time() - self.updated < max_age:
            return {"skipped": True, "age": int(time.time() - self.updated)}
        return await self.refresh()

    def read(self) -> JsonDict:
        """What the card loads: inventory plus shared settings."""
        if self.data is None:
            return {"error": "inventory not loaded yet, try again in a moment"}
        out = dict(self.data)
        out["sortnamen"] = self._settings.get("winzerSort") or {}
        out["einstellungen"] = self._settings
        return out

    # ----- details, images, actions -----

    def _image_dir(self) -> Path:
        return Path(self.hass.config.path(IMAGE_DIR_NAME))

    async def _fetch_image(self, path: str | None) -> str | None:
        name = api.image_name(path)
        if not name or not path:
            return None
        if not await api.download_image(self._session, self.url, path, self._image_dir() / name):
            return None
        return f"{IMAGE_URL_BASE}/{name}"

    async def bottle(self, bottle_id: str) -> JsonDict:
        mcp = await self._mcp_client()
        return await api.bottle_detail(self._get, mcp, bottle_id, self._fetch_image)

    async def consume(self, bottle_id: str, reason: str, rating: float | None, note: str | None) -> None:
        """Take a bottle out (needs a token with the consume scope)."""
        body: JsonDict = {"reason": reason}
        if rating is not None:
            body["rating"] = rating
        if note:
            body["note"] = note
        await self.request("POST", f"/api/bottles/{bottle_id}/consume", body)
