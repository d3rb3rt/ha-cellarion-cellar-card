#!/bin/sh
# Copies the card and its language files from the development setup (ha-config/www) into the integration.
# The development setup talks to Cellarion through shell_commands; that part is cut out for the shipped card
# (marked "@dev-only begin/end"), so the card in this repo only knows the integration's services.
# Usage: tools/sync_card.sh /path/to/ha-config/www
set -e
SRC="${1:?path to ha-config/www}"
DST="$(dirname "$0")/../custom_components/cellarion_cellar_card/www"
mkdir -p "$DST/cellarion-i18n"
python3 - "$SRC/cellarion-bestand-card.js" "$DST/cellarion-cellar-card.js" "$(dirname "$0")/card_header.txt" <<'PY'
import re, sys
s = open(sys.argv[1], encoding="utf-8").read()
s = re.sub(r"[ \t]*// @dev-only begin.*?// @dev-only end\n", "", s, flags=re.S)
# English header instead of the development header (German notes and version history)
hdr = open(sys.argv[3], encoding="utf-8").read()
s = hdr + s[s.index("*/") + 3:]
s = s.replace("const BACKEND = 'dev';", "const BACKEND = 'integration';")
s = s.replace("customElements.get('cellarion-bestand-card')", "customElements.get('cellarion-cellar-card')").replace("customElements.define('cellarion-bestand-card'", "customElements.define('cellarion-cellar-card'").replace("type: 'cellarion-bestand-card'", "type: 'cellarion-cellar-card'").replace("name: 'My Cellarion (dev)'", "name: 'Cellar Card for Cellarion'").replace("'cellarion-bestand:'", "'cellarion-cellar-card:'")
s = s.replace("customElements.define('cellarion-cellar-card', CellarionBestandCard);", "customElements.define('cellarion-cellar-card', CellarionBestandCard);\n  // Tag of the 1.x versions, kept so existing dashboards keep working\n  if (!customElements.get('my-cellarion-card')) customElements.define('my-cellarion-card', class extends CellarionBestandCard {});")
s = s.replace("'My Cellarion integration not found'", "'Cellar Card for Cellarion integration not found'")
s = s.replace("(this._integ() ? 'cellarion_cellar_card.consume_bottle' : 'cellarion.consume_bottle')", "'cellarion_cellar_card.consume_bottle'")
s = s.replace("(this._integ() ? 'sensor.cellarion_cellar_card_total_bottles' : 'sensor.cellarion_total_bottles')", "'sensor.cellarion_cellar_card_total_bottles'")
s = "\n".join(l for l in s.split("\n") if not re.match(r"\s*\*\s+\w+_service:", l) and "shell_command-Antwort" not in l and "bestand.py" not in l)
assert "cellarion-bestand-card'" not in s and "(dev)" not in s and "BACKEND = 'dev'" not in s
assert "shell_command" not in s and "cellarion.consume_bottle'" not in s.replace("cellarion_cellar_card.consume_bottle'", ""), "dev-only code left in the card"
assert "const ent = this._cfg.count_entity || 'sensor.cellarion_cellar_card_total_bottles'" in s, "the card must watch the integration sensor"
open(sys.argv[2], "w", encoding="utf-8").write(s)
PY
for f in "$SRC"/cellarion-i18n/*.json; do
python3 - "$f" "$DST/cellarion-i18n/$(basename "$f")" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
json.dump(d, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
open(sys.argv[2], "a").write("\n")
PY
done
