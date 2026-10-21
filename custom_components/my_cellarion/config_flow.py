"""Config flow: Cellarion address and API token."""

from __future__ import annotations

from typing import Any

import aiohttp
from homeassistant.config_entries import ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
import voluptuous as vol

from homeassistant.helpers.selector import SelectOptionDict, SelectSelector, SelectSelectorConfig, SelectSelectorMode

from .const import (
    CONF_CELLAR_ID, CONF_SCAN_INTERVAL, CONF_TOKEN, CONF_URL, DEFAULT_SCAN_INTERVAL, DEFAULT_URL, DOMAIN, MIN_SCAN_INTERVAL, USER_AGENT,
)


async def _cellars(hass, url: str, token: str) -> tuple[str | None, list[dict[str, str]]]:
    """(error key, cellars as [{id, name}]); the error key is None when the token works."""
    try:
        async with async_get_clientsession(hass).get(
            url.rstrip("/") + "/api/cellars",
            headers={"User-Agent": USER_AGENT, "Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=aiohttp.ClientTimeout(total=20),
        ) as resp:
            if resp.status in (401, 403):
                return "invalid_auth", []
            if resp.status != 200:
                return "cannot_connect", []
            body = await resp.json(content_type=None)
    except (aiohttp.ClientError, TimeoutError, ValueError):
        return "cannot_connect", []
    found = [
        {"id": c.get("_id") or c.get("id"), "name": c.get("name") or "?"}
        for c in (body or {}).get("cellars") or [] if isinstance(c, dict) and (c.get("_id") or c.get("id"))
    ]
    return (None, found) if found else ("no_cellar", [])


async def _check(hass, url: str, token: str) -> str | None:
    """None when the token works, else an error key."""
    err, _ = await _cellars(hass, url, token)
    return None if err in (None, "no_cellar") else err


def _cellar_selector(cellars: list[dict[str, str]]) -> SelectSelector:
    return SelectSelector(SelectSelectorConfig(
        options=[SelectOptionDict(value=c["id"], label=c["name"]) for c in cellars], mode=SelectSelectorMode.DROPDOWN))


class MyCellarionConfigFlow(ConfigFlow, domain=DOMAIN):
    """Set up My Cellarion with a Cellarion API token (scope read; add consume to take bottles out)."""

    VERSION = 1
    _url: str = ""
    _token: str = ""
    _cellars: list[dict[str, str]] = []

    def _create(self, cellar_id: str) -> ConfigFlowResult:
        return self.async_create_entry(title="My Cellarion", data={CONF_URL: self._url, CONF_TOKEN: self._token, CONF_CELLAR_ID: cellar_id})

    async def async_step_cellar(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Several cellars in the account: choose the one to show."""
        if user_input is not None:
            return self._create(user_input[CONF_CELLAR_ID])
        return self.async_show_form(
            step_id="cellar", data_schema=vol.Schema({vol.Required(CONF_CELLAR_ID): _cellar_selector(self._cellars)}))

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            url = user_input[CONF_URL].strip().rstrip("/")
            token = user_input[CONF_TOKEN].strip()
            if not url.startswith(("http://", "https://")):
                errors[CONF_URL] = "invalid_url"
            else:
                err, cellars = await _cellars(self.hass, url, token)
                if err:
                    errors["base"] = err
                else:
                    self._url, self._token, self._cellars = url, token, cellars
                    if len(cellars) == 1:  # nothing to choose
                        return self._create(cellars[0]["id"])
                    return await self.async_step_cellar()
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({
                vol.Required(CONF_URL, default=(user_input or {}).get(CONF_URL, DEFAULT_URL)): str,
                vol.Required(CONF_TOKEN): str,
            }),
            errors=errors,
        )

    async def async_step_reauth(self, entry_data: dict[str, Any]) -> ConfigFlowResult:
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        entry = self._get_reauth_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            token = user_input[CONF_TOKEN].strip()
            if err := await _check(self.hass, entry.data[CONF_URL], token):
                errors["base"] = err
            else:
                return self.async_update_reload_and_abort(entry, data_updates={CONF_TOKEN: token})
        return self.async_show_form(step_id="reauth_confirm", data_schema=vol.Schema({vol.Required(CONF_TOKEN): str}), errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry) -> OptionsFlow:
        return MyCellarionOptionsFlow()


class MyCellarionOptionsFlow(OptionsFlow):
    """Refresh interval and, when the account has several cellars, which one is shown."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        entry = self.config_entry
        schema: dict[Any, Any] = {
            vol.Required(
                CONF_SCAN_INTERVAL, default=entry.options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
            ): vol.All(vol.Coerce(int), vol.Range(min=MIN_SCAN_INTERVAL)),
        }
        _, cellars = await _cellars(self.hass, entry.data[CONF_URL], entry.data[CONF_TOKEN])
        if len(cellars) > 1:
            current = entry.options.get(CONF_CELLAR_ID) or entry.data.get(CONF_CELLAR_ID) or cellars[0]["id"]
            schema[vol.Required(CONF_CELLAR_ID, default=current)] = _cellar_selector(cellars)
        return self.async_show_form(step_id="init", data_schema=vol.Schema(schema))
