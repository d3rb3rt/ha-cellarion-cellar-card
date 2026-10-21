"""Constants for My Cellarion."""

DOMAIN = "my_cellarion"


CONF_URL = "url"
CONF_TOKEN = "token"
CONF_CELLAR_ID = "cellar_id"
CONF_SCAN_INTERVAL = "scan_interval"
DEFAULT_URL = "https://cellarion.app"
DEFAULT_SCAN_INTERVAL = 3600  # seconds; only a safety net, changes arrive through the event stream
MIN_SCAN_INTERVAL = 300

PAGE_SIZE = 200
MCP_PATH = "/api/mcp"
USER_AGENT = "ha-my-cellarion/0.1"  # Cloudflare in front of cellarion.app rejects default library user agents

STORAGE_KEY = "my_cellarion.settings"
STORAGE_VERSION = 1

FRONTEND_URL_BASE = "/my-cellarion-files"
CARD_FILENAME = "my-cellarion-card.js"
IMAGE_URL_BASE = "/my-cellarion-img"
IMAGE_DIR_NAME = "my_cellarion_img"

EVENT_UPDATED = "my_cellarion_updated"  # fired on the HA bus when the inventory changed
STREAM_DEBOUNCE = 3  # seconds to wait after a change event (several changes become one refresh)
STREAM_SILENCE = 120  # seconds without any data (not even a heartbeat) before reconnecting
STREAM_RETRY_MIN = 5
STREAM_RETRY_MAX = 300
