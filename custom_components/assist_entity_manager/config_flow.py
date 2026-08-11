"""Config flow for Assist Entity Manager."""
from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries

from . import DOMAIN


class AssistEntityManagerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Assist Entity Manager."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Create the single Assist Entity Manager instance."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(title="Assist Entity Manager", data={})

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({}),
        )
