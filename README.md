# Cellar Card for Cellarion

A Home Assistant dashboard card, and the data integration behind it, for [Cellarion](https://cellarion.app):
browse your whole cellar at a glance, filter it, see where each bottle lies and take a bottle out, right from a dashboard.

> **Heads-up:** this project was built entirely by vibe coding with Claude (Anthropic) and is developed and used on a single
> setup. It does what it says there, but if that is not your thing, please don't install it. Issues and ideas are welcome.

<p align="center">
  <img src="https://raw.githubusercontent.com/d3rb3rt/ha-cellarion-cellar-card/main/docs/list.png?v=2.4.1" alt="Inventory grouped by wine" width="820"><br>
  <em>The inventory, grouped by wine, with search, filters and an A–Z index.</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/d3rb3rt/ha-cellarion-cellar-card/main/docs/filters.png?v=2.4.0" alt="Filter dropdown with counts" width="820"><br>
  <em>Every filter shows how many wines, vintages and bottles match.</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/d3rb3rt/ha-cellarion-cellar-card/main/docs/detail.png?v=1.0.0" alt="Bottle details with label image" width="380">
  <img src="https://raw.githubusercontent.com/d3rb3rt/ha-cellarion-cellar-card/main/docs/phone.png?v=2.4.0" alt="Phone layout" width="300"><br>
  <em>Bottle details with label image, drink window, profile and storage places · the same card on a phone.</em>
</p>

## What you get

- **Inventory grouped by wine** with vintages, bottle counts, price and the places each vintage is stored. Search, A–Z index,
  sorting (wine or producer) and a flat view.
- **Several cellars**: with more than one cellar the cellar name in the header becomes a pulldown (one cellar, or *All
  cellars* together with a cellar tag on each place). The choice is remembered per device. Settings and filters are shared by all cellars.
- **Filters** with live counts: type, grape, region, appellation, producer, maturity, vintage, price, storage rack and
  **every personal data field you keep in Cellarion** (they appear as filters automatically). Choose which filters are
  shown, in which order, and which stay behind a "..." button. A **filter mode** (Default, OR, NOT) lets you pick several
  values in every filter and combine them the way you need.
- **Bottle details**: your data (price, purchase, merchant, note, personal fields), the register profile (body, acidity,
  flavours, food pairings, description), a drink-window bar with today's position, the label image and the storage places
  with a count per place.
- **Rack view**: a small picture of the rack shows where the bottles lie; tap it for the full rack with every shelf and
  slot, and take a bottle out right from there (see below).
- **Take out** from a fixed bar in the details: say why (drunk, gifted, sold, other), confirm, and Cellarion marks the
  bottle as consumed. The card then offers to take out another one of the same vintage.
- **Storage display per rack**: count shelves from the top or the bottom, show the position as left/middle/right, as a slot
  number, or not at all.
- **Languages**: English and German (add one by dropping a JSON file into `www/cellarion-i18n/`). Language and filter
  choices can be shared by all devices or kept per device.
- **Look**: follows your Home Assistant theme, light or dark, adjustable font size, overridable with `--cellarion-*` variables.

The card never talks to Cellarion itself: all requests go through the integration, so the API token stays on your Home
Assistant server.

It complements the official [ha-cellarion](https://github.com/jagduvi1/ha-cellarion) integration (sensors, statistics,
"ready to drink" card); both can run side by side. This one is independent and uses its own API token.

## Requirements

- Home Assistant 2024.11 or newer and [HACS](https://hacs.xyz).
- A Cellarion account on cellarion.app, or a self-hosted server on **v1.275 or newer**. The inventory is read with a single
  request to `GET /api/inventory`; an unchanged inventory answers `304`, so keeping the card up to date costs almost
  nothing. Older servers do not have that endpoint.

## Install

1. HACS → ⋮ → **Custom repositories** → `https://github.com/d3rb3rt/ha-cellarion-cellar-card`, category **Integration**.
2. Install **Cellar Card for Cellarion** and restart Home Assistant.
3. In Cellarion create an API token (Settings → API tokens) with scope **read**, plus **consume** if you want to take
   bottles out from the card.
4. Home Assistant → Settings → Devices & services → **Add integration** → **Cellar Card for Cellarion**. Enter the server address
   (`https://cellarion.app` for the hosted service) and the token. If your account has several cellars you choose which to show
   (leave it empty for all of your own cellars; the first one chosen is the start cellar); you can change it later under **Configure**.
   Cellars shared with you are only included when you pick them there.
5. The card is registered automatically. Edit a dashboard, add the card **Cellar Card for Cellarion**, or use YAML:

```yaml
type: custom:cellarion-cellar-card
```

The card works best in a view with a single full-width card (panel view), where it fills the whole page.

## Upgrading from 1.x

Version 2.0 gives everything one consistent name, which is a breaking change:

| 1.x | 2.0 |
|---|---|
| integration `my_cellarion` | `cellarion_cellar_card` |
| services `my_cellarion.*` | `cellarion_cellar_card.*` |
| sensor `sensor.my_cellarion_total_bottles` | `sensor.cellarion_cellar_card_total_bottles` |
| card `custom:my-cellarion-card` | `custom:cellarion-cellar-card` (the old tag still works) |

Home Assistant treats the new domain as a new integration, so after updating the repository in HACS (the address is now
`https://github.com/d3rb3rt/ha-cellarion-cellar-card`) and restarting, add **Cellar Card for Cellarion** under *Devices &
services*. If the old *My Cellarion* entry is still there, the setup offers to **take over the old setup**: it carries over
the Cellarion address, token, cellar, refresh interval and the card settings kept in the integration (filters, producer sort
words, …), and removes the old entry. You do not need to enter the token again. If you decline, or the old entry is already
gone, set it up as described under Install.

Update automations and scripts that call the old services or the old sensor by hand; they are not changed for you.

## Using the card

- **Search** looks in name, producer, vintage, region, country, appellation, classification, grapes, storage place, type
  and your personal fields. Several words must all match.
- **Filters**: tap a filter chip to pick a value. The counts in the dropdown show wines, vintages and bottles. A filter
  with nothing to choose right now stays in place, greyed out. The *Selected* line at the top of a pick list has an x to
  clear that filter. Filters you moved behind the **...** button are listed there. The classification is split into
  one filter per kind (vineyard rank, ripeness, ageing, other); for grapes an **&** button adds a further grape, and the
  wine must then have all chosen grapes.
- **Several cellars**: with more than one cellar the cellar name in the header is a tinted pulldown. *All cellars* is
  listed first and is the start view until you pick a cellar; the cellars below it are sorted alphabetically. In the
  combined view every storage place carries a small cellar tag, and the statistics, filters and search cover all cellars.
  Pick one cellar to see only its bottles and racks. The choice is remembered per device.
- **Filter mode**: the dashed pulldown at the end of the filter row switches how filters combine.
  *Default* picks one value per filter and all filters must match.
  *OR* allows several values everywhere and shows every wine matching **any** chosen value, for example red **or**
  white **or** Kabinett (chosen filters turn green, with "or" between them).
  *NOT* allows several values everywhere and hides every wine matching **any** chosen value, for example neither
  white nor rosé (chosen filters turn red, with "not" before them); the other filters then only offer what is left.
  Going back to *Default* keeps one value per filter.
- **A–Z bar** jumps to a letter and follows the current sorting. Sorted by producer, the letter is the producer's sort word
  (see below).
- A wine with several vintages shows them when you tap the row; tap a vintage for the details.
- **Vintage colours show maturity**, based on your drink window (or Cellarion's curated one):
  blue = not ready yet, teal = in the window, before the peak, green = at its peak, orange = in the window, past the peak,
  red = past the window. The same colours are used in the drink-window bar in the details.
- **Details**: *Take out …* asks for the reason and confirms before anything is written. *Edit in Cellarion* opens the
  bottle in the Cellarion app.

## Rack view

The details of a bottle show a small picture of the rack it lies in. Tap it (or the rack button in the bar) for the full
view: every shelf and slot of the rack, counted the way you set under *Storage locations*.

- **Solid** = the bottle you opened, **tinted** = other bottles of the same vintage, **filled** = any other bottle.
- Tap a tinted or solid slot to take that bottle out.
- If the wine lies in several racks, the arrows (or a swipe on the phone) move to the previous or next of those racks.
- Hover over a slot to see which wine lies there.

The rack picture needs the rack layout from Cellarion; racks without a layout show only the text of the place.
On phones the list shows just the rack name as the storage place; the exact place is in the details and in the rack view.

<p align="center">
  <img src="https://raw.githubusercontent.com/d3rb3rt/ha-cellarion-cellar-card/main/docs/rack.png?v=2.4.0" alt="Rack view" width="380"><br>
  <em>The rack view: this bottle solid, other bottles of the vintage tinted.</em>
</p>

## Statistics

The chart icon in the card header opens an overview of the cellar: bottles, wines, countries, producers, oldest vintage,
cellar value, bottles per type and the top country, producer, region and grape.

- **Everything in the overview is linked.** Tap a **type bar** (or a similar row) to close the overview and filter the list
  by it, for example only the sparkling wines.
- Tap a **tile** (wines, countries, producers, oldest vintage, cellar value, top country, …) to see that breakdown in more
  detail, for example the producers with their bottle counts. Tap an entry there to filter the list by it.
- The overview counts what the list shows: when *Other* items (not wine) are hidden from the list (see *Show Other in the
  list* under Settings), the overview leaves them out too, so the numbers match the list.

<p align="center">
  <img src="https://raw.githubusercontent.com/d3rb3rt/ha-cellarion-cellar-card/main/docs/statistics.png?v=1.0.0" alt="Statistics overview" width="340">
  <img src="https://raw.githubusercontent.com/d3rb3rt/ha-cellarion-cellar-card/main/docs/statistics-detail.png?v=1.0.0" alt="Statistics detail: producers with bottle counts" width="340"><br>
  <em>The overview · the detail view behind the "Producers" tile.</em>
</p>

## Settings

Tap the gear in the card. Where a setting has the globe/phone switch, it can apply to **all devices** (stored in Home
Assistant) or to **this device only** (stored in the browser).

**Appearance**
- *Language*: automatic (the language of the Home Assistant user), English or German.
- *Color scheme*: automatic (follows the theme), light or dark. This device only.
- *Font size*: 85 % to 200 %. This device only.
- *Force full width*: list, header and alphabet bar use the whole width.

**Filters**
- *When the page reloads*: keep the last filters and sorting, or start fresh.
- *Filters*: every filter has a switch with three states: **On** (in the filter row), **...** (behind the "..." button)
  or **Off** (not offered at all). Drag to reorder; your own Cellarion data fields appear here too. The filter mode
  pulldown is in the list as well; it always sits at the end of the row, before "...".

**List**
- *Info in the list*: which facts appear under each wine name, and in which order.
- *Show Other in the list*: drinks that are not wine (beer, cider, …) live in Cellarion's
  [Other category](https://cellarion.app/blog/other-category). They are always found by search; this switch also lists
  them normally.

**Storage**
- *Storage locations*, per rack: count shelves from the top or the bottom, and show the position as left/middle/right, as
  a slot number, or not at all.

**Data**
- *Edit producers*: choose the word a producer is sorted by (for example "Haag" for "Fritz Haag", or "Clüsserath" for
  "Ansgar Clüsserath"). It drives the producer sorting and the A–Z index. Tap a word to set it, tap again to undo.

<p align="center">
  <img src="https://raw.githubusercontent.com/d3rb3rt/ha-cellarion-cellar-card/main/docs/settings.png?v=1.0.0" alt="Settings" width="360">
  <img src="https://raw.githubusercontent.com/d3rb3rt/ha-cellarion-cellar-card/main/docs/producers.png?v=1.0.0" alt="Edit producers" width="360">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/d3rb3rt/ha-cellarion-cellar-card/main/docs/settings-filters.png?v=2.4.1" alt="Filter settings with the On, ... and Off switch" width="420"><br>
  <em>Filter settings: every filter is On, behind "..." or Off; the filter mode is the last row.</em>
</p>

Under the integration's **Configure** in Home Assistant you set the refresh interval of the background update and, if your
account has several cellars, which of them are shown (empty = all of your own cellars).

## Card options (all optional)

```yaml
type: custom:cellarion-cellar-card
title: Wine cellar         # default: none, the cellar name is shown in the page header
language: de               # default: language of the Home Assistant user
view: wine                 # start view: wine (grouped) or flat
refresh_seconds: 300       # re-read the cached inventory this often (0 = never)
refresh_on_open: true      # fetch fresh data from Cellarion when the card opens (at most once a minute)
height: 600px              # fixed height; default: fills the rest of the window
flush: true                # no frame, for use inside another card
```

The full list is at the top of `custom_components/cellarion_cellar_card/www/cellarion-cellar-card.js`. Colours can be overridden in
your theme with `cellarion-accent`, `cellarion-chip-bg`, `cellarion-wine-red`/`-white`/`-rose`, `cellarion-maturity-peak`
and friends (also listed there).

## Services

The card uses these services; they work in automations and scripts too.

| Service | What it does |
|---|---|
| `cellarion_cellar_card.read` | Returns the cached inventory and the shared card settings. |
| `cellarion_cellar_card.refresh` | Fetches the inventory from Cellarion now. |
| `cellarion_cellar_card.sync` | Refreshes only if the cache is older than `max_age` seconds. |
| `cellarion_cellar_card.bottle` | Note, purchase, rating, register profile and label image of one bottle (`id`). |
| `cellarion_cellar_card.consume_bottle` | Marks a bottle as consumed: `bottle_id`, `reason` (`drank`, `gifted`, `sold`, `other`), optional `rating` (0–100) and `note`. Needs the **consume** scope. |
| `cellarion_cellar_card.settings` | Saves the card settings shared by all devices. |
| `cellarion_cellar_card.producer_sort` | Sets the sort word of a producer (`name`, `index`; `-1` removes it). |

Example: take a bottle out from a script, for instance behind a button or a voice command.

```yaml
action: cellarion_cellar_card.consume_bottle
data:
  bottle_id: 0123456789abcdef01234567   # bottle id from Cellarion
  reason: drank
  note: Dinner with friends
```

## Troubleshooting

- **The card does not show up in the card picker.** Restart Home Assistant after installing, then hard-refresh the
  browser. The integration registers the card as a dashboard resource itself; if your dashboards are in YAML mode, add
  `/cellarion-cellar-card-files/cellarion-cellar-card.js` as a module resource by hand.
- **An error or an empty list.** Check the token (scope **read**) and the server address; reconfigure under
  *Devices & services → Cellar Card for Cellarion*.
- **Take out does nothing / is refused.** The token needs the **consume** scope as well.
- **A new bottle does not appear yet.** Use the refresh button in the card, or lower the refresh interval under
  **Configure**.
- **Text is in the wrong language.** Set the language in the card settings; *automatic* follows the Home Assistant user.

## Privacy

Only your own Cellarion server (or cellarion.app) is contacted, from your Home Assistant server. Label images are cached
in `<config>/cellarion_cellar_card_img` and served without login to the browser, like other files in `www`. Personal data fields and
notes are shown only in the card, to whoever can open the dashboard.

## Development

The card is developed in a separate Home Assistant setup and copied here with `tools/sync_card.sh <path to www>`.
Tests: `pip install pytest-homeassistant-custom-component && pytest`. Screenshots in `docs/` are taken from the real card.
