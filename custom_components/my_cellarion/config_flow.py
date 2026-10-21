"""Config flow: Cellarion address and API token."""

from __future__ import annotations

from typing import Any

import aiohttp
from homeassistant.config_entries import ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
import voluptuous as vol

from .const import CONF_SCAN_INTERVAL, CONF_TOKEN, CONF_URL, DEFAULT_SCAN_INTERVAL, DEFAULT_URL, DOMAIN, MIN_SCAN_INTERVAL, USER_AGENT


async def _check(hass, url: str, token: str) -> str | None:
    """None when the token works, else an error key."""
    try:
        async with async_get_clientsession(hass).get(
            url.rstrip("/") + "/api/cellars",
            headers={"User-Agent": USER_AGENT, "Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=aiohttp.ClientTimeout(total=20),
        ) as resp:
            if resp.status in (401, 403):
                return "invalid_auth"
            if resp.status != 200:
                return "cannot_connect"
    except (aiohttp.ClientError, TimeoutError):
        return "cannot_connect"
    return None


class MyCellarionConfigFlow(ConfigFlow, domain=DOMAIN):
    """Set up My Cellarion with a Cellarion API token (scope read; add consume to take bottles out)."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            url = user_input[CONF_URL].strip().rstrip("/")
            token = user_input[CONF_TOKEN].strip()
            if not url.startswith(("http://", "https://")):
                errors[CONF_URL] = "invalid_url"
            elif err := await _check(self.hass, url, token):
                errors["base"] = err
            else:
                return self.async_create_entry(title="My Cellarion", data={CONF_URL: url, CONF_TOKEN: token})
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
    """How often the inventory is refreshed in the background."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        cur = self.config_entry.options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({vol.Required(CONF_SCAN_INTERVAL, default=cur): vol.All(vol.Coerce(int), vol.Range(min=MIN_SCAN_INTERVAL))}),
        )
