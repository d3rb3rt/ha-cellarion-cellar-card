"""Constants for Cellar Card for Cellarion."""

DOMAIN = "cellarion_cellar_card"


CONF_URL = "url"
CONF_TOKEN = "token"
CONF_CELLAR_ID = "cellar_id"
CONF_SCAN_INTERVAL = "scan_interval"
DEFAULT_URL = "https://cellarion.app"
DEFAULT_SCAN_INTERVAL = 3600  # seconds; only a safety net, changes arrive through the event stream
MIN_SCAN_INTERVAL = 300

INVENTORY_PATH = "/api/inventory"  # Cellarion v1.275 or newer
GEO_MAX_AGE = 24 * 3600  # seconds; the rack layout (shelves, places per row) is re-read at least once a day
MCP_PATH = "/api/mcp"
USER_AGENT = "ha-cellarion-cellar-card/2.0"  # Cloudflare in front of cellarion.app rejects default library user agents

STORAGE_KEY = "cellarion_cellar_card.settings"
STORAGE_VERSION = 1

FRONTEND_URL_BASE = "/cellarion-cellar-card-files"
CARD_FILENAME = "cellarion-cellar-card.js"
IMAGE_URL_BASE = "/cellarion-cellar-card-img"
IMAGE_DIR_NAME = "cellarion_cellar_card_img"

STREAM_DEBOUNCE = 3  # seconds to wait after a change event (several changes become one refresh)
STREAM_SILENCE = 120  # seconds without any data (not even a heartbeat) before reconnecting
STREAM_RETRY_MIN = 5
STREAM_RETRY_MAX = 300


def signal_updated(entry_id: str) -> str:
    """Dispatcher signal sent when the inventory changed (the sensor listens)."""
    return f"{DOMAIN}_updated_{entry_id}"
