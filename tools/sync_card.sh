#!/bin/sh
# Copies the card and its language files from the development setup (ha-config/www) into the integration.
# Usage: tools/sync_card.sh /path/to/ha-config/www
set -e
SRC="${1:?path to ha-config/www}"
DST="$(dirname "$0")/../custom_components/my_cellarion/www"
mkdir -p "$DST/cellarion-i18n"
cp "$SRC/cellarion-bestand-card.js" "$DST/"
cp "$SRC"/cellarion-i18n/*.json "$DST/cellarion-i18n/"
