"""Serve the cached label images behind authentication (login or a signed URL), never as a public static path."""

from __future__ import annotations

import re
from pathlib import Path

from aiohttp import web
from homeassistant.components.http import HomeAssistantView

from .const import IMAGE_URL_BASE

NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\.(?:webp|jpe?g|png)")


class CellarImageView(HomeAssistantView):
    """GET /api/cellarion_cellar_card/img/<name>; requires_auth is on (default), so a signed path or a token is needed."""

    url = IMAGE_URL_BASE + "/{name}"
    name = "api:cellarion_cellar_card:img"
    requires_auth = True

    def __init__(self, image_dir: Path) -> None:
        self._dir = image_dir

    async def get(self, request: web.Request, name: str) -> web.StreamResponse:
        if not NAME.fullmatch(name):
            raise web.HTTPNotFound
        hass = request.app["hass"]
        path = self._dir / name
        if not await hass.async_add_executor_job(path.is_file):
            raise web.HTTPNotFound
        return web.FileResponse(path, headers={"Cache-Control": "private, max-age=86400"})
