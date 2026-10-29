# My Cellarion

A Home Assistant dashboard card, and the data integration behind it, for [Cellarion](https://cellarion.app):
browse your whole cellar at a glance, filter it, see where each bottle lies and take a bottle out, right from a dashboard.

> **Heads-up:** this project was built entirely by vibe coding with Claude (Anthropic) and is developed and used on a single
> setup. It does what it says there, but if that is not your thing, please don't install it. Issues and ideas are welcome.

<p align="center">
  <img src="docs/list.png?v=1.0.0" alt="Inventory grouped by wine" width="820"><br>
  <em>The inventory, grouped by wine, with search, filters and an A–Z index.</em>
</p>

<p align="center">
  <img src="docs/filters.png?v=1.0.0" alt="Filter dropdown with counts" width="820"><br>
  <em>Every filter shows how many wines, vintages and bottles match.</em>
</p>

<p align="center">
  <img src="docs/detail.png?v=1.0.0" alt="Bottle details with label image" width="380">
  <img src="docs/phone.png?v=1.0.0" alt="Phone layout" width="300"><br>
  <em>Bottle details with label image, drink window, profile and storage places · the same card on a phone.</em>
</p>

## What you get

- **Inventory grouped by wine** with vintages, bottle counts, price and the places each vintage is stored. Search, A–Z index,
  sorting (wine or producer) and a flat view.
- **Filters** with live counts: type, grape, region, appellation, producer, maturity, vintage, price, storage rack and
  **every personal data field you keep in Cellarion** (they appear as filters automatically). Choose which filters are
  shown and in which order.
- **Bottle details**: your data (price, purchase, merchant, note, personal fields), the register profile (body, acidity,
  flavours, food pairings, description), a drink-window bar with today's position, the label image and the storage places
  with a count per place.
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

1. HACS → ⋮ → **Custom repositories** → `https://github.com/d3rb3rt/my-cellarion-ha`, category **Integration**.
2. Install **My Cellarion** and restart Home Assistant.
3. In Cellarion create an API token (Settings → API tokens) with scope **read**, plus **consume** if you want to take
   bottles out from the card.
4. Home Assistant → Settings → Devices & services → **Add integration** → **My Cellarion**. Enter the server address
   (`https://cellarion.app` for the hosted service) and the token. If your account has several cellars you choose one; you can
   change it later under **Configure**.
5. The card is registered automatically. Edit a dashboard, add the card **My Cellarion**, or use YAML:

```yaml
type: custom:my-cellarion-card
```

The card works best in a view with a single full-width card (panel view), where it fills the whole page.

## Using the card

- **Search** looks in name, producer, vintage, region, country, appellation, classification, grapes, storage place, type
  and your personal fields. Several words must all match.
- **Filters**: tap a filter chip to pick a value. The counts in the dropdown show wines, vintages and bottles.
- **A–Z bar** jumps to a letter and follows the current sorting. Sorted by producer, the letter is the producer's sort word
  (see below).
- A wine with several vintages shows them when you tap the row; tap a vintage for the details.
- **Vintage colours show maturity**, based on your drink window (or Cellarion's curated one):
  blue = not ready yet, teal = in the window, before the peak, green = at its peak, orange = in the window, past the peak,
  red = past the window. The same colours are used in the drink-window bar in the details.
- **Details**: *Take out …* asks for the reason and confirms before anything is written. *Edit in Cellarion* opens the
  bottle in the Cellarion app.

## Statistics

The chart icon in the card header opens an overview of the cellar: bottles, wines, countries, producers, oldest vintage,
cellar value, bottles per type and the top country, producer, region and grape.

- **Everything in the overview is linked.** Tap a **type bar** (or a similar row) to close the overview and filter the list
  by it, for example only the sparkling wines.
- Tap a **tile** (wines, countries, producers, oldest vintage, cellar value, top country, …) to see that breakdown in more
  detail.
- The overview counts everything in the cellar, including items from the *Other* category that are hidden from the list.

<p align="center">
  <img src="docs/statistics.png?v=1.0.0" alt="Statistics overview" width="340">
  <img src="docs/statistics-filter.png?v=1.0.0" alt="List filtered to sparkling wines after tapping a type bar" width="560"><br>
  <em>The overview · the list after tapping "Sparkling".</em>
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
- *Filters*: which filters are shown and in which order. Drag to reorder; your own Cellarion data fields appear here too.

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
  <img src="docs/settings.png?v=1.0.0" alt="Settings" width="360">
  <img src="docs/producers.png?v=1.0.0" alt="Edit producers" width="360">
</p>

Under the integration's **Configure** in Home Assistant you set the refresh interval of the background update and, if your
account has several cellars, which one is shown.

## Card options (all optional)

```yaml
type: custom:my-cellarion-card
title: My Cellarion        # default: none, the cellar name is shown in the page header
language: de               # default: language of the Home Assistant user
view: wine                 # start view: wine (grouped) or flat
refresh_seconds: 300       # re-read the cached inventory this often (0 = never)
refresh_on_open: true      # fetch fresh data from Cellarion when the card opens (at most once a minute)
height: 600px              # fixed height; default: fills the rest of the window
flush: true                # no frame, for use inside another card
```

The full list is at the top of `custom_components/my_cellarion/www/my-cellarion-card.js`. Colours can be overridden in
your theme with `cellarion-accent`, `cellarion-chip-bg`, `cellarion-wine-red`/`-white`/`-rose`, `cellarion-maturity-peak`
and friends (also listed there).

## Services

The card uses these services; they work in automations and scripts too.

| Service | What it does |
|---|---|
| `my_cellarion.read` | Returns the cached inventory and the shared card settings. |
| `my_cellarion.refresh` | Fetches the inventory from Cellarion now. |
| `my_cellarion.sync` | Refreshes only if the cache is older than `max_age` seconds. |
| `my_cellarion.bottle` | Note, purchase, rating, register profile and label image of one bottle (`id`). |
| `my_cellarion.consume_bottle` | Marks a bottle as consumed: `bottle_id`, `reason` (`drank`, `gifted`, `sold`, `other`), optional `rating` (0–100) and `note`. Needs the **consume** scope. |
| `my_cellarion.settings` | Saves the card settings shared by all devices. |
| `my_cellarion.producer_sort` | Sets the sort word of a producer (`name`, `index`; `-1` removes it). |

Example: take a bottle out from a script, for instance behind a button or a voice command.

```yaml
action: my_cellarion.consume_bottle
data:
  bottle_id: 0123456789abcdef01234567   # bottle id from Cellarion
  reason: drank
  note: Dinner with friends
```

## Troubleshooting

- **The card does not show up in the card picker.** Restart Home Assistant after installing, then hard-refresh the
  browser. The integration registers the card as a dashboard resource itself; if your dashboards are in YAML mode, add
  `/my-cellarion-files/my-cellarion-card.js` as a module resource by hand.
- **An error or an empty list.** Check the token (scope **read**) and the server address; reconfigure under
  *Devices & services → My Cellarion*.
- **Take out does nothing / is refused.** The token needs the **consume** scope as well.
- **A new bottle does not appear yet.** Use the refresh button in the card, or lower the refresh interval under
  **Configure**.
- **Text is in the wrong language.** Set the language in the card settings; *automatic* follows the Home Assistant user.

## Privacy

Only your own Cellarion server (or cellarion.app) is contacted, from your Home Assistant server. Label images are cached
in `<config>/my_cellarion_img` and served without login to the browser, like other files in `www`. Personal data fields and
notes are shown only in the card, to whoever can open the dashboard.

## Development

The card is developed in a separate Home Assistant setup and copied here with `tools/sync_card.sh <path to www>`.
Tests: `pip install pytest-homeassistant-custom-component && pytest`. Screenshots in `docs/` are taken from the real card.
