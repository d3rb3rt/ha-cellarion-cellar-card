#!/bin/sh
# Copies the card and its language files from the development setup (ha-config/www) into the integration.
# The development setup talks to Cellarion through shell_commands; that part is cut out for the shipped card
# (marked "@dev-only begin/end"), so the card in this repo only knows the integration's services.
# Usage: tools/sync_card.sh /path/to/ha-config/www
set -e
SRC="${1:?path to ha-config/www}"
DST="$(dirname "$0")/../custom_components/my_cellarion/www"
mkdir -p "$DST/cellarion-i18n"
python3 - "$SRC/cellarion-bestand-card.js" "$DST/my-cellarion-card.js" <<'PY'
import re, sys
s = open(sys.argv[1], encoding="utf-8").read()
s = re.sub(r"[ \t]*// @dev-only begin.*?// @dev-only end\n", "", s, flags=re.S)
s = s.replace("const BACKEND = 'dev';", "const BACKEND = 'integration';")
s = s.replace("customElements.get('cellarion-bestand-card')", "customElements.get('my-cellarion-card')").replace("customElements.define('cellarion-bestand-card'", "customElements.define('my-cellarion-card'").replace("type: 'cellarion-bestand-card'", "type: 'my-cellarion-card'").replace("name: 'My Cellarion (dev)'", "name: 'My Cellarion'").replace("'cellarion-bestand:'", "'my-cellarion:'")
s = s.replace("(this._integ() ? 'my_cellarion.consume_bottle' : 'cellarion.consume_bottle')", "'my_cellarion.consume_bottle'")
s = s.replace("(this._integ() ? 'sensor.my_cellarion_total_bottles' : 'sensor.cellarion_total_bottles')", "''")
s = "\n".join(l for l in s.split("\n") if not re.match(r"\s*\*\s+\w+_service:", l) and "shell_command-Antwort" not in l and "bestand.py" not in l)
assert "cellarion-bestand-card'" not in s and "(dev)" not in s and "BACKEND = 'dev'" not in s
assert "shell_command" not in s and "cellarion.consume_bottle'" not in s.replace("my_cellarion.consume_bottle'", ""), "dev-only code left in the card"
open(sys.argv[2], "w", encoding="utf-8").write(s)
PY
cp "$SRC"/cellarion-i18n/*.json "$DST/cellarion-i18n/"
