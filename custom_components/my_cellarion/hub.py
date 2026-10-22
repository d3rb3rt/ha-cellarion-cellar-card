"""The hub: one Cellarion account, cached inventory, shared settings, actions."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
from pathlib import Path
from typing import Any

import aiohttp
from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.util import dt as dt_util
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store

from . import api
from .const import (
    GEO_MAX_AGE, IMAGE_DIR_NAME, IMAGE_URL_BASE, INVENTORY_PATH, STORAGE_KEY, STORAGE_VERSION, STREAM_DEBOUNCE,
    STREAM_RETRY_MAX, STREAM_RETRY_MIN, STREAM_SILENCE, USER_AGENT, signal_updated,
)

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
        self._refresh_handle: asyncio.TimerHandle | None = None
        self._fingerprint: str | None = None
        self._etag: str | None = None  # of the last /api/inventory answer: an unchanged inventory answers 304
        self._geo_at: float = 0.0  # when the rack layout was last read
        self.changed_at: str | None = None  # when the inventory last changed

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

    async def _get_inventory(self, etag: str | None) -> tuple[JsonDict | None, str | None]:
        """GET /api/inventory with If-None-Match: (inventory, etag), or (None, etag) when it is unchanged (304)."""
        headers = {"User-Agent": USER_AGENT, "Authorization": f"Bearer {self._token}", "Accept": "application/json"}
        if etag:
            headers["If-None-Match"] = etag
        for attempt in (1, 2):
            try:
                async with self._session.get(self.url + INVENTORY_PATH, headers=headers,
                                             timeout=aiohttp.ClientTimeout(total=60)) as resp:
                    if resp.status == 304:
                        return None, etag
                    if resp.status == 401:
                        raise CellarionAuthError("token rejected")
                    if resp.status == 403:
                        raise CellarionAuthError(f"token lacks the scope for GET {INVENTORY_PATH}")
                    if resp.status == 404:
                        raise CellarionError(f"{INVENTORY_PATH} not found: this needs Cellarion v1.275 or newer")
                    if resp.status == 429 and attempt == 1:
                        await asyncio.sleep(min(int(resp.headers.get("Retry-After", "10")), 30))
                        continue
                    if not 200 <= resp.status < 300:
                        raise CellarionError(f"GET {INVENTORY_PATH} returned {resp.status}")
                    data = await resp.json(content_type=None)
                    return (data if isinstance(data, dict) else {}), resp.headers.get("ETag")
            except (aiohttp.ClientError, TimeoutError) as err:
                raise CellarionError(f"request failed: {err}") from err
        raise CellarionError(f"GET {INVENTORY_PATH} was rate limited")

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
                           rack_settings: JsonDict | None, keep_state: bool | None = None) -> JsonDict:
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
        if keep_state is not None:
            s["keepState"] = bool(keep_state)  # keep filters and sorting when the page reloads
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

    # ----- event stream -----

    async def stream_listener(self) -> None:
        """Keep Cellarion's event stream open; refresh shortly after every change it reports.

        After each (re)connect the inventory is fetched once, so changes missed while disconnected are caught up.
        """
        delay = STREAM_RETRY_MIN
        first = True
        while True:
            try:
                async with self._session.get(
                    self.url + "/api/events/stream",
                    headers={"User-Agent": USER_AGENT, "Authorization": f"Bearer {self._token}",
                             "Accept": "text/event-stream"},
                    # the server sends a heartbeat comment regularly: silence means a dead connection
                    timeout=aiohttp.ClientTimeout(total=None, sock_connect=15, sock_read=STREAM_SILENCE),
                ) as resp:
                    if resp.status != 200:
                        _LOGGER.debug("Event stream not available (HTTP %s), retrying later", resp.status)
                        delay = STREAM_RETRY_MAX
                    else:
                        delay = STREAM_RETRY_MIN
                        if not first:
                            self._schedule_refresh(0)
                        first = False
                        async for raw in resp.content:
                            if raw.decode("utf-8", "replace").strip() == "event: stats_changed":
                                self._schedule_refresh(STREAM_DEBOUNCE)
            except asyncio.CancelledError:
                self._cancel_refresh()
                raise
            except (aiohttp.ClientError, TimeoutError) as err:
                _LOGGER.debug("Event stream interrupted: %s", err)
            await asyncio.sleep(delay)
            delay = min(delay * 2, STREAM_RETRY_MAX)

    def _cancel_refresh(self) -> None:
        if self._refresh_handle is not None:
            self._refresh_handle.cancel()
            self._refresh_handle = None

    def _schedule_refresh(self, wait: float) -> None:
        """Refresh after `wait` seconds; further changes in the meantime join the same refresh."""
        self._cancel_refresh()
        self._refresh_handle = self.hass.loop.call_later(wait, lambda: self.hass.async_create_task(self._stream_refresh()))

    async def _stream_refresh(self) -> None:
        self._refresh_handle = None
        try:
            await self.refresh()
        except (CellarionError, RuntimeError) as err:
            _LOGGER.warning("Could not refresh the Cellarion inventory after a change: %s", err)

    # ----- inventory -----

    async def refresh(self) -> JsonDict:
        """Fetch the inventory from Cellarion (one run at a time).

        One request for the whole cellar; an unchanged inventory answers 304 and nothing else is read.
        The rack layout (shelves, places per row) is read along with every changed inventory, and at least once a day.
        """
        async with self._lock:
            inv, etag = await self._get_inventory(self._etag if self.data is not None else None)
            if inv is None and time.time() - self._geo_at >= GEO_MAX_AGE:
                inv, etag = await self._get_inventory(None)  # re-read the rack layout once a day
            changed = False
            if inv is not None:
                self.data = await api.build_inventory(inv, self._get, self._cellar_id)
                self._etag, self._geo_at = etag, time.time()
                body = {k: v for k, v in self.data.items() if k != "generated"}
                fp = hashlib.sha1(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()
                changed = fp != self._fingerprint
                self._fingerprint = fp
            self.updated = time.time()
        if changed:  # the sensor writes its state, open cards watch it and reload
            self.changed_at = dt_util.utcnow().isoformat()
            async_dispatcher_send(self.hass, signal_updated(self.entry_id))
        assert self.data is not None
        placed = sum(1 for b in self.data["bottles"] if b.get("location"))
        return {"total": self.data["total"], "placed": placed, "unplaced": self.data["total"] - placed,
                "personal": {"fields": self.data["fields"]}}

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
