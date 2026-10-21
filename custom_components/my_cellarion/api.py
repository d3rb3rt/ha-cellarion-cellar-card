"""Reading the cellar from Cellarion: bottle list, racks, personal data fields, bottle details.

Everything here is read-only. The pure helpers (location, slim, ...) have no Home Assistant
dependency so they can be tested on their own. Authentication and transport come from the
official integration's client (same URL, same token), nothing is stored twice.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import aiohttp

from .const import MCP_PATH, PAGE_SIZE, USER_AGENT

_LOGGER = logging.getLogger(__name__)

JsonDict = dict[str, Any]
Getter = Callable[[str], Awaitable[JsonDict]]


# ---------- pure helpers ----------


def location(rack: JsonDict, position: int) -> tuple[str, JsonDict]:
    """Storage place from rack + position: (neutral text, raw values).

    The text counts shelves from the top like Cellarion itself. The card builds its own display
    from the raw values (count direction and left/middle/right are a per-rack card setting).

    shelfRows lists the number of rows per shelf (top first); each row holds `cols` places (6 by default).
    Raw values: fach = shelf counted from the bottom (1 = lowest), fachen = number of shelves,
    lage = row within the shelf, platz = place within the row (1..cols).
    """
    cols = rack.get("cols") or 6
    shelf_rows = (rack.get("typeConfig") or {}).get("shelfRows") or []
    idx = int(position) - 1
    start = 0
    for i, rows in enumerate(shelf_rows):
        size = rows * cols
        if idx < start + size:
            raw = {
                "rack": rack["name"],
                "fach": len(shelf_rows) - i,
                "fachen": len(shelf_rows),
                "cols": cols,
                "lage": (idx - start) // cols + 1,
                "platz": idx % cols + 1,
            }
            return f"{rack['name']} · Fach {i + 1}", raw
        start += size
    return f"{rack['name']} · ?", {"rack": rack["name"]}


def names(items: Any) -> list[str]:
    """Names of a list of {name: ...} dicts."""
    return [x["name"] for x in (items or []) if isinstance(x, dict) and x.get("name")]


def slim(bottle: JsonDict, place: tuple[str, JsonDict] | None) -> JsonDict:
    """Reduce a bottle to what the card needs."""
    wd = bottle.get("wineDefinition") or {}
    country = wd.get("country") if isinstance(wd.get("country"), dict) else {}
    region = wd.get("region") if isinstance(wd.get("region"), dict) else {}
    out: JsonDict = {
        "id": bottle["_id"],
        "wine": wd.get("_id"),
        "name": wd.get("name"),
        "producer": wd.get("producer"),
        "vintage": bottle.get("vintage") or "NV",
        "type": wd.get("type"),
        "colour": wd.get("colour"),
        "country": country.get("name"),
        "region": region.get("name"),
        "appellation": wd.get("appellation"),
        "grapes": names(wd.get("grapes")),
        "classification": wd.get("classification"),
        "drinkFrom": bottle.get("drinkFrom"),
        "drinkTo": bottle.get("drinkTo"),
        "peakFrom": bottle.get("peakFrom"),
        "peakUntil": bottle.get("peakUntil"),
        "price": bottle.get("price"),
        "currency": bottle.get("currency"),
        "reserved": bool(bottle.get("reservation") or bottle.get("reserved")),
        "shop": bottle.get("purchaseLocation"),
    }
    if place:
        out["location"], out["where"] = place
    else:
        out["location"] = None
    return {k: v for k, v in out.items() if v not in (None, [], "")}


def profile_from_get_bottle(g: JsonDict) -> JsonDict:
    """Extra details for the detail view from the MCP tool get_bottle (register profile, occasion, ...)."""
    out: JsonDict = {}
    w = g.get("wine") or {}
    tp = w.get("tasting_profile") or {}
    prof: JsonDict = {k: tp[k] for k in ("body", "acidity", "sweetness", "tannin") if tp.get(k)}
    for k in ("flavors", "foodPairings"):
        if isinstance(tp.get(k), list) and tp[k]:
            prof[k] = [str(x) for x in tp[k]][:12]
    if tp.get("description"):
        prof["description"] = str(tp["description"])[:1500]
    if prof:
        prof["verified"] = bool(tp.get("verifiedAt"))
        out["profile"] = prof
    for key, val in (
        ("community", w.get("community_rating")),
        ("occasion", g.get("occasion")),
        ("onOrder", g.get("on_order")),
        ("added", g.get("added_at")),
        ("ratingScale", g.get("rating_scale")),
        ("rating", g.get("rating")),
    ):
        if val not in (None, "", [], {}):
            out[key] = val
    return out


BOTTLE_DETAIL_KEYS = (
    "notes", "price", "currency", "purchaseDate", "purchaseLocation", "bottleSize",
    "rating", "ratingScale", "openedAt", "reservation", "reserved",
)


# ---------- MCP (read-only tools) ----------


class McpClient:
    """Minimal async client for Cellarion's MCP endpoint (only read tools are called)."""

    def __init__(self, session: aiohttp.ClientSession, base_url: str, token: str) -> None:
        self._session, self._url, self._token = session, base_url.rstrip("/") + MCP_PATH, token
        self._sid: str | None = None
        self._n = 0

    async def start(self) -> None:
        await self._rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                       "clientInfo": {"name": "ha-my-cellarion", "version": "0.1"}})
        await self._rpc("notifications/initialized", notify=True)

    async def _rpc(self, method: str, params: JsonDict | None = None, notify: bool = False) -> JsonDict | None:
        body: JsonDict = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            body["params"] = params
        if not notify:
            self._n += 1
            body["id"] = self._n
        headers = {"User-Agent": USER_AGENT, "Authorization": f"Bearer {self._token}",
                   "Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        if self._sid:
            headers["Mcp-Session-Id"] = self._sid
        async with self._session.post(self._url, json=body, headers=headers,
                                      timeout=aiohttp.ClientTimeout(total=60)) as resp:
            resp.raise_for_status()
            self._sid = resp.headers.get("Mcp-Session-Id") or self._sid
            text = await resp.text()
        if notify or not text.strip():
            return None
        if text.lstrip().startswith("{"):
            return json.loads(text)
        for line in text.splitlines():
            if line.startswith("data:"):
                return json.loads(line[5:])
        return None

    async def tool(self, name: str, args: JsonDict) -> Any:
        try:
            r = await self._rpc("tools/call", {"name": name, "arguments": args})
        except aiohttp.ClientResponseError as err:
            if err.status != 404 or not self._sid:
                raise
            # 404 with a session id means the server dropped the session: sign in again, once
            self._sid = None
            await self.start()
            r = await self._rpc("tools/call", {"name": name, "arguments": args})
        res = (r or {}).get("result") or {}
        if res.get("isError"):
            raise RuntimeError(res["content"][0]["text"][:200])
        d = json.loads(res["content"][0]["text"])
        return d.get("data", d) if isinstance(d, dict) else d


async def personal_fields(mcp: McpClient) -> tuple[dict[str, dict[str, str]], list[str]]:
    """Personal data fields per bottle: ({bottle id: {field label: value}}, [labels]).

    The tools only offer personal fields as filter/group, not as a column: per field fetch the values by
    grouping, then per value the bottle ids by a rows query.
    """
    fields = [
        f for f in await mcp.tool("list_analytics_fields", {})
        if str(f.get("key", "")).startswith("personal.") and f.get("groupable") and "eq" in (f.get("ops") or [])
    ]
    out: dict[str, dict[str, str]] = {}
    labels: list[str] = []
    for f in fields:
        key, label = f["key"], f.get("label") or f["key"]
        buckets = (await mcp.tool("analyze_cellar", {"dimensions": [key]})).get("buckets") or []
        values = [b["dimensions"][0] for b in buckets if b["dimensions"][0] is not None]
        if not values:
            continue
        labels.append(label)
        for v in values:
            off = 0
            while True:
                d = await mcp.tool("analyze_cellar", {
                    "mode": "rows", "columns": ["wine.name"], "limit": 50, "offset": off,
                    "filters": [{"field": key, "op": "eq", "value": v}]})
                rows = d.get("rows") or []
                for r in rows:
                    out.setdefault(r["id"], {})[label] = v
                off += len(rows)
                if not rows or off >= d.get("total", 0):
                    break
    return out, labels


# ---------- inventory ----------


def pick_cellar(cellars: list[JsonDict], cellar_id: str | None) -> JsonDict:
    """The chosen cellar by id, or the first one when no id is configured."""
    if not cellars:
        raise RuntimeError("no cellar found")
    if not cellar_id:
        return cellars[0]
    for c in cellars:
        if cellar_id in (c.get("_id"), c.get("id")):
            return c
    raise RuntimeError("the configured cellar no longer exists")


async def build_inventory(get: Getter, mcp: McpClient | None, cellar_id: str | None = None) -> JsonDict:
    """Compact inventory (cellar name, racks, active bottles with places and personal fields) of one cellar."""
    cellars = (await get("/api/cellars")).get("cellars") or []
    cellar = pick_cellar(cellars, cellar_id)
    cid = cellar.get("_id") or cellar.get("id")
    racks = (await get(f"/api/racks?cellar={cid}&summary=1")).get("racks") or []
    slot: dict[str, tuple[str, JsonDict]] = {}
    for r in racks:
        for s in r.get("slots") or []:
            if s.get("bottle"):
                slot[s["bottle"]] = location(r, s["position"])
    items: list[JsonDict] = []
    skip, total = 0, None
    while total is None or skip < total:
        page = (await get(f"/api/bottles?limit={PAGE_SIZE}&skip={skip}"))["bottles"]
        total = page["total"]
        got = page.get("items") or []
        if not got:
            break
        items.extend(got)
        skip += len(got)
    bottles = [slim(b, slot.get(b["_id"])) for b in items if b.get("status", "active") == "active"]
    pers: dict[str, dict[str, str]] = {}
    labels: list[str] = []
    perr = None
    if mcp is not None:
        try:
            pers, labels = await personal_fields(mcp)
        except Exception as err:  # personal fields are optional: still deliver the inventory
            perr = str(err)[:120]
            _LOGGER.debug("Personal fields unavailable: %s", err)
    for b in bottles:
        if b["id"] in pers:
            b["p"] = pers[b["id"]]
    return {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "cellar": cellar.get("name"),
        "total": len(bottles),
        "racks": [r["name"] for r in racks],
        "fields": labels,
        "bottles": bottles,
        "personalError": perr,
    }


async def bottle_detail(get: Getter, mcp: McpClient | None, bottle_id: str,
                        fetch_image: Callable[[str | None], Awaitable[str | None]]) -> JsonDict:
    """Note, purchase, rating, register profile and label image of one bottle."""
    if not re.fullmatch(r"[a-f0-9]{24}", bottle_id or ""):
        raise ValueError("invalid bottle id")
    d = await get(f"/api/bottles/{bottle_id}")
    b = d.get("bottle") if isinstance(d.get("bottle"), dict) else d
    out: JsonDict = {k: b.get(k) for k in BOTTLE_DETAIL_KEYS if b.get(k) not in (None, "", [])}
    wd = b.get("wineDefinition") if isinstance(b.get("wineDefinition"), dict) else {}
    try:
        img = await fetch_image(b.get("defaultImageUrl") or b.get("vintageImageUrl") or wd.get("image"))
    except Exception as err:  # the image is a nicety
        _LOGGER.debug("Label image unavailable: %s", err)
        img = None
    if img:
        out["image"] = img
    if mcp is not None:
        try:
            out.update(profile_from_get_bottle(await mcp.tool("get_bottle", {"bottle_id": bottle_id})))
        except Exception as err:  # the extras are optional
            _LOGGER.debug("get_bottle extras unavailable: %s", err)
    return out


IMAGE_PATH = re.compile(r"/api/uploads/(?:originals|processed)/([A-Za-z0-9._-]+\.(?:webp|jpe?g|png))")
MAX_IMAGE_BYTES = 5 * 1024 * 1024


def image_name(path: str | None) -> str | None:
    """File name of a Cellarion upload path, None when the path is not a plain upload."""
    m = IMAGE_PATH.fullmatch(path or "")
    return m.group(1) if m else None


async def download_image(session: aiohttp.ClientSession, base_url: str, path: str, dest: Path) -> bool:
    """Download a label image once (Cellarion only serves it same-origin, the browser cannot embed it directly)."""
    if dest.exists():
        return True
    async with session.get(base_url.rstrip("/") + path, headers={"User-Agent": USER_AGENT},
                           timeout=aiohttp.ClientTimeout(total=30)) as resp:
        resp.raise_for_status()
        data = await resp.content.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(dest)
    return True
