"""Constants for My Cellarion."""

DOMAIN = "my_cellarion"


CONF_URL = "url"
CONF_TOKEN = "token"
CONF_SCAN_INTERVAL = "scan_interval"
DEFAULT_URL = "https://cellarion.app"
DEFAULT_SCAN_INTERVAL = 1800  # seconds
MIN_SCAN_INTERVAL = 300

PAGE_SIZE = 200
MCP_PATH = "/api/mcp"
USER_AGENT = "ha-my-cellarion/0.1"  # Cloudflare in front of cellarion.app rejects default library user agents

STORAGE_KEY = "my_cellarion.settings"
STORAGE_VERSION = 1

FRONTEND_URL_BASE = "/my-cellarion-files"
CARD_FILENAME = "cellarion-bestand-card.js"
IMAGE_URL_BASE = "/my-cellarion-img"
IMAGE_DIR_NAME = "my_cellarion_img"
