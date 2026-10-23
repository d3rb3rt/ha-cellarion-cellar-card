/*
 * my-cellarion-card: browse your Cellarion wine cellar in Home Assistant.
 * Lists all bottles grouped by wine with their vintages, with search, filters (type, maturity, rack, vintage, producer,
 * region, grape and your own data fields), sorting and a flat view. Tap a vintage for details (your data, register profile,
 * storage places, note); "Take out" asks which bottle and why, then confirms before the bottle is consumed.
 *
 * Data comes from the services of the My Cellarion integration (my_cellarion.read and others). The Cellarion API token is
 * never sent to the browser.
 *
 * Configuration (YAML, all optional):
 *   type: custom:my-cellarion-card
 *   key: bestand                  # key for the remembered view and sorting (per browser)
 *   title: My Cellarion           # title above the card (default: none, the cellar name is shown by the page header)
 *   view: wine                    # start view: wine (grouped) or flat; the last choice is remembered
 *   refresh_seconds: 300          # re-read the cached inventory this often (default 300, 0 = never)
 *   refresh_on_open: true         # fetch fresh data from Cellarion when the card opens or becomes visible (at most once a minute)
 *   height: 600px                 # fixed height (default: fills the rest of the window)
 *   flush: true                   # no frame and border (for use inside a combined card)
 *   language: de                  # card language (default: language of the Home Assistant user); files in cellarion-i18n/<language>.json
 *   i18n_path: /my-cellarion-files/cellarion-i18n/   # folder with the language files
 *   header_cellar: false          # do not append the cellar name to the page header
 *   row_h / row_font / title_font / chip_font / chip_h / font_scale   # sizes in px (font_scale is a factor)
 *
 * Maturity (per bottle, by years): not ready (before drinkFrom), early (in the window, before peak), peak,
 * late (in the window, after peak), past (after drinkTo).
 *
 * Colours: Home Assistant theme variables only, with fallbacks. Optional overrides in your theme:
 * cellarion-accent, cellarion-on-text, cellarion-chip-bg, cellarion-seg-bg,
 * cellarion-wine-red/white/rose/sparkling/dessert/fortified, cellarion-maturity-notready/early/peak/late/over.
 *
 * Source of truth: https://github.com/d3rb3rt/my-cellarion-ha
 */
(function () {
  // ---------- Language (i18n) ----------
  // Texts live in <path>/cellarion-i18n/<language>.json (flat, key -> text; plurals as {one, other}).
  // Language: config "language", otherwise the language of the HA user; a missing key falls back to English.
  // A new language is a new file <language>.json with the same keys (en.json is the reference).
  // Cache key of the language files: the same ?v=N as the card resource, so changes take effect at once
  const CARD_V = ((document.currentScript && /[?&]v=([\w.-]+)/.exec(document.currentScript.src)) || [])[1] || String(Date.now());
  // Folder the card was loaded from: cellarion-i18n/ lives next to it (works for /local/ and for the integration)
  // Data source of this file: 'dev' = own development setup, 'integration' = services of the My Cellarion integration (set by tools/sync_card.sh in the integration repo)
  const BACKEND = 'integration';
  const SCRIPT_DIR = (((document.currentScript && document.currentScript.src) || '').split('?')[0].replace(/[^/]*$/, '')) || '/local/';
  const I18N = { lang: 'en', dict: {}, pr: new Intl.PluralRules('en'), files: {} };
  const t = (key, p) => {
    let v = I18N.dict[key];
    if (v === undefined) return key;
    if (v && typeof v === 'object') v = v[I18N.pr.select(Number(p && p.n))] || v.other || '';
    return String(v).replace(/\{(\w+)\}/g, (_, k) => (p && p[k] != null ? p[k] : ''));
  };
  const loadFile = (base, lang) => {
    const k = base + lang;
    if (!I18N.files[k]) {
      I18N.files[k] = fetch(base + lang + '.json?v=' + CARD_V).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    }
    return I18N.files[k];
  };
  // Types, maturity, placeholders: refilled in place when the language changes
  // Experiments behind a switch (empty = no switch in the settings)
  // Experiments only exist in the development card (BACKEND 'dev'); the integration build gets an empty list, so no switch appears there
  const FLAGS = BACKEND === 'dev' ? [{ id: 'hdr2' }] : [];
  const TYPE_KEYS = ['red', 'white', 'rosé', 'sparkling', 'dessert', 'fortified'];
  const STATUS_KEYS = ['over', 'late', 'peak', 'early', 'notready'];
  const TYPES = [];
  const TYPE_LABEL = {};
  const STATUS = [];
  // Price bands per bottle in EUR: upper limit (inclusive) and key; the last one is open-ended
  const PRICE_BANDS = [[10, 'p10'], [20, 'p20'], [30, 'p30'], [50, 'p50'], [75, 'p75'], [100, 'p100'], [Infinity, 'pmax']];
  const PRICE = [];
  const priceKey = (b) => {
    if (typeof b.price !== 'number' || !(b.price > 0) || (b.currency && b.currency !== 'EUR')) return '';
    return PRICE_BANDS.find(([max]) => b.price <= max)[1];
  };
  const STATUS_LABEL = {};
  let NO_LOC = 'Ohne Platz';
  let de = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  const applyLang = (lang, dict) => {
    I18N.lang = lang;
    I18N.dict = dict;
    I18N.pr = new Intl.PluralRules(lang);
    de = new Intl.Collator(lang, { sensitivity: 'base', numeric: true });
    TYPES.length = 0; STATUS.length = 0; PRICE.length = 0;
    TYPE_KEYS.forEach((k) => { TYPES.push([k, t('type.' + k)]); TYPE_LABEL[k] = t('type.' + k); });
    STATUS_KEYS.forEach((k) => { STATUS.push([k, t('status.' + k)]); STATUS_LABEL[k] = t('status.' + k); });
    PRICE_BANDS.forEach(([, k]) => PRICE.push([k, t('price.' + k)]));
    STATUS_LABEL.window = t('status.window');
    STATUS_LABEL.unknown = t('status.unknown');
    NO_LOC = t('loc.none');
  };
  const STATUS_RANK = { over: 0, late: 1, peak: 2, window: 3, early: 4, notready: 5, unknown: 6 };

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) =>
    String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');

  function statusOf(b, year) {
    const f = b.drinkFrom, t = b.drinkTo, p1 = b.peakFrom, p2 = b.peakUntil;
    if (f && year < f) return 'notready';
    if (t && year > t) return 'over';
    if (p1 && p2) return year < p1 ? 'early' : year > p2 ? 'late' : 'peak';
    return f || t ? 'window' : 'unknown';
  }

  const CSS = `
    :host { display: block; }
    ha-card { position: relative; display: flex; flex-direction: column; height: 100%; box-sizing: border-box; overflow: hidden; }
    ha-card.flush { background: none; box-shadow: none; border: 0; border-radius: 0; }
    .wrap {
      /* Colours: all overridable via --cellarion-* (e.g. in the HA theme), otherwise derived from the standard variables of the active theme */
      --cb-text: var(--primary-text-color, #e1e1e1);
      --cb-sub: var(--secondary-text-color, #9b9b9b);
      --cb-line: var(--divider-color, rgba(127,127,127,.3));
      --cb-chip: var(--cellarion-chip-bg, color-mix(in srgb, var(--primary-text-color, #888) 14%, transparent));
      --cb-seg: var(--cellarion-seg-bg, color-mix(in srgb, var(--primary-text-color, #888) 14%, transparent));
      --cb-on: var(--cellarion-accent, var(--primary-color, #03a9f4));
      --cb-on-text: var(--cellarion-on-text, var(--text-primary-color, #fff));
      --cb-ring: color-mix(in srgb, var(--primary-text-color, #888) 45%, transparent);
      --cb-card: var(--card-background-color, #1c1c1c);
      --w-red: var(--cellarion-wine-red, #a4243b);
      --w-white: var(--cellarion-wine-white, #e7da8b);
      --w-rosé: var(--cellarion-wine-rose, #f08aa4);
      --w-sparkling: var(--cellarion-wine-sparkling, #c9b24d);
      --w-dessert: var(--cellarion-wine-dessert, #e39b2d);
      --w-fortified: var(--cellarion-wine-fortified, #8a5a3c);
      --s-notready: var(--cellarion-maturity-notready, var(--info-color, #5b8def));
      --s-early: var(--cellarion-maturity-early, #3cc8c0);
      --s-peak: var(--cellarion-maturity-peak, var(--success-color, #2fa84f));
      --s-late: var(--cellarion-maturity-late, var(--warning-color, #e8a33d));
      --s-over: var(--cellarion-maturity-over, var(--error-color, #d9534f));
      --s-window: var(--cellarion-maturity-peak, var(--success-color, #2fa84f));
      --cb-hl: color-mix(in srgb, var(--warning-color, #ffc107) 38%, transparent);
      --s-unknown: var(--cb-ring);
      display: flex; flex-direction: column; flex: 1; min-height: 0; color: var(--cb-text);
      font-size: var(--cb-row-font, 14px);
    }
    .head { padding: 10px 12px 6px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--cb-line); }
    .top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .title { font-size: var(--cb-title-font, 18px); font-weight: 600; margin-right: 8px; }
    .stand { color: var(--cb-sub); font-size: 12px; }
    [hidden] { display: none !important; }
    button, select, input { font: inherit; color: inherit; }
    button { cursor: pointer; border: 0; background: none; padding: 0; text-align: inherit; }
    .btn, .chip {
      min-height: var(--cb-chip-h, 40px); box-sizing: border-box; padding: 0 12px; border-radius: 20px;
      background: var(--cb-chip); display: inline-flex; align-items: center; gap: 6px;
      font-size: var(--cb-chip-font, 14px); white-space: nowrap; text-align: center; justify-content: center;
    }
    .btn.on, .chip.on { background: var(--cb-on); color: var(--cb-on-text); }
    .chip .n { opacity: .65; font-size: .85em; }
    .seg { display: inline-flex; background: var(--cb-seg); border-radius: 20px; padding: 2px; }
    .seg button {
      min-height: calc(var(--cb-chip-h, 40px) - 4px); padding: 0 12px; border-radius: 18px;
      font-size: var(--cb-chip-font, 14px); display: inline-flex; align-items: center; justify-content: center;
    }
    .seg button.on { background: var(--cb-on); color: var(--cb-on-text); }
    .search { position: relative; flex: 1 1 220px; min-width: 160px; }
    .search input {
      width: 100%; box-sizing: border-box; min-height: var(--cb-chip-h, 40px); border-radius: 20px;
      border: 1px solid var(--cb-line); background: var(--cb-chip); padding: 0 36px 0 14px;
      font-size: var(--cb-chip-font, 14px); outline: none;
    }
    .search input:focus { border-color: var(--cb-on); }
    .search .x {
      position: absolute; right: 2px; top: 0; width: var(--cb-chip-h, 40px); height: var(--cb-chip-h, 40px);
      display: none; align-items: center; justify-content: center; color: var(--cb-sub); font-size: 18px;
    }
    .search.has .x { display: flex; }
    .sel {
      min-height: var(--cb-chip-h, 40px); border-radius: 20px; border: 1px solid var(--cb-line);
      background: var(--cb-chip); padding: 0 10px; font-size: var(--cb-chip-font, 14px); max-width: 100%;
    }
    button.sel.hasv { color: var(--cb-on); font-weight: 600; box-shadow: 0 0 0 1px var(--cb-on) inset; } /* filter has values selected */
    button.sel { width: auto; flex: none; display: inline-flex; align-items: center; justify-content: space-between; gap: 6px; text-align: left; color: var(--cb-text); font-family: inherit; cursor: pointer; white-space: nowrap; overflow: hidden; }
    button.sel::after { content: ''; flex: none; width: 6px; height: 6px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(45deg) translateY(-2px); opacity: .7; margin-right: 4px; }
    button.sel.more-pill { opacity: .75; }
    button.sel.more-pill.open::after { content: '✕'; width: auto; height: auto; border: 0; transform: none; font-size: 12px; margin-right: 2px; }
    .dsheet.ddsheet { gap: 0; padding: 12px 12px 8px; max-width: 360px; max-height: 70%; overflow: hidden; }
    .dlg.dd { align-items: center; padding: 0 24px; box-sizing: border-box; }
    .dlg.dd .dsheet { border-radius: 16px; }
    .dsheet > .ddlist { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
    .ddsheet .dh { flex: none; padding-bottom: 8px; }
    .ddi { display: flex; align-items: center; width: 100%; min-height: 44px; padding: 8px 12px; box-sizing: border-box; border: 0; border-top: 1px solid var(--cb-line); background: transparent; color: var(--cb-text); font: inherit; text-align: left; cursor: pointer; }
    .ddi:active { background: var(--cb-chip); }
    .ddi.cur { font-weight: 600; color: var(--cb-on); }
    .ddsep { height: 6px; border-top: 1px solid var(--cb-line); }
    .filt2 { display: flex; flex-wrap: wrap; gap: 8px 40px; align-items: center; }
    .row-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .glabel { color: var(--cb-text); font-size: 16px; font-weight: 600; margin-right: 4px; min-width: 40px; }
    .more { display: none; flex-wrap: wrap; gap: 8px; }
    .more.open { display: flex; }
    .sumline { display: flex; align-items: center; gap: 8px; color: var(--cb-sub); font-size: 12px; }
    .sumline .grow { margin-right: auto; }
    .az { display: flex; flex-wrap: wrap; justify-content: flex-start; gap: 2px; padding: 4px 8px; border-bottom: 1px solid var(--cb-line); }
    .az[hidden] { display: none; }
    .az button { min-width: 30px; height: 32px; padding: 0 4px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; text-align: center; font-size: var(--cb-chip-font, 14px); font-weight: 600; }
    .az button:disabled { opacity: .28; }
    .list { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; touch-action: pan-y; overscroll-behavior-y: contain; }
    .tdot {
      display: inline-block; width: 11px; height: 11px; border-radius: 50%; flex: none;
      box-shadow: 0 0 0 1.5px var(--cb-ring); background: var(--cb-ring);
    }
    .sdot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--cb-ring); }
    .wine { border-bottom: 1px solid var(--cb-line); }
    .wrow, .frow {
      width: 100%; display: flex; align-items: center; gap: 10px; box-sizing: border-box;
      min-height: var(--cb-row-h, 44px); padding: 6px 12px;
    }
    .wmain { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .wtitle { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
    .wprod { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 0 1 auto; }
    .wtitle.swap .wprod { font-weight: 600; font-size: 1.12em; }
    .wtitle.swap .wname { font-weight: 500; font-size: .94em; }
    .wtitle .wname { font-size: 1.12em; }
    .wtitle .wprod { font-size: .94em; }
    .wreg { color: var(--cb-sub); font-size: .94em; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 0 1 auto; }
    .dh .wreg { white-space: normal; }
    .shead { position: sticky; top: 0; z-index: 2; display: flex; align-items: baseline; gap: 10px; padding: 8px 12px 6px; background: var(--cb-card); border-bottom: 1px solid var(--cb-line); font-weight: 700; font-size: 1.05em; }
    .shead .shn { color: var(--cb-sub); font-weight: 400; font-size: .86em; }
    .wsl { font-weight: 800; color: inherit; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; }
    .wl1, .wl2 { display: contents; }
    /* Row: line 1 = wine + producer (flows as text), line 2 = info items (left) + location / price / vintage / count (right) */
    .wrow { flex-wrap: wrap; row-gap: 2px; }
    .wrow .wmain, .wrow .wtitle { display: contents; }
    .wrow .wl1 { display: block; flex: 1 1 calc(100% - 32px); min-width: 0; }
    .wrow .wl1 > .wit { display: inline; }
    .wrow .wl1 > .wprod { display: inline-block; max-width: 100%; vertical-align: baseline; }
    .wrow .wl1 > .wit.d::after { margin-right: 6px; }
    /* Line 2: the dot sits in front of each item and is clipped by the container where an item starts a line (no dot at line start or end) */
    .wrow .wl2 { display: flex; flex-wrap: wrap; gap: 0 14px; align-items: baseline; overflow: hidden; flex: 1 1 0; min-width: 0; margin-left: 32px; align-self: center; }
    .wrow .wl2 > .wit { position: relative; }
    .wrow .wl2 > .wit::before { content: '·'; position: absolute; left: -9px; top: 0; color: var(--cb-sub); }
    .wrow .wl2 > .wit.d::after, .wrow .wit.e::after { display: none; }
    .wit.d::after { content: '·'; margin-left: 8px; color: var(--cb-sub); font-weight: 400; }
    /* Right side: location, price, vintage, count, arrow (the price is vintage info); the dot only between location and price */
    .wrow .wright { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex: 0 0 auto; margin-left: auto; min-width: 0; }
    .wrow .wright .wloc { order: 0; max-width: none; }
    .wrow .wright .wpm { order: 1; color: var(--cb-sub); white-space: nowrap; }
    .wrow .wright .wpm::before, .vrow .vprl::before { content: '·'; margin-right: 10px; color: var(--cb-sub); font-weight: 400; }
    .wrow .wright .wvint { order: 2; max-width: none; }
    .wrow .wright .wcount { order: 3; }
    .wrow .wright .chev { order: 4; }
    .wrow .wright .wvint.multi { text-align: right; }
    /* Expanded vintages: same order, ascending, no status text */
    .vrow .vmid { order: 0; flex: 1 1 auto; margin-right: 10px; align-items: flex-end; text-align: right; }
    .vrow .locs { justify-content: flex-end; color: var(--cb-sub); font-size: .9em; }
    .vrow .loc b { display: none; }
    .vrow .vprl { order: 1; margin-right: 10px; }
    .vrow .vyear { order: 2; margin-right: 0; min-width: 0; flex: 0 0 auto; }
    .vrow .wcount.vcnt { order: 3; }
    .vrow .chev.vcnt { order: 4; }
    /* Phone: vintage, price, location, count (vintage and price left, location and count right) */
    @media (max-width: 600px) {
      .wrow .wright .wvint { order: 0; }
      .wrow .wright .wpm { order: 1; }
      .wrow .wright .wloc { order: 2; }
      .wrow .wright .wpm::before, .vrow .vprl::before { content: none; }
      .vrow .vyear { order: 0; }
      .vrow .vprl { order: 1; }
      .vrow .vmid { order: 2; }
    }
    .dh .wtitle { flex-wrap: wrap; gap: 0 6px; }
    .dh .wprod { white-space: normal; }
    .wname { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wsub { color: var(--cb-sub); font-size: .86em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wright { display: contents; }
    .fbtn { display: inline-flex; align-items: center; justify-content: center; flex: none; width: var(--cb-chip-h, 40px); padding: 0; position: relative; }
    .fwrap:not(.fopen) { display: none; }
    .fcnt { position: absolute; top: 2px; right: 2px; min-width: 16px; height: 16px; padding: 0 3px; box-sizing: border-box; border-radius: 8px;
      background: var(--cb-on); color: var(--cb-on-text); font-size: 11px; line-height: 16px; text-align: center; }
    .fbtn.on .fcnt { background: var(--cb-on-text); color: var(--cb-on); }
    .sel.fs { min-height: 30px; font-size: 13px; padding: 0 6px 0 10px; border-radius: 15px; flex: none; text-overflow: ellipsis; }
    .btn.round.sm { width: 30px; min-height: 30px; font-size: 16px; }
    .fpills { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .fpills:not(:has(> :not([hidden]))) { display: none; }
    .fpills button[hidden] { display: none; }
    .fpill { min-height: 26px; padding: 0 4px 0 10px; border-radius: 14px; background: var(--cb-chip); font-size: 12px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
    .fpill .x { width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; opacity: .65; font-size: 11px; }
    mark.hl { background: var(--cb-hl); color: inherit; border-radius: 3px; padding: 0 1px; }
    .tsp { flex: none; display: inline-block; vertical-align: middle; width: 22px; height: 22px; }
    .azanc { display: block; height: 0; }
    .az button.cur { background: var(--cb-on); color: var(--cb-on-text); }
    .ptr { height: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; color: var(--cb-sub); font-size: 12px; flex: none; }
    .fbtn.open:not(.on) { box-shadow: 0 0 0 2px var(--cb-on) inset; }
    .fbtn.open.on { box-shadow: 0 0 0 2px var(--cb-on-text) inset; }
    .fwrap { display: flex; flex-direction: column; gap: 8px; }
    .wprice { color: var(--cb-sub); font-size: .94em; white-space: nowrap; flex: none; }
    .wvint { font-weight: 700; color: inherit; white-space: nowrap; max-width: 34%; overflow: hidden; text-overflow: ellipsis; }
    /* Vintage in the color of its maturity instead of a status dot */
    .yv { color: var(--yc); font-weight: 700; }
    .wvint.multi { color: var(--cb-sub); font-weight: 400; }
    .vstat .sdot { display: none; }
    .wloc { color: var(--cb-sub); font-size: .9em; justify-content: flex-end; text-align: right; max-width: 30%; }
    .wrow .wname, .wrow .wprod, .wrow .wreg { white-space: normal; overflow: visible; text-overflow: clip; }
    .wcount { font-weight: 600; min-width: 2.4em; text-align: right; white-space: nowrap; }
    .chev { color: var(--cb-sub); width: 14px; text-align: center; flex: none; }
    .vlist { display: flex; flex-direction: column-reverse; padding: 0 0 6px 44px; }
    .vrow {
      display: flex; align-items: center; gap: 10px; min-height: 34px; padding: 2px 12px 2px 0;
      border-top: 1px dashed var(--cb-line);
    }
    .vyear { font-weight: 700; min-width: 3.2em; }
    .vmid { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .locs { display: flex; flex-wrap: wrap; gap: 2px 12px; }
    .loc b { font-weight: 600; margin-left: 4px; }
    .lp { font-size: .7em; opacity: .7; margin: 0 .55em; vertical-align: .08em; }
    .loc.none { color: var(--cb-sub); }
    /* the sheet has a 12px gap between its children: the -6px margins cancel it so each line sits exactly between two chip rows */
    .d2grp { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; margin: -6px 0; border-top: 1px solid var(--cb-line); }
    .d2gic { flex: none; color: var(--cb-sub); margin-top: 7px; }
    .d2grp .d2chips { flex: 1 1 auto; min-width: 0; margin: 0; }
    .fend { display: contents; }
    .vstat { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; min-width: 5.5em; }
    .frow { border-bottom: 1px solid var(--cb-line); }
    .fyear { font-weight: 700; min-width: 3.2em; }
    .fmid { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .msg { padding: 28px 16px; text-align: center; color: var(--cb-sub); }
    .msg button { margin-top: 12px; }
    .dtop { display: flex; gap: 14px; align-items: flex-start; }
    .dtop .dfacts { flex: 1; min-width: 0; }
    .d2hero { display: flex; gap: 14px; align-items: flex-start; }
    .d2hero .d2main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .d2sub { color: var(--cb-sub); }
    .d2bar { position: relative; height: 10px; border-radius: 5px; background: var(--cb-chip); margin: 18px 0 4px; }
    .d2bar i { position: absolute; top: 0; bottom: 0; border-radius: 5px; }
    .d2bar .w { background: var(--s-early); opacity: .55; }
    .d2bar .p { background: var(--s-peak); }
    .d2bar b { position: absolute; top: -5px; bottom: -5px; width: 2px; background: var(--cb-text); border-radius: 1px; }
    .d2bar b span { position: absolute; top: -15px; left: 50%; transform: translateX(-50%); font-size: .72em; font-weight: 400; color: var(--cb-sub); white-space: nowrap; }
    .d2yrs { display: flex; justify-content: space-between; color: var(--cb-sub); font-size: .85em; }
    .d2chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .d2chips span { background: var(--cb-chip); border-radius: 12px; padding: 3px 10px; font-size: .9em; }
    .d2chips span em { font-style: normal; color: var(--cb-sub); margin-right: 4px; }
    .d2txt { line-height: 1.4; }
    .d2mine { border-left: 2px solid var(--cb-line); padding-left: 10px; margin-top: 4px; display: flex; flex-direction: column; gap: 3px; }
    .d2h { font-size: .7em; letter-spacing: .06em; text-transform: uppercase; color: var(--cb-sub); }
    .d2ne { display: inline-block; margin-left: 4px; font-size: .8em; color: var(--cb-sub); border: 1px solid var(--cb-line); border-radius: 8px; padding: 0 4px; vertical-align: middle; }
    .d2act { align-items: stretch; flex-wrap: nowrap; justify-content: space-between; }
    .d2act .btn { flex: none; align-self: center; }
    .d2sel { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; padding: 4px 8px 4px 12px; min-height: 48px; border: 1px solid var(--cb-line); border-radius: 12px; }
    .d2st .loc, .d2st .d2sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .d2st .bi { display: none; }
    .d2st { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; }
    .d2pill { flex: none; font-size: .85em; padding: 3px 10px; border-radius: 12px; background: var(--cb-chip); color: var(--cb-sub); white-space: nowrap; }
    .d2pill.hot { background: var(--cb-on); color: var(--cb-on-text); }
    .d2pop { position: absolute; left: 12px; right: 12px; bottom: 100%; margin-bottom: 6px; max-height: 45vh; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 10px; background: var(--cb-card); border: 1px solid var(--cb-line); border-radius: 14px; box-shadow: 0 -6px 24px rgba(0,0,0,.45); z-index: 2; }
    .d2tog { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 0; margin-top: 8px; border-top: 1px solid var(--cb-line); text-align: left; }
    details.d2 > summary { cursor: pointer; color: var(--cb-sub); list-style: none; padding: 4px 0; }
    details.d2 > summary::before { content: '▸ '; }
    details.d2[open] > summary::before { content: '▾ '; }
    .dimg { flex: none; width: 120px; max-height: 180px; object-fit: contain; border-radius: 8px; margin: 0 0 8px; background: var(--cb-chip); }
    .vrow, .frow { cursor: pointer; }
    .vrow:active, .frow:active { background: var(--cb-chip); }
    .statsheet { gap: 10px; }
    .statsheet .dh { align-items: center; }
    .shero { display: flex; flex-direction: column; align-items: center; padding: 4px 0 2px; }
    .sbig { font-size: 1.5em; font-weight: 700; color: var(--cb-text); line-height: 1.1; }
    .sbig.huge { font-size: 3.2em; color: var(--cb-on); }
    .sbig.val { color: var(--cb-on); }
    .slbl { font-size: .75em; letter-spacing: .06em; text-transform: uppercase; color: var(--cb-sub); }
    .sgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .stile, .smini { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 12px 8px; border: 1px solid var(--cb-line); border-radius: 12px; background: var(--cb-chip); color: var(--cb-text); font: inherit; cursor: pointer; min-width: 0; }
    .stile.wide { width: 100%; }
    .smini { align-items: flex-start; padding: 8px 12px; }
    .smini .sval { font-weight: 600; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .stile:active, .smini:active, .sbar:active, .srow:active { background: var(--cb-line); }
    .sbars, .slist { display: flex; flex-direction: column; }
    .sbar, .srow { display: grid; align-items: center; gap: 10px; width: 100%; padding: 6px 4px; border: 0; background: transparent; color: var(--cb-text); font: inherit; text-align: left; cursor: pointer; border-radius: 8px; }
    .sbar { grid-template-columns: 16px 64px 1fr 40px; }
    .srow { grid-template-columns: minmax(0, 1.4fr) minmax(40px, 1fr) auto; min-height: 40px; }
    .srl { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .srt { display: flex; flex-direction: column; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .srt small { color: var(--cb-sub); font-size: .8em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sbt { height: 8px; border-radius: 4px; background: var(--cb-chip); overflow: hidden; }
    .sbf { display: block; height: 100%; border-radius: 4px; background: var(--cb-on); }
    .sbc { text-align: right; font-variant-numeric: tabular-nums; color: var(--cb-sub); }
    .stabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
    .stab { flex: none; min-height: 34px; padding: 0 14px; border: 1px solid var(--cb-line); border-radius: 18px; background: transparent; color: var(--cb-text); font: inherit; cursor: pointer; white-space: nowrap; }
    .stab.on { background: var(--cb-on); border-color: var(--cb-on); color: var(--cb-card); font-weight: 600; }
    .shead { margin-top: 6px; font-weight: 600; }
    .shint { text-align: center; opacity: .7; }
    .dlg { position: fixed; inset: 0; z-index: 5; display: flex; align-items: flex-start; justify-content: center; background: rgba(0,0,0,.5); }
    .dsheet {
      background-color: var(--cb-card); color: var(--cb-text); width: 100%; max-width: 560px; max-height: 92%;
      overflow-y: auto; border-radius: 0 0 16px 16px; padding: 16px; box-sizing: border-box; display: flex; flex-direction: column;
      gap: 12px; box-shadow: 0 4px 24px rgba(0,0,0,.4);
      /* Scroll hint: shadows at the top/bottom edge appear only where more content is hidden, plus a visible thin scrollbar */
      --cb-sh: color-mix(in srgb, var(--cb-text) 28%, transparent);
      background-image: linear-gradient(var(--cb-card) 30%, transparent), linear-gradient(transparent, var(--cb-card) 70%),
        radial-gradient(farthest-side at 50% 0, var(--cb-sh), transparent), radial-gradient(farthest-side at 50% 100%, var(--cb-sh), transparent);
      background-position: 0 0, 0 100%, 0 0, 0 100%; background-repeat: no-repeat; background-size: 100% 40px, 100% 40px, 100% 14px, 100% 14px;
      background-attachment: local, local, scroll, scroll;
      scrollbar-width: thin; scrollbar-color: var(--cb-sub) transparent;
      overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y;
    }
    .dsheet > * { flex: none; }
    .dsheet::-webkit-scrollbar { width: 5px; }
    .dsheet::-webkit-scrollbar-thumb { background: var(--cb-sub); border-radius: 3px; }
    .dh { display: flex; align-items: flex-start; gap: 10px; }
    .dh .wmain { flex: 1; }
    .dh .wname { white-space: normal; font-size: 1.2em; }
    .dh .wsub { white-space: normal; }
    .dx { width: 40px; height: 40px; flex: none; display: flex; align-items: center; justify-content: center; font-size: 20px; color: var(--cb-sub); }
    .dfacts { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; }
    .dfacts dt { color: var(--cb-sub); }
    .dfacts dd { margin: 0; }
    .dsec { font-size: 12px; color: var(--cb-sub); text-transform: uppercase; letter-spacing: .04em; }
    .dbot {
      display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 6px 10px; box-sizing: border-box;
      border-radius: 12px; border: 1px solid var(--cb-line);
    }
    .dbot.on { border-color: var(--cb-on); box-shadow: inset 0 0 0 1px var(--cb-on); }
    .dbot .rd { width: 16px; height: 16px; border-radius: 50%; box-sizing: border-box; border: 2px solid var(--cb-ring); flex: none; }
    .dbot.on .rd { border-color: var(--cb-on); background: radial-gradient(var(--cb-on) 0 45%, transparent 50%); }
    .dnote { white-space: pre-wrap; line-height: 1.4; position: relative; }
    .dpur { color: var(--cb-sub); font-size: .9em; }
    .dact {
      display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; position: sticky; bottom: -16px; z-index: 1;
      margin: auto -16px -16px; padding: 10px 16px 16px; background: var(--cb-card); border-top: 1px solid var(--cb-line);
    }
    .dact .btn { padding: 0 18px; }
    .btn.danger { background: var(--s-over); color: var(--text-primary-color, #fff); }
    .btn[disabled] { opacity: .55; }
    .wzrow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0; border-top: 1px solid var(--cb-line); }
    .wzwords { display: flex; flex-wrap: wrap; gap: 4px; flex: 1 1 220px; }
    .wzw { min-height: 40px; padding: 0 12px; border-radius: 20px; background: var(--cb-chip); display: inline-flex; align-items: center; }
    .wzw.on { background: var(--cb-on); color: var(--cb-on-text); font-weight: 700; }
    .wzname { padding: 8px 0; }
    .wznote { color: var(--cb-sub); font-size: .86em; }
    .wzn { color: var(--cb-sub); min-width: 3.4em; text-align: right; }
    .gear { margin-left: auto; color: var(--cb-sub); }
    .scalechips { display: flex; flex-wrap: wrap; gap: 6px; }
    .frow { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-top: 1px solid var(--cb-line); }
    .frow .wmain { flex: 1; }
    .frow .btn.round { width: 36px; min-height: 36px; font-size: 16px; }
    .frow.off .wname { opacity: .5; }
    .sblk { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; border-top: 1px solid var(--cb-line); }
    .dh + .sblk { border-top: 0; padding-top: 4px; }
    .rackblk { margin: 4px 0 2px 4px; padding-left: 12px; border-left: 2px solid var(--cb-line); }
    .racknm { font-size: .88em; font-weight: 600; color: var(--cb-sub); }
    .shd { display: flex; align-items: center; gap: 10px; }
    .shd .wmain { flex: 1; }
    .scopeone { flex: none; cursor: default; pointer-events: none; }
    .setrow { display: flex; align-items: center; gap: 12px; padding: 0; text-align: left; width: 100%; }
    .setrow .wmain { flex: 1; }
    .btn.round { width: var(--cb-chip-h, 40px); padding: 0; font-size: 20px; flex: none; }
    .derr { color: var(--s-over); }
    .dask { font-size: 1.1em; font-weight: 600; }
    @media (min-width: 700px) { .dlg { align-items: center; } .dsheet { border-radius: 16px; max-height: 86%; } }
    /* Flag hdr2 (wide only): filters left in two rows; tools (sort, stats, reload, settings) above the search on the right */
    @media (min-width: 601px) {
      :host([data-hdr2]) .head { display: grid; grid-template-columns: minmax(0, 1fr) max-content; column-gap: 12px; row-gap: 6px; align-items: start; }
      :host([data-hdr2]) .head > .fwrap { grid-column: 1; grid-row: 1; }
      :host([data-hdr2]) .head > .top { grid-column: 2; grid-row: 1; display: grid; grid-template-columns: repeat(4, auto); gap: 8px; justify-content: end; }
      :host([data-hdr2]) .top .title { display: none; }
      :host([data-hdr2]) .top > * { margin-left: 0; }
      /* filter chips in equal-width cells, like on the phone (6 per row) */
      :host([data-hdr2]) .fwrap .more.open { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; }
      :host([data-hdr2]) .fwrap .more.open > .sel.fs { width: 100%; min-width: 0; padding: 0 4px; text-align: center; justify-content: center; overflow: hidden; text-overflow: ellipsis; }
      :host([data-hdr2]) .fwrap .more.open > .fend { display: flex; gap: 6px; min-width: 0; }
      :host([data-hdr2]) .fwrap .more.open > .fend > * { flex: 1 1 0; min-width: 0; width: auto; }
      :host([data-hdr2]) .top .search { grid-column: 1 / -1; grid-row: 2; width: 0; min-width: 100%; } /* as wide as the buttons above, without widening the column itself */
      :host([data-hdr2]) .head > .fpills, :host([data-hdr2]) .head > .sumline { grid-column: 1 / -1; }
    }
    @media (max-width: 600px) {
      .d2st .bw { display: none; } .d2st .bi { display: inline-flex; align-items: center; gap: 3px; vertical-align: -2px; }
      .top .title, .top .rl { display: none; }
      .top { flex-wrap: nowrap; }
      .fbtn { display: inline-flex; align-items: center; justify-content: center; flex: none; width: var(--cb-chip-h, 40px); padding: 0; }
      .top .search { flex: 1 1 0; min-width: 0; }
      .top .sel { flex: none; width: auto; }
      .filt2 { flex-wrap: wrap; gap: 4px 8px; }
      .filt2 .row-chips { gap: 3px; flex-wrap: nowrap; align-items: center; }
      .filt2 .row-chips + .row-chips { padding-left: 6px; border-left: 1px solid var(--cb-line); }
      .glabel { font-size: 11px; min-width: 0; margin-right: 2px; font-weight: 600; }
      .chip { width: 31px; min-height: 31px; padding: 0; border-radius: 50%; }
      .chip .lbl, .chip .n { display: none; }
      .chip.on { background: var(--cb-chip); color: inherit; box-shadow: 0 0 0 2px var(--cb-on) inset; }
      .dlg .chip { width: auto; min-height: var(--cb-chip-h, 40px); padding: 0 12px; border-radius: 20px; }
      .dlg .chip .lbl, .dlg .chip .n { display: inline; }
      .dlg .chip.on { background: var(--cb-on); color: var(--cb-on-text); box-shadow: none; }
      .fwrap:not(.fopen) { display: none; }
      .fwrap { display: flex; flex-direction: column; gap: 8px; }
      .more { gap: 6px; }
      .az { flex-wrap: nowrap; overflow-x: auto; justify-content: flex-start; scrollbar-width: none; padding: 2px 4px; }
      .az::-webkit-scrollbar { display: none; }
      .az button { flex: none; min-width: 28px; height: 36px; }
      .wrow { flex-wrap: wrap; align-items: flex-start; row-gap: 2px; padding: 8px 12px; }
      .wrow .tdot, .wrow .tsp { margin-top: 5px; }
      .wrow .wmain { flex: 1 1 0; min-width: 0; }
      .wrow .wname, .wrow .wprod, .wrow .wreg { white-space: normal; overflow: visible; text-overflow: clip; }
      .wrow .wright { display: flex; align-items: center; gap: 10px; flex: 1 1 100%; margin-left: 0; padding-left: 32px; box-sizing: border-box; }
      .wright .wvint { flex: 0 0 auto; max-width: none; }
      .wright .wvint.multi { flex: 1 1 auto; white-space: normal; }
      .wrow .wmain, .wrow .wtitle { display: block; }
      .wrow .wl1 { flex: none; }
      .wrow .wl2 { margin-left: 0; }
      .wit.d::after { margin-left: 6px; }
      /* Phone: location left, the rest (price, vintage, count) right */
      .wrow .wright .wloc { justify-content: flex-end; text-align: right; flex: 1 1 auto; }
      .wrow .wright .wloc::before { content: none; }
      .wrow .wright .wvint.multi { text-align: left; }
      .vrow .vmid { align-items: flex-end; text-align: right; }
      .vrow .locs { justify-content: flex-end; }
      .wright .chev { margin-left: 0; }
      .yv { color: var(--yc); font-weight: 700; }
      .fwrap .more.open { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
      .fwrap .more.open > .sel.fs { width: 100%; min-width: 0; padding: 0 4px; text-align: center; justify-content: center; overflow: hidden; text-overflow: ellipsis; }
      .fwrap .more.open > .fend { display: flex; gap: 6px; min-width: 0; }
      .fwrap .more.open > .fend > * { flex: 1 1 0; min-width: 0; width: auto; }
      .dsheet:not(.ddsheet):not(.csheet) { height: 100%; max-height: 100%; border-radius: 0; }
      .dtop { gap: 10px; }
      .dimg { width: 84px; max-height: 150px; }
    }
  `;

  class CellarionBestandCard extends HTMLElement {
    setConfig(config) {
      this._cfg = Object.assign({}, config || {});
      this._key = 'my-cellarion:' + (this._cfg.key || 'bestand');
      const st = this._loadState();
      this._view = this._cfg.view === 'flat' ? 'flat' : 'wine';
      this._local = st.local && typeof st.local === 'object' ? st.local : {};
      this._sort = 'name';
      this._scale = this._clampScale(st.scale != null ? st.scale : this._cfg.font_scale);
      this._f = { q: '' };
      this._st = st; this._restored = false;
      if (this._local.keepState !== undefined) this._restore(); // central value only known after the first load
      this._shared = {};
      this._applyEff();
      this._open = new Set();
      this._det = null;
      this._wz = null;
      this._sortMap = {};
      this._info = {};
      this._gone = new Set();
      this._more = true; // Filters start expanded (the phone collapses them when scrolling)
      this._data = null;
      this._error = null;
      this._busy = false;
      this._built = false;
      if (this._hass) this._start();
    }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      if (!this._cfg) return;
      if (first) this._start();
      const ent = this._cfg.count_entity || 'sensor.my_cellarion_total_bottles';
      const st = hass.states && hass.states[ent];
      // Integration: the sensor's `updated` attribute changes whenever the hub saw a change in Cellarion
      const val = st ? (this._integ() ? st.state + '|' + ((st.attributes && st.attributes.updated) || '') : st.state) : undefined;
      if (this._countSeen !== undefined && val !== undefined && val !== this._countSeen) {
        // The automation is refreshing the cache right now; wait briefly, then read.
        clearTimeout(this._cntTimer);
        this._cntTimer = setTimeout(() => this._load(), this._integ() ? 800 : 9000);
      }
      if (val !== undefined) this._countSeen = val;
    }

    getCardSize() { return 12; }
    getGridOptions() { return { columns: 12, min_columns: 6, rows: 'auto' }; }
    static getStubConfig() { return {}; }

    connectedCallback() {
      this._onVis = this._onVis || (() => { if (!document.hidden && this._hass && this._cfg && this._built) this._openSync(); });
      this._onResize = this._onResize || (() => this._fit());
      document.addEventListener('visibilitychange', this._onVis);
      window.addEventListener('resize', this._onResize);
      this._onPop = this._onPop || (() => this._hpop());
      window.addEventListener('popstate', this._onPop);
      this._onWheel = this._onWheel || ((e) => this._wheelAnywhere(e));
      window.addEventListener('wheel', this._onWheel, { passive: false });
      if (this._hass && this._cfg) {
        this._startTimer();
        if (this._built) { this._fit(); this._openSync(); }
      }
    }
    disconnectedCallback() {
      clearInterval(this._timer); clearTimeout(this._cntTimer); clearTimeout(this._afterTimer); this._timer = null;
      document.removeEventListener('visibilitychange', this._onVis);
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('popstate', this._onPop);
      window.removeEventListener('wheel', this._onWheel);
    }

    // Mouse wheel / touchpad anywhere on the dashboard scrolls the list (not only when hovering over it).
    _wheelAnywhere(e) {
      const list = this._listEl;
      if (!list || e.defaultPrevented || e.ctrlKey || e.deltaY === 0) return;
      if (this._dlg && !this._dlg.hidden) return;
      if (!list.getClientRects().length) return;
      const path = e.composedPath();
      if (path.includes(list)) return;
      const isAnc = (el) => { for (let n = this; n; n = n.getRootNode && n.getRootNode().host) { if (el === n || el.contains(n)) return true; } return false; };
      for (const el of path) {
        if (!(el instanceof Element) || isAnc(el)) continue;
        const cs = getComputedStyle(el);
        if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) return;
        if (el.matches && el.matches('input,textarea,select,ha-dialog,ha-more-info-dialog')) return;
      }
      const max = list.scrollHeight - list.clientHeight;
      if ((e.deltaY < 0 && list.scrollTop <= 0) || (e.deltaY > 0 && list.scrollTop >= max - 1)) return;
      list.scrollTop += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (e.deltaY > 0 && this._more && list.scrollTop > 2 && !this._hdr2()) { this._more = false; this._autoFolded = true; this._renderHead(); }
      e.preventDefault();
    }

    // Fetch fresh data from Cellarion when the page opens (and when the tab becomes visible again), at most once a minute.
    _openSync() {
      if (this._cfg.refresh_on_open === false || this._busy) return;
      if (this._lastRefresh && Date.now() - this._lastRefresh < 60000) return;
      this._refreshNow('sync');
    }
    // Without a fixed height the card fills the rest of the window, so the list scrolls inside the card and not the page.
    _fit() {
      if (!this._built || this._cfg.height) return;
      const card = this.shadowRoot.querySelector('ha-card');
      if (!card) return;
      const top = this.getBoundingClientRect().top;
      card.style.height = Math.max(420, window.innerHeight - top - 8) + 'px';
    }

    // ---------- State ----------
    _clampScale(v) {
      v = Number(v);
      return v >= 0.8 && v <= 2.5 ? Math.round(v * 100) / 100 : 1;
    }
    _applyScale() {
      const w = this.shadowRoot && this.shadowRoot.querySelector('.wrap');
      if (w) w.style.zoom = this._scale === 1 ? '' : String(this._scale);
    }
    _loadState() {
      try { return JSON.parse(localStorage.getItem(this._key) || '{}') || {}; } catch (e) { return {}; }
    }
    // Settings with the choice "all devices" (central on HA, this._shared) or "this device only" (browser, this._local):
    // language and filters (order + visibility). The browser value wins when present, otherwise the central one.
    _applyEff() {
      const L = this._local || {}, S = this._shared || {};
      this._langSel = L.language !== undefined ? L.language : (typeof S.language === 'string' ? S.language : '');
      const F = L.filters || S;
      this._fo = Array.isArray(F.filterOrder) ? F.filterOrder.slice() : [];
      this._fh = new Set(Array.isArray(F.filterHidden) ? F.filterHidden : []);
      // Info behind the wine name in the list: order + what is shown (this device only)
      const I = L.info || {};
      this._io = Array.isArray(I.order) ? I.order.slice() : [];
      this._is = new Set(Array.isArray(I.show) ? I.show : ['cls', 'region', 'price']);
    }
    _infoDefs() {
      const std = [['cls', t('filter.cls')], ['region', t('filter.region')], ['grape', t('filter.grape')]]
        .map(([id, label]) => ({ id, label }));
      const pers = ((this._data && this._data.fields) || []).map((l) => ({ id: 'p:' + l, label: l, personal: true }));
      const all = std.concat(pers);
      const pos = (d) => { const k = (this._io || []).indexOf(d.id); return k < 0 ? 1000 + all.indexOf(d) : k; };
      // The price is special (bottle data, not wine data): always last, not sortable
      return all.slice().sort((a, b) => pos(a) - pos(b)).concat([{ id: 'price', label: t('filter.price'), fixed: true }]);
    }
    _priceOnly(pr) { const m = String(pr || '').match(/wprice wpd">(.*?)<\/span>/); return m ? m[1] : ''; }
    _setInfo(order, show) {
      this._local.info = { order, show };
      this._saveState(); this._applyEff();
    }
    _imove(id, dir) {
      const ids = this._infoDefs().filter((d) => !d.fixed).map((d) => d.id);
      const i = ids.indexOf(id), j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return;
      ids.splice(j, 0, ids.splice(i, 1)[0]);
      this._setInfo(ids, Array.from(this._is));
      this._renderSet(); this._renderAll();
    }
    _setLang(v) {
      if (this._local.language !== undefined) { this._local.language = v; this._saveState(); }
      else { if (v) this._shared.language = v; else delete this._shared.language; this._saveSettings(); }
      this._applyEff();
    }
    _setFilters(order, hidden) {
      if (this._local.filters) { this._local.filters = { filterOrder: order, filterHidden: hidden }; this._saveState(); }
      else { this._shared.filterOrder = order; this._shared.filterHidden = hidden; this._saveSettings(); }
      this._applyEff();
    }
    // Switch "all devices" (globe) / "this device only" (phone): two round icons, one active
    _scopeSw(k, only) {
      const dev = only ? only === 'device' : this._local[k] !== undefined;
      const ico = {
        all: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
        device: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/></svg>',
      };
      const b = (v, label, on) => `<button class="btn round${on ? ' on' : ''}" data-act="scope" data-k="${k}" data-v="${v}" aria-pressed="${on}" title="${esc(label)}" aria-label="${esc(label)}">${ico[v]}</button>`;
      if (only) { // fixed scope: show only the matching icon, highlighted, not clickable
        const lbl = only === 'all' ? t('set.scopeAll') : t('set.scopeDevice');
        return `<span class="btn round on scopeone" role="img" title="${esc(lbl)}" aria-label="${esc(lbl)}">${ico[only]}</span>`;
      }
      return `<span style="display:flex;gap:6px;flex:none">${b('all', t('set.scopeAll'), !dev)}${b('device', t('set.scopeDevice'), dev)}</span>`;
    }
    // Beim Neuladen Filter/Sortierung behalten: Geraet (local) vor zentral (shared); Standard: frisch starten
    _keep() {
      const L = this._local || {}, S = this._shared || {};
      return L.keepState !== undefined ? !!L.keepState : !!S.keepState;
    }
    // Sortierung und Filter vom letzten Aufruf wiederherstellen, wenn "behalten" gilt
    _restore() {
      this._restored = true;
      const st = this._st || {};
      if (!this._keep()) return;
      this._sort = st.sort || 'name';
      if (st.f && typeof st.f === 'object') {
        for (const k of Object.keys(st.f)) {
          if (k === 'q') this._f.q = String(st.f.q || '');
          else if (Array.isArray(st.f[k]) && st.f[k].length) this._f[k] = new Set(st.f[k]);
        }
      }
    }
    _saveState() {
      try { let f;
        if (!this._restored) f = (this._st || {}).f; // noch nicht wiederhergestellt: gespeicherten Stand nicht ueberschreiben
        else if (this._keep() && this._f) {
          f = { q: this._f.q || '' };
          for (const k of Object.keys(this._f)) if (k !== 'q' && this._f[k] && this._f[k].size) f[k] = Array.from(this._f[k]);
        }
        localStorage.setItem(this._key, JSON.stringify({ view: this._view, sort: this._restored ? this._sort : ((this._st || {}).sort || this._sort), scale: this._scale, local: this._local, f })); } catch (e) { /* ohne Speicher weiter */ }
    }

    // ---------- Data ----------
    async _initLang() {
      const hl = this._hass && ((this._hass.locale && this._hass.locale.language) || this._hass.language);
      this._langUsed = this._langSel || '';
      const want = String(this._langSel || this._cfg.language || hl || 'en').replace('_', '-');
      const base = this._cfg.i18n_path || window.CELLARION_I18N_BASE || SCRIPT_DIR + 'cellarion-i18n/';
      const en = (await loadFile(base, 'en')) || {};
      let dict = en, lang = 'en';
      if (want.toLowerCase() !== 'en') {
        const cand = [want, want.split('-')[0]].filter((x, i, a) => a.indexOf(x) === i);
        for (const c of cand) {
          const d = await loadFile(base, c);
          if (d) { dict = Object.assign({}, en, d); lang = c; break; }
        }
      }
      applyLang(lang, dict);
      const ix = await loadFile(base, 'index');
      this._langs = ix && typeof ix === 'object' ? ix : { en: 'English' };
    }
    async _start() {
      await this._initLang();
      if (this._built) return;
      this._build();
      this._startTimer();
      this._load().then(() => this._openSync());
    }
    _startTimer() {
      clearInterval(this._timer);
      const s = this._cfg.refresh_seconds === undefined ? 300 : Number(this._cfg.refresh_seconds);
      if (s > 0) this._timer = setInterval(() => this._load(), s * 1000);
    }
    _svc(name) {
      const [domain, service] = String(name).split('.');
      return { domain, service };
    }
    // Data source: the services of the my_cellarion integration (response directly as an object).
    // Only the development setup has an additional connection through its own services ("dev-only" block below).
    _integ() { return BACKEND === 'integration'; }
    // kind: read | sync | refresh | settings | fielddel | winzer | bottle. sh = data for the development setup's service, int = data for the integration's service.
    async _call(kind, sh, int) {
      const c = this._cfg || {};
      let res;
      if (this._integ()) {
        const name = { read: 'read', sync: 'sync', refresh: 'refresh', settings: 'settings', fielddel: 'delete_field', winzer: 'producer_sort', bottle: 'bottle' }[kind];
        res = await this._hass.callWS({ type: 'call_service', domain: 'my_cellarion', service: name, service_data: int || {}, return_response: true });
        const out = (res && res.response) || {};
        if (out.error) throw new Error(out.error);
        return out;
      }
      throw new Error('My Cellarion integration not found');
    }
    async _load() {
      if (!this._hass) return;
      try {
        const data = await this._call('read');
        this._raw = data;
        this._sortMap = data.sortnamen || {};
        const es = data.einstellungen || {};
        this._shared = es;
        this._applyEff();
        if (!this._restored) this._restore();
        if ((this._langSel || '') !== this._langUsed) await this._initLang();
        this._ingest(data);
        this._error = null;
      } catch (e) {
        this._error = (e && e.message) || String(e);
      }
      this._busy = false;
      this._renderAll();
    }
    async _refreshNow(svcName) {
      if (this._busy || !this._hass) return;
      this._busy = true;
      this._lastRefresh = Date.now();
      this._renderHead();
      try {
        await this._call(svcName === 'sync' ? 'sync' : 'refresh');
      } catch (e) {
        this._error = (e && e.message) || String(e);
      }
      await this._load();
    }
    // Storage place display per rack (setting, stored centrally): counting direction of the shelves and position within the shelf
    _rs(name) {
      const r = (this._shared && this._shared.rackSettings && this._shared.rackSettings[name]) || {};
      return { order: r.order === 'bottom' ? 'bottom' : 'top', side: r.side === 'thirds' || r.side === 'slot' ? r.side : 'none' };
    }
    _placeText(b) {
      const w = b.where;
      if (!w || w.fach == null || !w.fachen) return '';
      const rs = this._rs(w.rack);
      const parts = [w.rack, t('loc.shelf', { n: rs.order === 'bottom' ? w.fach : w.fachen - w.fach + 1 })];
      if (rs.side === 'thirds' && w.platz) parts.push(t(['loc.left', 'loc.mid', 'loc.right'][Math.min(2, Math.floor((w.platz - 1) / ((w.cols || 6) / 3)))]));
      else if (rs.side === 'slot' && w.platz) parts.push(t('loc.slot', { n: w.platz }));
      return parts.join(' · ');
    }
    _setRack(name, key, val) {
      this._shared = this._shared || {};
      const all = Object.assign({}, this._shared.rackSettings || {});
      all[name] = Object.assign({}, this._rs(name), { [key]: val });
      this._shared.rackSettings = all;
      if (this._raw) this._ingest(this._raw);
      this._renderAll(); this._renderSet(); this._saveSettings();
    }
    _ingest(data) {
      const year = new Date().getFullYear();
      const have = new Set((data.bottles || []).map((b) => b.id));
      this._gone.forEach((id) => { if (!have.has(id)) this._gone.delete(id); });
      const bottles = (data.bottles || []).filter((b) => !this._gone.has(b.id)).map((b) => {
        const o = Object.assign({}, b);
        o._status = statusOf(o, year);
        o._price = priceKey(o);
        o._loc = this._placeText(o) || o.location || NO_LOC;
        o._rack = o.where && o.where.rack ? o.where.rack : NO_LOC;
        o._type = o.type || '';
        o._cls = String(o.classification || '').split(',').map((x) => x.trim()).filter(Boolean);
        // Predicates (Kabinett, Spätlese ...) before the vineyard rank
        { const pr = (x) => (/kabinett|sp[aä]tlese|auslese|eiswein|qualit[aä]tswein|landwein/i.test(x) ? 0 : 1); o._cls = o._cls.map((x, i) => [x, i]).sort((a, b) => pr(a[0]) - pr(b[0]) || a[1] - b[1]).map((x) => x[0]); }
        o._hay = norm([o.name, o.producer, o.vintage, o.region, o.country, o.appellation, o.classification,
          (o.grapes || []).join(' '), o._loc, TYPE_LABEL[o.type]].join(' '));
        return o;
      });
      const count = (get) => {
        const m = new Map();
        bottles.forEach((b) => { const v = get(b); if (v) m.set(v, (m.get(v) || 0) + 1); });
        return m;
      };
      const grapes = new Map();
      bottles.forEach((b) => (b.grapes || []).forEach((g) => grapes.set(g, (grapes.get(g) || 0) + 1)));
      this._data = {
        generated: data.generated,
        cellar: data.cellar || '',
        cellarId: data.cellarId || '',
        url: String(data.url || 'https://cellarion.app').replace(/\/+$/, ''),
        fields: Array.isArray(data.fields) ? data.fields : [],
        bottles,
        racks: data.racks || [],
        facet: {
          type: count((b) => b._type),
          status: count((b) => b._status),
          rack: count((b) => b._rack),
          vintage: count((b) => String(b.vintage || 'NV')),
          producer: count((b) => b.producer),
          region: count((b) => b.region),
          grape: grapes,
        },
      };
      this._setHeader();
    }
    // Append the cellar name to the HA page header (toolbar), e.g. "My Cellarion - HK4" (option header_cellar: false turns it off)
    _setHeader() {
      try {
        if (this._cfg.header_cellar === false || !this._data || !this._data.cellar) return;
        let n = this;
        while (n && n.localName !== 'hui-root') n = n.parentNode || n.host;
        const el = n && n.shadowRoot && n.shadowRoot.querySelector('.main-title');
        if (!el) return;
        const cur = el.textContent.trim();
        const suffix = ' – ' + this._data.cellar;
        if (!cur || cur.endsWith(suffix)) return;
        el.textContent = cur.split(' – ')[0] + suffix;
      } catch (e) { /* Kopfzeile ist optional */ }
    }

    // ---------- Filters, groups, sorting ----------
    // skip: leave out a filter group (for the counts in the pick lists: only the other filters apply)
    _fs(id) { return this._f[id] || (this._f[id] = new Set()); }
    // All possible filters: fixed ones (type ... place) plus one per personal data field (automatically from the cache)
    _allDefs() {
      const byProd = (a, b) => de.compare(this._pkey(a[0]), this._pkey(b[0]));
      const std = [
        { id: 'types', label: t('filter.types'), defs: TYPES, dot: '--w-', get: (b) => b._type },
        { id: 'grape', label: t('filter.grape'), get: (b) => b.grapes || [] },
        { id: 'region', label: t('filter.region'), get: (b) => b.region },
        { id: 'producer', label: t('filter.producer'), get: (b) => b.producer, sort: byProd },
        { id: 'status', label: t('filter.status'), defs: STATUS, dot: '--s-', get: (b) => (b._status === 'window' ? 'peak' : b._status) },
        { id: 'cls', label: t('filter.cls'), get: (b) => b._cls || [] },
        { id: 'vintage', label: t('filter.vintage'), get: (b) => String(b.vintage || 'NV'), sort: (a, b) => this._vint(b[0]) - this._vint(a[0]) },
        { id: 'price', label: t('filter.price'), defs: PRICE, get: (b) => b._price },
        { id: 'racks', label: t('filter.racks'), get: (b) => b._rack, sort: (a, b) => (a[0] === NO_LOC) - (b[0] === NO_LOC) || de.compare(a[0], b[0]) },
        { id: 'shop', label: t('filter.shop'), get: (b) => b.shop || null },
      ];
      const pers = ((this._data && this._data.fields) || []).map((l) => ({ id: 'p:' + l, label: l, personal: true, get: (b) => (b.p && b.p[l]) || null }));
      const all = std.concat(pers);
      const pos = (d) => { const k = this._fo.indexOf(d.id); return k < 0 ? 1000 + all.indexOf(d) : k; };
      return all.slice().sort((a, b) => pos(a) - pos(b));
    }
    _orderedDefs() { return this._allDefs().filter((d) => !this._fh.has(d.id)); }
    _filtered(skip) {
      const f = this._f;
      const toks = norm(f.q).split(/\s+/).filter(Boolean);
      const act = this._allDefs().filter((d) => d.id !== skip && f[d.id] && f[d.id].size);
      return this._data.bottles.filter((b) => {
        for (const d of act) if (![].concat(d.get(b)).some((v) => f[d.id].has(v))) return false;
        for (const t of toks) if (!b._hay.includes(t)) return false;
        return true;
      });
    }
    _entries(bottles) {
      // Entry = wine + vintage
      const m = new Map();
      bottles.forEach((b) => {
        const k = (b.wine || b.name) + '|' + (b.vintage || 'NV');
        let e = m.get(k);
        if (!e) { e = { wine: b.wine || b.name, vintage: String(b.vintage || 'NV'), b, bottles: [] }; m.set(k, e); }
        e.bottles.push(b);
      });
      m.forEach((e) => {
        e.status = e.bottles.reduce((a, x) => (STATUS_RANK[x._status] < STATUS_RANK[a] ? x._status : a), e.bottles[0]._status);
        const ends = e.bottles.map((x) => x.drinkTo).filter(Boolean);
        e.drinkTo = ends.length ? Math.min.apply(null, ends) : 9999;
      });
      return Array.from(m.values());
    }
    _old(v) { const n = this._vint(v); return n > 0 ? n : 99999; } // for "oldest first": NV goes last
    // Price of an entry (wine + vintage): the first bottle with a price; without price -1 (goes last in both directions)
    _ep(e) { const b = (e.bottles || []).find((x) => typeof x.price === 'number' && x.price > 0); return b ? b.price : -1; }
    _vint(v) { return v === 'NV' ? -1 : Number(v) || -1; }
    _cmpEntries(a, b) {
      switch (this._sort) {
        case 'producer': return de.compare(this._pkey(a.b.producer), this._pkey(b.b.producer)) || de.compare(a.b.name || '', b.b.name || '') || this._vint(b.vintage) - this._vint(a.vintage);
        case 'drinkTo': return a.drinkTo - b.drinkTo || de.compare(a.b.name || '', b.b.name || '');
        case 'vintage': return this._vint(b.vintage) - this._vint(a.vintage) || de.compare(a.b.name || '', b.b.name || '');
        case 'priceAsc': case 'priceDesc': {
          const x = this._ep(a), y = this._ep(b);
          if ((x < 0) !== (y < 0)) return x < 0 ? 1 : -1;
          return (this._sort === 'priceAsc' ? x - y : y - x) || de.compare(a.b.name || '', b.b.name || '');
        }
        case 'region': return de.compare(a.b.region || '~', b.b.region || '~') || de.compare(a.b.name || '', b.b.name || '');
        case 'vintageAsc': return this._old(a.vintage) - this._old(b.vintage) || de.compare(a.b.name || '', b.b.name || '');
        default: return de.compare(a.b.name || '', b.b.name || '') || de.compare(a.b.producer || '', b.b.producer || '') || this._vint(b.vintage) - this._vint(a.vintage);
      }
    }
    _groups(entries) {
      const m = new Map();
      entries.forEach((e) => {
        let g = m.get(e.wine);
        if (!g) { g = { id: e.wine, b: e.b, entries: [], count: 0 }; m.set(e.wine, g); }
        g.entries.push(e);
        g.count += e.bottles.length;
      });
      const groups = Array.from(m.values());
      groups.forEach((g) => {
        g.entries.sort((x, y) => this._vint(y.vintage) - this._vint(x.vintage));
        g.drinkTo = Math.min.apply(null, g.entries.map((x) => x.drinkTo));
        g.maxVint = Math.max.apply(null, g.entries.map((x) => this._vint(x.vintage)));
        g.minVint = Math.min.apply(null, g.entries.map((x) => this._old(x.vintage)));
      });
      const rt = new Map();
      groups.forEach((g) => rt.set(g.b.region || '', (rt.get(g.b.region || '') || 0) + g.count));
      // Group price: cheapest (ascending) or most expensive (descending) entry; wines without price go last in both directions
      const gp = (g, how) => {
        const ps = g.entries.map((x) => this._ep(x)).filter((x) => x > 0);
        if (!ps.length) return how === 'min' ? 1e12 : -1;
        return how === 'min' ? Math.min.apply(null, ps) : Math.max.apply(null, ps);
      };
      const cmp = {
        producer: (a, b) => de.compare(this._pkey(a.b.producer), this._pkey(b.b.producer)) || de.compare(a.b.name || '', b.b.name || ''),
        drinkTo: (a, b) => a.drinkTo - b.drinkTo || de.compare(a.b.name || '', b.b.name || ''),
        vintage: (a, b) => b.maxVint - a.maxVint || de.compare(a.b.name || '', b.b.name || ''),
        region: (a, b) => (rt.get(b.b.region || '') || 0) - (rt.get(a.b.region || '') || 0) || (a.b.region ? 0 : 1) - (b.b.region ? 0 : 1) || de.compare(a.b.region || '', b.b.region || '') || de.compare(a.b.name || '', b.b.name || ''),
        vintageAsc: (a, b) => a.minVint - b.minVint || de.compare(a.b.name || '', b.b.name || ''),
        priceAsc: (a, b) => gp(a, 'min') - gp(b, 'min') || de.compare(a.b.name || '', b.b.name || ''),
        priceDesc: (a, b) => gp(b, 'max') - gp(a, 'max') || de.compare(a.b.name || '', b.b.name || ''),
      }[this._sort] || ((a, b) => de.compare(a.b.name || '', b.b.name || '') || de.compare(a.b.producer || '', b.b.producer || ''));
      return groups.sort(cmp);
    }

    // ---------- Layout ----------
    _build() {
      if (this._built) return;
      this._built = true;
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      const c = this._cfg;
      const px = (v, d) => (Number(v) > 0 ? Number(v) : d) + 'px';
      const vars = `--cb-row-h:${px(c.row_h, 44)};--cb-row-font:${px(c.row_font, 14)};--cb-title-font:${px(c.title_font, 18)};` +
        `--cb-chip-font:${px(c.chip_font, 14)};--cb-chip-h:${px(c.chip_h, 40)};`;
      this.shadowRoot.innerHTML = `
        <style>${CSS}</style>
        <ha-card class="${c.flush ? 'flush' : ''}" style="${c.height ? 'height:' + esc(c.height) + ';' : ''}">
          <div class="wrap" style="${vars}${this._scale !== 1 ? 'zoom:' + this._scale + ';' : ''}">
            <div class="head"></div>
            <div class="az" hidden></div>
            <div class="ptr"></div>
            <div class="list"></div>
            <div class="dlg" hidden></div>
          </div>
        </ha-card>`;
      this._head = this.shadowRoot.querySelector('.head');
      this._listEl = this.shadowRoot.querySelector('.list');
      this._azEl = this.shadowRoot.querySelector('.az');
      this._ptr = this.shadowRoot.querySelector('.ptr');
      this._dlg = this.shadowRoot.querySelector('.dlg');
      // Collapse open filters when the user scrolls the list (real touch/wheel input only, not layout scrolling)
      const fold = () => {
        if (this._hdr2()) return;
        if (this._more && this._listEl.scrollTop > 2) { this._more = false; this._autoFolded = true; this._renderHead(); }
      };
      this._listEl.addEventListener('scroll', () => {
        // Scroll direction: upward travel is summed up (small steps of a touchpad count too)
        const st = this._listEl.scrollTop, settling = Date.now() - (this._hdrAt || 0) < 250;
        if (settling || st > (this._lastTop || 0)) this._upAcc = 0; else this._upAcc = (this._upAcc || 0) + ((this._lastTop || 0) - st);
        this._lastTop = st;
        if (!this._azRaf) this._azRaf = requestAnimationFrame(() => { this._azRaf = 0; this._azUpdate(); });
        // collapsed by hand: once the list was left, the rule "at the top -> expand" applies again
        if (this._manual && !this._more && this._listEl.scrollTop > 40) { this._manual = false; this._autoFolded = true; }
        if (this._autoFolded && this._listEl.scrollTop <= 2) { this._autoFolded = false; this._more = true; this._renderHead(); }
        // Scrolling up anywhere in the list brings the filters back (about 24 px of travel, so small jitter does not trigger it)
        else if (this._autoFolded && !this._more && this._upAcc >= 24 && !this._hdr2()) { this._autoFolded = false; this._more = true; this._upAcc = 0; this._renderHead(); }
      }, { passive: true });
      // Only moving down the list folds the filters (finger up / wheel down); moving up unfolds them again (see the scroll listener)
      this._listEl.addEventListener('touchstart', (e) => { this._ty = e.touches[0].clientY; }, { passive: true });
      this._listEl.addEventListener('touchmove', (e) => {
        const y = e.touches[0].clientY;
        if (this._ty !== undefined && y < this._ty - 4) fold();
        this._ty = y;
      }, { passive: true });
      this._listEl.addEventListener('wheel', (e) => { if (e.deltaY > 0) fold(); }, { passive: true });
      // Phone: pulling down at the top of the list = reload (with confirmation)
      const mob = () => window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
      let y0 = null, pull = 0;
      const ptr = this._ptr;
      const setPtr = (h, txt) => { ptr.style.height = h + 'px'; ptr.textContent = txt || ''; };
      this._listEl.addEventListener('touchstart', (e) => { y0 = mob() && this._listEl.scrollTop <= 0 && !this._busy ? e.touches[0].clientY : null; pull = 0; }, { passive: true });
      this._listEl.addEventListener('touchmove', (e) => {
        if (y0 === null) return;
        const dy = e.touches[0].clientY - y0;
        if (dy > 0 && this._listEl.scrollTop <= 0) { pull = Math.min(dy * 0.3, 72); setPtr(Math.round(pull), pull >= 60 ? t('rl.release') : t('rl.pull')); }
        else if (pull) { pull = 0; setPtr(0); }
      }, { passive: true });
      const endPull = () => { const go = pull >= 60; y0 = null; pull = 0; setPtr(0); if (go) { this._cfm = true; this._renderDlg(); } };
      this._listEl.addEventListener('touchend', endPull, { passive: true });
      this._listEl.addEventListener('touchcancel', () => { y0 = null; pull = 0; setPtr(0); }, { passive: true });
      this.shadowRoot.addEventListener('click', (e) => this._onClick(e));
      this.shadowRoot.addEventListener('change', (e) => this._onChange(e));
      this.shadowRoot.addEventListener('input', (e) => this._onInput(e));
      this.shadowRoot.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this._dd) { this._dd = null; this._renderDlg(); return; }
        if (e.key === 'Escape' && this._wz) { if (this._wz.busy) return; this._wz = null; this._renderDlg(); return; }
        if (e.key === 'Escape' && this._set) { this._set = null; this._renderDlg(); return; }
        if (e.key === 'Escape' && this._det && !this._det.busy) { this._det = null; this._renderDlg(); return; }
        if (e.key === 'Enter' && e.target && e.target.matches && e.target.matches('input[type=search]')) e.target.blur();
      });
      this._renderAll();
      this._fit();
      setTimeout(() => this._fit(), 300);
      setTimeout(() => this._fit(), 1200);
    }

    _renderAll() {
      if (!this._built) return;
      if (this._keep()) this._saveState();
      this.toggleAttribute('data-hdr2', this._hdr2());
      this._renderHead();
      this._renderList();
    }
    // Flag hdr2 (wide only): filters on the left in two rows, tools and search stacked on the right; filters never fold
    _hdr2() { return this._flag('hdr2') && !(window.matchMedia && window.matchMedia('(max-width: 600px)').matches); }

    _nAct() {
      const f = this._f;
      return Object.keys(f).reduce((n, k) => n + (k === 'q' ? 0 : f[k].size), 0);
    }
    // Wine glass per type (colour = wine colour): red/white/rose goblet, sparkling flute, sweet/fortified small glass
    _glass(type, title) {
      const col = `var(--w-${type}, var(--cb-ring))`;
      const G = {
        red: ['M4.2 1.2h7.6c.3 3.6-.5 7-3.8 7.4-3.3-.4-4.1-3.8-3.8-7.4z', 'M4.3 4.4h7.4c-.1 2.4-1 4-3.7 4.2-2.7-.2-3.6-1.8-3.7-4.2z', 8.6, ''],
        white: ['M4.8 1.2h6.4c.2 3.4-.4 6.4-3.2 6.8-2.8-.4-3.4-3.4-3.2-6.8z', 'M4.9 3.8h6.2c-.1 2.4-.9 3.9-3.1 4.2-2.2-.3-3-1.8-3.1-4.2z', 8, ''],
        sparkling: ['M5.6.8h4.8l-.4 8c-.1 1.2-.8 1.9-2 1.9s-1.9-.7-2-1.9z', 'M5.7 2.2h4.6l-.3 6.6c-.1 1-.7 1.6-2 1.6s-1.9-.6-2-1.6z', 10.7,
          '<circle cx="7" cy="8.2" r=".6" fill="#fff" opacity=".9"/><circle cx="9" cy="6.4" r=".5" fill="#fff" opacity=".9"/><circle cx="7.6" cy="4.6" r=".5" fill="#fff" opacity=".9"/><circle cx="8.8" cy="3.2" r=".4" fill="#fff" opacity=".9"/>'],
        dessert: ['M5 4h6c.1 2.8-.7 4.8-3 5.1-2.3-.3-3.1-2.3-3-5.1z', 'M5.1 5.4h5.8c0 2-.8 3.5-2.9 3.7-2.1-.2-2.9-1.7-2.9-3.7z', 9.1, ''],
      };
      G['rosé'] = G.white; G.fortified = G.dessert;
      const g = G[type] || G.white;
      return `<svg class="tsp" viewBox="0 0 16 16" width="16" height="16"${title ? ` role="img" aria-label="${esc(title)}"` : ' aria-hidden="true"'}>` +
        `<path d="${g[0]}" fill="${col}" stroke="${col}" stroke-width="1" stroke-linejoin="round"/>${g[3]}` +
        `<path d="M8 ${g[2]}V14.2M5.2 14.8h5.6" stroke="${col}" stroke-width="1.2" stroke-linecap="round" fill="none"/></svg>`;
    }
    _dotIc(dot, title) {
      return dot.startsWith('--w-') ? this._glass(dot.slice(4), title) : `<span class="tdot" style="background:var(${dot})"></span>`;
    }
    _chip(group, value, label, on, n, dot) {
      const ic = dot ? this._dotIc(dot) : '';
      return `<button class="chip${on ? ' on' : ''}" data-act="chip" data-g="${group}" data-v="${esc(value)}" aria-pressed="${on}" title="${esc(label)}" aria-label="${esc(label)}">` +
        ic + `<span class="lbl">${esc(label)}</span>` +
        (n != null ? `<span class="n">${n}</span>` : '') + `</button>`;
    }

    // Pick list: the most frequent first (from TOP_MIN bottles, at most TOP_MAX, at least 3), then a line, then the rest A-Z.
    // Pulldown for fixed values (type, maturity): order as in defs, value = key, text = label
    _optsK(defs, map, selected) {
      return defs.filter(([k]) => (map.get(k) && map.get(k).f) && !selected.has(k)).map(([k, l]) => {
        const o = map.get(k);
        return { v: k, t: `${l} (${o.f === 1 ? 1 : o.w + ' | ' + o.j + ' | ' + o.f})` };
      });
    }
    _opts(map, selected, sortFn) {
      const TOP_MIN = 8, TOP_MAX = 10;
      const all = Array.from(map.entries()).filter((x) => !selected || !selected.has(x[0]));
      const byCount = all.slice().sort((a, b) => b[1].f - a[1].f || de.compare(a[0], b[0]));
      let k = byCount.filter((x) => x[1].f >= TOP_MIN).length;
      k = Math.min(TOP_MAX, Math.max(k, Math.min(3, all.length)));
      if (k >= all.length) k = 0;
      const top = byCount.slice(0, k), top0 = new Set(top.map((x) => x[0]));
      const rest = all.filter((x) => !top0.has(x[0])).sort(sortFn);
      const opt = ([v, o]) => ({ v, t: `${v} (${o.f === 1 ? 1 : o.w + ' | ' + o.j + ' | ' + o.f})` });
      return top.map(opt).concat(top.length && rest.length ? [{ sep: true }] : [], rest.map(opt));
    }
    // Own pick menu instead of the native Android list (it was sometimes black, sometimes transparent, shifted when zooming and pulled in the navigation bar)
    _renderDd() {
      const el = this._dlg, d = this._ddItems[this._dd];
      if (!d) { this._dd = null; el.hidden = true; el.innerHTML = ''; return; }
      el.innerHTML = `<div class="dsheet ddsheet" role="listbox" aria-label="${esc(d.label)}"><div class="dh"><span class="wmain"><span class="wname">${esc(d.label)}</span>${d.hint ? `<span class="wsub">${esc(d.hint)}</span>` : ''}</span>` +
        `<button class="dx" data-act="ddclose" aria-label="${esc(t('head.close'))}">✕</button></div>` +
        `<div class="ddlist">` + d.items.map((o) => o.sep ? '<div class="ddsep"></div>' : `<button type="button" class="ddi${o.v === d.curV ? ' cur' : ''}" role="option" data-act="ddpick" data-v="${esc(o.v)}">${esc(o.t)}</button>`).join('') + `</div></div>`;
      el.hidden = false;
    }

    _renderHead() {
      this._hdrAt = Date.now(); // layout changes of the header must not count as scrolling
      if (!this._head) return;
      const d = this._data, f = this._f, c = this._cfg;
      this._ddItems = {};
      const nAct = this._nAct();
      const active = f.q || nAct;
      const gear = `<button class="btn round gear" data-act="setopen" title="${esc(t('head.settings'))}" aria-label="${esc(t('head.settings'))}">` +
        `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7m7.4-2.5c.04-.33.1-.66.1-1s-.06-.67-.1-1l2.1-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.6-.22l-2.5 1a7.3 7.3 0 0 0-1.7-1l-.38-2.65A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42L9.12 5.07a7.3 7.3 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64L4.6 11c-.04.33-.1.66-.1 1s.06.67.1 1l-2.1 1.65a.5.5 0 0 0-.12.64l2 3.46c.13.22.39.3.6.22l2.5-1c.52.4 1.08.73 1.7 1l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.62-.27 1.18-.6 1.7-1l2.5 1c.23.09.47 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64z"/></svg></button>`;
      const stat = `<button class="btn round st" data-act="statopen" title="${esc(t('stat.title'))}" aria-label="${esc(t('stat.title'))}">` +
        `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>`;
      const rlTxt = String(t('head.reload')).replace(/^\s*↻\s*/, '');
      const reload = `<button class="btn round rl" data-act="reloadask" title="${esc(this._busy ? t('head.loading') : rlTxt)}" aria-label="${esc(rlTxt)}" ${this._busy ? 'disabled' : ''}>${this._busy ? '…' : '↻'}</button>`;
      const ttl = c.title || (c.header_cellar === false && this._data && this._data.cellar) || ''; // otherwise the cellar name is shown in the page header
      let html = `<div class="top">${ttl ? `<span class="title">${esc(ttl)}</span>` : ''}`;
      if (!d) html += reload + gear + `</div>`;
      if (d) {
        // Count per group over the bottles that meet all other filters (and the search)
        const cnt = (group, get) => {
          const m = new Map();
          this._filtered(group).forEach((b) => [].concat(get(b)).forEach((v) => { if (v) m.set(v, (m.get(v) || 0) + 1); }));
          return m;
        };
        // Count for the pulldowns: wines | vintages | bottles per value
        const cnt3 = (group, get) => {
          const m = new Map();
          this._filtered(group).forEach((b) => [].concat(get(b)).forEach((v) => {
            if (!v) return;
            let o = m.get(v);
            if (!o) { o = { ws: new Set(), js: new Set(), f: 0 }; m.set(v, o); }
            o.ws.add(b.wine); o.js.add(b.wine + '|' + b.vintage); o.f++;
          }));
          m.forEach((o, k) => m.set(k, { w: o.ws.size, j: o.js.size, f: o.f }));
          return m;
        };
        html += `<div class="search${f.q ? ' has' : ''}"><input type="search" inputmode="search" enterkeyhint="search" autocomplete="off" ` +
          `placeholder="${(window.matchMedia && window.matchMedia('(max-width: 600px)').matches) || this._hdr2() ? esc(t('head.searchShort')) : esc(t('head.search'))}" value="${esc(f.q)}"><button class="x" data-act="clearq" aria-label="${esc(t('head.clearSearch'))}">✕</button></div>` +
          (() => {
            const so = ['name', 'producer', 'drinkTo', 'vintage', 'vintageAsc', 'region', 'priceAsc', 'priceDesc'].map((v) => ({ v, t: t('sort.' + v) }));
            const cur = (so.find((o) => o.v === this._sort) || so[0]);
            this._ddItems.sort = { label: t('sort.title'), items: so, cur: cur.t, curV: cur.v };
            return `<button type="button" class="sel" data-act="dd" data-id="sort" aria-haspopup="listbox" aria-label="${esc(t('sort.title'))}">${esc(cur.t)}</button>`;
          })() +
          stat + reload + gear + `</div>`;
        const vis = this._orderedDefs(), hid = this._allDefs().filter((d) => this._fh.has(d.id));
        const defs = this._showHid ? vis.concat(hid) : vis.concat(hid.filter((d) => this._fs(d.id).size));
        const t3 = {};
        defs.forEach((d) => { t3[d.id] = cnt3(d.id, d.get); });
        const by = (x, y) => de.compare(x[0], y[0]);
        html += `<div class="fwrap${this._more || this._hdr2() ? ' fopen' : ''}"><div class="more open">` +
          defs.map((d) => {
            const m = t3[d.id], set = this._fs(d.id);
            if (!m.size && !set.size) return '';
            const items = d.defs ? this._optsK(d.defs, m, set) : this._opts(m, set, d.sort || by);
            this._ddItems[d.id] = { label: d.label, items, cur: '', hint: t('dd.countHint') };
            return `<button type="button" class="sel fs${set.size ? ' hasv' : ''}" data-act="dd" data-id="${esc(d.id)}" aria-haspopup="listbox" aria-label="${esc(d.label)}">${esc(d.label)}</button>`;
          }).join('') + `<span class="fend">` + (hid.length ? `<button type="button" class="sel fs more-pill${this._showHid ? ' open' : ''}" data-act="showhid" aria-expanded="${this._showHid ? 'true' : 'false'}" aria-label="${esc(this._showHid ? t('head.moreHide') : t('head.moreShow'))}">…</button>` : '') +
          `</span></div></div>`;
        const ic = (dot) => this._dotIc(dot);
        const pills = defs.map((d) => Array.from(this._fs(d.id)).map((v) => {
          const label = d.defs ? (d.defs.find((x) => x[0] === v) || [0, v])[1] : v;
          return `<button class="fpill" data-act="fdel" data-g="${esc(d.id)}" data-v="${esc(v)}" aria-label="${esc(t('head.removePill', { label }))}">${d.dot ? ic(d.dot + v) : ''}` +
            `${d.personal ? esc(d.label) + ': ' : ''}${esc(label)}<span class="x">✕</span></button>`;
        }).join('')).join('');
        html += `<div class="fpills">${pills}<button class="btn round sm on" data-act="reset" data-reset title="${esc(t('head.resetFilters'))}" aria-label="${esc(t('head.resetFilters'))}"${active ? '' : ' hidden'}>↺</button></div>`;
        html += `<div class="sumline"><span class="grow" data-sum></span></div>`;
      }
      if (this._ptr && !this._pulling) { this._ptr.style.height = this._busy ? '24px' : '0px'; this._ptr.textContent = this._busy ? t('head.loading') : ''; }
      // Keep focus and cursor in the search field when the header is rebuilt
      const input = this._head.querySelector('input[type=search]');
      const hadFocus = input && this.shadowRoot.activeElement === input;
      const pos = hadFocus ? input.selectionStart : 0;
      this._head.innerHTML = html;
      this._azWidth(true);
      if (hadFocus) {
        const ni = this._head.querySelector('input[type=search]');
        if (ni) { ni.focus(); try { ni.setSelectionRange(pos, pos); } catch (e) { /* egal */ } }
      }
    }

    // The parts of a place (rack, shelf, side) are separated by a tiny pipe; the dot separates the infos
    _lt(l) {
      return esc(l).split(' · ').join('<span class="lp">|</span>');
    }
    _locsHtml(bottles, brief) {
      const m = new Map();
      bottles.forEach((b) => m.set(b._loc, (m.get(b._loc) || 0) + 1));
      const inRow = brief === true;
      if (brief && m.size === 1) brief = 'one'; else brief = '';
      if (inRow && m.size > 1) {
        // Several places in the wine row: summarise per rack (rack ×count), details are on the detail page
        const r = new Map();
        m.forEach((n, l) => { const k = l === NO_LOC ? NO_LOC : l.split(' · ')[0]; r.set(k, (r.get(k) || 0) + n); });
        return Array.from(r.entries()).sort((a, b) => (a[0] === NO_LOC) - (b[0] === NO_LOC) || de.compare(a[0], b[0]))
          .map(([l, n]) => `<span class="loc${l === NO_LOC ? ' none' : ''}">${this._lt(l === NO_LOC ? t('loc.noneShort') : l)}<b>×${n}</b></span>`).join('');
      }
      return Array.from(m.entries()).sort((a, b) => (a[0] === NO_LOC) - (b[0] === NO_LOC) || de.compare(a[0], b[0]))
        .map(([l, n]) => `<span class="loc${l === NO_LOC ? ' none' : ''}">${this._lt(l === NO_LOC ? t('loc.noneShort') : l)}${!brief && (bottles.length > 1 || n > 1) ? `<b>×${n}</b>` : ''}</span>`).join('');
    }
    _winText(e) {
      const b = e.b;
      const ws = e.bottles.map((x) => [x.drinkFrom, x.drinkTo]).filter((w) => w[0] || w[1]);
      const p = e.bottles.find((x) => x.peakFrom && x.peakUntil);
      const win = ws.length ? `${ws[0][0] || '?'}–${ws[0][1] || '?'}` : '';
      return [win, p ? t('win.peak', { from: p.peakFrom, to: p.peakUntil }) : ''].filter(Boolean).join(' · ');
    }
    _sdot(s, title) { return `<span class="sdot" style="background:var(--s-${s})" title="${esc(title || STATUS_LABEL[s])}"></span>`; }

    _renderList() {
      if (!this._listEl) return;
      const el = this._listEl;
      const top = el.scrollTop;
      if (this._error && !this._data) {
        el.innerHTML = `<div class="msg">${esc(t('list.error'))}<br>${esc(this._error)}<br>` +
          `<button class="btn" data-act="reload">${esc(t('list.reload'))}</button></div>`;
        return;
      }
      if (!this._data) { el.innerHTML = `<div class="msg">${esc(t('list.loading'))}</div>`; return; }
      this._az = new Set();
      const bottles = this._filtered();
      const entries = this._entries(bottles);
      let html = '';
      let nWine;
      if (this._view === 'flat') {
        nWine = new Set(entries.map((e) => e.wine)).size;
        html = entries.sort((a, b) => this._cmpEntries(a, b)).map((e) => this._azAnchor(e.b) + this._flatRow(e)).join('');
      } else {
        const groups = this._groups(entries);
        nWine = groups.length;
        const hk = { vintage: (g) => (g.maxVint > 0 ? String(g.maxVint) : 'NV'), vintageAsc: (g) => (g.minVint < 99999 ? String(g.minVint) : 'NV'),
          region: (g) => g.b.region || t('list.noRegion') }[this._sort];
        if (hk) {
          const tot = new Map();
          groups.forEach((g) => { const k = hk(g); const o = tot.get(k) || { w: 0, n: 0 }; o.w++; o.n += g.count; tot.set(k, o); });
          let last = null;
          html = groups.map((g) => {
            const k = hk(g);
            let head = '';
            if (k !== last) {
              last = k;
              const tt = tot.get(k);
              head = `<div class="shead"><span>${esc(k)}</span><span class="shn">${esc(t('count.groupHead', { wines: t('count.wines', { n: tt.w }), bottles: t('count.bottlesShort', { n: tt.n }) }))}</span></div>`;
            }
            return head + this._groupRow(g);
          }).join('');
        } else html = groups.map((g) => this._azAnchor(g.b) + this._groupRow(g)).join('');
      }
      if (!bottles.length) html = `<div class="msg">${esc(t('list.empty'))}</div>`;
      el.innerHTML = html;
      el.scrollTop = top;
      this._renderAz();
      const f = this._f;
      const rst = this._head && this._head.querySelector('[data-reset]');
      if (rst) {
        rst.hidden = !(f.q || this._nAct());
      }
      const sum = this._head && this._head.querySelector('[data-sum]');
      if (sum) {
        const all = this._data.bottles.length;
        sum.textContent = `${this._data.cellar ? this._data.cellar + ' · ' : ''}${t('count.wines', { n: nWine })} · ${t('count.vintages', { n: entries.length })} · ${t('count.bottles', { n: bottles.length })}` + (bottles.length !== all ? ' ' + t('count.of', { all }) : '') +
          (this._error ? ' · ' + t('count.loadError') : '');
      }
    }

    // A-Z bar: only for wine A-Z / producer A-Z. Letter = start of the wine name or of the producer's sort word.
    _azKey(b) {
      const k = norm(this._sort === 'producer' ? this._pkey(b.producer) : b.name).replace(/[^a-z0-9]/g, '').charAt(0);
      return k >= 'a' && k <= 'z' ? k.toUpperCase() : '#';
    }
    _azAnchor(b) {
      if (this._sort !== 'name' && this._sort !== 'producer') return '';
      const k = this._azKey(b);
      if (this._az.has(k)) return '';
      this._az.add(k);
      return `<span class="azanc" data-az="${k}"></span>`;
    }
    _azUpdate() {
      const bar = this._azEl, list = this._listEl;
      if (!bar || bar.hidden || !list) return;
      const anchors = list.querySelectorAll('.azanc');
      if (!anchors.length) return;
      const top = list.getBoundingClientRect().top;
      let cur = anchors[0].dataset.az;
      for (const a of anchors) { if (a.getBoundingClientRect().top - top <= 4) cur = a.dataset.az; else break; }
      if (cur === this._azCur) return;
      this._azCur = cur;
      let hit = null;
      bar.querySelectorAll('button').forEach((b) => { const on = b.dataset.k === cur; b.classList.toggle('cur', on); if (on) hit = b; });
      if (hit && bar.scrollWidth > bar.clientWidth + 2) {
        bar.scrollTo({ left: Math.max(0, hit.offsetLeft - (bar.clientWidth - hit.offsetWidth) / 2), behavior: 'smooth' });
      }
    }
    _renderAz() {
      const bar = this._azEl;
      if (!bar) return;
      const on = (this._sort === 'name' || this._sort === 'producer') && this._data && this._az.size > 0;
      bar.hidden = !on;
      if (!on) { bar.innerHTML = ''; return; }
      const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      if (this._az.has('#')) L.unshift('#');
      bar.innerHTML = L.map((k) => `<button data-act="az" data-k="${k}"${this._az.has(k) ? '' : ' disabled'}>${k}</button>`).join('');
      this._azCur = null;
      this._azUpdate();
      this._azWidth();
    }
    // On wide screens the list is at most as wide as the alphabet bar (up to Z), better readable
    _azWidth(pre) {
      const list = this._listEl, bar = this._azEl;
      if (!list || !bar) return;
      const hdr2 = this._hdr2();
      const others = this.shadowRoot.querySelectorAll(hdr2 ? '.head' : '.top, .fwrap, .fpills, .sumline');
      const set = (v) => {
        list.style.maxWidth = v;
        this.shadowRoot.querySelectorAll('.head, .top, .fwrap, .fpills, .sumline').forEach((e) => { e.style.maxWidth = ''; });
        others.forEach((e) => { e.style.maxWidth = v; });
      };
      let cached = '';
      try { cached = localStorage.getItem('cellarion-azw') || ''; } catch (e) { /* egal */ }
      // Before the alphabet bar exists (first render) use the last known width, so nothing jumps
      if (pre && !bar.children.length) { set(cached); return; }
      // Sorting without an alphabet bar (price, vintage ...): keep the last known alphabet width, so the layout stays the same
      if (bar.hidden) { set(cached); return; }
      const bs = Array.from(bar.children);
      if (!bs.length) { set(''); return; }
      const w = bs.reduce((a, b) => a + b.offsetWidth, 0) + (bs.length - 1) * 2 + 16;
      set(w > 0 ? w + 'px' : '');
      try { if (w > 0 && !(window.matchMedia && window.matchMedia('(max-width: 600px)').matches)) localStorage.setItem('cellarion-azw', w + 'px'); } catch (e) { /* egal */ }
    }

    // Highlight search terms in the text (ignoring case and accents, like the search itself)
    _hl(text) {
      text = String(text == null ? '' : text);
      const toks = norm(this._f.q).split(/\s+/).filter(Boolean);
      if (!toks.length) return esc(text);
      let n = '';
      const map = [];
      Array.from(text).forEach((ch, i) => { const x = norm(ch); for (let k = 0; k < x.length; k++) { n += x[k]; map.push(i); } });
      const chars = Array.from(text);
      const on = new Array(chars.length).fill(false);
      toks.forEach((t) => {
        let at = n.indexOf(t);
        while (at >= 0) { for (let k = at; k < at + t.length; k++) on[map[k]] = true; at = n.indexOf(t, at + 1); }
      });
      let out = '', open = false;
      chars.forEach((ch, i) => {
        if (on[i] !== open) { out += open ? '</mark>' : '<mark class="hl">'; open = on[i]; }
        out += esc(ch);
      });
      return out + (open ? '</mark>' : '');
    }
    _typeDot(b) {
      return this._glass(b._type || 'white', TYPE_LABEL[b._type] || '');
    }
    _sub(b) { return b.region || ''; }
    // Price of the bottles (EUR): one value or from-to; empty if none is known
    _priceTxt(bottles) {
      const v = (bottles || []).filter((b) => typeof b.price === 'number' && b.price > 0 && (!b.currency || b.currency === 'EUR')).map((b) => b.price);
      if (!v.length) return '';
      const f = (x) => new Intl.NumberFormat(I18N.lang || 'de', { maximumFractionDigits: Number.isInteger(x) ? 0 : 2, minimumFractionDigits: Number.isInteger(x) ? 0 : 2 }).format(x);
      const lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
      return (lo === hi ? f(lo) : f(lo) + '–' + f(hi)) + '\u00a0€';
    }
    _priceSpans(bottles) {
      const p = this._priceTxt(bottles);
      return p ? { d: `<span class="wreg wprice wpd">${esc(p)}</span>` } : { d: '' };
    }
    // With sorting "producer A-Z" and a maintained sort word: its first letter in bold (H for "Fritz Haag")
    _prodHtml(name) {
      const i = this._sortMap && this._sortMap[name];
      const w = this._words(name);
      if (this._sort !== 'producer' || i === undefined || !(i >= 0 && i < w.length)) return this._hl(name);
      return w.map((x, k) => (k === i ? `<b class="wsl">${esc(x.charAt(0))}</b>${esc(x.slice(1))}` : esc(x))).join(' ');
    }
    // Line 1: wine name and producer, line 2: the info items (setting "Info in the list"). The price is vintage info and sits
    // on the right of the row, so it is only added here where there is no vintage (single is undefined: flat list, detail header).
    // Every item is one unit with its own trailing dot, so a line break falls between the items.
    _title(b, pr, single) {
      pr = pr || '';
      const txt = (d) => {
        if (d.id === 'price') return this._priceOnly(pr);
        if (d.id === 'cls') return b._cls && b._cls.length ? this._hl(b._cls.join(', ')) : '';
        if (d.id === 'region') return b.region ? this._hl(b.region) : '';
        if (d.id === 'grape') return b.grapes && b.grapes.length ? esc(b.grapes.join(', ')) : '';
        const v = b.p && b.p[d.label];
        return v ? esc([].concat(v).map((x) => this._fmtVal(x)).join(', ')) : '';
      };
      const swap = this._sort === 'producer' && b.producer;
      const head = swap ? [['wprod', this._prodHtml(b.producer)], ['wname', this._hl(b.name)]]
        : [['wname', this._hl(b.name)]].concat(b.producer ? [['wprod', this._prodHtml(b.producer)]] : []);
      const infos = this._infoDefs().filter((d) => this._is.has(d.id) && (d.id !== 'price' || single === undefined)).map((d) => ['wreg', txt(d)]).filter((x) => x[1]);
      const all = head.concat(infos);
      const html = all.map((x, i) => `<span class="${x[0]} wit${i < all.length - 1 ? ' d' : ''}${i === head.length - 1 ? ' e' : ''}">${x[1]}</span>`);
      return `<span class="wtitle${swap ? ' swap' : ''}"><span class="wl1">${html.slice(0, head.length).join('')}</span><span class="wl2">${html.slice(head.length).join('')}</span></span>`;
    }

    _groupRow(g) {
      const open = this._open.has(g.id);
      const asc = g.entries.slice().reverse();
      const vints = asc.map((e) => `<span class="yv" style="--yc:var(--s-${e.status})">${esc(e.vintage)}</span>`).join(' · ');
      if (g.entries.length === 1) {
        // Only one vintage: the details are right in the wine row, tapping opens the details.
        const e = g.entries[0];
        const ps = this._priceSpans(e.bottles);
        return `<div class="wine"><button class="wrow" data-act="detail" data-w="${esc(e.wine)}" data-v="${esc(e.vintage)}">` +
          this._typeDot(g.b) +
          `<span class="wmain">${this._title(g.b, ps.d, true)}</span>` +
          `<span class="wright"><span class="wloc locs">${this._locsHtml(e.bottles, true)}</span>` +
          `<span class="wvint yv" style="--yc:var(--s-${e.status})">${esc(e.vintage)}</span>` +
          (this._is.has('price') && this._priceOnly(ps.d) ? `<span class="wpm">${this._priceOnly(ps.d)}</span>` : '') +
          `<span class="wcount">${esc(t('count.bottlesShort', { n: g.count })).replace(/ /g, '&nbsp;')}</span><span class="chev">›</span></span></button></div>`;
      }
      const ps = this._priceSpans([].concat.apply([], g.entries.map((x) => x.bottles)));
      let html = `<div class="wine"><button class="wrow" data-act="toggle" data-id="${esc(g.id)}" aria-expanded="${open}">` +
        this._typeDot(g.b) +
        `<span class="wmain">${this._title(g.b, ps.d, true)}</span>` +
        `<span class="wright"><span class="wvint multi">${vints}</span>` +
        `<span class="wcount">${esc(t('count.bottlesShort', { n: g.count })).replace(/ /g, '&nbsp;')}</span><span class="chev">${open ? '▾' : '▸'}</span></span></button>`;
      if (open) {
        html += `<div class="vlist">` + g.entries.map((e) => {
          const pr = this._is.has('price') ? this._priceTxt(e.bottles) : '';
          return `<div class="vrow" data-act="detail" data-w="${esc(e.wine)}" data-v="${esc(e.vintage)}" role="button" tabindex="0"><span class="vyear yv" style="--yc:var(--s-${e.status})">${esc(e.vintage)}</span>` +
            (pr ? `<span class="wprice vprl">${esc(pr)}</span>` : '') +
            `<span class="vmid"><span class="locs">${this._locsHtml(e.bottles)}</span></span>` +
            `<span class="wcount vcnt">${esc(t('count.bottlesShort', { n: e.bottles.length })).replace(/ /g, '&nbsp;')}</span><span class="chev vcnt">›</span></div>`;
        }).join('') + `</div>`;
      }
      return html + `</div>`;
    }

    _flatRow(e) {
      return `<div class="frow" data-act="detail" data-w="${esc(e.wine)}" data-v="${esc(e.vintage)}" role="button" tabindex="0">${this._typeDot(e.b)}<span class="fyear yv" style="--yc:var(--s-${e.status})">${esc(e.vintage)}</span>` +
        `<span class="fmid">${this._title(e.b, this._priceSpans(e.bottles).d)}` +
        `<span class="locs">${this._locsHtml(e.bottles)}</span></span>` +
        `<span class="vstat">${this._sdot(e.status)}${esc(STATUS_LABEL[e.status])}</span></div>`;
    }

    // ---------- Maintain producers (sort word per producer) ----------
    _words(name) { return String(name || '').trim().split(/\s+/).filter(Boolean); }
    // Sort key: the maintained word first, the other words in their old order; otherwise the spelling
    _pkey(name, map) {
      name = name || '';
      const i = (map || this._sortMap || {})[name];
      const w = this._words(name);
      if (i === undefined || i === null || !(i >= 0 && i < w.length)) return name;
      return [w[i]].concat(w.filter((_, k) => k !== i)).join(' ');
    }
    _hash(name) {
      let h = 0x811c9dc5;
      new TextEncoder().encode(name).forEach((x) => { h ^= x; h = Math.imul(h, 0x01000193) >>> 0; });
      return h.toString(16).padStart(8, '0');
    }
    _wzOpen() {
      this._det = null;
      this._wz = { q: '', all: false, err: '', busy: false, draft: Object.assign({}, this._sortMap) };
      this._renderWz();
    }
    // Changes in the draft compared with the saved state: [name, word number or -1]
    _wzChanges() {
      const d = this._wz.draft, m = this._sortMap, out = [];
      Object.keys(d).forEach((n) => { if (d[n] !== m[n]) out.push([n, d[n]]); });
      Object.keys(m).forEach((n) => { if (!(n in d)) out.push([n, -1]); });
      return out;
    }
    _wzBar() {
      const z = this._wz, n = this._wzChanges().length;
      return `<button class="btn" data-act="wzclose" ${z.busy ? 'disabled' : ''}>${esc(n ? t('wz.cancel') : t('wz.close'))}</button>` +
        `<button class="btn on" data-act="wzsave" ${n && !z.busy ? '' : 'disabled'}>${esc(z.busy ? t('wz.saving') : n ? t('wz.saveN', { n }) : t('wz.save'))}</button>`;
    }
    // ---------- Statistics (computed from the bottle list of the card, whole cellar) ----------
    _statData() {
      const d = this._data;
      if (!d) return null;
      if (this._statC && this._statC.d === d) return this._statC.v;
      const bs = d.bottles;
      const grp = (get) => {
        const m = new Map();
        bs.forEach((b) => [].concat(get(b)).forEach((v) => { if (v) m.set(v, (m.get(v) || 0) + 1); }));
        return m;
      };
      const arr = (m) => Array.from(m.entries()).sort((a, b) => b[1] - a[1] || de.compare(a[0], b[0]));
      const wines = new Map(); // wine id -> {name, producer, vintages, n, value}
      const cur = new Map();
      bs.forEach((b) => { if (typeof b.price === 'number' && b.currency) cur.set(b.currency, (cur.get(b.currency) || 0) + 1); });
      const currency = (arr(cur)[0] || [''])[0];
      let value = 0;
      const byTypeVal = new Map();
      const pb = new Map();
      const vb = { producer: new Map(), country: new Map(), region: new Map(), vintage: new Map() };
      bs.forEach((b) => {
        let w = wines.get(b.wine);
        if (!w) { w = { name: b.name, producer: b.producer, n: 0, value: 0 }; wines.set(b.wine, w); }
        w.n++;
        if (typeof b.price === 'number' && b.currency === currency) {
          value += b.price; w.value += b.price;
          byTypeVal.set(b._type, (byTypeVal.get(b._type) || 0) + b.price);
          if (b._price) { const o = pb.get(b._price) || { n: 0, v: 0 }; o.n++; o.v += b.price; pb.set(b._price, o); }
          const add = (m, k) => { if (k) m.set(k, (m.get(k) || 0) + b.price); };
          add(vb.producer, b.producer); add(vb.country, b.country); add(vb.region, b.region);
          add(vb.vintage, /^\d{4}$/.test(String(b.vintage)) ? String(b.vintage) : '');
        }
      });
      const vint = grp((b) => (/^\d{4}$/.test(String(b.vintage)) ? String(b.vintage) : ''));
      const regionsOf = new Map();
      bs.forEach((b) => {
        if (!b.country || !b.region) return;
        let m = regionsOf.get(b.country);
        if (!m) { m = new Map(); regionsOf.set(b.country, m); }
        m.set(b.region, (m.get(b.region) || 0) + 1);
      });
      const v = {
        total: bs.length, wines, currency, value,
        types: arr(grp((b) => b._type)), countries: arr(grp((b) => b.country)), regions: arr(grp((b) => b.region)),
        producers: arr(grp((b) => b.producer)), grapes: arr(grp((b) => b.grapes || [])), vintages: vint,
        regionsOf, priceBands: pb, byTypeVal: arr(byTypeVal), valBy: { producer: arr(vb.producer), country: arr(vb.country), region: arr(vb.region), vintage: arr(vb.vintage) },
        oldest: vint.size ? Math.min(...Array.from(vint.keys()).map(Number)) : null,
      };
      this._statC = { d, v };
      return v;
    }
    // Page content: {title, sections: [{head, rows: [{label, n, text, go | filter [g, v], dot}]}], more}
    _statPage(key, S, all) {
      const top = (list, limit) => (all || list.length <= limit ? list : list.slice(0, limit));
      const rows = (list, g, limit) => ({ rows: top(list, limit).map(([k, n]) => ({ label: k, n, filter: [g, k] })), total: list.length, limit });
      switch (key) {
        case 'countries': return { title: t('stat.countries'), sections: [Object.assign({ hint: t('stat.hintCountry') }, { rows: S.countries.map(([k, n]) => ({ label: k, n, go: 'country:' + k })), total: S.countries.length, limit: 99 })] };
        case 'regions': return { title: t('stat.regions'), sections: [rows(S.regions, 'region', 15)] };
        case 'producers': return { title: t('stat.producers'), sections: [rows(S.producers, 'producer', 10)] };
        case 'grapes': return { title: t('stat.grapes'), sections: [rows(S.grapes, 'grape', 10)] };
        case 'vintages': return { title: t('stat.vintages'), sections: [{ rows: Array.from(S.vintages.entries()).sort((a, b) => b[0] - a[0]).map(([k, n]) => ({ label: k, n, filter: ['vintage', k] })), total: S.vintages.size, limit: 99 }] };
        case 'wines': {
          const list = Array.from(S.wines.values()).sort((a, b) => b.n - a.n || de.compare(a.name, b.name));
          const l = top(list, 10);
          return { title: t('stat.wines'), sections: [{ rows: l.map((w) => ({ label: w.name, sub: w.producer, n: w.n, filter: ['q', w.name] })), total: list.length, limit: 10 }] };
        }
        case 'value': {
          const fmt = this._money(S.currency);
          const tab = (this._stat && this._stat.vtab) || 'wine';
          const tabs = ['wine', 'producer', 'country', 'region', 'vintage', 'price', 'types'];
          const lim = 10;
          let sec;
          if (tab === 'wine') {
            const list = Array.from(S.wines.values()).filter((w) => w.value > 0).sort((a, b) => b.value - a.value);
            sec = { rows: top(list, lim).map((w) => ({ label: w.name, sub: w.producer, n: w.value, text: fmt(w.value), filter: ['q', w.name] })), total: list.length, limit: lim };
          } else if (tab === 'price') {
            sec = { rows: PRICE.filter(([k]) => S.priceBands.has(k)).map(([k, l]) => ({ label: l, sub: t('stat.nBottles', { n: S.priceBands.get(k).n }), n: S.priceBands.get(k).v, text: fmt(S.priceBands.get(k).v), filter: ['price', k] })), total: 0, limit: 99 };
          } else if (tab === 'types') {
            sec = { rows: S.byTypeVal.map(([k, v]) => ({ label: TYPE_LABEL[k] || k, n: v, text: fmt(v), dot: k, filter: ['types', k] })), total: 0, limit: 99 };
          } else {
            const g = { producer: 'producer', country: null, region: 'region', vintage: 'vintage' }[tab];
            let list = S.valBy[tab];
            if (tab === 'vintage') list = list.slice().sort((a, b) => b[0] - a[0]);
            sec = { rows: top(list, lim).map(([k, v]) => ({ label: k, n: v, text: fmt(v), [g ? 'filter' : 'go']: g ? [g, k] : 'country:' + k })), total: list.length, limit: lim };
          }
          return { title: t('stat.value'), tabs: tabs.map((k) => [k, t('stat.vt.' + k)]), tab, sections: [sec] };
        }
        default:
          if (key.startsWith('country:')) {
            const c = key.slice(8), m = S.regionsOf.get(c) || new Map();
            return { title: c, sections: [rows(Array.from(m.entries()).sort((a, b) => b[1] - a[1] || de.compare(a[0], b[0])), 'region', 99)] };
          }
          return { title: '', sections: [] };
      }
    }
    _money(cur) {
      let f;
      try { f = new Intl.NumberFormat(I18N.lang || 'de', { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: 0 }); } catch (e) { f = null; }
      return (v) => (f ? f.format(v) : Math.round(v) + ' ' + (cur || ''));
    }
    _renderStat() {
      const el = this._dlg, S = this._statData();
      if (!el || !S) return;
      const st = this._stat, num = (n) => new Intl.NumberFormat(I18N.lang || 'de').format(n);
      const keep = el.querySelector('.dsheet'); const topPos = keep && !el.hidden ? keep.scrollTop : 0;
      const key = st.path[st.path.length - 1];
      const nav = (title) => `<div class="dh">${key ? `<button class="dx" data-act="statback" aria-label="${esc(t('stat.back'))}">←</button>` : ''}<span class="wmain"><span class="wname">${esc(title)}</span></span>` +
        `<button class="dx" data-act="statclose" aria-label="${esc(t('head.close'))}">✕</button></div>`;
      let html;
      if (!key) {
        const tile = (go, big, label) => `<button class="stile" data-act="statgo" data-to="${go}"><span class="sbig">${esc(big)}</span><span class="slbl">${esc(label)}</span></button>`;
        const mini = (go, label, val) => `<button class="smini" data-act="statgo" data-to="${go}"><span class="slbl">${esc(label)}</span><span class="sval">${esc(val || '–')}</span></button>`;
        const maxT = Math.max(1, ...S.types.map((x) => x[1]));
        html = nav(this._data.cellar || t('stat.title')) +
          `<div class="shero"><span class="sbig huge">${esc(num(S.total))}</span><span class="slbl">${esc(t('stat.bottles'))}</span></div>` +
          `<div class="sgrid">${tile('wines', num(S.wines.size), t('stat.wines'))}${tile('countries', num(S.countries.length), t('stat.countries'))}` +
          `${tile('producers', num(S.producers.length), t('stat.producers'))}${tile('vintages', S.oldest || '–', t('stat.oldest'))}</div>` +
          (S.value > 0 ? `<button class="stile wide" data-act="statgo" data-to="value"><span class="sbig val">${esc(this._money(S.currency)(S.value))}</span><span class="slbl">${esc(t('stat.cellarValue'))}</span></button>` : '') +
          `<div class="sbars">${S.types.map(([k, n]) => `<button class="sbar" data-act="statfilter" data-g="types" data-v="${esc(k)}">${this._glass(k, '')}<span class="sbn">${esc(TYPE_LABEL[k] || k)}</span>` +
            `<span class="sbt"><span class="sbf" style="width:${Math.max(2, Math.round(n / maxT * 100))}%;background:var(--w-${esc(k)}, var(--cb-ring))"></span></span><span class="sbc">${num(n)}</span></button>`).join('')}</div>` +
          `<div class="sgrid">${mini('countries', t('stat.topCountry'), (S.countries[0] || [])[0])}${mini('producers', t('stat.topProducer'), (S.producers[0] || [])[0])}` +
          `${mini('regions', t('stat.topRegion'), (S.regions[0] || [])[0])}${mini('grapes', t('stat.topGrape'), (S.grapes[0] || [])[0])}</div>`;
      } else {
        const pg = this._statPage(key, S, st.all);
        html = nav(pg.title) + (pg.tabs ? `<div class="stabs">${pg.tabs.map(([k, l]) => `<button class="stab${k === pg.tab ? ' on' : ''}" data-act="stattab" data-t="${k}">${esc(l)}</button>`).join('')}</div>` : '') + pg.sections.map((sec) => {
          const mx = Math.max(1, ...sec.rows.map((r) => r.n));
          const more = sec.total > sec.limit && sec.limit !== 99;
          return (sec.head ? `<div class="wsub shead">${esc(sec.head)}</div>` : '') + (sec.hint ? `<div class="wsub">${esc(sec.hint)}</div>` : '') +
            `<div class="slist">${sec.rows.map((r) => {
              const attr = r.go ? `data-act="statgo" data-to="${esc(r.go)}"` : `data-act="statfilter" data-g="${esc(r.filter[0])}" data-v="${esc(r.filter[1])}"`;
              return `<button class="srow" ${attr}><span class="srl">${r.dot ? this._glass(r.dot, '') : ''}<span class="srt">${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span></span>` +
                `<span class="sbt"><span class="sbf" style="width:${Math.max(2, Math.round(r.n / mx * 100))}%"></span></span><span class="sbc">${esc(r.text || num(r.n))}</span></button>`;
            }).join('')}</div>` +
            (more || (st.all && sec.total > sec.limit) ? `<button class="btn" data-act="statall">${esc(st.all ? t('stat.less') : t('stat.all', { n: sec.total }))}</button>` : '');
        }).join('') + `<div class="wsub shint">${esc(t('stat.tapHint'))}</div>`;
      }
      el.innerHTML = `<div class="dsheet statsheet" role="dialog" aria-modal="true">${html}</div>`;
      el.hidden = false;
      const sh = el.querySelector('.dsheet'); if (sh) sh.scrollTop = topPos;
    }
    _renderSet() {
      const el = this._dlg;
      if (!el) return;
      const _keep = el.querySelector('.dsheet'); const _top = _keep && !el.hidden ? _keep.scrollTop : 0; // Keep the scroll position when redrawing
      const sc = Math.round(this._scale * 100);
      const steps = [85, 100, 115, 130, 150, 175, 200];
      const hd = (name, sub, right) => `<div class="shd"><div class="wmain"><span class="wname">${esc(name)}</span><span class="wsub">${esc(sub)}</span></div>${right || ''}</div>`;
      el.innerHTML = `<div class="dsheet" role="dialog" aria-modal="true">` +
        `<div class="dh"><span class="wmain"><span class="wname">${esc(t('head.settings'))}</span></span>` +
        `<button class="dx" data-act="setclose" aria-label="${esc(t('head.close'))}">✕</button></div>` +
        `<div class="sblk">` + hd(t('set.language'), t('set.languageSub'), this._scopeSw('language')) +
        `<div class="scalechips">` + [['', t('set.languageAuto')]].concat(Object.entries(this._langs || {})).map(([c, n]) => `<button class="chip${c === (this._langSel || '') ? ' on' : ''}" data-act="lang" data-v="${esc(c)}" style="width:auto;min-width:64px;padding:0 16px;border-radius:20px;white-space:nowrap">${esc(n)}</button>`).join('') + `</div></div>` +
        `<div class="sblk"><button class="setrow" data-act="wzopen"><span class="wmain"><span class="wname">${esc(t('set.producers'))}</span>` +
        `<span class="wsub">${esc(t('set.producersSub'))}</span></span>${this._scopeSw(null, 'all')}<span class="chev">›</span></button></div>` +
        (((this._data && this._data.racks) || []).length ? `<div class="sblk">` + hd(t('set.racks'), t('set.racksSub'), this._scopeSw(null, 'all')) +
          this._data.racks.map((n) => {
            const rs = this._rs(n);
            const grp = (key, label, opts) => `<div class="wsub" style="margin-top:4px">${esc(label)}</div><div class="scalechips">` + opts.map(([v, l]) => `<button class="chip${rs[key] === v ? ' on' : ''}" data-act="rack" data-n="${esc(n)}" data-k="${key}" data-v="${v}" style="width:auto;padding:0 14px;border-radius:20px;white-space:nowrap">${esc(l)}</button>`).join('') + `</div>`;
            return `<div class="rackblk"><div class="racknm">${esc(n)}</div>` + grp('order', t('set.rackOrder'), [['top', t('set.rackTop')], ['bottom', t('set.rackBottom')]]) +
              grp('side', t('set.rackSide'), [['none', t('set.sideNone')], ['thirds', t('set.sideThirds')], ['slot', t('set.sideSlot')]]) + `</div>`;
          }).join('') + `</div>` : '') +
        `<div class="sblk">` + hd(t('set.fontSize'), t('set.fontSizeSub', { pct: sc }), this._scopeSw(null, 'device')) +
        `<div class="scalechips">` + steps.map((v) => `<button class="chip${v === sc ? ' on' : ''}" data-act="scale" data-v="${v}" style="min-width:64px">${v} %</button>`).join('') + `</div></div>` +
        FLAGS.map((f) => `<div class="sblk">` + hd(t('flag.' + f.id), t('flag.' + f.id + 'Sub'), this._scopeSw(null, 'device')) +
          `<div class="scalechips">` + [['on', t('set.on')], ['off', t('set.off')]].map(([v, n]) => `<button class="chip${(v === 'on') === this._flag(f.id) ? ' on' : ''}" data-act="flag" data-id="${esc(f.id)}" data-v="${v}" style="width:auto;min-width:64px;padding:0 16px;border-radius:20px">${esc(n)}</button>`).join('') + `</div></div>`).join('') +
        `<div class="sblk">` + hd(t('set.keepState'), t('set.keepStateSub'), this._scopeSw('keepState')) +
        `<div class="scalechips">` + [['on', t('set.keepOn')], ['off', t('set.keepOff')]].map(([v, n]) => `<button class="chip${(v === 'on') === this._keep() ? ' on' : ''}" data-act="keepst" data-v="${v}" style="width:auto;min-width:64px;padding:0 16px;border-radius:20px">${esc(n)}</button>`).join('') + `</div></div>` +
        `<div class="sblk">` + hd(t('set.filters'), t('set.filtersSub'), this._scopeSw('filters')) + (this._setErr ? `<div class="derr">${esc(this._setErr)}</div>` : '') + (this._setNote ? `<div class="wsub">${esc(this._setNote)}</div>` : '') +
        this._allDefs().map((d, i, arr) => `<div class="frow${this._fh.has(d.id) ? ' off' : ''}">` +
          `<button class="btn round" data-act="fvis" data-id="${esc(d.id)}" aria-pressed="${!this._fh.has(d.id)}" aria-label="${esc(t('set.toggle', { label: d.label }))}">${this._fh.has(d.id) ? '○' : '●'}</button>` +
          `<span class="wmain"><span class="wname">${d.personal ? '[' + esc(d.label) + ']' : esc(d.label)}</span>${d.personal ? '<span class="wsub">' + esc(t('set.dataField')) + '</span>' : ''}</span>` +
          (d.personal && !this._integ() ? `<button class="btn round" data-act="fdelask" data-id="${esc(d.id)}" aria-label="${esc(t('set.deleteForever', { label: d.label }))}" title="${esc(t('set.deleteTitle'))}">🗑</button>` : '') +
          `<button class="btn round" data-act="fup" data-id="${esc(d.id)}" aria-label="${esc(t('set.up'))}"${i === 0 ? ' disabled' : ''}>▲</button>` +
          `<button class="btn round" data-act="fdn" data-id="${esc(d.id)}" aria-label="${esc(t('set.down'))}"${i === arr.length - 1 ? ' disabled' : ''}>▼</button></div>`).join('') +
        `</div>` +
        `<div class="sblk">` + hd(t('set.info'), t('set.infoSub'), this._scopeSw(null, 'device')) +
        this._infoDefs().map((d, i, arr) => `<div class="frow${this._is.has(d.id) ? '' : ' off'}">` +
          `<button class="btn round" data-act="ivis" data-id="${esc(d.id)}" aria-pressed="${this._is.has(d.id)}" aria-label="${esc(t('set.toggle', { label: d.label }))}">${this._is.has(d.id) ? '●' : '○'}</button>` +
          `<span class="wmain"><span class="wname">${d.personal ? '[' + esc(d.label) + ']' : esc(d.label)}</span>${d.personal ? '<span class="wsub">' + esc(t('set.dataField')) + '</span>' : ''}</span>` +
          (d.fixed ? '' : `<button class="btn round" data-act="iup" data-id="${esc(d.id)}" aria-label="${esc(t('set.up'))}"${i === 0 ? ' disabled' : ''}>▲</button>` +
          `<button class="btn round" data-act="idn" data-id="${esc(d.id)}" aria-label="${esc(t('set.down'))}"${i === arr.length - 2 ? ' disabled' : ''}>▼</button>`) + `</div>`).join('') +
        `</div><div class="dact"><button class="btn on" data-act="setclose">${esc(t('set.done'))}</button></div></div>`;
      el.hidden = false;
      if (_top) { const _n = el.querySelector('.dsheet'); if (_n) _n.scrollTop = _top; }
    }
    // The filter choice applies to all devices: save it in Home Assistant, report errors only quietly
    async _saveSettings() {
      const S = this._shared || {};
      const enc = (a) => (a.length ? a.map((x) => encodeURIComponent(x)).join(',') : '-');
      try {
        await this._call('settings',
          { o: enc(S.filterOrder || []), h: enc(S.filterHidden || []), l: S.language || '-', r: enc(Object.entries(S.rackSettings || {}).map(([n, v]) => [n, v.order, v.side].join('|'))), k: S.keepState === undefined ? 'keep' : (S.keepState ? '1' : '0') },
          { filter_order: S.filterOrder || [], filter_hidden: S.filterHidden || [], language: S.language || '', rack_settings: S.rackSettings || {}, ...(S.keepState === undefined ? {} : { keep_state: !!S.keepState }) });
        this._setErr = '';
      } catch (e) {
        this._setErr = t('set.saveFailed', { err: (e && e.message) || String(e) });
      }
      if (this._set) this._renderSet();
    }
    async _delField() {
      const f = this._fdel;
      if (!f || f.busy) return;
      f.busy = true; f.err = ''; this._renderDlg();
      try {
        await this._call('fielddel', { l: encodeURIComponent(f.label) }, { label: f.label });
        this._fdel = null;
        this._setNote = t('fd.note', { label: f.label });
        [40000, 90000].forEach((ms) => setTimeout(() => { this._load().then(() => { if (!(this._data.fields || []).includes(f.label)) this._setNote = ''; if (this._set) this._renderSet(); }); }, ms));
        this._renderDlg();
      } catch (e) {
        f.busy = false; f.err = t('fd.failed', { err: (e && e.message) || String(e) });
        this._renderDlg();
      }
    }
    _fmove(id, dir) {
      const ids = this._allDefs().map((d) => d.id);
      const i = ids.indexOf(id), j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return;
      ids.splice(j, 0, ids.splice(i, 1)[0]);
      this._setFilters(ids, Array.from(this._fh));
      this._renderHead(); this._renderSet();
    }
    _renderWz() {
      const el = this._dlg, z = this._wz;
      if (!el) return;
      if (!z) { el.hidden = true; el.innerHTML = ''; return; }
      el.innerHTML = `<div class="dsheet" role="dialog" aria-modal="true">` +
        `<div class="dh"><span class="wmain"><span class="wname">${esc(t('wz.title'))}</span>` +
        `<span class="wsub">${esc(t('wz.hint'))}</span></span>` +
        `<button class="dx" data-act="wzclose" aria-label="${esc(t('wz.close'))}" ${z.busy ? 'disabled' : ''}>✕</button></div>` +
        `<div class="row-chips"><div class="search has" style="flex:1 1 180px"><input type="text" data-wzq autocomplete="off" placeholder="${esc(t('wz.search'))}" value="${esc(z.q)}"></div>` +
        `<button class="chip${z.all ? '' : ' on'}" data-act="wzall" aria-pressed="${!z.all}">${esc(t('wz.multi'))}</button></div>` +
        `<div class="derr" data-wzerr ${z.err ? '' : 'hidden'}>${esc(z.err)}</div>` +
        `<div class="wzlist"></div>` +
        `<div class="dact" data-wzbar>${this._wzBar()}</div></div>`;
      el.hidden = false;
      this._renderWzList();
    }
    _renderWzList() {
      const box = this._dlg && this._dlg.querySelector('.wzlist');
      const z = this._wz;
      if (!box || !z) return;
      const draft = z.draft;
      const counts = this._data ? this._data.facet.producer : new Map();
      const toks = norm(z.q).split(/\s+/).filter(Boolean);
      const names = Array.from(counts.keys());
      const orphans = Object.keys(draft).filter((n) => !counts.has(n));
      const show = names.filter((n) => {
        if (!z.all && this._words(n).length < 2 && !(n in draft)) return false;
        const h = norm(n);
        return toks.every((t) => h.includes(t));
      }).sort((a, b) => de.compare(this._pkey(a, draft), this._pkey(b, draft)));
      const row = (n, orphan) => {
        const w = this._words(n), cur = draft[n];
        const words = orphan ? `<span class="wzname">${esc(n)}</span>` : w.map((x, i) =>
          `<button class="wzw${cur === i ? ' on' : ''}" data-act="wzw" data-h="${this._hash(n)}" data-i="${i}" aria-pressed="${cur === i}">${esc(x)}</button>`).join('');
        const note = orphan ? `<button class="btn" data-act="wzdel" data-h="${this._hash(n)}">${esc(t('wz.delete'))}</button>`
          : (cur !== undefined ? `<span class="dpur">${esc(t('wz.sortedAs', { key: this._pkey(n, draft) }))}</span>` : '');
        return `<div class="wzrow"><span class="wzwords">${words}</span><span class="wznote">${note}</span>` +
          `<span class="wzn">${esc(t('count.bottlesShort', { n: counts.get(n) || 0 })).replace(/ /g, '&nbsp;')}</span></div>`;
      };
      let html = show.map((n) => row(n, false)).join('') || `<div class="msg">${esc(t('wz.empty'))}</div>`;
      if (orphans.length) html += `<div class="dsec" style="margin-top:8px">${esc(t('wz.orphans'))}</div>` + orphans.map((n) => row(n, true)).join('');
      box.innerHTML = html;
      const bar = this._dlg.querySelector('[data-wzbar]');
      if (bar) bar.innerHTML = this._wzBar();
    }
    // Tap in the dialog: only the draft changes, it is saved with "Save"
    _wzTap(h, i) {
      const z = this._wz;
      if (!z || z.busy) return;
      const name = Array.from(this._data.facet.producer.keys()).concat(Object.keys(z.draft)).find((n) => this._hash(n) === h);
      if (!name) return;
      if (i < 0 || z.draft[name] === i) delete z.draft[name]; else z.draft[name] = i;
      this._renderWzList();
    }
    async _wzSave() {
      const z = this._wz;
      if (!z || z.busy) return;
      const changes = this._wzChanges();
      if (!changes.length) return;
      z.busy = true; z.err = '';
      this._renderWz();
      try {
        for (const [name, i] of changes) {
          const data = await this._call('winzer', { h: this._hash(name), i }, { name, index: i });
          this._sortMap = data.map || this._sortMap;
        }
      } catch (e) {
        z.busy = false;
        z.err = t('set.saveFailed', { err: (e && e.message) || String(e) });
        this._renderWz();
        this._renderHead(); this._renderList();
        return;
      }
      this._wz = null;
      this._renderDlg();
      this._renderHead();
      this._renderList();
    }

    // ---------- Detail view and take-out ----------
    _detBottles() {
      const d = this._det;
      const list = this._data.bottles.filter((b) => (b.wine || b.name) === d.wine && String(b.vintage || 'NV') === d.vintage);
      return list.sort((a, b) => (a._loc === NO_LOC) - (b._loc === NO_LOC) || de.compare(a._loc, b._loc));
    }
    _fmtDate(v) {
      const x = new Date(v);
      return isNaN(x) ? '' : x.toLocaleDateString(I18N.lang);
    }
    // Load the other bottles of the vintage one after another (the chosen one first, so note and profile are there at once)
    async _queueInfo(first, ids) {
      this._iq = this._iq || [];
      ids.forEach((i) => { if (i !== first && !this._info[i] && !this._iq.includes(i)) this._iq.push(i); });
      if (this._ipump) return;
      this._ipump = true;
      try {
        while (this._iq.length && this._det && this._det.step !== 'done') {
          const f = this._info[first];
          if (!f || f.loading) { await new Promise((r) => setTimeout(r, 300)); continue; }
          const id = this._iq.shift();
          if (!this._info[id]) await this._fetchInfo(id);
        }
      } finally { this._ipump = false; if (!this._det) this._iq = []; }
    }
    async _fetchInfo(id) {
      if (this._info[id]) return;
      this._info[id] = { loading: true };
      try {
        const data = await this._call('bottle', { id }, { id });
        this._info[id] = data;
      } catch (e) {
        this._info[id] = { error: (e && e.message) || String(e) };
        setTimeout(() => { if (this._info[id] && this._info[id].error) delete this._info[id]; }, 30000);
      }
      if (this._det) this._renderDlg();
    }
    // Feature flags for experiments: add {id, label, sub} (texts in the language files as flag.<id> and flag.<id>Sub) and ask _flag(id).
    // Per device in the settings (only shown while FLAGS is not empty) or in the card config (flags: {id: true}).
    _flag(id) {
      const L = (this._local && this._local.flags) || {};
      if (L[id] !== undefined) return !!L[id];
      return !!((this._cfg.flags || {})[id]);
    }
    // Format the value of a personal data field by its look (date, yes/no, number)
    _fmtVal(v) {
      const x = String(v);
      if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(x)) return this._fmtDate(x) || x;
      if (/^(true|false)$/i.test(x)) return /^true$/i.test(x) ? '✓' : '–';
      return x;
    }
    _fmtMoney(v, cur) {
      try { return cur ? new Intl.NumberFormat(I18N.lang, { style: 'currency', currency: cur }).format(v) : String(v); } catch (e) { return v + ' ' + (cur || ''); }
    }
    // Detail view ("view" only): orders the details like Cellarion (wine, maturity, profile, my entry, own fields, bottles)
    _viewV2(sel, bottles, info) {
      const yr = new Date().getFullYear();
      const d = this._det;
      // Region and classification are already in the title line: only country and (differing) appellation here
      const origin = Array.from(new Set([sel.country, sel.appellation !== sel.region ? sel.appellation : ''].filter(Boolean))).join(' · ');
      const df = sel.drinkFrom, dt = sel.drinkTo, pf = sel.peakFrom, pu = sel.peakUntil;
      let bar = '';
      if (df && dt) {
        const lo = Math.min(df, yr), hi = Math.max(dt, yr), span = Math.max(1, hi - lo);
        const pc = (y) => (((y - lo) / span) * 100).toFixed(1);
        bar = `<div class="d2bar" role="img" aria-label="${esc(t('det.drinkWindow'))}"><i class="w" style="left:${pc(df)}%;width:${(((dt - df) / span) * 100).toFixed(1)}%"></i>` +
          (pf && pu ? `<i class="p" style="left:${pc(pf)}%;width:${(((pu - pf) / span) * 100).toFixed(1)}%"></i>` : '') +
          `<b style="left:${pc(yr)}%"><span${Number(pc(yr)) < 8 ? ' style="left:0;transform:none"' : ''}>${esc(t('det.today'))}</span></b></div>` +
          `<div class="d2yrs"><span>${df}</span>${pf && pu ? `<span>${esc(t('win.peak', { from: pf, to: pu }))}</span>` : ''}<span>${dt}</span></div>`;
      }
      const st = sel._status;
      // The bar shows the status by its color; without a bar the status text stays as a fallback
      const maturity = bar || `<div>${this._sdot(st)} ${esc(STATUS_LABEL[st])}</div>`;
      const pr = info && info.profile;
      const lab = (v) => { const key = 'prof.' + v; const x = t(key); return x === key ? String(v) : x; };
      let about = '';
      if (pr) {
        const chips = ['body', 'acidity', 'sweetness', 'tannin'].filter((k) => pr[k]).map((k) => `<span><em>${esc(t('prof.' + k))}</em>${esc(lab(pr[k]))}</span>`).join('');
        const fl = (pr.flavors || []).map((x) => `<span>${esc(x)}</span>`).join('');
        const fp = (pr.foodPairings || []).map((x) => `<span>${esc(x)}</span>`).join('');
        // Thin separator line and an icon in front of each chip group instead of headings
        const ic = (d) => `<svg class="d2gic" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
        const grp = (html, icon) => (!html ? '' : `<div class="d2grp">${ic(icon)}<div class="d2chips">${html}</div></div>`);
        about = grp(chips, '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>') +
          grp(fl, '<path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14zM5 19l8-8"/>') +
          grp(fp, '<path d="M6 3v7a2 2 0 0 0 2 2v9M10 3v7a2 2 0 0 1-2 2M18 3c-2.5 2-3 6-1 9h1v9"/>') +
          (pr.description ? `<div class="d2txt" style="margin-top:8px">${esc(pr.description)}</div>` : '');
      }
      // My data at vintage level: same for all bottles -> value, otherwise range and hint
      const infos = bottles.map((b) => this._info[b.id]).filter((i) => i && !i.loading && !i.error);
      const ne = `<span class="d2ne" title="${esc(t('det.differs'))}" aria-label="${esc(t('det.differs'))}">≠</span>`;
      const lot = (key, fmt, rng) => {
        const vals = infos.map((i) => i[key]).filter((v) => v != null && v !== '');
        if (!vals.length) return '';
        const uniq = Array.from(new Set(vals.map((v) => JSON.stringify(v)))).map((v) => JSON.parse(v));
        if (uniq.length === 1) return esc(fmt(uniq[0]));
        const sorted = uniq.slice().sort((x, y) => (x > y ? 1 : -1));
        return esc(rng ? fmt(sorted[0]) + ' – ' + fmt(sorted[sorted.length - 1]) : sorted.map(fmt).join(', ')) + ne;
      };
      const money = (v) => this._fmtMoney(v, (infos.find((i) => i.price != null) || {}).currency);
      const priceTxt = info && !info.loading && !info.error ? lot('price', money, true) : '';
      const dateTxt = lot('purchaseDate', (v) => this._fmtDate(v), true);
      const shopTxt = lot('purchaseLocation', (v) => v, false);
      const ratingTxt = lot('rating', (v) => String(v) + ((infos.find((i) => i.ratingScale) || {}).ratingScale ? ' / ' + infos.find((i) => i.ratingScale).ratingScale : ''), true);
      const nOrder = bottles.filter((b) => this._info[b.id] && this._info[b.id].onOrder).length;
      const rows = [
        [t('det.price'), priceTxt], [t('det.purchaseDate'), dateTxt], [t('det.shop'), shopTxt], [t('det.size'), lot('bottleSize', (v) => v, false)],
        [t('det.rating'), ratingTxt], [t('det.occasion'), lot('occasion', (v) => v, false)],
        [t('det.onOrder'), nOrder ? (nOrder === bottles.length ? '✓' : `${nOrder}/${bottles.length}` + ne) : ''],
      ].concat(((this._data && this._data.fields) || []).map((l) => {
        const vs = Array.from(new Set(bottles.map((b) => b.p && b.p[l]).filter(Boolean)));
        return [l, vs.length ? esc(vs.map((v) => this._fmtVal(v)).join(', ')) + (vs.length > 1 ? ne : '') : ''];
      }));
      const loadingInfo = !info || info.loading;
      const mineRows = rows.filter((r) => r[1]);
      // Values from lot()/fields are already escaped, the brand too; labels are escaped here
      const mine = `<div class="d2mine"><div class="d2h">${esc(t('det.mine'))}</div>` +
        (mineRows.length ? `<dl class="dfacts" style="margin:0">${mineRows.map((r) => `<dt>${esc(r[0])}</dt><dd>${r[1]}</dd>`).join('')}</dl>` : '') +
        (loadingInfo ? `<div class="dpur">${esc(t('det.noteLoading'))}</div>` : (info.error ? `<div class="dpur">${esc(t('det.noteError', { err: info.error }))}</div>` : '')) + `</div>`;
      // Leave out the first note paragraph with the merchant (e.g. "Bought at ..."): it is already under My data
      const stripShop = (n, shop) => {
        const parts = String(n).split(/\n\s*\n/);
        if (shop && parts.length > 1 && parts[0].toLowerCase().includes(String(shop).toLowerCase()) && parts[0].length < 140) parts.shift();
        return parts.join('\n\n');
      };
      const notes = Array.from(new Set(infos.map((i) => (i.notes ? stripShop(i.notes, i.purchaseLocation) : '')).filter(Boolean)));
      const noteHtml = notes.length ? `<div class="dsec">${esc(t('det.myNote'))}${notes.length > 1 ? ne : ''}</div><div class="dnote">${esc(notes[0])}</div>` : '';
      // Bottles: selectable grouped by place (take-out "from this place"), each group expandable down to the single bottle
      const nm = (l) => (l === NO_LOC ? t('loc.noneShort') : l);
      const groups = new Map();
      bottles.forEach((b) => { if (!groups.has(b._loc)) groups.set(b._loc, []); groups.get(b._loc).push(b); });
      const multi = groups.size > 1;
      const sectionOpen = !!(d && d.botsOpen);
      const gOpen = (d && d.grpOpen) || new Set();
      const botRow = (b) => {
        const i = this._info[b.id] || {};
        const sub = [i.price != null ? this._fmtMoney(i.price, i.currency) : (b.price != null ? this._fmtMoney(b.price, b.currency) : ''),
          i.purchaseDate ? this._fmtDate(i.purchaseDate) : '', i.purchaseLocation || b.shop || '', i.rating != null ? '★ ' + i.rating : ''].filter(Boolean).join(' · ');
        return `<button class="dbot${b.id === sel.id ? ' on' : ''}" data-act="dsel" data-id="${esc(b.id)}" style="margin-left:18px;width:calc(100% - 18px)"><span class="rd"></span>` +
          `<span class="wmain"><span class="loc${b._loc === NO_LOC ? ' none' : ''}">${esc(nm(b._loc))}</span>${sub ? `<span class="dpur">${esc(sub)}</span>` : ''}</span></button>`;
      };
      const gRows = (list) => list.map(([l, arr], gi) => {
        const on = arr.some((b) => b.id === sel.id);
        const op = gOpen.has(l);
        return `<div style="display:flex;align-items:stretch;gap:6px"><button class="dbot${on ? ' on' : ''}" data-act="dsel" data-id="${esc((arr.find((b) => b.id === sel.id) || arr[0]).id)}" style="flex:1"><span class="rd"></span>` +
          `<span class="loc${l === NO_LOC ? ' none' : ''}">${esc(nm(l))}${arr.length > 1 ? ' ×' + arr.length : ''}</span></button>` +
          `<button class="btn round" data-act="dgrp" data-l="${esc(l)}" aria-expanded="${op}" aria-label="${esc(t('det.bottlesN', { n: arr.length }))}">${op ? '▾' : '▸'}</button></div>` +
          (op ? arr.map(botRow).join('') : '');
      }).join('');
      // Fixed bar at the bottom: chosen place (tap = selection as a sheet from below) + take out
      const selGrp = groups.get(sel._loc) || [sel];
      const _split = (l) => { const n = nm(l), i = n.indexOf(' · '); return i < 0 ? [n, ''] : [n.slice(0, i), n.slice(i + 3)]; };
      const _rk = _split(sel._loc)[0];
      const _inRack = Array.from(groups.entries()).filter(([l]) => _split(l)[0] === _rk).sort(([l]) => (l === sel._loc ? -1 : 0));
      const _nRack = _inRack.reduce((n, [, arr]) => n + arr.length, 0);
      const _places = _inRack.map(([l, arr]) => _split(l)[1] ? _split(l)[1] + (arr.length > 1 && _inRack.length > 1 ? ' ×' + arr.length : '') : '').filter(Boolean).join(', ');
      const _cnt = t('det.bottlesN', { n: _nRack });
      const popup = sectionOpen ? `<div class="d2pop" role="listbox">${gRows(Array.from(groups.entries()))}</div>` : '';
      const botsSec = '';
      const actBar = `<div class="dact d2act">${popup}` +
        `<button class="d2sel" data-act="dbots" aria-expanded="${sectionOpen}" aria-haspopup="listbox"><span class="d2st"><span class="d2sub" style="color:var(--cb-text);font-weight:600">${esc(_rk)} · <span class="bw">${esc(_cnt)}</span><span class="bi" title="${esc(_cnt)}" aria-label="${esc(_cnt)}"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M10 2h4v2.5c0 1 .6 1.6 1.2 2.6C16 8.3 16.5 9.5 16.5 11V21a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V11c0-1.5.5-2.7 1.3-3.9C9.4 6.1 10 5.5 10 4.5z"/></svg>${_nRack}</span></span>${_places ? `<span class="loc">${esc(_places)}</span>` : ''}</span>` +
        `<span class="d2pill${multi ? ' hot' : ''}"${multi ? ` title="${esc(t('det.morePlaces', { n: groups.size - 1 }))}" aria-label="${esc(t('det.morePlaces', { n: groups.size - 1 }))}"` : ''}>${multi ? '+' + (groups.size - 1) + ' ' : ''}${sectionOpen ? '▾' : '▴'}</span></button>` +
        `<button class="btn on" data-act="dask">${esc(t('det.take'))}</button></div>`;
      const img = info && info.image ? `<img class="dimg" alt="${esc(t('det.label'))}" src="${esc(info.image)}" onerror="this.remove()">` : '';
      const grapes = (sel.grapes || []).join(', ');
      const main = `<div class="d2main"><div><b>${esc(sel.vintage || 'NV')}</b>${[origin, grapes, t('det.bottlesN', { n: bottles.length })].filter(Boolean).map((x) => ' · <span class="d2sub">' + esc(x) + '</span>').join('')}</div>` + mine + `</div>`;
      return `<div class="d2hero">${img}${main}</div>${maturity}${about}${noteHtml}${botsSec}${actBar}`;
    }
    _renderDlg() { this._renderDlg0(); this._hsync(); this._dlgTop(); }
    // Phone: the popup starts below the dashboard header (the navigation stays visible)
    _dlgTop() {
      const el = this._dlg;
      if (!el || el.hidden) return;
      let top = 0;
      try {
        if (window.matchMedia('(max-width: 600px)').matches) {
          const r = this.getBoundingClientRect();
          top = r.top > 0 && r.top < 140 ? Math.round(r.top) : 0;
        }
      } catch (e) { top = 0; }
      el.style.top = top ? top + 'px' : '';
    }
    // Android back (Companion app): every open dialog level gets its own history entry, so "back" closes only the top level.
    _hdepth() {
      return (this._det ? 1 : 0) + (this._set ? 1 : 0) + (this._stat ? 1 + (this._stat.path || []).length : 0) + (this._wz ? 1 : 0) + (this._dd ? 1 : 0) + (this._fdel ? 1 : 0) + (this._cfm ? 1 : 0);
    }
    _hsync() {
      if (this._hskip) return;
      const d = this._hdepth(), h = this._hd || 0;
      try {
        if (d > h) { for (let i = h; i < d; i++) history.pushState({ cbDlg: i + 1 }, ''); this._hd = d; }
        else if (d < h) { this._hskip = 1; this._hd = d; history.go(d - h); }
      } catch (e) { this._hd = d; this._hskip = 0; }
    }
    _hpop() {
      if (this._hskip) { this._hskip = 0; this._hsync(); return; }
      if (!this._hd) return;
      this._hd--;
      // one level back
      if (this._fdel) { if (!this._fdel.busy) this._fdel = null; }
      else if (this._cfm) this._cfm = null;
      else if (this._dd) this._dd = null;
      else if (this._wz) { if (!this._wz.busy) this._wz = null; }
      else if (this._set) this._set = null;
      else if (this._stat) { if (this._stat.path.length) { this._stat.path.pop(); this._stat.all = false; } else this._stat = null; }
      else if (this._det) { if (!this._det.busy) this._det = null; }
      this._renderDlg0();
      this._hsync();
    }
    _renderDlg0() {
      const el = this._dlg;
      if (!el) return;
      el.classList.toggle('dd', !!this._dd);
      if (this._fdel) {
        const f = this._fdel;
        el.innerHTML = `<div class="dsheet csheet" role="dialog" aria-modal="true"><div class="dh"><span class="wmain"><span class="wname">${esc(t('fd.title', { label: f.label }))}</span>` +
          `<span class="wsub">${esc(t('fd.text', { n: f.n }))}</span></span></div>` +
          (f.err ? `<div class="derr">${esc(f.err)}</div>` : '') +
          `<div class="dact"><button class="btn" data-act="fdelno" ${f.busy ? 'disabled' : ''}>${esc(t('fd.cancel'))}</button><button class="btn danger" data-act="fdelyes" ${f.busy ? 'disabled' : ''}>${esc(f.busy ? t('fd.starting') : t('fd.confirm'))}</button></div></div>`;
        el.hidden = false;
        return;
      }
      if (this._cfm) {
        el.innerHTML = `<div class="dsheet csheet" role="dialog" aria-modal="true"><div class="dh"><span class="wmain"><span class="wname">${esc(t('rl.title'))}</span>` +
          `<span class="wsub">${esc(t('rl.text'))}</span></span></div>` +
          `<div class="dact"><button class="btn" data-act="pno">${esc(t('rl.cancel'))}</button><button class="btn on" data-act="pyes">${esc(t('rl.confirm'))}</button></div></div>`;
        el.hidden = false;
        return;
      }
      if (this._dd) { this._renderDd(); return; }
      if (this._wz) { this._renderWz(); return; }
      if (this._set) { this._renderSet(); return; }
      if (this._stat) { this._renderStat(); return; }
      const d = this._det;
      if (!d || !this._data) { el.hidden = true; el.innerHTML = ''; return; }
      const bottles = this._detBottles();
      if (!bottles.length && d.step !== 'done') { this._det = null; el.hidden = true; el.innerHTML = ''; return; }
      const b0 = bottles[0] || d.snap;
      if (bottles.length && !bottles.some((b) => b.id === d.sel)) d.sel = bottles[0].id;
      const sel = bottles.find((b) => b.id === d.sel);
      if (sel && d.step !== 'done') {
        this._fetchInfo(sel.id);
        this._queueInfo(sel.id, bottles.slice(0, 12).map((b) => b.id));
      }
      const info = sel ? this._info[sel.id] : null;
      const edUrl = this._data.cellarId && b0 && b0.wine ? `${this._data.url}/cellars/${encodeURIComponent(this._data.cellarId)}/vintages/${encodeURIComponent(b0.wine)}/${encodeURIComponent(b0.vintage || 'NV')}` : '';
      const edit = edUrl ? `<a class="dx" href="${esc(edUrl)}" target="_blank" rel="noopener" aria-label="${esc(t('det.editIn'))}" title="${esc(t('det.editIn'))}"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></a>` : '';
      const head = `<div class="dh">${this._typeDot(b0)}<span class="wmain">${this._title(b0)}</span>${edit}` +
        `<button class="dx" data-act="dclose" aria-label="${esc(t('head.close'))}" ${d.busy ? 'disabled' : ''}>✕</button></div>`;
      let body = '';
      if (d.step === 'done') {
        body = `<div class="dask">${esc(t('det.taken'))}</div><div>${esc(d.snap.name)} ${esc(d.snap.vintage || '')}${d.snap._loc !== NO_LOC ? ' · ' + esc(d.snap._loc) : ''}<br>` +
          `<span class="dpur">${esc(t('det.takenInfo', { reason: d.reasonLabel }))}</span></div>` +
          `<div class="dact">${bottles.length ? `<button class="btn" data-act="dagain">${esc(t('det.again', { n: bottles.length }))}</button>` : ''}` +
          `<button class="btn on" data-act="dclose">${esc(t('det.done'))}</button></div>`;
      } else if (d.step === 'confirm') {
        const reasons = ['drank', 'gifted', 'sold', 'other'].map((v) => [v, t('reason.' + v)]);
        body = `<div class="dask">${esc(t('det.confirmTitle'))}</div>` +
          `<div><b>${esc(sel.name)} ${esc(sel.vintage || '')}</b><br><span class="dpur">${esc(sel._loc === NO_LOC ? t('loc.noneShort') : sel._loc)}</span></div>` +
          `<div class="dsec">${esc(t('det.reason'))}</div><div class="row-chips">` +
          reasons.map(([v, l]) => `<button class="chip${d.reason === v ? ' on' : ''}" data-act="dreason" data-v="${v}">${l}</button>`).join('') + `</div>` +
          (d.err ? `<div class="derr">${esc(d.err)}</div>` : '') +
          `<div class="dact"><button class="btn" data-act="dback" ${d.busy ? 'disabled' : ''}>${esc(t('det.cancel'))}</button>` +
          `<button class="btn danger" data-act="dgo" ${d.busy ? 'disabled' : ''}>${esc(d.busy ? t('det.taking') : t('det.takeYes'))}</button></div>`;
      } else {
        body = this._viewV2(sel, bottles, info);
      }
      const top = el.firstElementChild ? el.firstElementChild.scrollTop : 0;
      el.innerHTML = `<div class="dsheet" role="dialog" aria-modal="true">${head}${body}</div>`;
      if (el.firstElementChild) el.firstElementChild.scrollTop = top;
      el.hidden = false;
    }
    async _onDlg(act, el) {
      const d = this._det;
      if (!d) return;
      if (act === 'dclose') { if (!d.busy) { this._det = null; this._renderDlg(); } return; }
      if (act === 'dsel') { d.sel = el.dataset.id; d.more = false; d.botsOpen = false; }
      else if (act === 'dmore') d.more = !d.more;
      else if (act === 'dbots') d.botsOpen = !d.botsOpen;
      else if (act === 'dgrp') { d.grpOpen = d.grpOpen || new Set(); const l = el.dataset.l; if (d.grpOpen.has(l)) d.grpOpen.delete(l); else d.grpOpen.add(l); }
      else if (act === 'dask') { d.step = 'confirm'; d.err = ''; }
      else if (act === 'dback') { if (!d.busy) d.step = 'view'; }
      else if (act === 'dagain') { d.step = 'view'; d.more = false; }
      else if (act === 'dreason') d.reason = el.dataset.v;
      else if (act === 'dgo') { await this._consume(); return; }
      this._renderDlg();
    }
    async _consume() {
      const d = this._det;
      if (!d || d.busy) return;
      const sel = this._detBottles().find((b) => b.id === d.sel);
      if (!sel) return;
      d.busy = true; d.err = '';
      this._renderDlg();
      try {
        const { domain, service } = this._svc(this._cfg.consume_service || 'my_cellarion.consume_bottle');
        await this._hass.callService(domain, service, { bottle_id: sel.id, reason: d.reason });
      } catch (e) {
        d.busy = false;
        d.err = t('det.takeFailed', { err: (e && e.message) || String(e) });
        this._renderDlg();
        return;
      }
      d.snap = sel; d.reasonLabel = t('reason.' + d.reason);
      d.busy = false; d.step = 'done';
      this._gone.add(sel.id);
      if (this._raw) this._ingest(this._raw);
      this._renderAll();
      this._renderDlg();
      clearTimeout(this._afterTimer);
      this._afterTimer = setTimeout(() => this._load(), 12000);
    }

    // ---------- Interaction ----------
    // Click on the dark backdrop of a dialog: close the topmost open one
    _backdropClick(e) {
      const c = e.target.classList;
      if (!c || !c.contains('dlg')) return false;
      if (this._dd) { this._dd = null; this._renderDlg(); }
      else if (this._fdel) { if (!this._fdel.busy) { this._fdel = null; this._renderDlg(); } }
      else if (this._cfm) { this._cfm = false; this._renderDlg(); }
      else if (this._stat) { this._stat = null; this._renderDlg(); }
      else if (this._wz) { if (!this._wz.busy) this._wz = null; this._renderDlg(); }
      else if (this._det && !this._det.busy) { this._det = null; this._renderDlg(); }
      return true;
    }
    // Clicks: the element carries data-act; ACTIONS (below the class) maps each name to its handler.
    // Prefix groups: wz* = winery wizard, d* = detail dialog (_onDlg).
    _onClick(e) {
      if (this._backdropClick(e)) return;
      const t = e.target.closest && e.target.closest('[data-act]');
      if (!t) return;
      const act = t.dataset.act;
      const h = ACTIONS[act];
      if (h) h.call(this, t);
      else if (act.startsWith('wz')) this._onWz(act, t);
      else if (act.startsWith('d')) this._onDlg(act, t);
    }
    _onWz(act, t) {
      if (act === 'wzclose') { if (!this._wz.busy) { this._wz = null; this._renderDlg(); } }
      else if (act === 'wzsave') this._wzSave();
      else if (act === 'wzall') { this._wz.all = !this._wz.all; this._renderWz(); }
      else if (act === 'wzw') this._wzTap(t.dataset.h, Number(t.dataset.i));
      else if (act === 'wzdel') this._wzTap(t.dataset.h, -1);
    }
    _onChange(e) {
      const s = e.target && e.target.dataset && e.target.dataset.sel;
      if (!s) return;
      if (s === 'sort') { this._sort = e.target.value; this._saveState(); }
      else if (e.target.value) { this._fs(s).add(e.target.value); }
      this._renderAll();
    }
    _onInput(e) {
      if (e.target.dataset && e.target.dataset.wzq !== undefined && this._wz) { this._wz.q = e.target.value; this._renderWzList(); return; }
      if (!e.target.matches || !e.target.matches('input[type=search]')) return;
      this._f.q = e.target.value;
      const box = e.target.closest('.search');
      if (box) box.classList.toggle('has', !!this._f.q);
      clearTimeout(this._qTimer);
      this._qTimer = setTimeout(() => this._renderAll(), 120);
    }
  }

  // Handler per data-act; `this` is the card, `t` the clicked element
  const ACTIONS = {
    showhid() { this._showHid = !this._showHid; this._renderHead(); },
    dd(t) { this._dd = t.dataset.id; this._renderDlg(); },
    ddclose() { this._dd = null; this._renderDlg(); },
    ddpick(t) {
      const id = this._dd, v = t.dataset.v;
      this._dd = null;
      if (id === 'sort') { this._sort = v; this._saveState(); } else if (id) { this._fs(id).add(v); }
      this._renderDlg(); this._renderAll();
    },
    detail(t) {
      if (t.classList.contains('wrow') && this._open.size) { this._open = new Set(); this._renderList(); }
      this._det = { wine: t.dataset.w, vintage: t.dataset.v, step: 'view', reason: 'drank', sel: null, more: false, busy: false, err: '' };
      this._renderDlg();
    },
    statopen() { this._det = null; this._stat = { path: [], all: false }; this._renderDlg(); },
    statclose() { this._stat = null; this._renderDlg(); },
    statback() { if (this._stat) { this._stat.path.pop(); this._stat.all = false; this._renderDlg(); } },
    stattab(t) { if (this._stat) { this._stat.vtab = t.dataset.t; this._stat.all = false; this._renderDlg(); } },
    statall() { if (this._stat) { this._stat.all = !this._stat.all; this._renderDlg(); } },
    statgo(t) { if (this._stat) { this._stat.path.push(t.dataset.to); this._stat.all = false; this._renderDlg(); } },
    statfilter(t) {
      const g = t.dataset.g, v = t.dataset.v;
      this._stat = null;
      this._f = { q: '' }; // only the filter of the tap, earlier filters are cleared
      if (g === 'q') this._f.q = v; else this._fs(g).add(v);
      // A single wine and vintage as result: straight to its detail page
      const keys = new Set(this._filtered().map((b) => (b.wine || b.name) + '|' + String(b.vintage || 'NV')));
      if (keys.size === 1) {
        const b = this._filtered()[0];
        this._det = { wine: b.wine || b.name, vintage: String(b.vintage || 'NV'), step: 'view', reason: 'drank', sel: null, more: false, busy: false, err: '' };
      }
      this._renderDlg(); this._renderAll();
    },
    setopen() { this._det = null; this._set = true; this._renderDlg(); },
    setclose() { this._set = null; this._renderDlg(); },
    fvis(t) {
      const id = t.dataset.id;
      const hid = new Set(this._fh);
      if (hid.has(id)) hid.delete(id); else { hid.add(id); delete this._f[id]; }
      this._setFilters(this._fo, Array.from(hid));
      this._renderAll(); this._renderSet();
    },
    fdelask(t) {
      const dd = this._allDefs().find((x) => x.id === t.dataset.id);
      if (dd && dd.personal) { this._fdel = { id: dd.id, label: dd.label, n: this._data.bottles.filter((b) => b.p && b.p[dd.label]).length, busy: false }; this._renderDlg(); }
    },
    fdelno() { this._fdel = null; this._renderDlg(); },
    fdelyes() { this._delField(); },
    ivis(t) {
      const sh = new Set(this._is); sh.has(t.dataset.id) ? sh.delete(t.dataset.id) : sh.add(t.dataset.id);
      this._setInfo(this._infoDefs().filter((d) => !d.fixed).map((d) => d.id), Array.from(sh)); this._renderSet(); this._renderAll();
    },
    iup(t) { this._imove(t.dataset.id, -1); },
    idn(t) { this._imove(t.dataset.id, 1); },
    fup(t) { this._fmove(t.dataset.id, -1); },
    fdn(t) { this._fmove(t.dataset.id, 1); },
    rack(t) { this._setRack(t.dataset.n, t.dataset.k, t.dataset.v); },
    keepst(t) {
      const on = t.dataset.v === 'on';
      if (this._local.keepState !== undefined) { this._local.keepState = on; this._saveState(); }
      else { this._shared.keepState = on; this._saveSettings(); }
      this._renderSet();
    },
    flag(t) {
      this._local.flags = Object.assign({}, this._local.flags, { [t.dataset.id]: t.dataset.v === 'on' }); this._saveState(); this._renderSet(); this._renderAll(); this._renderDlg();
    },
    lang(t) {
      this._setLang(t.dataset.v || '');
      this._initLang().then(() => {
        if (this._raw) this._ingest(this._raw);
        this._renderAll(); this._renderSet();
      });
    },
    scope(t) {
      const k = t.dataset.k, L = this._local, dev = L[k] !== undefined;
      if (t.dataset.v === 'device' && !dev) L[k] = k === 'language' ? (this._langSel || '') : k === 'keepState' ? this._keep() : { filterOrder: this._fo.slice(), filterHidden: Array.from(this._fh) };
      else if (t.dataset.v === 'all' && dev) delete L[k];
      this._saveState();
      this._applyEff();
      this._initLang().then(() => {
        if (this._raw) this._ingest(this._raw);
        this._renderAll(); this._renderSet();
      });
    },
    scale(t) { this._scale = this._clampScale(Number(t.dataset.v) / 100); this._applyScale(); this._saveState(); this._renderDlg(); },
    wzopen() { this._wzOpen(); },
    chip(t) {
      const set = this._f[t.dataset.g];
      const v = t.dataset.v;
      if (set.has(v)) set.delete(v); else set.add(v);
      this._renderAll();
    },
    fdel(t) { this._f[t.dataset.g].delete(t.dataset.v); this._renderAll(); },
    pyes() { this._cfm = false; this._renderDlg(); this._refreshNow(); },
    pno() { this._cfm = false; this._renderDlg(); },
    az(t) {
      const a = this._listEl.querySelector(`.azanc[data-az="${t.dataset.k}"]`);
      if (a) this._listEl.scrollTo({ top: this._listEl.scrollTop + a.getBoundingClientRect().top - this._listEl.getBoundingClientRect().top, behavior: 'auto' });
      // The jump is not a touch/wheel scroll: fold the filters like a normal scroll so the way back up re-opens them
      if (a && this._more && this._listEl.scrollTop > 2) { this._more = false; this._autoFolded = true; this._renderHead(); }
    },
    toggle(t) {
      const id = t.dataset.id;
      if (this._open.has(id)) this._open.delete(id); else this._open = new Set([id]);
      this._renderList();
    },
    view(t) { this._view = t.dataset.v; this._saveState(); this._renderAll(); },
    more() { this._more = !this._more; this._autoFolded = false; this._manual = !this._more; this._renderHead(); },
    clearq() { this._f.q = ''; this._renderAll(); },
    reset() { this._f = { q: '' }; this._renderAll(); },
    reload() { this._refreshNow(); },
    reloadask() { if (!this._busy) { this._cfm = true; this._renderDlg(); } }, // like pulling down on the phone: ask first
  };

  if (!customElements.get('my-cellarion-card')) customElements.define('my-cellarion-card', CellarionBestandCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'my-cellarion-card',
    name: 'My Cellarion',
    description: 'Wine cellar inventory with search, filters, detail view and take-out (Cellarion).',
  });
})();
