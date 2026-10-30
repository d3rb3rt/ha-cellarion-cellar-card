"""Reading the cellar from Cellarion: the whole inventory (GET /api/inventory), rack layout, bottle details.

Everything here is read-only. The pure helpers (place, slim, build, ...) have no Home Assistant
dependency so they can be tested on their own. Authentication and transport are the hub's (URL and token
of the config entry), nothing is stored twice.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import aiohttp

from .const import MCP_PATH, USER_AGENT

_LOGGER = logging.getLogger(__name__)

JsonDict = dict[str, Any]
Getter = Callable[[str], Awaitable[JsonDict]]


# ---------- pure helpers ----------


def geometry(racks: Any) -> dict[str, JsonDict]:
    """Rack layout from /api/racks: {rack id or name: {name, fachen, cols, rows}}.

    The inventory names, per bottle, only shelf (counted from the top), row and place; the number of
    shelves and the places per row come from here.
    """
    geo: dict[str, JsonDict] = {}
    for r in racks or []:
        sr = [int(x) for x in ((r.get("typeConfig") or {}).get("shelfRows") or []) if isinstance(x, (int, float)) and x >= 0]
        g = {"name": r.get("name"), "fachen": len(sr), "cols": r.get("cols") or 6,
             "rows": sr[::-1]}  # rows = rows per shelf, lowest shelf first
        for key in (r.get("_id"), r.get("id"), r.get("name")):
            if key:
                geo[key] = g
    return geo


def place(loc: JsonDict | None, geo: dict[str, JsonDict]) -> tuple[str, JsonDict] | None:
    """Storage place of a bottle from its inventory location: (neutral text, raw values) or None.

    The text counts shelves from the top like Cellarion itself. The card builds its own display
    from the raw values (count direction and left/middle/right are a per-rack card setting).

    loc = {rack (id), rackName, shelf (from the top), row (within the shelf), col (within the row)}.
    Raw values: fach = shelf counted from the bottom (1 = lowest), fachen = number of shelves,
    lage = row within the shelf, platz = place within the row (1..cols).
    """
    if not loc:
        return None
    g = geo.get(loc.get("rack")) or geo.get(loc.get("rackName")) or {}
    name = loc.get("rackName") or g.get("name")
    if not name:
        return None
    shelf, row, col = loc.get("shelf"), loc.get("row"), loc.get("col")
    if not (shelf and row and col):  # the position lies outside the shelves
        return f"{name} · ?", {"rack": name}
    text = f"{name} · Fach {shelf}"
    fachen = g.get("fachen")
    if not fachen:  # rack layout unknown: text only
        return text, {"rack": name}
    return text, {"rack": name, "fach": fachen - shelf + 1, "fachen": fachen, "cols": g.get("cols") or 6,
                  "lage": row, "platz": col}


def slim(bottle: JsonDict, wine: JsonDict | None, plc: tuple[str, JsonDict] | None) -> JsonDict:
    """Reduce an inventory bottle to what the card needs. `wine` is its entry of inventory["wines"] (each wine once)."""
    w = wine or {}
    win = bottle.get("window") or {}
    out: JsonDict = {
        "id": bottle["id"],
        "wine": bottle.get("wine"),
        "name": w.get("name"),
        "producer": w.get("producer"),
        "vintage": bottle.get("vintage") or "NV",
        "type": w.get("type") or ("other" if w.get("category") == "other" else None),  # "Other" category (not wine): type is null
        "colour": w.get("colour"),
        "country": w.get("country"),
        "region": w.get("region"),
        "appellation": w.get("appellation"),
        "grapes": [str(g) for g in (w.get("grapes") or []) if g],
        "classification": w.get("classification"),
        "drinkFrom": win.get("drinkFrom"),
        "drinkTo": win.get("drinkTo"),
        "peakFrom": win.get("peakFrom"),
        "peakUntil": win.get("peakUntil"),
        "price": bottle.get("price"),
        "currency": bottle.get("currency"),
        "shop": bottle.get("purchaseLocation"),
    }
    if plc:
        out["location"], out["where"] = plc
    else:
        out["location"] = None
    return {k: v for k, v in out.items() if v not in (None, [], "")}


def personal(entries: Any) -> dict[str, str]:
    """Personal data fields of a bottle from the inventory: {field name: value}. An entry on the bottle wins over one on the wine."""
    out: dict[str, str] = {}
    for e in sorted(entries or [], key=lambda e: e.get("level") == "bottle"):
        v = e.get("value")
        if e.get("key") and v not in (None, ""):
            out[e["key"]] = v if isinstance(v, str) else str(v)
    return out


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
    "rating", "ratingScale", "openedAt",
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
                                       "clientInfo": {"name": "ha-cellarion-cellar-card", "version": "2.0"}})
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


def build(inv: JsonDict, geo: dict[str, JsonDict], cellar_id: str | None = None) -> JsonDict:
    """Compact inventory (cellar name, racks, bottles with places and personal fields) of one cellar from GET /api/inventory."""
    cellar = pick_cellar(inv.get("cellars") or [], cellar_id)
    cid = cellar.get("id") or cellar.get("_id")
    wines = inv.get("wines") or {}
    bottles: list[JsonDict] = []
    labels: set[str] = set()
    for b in inv.get("bottles") or []:
        if b.get("cellar") not in (None, cid):  # the inventory also holds cellars shared with the user
            continue
        s = slim(b, wines.get(b.get("wine")), place(b.get("location"), geo))
        p = personal(b.get("personal"))
        if p:
            s["p"] = p
            labels.update(p)
        bottles.append(s)
    return {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "cellar": cellar.get("name"),
        "cellarId": cid,
        "total": len(bottles),
        "racks": [r["name"] for r in inv.get("racks") or [] if r.get("cellar") in (None, cid) and r.get("name")],
        "rackGeo": {r["name"]: {"cols": g["cols"], "rows": g["rows"]} for r in inv.get("racks") or []
                    if r.get("cellar") in (None, cid) and r.get("name") and (g := geo.get(r.get("id")) or geo.get(r.get("name"))) and g.get("rows")},
        "fields": sorted(labels, key=str.casefold),
        "bottles": bottles,
    }


async def build_inventory(inv: JsonDict, get: Getter, cellar_id: str | None = None) -> JsonDict:
    """Compact inventory from an already fetched /api/inventory. Only the rack layout (shelves, places per row) is read on top."""
    cellar = pick_cellar(inv.get("cellars") or [], cellar_id)
    cid = cellar.get("id") or cellar.get("_id")
    geo = geometry((await get(f"/api/racks?cellar={cid}&summary=1")).get("racks"))
    return build(inv, geo, cellar_id)


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
            got = await mcp.tool("get_bottle", {"bottle_id": bottle_id})
            out.update(profile_from_get_bottle(got))
            if "image" not in out:
                # An own photo that is not the default image only shows up in the photo list of get_bottle
                for ph in ((got.get("photos") or {}).get("items") or []):
                    try:
                        img = await fetch_image(urlsplit(ph.get("url") or "").path)
                    except Exception:  # the image is a nicety
                        img = None
                    if img:
                        out["image"] = img
                        break
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
