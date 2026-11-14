/*
 * cellarion-cellar-card: browse your Cellarion wine cellar in Home Assistant.
 * Lists all bottles grouped by wine with their vintages, with search, filters (type, maturity, rack, vintage, producer,
 * region, grape and your own data fields), sorting and a flat view. Tap a vintage for details (your data, register profile,
 * storage places, note); "Take out" asks which bottle and why, then confirms before the bottle is consumed.
 *
 * Data comes from the services of the Cellar Card for Cellarion integration (cellarion_cellar_card.read and others). The Cellarion API token is
 * never sent to the browser.
 *
 * Configuration (YAML, all optional):
 *   type: custom:cellarion-cellar-card
 *   key: bestand                  # key for the remembered view and sorting (per browser)
 *   title: Wine cellar           # title above the card (default: none, the cellar name is shown by the page header)
 *   view: wine                    # start view: wine (grouped) or flat; the last choice is remembered
 *   refresh_seconds: 300          # re-read the cached inventory this often (default 300, 0 = never)
 *   refresh_on_open: true         # fetch fresh data from Cellarion when the card opens or becomes visible (at most once a minute)
 *   height: 600px                 # fixed height (default: fills the rest of the window)
 *   flush: true                   # no frame and border (for use inside a combined card)
 *   language: de                  # card language (default: language of the Home Assistant user); files in cellarion-i18n/<language>.json
 *   i18n_path: /cellarion-cellar-card-files/cellarion-i18n/   # folder with the language files
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
 * Source of truth: https://github.com/d3rb3rt/ha-cellarion-cellar-card
 */
(function () {
  // ---------- Language (i18n) ----------
  // Texts live in <path>/cellarion-i18n/<language>.json (flat, key -> text; plurals as {one, other}).
  // Language: config "language", otherwise the language of the HA user; a missing key falls back to English.
  // A new language is a new file <language>.json with the same keys (en.json is the reference).
  // Cache key of the language files: the same ?v=N as the card resource, so changes take effect at once
  const CARD_V = ((document.currentScript && /[?&]v=([\w.-]+)/.exec(document.currentScript.src)) || [])[1] || String(Date.now());
  // Folder the card was loaded from: cellarion-i18n/ lives next to it (works for /local/ and for the integration)
  // Data source of this file: 'dev' = own development setup, 'integration' = services of the Cellar Card for Cellarion integration (set by tools/sync_card.sh in the integration repo)
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
  const SCROLL_FOLD = false;
  // Cellarion bottle logo (cropped from the app logo, 24x60 px PNG) for the link to Cellarion in the detail dialog
  const CEL_LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAA8CAYAAAB8SnrYAAALGElEQVR42qVYSYxc13U95773f1X1UOxmDxzEQbYmaEhkSzTtSHFoeeEsLNhwYgIOEi8iQDbiRbz0khCQZZCNkUEOAmgRAwGYIAEUKwgSRaItRUMcy7YsihYVUhQlUaTY3eyu6pr+e/dk8as4yG1Jth5QqML/9d8d3znnfmLrRQD60vYb9yw28bmiGDocMDNYCAQyGPqxz+rl77yy9tTk/1ttFLe6eBiwo0DeVgw/Pt+e+TsUBSCAJCDAkTEzM423O5v/CKw9Nfn/VnvZVhdvG3uza6ZshQaSU0OnVxm5yswViH5/GDKqxhAAbzuytfeTVGyZngduWZjdyYUX0CxvGKZRBjlxRhLAUEI5r2z2Bvc+fOrUySOAPQT4B4lAALg37Biikc5JvoULhCQWIZRLS9siABzf2tmtU3QYsIeOHx/1h/2/cCWA1NVFpJDLYOwMeo/+2XMvvHwYCL9SDSZr5WJ3UKVcF/eKhyQF5RF6/UE18eiXrfc0sK05rWgFIOGqCAQBhRyN8YULFw7x1zJgiALDuxuiDscB8/r38vKyfi0DDhC67Lre3QkfZL2ngcFgQM8JBoICTPU3IYAC+f524vu6QAdo49RrnCMJ/sFiiO+dojz28ZoulQSCgPjeGXjfFCVmd/ikupeLLAI5ELIPmaIWIEIQ/NqyEgIM7s4PFcGGgoEEhRob6jBEFwmiKBrhQxmYW5jbFUOE3EWBFDQGDQqGVmtq/2GgdfToUcevgkWTNe3ll0sLE+cndSBIS/JM+YHFPR+5A4AOAeEDGTgClEeB/OCOxa+A/rkq5UyYUQRFUYSBdHcFstVq2hEAeLIGO3tPA18DioeA0QP7dnx+aWn7w1bQMpx1N7LGudoMAhgylBrN8vPfuH7HX3Ls3ZF37cmrIDocBfJXdy/ev7x9/u9ny0a70+85AQtmlCCSlx9wAkIE5Dkwx8EoP/L8K6f/9L+BzthxB+q88RAQHwPyN/fterC9beaRUJZTo+HQEcwMhJG4enMAEA2sO9dIpKmyvHu+3b47r+LRcxgMJs6Hw0B4DMhfv37Xg1Oz09+xsjT37DAGgDKQRnKMeRwTWt1IIMdcYdk1ahbhlu3N/LG7rPjX+7/1rdGxY8fqBx7ct/uedrv1H6EsG54y5G7jB2GqP794pLZoQKXUjF6c747+5uH/e/NPDgMhfO1uFFNY+Ha72bojj1IyIXICMhwj87uyU9/5xbZ3E1NgCq6P3xbw9Hc3h6esODd/IACf7QyGDiFStW+TQ8XLOYdUAxz1SwAikxyYYaoxW7aaC18HYBZY3DdVlNNWhgToaoV2DYPVDABoQqBb6h0DsiyDCEX85O/Nze2NU7MzH5NRcCfNQIGqFwVoUsV3qRaOEfCae4VnRCVz68oidm9rNq+PlbBMkpZxWVlBY9KqsU11n4JjxqnPBMAgUpB8zKtOADRI0SOtzOrviBXABmo6BApABqACOBIZCMaxMRPcASYYHQLgpCgHFAGploQeADOBxEzRDBEpKwJIMgKNcTUrWAEmBzrddTSaJbJnwTNHeUPNZqBxFkWIgBGoYh2ugCBHxURYQAQYQYkgwAxxCHFYP5OI7qiDW++8Thv9t/Cbd96OxaUZmAE/fP5FvHmmC2RoZeUS29NLgBvIK00MF3LIiIEBgqHykdyIWERc2thALInf/6N7deddN+nxJx63sg0sXNdSszGFmZNtfOHgAbWmm3jm2I91/CdrDGwiUCATCMjM0CgKGkHIBUG0MmJzOML2ndt04x2LWtgT8U7njLUXZ3HhYkehMYt3VjfRGzkac8L0nOO2u27m1HwECgExSkbZWDKMcqZNhKfRlHKCWwf3f/kgDv3ub+DJJ55BUUxr154d2ugInQ3w3LlVzC0s+vaFZa6tik899UP9wQP34fpbmuoMLo53r7s3CYxjmgVBDHqbOPCZG7CwO2LYH/GeTxzQ97/3v1hbyzz5yps4+aMzcM+cnWkj9Atl9njw4G2Ymsm667du5qunziIPMgMKZBecA5k0QS2jEjHbbiOWJVpT89q4OOLz3z/B10+sYybM07sNxFEbw1XxsX96mm+dXtUNH7ke3Y0eb7hpP268aT9ScpANSgbkGsudJKrRCLt37sbbb17Cvz16DD9/6Sz/83svoFUsqdEsIUqNVgMhmmIssLx0HV79+TmeOXUJ9AaOPfkDDHoD1XLSQRMcPs6YGapRD4vLDXzp8KfwiXtu5/88+wK63R6KRoFUZcAB1XKR7oJEzLYW+Oi//BdfOv4S9uzdoU8f+hRiNEJ+GcxtIqNoFYrmJjYH57WwMI2Fhe0EIuRGC3YtYNMBDiG5VynjrgO3Yve+GcSyokGg6lobNIYfEg4htgq0mvNEKtDZ6MmrEoayRmtS10Jbgii6pLVLa0op0VVJUN2YJMzqLgLksKKJ195Yx7PPvQw4sb5ClnFGEEEDNZmTa2ugIoASuSr45OMvoj3XRHfdSIQJscJCiSjV6Os5Y26+rT17d9IQ8OpPV5Uu9RBDwGgSwZWJnvAokQxGHPzk3di1bx5r5yv886tPQ3KGaMheeWQdE1wJ0zOB+/YvQZVQNjMG1SU0GktEuoY2WZdtPPZbwuxsgdZ0xmZTADNySrAYQJPF7PX0GaIhpaF63Q6QSVcFo+Q+0niomZDPlUhISkS308fMZtCwnxAtoCiiKKGqKkWNZUjOghA5t20RRGAZWiKikVFABjkecy7LuwwywKuA5575CaaOR6R+E6MqMZjonsAQFI0ml1DEhjZW+njhRycAh19aG9CKtpKXkEaAqHGRJY1VgBNmwKH77sXejy7z/Bt9/MOJf58AA5CBGIwGF5SdeeTorfeVHaCVSF4hmIkKvCr9V6VJoCWEIgmhy0ZTCmVAGmbRhBACok9Ochpi375l/M59BzgcZZw9/YTeOnsBjWKOoNdMbbzMy2AGGJCTcPbMBSII588OmKqM0hqUOTIyorxmcAuG/rCDTndFOZODqsNQZFkQBJscApI1mcgJIRIwP/Paaa52zmq40UCIET50WWAdASZvUwjEENBqTjFlodVsIaUV9PsdpCpd1hvujuwJRTRkJzbzOj/9mS9i/007ee61Pr770hNXZF8GIlBLBLOAbm+ICxfW1Ov1cfGdFTKQCzumMDNDbJ9fwNy2bWq2pjk91VLOFeXmnWGXszPTyhUBhbpGNp51JYt0UXI0W028euosLh59A9ftWeBvf/YO7Nu/S9sX2gxmkJfodcW11b5WL25yc3WoXrfP4Wikx0/9jFmuPAJDTnCLsmzgwBUNYKCh3x9g78178NU//gqLMqPKHVxceQMv/vSEXj99Aa+deRvrK0Mb9AHkAmUuOdHxhQWknFhEQ1mW9csxF+AZUaRnOZrNKVy6uIG//fYjsmCsqgE21tfR7znlJUIoUMYZzcaAUIa6W7MDBIoYkXOGCFQORZFEhVhC0TCe3iyi6mVsrnUJURJZFHOcazVFI9zHp1MCc4J73bUQkKtaFjsMsEDz4FCSBEYj1wPhVTY12GCraeP6eK06PRGeEUDEK7J1TDo+nmoJCTAaJEIeYCwpm9owBR4rJCvAxISsLPdcZc+VyyuHRg4lh5K7u+ByOGSSA+5i9ozsbtkdWSGnqjTEqqrOVCn9OOwfVSeJ6tb5Rnk7acYAU4DBYDSzyGDGYMZowYxmtBiMZsEYoyEW5maGEIwyNsCg4XC92137xl+/ff5ZAsAfbkf7uvbyN62Y+uLQ0MqhJhgTGGmMDJRPJgzVYGdSBSAbJWUFUUzZg+NnGgz/6s9fP/c0APt/KQHZiAGoYQkAAAAASUVORK5CYII=';
  const FLAGS = []; // experiments in test: {id, ...} (settings, "Test features", only shows while this is not empty); stat3: statistics with three areas (stock | archive | total); archgone: archive = wines with no bottle left (any vintage), drunk vintages of stock wines appear in the detail view
  const STATUS_KEYS = ['over', 'late', 'peak', 'early', 'notready'];
  const TYPES = [];
  const typeLbl = (k) => { if (!k) return ''; const v = t('type.' + k); return v === 'type.' + k ? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ') : v; }; // label of a wine type (Cellarion's value; no text: the name itself)
  const STATUS = [];
  // Price bands per bottle in the currency of the data (CUR): upper limit (inclusive) and key; the last one is open-ended
  const PRICE_DEFAULT = [10, 20, 30, 50, 75, 100]; // default upper limits; the setting "Price bands" (shared by all devices) replaces them
  let PRICE_BANDS = [];
  const bandsOk = (a) => Array.isArray(a) && a.length > 0 && a.length <= 12 && a.every((x, i) => typeof x === 'number' && x > 0 && (i === 0 || x > a[i - 1]));
  const setBands = (a) => { const off = Array.isArray(a) && !a.length, l = bandsOk(a) ? a : PRICE_DEFAULT; PRICE_BANDS = off ? [] : l.map((x) => [x, 'p' + x]).concat([[Infinity, 'pmax']]); }; // [] = price filter off
  setBands();
  const PRICE = [];
  let CUR = ''; // currency of the prices: the one most bottles use (set in _ingest)
  const moneyTxt = (v) => { try { return new Intl.NumberFormat(I18N.lang || 'en', { style: 'currency', currency: CUR, maximumFractionDigits: 0 }).format(v); } catch (e) { return v + ' ' + CUR; } };
  const priceLbl = (i) => { const max = PRICE_BANDS[i][0]; return i === 0 ? t('price.upTo', { n: moneyTxt(max) }) : max === Infinity ? t('price.over', { n: moneyTxt(PRICE_BANDS[i - 1][0]) }) : t('price.range', { a: PRICE_BANDS[i - 1][0], b: moneyTxt(max) }); };
  const setPrice = () => { PRICE.length = 0; PRICE_BANDS.forEach(([, k], i) => PRICE.push([k, priceLbl(i)])); };
  const priceKey = (b) => {
    if (typeof b.price !== 'number' || !(b.price > 0) || (b.currency && b.currency !== CUR)) return '';
    return (PRICE_BANDS.find(([max]) => b.price <= max) || [, ''])[1];
  };
  const STATUS_LABEL = {};
  let NO_LOC = 'Ohne Platz';
  let de = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  const applyLang = (lang, dict) => {
    I18N.lang = lang;
    I18N.dict = dict;
    I18N.pr = new Intl.PluralRules(lang);
    de = new Intl.Collator(lang, { sensitivity: 'base', numeric: true });
    STATUS.length = 0;
    TYPES.forEach((x) => { x[1] = typeLbl(x[0]); }); // the types themselves come from the data (see _ingest)
    STATUS_KEYS.forEach((k) => { STATUS.push([k, t('status.' + k)]); STATUS_LABEL[k] = t('status.' + k); });
    setPrice();
    STATUS_LABEL.window = t('status.window');
    STATUS_LABEL.unknown = t('status.unknown');
    STATUS_LABEL.drunk = t('status.drunk');
    NO_LOC = t('loc.none');
  };
  const STATUS_RANK = { over: 0, late: 1, peak: 2, window: 3, early: 4, notready: 5, unknown: 6, drunk: 7 };

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Generic link recognition on ALREADY ESCAPED html: only http(s) URLs outside of tags become links (no javascript:/data:), shown as host, full address in the tooltip.
  const linkify = (html) => String(html == null ? '' : html).split(/(<[^>]*>)/).map((part, i) => i % 2 ? part : part.replace(/https?:\/\/(?:(?!&(?:lt|gt|quot|#39);)[^\s<>"'])+/g, (m) => {
    const tail = (m.match(/[.,;:!?)\]]+$/) || [''])[0], url = tail ? m.slice(0, -tail.length) : m;
    let host = url; try { host = new URL(url.replace(/&amp;/g, '&')).hostname.replace(/^www\./, ''); } catch (e) { /* keep the address */ }
    return `<a class="dlink" href="${url}" target="_blank" rel="noopener noreferrer" title="${url}">${host}</a>${tail}`;
  })).join('');
  const norm = (s) =>
    String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');

  // ---- Info texts: personal wine fields "info:<attribute>" (text for the VALUE of that attribute) ----
  // Sort criteria with two directions: [natural, reversed]; SORT_BASE maps every sort value to its menu entry, SORT_ARROW shows the direction of the values
  const SORT_PAIR = { name: ['name', 'nameDesc'], producer: ['producer', 'producerDesc'], region: ['region', 'regionDesc'], drinkTo: ['drinkTo', 'drinkToDesc'], vintage: ['vintage', 'vintageAsc'], price: ['priceAsc', 'priceDesc'], count: ['countDesc', 'countAsc'], added: ['added', 'addedAsc'] };
  const SORT_BASE = {}; Object.keys(SORT_PAIR).forEach((k) => SORT_PAIR[k].forEach((v) => { SORT_BASE[v] = k; }));
  const SORT_ARROW = { name: '↑', nameDesc: '↓', producer: '↑', producerDesc: '↓', region: '↑', regionDesc: '↓', drinkTo: '↑', drinkToDesc: '↓', vintage: '↓', vintageAsc: '↑', priceAsc: '↑', priceDesc: '↓', countDesc: '↓', countAsc: '↑', added: '↓', addedAsc: '↑' };
  const BOTTLE_ROWS = [['bprice', 'det.price'], ['bdate', 'det.purchaseDate'], ['bshop', 'det.shop'], ['burl', 'det.purchaseUrl'], ['bsize', 'det.size'], ['brating', 'det.rating'], ['bocc', 'det.occasion'], ['bord', 'det.onOrder']]; // bottle data rows of the detail (flag detrows), in the order of the rows array of _viewV2
  const WINE_ATTR = ['producer', 'country', 'region', 'appellation', 'grape']; // info attributes that have their value in a Cellarion wine field (see _infoVal)
  // Defaults as long as nothing is saved (settings that exist are never touched): filters on, info in the list, details behind the arrow / off
  const DEF_FILTERS = ['types', 'status', 'vintage', 'country', 'region', 'grape', 'producer', 'price', 'racks'];
  const DEF_SHOW = ['region', 'grape', 'price', 'more:country', 'more:bprice', 'more:bdate', 'more:bshop', 'more:burl', 'more:bsize', 'off:bocc', 'off:bord'];
  const KIND_REST = 'other'; // kind of a classification tier Cellarion does not list (and Cellarion's own catch-all kind)
  const clsLbl = (k) => { const v = t('cls.' + k); return v === 'cls.' + k ? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ') : v; }; // label of a classification kind
  const INFO_CLICK = 'cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px';
  const infoNorm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/[\s-]+/g, '_');
  const isInfoKey = (k) => /^info:/i.test(String(k));
  const infoLbl = (k) => { const v = t('info.lbl.' + k); return v === 'info.lbl.' + k ? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ') : v; };
  // {attribute: text} from the personal fields of a bottle
  const infoMap = (pf) => {
    const m = {};
    Object.keys(pf || {}).forEach((k) => { const x = /^info:\s*(.+)$/i.exec(k); if (x && pf[k]) m[infoNorm(x[1])] = pf[k]; });
    return m;
  };

  // Search: a term matches at the start of a word (prefix), not in the middle ("lanc" does not find "Blancs"); n = normalized text
  const wordAt = (n, t, from) => { let at = n.indexOf(t, from || 0); while (at > 0 && /[\p{L}\p{N}]/u.test(n[at - 1])) at = n.indexOf(t, at + 1); return at; };
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
    /* Appearance per device: Auto follows the HA theme, light/dark fix the card colours */
    :host([data-mode="dark"]) ha-card { background: #1c1c1c; color: #e6e6e6; }
    :host([data-mode="light"]) ha-card { background: #ffffff; color: #1f1f1f; }
    :host([data-mode="dark"]) .wrap { --cb-text: #e6e6e6; --cb-sub: #a0a0a0; --cb-line: rgba(255,255,255,.14); --cb-chip: rgba(255,255,255,.14); --cb-seg: rgba(255,255,255,.14); --cb-ring: rgba(255,255,255,.45); --cb-card: #1c1c1c; --cb-on: #03a9f4; --cb-on-text: #fff; }
    :host([data-mode="light"]) .wrap { --cb-text: #1f1f1f; --cb-sub: #666666; --cb-line: rgba(0,0,0,.14); --cb-chip: rgba(0,0,0,.08); --cb-seg: rgba(0,0,0,.08); --cb-ring: rgba(0,0,0,.4); --cb-card: #ffffff; --cb-on: #0288d1; --cb-on-text: #fff; --w-white: #cdb93d; --w-sparkling: #b5a032; }
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
      --w-other: var(--cellarion-wine-other, #8d9199);
      --s-notready: var(--cellarion-maturity-notready, var(--info-color, #5b8def));
      --s-early: var(--cellarion-maturity-early, #3cc8c0);
      --s-peak: var(--cellarion-maturity-peak, var(--success-color, #2fa84f));
      --s-late: var(--cellarion-maturity-late, var(--warning-color, #e8a33d));
      --s-over: var(--cellarion-maturity-over, var(--error-color, #d9534f));
      --s-window: var(--cellarion-maturity-peak, var(--success-color, #2fa84f));
      --cb-hl: color-mix(in srgb, var(--warning-color, #ffc107) 38%, transparent);
      --s-unknown: var(--cb-ring);
      --s-drunk: var(--cellarion-maturity-drunk, #a98bd8);
      display: flex; flex-direction: column; flex: 1; min-height: 0; color: var(--cb-text);
      font-size: var(--cb-row-font, 14px);
    }
    .head { padding: 10px 12px 6px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--cb-line); }
    .top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .title { font-size: var(--cb-title-font, 18px); font-weight: 600; margin-right: 8px; }
    .cname .sel.cnsel { min-height: var(--cb-chip-h, 40px); max-width: 100%; padding: 0 8px 0 14px; border: 1px solid color-mix(in srgb, var(--cb-on) 45%, transparent); background: color-mix(in srgb, var(--cb-on) 14%, transparent); box-shadow: none; font-size: 16px; font-weight: 700; letter-spacing: .02em; text-overflow: ellipsis; } /* cellar name as a pulldown (several cellars): tinted pill, set apart from the outlined filter pills */
    .ctag { display: inline-block; margin-right: 6px; padding: 0 6px; border: 1px solid var(--cb-line); border-radius: 8px; font-size: .85em; font-weight: 500; color: var(--cb-sub); } /* cellar tag in front of a place (all cellars together) */
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
    .search input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; display: none; } /* the card has its own clear button */
    /* flag hdr2: the search stands out (lighter fill, stronger border); color-mix follows the theme text color, so it also works in light themes */
    :host([data-hdr2]) .search input { background: color-mix(in srgb, var(--cb-text) 22%, var(--cb-card)); border-color: color-mix(in srgb, var(--cb-text) 30%, transparent); padding-left: 40px; }
    :host([data-hdr2]) .search::before {
      content: ''; position: absolute; left: 14px; top: 50%; width: 17px; height: 17px; transform: translateY(-50%); pointer-events: none; z-index: 1;
      background: color-mix(in srgb, var(--cb-text) 75%, transparent);
      -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round'%3E%3Ccircle cx='10.5' cy='10.5' r='6.5'/%3E%3Cpath d='M15.5 15.5L21 21'/%3E%3C/svg%3E") center / contain no-repeat;
      mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round'%3E%3Ccircle cx='10.5' cy='10.5' r='6.5'/%3E%3Cpath d='M15.5 15.5L21 21'/%3E%3C/svg%3E") center / contain no-repeat;
    }
    :host([data-hdr2]) .search input::placeholder { color: color-mix(in srgb, var(--cb-text) 62%, transparent); }
    :host([data-hdr2]) .search input:focus { border-color: var(--cb-on); }
    :host([data-hdr2]) .search.has input { border-color: var(--cb-on); box-shadow: 0 0 0 1px var(--cb-on) inset; } /* active search: ring like an active filter, also without focus */
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
    /* Filter mode OR (green) / NOT (red): chosen filters and their pills take the mode colour instead of the accent (theme: cellarion-fm-or / cellarion-fm-not) */
    :host([data-fm="or"]) { --cb-fm: var(--cellarion-fm-or, var(--success-color, #2fa84f)); }
    :host([data-fm="not"]) { --cb-fm: var(--cellarion-fm-not, var(--error-color, #d9534f)); }
    :host([data-fm]) button.sel.hasv { color: var(--cb-fm); box-shadow: 0 0 0 1px var(--cb-fm) inset; }
    .fwrap .sel.fs.fm { border: 1px dashed color-mix(in srgb, var(--cb-text) 55%, transparent); background: color-mix(in srgb, var(--cb-text) 8%, transparent); font-weight: 600; } /* the filter mode pulldown is set apart from the filters: dashed edge, light tint */
    :host([data-fm]) .fwrap .sel.fs.fm { border-color: var(--cb-fm); }
    :host([data-fm]) .fpill { background: color-mix(in srgb, var(--cb-fm) 18%, var(--cb-chip)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--cb-fm) 55%, transparent) inset; }
    button.sel { width: auto; flex: none; display: inline-flex; align-items: center; justify-content: space-between; gap: 6px; text-align: left; color: var(--cb-text); font-family: inherit; cursor: pointer; white-space: nowrap; overflow: hidden; }
    button.sel::after { content: ''; flex: none; width: 6px; height: 6px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(45deg) translateY(-2px); opacity: .7; margin-right: 4px; }
    button.sel.dis { opacity: .4; cursor: default; pointer-events: none; } /* filter has no options right now */
    button.sel.more-pill { opacity: .75; }
    button.sel.more-pill.open::after { content: '✕'; width: auto; height: auto; border: 0; transform: none; font-size: 12px; margin-right: 2px; }
    /* Filter and sort pick list: opens right under the chip (transparent backdrop only catches the click outside) */
    .dlg.dd { display: block; background: transparent; }
    .ddpop { position: absolute; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; border-radius: 6px; background: color-mix(in srgb, var(--cb-text) 14%, var(--cb-card)); border: 1px solid color-mix(in srgb, var(--cb-text) 40%, transparent); box-shadow: 0 6px 18px rgba(0, 0, 0, .45); }
    .ddpop.c { top: 50%; left: 50%; width: min(300px, calc(100% - 32px)); transform: translate(-50%, -50%); max-height: 70%; }
    .ddpop .ddsel { display: flex; align-items: center; gap: 8px; flex: none; padding: 7px 12px; font-size: 13px; color: var(--cb-text); background: color-mix(in srgb, var(--cb-on) 14%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--cb-text) 18%, transparent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ddpop .ddselt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .ddpop .ddx { flex: none; width: 28px; height: 28px; min-width: 0; min-height: 0; padding: 0 0 2px; border: 0; border-radius: 50%; background: transparent; color: var(--cb-text); font-size: 20px; line-height: 1; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .ddpop .ddx:hover { background: color-mix(in srgb, var(--cb-text) 14%, transparent); }
    .ddpop .ddhint { flex: none; padding: 6px 12px; font-size: 12px; color: var(--cb-sub); border-bottom: 1px solid color-mix(in srgb, var(--cb-text) 18%, transparent); }
    .ddpop .ddlist { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
    .ddi { display: flex; align-items: center; width: 100%; min-height: 44px; padding: 8px 12px; box-sizing: border-box; border: 0; border-top: 1px solid var(--cb-line); background: transparent; color: var(--cb-text); font: inherit; text-align: left; cursor: pointer; }
    .ddi:active { background: var(--cb-chip); }
    .ddi.cur { font-weight: 600; color: var(--cb-on); }
    .ddsep { height: 6px; border-top: 1px solid var(--cb-line); }
    /* The filter and sort pick list looks like the settings dropdown list: own surface, visible border, rows of the same height with thin separators */
    .ddpop .ddi { min-height: 40px; border-top: 0; border-bottom: 1px solid color-mix(in srgb, var(--cb-text) 18%, transparent); }
    .ddpop .ddi:last-child { border-bottom: 0; }
    .ddpop .ddsep { height: 0; border-top: 0; border-bottom: 2px solid color-mix(in srgb, var(--cb-text) 40%, transparent); }
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
    /* native scrollbar hidden: HA sets scrollbar-color/-width globally, so webkit styling is ignored; a thin indicator (.sbi) is drawn instead */
    .list { scrollbar-width: none; }
    .list::-webkit-scrollbar { display: none; }
    .wrap { position: relative; }
    .sbi { position: absolute; width: 3px; border-radius: 2px; background: color-mix(in srgb, var(--cb-sub) 55%, transparent); pointer-events: none; opacity: 0; transition: opacity .2s; }
    .list { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; touch-action: pan-y; overscroll-behavior-y: contain; }
    .tdot {
      display: inline-block; width: 11px; height: 11px; border-radius: 50%; flex: none;
      box-shadow: 0 0 0 1.5px var(--cb-ring); background: var(--cb-ring);
    }
    .sdot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--cb-ring); }
    .wine { border-bottom: 1px solid var(--cb-line); }
    /* flag history: drunk entries (from the consumption log) are dimmed and not tappable */
    .hrow { cursor: pointer; }
    .hrow > .vmid, .hrow > .fmid { opacity: .62; }
    .yv.hv { font-style: italic; font-weight: 600; color: var(--cb-text); }
    .wine.hist > .wrow .wname, .frow.hrow .wname { color: var(--s-drunk); } /* a wine that is only drunk: its name in the warning colour */
    button.sel.swp { gap: 7px; justify-content: flex-start; padding-right: 12px; }
    button.sel.swp::after { content: none; } /* no pull-down arrow: it is a switch */
    .swp .swt { position: relative; flex: none; width: 24px; height: 14px; border-radius: 7px; background: color-mix(in srgb, var(--cb-sub) 45%, transparent); transition: background .15s; }
    .swp .swt i { position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%; background: var(--cb-text); transition: transform .15s; }
    .swp.on .swt { background: var(--s-drunk); }
    :host([data-arch]:not([data-fm])) .fwrap, :host([data-arch]:not([data-fm])) .fpills { --cb-on: var(--s-drunk); } /* archive on: highlight colour of the filter pills */
    button.sel.fs.swp.on, :host([data-fm]) button.sel.fs.swp.on { box-shadow: 0 0 0 1px var(--s-drunk) inset; }
    .fwrap .sel.fs.swp.on { border-color: var(--s-drunk); color: var(--s-drunk); background: color-mix(in srgb, var(--s-drunk) 14%, transparent); } /* archive on: the colour of the drunk wines */
    .fpill.hpill, :host([data-fm]) .fpill.hpill { border-color: var(--s-drunk); color: var(--s-drunk); background: color-mix(in srgb, var(--s-drunk) 14%, transparent); }
    .swp.on .swt i { transform: translateX(10px); }
    .hempty { margin: 10px 0 2px; padding: 10px 12px; border: 1px dashed var(--s-drunk); border-radius: 10px; background: color-mix(in srgb, var(--s-drunk) 12%, transparent); }
    .hempty b { display: block; margin-bottom: 4px; color: var(--s-drunk); }
    .hempty .dpur { display: block; margin-top: 2px; }
    .hempty.dsec { margin-top: 14px; }
    .d2top .d2sub { color: var(--cb-text); font-weight: 700; font-size: 1.05em; }
    .d2top { position: relative; }
    .d2sub.dlink { border: 0; background: none; padding: 0; font: inherit; font-size: 1em; cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px; }
    .dnpop { position: absolute; left: 0; right: 0; top: 100%; z-index: 8; margin-top: 4px; max-height: 40vh; overflow-y: auto; padding: 10px 12px; border: 1px solid var(--s-drunk); border-radius: 10px; background: var(--cb-card); box-shadow: 0 6px 20px rgba(0,0,0,.45); cursor: pointer; }
    .dnitem + .dnitem { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--cb-line); }
    .dnitem b { display: block; color: var(--s-drunk); font-weight: 600; margin-bottom: 2px; }
    .dnitem span { white-space: pre-line; color: var(--cb-text); font-weight: 400; }
    .d2top .d2sub.dgone { color: var(--s-drunk); font-weight: 600; font-size: 1em; }
    .vbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; }
    .d2top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 14px; margin: 4px 0 0; }
    .dsheet > .dh.dhs .dx { height: 28px; margin: -2px -12px 0 0; }
    .vbar .vlbl { font-size: .85em; color: var(--cb-muted, var(--secondary-text-color)); margin-right: 2px; }
    .vchip { padding: 3px 10px; border: 1px solid var(--cb-line); border-radius: 14px; background: none; color: var(--cb-text); font: inherit; font-size: .9em; cursor: pointer; }
    .vchip.gone { border-color: var(--s-drunk); color: var(--s-drunk); background: color-mix(in srgb, var(--s-drunk) 12%, transparent); }
    .dsech { margin-top: 6px; padding: 4px 0; border: 0; background: none; color: var(--s-drunk); font: inherit; cursor: pointer; text-align: left; }
    .hrow .hinfo, .hinfo { color: var(--cb-sub); font-size: .9em; white-space: nowrap; }
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
    /* wide view: location in the expanded vintages left-aligned (formerly flag vlocl) */
    @media (min-width: 601px) {
      :host .vrow .vmid { align-items: flex-start; text-align: left; }
      :host .vrow .locs { justify-content: flex-start; }
      :host .vrow .vprl::before { content: none; }
    }
    .dh .wtitle { flex-wrap: wrap; gap: 0 6px; }
    .dh .wprod { white-space: normal; }
    .dsheet > .dh .wl1 { display: block; }
    .dsheet > .dh .wl1 > .wit { display: inline; }
    .dsheet > .dh .wl1 > .wname.d::after { display: none; } /* no dot: it stayed at the end of the line when the producer wrapped */
    .dsheet > .dh .wl1 > .wprod { display: inline; margin-left: .6em; font-size: 1.05em; font-weight: 600; }
    .dsheet > .dh .wl1 > .wprod::before { content: '·'; margin: 0 .5em 0 .1em; color: var(--cb-sub); font-weight: 400; } /* the dot belongs to the producer: it wraps with it and never hangs at the end of the name */
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
    .fpills .btn.round.sm[data-reset] { width: 26px; height: 26px; min-height: 26px; padding: 0; font-size: 11px; line-height: 1; }
    .fpills { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .fpills:not(:has(> :not([hidden]))) { display: none; }
    .fpills button[hidden] { display: none; }
    .fgrp { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px; border: 1px solid color-mix(in srgb, var(--cb-text) 40%, transparent); border-radius: 16px; }
    .ddpop .ddrow { display: flex; align-items: stretch; border-bottom: 1px solid color-mix(in srgb, var(--cb-text) 18%, transparent); }
    .ddpop .ddrow .ddi { flex: 1 1 auto; border-bottom: 0; min-width: 0; }
    .ddpop .ddand small { font-size: 11px; font-weight: 400; margin-left: 2px; }
    .ddpop .ddrow .ddi { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; line-height: 40px; padding-top: 0; padding-bottom: 0; }
    .ddpop .ddand { flex: none; align-self: center; margin: 0 10px 0 4px; min-height: 28px; padding: 0 9px; border: 1px solid color-mix(in srgb, var(--cb-text) 45%, transparent); border-radius: 14px; background: var(--cb-chip); color: var(--cb-text); font: inherit; font-size: 16px; font-weight: 700; line-height: 26px; white-space: nowrap; cursor: pointer; }
    .ddpop .ddrow .ddi { padding-left: 12px; }
    .ddpop .ddand:active { background: color-mix(in srgb, var(--cb-text) 25%, var(--cb-chip)); }
    .fand { font-size: 12px; color: var(--cb-sub); padding: 0 2px; }
    .fpill { min-height: 26px; padding: 0 4px 0 10px; border-radius: 14px; background: var(--cb-chip); font-size: 12px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
    .fpill.fmpill { font-weight: 700; letter-spacing: .04em; }
    .fpill .x { width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; opacity: .65; font-size: 11px; }
    mark.hl { background: var(--cb-hl); color: inherit; border-radius: 3px; padding: 0 1px; }
    .tsp { flex: none; display: inline-block; vertical-align: middle; width: 22px; height: 22px; }
    .azanc { display: block; height: 0; }
    @media (min-width: 601px) { :host([data-fullw]) .az { justify-content: space-between; } } /* flag fullw: the letters spread over the whole width */
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
    .d2hero.noimg .d2mine { border-left: 0; padding-left: 0; } /* the separator line is only needed next to the photo */
    .d2hero.noimg .d2main { margin-left: 32px; } /* no label photo: data rows start under the wine name (glass icon + gap of the header) */
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
    .rm-row { display: flex; gap: 14px; align-items: flex-start; }
    .rm-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
    .rmap { flex: none; display: flex; flex-direction: column; gap: 8px; }
    .rmap .rm-head { display: flex; align-items: center; justify-content: center; gap: 6px; margin-bottom: 3px; }
    .rmap .rm-head .rm-name { margin: 0; font-size: .85em; color: var(--cb-text); white-space: nowrap; }
    .rm-row.rm-bigrow { align-items: flex-start; }
    .rm-bigrow .rm-col { gap: 10px; }
    .rmap.big { --rc: 18px; }
    .rmap.big .rm-lane { gap: 2px; }
    .rmap.big .rm-lanes { gap: 2px; }
    .rmap.big .rm-c { width: 18px; height: 18px; border-width: 2px; }
    .rbtn { display: inline-flex; align-items: center; justify-content: center; }
    .rbtn[aria-pressed="true"] { background: var(--cb-on); color: var(--cb-on-text); }
    .rmap .rm-head { width: 100%; }
    .rmap .rm-dots { display: flex; justify-content: center; gap: 5px; margin-top: 4px; }
    .rmap .rm-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--cb-line); }
    .rmap .rm-dots i.on { background: var(--cb-on); }
    .rmap .rm-head .rm-name { flex: 1; text-align: center; }
    .rmap .rm-nav { flex: none; width: 32px; height: 32px; min-width: 0; min-height: 0; padding: 0 0 3px; display: inline-flex; align-items: center; justify-content: center; font-size: 1.3em; line-height: 1; background: var(--cb-chip); color: var(--cb-text); border: 0; border-radius: 8px; cursor: pointer; }
    .rbtn[aria-pressed="true"] { background: var(--cb-on); color: var(--cb-on-text); }
    @media (max-width: 600px) { .d2act .clink > span { display: none; } .d2act .clink { padding-left: 12px; padding-right: 12px; } }
    .rmap.big .rm-n { font-size: .8em; }
    .rmap .rm-name { font-size: .7em; color: var(--cb-sub); margin-bottom: 3px; text-align: center; }
    .rmap .rm-rack { display: flex; flex-direction: column; gap: 3px; width: max-content; border: 1px solid var(--cb-line); border-radius: 6px; padding: 4px; }
    .rmap .rm-shelf { display: flex; align-items: stretch; gap: 4px; }
    .rmap .rm-n { flex: none; width: 1em; text-align: right; font-size: .6em; color: var(--cb-sub); align-self: center; }
    .rmap .rm-lanes { display: flex; flex-direction: column; gap: 1px; border-bottom: 2px solid var(--cb-line); padding-bottom: 2px; }
    .rmap .rm-lane { display: grid; gap: 1px; }
    .rmap .rm-c { width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--cb-line); box-sizing: border-box; }
    .rmap .rm-c.f { background: color-mix(in srgb, var(--cb-text) 30%, transparent); border-color: transparent; }
    .rmap .rm-c.m { background: color-mix(in srgb, var(--cb-on) 55%, transparent); border-color: var(--cb-on); }
    .rmap .rm-c[data-act] { cursor: pointer; }
    .rmap .rm-c.s { background: var(--cb-on); border-color: var(--cb-on); box-shadow: 0 0 0 2px color-mix(in srgb, var(--cb-on) 40%, transparent); }
    .d2h { font-size: .7em; letter-spacing: .06em; text-transform: uppercase; color: var(--cb-sub); }
    .d2ne { display: inline-block; margin-left: 4px; font-size: .8em; color: var(--cb-sub); border: 1px solid var(--cb-line); border-radius: 8px; padding: 0 4px; vertical-align: middle; }
    .d2act { align-items: stretch; flex-wrap: nowrap; justify-content: space-between; }
    .d2act .btn { flex: none; align-self: center; }
    .d2sel { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; padding: 4px 8px 4px 12px; min-height: 48px; border: 1px solid var(--cb-line); border-radius: 12px; }
    .d2st .loc, .d2st .d2sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .d2st .bi { display: none; }
    .d2st { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; }
    .wvj { margin-right: .15em; }
    .d2moreb { display: inline-flex; align-items: center; gap: 6px; margin: 8px 0 0; padding: 5px 14px; border: 1px solid var(--cb-line); border-radius: 14px; background: transparent; color: var(--cb-text); font: inherit; font-size: .9em; cursor: pointer; }
    .d2moreb:hover { background: var(--cb-chip); }
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
    .statsheet .stathead { position: sticky; top: -16px; z-index: 5; background: var(--cb-card); margin: -16px -16px 0; padding: 16px 16px 8px; display: flex; flex-direction: column; gap: 10px; }
    .statsheet .dh { align-items: center; }
    .shero { display: flex; flex-direction: column; align-items: center; padding: 4px 0 2px; }
    .sbig { font-size: 1.5em; font-weight: 700; color: var(--cb-text); line-height: 1.1; }
    .sbig.sm { font-size: 1.05em; line-height: 1.3; }
    .sbig.huge { font-size: 3.2em; color: var(--cb-on); }
    .sbig.val { color: var(--cb-on); }
    .slbl { font-size: .75em; letter-spacing: .06em; text-transform: uppercase; color: var(--cb-sub); }
    .sgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .stile, .smini { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 12px 8px; border: 1px solid var(--cb-line); border-radius: 12px; background: var(--cb-chip); color: var(--cb-text); font: inherit; cursor: pointer; min-width: 0; }
    .stile.wide { width: 100%; }
    .stile.nav { border-bottom: 3px solid var(--cb-on, #03a9f4); } /* main navigation tiles (Total page: stock / drunk) */
    .stile.nav .slbl { color: var(--cb-on, #03a9f4); }
    .stile.nav.arch { border-bottom-color: var(--s-drunk); }
    .stile.nav.arch .slbl { color: var(--s-drunk); }
    .stile.st, .srow.st { cursor: default; }
    .stile.st:active, .srow.st:active { background: var(--cb-chip); }
    .srow.st:active { background: transparent; }
    .statsheet[data-sc="arch"] .sbig.huge, .statsheet[data-sc="arch"] .sbig.val { color: var(--s-drunk); }
    .statsheet[data-sc="arch"] .sbf { background: var(--s-drunk); }
    .sbt.two { display: flex; }
    .sbt.two .sbf { flex: none; border-radius: 0; }
    .smini { align-items: flex-start; padding: 8px 12px; }
    .smini .sval { font-weight: 600; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .stile:active, .smini:active, .sbar:active, .srow:active { background: var(--cb-line); }
    .sbars, .slist { display: flex; flex-direction: column; }
    .sbar, .srow { display: grid; align-items: center; gap: 10px; width: 100%; padding: 6px 4px; border: 0; background: transparent; color: var(--cb-text); font: inherit; text-align: left; cursor: pointer; border-radius: 8px; }
    .sbar { grid-template-columns: 16px 64px 1fr 40px; }
    .sbar2 { grid-template-columns: 16px 64px 1fr 7em; }
    .sbc2 { display: grid; grid-template-columns: 1fr .4em 1fr; column-gap: .4em; text-align: center; } /* the separator dot sits on one line in all rows */
    .sbc2 > :first-child { text-align: right; }
    .sbc2 > :last-child { text-align: left; } /* same width for the count column, so all bars are equally long */
    .sbar2 .sbc { white-space: nowrap; }
    .sbar.st { cursor: default; }
    .sbar.st:active { background: transparent; }
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
    /* Phone: reserve room at the bottom for the Android navigation bar (a web page cannot tell whether it is on): the list scrolls past it and the detail sheet ends above it */
    @media (max-width: 600px) {
      .dlg { bottom: max(env(safe-area-inset-bottom, 0px), var(--safe-area-inset-bottom, 0px), 40px); }
    }
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
    /* wide view: the header of the detail (wine name) stays visible while the content scrolls */
    @media (min-width: 601px) { .dsheet > .dh.dhs { position: sticky; top: -16px; z-index: 5; background: var(--cb-card); margin: -16px -16px 0; padding: 16px 16px 8px; } }
    .dsheet::-webkit-scrollbar { width: 5px; }
    .dsheet::-webkit-scrollbar-thumb { background: var(--cb-sub); border-radius: 3px; }
    .dh { display: flex; align-items: flex-start; gap: 10px; }
    .dh .wmain { flex: 1; }
    .dh .wname { white-space: normal; font-size: 1.2em; }
    .dh .wsub { white-space: normal; }
    .clink { display: inline-flex; align-items: center; gap: 8px; text-decoration: none; color: var(--cb-text); }
    .clink .clogo { display: block; height: 22px; width: auto; }
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
    .slist.fx .srow { grid-template-columns: minmax(0, 1.4fr) minmax(40px, 1fr) 9.5em; } /* longer count texts: fixed column, so all bars are equally long and the texts start in one line */
    .slist.fx .srow .sbc { text-align: left; }
    .srow .srn { color: var(--cb-sub); font-size: .9em; line-height: 1.3; min-width: 0; overflow-wrap: anywhere; }
    .srow.flat .sbt { visibility: hidden; } /* equal counts: no bar */
    .dlink { color: var(--cb-on); text-decoration: underline; text-underline-offset: 2px; word-break: break-all; }
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
    .wzv2 .row-chips { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .wzv2 .wzq { flex: 1 1 180px; min-width: 0; min-height: 38px; box-sizing: border-box; border-radius: 6px; border: 1px solid var(--cb-line); background: var(--cb-card); color: var(--cb-text); padding: 0 10px; font-size: inherit; outline: none; }
    .wzv2 .wzq:focus { border-color: var(--cb-on); }
    .wzv2 .opt { display: flex; align-items: center; gap: 10px; min-height: 34px; cursor: pointer; }
    .wzv2 .opt input { width: 20px; height: 20px; margin: 0; flex: none; accent-color: var(--cb-on); cursor: pointer; }
    .wzv2 .wzrow { padding: 6px 0; gap: 6px; }
    .wzv2 .wzwords { gap: 6px; flex: 1 1 auto; }
    .wzv2 .wzw { min-height: 32px; padding: 0 10px; border-radius: 6px; background: transparent; border: 1px solid var(--cb-line); font-size: inherit; }
    .wzv2 .wzw.on { background: var(--cb-on); border-color: var(--cb-on); color: var(--cb-on-text); font-weight: 600; }
    .gear { margin-left: auto; color: var(--cb-sub); }
    .frow { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-top: 1px solid var(--cb-line); }
    .frow .wmain { flex: 1; }
    .frow .btn.round { width: 36px; min-height: 36px; font-size: 16px; }
    .frow.off .wname { opacity: .5; }
    .dh + .sblk { border-top: 0; padding-top: 4px; }
    /* Settings page: description column left, control column right (fixed proportions), plain controls */
    .setv2 .sgrp { display: flex; align-items: center; gap: 14px; margin-top: 28px; font-size: 1.1em; font-weight: 600; letter-spacing: .02em; color: var(--cb-on); }
    .setv2 .sgrp::before, .setv2 .sgrp::after { content: ''; flex: 1; height: 1px; background: color-mix(in srgb, var(--cb-on) 40%, transparent); }
    .setv2 .sethead { position: sticky; top: -16px; z-index: 5; background: var(--cb-card); margin: -16px -16px 0; padding: 16px 16px 8px; display: flex; flex-direction: column; gap: 10px; }
    .setv2 .shead.fixed { position: static; display: flex; align-items: flex-start; gap: 10px; padding: 12px 0 4px; border-bottom: 0; background: transparent; }
    .setv2.setfix { height: 92%; } /* flag setviews: fixed height, so the pills do not jump when the content of a group is shorter or longer */
    .setv2 .setnav { margin: 0; padding-bottom: 0; flex-wrap: wrap; overflow: visible; gap: 6px; } /* all pills visible, wrap instead of a cut-off row */
    .setv2 .setnav .stab { min-height: 32px; padding: 0 12px; }
    .setv2 .sethead + .sgrp, .setv2 .sethead + .derr + .sgrp, .setv2 .sethead + .derr + .wsub + .sgrp { margin-top: 10px; }
    .setv2 .srow { display: grid; grid-template-columns: minmax(0, 11fr) minmax(0, 9fr); gap: 16px; align-items: start; padding: 12px 0; border-bottom: 1px solid var(--cb-line); }
    .setv2 .sdesc { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .setv2 .sdesc .wname, .setv2 .shead .wname { white-space: normal; font-size: 1em; font-weight: 400; }
    .setv2 .shead .wsub { font-weight: 400; }
    .setv2 .wsub { white-space: normal; }
    .setv2 .sctl { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .setv2 .rads { display: flex; flex-direction: column; gap: 2px; }
    .setv2 .opt { display: flex; align-items: center; gap: 10px; min-height: 34px; cursor: pointer; }
    .setv2 .opt input, .setv2 .frow input { width: 20px; height: 20px; margin: 0; flex: none; accent-color: var(--cb-on); cursor: pointer; }
    /* Own checkbox look (the native one turns into a dark block on the tablet): outlined box, accent fill and tick when set */
    .setv2 input[type=checkbox] { -webkit-appearance: none; appearance: none; box-sizing: border-box; border: 2px solid color-mix(in srgb, var(--cb-text) 60%, transparent); border-radius: 5px; background: transparent center / 14px no-repeat; }
    .setv2 input[type=checkbox]:checked { background-color: var(--cb-on); border-color: var(--cb-on); background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M5 12.5l4.5 4.5L19 7' fill='none' stroke='white' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'/></svg>"); }
    .setv2 .ssel { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 38px; box-sizing: border-box; border-radius: 6px; border: 1px solid var(--cb-line); background: var(--cb-card); color: var(--cb-text); padding: 0 10px; font: inherit; text-align: left; cursor: pointer; }
    .setv2 .snum { width: 4.5em; text-align: center; min-height: 38px; box-sizing: border-box; border-radius: 6px; border: 1px solid var(--cb-line); background: var(--cb-card); color: var(--cb-text); padding: 0 10px; font: inherit; }
    .setv2 .snum:focus { outline: none; border-color: var(--cb-on); }
    .setv2 .stxt { width: 100%; max-width: 16em; min-height: 38px; box-sizing: border-box; border-radius: 6px; border: 1px solid var(--cb-line); background: var(--cb-card); color: var(--cb-text); padding: 0 10px; font: inherit; }
    .setv2 .stxt:focus { outline: none; border-color: var(--cb-on); }
    .setv2 .ssel.open { border-color: var(--cb-on); }
    .setv2 .ssarr { flex: none; color: var(--cb-sub); font-size: .8em; }
    .setv2 .ssopts { display: flex; flex-direction: column; margin-top: 4px; border: 1px solid var(--cb-line); border-radius: 6px; background: var(--cb-card); max-height: 260px; overflow-y: auto; -webkit-overflow-scrolling: touch; }
    .setv2 .ssopt { display: block; width: 100%; min-height: 40px; padding: 8px 12px; border: 0; border-bottom: 1px solid var(--cb-line); background: transparent; color: var(--cb-text); font: inherit; text-align: left; cursor: pointer; }
    .setv2 .ssopt:last-child { border-bottom: 0; }
    .setv2 .ssopt.on { color: var(--cb-on); font-weight: 600; }
    /* Dropdown stands out from the sheet: its own surface (text color mixed into the card color, still opaque), a visible border and a shadow; the theme divider color is almost the card color on the tablet */
    .setv2 .ssel { border-color: color-mix(in srgb, var(--cb-text) 35%, transparent); }
    .setv2 .ssopts { background: color-mix(in srgb, var(--cb-text) 14%, var(--cb-card)); border-color: color-mix(in srgb, var(--cb-text) 40%, transparent); box-shadow: 0 6px 18px rgba(0, 0, 0, .45); }
    .setv2 .ssopt { border-bottom-color: color-mix(in srgb, var(--cb-text) 18%, transparent); }
    .setv2 .sscope { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: .86em; color: var(--cb-sub); }
    .setv2 .sw2 { position: relative; display: inline-flex; align-items: center; flex: none; width: 68px; height: 30px; padding: 0; border-radius: 15px; background: var(--cb-chip); }
    .setv2 .sw2 .knob { position: absolute; top: 2px; left: 2px; width: 32px; height: 26px; border-radius: 13px; background: var(--cb-on); transition: left .15s; }
    .setv2 .sw2.dev .knob { left: 34px; }
    .setv2 .sw2 .ic { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; width: 34px; height: 30px; color: var(--cb-sub); }
    .setv2 .sw2 .ic.act { color: var(--cb-on-text); }
    .setv2 .sone { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; flex: none; width: 32px; height: 26px; border-radius: 13px; background: transparent; border: 1.5px solid var(--cb-on); color: var(--cb-on); pointer-events: none; }
    .setv2 .sscopeb { padding: 0 0 12px; }
    .setv2 .sscopeb .sscope { margin-top: 0; }
    .setv2 .ssec.hs .shead { padding-bottom: 4px; }
    .setv2 .shead { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 0; text-align: left; border-bottom: 1px solid var(--cb-line); }
    .setv2 .ssec { border-bottom: 1px solid var(--cb-line); }
    .setv2 .ssec .shead { border-bottom: 0; }
    .setv2 .shead[aria-expanded="true"] .wname { font-weight: 600; }
    .setv2 .sbody { margin: 0 0 10px 4px; padding: 2px 0 6px 14px; border-left: 2px solid color-mix(in srgb, var(--cb-on) 40%, transparent); }
    .setv2 .rackblk { margin: 6px 0 12px; padding: 2px 12px 4px; background: color-mix(in srgb, var(--cb-text) 5%, transparent); border-left: 0; border-radius: 8px; }
    .setv2 .racknm { padding: 8px 0 2px; font-size: 1em; font-weight: 600; color: var(--cb-text); }
    .setv2 .rackblk .srow { display: block; padding: 8px 0; border-bottom: 1px solid var(--cb-line); }
    .setv2 .rackblk .srow:last-child { border-bottom: 0; }
    .setv2 .rackblk .sdesc { margin-bottom: 2px; }
    .setv2 .rackblk .sdesc .wname { font-size: .92em; color: var(--cb-sub); }
    .setv2 .rackblk .rads { flex-direction: row; flex-wrap: wrap; gap: 0 20px; }
    .setv2 .sbar { display: flex; align-items: center; gap: 8px; padding: 2px 0 6px; }
    .setv2 .sbar .sscope { margin-top: 0; }
    .setv2 .sbody .srow:last-child { border-bottom: 0; }
    .setv2 .frow { display: flex; align-items: center; gap: 8px; padding: 0; user-select: none; -webkit-user-select: none; }
    .setv2 .fl { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; min-height: 44px; cursor: pointer; }
    .setv2 .fl .wname { white-space: normal; }
    .setv2 .grip { flex: none; display: flex; align-items: center; justify-content: center; width: 48px; height: 44px; color: var(--cb-sub); cursor: grab; touch-action: none; }
    .setv2 .fhead { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--cb-sub); } /* column headlines above the filter list: name / visibility / sort */
    .setv2 .fhead .fl { min-height: 28px; cursor: default; }
    .setv2 .fhead .fhs { flex: none; width: 126px; text-align: center; }
    .setv2 .fcb { flex: none; width: 63px; display: flex; align-items: center; justify-content: center; min-height: 44px; } /* two checkbox columns (list, details) of the data fields */
    .setv2 .fhead .fcb { min-height: 28px; }
    .setv2 .fhead .fhg, .setv2 .gripsp { flex: none; width: 48px; text-align: center; }
    .setv2 .fseg button { flex: 1; padding: 0; text-align: center; }
    .setv2 .fseg { flex: none; display: inline-flex; gap: 2px; width: 126px; } /* three states of a filter: visible / behind ... / off. Quiet: no frame, no solid fill; only the deviation from "visible" gets the accent */
    .setv2 .fseg button { min-height: 28px; padding: 0 8px; border: 0; border-radius: 14px; background: transparent; color: var(--cb-sub); font: inherit; font-size: 12px; font-weight: 400; cursor: pointer; white-space: nowrap; }
    .setv2 .fseg button.on { background: color-mix(in srgb, var(--cb-text) 14%, transparent); color: var(--cb-text); font-weight: 600; }
    .setv2 .fseg button.on[data-v="vis"] { background: color-mix(in srgb, var(--cb-on) 22%, transparent); color: var(--cb-on); } /* On: accent (blue), ...: grey, Off: red */
    .setv2 .fseg button.on[data-v="off"] { background: color-mix(in srgb, var(--cellarion-maturity-over, var(--error-color, #d9534f)) 22%, transparent); color: var(--cellarion-maturity-over, var(--error-color, #d9534f)); }
    .setv2 .frow.drag { background: var(--cb-chip); border-radius: 6px; }
    .setv2 .frow.drag .grip { cursor: grabbing; color: var(--cb-text); }
    .rackblk { margin: 4px 0 2px 4px; padding-left: 12px; border-left: 2px solid var(--cb-line); }
    .racknm { font-size: .88em; font-weight: 600; color: var(--cb-sub); }
    .scopeone { flex: none; cursor: default; pointer-events: none; }
    .btn.round { width: var(--cb-chip-h, 40px); padding: 0; font-size: 20px; flex: none; }
    .derr { color: var(--s-over); }
    .dask { font-size: 1.1em; font-weight: 600; }
    @media (min-width: 700px) { .dlg { align-items: center; } .dsheet { border-radius: 16px; max-height: 86%; } }
    @media (min-width: 700px) { .dsheet.statsheet { height: 86%; } } /* fixed height: pills and cards do not jump between pages of different length */
    /* Flag hdr2 (wide only): filters left in two rows; tools (sort, stats, reload, settings) above the search on the right */
    @media (min-width: 601px) {
      :host([data-hdr2]) .head { display: grid; grid-template-columns: minmax(0, 1fr) max-content; column-gap: 12px; row-gap: 6px; align-items: start; }
      :host([data-hdr2]) .head > .fwrap { grid-column: 1; grid-row: 1; }
      :host([data-hdr2]) .head > .top { grid-column: 2; grid-row: 1; display: grid; grid-template-columns: repeat(4, auto); gap: 8px; justify-content: end; }
      :host([data-hdr2]) .top .title { display: none; }
      :host([data-hdr2]) .top > * { margin-left: 0; }
      /* filter chips in equal-width cells, like on the phone (6 per row) */
      :host([data-hdr2]) .fwrap .more.open { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
      :host([data-hdr2]) .fwrap .more.open > .sel.fs { width: 100%; min-width: 0; padding: 0 4px; text-align: center; justify-content: center; overflow: hidden; text-overflow: ellipsis; }
      :host([data-hdr2]) .fwrap .more.open > .fend { display: flex; gap: 8px; min-width: 0; }
      /* same height and gap as the controls on the right (two rows of the same size), and outlined so filters and tools are told apart */
      :host([data-hdr2]) .fwrap .more.open > .sel.fs, :host([data-hdr2]) .fwrap .more.open > .fend > .sel.fs { min-height: var(--cb-chip-h, 40px); height: var(--cb-chip-h, 40px); font-size: var(--cb-chip-font, 14px); border-radius: 20px; background: transparent; }
      :host([data-hdr2]) .head > .top { border-left: 1px solid var(--cb-line); padding-left: 14px; }
      :host([data-hdr2]) .fwrap .more.open > .fend > * { flex: 1 1 0; min-width: 0; width: auto; }
      :host([data-hdr2]) .top .search { grid-column: 1 / -1; grid-row: 2; width: 0; min-width: 100%; } /* as wide as the buttons above, without widening the column itself */
      :host([data-hdr2]) .head > .fpills, :host([data-hdr2]) .head > .sumline { grid-column: 1 / -1; }
    }
    /* Header band: slightly lighter than the list, with a clearer lower edge */
    :host([data-hdr2]) .head, :host([data-hdr2]) .az { background: color-mix(in srgb, var(--cb-text) 6%, var(--cb-card)); }
    :host([data-hdr2]) .head { border-bottom-color: transparent; }
    :host([data-hdr2][data-mode="light"]) .head, :host([data-hdr2][data-mode="light"]) .az { background: color-mix(in srgb, var(--cb-text) 3%, var(--cb-card)); }
    :host([data-hdr2]) .az { box-sizing: border-box; }
    :host([data-hdr2]) .az { border-bottom-color: color-mix(in srgb, var(--cb-text) 16%, transparent); box-shadow: 0 5px 8px -5px rgba(0, 0, 0, .45); position: relative; z-index: 1; }
    :host([data-hdr2]) .fwrap .more.open > .sel.fs { border-color: color-mix(in srgb, var(--cb-text) 26%, transparent); }
    /* Flag hdr, option c: cellar name centered in the first row */
    :host([data-hdr2][data-hdrv="c"]) .top .cname { flex: 1 1 0; min-width: 0; text-align: center; font-weight: 600; font-size: 15px; letter-spacing: .02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    @media (min-width: 601px) { :host([data-hdr2][data-hdrv="c"]) .top .cname { grid-column: 2; grid-row: 1; align-self: center; } }
    /* Flag hdr, option c: sort as a plain control at the right of the summary line (all widths) */
    :host([data-hdr2][data-hdrv="c"]) .sumline > .sel { width: auto; height: 28px; min-height: 28px; padding: 0 2px; gap: 6px; font-size: 13px; background: none; border: 0; border-radius: 6px; color: var(--cb-sub); justify-content: flex-start; }
    :host([data-hdr2][data-hdrv="c"]) .sumline > .sel::before { content: ''; width: 16px; height: 16px; flex: none; background: currentColor; -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M3 6h18M3 12h12M3 18h6' stroke='black' stroke-width='2.4' stroke-linecap='round' fill='none'/></svg>") center/contain no-repeat; mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M3 6h18M3 12h12M3 18h6' stroke='black' stroke-width='2.4' stroke-linecap='round' fill='none'/></svg>") center/contain no-repeat; }
    :host([data-hdr2][data-hdrv="c"]) .sumline > .sel:hover { color: var(--cb-text); }
    /* Flag hdr, option c (wide): search + stats left, reload/settings as plain icons right, filters in their own row, sort at the right of the summary line */
    @media (min-width: 601px) {
      :host([data-hdr2][data-hdrv="c"]) .head { box-sizing: border-box; padding-right: 16px; /* icons and sort end flush with the row arrows (the letters and the bottle count line up with Z) */ grid-template-columns: minmax(0, 300px) minmax(0, 1fr) max-content max-content max-content; column-gap: 8px; row-gap: 8px; }
      :host([data-hdr2][data-hdrv="c"]) .head > .top { display: contents; border-left: 0; padding-left: 0; }
      :host([data-hdr2][data-hdrv="c"]) .top .search { grid-column: 1; grid-row: 1; }
      :host([data-hdr2][data-hdrv="c"]) .top > .st { grid-column: 3; grid-row: 1; }
      :host([data-hdr2][data-hdrv="c"]) .top > .rl { grid-column: 4; grid-row: 1; }
      :host([data-hdr2][data-hdrv="c"]) .top > .gear { grid-column: 5; grid-row: 1; margin-right: -5px; }
      :host([data-hdr2][data-hdrv="c"]) .top > .st, :host([data-hdr2][data-hdrv="c"]) .top > .rl, :host([data-hdr2][data-hdrv="c"]) .top > .gear { width: 30px; }
      :host([data-hdr2][data-hdrv="c"]) .top > .st, :host([data-hdr2][data-hdrv="c"]) .top > .rl, :host([data-hdr2][data-hdrv="c"]) .top > .gear { background: none; border-color: transparent; box-shadow: none; }
      :host([data-hdr2][data-hdrv="c"]) .head > .fwrap { grid-column: 1 / -1; grid-row: 2; }
      :host([data-hdr2][data-hdrv="c"]) .fwrap .more.open { display: flex; flex-wrap: wrap; gap: 6px; }
      :host([data-hdr2][data-hdrv="c"]) .fwrap .more.open > .sel.fs, :host([data-hdr2][data-hdrv="c"]) .fwrap .more.open > .fend > .sel.fs { width: auto; flex: none; height: 30px; min-height: 30px; font-size: 13px; padding: 0 4px 0 9px; gap: 5px; border-radius: 15px; text-align: left; justify-content: space-between; }
      :host([data-hdr2][data-hdrv="c"]) .fwrap .more.open > .fend > .more-pill { padding: 0 5px 0 8px; }
      :host([data-hdr2][data-hdrv="c"]) .fwrap .more.open > .fend { display: contents; }
      :host([data-hdr2][data-hdrv="c"]) .head > .fpills { grid-row: auto; }
      :host([data-hdr2][data-hdrv="c"]) .head > .fpills:not(:has(.fpill, [data-reset]:not([hidden]))) { display: none; }
      :host([data-hdr2][data-hdrv="c"]) .head > .sumline { grid-row: auto; }
    }
    /* Flag hdr, option b (from 900px): three columns. 1 search + (sort, stats) below, 2 filters in two rows, 3 reload above settings */
    @media (min-width: 1100px) {
      :host([data-hdr2][data-hdrv="b"]) .head { grid-template-columns: minmax(0, 150px) max-content minmax(0, 1fr) max-content; grid-template-rows: var(--cb-chip-h, 40px) var(--cb-chip-h, 40px); column-gap: 12px; row-gap: 8px; }
      :host([data-hdr2][data-hdrv="b"]) .head > .top { display: contents; }
      :host([data-hdr2][data-hdrv="b"]) .top .search { grid-column: 1 / 3; grid-row: 1; width: 0; min-width: 100%; }
      :host([data-hdr2][data-hdrv="b"]) .top > [data-id="sort"] { grid-column: 1; grid-row: 2; width: 100%; min-width: 0; }
      :host([data-hdr2][data-hdrv="b"]) .top > .st { grid-column: 2; grid-row: 2; }
      :host([data-hdr2][data-hdrv="b"]) .head > .fwrap { grid-column: 3; grid-row: 1 / 3; }
      :host([data-hdr2][data-hdrv="b"]) .fwrap .more.open { grid-template-columns: repeat(var(--fcols, 5), minmax(0, 1fr)); grid-auto-rows: var(--cb-chip-h, 40px); }
      :host([data-hdr2][data-hdrv="b"]) .top > .rl { grid-column: 4; grid-row: 1; margin-left: 14px; }
      :host([data-hdr2][data-hdrv="b"]) .top > .gear { grid-column: 4; grid-row: 2; margin-left: 14px; }
      :host([data-hdr2][data-hdrv="b"]) .head::before { content: ''; align-self: stretch; grid-column: 4; grid-row: 1 / 3; border-left: 1px solid var(--cb-line); pointer-events: none; }
    }
    @media (max-width: 600px) {
      :host([data-hdr2][data-hdrv="c"]) .top > .st, :host([data-hdr2][data-hdrv="c"]) .top > .gear { background: none; border-color: transparent; box-shadow: none; width: 32px; }
      :host([data-hdr2][data-hdrv="c"]) .top > .gear { margin-right: -4px; margin-left: 0; }
      :host([data-hdr2][data-hdrv="c"]) .top .search { flex: 0 0 calc(50% - 4px); width: calc(50% - 4px); min-width: 0; } /* as wide as two filter pills */
      :host([data-hdr2][data-hdrv="c"]) .top > .st { margin-left: auto; }
      :host([data-hdr2][data-hdrv="c"]) .top .cname { order: 1; flex: 0 1 auto; text-align: left; margin-left: 6px; }
      :host([data-hdr2][data-hdrv="c"]) .top > .st, :host([data-hdr2][data-hdrv="c"]) .top > .gear { order: 2; }
      :host([data-hdr2][data-hdrv="c"]) .sumline .grow { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
      :host([data-hdr2]) .fwrap .more.open > .sel.fs { background: transparent; } /* flag hdr2: filters outlined, like on wide screens */
      .fwrap .more.open > .sel.fs { width: 100%; min-width: 0; padding: 0 4px; text-align: center; justify-content: center; overflow: hidden; text-overflow: ellipsis; }
      .fwrap .more.open > .fend { display: flex; gap: 6px; min-width: 0; }
      .fwrap .more.open > .fend > * { flex: 1 1 0; min-width: 0; width: auto; }
      .dsheet:not(.ddsheet):not(.csheet) { height: 100%; max-height: 100%; border-radius: 0; }
      .dtop { gap: 10px; }
      .dimg { width: 84px; max-height: 150px; }
      .rmap.big { --rc: 24px; }
      .rmap.big .rm-c { width: 24px; height: 24px; }
    }
  `;

  class CellarionBestandCard extends HTMLElement {
    setConfig(config) {
      this._cfg = Object.assign({}, config || {});
      this._key = 'cellarion-cellar-card:' + (this._cfg.key || 'bestand');
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
      this._loadExt();
    }

    // Optional extensions (config "extensions"): each module exports default (Base) => class extends Base. The class of this card instance is swapped for
    // the extended one, so an extension may override any method and call super. Errors never break the card.
    async _loadExt() {
      const list = [].concat(this._cfg.extensions || []).filter((u) => typeof u === 'string' && u);
      const key = list.join('|');
      if (!list.length || this._extKey === key) return;
      this._extKey = key;
      for (const u of list) {
        try {
          const mod = await import(u);
          if (typeof mod.default !== 'function') continue;
          const Sub = mod.default(Object.getPrototypeOf(this).constructor);
          if (typeof Sub === 'function' && Sub.prototype instanceof HTMLElement) Object.setPrototypeOf(this, Sub.prototype);
        } catch (e) { console.warn('cellarion card: extension failed', u, e); }
      }
      if (this._built) { this._renderAll(); if (this._det) this._renderDlg0(); }
    }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      if (!this._cfg) return;
      if (first) this._start();
      const ent = this._cfg.count_entity || 'sensor.cellarion_cellar_card_total_bottles';
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
      if (e.deltaY > 0 && this._more && list.scrollTop > 2 && !this._fixedHdr()) { this._more = false; this._autoFolded = true; this._renderHead(); }
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
      // Phone: leave 40 px at the bottom for the Android navigation bar (a web page cannot tell whether it is on); the card ends above it, so the page itself does not become scrollable
      const phone = window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
      card.style.height = Math.max(420, window.innerHeight - top - 8 - (phone ? 40 : 0)) + 'px';
    }

    // ---------- State ----------
    _clampScale(v) {
      v = Number(v);
      return v >= 0.8 && v <= 2.5 ? Math.round(v * 100) / 100 : 1;
    }
    _mode() { const m = this._local && this._local.mode; return m === 'light' || m === 'dark' ? m : 'auto'; }
    // Setting 'show Other in the list' (central for all devices, overridable per device; default: shown). Off: Other items (not wine) only appear while the type filter 'other' is chosen or a search term is entered
    _archN() { const L = this._local || {}, S = this._shared || {}; const v = L.archN !== undefined ? L.archN : S.archN; return v === undefined || isNaN(Number(v)) ? 0 : Number(v); } // setting Archive: archive rows in the search below this many stock hits (device only)
    _showOther() { const L = this._local || {}, S = this._shared || {}; return !(L.hideOther !== undefined ? L.hideOther : S.hideOther); }
    _hideOther() { return !this._showOther() && !(this._f.types && this._f.types.has('other')) && !norm(this._f.q || '').trim() && !this._allDefs().some((d) => d.personal && this._fs(d.id).size); } // a search term, the Other type or a chosen personal-field value always finds Other items too
    _fullw() { return !!(this._local && this._local.fullw); } // setting 'force full width' (this device only)
    _applyMode() { const m = this._mode(); if (m === 'auto') this.removeAttribute('data-mode'); else this.setAttribute('data-mode', m); }
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
      setBands(S.priceBands); setPrice(); // price bands: central setting (all devices)
      const F = L.filters || S;
      // Never saved: the common filters in this order, the rest (appellation, shop, classification kinds, personal fields) behind "..."
      const pf = (((this._data || this._raw || {}).fields) || []).filter((l) => !isInfoKey(l)).map((l) => 'p:' + l);
      this._fo = Array.isArray(F.filterOrder) ? F.filterOrder.slice() : DEF_FILTERS.slice();
      this._fh = new Set(Array.isArray(F.filterHidden) ? F.filterHidden : ['appellation', 'shop'].concat(this._kinds().map((k) => 'cls:' + k), pf));
      // Info behind the wine name in the list: order + what is shown (central for all devices, overridable per device)
      const I = L.info || { order: S.infoOrder, show: S.infoShow };
      // The single item "cls" (classification) stands for one item per kind of tier (cls:<kind>, kinds come from Cellarion)
      const KS = this._kinds().map((k) => 'cls:' + k), expand = (a) => [].concat(...a.map((x) => (x === 'cls' ? KS : [x])));
      const ord = Array.isArray(I.order) ? I.order.map(String) : []; // "d:<id>" entries = order in the details (flag infosplit)
      this._io = expand(ord.filter((x) => !x.startsWith('d:')));
      this._ido = expand(ord.filter((x) => x.startsWith('d:')).map((x) => x.slice(2)));
      // show = ids shown in the list; "off:<id>" = not shown in the details (rows, header, info tab); list and details are set independently
      const sh = (Array.isArray(I.show) ? I.show : DEF_SHOW).map(String);
      this._is = new Set(expand(sh.filter((x) => !x.startsWith('off:') && !x.startsWith('more:'))));
      this._iMore = new Set(expand(sh.filter((x) => x.startsWith('more:')).map((x) => x.slice(5)))); // behind the expand arrow in the details (flag detrows)
      this._iOff = new Set(expand(sh.filter((x) => x.startsWith('off:')).map((x) => x.slice(4))));
    }
    _infoDefs(det) { // det: the order of the details (only with flag infosplit), without the price
      const std = this._kinds().map((k) => ({ id: 'cls:' + k, label: clsLbl(k), clsg: k })) // clsg: kind, shown as "Classification: <kind>" like in the filter settings
        .concat([['country', t('filter.country')], ['region', t('filter.region')], ['appellation', t('filter.appellation')], ['sweetness', t('filter.sweetness')], ['grape', t('filter.grape')]].map(([id, label]) => ({ id, label })));
      const pers = ((this._data && this._data.fields) || []).filter((l) => !isInfoKey(l)).map((l) => ({ id: 'p:' + l, label: l, personal: true }));
      // Flag detrows: the details also list the vineyard name and the bottle data (price, purchase date ...) as data fields
      const more = det ? this._infoOnly().map((k) => ({ id: 'i:' + k, label: infoLbl(k), infoOnly: true, attr: k })).concat(BOTTLE_ROWS.map(([id, key]) => ({ id, label: t(key), bottle: true }))) : [];
      const all = std.concat(more, pers);
      const pos = (d) => { const k = (this._io || []).indexOf(d.id); return k < 0 ? 1000 + all.indexOf(d) : k; };
      // The price is special (bottle data, not wine data): always last, not sortable
      const byList = all.slice().sort((a, b) => pos(a) - pos(b));
      if (det) { const pd = (d) => { const k = (this._ido || []).indexOf(d.id); return k < 0 ? 1000 + byList.indexOf(d) : k; }; return byList.slice().sort((a, b) => pd(a) - pd(b)); }
      return byList.concat([{ id: 'price', label: t('filter.price'), fixed: true }]);
    }
    _priceOnly(pr) { const m = String(pr || '').match(/wprice wpd">(.*?)<\/span>/); return m ? m[1] : ''; }
    _infoOrderArr() { return (this._io || []).concat((this._ido || []).map((x) => 'd:' + x)); }
    _dOff(id) { return this._iOff.has(id); } // off in the details
    _infoShowArr() { return Array.from(this._is).concat(Array.from(this._iOff).map((x) => 'off:' + x), Array.from(this._iMore).map((x) => 'more:' + x)); }
    // Id of the data field (see _infoDefs) behind an info attribute key
    _infoDefId(k) {
      if (this._infoDefs().some((x) => x.id === k && !x.personal)) return k; // Cellarion data fields (country, region, appellation, grape) have their attribute as id
      if (this._infoOnly().indexOf(k) >= 0) return 'i:' + k;
      if (this._kinds().indexOf(k) >= 0) return 'cls:' + k;
      const d = this._infoDefs().find((x) => x.personal && infoNorm(x.label) === k);
      return d ? d.id : '';
    }
    // Info attributes without an own value: the field info:<attribute> exists, but there is neither a Cellarion field nor a personal field of that name.
    // Their row shows the name of the reference entry (see _infoVal); the settings mark them with [brackets] like personal fields.
    _infoOnly() {
      const own = WINE_ATTR.concat(this._kinds()), r = [];
      ((this._data && this._data.fields) || []).forEach((l) => { const m = /^info:\s*(.+)$/i.exec(String(l)), k = m ? infoNorm(m[1]) : ''; if (k && own.indexOf(k) < 0 && !this._isPers(k) && r.indexOf(k) < 0) r.push(k); });
      return r;
    }
    _isPers(k) { return ((this._data && this._data.fields) || []).some((l) => !isInfoKey(l) && infoNorm(l) === k); } // a personal field (not an info: field) of this name exists
    _infoOff(k) { const id = this._infoDefId(k); return !!id && this._dOff(id); }
    _setInfo(order, show, dorder) {
      order = order.concat((dorder || this._ido || []).map((x) => 'd:' + x));
      if (this._local.info) { this._local.info = { order, show }; this._saveState(); }
      else { this._shared.infoOrder = order; this._shared.infoShow = show; this._saveSettings(); }
      this._applyEff();
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
      this._fmode = st.fm === 'or' || st.fm === 'not' ? st.fm : 'std';
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
        localStorage.setItem(this._key, JSON.stringify({ view: this._view, sort: this._restored ? this._sort : ((this._st || {}).sort || this._sort), scale: this._scale, local: this._local, f, fm: this._restored ? this._fm() : (this._st || {}).fm })); } catch (e) { /* ohne Speicher weiter */ }
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
    // Data source: the services of the cellarion_cellar_card integration (response directly as an object).
    // Only the development setup has an additional connection through its own services ("dev-only" block below).
    _integ() { return BACKEND === 'integration'; }
    // kind: read | sync | refresh | settings | fielddel | winzer | bottle. sh = data for the development setup's service, int = data for the integration's service.
    async _call(kind, sh, int) {
      const c = this._cfg || {};
      let res;
      if (this._integ()) {
        const name = { read: 'read', sync: 'sync', refresh: 'refresh', settings: 'settings', fielddel: 'delete_field', winzer: 'producer_sort', bottle: 'bottle' }[kind];
        res = await this._hass.callWS({ type: 'call_service', domain: 'cellarion_cellar_card', service: name, service_data: int || {}, return_response: true });
        const out = (res && res.response) || {};
        if (out.error) throw new Error(out.error);
        return out;
      }
      throw new Error('Cellar Card for Cellarion integration not found');
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
      if (rs.side === 'thirds' && w.platz && w.cols) parts.push(t(['loc.left', 'loc.mid', 'loc.right'][Math.min(2, Math.floor((w.platz - 1) / (w.cols / 3)))])); // without the number of columns from Cellarion there is no side
      else if (rs.side === 'slot' && w.platz) parts.push(t('loc.slot', { n: w.platz }));
      return parts.join(' · ');
    }
    // Exact position (independent of the display setting): rack, shelf, row (only if the shelf has several), slot
    _exactPlace(b) {
      const w = b.where;
      if (!w || w.fach == null || !w.fachen) return '';
      const rs = this._rs(w.rack), g = (this._data && this._data.rackGeo && this._data.rackGeo[w.rack]) || null;
      const parts = [w.rack, t('loc.shelf', { n: rs.order === 'bottom' ? w.fach : w.fachen - w.fach + 1 })];
      if (g && g.rows && g.rows[w.fach - 1] > 1 && w.lage) parts.push(t('loc.row', { n: w.lage }));
      if (w.platz) parts.push(t('loc.slot', { n: w.platz }));
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
      // Cellars: the cache lists all of them; the card shows one or all together (choice per device)
      const cl = Array.isArray(data.cellars) && data.cellars.length ? data.cellars
        : [{ id: data.cellarId || '', name: data.cellar || '', racks: data.racks || [], rackGeo: data.rackGeo || {} }];
      const sel = this._cellarSel(cl), all = sel === 'all', multi = cl.length > 1;
      const names = new Map(cl.map((c) => [c.id, c.name || '']));
      const per = new Map();
      (data.bottles || []).forEach((b) => { if (!this._gone.has(b.id)) { const k = b.cellar || cl[0].id; per.set(k, (per.get(k) || 0) + 1); } });
      // Currency of the prices: the one most bottles use; the price bands and the price text use it
      {
        const cc = new Map();
        (data.bottles || []).forEach((b) => { if (typeof b.price === 'number' && b.price > 0 && b.currency) cc.set(b.currency, (cc.get(b.currency) || 0) + 1); });
        CUR = (Array.from(cc.entries()).sort((a, b) => b[1] - a[1])[0] || [''])[0];
        setPrice();
      }
      // Classification list of a wine; tiers of kind ripeness (Kabinett, Spätlese ...) before the others (kind comes from Cellarion, see classKinds)
      const kinds = data.classKinds || {};
      const clsOf = (c) => {
        const pr = (x) => (kinds[x.toLowerCase()] === 'ripeness' ? 0 : 1);
        return String(c || '').split(',').map((x) => x.trim()).filter(Boolean).map((x, i) => [x, i]).sort((a, b) => pr(a[0]) - pr(b[0]) || a[1] - b[1]).map((x) => x[0]);
      };
      const bottles = (data.bottles || []).filter((b) => !this._gone.has(b.id) && (!multi || all || (b.cellar || cl[0].id) === sel)).map((b) => {
        const o = Object.assign({}, b);
        o._cn = multi ? names.get(b.cellar || cl[0].id) || '' : '';
        o._status = statusOf(o, year);
        o._price = priceKey(o);
        o._loc = this._placeText(o) || o.location || NO_LOC;
        o._rack = o.where && o.where.rack ? o.where.rack : NO_LOC;
        o._type = o.type || '';
        o._cls = clsOf(o.classification);
        o._hay = norm([o.name, o.producer, o.vintage, o.region, o.country, o.appellation, o.sweetness, o.classification,
          (o.grapes || []).join(' '), o._loc, typeLbl(o.type),
          Object.keys(o.p || {}).filter((k) => !isInfoKey(k)).map((k) => (Array.isArray(o.p[k]) ? o.p[k].join(' ') : o.p[k])).join(' ')].join('\u0001')); // the long info texts and source links are not searched // fields are separated, so a phrase cannot run across two fields
        return o;
      });
      // History (flag): drunk / gifted / sold bottles of the consumption log as pseudo bottles, only used by the list; the wine id is taken from a bottle of the same wine and producer
      const wkey = (n, p) => norm(n) + '|' + norm(p);
      const wineOf = new Map();
      const sampleOf = new Map();
      bottles.forEach((b) => { if (b.wine) { wineOf.set(wkey(b.name, b.producer), b.wine); if (!sampleOf.has(wkey(b.name, b.producer))) sampleOf.set(wkey(b.name, b.producer), b); } });
      const hist = (data.history || []).filter((h) => !multi || all || (h.cellar || cl[0].id) === sel).map((h) => {
        const o = Object.assign({}, h);
        const k = wkey(o.name, o.producer);
        o.vintage = o.vintage || 'NV';
        o.wine = o.wine || wineOf.get(k) || 'h:' + k;
        o._hist = true;
        const sm = sampleOf.get(k); // wine facts of a bottle of the same wine in the cellar (if there is one)
        if (sm) ['country', 'region', 'appellation', 'sweetness', 'grapes', 'classification', 'colour', 'p'].forEach((f) => { if (o[f] === undefined) o[f] = sm[f]; });
        o._status = 'drunk';
        o._cn = multi ? names.get(o.cellar || cl[0].id) || '' : '';
        o._price = priceKey(o);
        o._loc = '';
        o._rack = NO_LOC;
        o._type = o.type || '';
        o._cls = clsOf(o.classification);
        o._hay = norm([o.name, o.producer, o.vintage, o.region, o.country, o.appellation, o.sweetness, o.classification, (o.grapes || []).join(' '), typeLbl(o.type)].join('\u0001'));
        return o;
      });
      const count = (get) => {
        const m = new Map();
        bottles.forEach((b) => { const v = get(b); if (v) m.set(v, (m.get(v) || 0) + 1); });
        return m;
      };
      const grapes = new Map();
      bottles.forEach((b) => (b.grapes || []).forEach((g) => grapes.set(g, (grapes.get(g) || 0) + 1)));
      // Wine types come from the data (stock and archive), most frequent first
      {
        const tc = new Map();
        bottles.concat(hist || []).forEach((b) => { if (b._type) tc.set(b._type, (tc.get(b._type) || 0) + 1); });
        TYPES.length = 0;
        Array.from(tc.entries()).sort((a, b) => b[1] - a[1] || de.compare(a[0], b[0])).forEach(([k]) => TYPES.push([k, typeLbl(k)]));
      }
      const cur = all ? null : (cl.find((c) => c.id === sel) || cl[0]);
      this._data = {
        generated: data.generated,
        cellar: all ? t('cellar.all') : ((cur && cur.name) || data.cellar || ''),
        cellarId: all ? '' : ((cur && cur.id) || data.cellarId || ''),
        cellars: cl.map((c) => ({ id: c.id, name: c.name || '', n: per.get(c.id) || 0 })),
        cellarSel: sel,
        multi,
        url: String(data.url || 'https://cellarion.app').replace(/\/+$/, ''),
        fields: Array.isArray(data.fields) ? data.fields : [],
        classKinds: kinds,
        bottles,
        history: hist,
        racks: cur ? (cur.racks || []) : Array.from(new Set([].concat(...cl.map((c) => c.racks || [])))),
        rackGeo: cur ? (cur.rackGeo || {}) : Object.assign({}, ...cl.map((c) => c.rackGeo || {})),
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
    // Chosen cellar of this device: a cellar id or 'all'. Only with several cellars; without a (valid) choice the first cellar.
    _cellarSel(cl) {
      if (cl.length < 2) return cl[0].id;
      const v = this._local && this._local.cellar;
      return v === 'all' || cl.some((c) => c.id === v) ? v : 'all'; // no choice yet (or the chosen cellar is gone): all cellars together
    }
    // Several cellars shown together: places carry their cellar
    _allCellars() { return !!(this._data && this._data.multi && this._data.cellarSel === 'all'); }
    // Append the cellar name to the HA page header (toolbar), e.g. "Wine cellar - HK4" (option header_cellar: false turns it off)
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
    // Grapes: several chosen grapes are an AND group (the wine must have all of them): the pills sit in a bordered group with & between them
    _pillSep(d) { return d.id === 'grape' && !this._multi() ? '<span class="fand">&amp;</span>' : ''; }
    _pillWrap(d, html) { return d.id === 'grape' && !this._multi() && this._fs(d.id).size > 1 ? `<span class="fgrp">${html}</span>` : html; }
    _fs(id) { return this._f[id] || (this._f[id] = new Set()); }
    // Filter mode: 'std' (one value per filter, as before), 'or' (a bottle shows if ANY chosen value of ANY filter matches), 'not' (a bottle shows if NO chosen value matches)
    _fm() { return (this._fmode === 'or' || this._fmode === 'not') && !(this._fh && this._fh.has('fmode:off')) ? this._fmode : 'std'; }
    _multi() { return this._fm() !== 'std'; }
    // Back to the standard mode: every filter keeps one value again (grapes stay an AND group)
    _setFm(v) {
      this._fmode = v === 'or' || v === 'not' ? v : 'std';
      if (this._fmode === 'std') for (const k of Object.keys(this._f)) if (k !== 'q' && k !== 'grape' && this._f[k] && this._f[k].size > 1) this._f[k] = new Set([Array.from(this._f[k])[0]]);
    }
    // Standard: a pick replaces the chosen value of its filter (every filter holds one value; for grapes the & button in the list adds a further one, see ddand). OR / NOT: a pick adds a value
    _fsAdd(id, v) { const S = this._fs(id); if (!this._multi()) S.clear(); S.add(v); }
    // All possible filters: fixed ones (type ... place) plus one per personal data field (automatically from the cache)
    _allDefs() {
      const byProd = (a, b) => de.compare(this._pkey(a[0]), this._pkey(b[0]));
      const std = [
        { id: 'types', label: t('filter.types'), defs: TYPES, dot: '--w-', get: (b) => b._type },
        { id: 'grape', label: t('filter.grape'), get: (b) => b.grapes || [] },
        { id: 'country', label: t('filter.country'), get: (b) => b.country || null },
        { id: 'region', label: t('filter.region'), get: (b) => b.region },
        { id: 'appellation', label: t('filter.appellation'), get: (b) => b.appellation || null },
        { id: 'sweetness', label: t('filter.sweetness'), get: (b) => b.sweetness || null },
        { id: 'producer', label: t('filter.producer'), get: (b) => b.producer, sort: byProd },
        { id: 'status', label: t('filter.status'), defs: STATUS, dot: '--s-', get: (b) => (b._status === 'window' ? 'peak' : b._status) },
        { id: 'cls', label: t('filter.cls'), get: (b) => b._cls || [] },
        { id: 'vintage', label: t('filter.vintage'), get: (b) => String(b.vintage || 'NV'), sort: (a, b) => this._vint(b[0]) - this._vint(a[0]) },
        ...(PRICE_BANDS.length ? [{ id: 'price', label: t('filter.price'), defs: PRICE, get: (b) => b._price }] : []), // empty setting Price bands = no price filter
        { id: 'racks', label: t('filter.racks'), get: (b) => b._rack, sort: (a, b) => (a[0] === NO_LOC) - (b[0] === NO_LOC) || de.compare(a[0], b[0]) },
        { id: 'shop', label: t('filter.shop'), get: (b) => b.shop || null },
      ];
      // Classification: one filter per kind of tier (from Cellarion) instead of a single one (the info line still uses 'cls')
      {
        const i = std.findIndex((x) => x.id === 'cls');
        if (i >= 0) std.splice(i, 1, ...this._kinds().map((k) => ({ id: 'cls:' + k, label: clsLbl(k), clsg: k, get: (b) => (b._cls || []).filter((v) => this._clsKind(v) === k) })));
      }
      const pers = ((this._data && this._data.fields) || []).filter((l) => !isInfoKey(l)).map((l) => ({ id: 'p:' + l, label: l, personal: true, get: (b) => (b.p && b.p[l]) || null }));
      const all = std.concat(pers);
      const pos = (d) => { const k = this._fo.indexOf(d.id); return k < 0 ? 1000 + all.indexOf(d) : k; };
      return all.slice().sort((a, b) => pos(a) - pos(b));
    }
    _orderedDefs() { return this._allDefs().filter((d) => !this._fh.has(d.id)); }
    // Search terms: with several words, the whole phrase first (e.g. "cote d" = Côte des Blancs ...); only when no wine contains the phrase, every word on its own
    _qToks() {
      const q = norm(this._f.q).trim().replace(/\s+/g, ' ');
      if (this._qc && this._qc.q === q && this._qc.d === this._data) return this._qc.r;
      const toks = q.split(' ').filter(Boolean);
      const r = toks.length > 1 && this._data && this._data.bottles.some((b) => wordAt(b._hay, q) >= 0) ? [q] : toks;
      this._qc = { q, d: this._data, r };
      return r;
    }
    // Flag history: the filter "History" is on, the list shows the drunk bottles instead of the cellar
    _histMode() { return !!(this._f.hist && this._f.hist.size); }
    // src: 'hist' = always the consumption log (used for the extra rows of a search), otherwise the cellar (or the log while the filter History is on)
    _filtered(skip, grp, src) {
      const f = this._f;
      const hp = src === 'hist' || (!src && this._histMode());
      // History = only used up: a drunk vintage with a bottle of the same wine and vintage still in the cellar is not listed
      // A wine with any bottle left (any vintage) is not archived
      const left = hp ? new Set(this._data.bottles.map((b) => b.wine || b.name)) : null;
      const pool = hp ? (this._data.history || []).filter((h) => src === 'hist' || !left.has(h.wine)) : this._data.bottles;
      const toks = this._qToks();
      const act = this._allDefs().filter((d) => d.id !== skip && f[d.id] && f[d.id].size);
      const gid = grp || skip, skipDef = gid && this._allDefs().find((d) => d.id === gid);
      const noOther = gid !== 'types' && !(skipDef && skipDef.personal) && this._hideOther(); // the type pulldown and the personal-field pulldowns still count Other, so they can be chosen (e.g. "Type (Other)")
      return pool.filter((b) => {
        if (noOther && b._type === 'other') return false;
        if (this._multi()) {
          // OR: the pick lists stay free (counts over all bottles, so more values can be added); the list shows bottles where any chosen value matches.
          // NOT: lists follow the exclusions of the other filters (what is offered and greyed out matches the remaining bottles); the list shows bottles where no chosen value matches
          if ((this._fm() === 'not' || !(skip || grp)) && act.length) { const hit = act.some((d) => [].concat(d.get(b)).some((v) => f[d.id].has(v))); if (this._fm() === 'or' ? !hit : hit) return false; }
        } else {
          // Grapes: the wine must have all chosen grapes (AND group); every other filter holds one value
          for (const d of act) { const vals = [].concat(d.get(b)); if (d.id === 'grape' ? !Array.from(f[d.id]).every((v) => vals.includes(v)) : !vals.some((v) => f[d.id].has(v))) return false; }
        }
        for (const t of toks) if (wordAt(b._hay, t) < 0) return false;
        return true;
      });
    }
    _entries(bottles) {
      // Entry = wine + vintage
      const m = new Map();
      bottles.forEach((b) => {
        const k = (b.wine || b.name) + '|' + (b.vintage || 'NV') + (b._hist ? '|h' : '');
        let e = m.get(k);
        if (!e) { e = { wine: b.wine || b.name, vintage: String(b.vintage || 'NV'), b, bottles: [] }; m.set(k, e); }
        e.bottles.push(b);
      });
      m.forEach((e) => {
        e.status = e.bottles.reduce((a, x) => (STATUS_RANK[x._status] < STATUS_RANK[a] ? x._status : a), e.bottles[0]._status);
        const ends = e.bottles.map((x) => x.drinkTo).filter(Boolean);
        e.drinkTo = ends.length ? Math.min.apply(null, ends) : 9999;
        e.hist = !!e.b._hist; // drunk entry (flag history)
        e.added = e.bottles.reduce((x, y) => (y.added && y.added > x ? y.added : x), ''); // newest added bottle (ISO text compares in time order)
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
        case 'countDesc': return (b.bottles || []).length - (a.bottles || []).length || de.compare(a.b.name || '', b.b.name || '');
        case 'region': return de.compare(a.b.region || '~', b.b.region || '~') || de.compare(this._pkey(a.b.producer), this._pkey(b.b.producer)) || de.compare(a.b.name || '', b.b.name || '');
        case 'vintageAsc': return this._old(a.vintage) - this._old(b.vintage) || de.compare(a.b.name || '', b.b.name || '');
        case 'added': return (b.added || '').localeCompare(a.added || '') || de.compare(a.b.name || '', b.b.name || '');
        case 'nameDesc': return de.compare(b.b.name || '', a.b.name || '') || de.compare(b.b.producer || '', a.b.producer || '') || this._vint(b.vintage) - this._vint(a.vintage);
        case 'producerDesc': return de.compare(this._pkey(b.b.producer), this._pkey(a.b.producer)) || de.compare(b.b.name || '', a.b.name || '') || this._vint(b.vintage) - this._vint(a.vintage);
        case 'regionDesc': return (a.b.region ? 0 : 1) - (b.b.region ? 0 : 1) || de.compare(b.b.region || '', a.b.region || '') || de.compare(this._pkey(a.b.producer), this._pkey(b.b.producer)) || de.compare(a.b.name || '', b.b.name || '');
        case 'addedAsc': return (a.added || '9').localeCompare(b.added || '9') || de.compare(a.b.name || '', b.b.name || '');
        case 'countAsc': return (a.bottles || []).length - (b.bottles || []).length || de.compare(a.b.name || '', b.b.name || '');
        case 'drinkToDesc': return (b.drinkTo === 9999 ? -1 : b.drinkTo) - (a.drinkTo === 9999 ? -1 : a.drinkTo) || de.compare(a.b.name || '', b.b.name || '');
        default: return de.compare(a.b.name || '', b.b.name || '') || de.compare(a.b.producer || '', b.b.producer || '') || this._vint(b.vintage) - this._vint(a.vintage);
      }
    }
    _groups(entries) {
      const m = new Map();
      entries.forEach((e) => {
        let g = m.get(e.wine);
        if (!g) { g = { id: e.wine, b: e.b, entries: [], count: 0, hn: 0 }; m.set(e.wine, g); }
        g.entries.push(e);
        if (e.hist) g.hn += e.bottles.length; else g.count += e.bottles.length; // count = bottles in the cellar, hn = drunk ones
      });
      const groups = Array.from(m.values());
      groups.forEach((g) => {
        g.entries.sort((x, y) => this._vint(y.vintage) - this._vint(x.vintage));
        g.drinkTo = Math.min.apply(null, g.entries.map((x) => x.drinkTo));
        g.maxVint = Math.max.apply(null, g.entries.map((x) => this._vint(x.vintage)));
        g.minVint = Math.min.apply(null, g.entries.map((x) => this._old(x.vintage)));
        g.added = g.entries.reduce((x, y) => (y.added && y.added > x ? y.added : x), '');
      });
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
        region: (a, b) => (a.b.region ? 0 : 1) - (b.b.region ? 0 : 1) || de.compare(a.b.region || '', b.b.region || '') || de.compare(this._pkey(a.b.producer), this._pkey(b.b.producer)) || de.compare(a.b.name || '', b.b.name || ''),
        vintageAsc: (a, b) => a.minVint - b.minVint || de.compare(a.b.name || '', b.b.name || ''),
        countDesc: (a, b) => b.count - a.count || de.compare(a.b.name || '', b.b.name || ''),
        added: (a, b) => (b.added || '').localeCompare(a.added || '') || de.compare(a.b.name || '', b.b.name || ''),
        nameDesc: (a, b) => de.compare(b.b.name || '', a.b.name || '') || de.compare(b.b.producer || '', a.b.producer || ''),
        producerDesc: (a, b) => de.compare(this._pkey(b.b.producer), this._pkey(a.b.producer)) || de.compare(b.b.name || '', a.b.name || ''),
        regionDesc: (a, b) => (a.b.region ? 0 : 1) - (b.b.region ? 0 : 1) || de.compare(b.b.region || '', a.b.region || '') || de.compare(this._pkey(a.b.producer), this._pkey(b.b.producer)) || de.compare(a.b.name || '', b.b.name || ''),
        addedAsc: (a, b) => (a.added || '9').localeCompare(b.added || '9') || de.compare(a.b.name || '', b.b.name || ''),
        countAsc: (a, b) => a.count - b.count || de.compare(a.b.name || '', b.b.name || ''),
        drinkToDesc: (a, b) => (b.drinkTo === 9999 ? -1 : b.drinkTo) - (a.drinkTo === 9999 ? -1 : a.drinkTo) || de.compare(a.b.name || '', b.b.name || ''),
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
            <div class="sbi"></div>
            <div class="dlg" hidden></div>
          </div>
        </ha-card>`;
      this._head = this.shadowRoot.querySelector('.head');
      this._listEl = this.shadowRoot.querySelector('.list');
      this._azEl = this.shadowRoot.querySelector('.az');
      this._ptr = this.shadowRoot.querySelector('.ptr');
      { // scroll indicator for the list
        const sbi = this.shadowRoot.querySelector('.sbi'), l = this._listEl;
        this._sbiUpd = () => {
          const ov = l.scrollHeight - l.clientHeight;
          if (ov <= 2) { sbi.style.opacity = '0'; return; }
          const th = Math.max(24, l.clientHeight * l.clientHeight / l.scrollHeight);
          sbi.style.top = (l.offsetTop + (l.scrollTop / ov) * (l.clientHeight - th)) + 'px';
          sbi.style.height = th + 'px';
          sbi.style.left = (l.offsetLeft + l.offsetWidth - 5) + 'px';
          sbi.style.opacity = '1';
        };
        l.addEventListener('scroll', this._sbiUpd, { passive: true });
        if (window.ResizeObserver) new ResizeObserver(() => this._sbiUpd()).observe(l);
        if (window.MutationObserver) new MutationObserver(() => this._sbiUpd()).observe(l, { childList: true });
      }
      this._dlg = this.shadowRoot.querySelector('.dlg');
      // Collapse open filters when the user scrolls the list (real touch/wheel input only, not layout scrolling)
      const fold = () => {
        if (this._fixedHdr()) return;
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
        else if (this._autoFolded && !this._more && this._upAcc >= 24 && !this._fixedHdr()) { this._autoFolded = false; this._more = true; this._upAcc = 0; this._renderHead(); }
      }, { passive: true });
      // Only moving down the list folds the filters (finger up / wheel down); moving up unfolds them again (see the scroll listener)
      this._listEl.addEventListener('touchstart', (e) => { this._ty = this._ty0 = e.touches[0].clientY; }, { passive: true });
      this._listEl.addEventListener('touchmove', (e) => {
        const y = e.touches[0].clientY;
        // Scrolling the list = done typing: release the search field, otherwise every header rebuild (fold/unfold) focuses it again and the Android keyboard keeps popping up
        const ae = this.shadowRoot.activeElement;
        if (ae && ae.matches && ae.matches('input[type=search]') && Math.abs(y - (this._ty0 === undefined ? y : this._ty0)) > 8) ae.blur();
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
      this.shadowRoot.addEventListener('scroll', (e) => { if (this._det && this._det.dnote && !(e.target.closest && e.target.closest('.dnpop'))) this._dnoteClose(); }, true); // scrolling closes the drunk overlay
      this.shadowRoot.addEventListener('change', (e) => this._onChange(e));
      this.shadowRoot.addEventListener('pointerdown', (e) => this._onGrip(e));
      this.shadowRoot.addEventListener('input', (e) => this._onInput(e));
      this.shadowRoot.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this._dd) { this._dd = null; this._renderDlg(); return; }
        if (e.key === 'Escape' && this._wz && !this._wzIn) { if (this._wz.busy) return; this._wz = null; this._renderDlg(); return; }
        if (e.key === 'Escape' && this._set) { this._set = null; this._renderDlg(); return; }
        if (e.key === 'Escape' && this._det && !this._det.busy) { this._det = null; this._renderDlg(); return; }
        if (e.key === 'Enter' && e.target && e.target.matches && e.target.matches('input[type=search]')) {
          e.target.blur();
          if (this._qTimer) { clearTimeout(this._qTimer); this._qTimer = 0; this._renderAll(); } // typed just now: filter first
          const hits = this.shadowRoot.querySelectorAll('.list [data-act="detail"]'); // only one hit left: Enter opens its detail view
          if (hits.length === 1 && !this._det) ACTIONS.detail.call(this, hits[0]);
        }
      });
      this._renderAll();
      this._fit();
      setTimeout(() => this._fit(), 300);
      setTimeout(() => this._fit(), 1200);
    }

    _renderAll() {
      if (!this._built) return;
      if (this._keep()) this._saveState();
      this._applyMode();
      this.toggleAttribute('data-fullw', this._fullw());
      if (this._fs('hist').size) this.setAttribute('data-arch', ''); else this.removeAttribute('data-arch'); // archive on: the filter pills are highlighted in the archive colour (CSS)
      if (this._multi()) this.setAttribute('data-fm', this._fm()); else this.removeAttribute('data-fm'); // filter mode colour (CSS: green OR, red NOT)
      this.toggleAttribute('data-hdr2', true); this.setAttribute('data-hdrv', 'c'); // wide layout rules sit in a min-width media block; on the phone only the outlined filter chips apply
      this._renderHead();
      this._renderList();
    }
    // Flag hdr2 (wide only): filters on the left in two rows, tools and search stacked on the right; filters never fold
    // Filters stay open (folding on scroll down / re-opening on scroll up is switched off for now: set SCROLL_FOLD = true)
    // Phone (<=600px): folds on scroll only when the filters need more than one row (more than 4 pills)
    _fixedHdr() {
      if (this._nShown !== undefined && this._nShown <= 10) return true; // short list: nothing to hide
      if ((this._nChips || 0) > 4 && window.matchMedia && window.matchMedia('(max-width: 600px)').matches) return false;
      return !SCROLL_FOLD;
    }
    _hdr2() { return !(window.matchMedia && window.matchMedia('(max-width: 600px)').matches); }

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
      if (type === 'other') { // Other (not wine): three dots instead of a glass
        return `<svg class="tsp" viewBox="0 0 16 16" width="16" height="16"${title ? ` role="img" aria-label="${esc(title)}"` : ' aria-hidden="true"'}>` +
          `<circle cx="2.8" cy="8" r="1.7" fill="${col}"/><circle cx="8" cy="8" r="1.7" fill="${col}"/><circle cx="13.2" cy="8" r="1.7" fill="${col}"/></svg>`;
      }
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
    // Kind of a classification tier (data.classKinds: tier name or synonym, lower case, to kind; Cellarion's list_classifications)
    _clsKind(v) { return ((this._data && this._data.classKinds) || {})[String(v).toLowerCase()] || KIND_REST; }
    // Kinds in the order Cellarion lists them; the catch-all kind is always there, at the end
    _kinds() {
      const m = (this._data && this._data.classKinds) || (this._raw && this._raw.classKinds) || {}, r = [];
      Object.keys(m).forEach((n) => { if (m[n] !== KIND_REST && r.indexOf(m[n]) < 0) r.push(m[n]); });
      return r.concat([KIND_REST]);
    }
    // Pick list of one classification kind: alphabetical, not by count
    _optsCls(map, selected) {
      const opt = ([v, o]) => ({ v, t: `${v} (${o.f === 1 ? 1 : o.w + ' | ' + o.j + ' | ' + o.f})` });
      return Array.from(map.entries()).filter((x) => !selected || !selected.has(x[0])).sort((a, b) => de.compare(a[0], b[0])).map(opt);
    }
    // Own pick menu instead of the native Android list (it was sometimes black, sometimes transparent, shifted when zooming and pulled in the navigation bar)
    _renderDd() {
      const el = this._dlg, d = this._ddItems[this._dd];
      if (!d) { this._dd = null; el.hidden = true; el.innerHTML = ''; return; }
      el.innerHTML = `<div class="ddpop" role="listbox" aria-label="${esc(d.label)}">` + (d.hint ? `<div class="ddhint">${esc(d.hint)}</div>` : '') + (d.sel ? `<div class="ddsel"><span class="ddselt">${esc(t('dd.selected'))}: <b>${esc(d.sel)}</b></span><button type="button" class="ddx" data-act="ddclr" aria-label="${esc(t('dd.clear'))}">×</button></div>` : '') +
        (`<div class="ddlist">` + d.items.map((o) => o.sep ? '<div class="ddsep"></div>' : o.and ? `<div class="ddrow"><button type="button" class="ddi${o.v === d.curV ? ' cur' : ''}" role="option" data-act="ddpick" data-v="${esc(o.v)}">${esc(o.t)}</button><button type="button" class="ddand" data-act="ddand" data-v="${esc(o.v)}" title="${esc(t('filter.andAdd'))}" aria-label="${esc(t('filter.andAdd'))}">&amp;<small>(${o.nAnd})</small></button></div>` : `<button type="button" class="ddi${o.v === d.curV ? ' cur' : ''}" role="option" data-act="ddpick" data-v="${esc(o.v)}">${esc(o.t)}</button>`).join('') + `</div></div>`);
      el.hidden = false;
      const pop = el.firstElementChild, an = this._ddAnchor;
      if (!an || !an.isConnected) { pop.classList.add('c'); return; }
      const ov = el.getBoundingClientRect(), a = an.getBoundingClientRect(), m = 8;
      const wide = !!d.wide;
      const w = Math.min(Math.max(a.width, wide ? 340 : 220), wide ? 340 : 360, ov.width - 2 * m);
      // left half of the page: flush with the chip's left edge, right half: flush with its right edge
      const rightHalf = (a.left + a.right) / 2 - ov.left > ov.width / 2;
      const left = Math.max(m, Math.min(rightHalf ? a.right - ov.left - w : a.left - ov.left, ov.width - w - m));
      const below = ov.bottom - a.bottom - m - 4, above = a.top - ov.top - m - 4;
      // The list sits inside the zoomed .wrap: rects are measured on screen, styles are set in unzoomed px (divide by the card scale)
      const z = this._scale || 1, px = (v) => (v / z) + 'px';
      pop.style.width = px(w);
      pop.style.left = px(left);
      if (below >= 220 || below >= above) { pop.style.top = px(a.bottom - ov.top + 4); pop.style.maxHeight = px(Math.max(120, below)); }
      else { pop.style.bottom = px(ov.bottom - a.top + 4); pop.style.maxHeight = px(Math.max(120, above)); }
      return;
    }

    _renderHead() {
      this._hdrAt = Date.now(); // layout changes of the header must not count as scrolling
      if (!this._head) return;
      const d = this._data, f = this._f, c = this._cfg;
      this._ddItems = {};
      const nAct = this._nAct();
      const active = (f.q ? 1 : 0) + nAct + (this._multi() ? 1 : 0) > 1; // a single filter or the search is removed by its own cross; reset only for several (the NOT/OR mode pill counts as one)
      const gear = `<button class="btn round gear" data-act="setopen" title="${esc(t('head.settings'))}" aria-label="${esc(t('head.settings'))}">` +
        `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7m7.4-2.5c.04-.33.1-.66.1-1s-.06-.67-.1-1l2.1-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.6-.22l-2.5 1a7.3 7.3 0 0 0-1.7-1l-.38-2.65A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42L9.12 5.07a7.3 7.3 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64L4.6 11c-.04.33-.1.66-.1 1s.06.67.1 1l-2.1 1.65a.5.5 0 0 0-.12.64l2 3.46c.13.22.39.3.6.22l2.5-1c.52.4 1.08.73 1.7 1l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.62-.27 1.18-.6 1.7-1l2.5 1c.23.09.47 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64z"/></svg></button>`;
      const stat = `<button class="btn round st" data-act="statopen" title="${esc(t('stat.title'))}" aria-label="${esc(t('stat.title'))}">` +
        `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>`;
      const rlTxt = String(t('head.reload')).replace(/^\s*↻\s*/, '');
      const reload = `<button class="btn round rl" data-act="reloadask" title="${esc(this._busy ? t('head.loading') : rlTxt)}" aria-label="${esc(rlTxt)}" ${this._busy ? 'disabled' : ''}>${this._busy ? '…' : '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"/></svg>'}</button>`;
      // Several cellars: the cellar name becomes a pulldown (one cellar or all together)
      const multi = !!(d && d.multi);
      if (multi) {
        const items = d.cellars.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), I18N.lang, { sensitivity: 'base', numeric: true })) // alphabetical; the start cellar stays the first one delivered
          .map((x) => ({ v: x.id, t: `${x.name} (${x.n})` }));
        items.unshift({ v: 'all', t: `${t('cellar.all')} (${d.cellars.reduce((n, x) => n + x.n, 0)})` }, { sep: true }); // all cellars on top, the single cellars below
        const cur = items.find((o) => o.v === d.cellarSel) || items[0];
        this._ddItems.cellarsel = { label: t('cellar.title'), items, cur: cur.t, curV: cur.v };
      }
      const ttl = c.title || (!multi && c.header_cellar === false && this._data && this._data.cellar) || ''; // otherwise the cellar name is shown in the page header
      const cname = this._data && this._data.cellar ? this._data.cellar : '';
      const cnameHtml = !cname ? '' : multi
        ? `<span class="cname"><button type="button" class="sel cnsel" data-act="dd" data-id="cellarsel" aria-haspopup="listbox" aria-label="${esc(t('cellar.title'))}">${esc(cname)}</button></span>`
        : `<span class="cname">${esc(cname)}</span>`;
      let html = `<div class="top">${ttl ? `<span class="title">${esc(ttl)}</span>` : ''}${cnameHtml}`;
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
        const sortBtn = (() => {
            // One entry per sort criterion: the first tap sorts in its natural direction, a second tap on the active entry reverses it (arrow = direction of the values)
            const base = SORT_BASE[this._sort] || this._sort, arrow = (v) => (SORT_ARROW[v] ? ' ' + SORT_ARROW[v] : '');
            const so = ['name', 'producer', 'region', 'drinkTo', 'vintage', 'price', 'count', 'added'].map((v) => ({ v, t: t('sort.' + v) + (v === base ? arrow(this._sort) : SORT_PAIR[v] ? arrow(SORT_PAIR[v][0]) : '') })); // inactive entries show the arrow of their first tap
            const cur = (so.find((o) => o.v === base) || so[0]);
            this._ddItems.sort = { label: t('sort.title'), items: so, cur: cur.t, curV: cur.v };
            return `<button type="button" class="sel" data-act="dd" data-id="sort" aria-haspopup="listbox" aria-label="${esc(t('sort.title'))}">${esc(cur.t)}</button>`;
        })();
        html += `<div class="search${f.q ? ' has' : ''}"><input type="search" inputmode="search" enterkeyhint="search" autocomplete="off" ` +
          `placeholder="${(window.matchMedia && window.matchMedia('(max-width: 600px)').matches) || this._hdr2() ? esc(t('head.searchShort')) : esc(t('head.search'))}" value="${esc(f.q)}"><button class="x" data-act="clearq" aria-label="${esc(t('head.clearSearch'))}">✕</button></div>` +
          stat + reload + gear + `</div>`;
        const vis = this._orderedDefs(), hid = this._allDefs().filter((d) => this._fh.has(d.id) && !this._fh.has('off:' + d.id)); // filters set to "off" are not offered at all
        // Hidden filters (settings) only count when there is something to choose right now (or a value is chosen): no greyed-out ones behind the "..." button, and no button when it would only open greyed-out ones
        const useful = (d) => { if (this._fs(d.id).size) return true; const m = cnt3(d.id, d.get); return m.size > 0 && !(m.size === 1 && Array.from(m.values())[0].f === this._filtered(d.id).length); };
        const hidUse = hid.filter(useful);
        const moreBtn = true; // the "..." button always exists now: behind it sit the hidden filters (if any) and the filter mode pulldown
        const extra = new Set((this._showHid ? hidUse : hid.filter((d) => this._fs(d.id).size)).map((d) => d.id)), visS = new Set(vis.map((d) => d.id));
        const defs = this._allDefs().filter((d) => visS.has(d.id) || extra.has(d.id)); // filters behind "..." keep their place in the sort order when opened (not appended at the end)
        const t3 = {};
        defs.forEach((d) => { t3[d.id] = cnt3(d.id, d.get); });
        const by = (x, y) => de.compare(x[0], y[0]);
        // Filters without options under the current selection stay in place, greyed out (instead of disappearing); filters that have no values at all stay hidden
        const anyV = {};
        const hasAny = (d) => anyV[d.id] !== undefined ? anyV[d.id] : (anyV[d.id] = this._data.bottles.some((b) => [].concat(d.get(b)).some((v) => v)));
        // Filter mode pulldown (Standard / OR / NOT): shown when the further filters are open, and always while OR or NOT is active
        const fmShow = !this._fh.has('fmode:off') && (this._showHid || this._multi() || this._fh.has('fmode:show')); // settings (Filters): visible / behind "..." (default) / off
        let fmChip = '';
        if (fmShow) {
          const fmItems = ['std', 'or', 'not'].map((v) => ({ v, t: t('fmode.' + v) }));
          const fmCur = fmItems.find((o) => o.v === this._fm());
          this._ddItems.fmode = { label: t('fmode.title'), items: fmItems, cur: fmCur.t, curV: fmCur.v, hint: t('fmode.hint') };
          fmChip = `<button type="button" class="sel fs fm${this._multi() ? ' hasv' : ''}" data-act="dd" data-id="fmode" aria-haspopup="listbox" aria-label="${esc(t('fmode.title') + ': ' + fmCur.t)}">${esc(this._multi() ? fmCur.t : t('fmode.title'))}</button>`;
        }
        // Flag history: pull-down "Stock / Archive" (the list shows the cellar or only the used-up wines), as long as the consumption log has entries
        const hSet = this._fs('hist');
        const hSt = this._fh.has('src:off') ? 'off' : this._fh.has('src:more') ? 'more' : 'vis'; // settings (Filters): visible (default) / behind "..." / off
        if (hSt === 'off' && hSet.size) hSet.clear();
        const hOn = !!(d.history && d.history.length) && hSt !== 'off' && (hSt === 'vis' || this._showHid || !!hSet.size);
        // the pill looks like a switch (track with knob): tap = archive on / off
        const histChip = hOn ? `<button type="button" class="sel fs swp${hSet.size ? ' hasv on' : ''}" role="switch" data-act="histtoggle" aria-checked="${hSet.size ? 'true' : 'false'}" aria-label="${esc(t('filter.history'))}"><span class="swt" aria-hidden="true"><i></i></span>${esc(t('filter.history'))}</button>` : '';
        const nChips = defs.filter((d) => t3[d.id].size || this._fs(d.id).size || hasAny(d)).length + (moreBtn ? 1 : 0) + (fmShow ? 1 : 0) + (hOn ? 1 : 0);
        this._nChips = nChips;
        html += `<div class="fwrap${this._more || this._fixedHdr() ? ' fopen' : ''}"><div class="more open" style="--fcols:${Math.max(4, Math.ceil(nChips / 2))}">` +
          defs.map((d) => {
            const m = t3[d.id], set = this._fs(d.id);
            if (!m.size && !set.size) return hasAny(d) ? `<button type="button" class="sel fs dis" disabled aria-label="${esc(d.label)}">${esc(d.label)}</button>` : '';
            // nothing chosen yet and every bottle shown has the one remaining value: choosing it would change nothing
            if (!set.size && m.size === 1 && Array.from(m.values())[0].f === this._filtered(d.id).length) return `<button type="button" class="sel fs dis" disabled aria-label="${esc(d.label)}">${esc(d.label)}</button>`;
            const items = d.defs ? this._optsK(d.defs, m, set) : d.clsg !== undefined ? this._optsCls(m, set) : this._opts(m, set, d.sort || by);
            if (d.id === 'grape' && set.size && !this._multi()) { const co = new Map(); this._filtered(null, 'grape').forEach((b) => (b.grapes || []).forEach((g) => { if (!co.has(g)) co.set(g, new Set()); co.get(g).add(b.wine); })); items.forEach((o) => { if (o.v !== undefined) { o.and = co.has(o.v); o.nAnd = o.and ? co.get(o.v).size : 0; } }); } // & only where the grape occurs together with the chosen ones, with the number of wines that would remain
            this._ddItems[d.id] = { label: d.label, items, cur: '', hint: t('dd.countHint'), wide: d.id === 'grape' && !!set.size && !this._multi(),
              sel: set.size ? Array.from(set).map((v) => (d.defs ? (d.defs.find((x) => x[0] === v) || [0, v])[1] : v)).join(d.id === 'grape' && !this._multi() ? ' & ' : ', ') : '' };
            return `<button type="button" class="sel fs${set.size ? ' hasv' : ''}" data-act="dd" data-id="${esc(d.id)}" aria-haspopup="listbox" aria-label="${esc(d.label)}">${esc(d.label)}</button>`;
          }).join('') + fmChip + histChip + `<span class="fend">` + (moreBtn ? `<button type="button" class="sel fs more-pill${this._showHid ? ' open' : ''}" data-act="showhid" aria-expanded="${this._showHid ? 'true' : 'false'}" aria-label="${esc(this._showHid ? t('head.moreHide') : t('head.moreShow'))}">…</button>` : '') +
          `</span></div></div>`;
        const ic = (dot) => this._dotIc(dot);
        // OR / NOT: one leading mode pill (with a cross to go back to standard) instead of a prefix in every pill
        const fmPill = this._multi() ? `<button class="fpill fmpill" data-act="fmoff" aria-label="${esc(t('fmode.title') + ': ' + t('fmode.' + this._fm()))}">${esc(t('fmode.' + this._fm()))}<span class="x">✕</span></button>` : '';
        const histPill = hOn && hSet.size ? `<button class="fpill hpill" data-act="fdel" data-g="hist" data-v="1" aria-label="${esc(t('head.removePill', { label: t('filter.history') }))}">${esc(t('filter.history'))}<span class="x">✕</span></button>` : '';
        const pills = histPill + fmPill + defs.map((d) => this._pillWrap(d, Array.from(this._fs(d.id)).map((v) => {
          const label = d.defs ? (d.defs.find((x) => x[0] === v) || [0, v])[1] : v;
          return `<button class="fpill" data-act="fdel" data-g="${esc(d.id)}" data-v="${esc(v)}" aria-label="${esc(t('head.removePill', { label }))}">${d.dot ? ic(d.dot + v) : ''}` +
            `${d.personal ? esc(d.label) + ': ' : ''}${esc(label)}<span class="x">✕</span></button>`;
        }).join(this._pillSep(d)))).join('');
        html += `<div class="fpills">${pills}<button class="btn round sm on" data-act="reset" data-reset title="${esc(t('head.resetFilters'))}" aria-label="${esc(t('head.resetFilters'))}"${active ? '' : ' hidden'}>✕</button></div>`;
        html += `<div class="sumline"><span class="grow" data-sum></span>${sortBtn}</div>`;
      }
      if (this._ptr && !this._pulling) { this._ptr.style.height = this._busy ? '24px' : '0px'; this._ptr.textContent = this._busy ? t('head.loading') : ''; }
      // Keep focus and cursor in the search field when the header is rebuilt
      const input = this._head.querySelector('input[type=search]');
      const hadFocus = input && this.shadowRoot.activeElement === input;
      const pos = hadFocus ? input.selectionStart : 0;
      this._head.innerHTML = html;
      const sm = this._sumTxt && this._head.querySelector('[data-sum]'); // the summary line is filled by _renderList; restore after a header rebuild
      if (sm) sm.textContent = this._sumTxt;
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
      // All cellars together: every place carries its cellar (tag in front); the key is "cellar<SEP>place"
      const A = this._allCellars(), SEP = '\u0001';
      const L = (k) => (A ? k.slice(k.indexOf(SEP) + 1) : k), C = (k) => (A ? k.slice(0, k.indexOf(SEP)) : '');
      const tag = (k) => (C(k) ? `<span class="ctag">${esc(C(k))}</span>` : '');
      const cmp = (a, b) => (L(a[0]) === NO_LOC) - (L(b[0]) === NO_LOC) || de.compare(C(a[0]), C(b[0])) || de.compare(L(a[0]), L(b[0]));
      const m = new Map();
      // Phone: only the rack name in the list (no shelf, no left/middle/right); places of the same rack are counted together
      const mob = !!(window.matchMedia && window.matchMedia('(max-width: 600px)').matches);
      const rk = (l) => (mob && l !== NO_LOC && l ? String(l).split(' · ')[0] : l);
      bottles.forEach((b) => { const k = (A ? (b._cn || '') + SEP : '') + rk(b._loc); m.set(k, (m.get(k) || 0) + 1); });
      const inRow = brief === true;
      if (brief && m.size === 1) brief = 'one'; else brief = '';
      if (inRow && m.size > 1) {
        // Several places in the wine row: summarise per rack (rack ×count), details are on the detail page
        const r = new Map();
        m.forEach((n, k) => { const l = L(k), key = (A ? C(k) + SEP : '') + (l === NO_LOC ? NO_LOC : l.split(' · ')[0]); r.set(key, (r.get(key) || 0) + n); });
        return Array.from(r.entries()).sort(cmp)
          .map(([k, n]) => `<span class="loc${L(k) === NO_LOC ? ' none' : ''}">${tag(k)}${this._lt(L(k) === NO_LOC ? t('loc.noneShort') : L(k))}<b>×${n}</b></span>`).join('');
      }
      return Array.from(m.entries()).sort(cmp)
        .map(([k, n]) => `<span class="loc${L(k) === NO_LOC ? ' none' : ''}">${tag(k)}${this._lt(L(k) === NO_LOC ? t('loc.noneShort') : L(k))}${!brief && (bottles.length > 1 || n > 1) ? `<b>×${n}</b>` : ''}</span>`).join('');
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
      const hm = this._histMode();
      const bottles = this._filtered();
      const entries0 = this._entries(bottles);
      let entries = entries0, nHist = 0;
      // Flag history: a search with fewer than 5 rows also shows the matching drunk vintages (dimmed vintage rows)
      if (!hm && String(this._f.q || '').trim() && this._data.history && this._data.history.length) {
        const rows = this._view === 'flat' ? entries0.length : this._groups(entries0).length;
        if (rows < Math.max(1, this._archN())) { // setting Archive: below N stock hits the search also shows archive rows (0 = only without any stock hit)
          const inStock = new Set(this._data.bottles.map((b) => b.wine || b.name)); // only wines with no bottle left in the cellar
          const he = this._entries(this._filtered(null, null, 'hist')).filter((e) => !inStock.has(e.wine));
          nHist = he.reduce((n, e) => n + e.bottles.length, 0);
          entries = entries0.concat(he);
        }
      }
      let html = '';
      let nWine;
      if (this._view === 'flat') {
        nWine = new Set(entries.map((e) => e.wine)).size;
        html = entries.sort((a, b) => this._cmpEntries(a, b)).map((e) => this._azAnchor(e.b) + this._flatRow(e)).join('');
      } else {
        const groups = this._groups(entries);
        nWine = groups.length;
        const hk = { vintage: (g) => (g.maxVint > 0 ? String(g.maxVint) : 'NV'), vintageAsc: (g) => (g.minVint < 99999 ? String(g.minVint) : 'NV'),
          region: (g) => g.b.region || t('list.noRegion'), regionDesc: (g) => g.b.region || t('list.noRegion') }[this._sort];
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
      if (!entries.length) html = `<div class="msg">${esc(t('list.empty'))}</div>`;
      el.innerHTML = html;
      el.scrollTop = top;
      this._renderAz();
      const f = this._f;
      const rst = this._head && this._head.querySelector('[data-reset]');
      if (rst) {
        rst.hidden = !((f.q ? 1 : 0) + this._nAct() > 1);
      }
      // Scroll-to-hide of the filters only makes sense for a longer list: up to 10 entries the header stays; an already folded header unfolds
      this._nShown = this._view === 'flat' ? entries.length : nWine;
      if (this._nShown <= 10 && this._autoFolded && !this._more) { this._autoFolded = false; this._more = true; this._renderHead(); }
      const sum = this._head && this._head.querySelector('[data-sum]');
      if (sum) {
        const all = this._hideOther() ? this._data.bottles.filter((b) => b._type !== 'other').length : this._data.bottles.length;
        const sw = nHist ? new Set(entries0.map((e) => e.wine)).size : nWine; // the extra drunk rows of a search are not counted as wines or vintages
        sum.textContent = `${t('count.wines', { n: sw })} · ${t('count.vintages', { n: entries0.length })} · ${hm ? t('hist.drunkN', { n: bottles.length }) : t('count.bottles', { n: bottles.length })}` + (!hm && bottles.length !== all ? ' ' + t('count.of', { all }) : '') +
          (nHist ? ' · ' + t('hist.more', { n: nHist }) : '') + (this._error ? ' · ' + t('count.loadError') : '');
        this._sumTxt = sum.textContent;
      }
    }

    // A-Z bar: only for wine A-Z / producer A-Z. Letter = start of the wine name or of the producer's sort word.
    _sb() { return SORT_BASE[this._sort] || this._sort; } // menu entry of the current sort (both directions)
    _azKey(b) {
      const k = norm(this._sb() === 'producer' ? this._pkey(b.producer) : b.name).replace(/[^a-z0-9]/g, '').charAt(0);
      return k >= 'a' && k <= 'z' ? k.toUpperCase() : '#';
    }
    _azAnchor(b) {
      if (this._sb() !== 'name' && this._sb() !== 'producer') return '';
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
      const on = (this._sb() === 'name' || this._sb() === 'producer') && this._data && this._az.size > 0;
      bar.hidden = !on;
      if (!on) { bar.innerHTML = ''; return; }
      const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      const rev = /Desc$/.test(this._sort); // reversed sort: mirrored bar (Z to A, # at the end)
      if (rev) L.reverse();
      if (this._az.has('#')) { if (rev) L.push('#'); else L.unshift('#'); }
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
        // header layout c (wide): list and header are 18px wider than the alphabet bar, so the bottle count ('Fl.') ends under the letter Z
        if (v && /px$/.test(v) && !(window.matchMedia && window.matchMedia('(max-width: 600px)').matches)) v = (parseFloat(v) + 18) + 'px';
        list.style.maxWidth = v;
        bar.style.maxWidth = !(window.matchMedia && window.matchMedia('(max-width: 600px)').matches) ? v : ''; // the alphabet bar is part of the lighter header band, same width
        this.shadowRoot.querySelectorAll('.head, .top, .fwrap, .fpills, .sumline').forEach((e) => { e.style.maxWidth = ''; });
        others.forEach((e) => { e.style.maxWidth = v; });
      };
      if (this._fullw()) { set(''); return; } // setting fullw (this device only): no width limit, list and header use the whole width
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
      const toks = this._qToks();
      if (!toks.length) return esc(text);
      let n = '';
      const map = [];
      Array.from(text).forEach((ch, i) => { const x = norm(ch); for (let k = 0; k < x.length; k++) { n += x[k]; map.push(i); } });
      const chars = Array.from(text);
      const on = new Array(chars.length).fill(false);
      toks.forEach((t) => {
        let at = wordAt(n, t);
        while (at >= 0) { for (let k = at; k < at + t.length; k++) on[map[k]] = true; at = wordAt(n, t, at + 1); }
      });
      let out = '', open = false;
      chars.forEach((ch, i) => {
        if (on[i] !== open) { out += open ? '</mark>' : '<mark class="hl">'; open = on[i]; }
        out += esc(ch);
      });
      return out + (open ? '</mark>' : '');
    }
    _typeDot(b) {
      return this._glass(b._type || 'white', typeLbl(b._type));
    }
    _sub(b) { return b.region || ''; }
    // Price of the bottles (in the currency of the data): one value or from-to; empty if none is known
    _priceTxt(bottles) {
      const v = (bottles || []).filter((b) => typeof b.price === 'number' && b.price > 0 && (!b.currency || b.currency === CUR)).map((b) => b.price);
      if (!v.length || !CUR) return '';
      const f = (x) => new Intl.NumberFormat(I18N.lang || 'de', { maximumFractionDigits: Number.isInteger(x) ? 0 : 2, minimumFractionDigits: Number.isInteger(x) ? 0 : 2 }).format(x);
      const lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
      const sym = (x) => { try { return new Intl.NumberFormat(I18N.lang || 'en', { style: 'currency', currency: CUR, currencyDisplay: 'narrowSymbol', maximumFractionDigits: Number.isInteger(x) ? 0 : 2, minimumFractionDigits: Number.isInteger(x) ? 0 : 2 }).format(x).replace(/\s/g, '\u00a0'); } catch (e) { return f(x) + '\u00a0' + CUR; } };
      return lo === hi ? sym(lo) : f(lo) + '–' + sym(hi);
    }
    _priceSpans(bottles) {
      const p = this._priceTxt(bottles);
      return p ? { d: `<span class="wreg wprice wpd">${esc(p)}</span>` } : { d: '' };
    }
    // With sorting "producer A-Z" and a maintained sort word: its first letter in bold (H for "Fritz Haag")
    _prodHtml(name) {
      const i = this._sortMap && this._sortMap[name];
      const w = this._words(name);
      if (this._sb() !== 'producer' || i === undefined || !(i >= 0 && i < w.length)) return this._hl(name);
      return w.map((x, k) => (k === i ? `<b class="wsl">${esc(x.charAt(0))}</b>${esc(x.slice(1))}` : esc(x))).join(' ');
    }
    // Line 1: wine name and producer, line 2: the info items (setting "Info in the list"). The price is vintage info and sits
    // on the right of the row, so it is only added here where there is no vintage (single is undefined: flat list, detail header).
    // Every item is one unit with its own trailing dot, so a line break falls between the items.
    _title(b, pr, single, detail) {
      pr = pr || '';
      const txt = (d) => {
        if (d.id === 'price') return this._priceOnly(pr);
        if (d.clsg !== undefined) { const c = (b._cls || []).filter((v) => this._clsKind(v) === d.clsg); return c.length ? this._hl(c.join(', ')) : ''; }
        if (d.id === 'country') return b.country ? this._hl(b.country) : '';
        if (d.id === 'region') return b.region ? this._hl(b.region) : '';
        if (d.id === 'appellation') return b.appellation ? this._hl(b.appellation) : '';
        if (d.id === 'sweetness') return b.sweetness ? this._hl(b.sweetness) : '';
        if (d.id === 'grape') return b.grapes && b.grapes.length ? this._hl(b.grapes.join(', ')) : '';
        const v = b.p && b.p[d.label];
        return v ? this._hl([].concat(v).map((x) => this._fmtVal(x)).join(', ')) : '';
      };
      const swap = this._sb() === 'producer' && b.producer;
      const vj = detail && b.vintage && String(b.vintage).toUpperCase() !== 'NV' ? `<span class="wvj">${esc(b.vintage)}</span> ` : ''; // detail header (flag detrows): the vintage always in front of the wine name, empty without one
      const head = swap ? [['wprod', this._prodHtml(b.producer)], ['wname', vj + this._hl(b.name)]]
        : [['wname', vj + this._hl(b.name)]].concat(b.producer ? [['wprod', this._prodHtml(b.producer)]] : []);
      const infos = this._infoDefs().filter((d) => this._is.has(d.id) && !detail && (d.id !== 'price' || single === undefined)).map((d) => ['wreg', txt(d)]).filter((x) => x[1]);
      const all = head.concat(infos);
      const html = all.map((x, i) => `<span class="${x[0]} wit${i < all.length - 1 ? ' d' : ''}${i === head.length - 1 ? ' e' : ''}">${x[1]}</span>`);
      return `<span class="wtitle${swap ? ' swap' : ''}"><span class="wl1">${html.slice(0, head.length).join('')}</span><span class="wl2">${html.slice(head.length).join('')}</span></span>`;
    }

    // Drunk entry (flag history): reason and date of the last bottle, rating, number of bottles; the note is the tooltip
    _histInfo(e) {
      const hs = e.bottles.slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
      const h = hs[0] || {};
      let date = '';
      try { date = h.at ? new Intl.DateTimeFormat(I18N.lang || 'de', { dateStyle: 'medium' }).format(new Date(h.at)) : ''; } catch (x) { date = String(h.at || '').slice(0, 10); }
      const rk = 'hist.reason.' + (h.reason || 'drank');
      const why = I18N.dict[rk] !== undefined ? t(rk) : String(h.reason || '');
      const rt = typeof h.rating === 'number' ? ' · ' + (h.scale && !/star/i.test(h.scale) ? h.rating + ' ' + h.scale : '★ ' + h.rating) : '';
      const tip = (hs.map((x) => x.note).filter(Boolean)[0]) || '';
      return `<span class="hinfo"${tip ? ` title="${esc(tip)}"` : ''}>✓ ${esc(why + (date ? ' ' + date : '') + rt + (hs.length > 1 ? ' ×' + hs.length : ''))}</span>`;
    }

    _groupRow(g) {
      const open = this._open.has(g.id);
      const asc = g.entries.slice().reverse();
      const vints = asc.map((e) => `<span class="yv${e.hist ? ' hv' : ''}" style="--yc:var(--s-${e.status})">${esc(e.vintage)}</span>`).join(' · ');
      if (g.entries.length === 1 && g.entries[0].hist) {
        // Only drunk: one dimmed row, not tappable
        const e = g.entries[0];
        return `<div class="wine hist"><div class="wrow hrow" data-act="detail" data-h="1" data-w="${esc(e.wine)}" data-v="${esc(e.vintage)}" role="button" tabindex="0">${this._typeDot(g.b)}<span class="wmain">${this._title(g.b, this._priceSpans(e.bottles).d, true)}</span>` +
          `<span class="wright"><span class="wloc locs">${this._histInfo(e)}</span><span class="wvint yv hv" style="--yc:var(--s-${e.status})">${esc(e.vintage)}</span>` +
          (this._is.has('price') && this._priceOnly(this._priceSpans(e.bottles).d) ? `<span class="wpm">${this._priceOnly(this._priceSpans(e.bottles).d)}</span>` : '') +
          `<span class="wcount">${esc(t('hist.drunkN', { n: e.bottles.length })).replace(/ /g, '&nbsp;')}</span><span class="chev">›</span></span></div></div>`;
      }
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
      let html = `<div class="wine${g.count ? '' : ' hist'}"><button class="wrow" data-act="toggle" data-id="${esc(g.id)}" aria-expanded="${open}">` +
        this._typeDot(g.b) +
        `<span class="wmain">${this._title(g.b, ps.d, true)}</span>` +
        `<span class="wright"><span class="wvint multi">${vints}</span>` +
        `<span class="wcount">${(g.count ? esc(t('count.bottlesShort', { n: g.count })) : esc(t('hist.drunkN', { n: g.hn }))).replace(/ /g, '&nbsp;')}</span><span class="chev">${open ? '▾' : '▸'}</span></span></button>`;
      if (open) {
        html += `<div class="vlist">` + g.entries.map((e) => {
          if (e.hist) return `<div class="vrow hrow" data-act="detail" data-h="1" data-w="${esc(e.wine)}" data-v="${esc(e.vintage)}" role="button" tabindex="0"><span class="vyear yv hv" style="--yc:var(--s-${e.status})">${esc(e.vintage)}</span><span class="vmid">${this._histInfo(e)}</span></div>`;
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
      if (e.hist) {
        return `<div class="frow hrow" data-act="detail" data-h="1" data-w="${esc(e.wine)}" data-v="${esc(e.vintage)}" role="button" tabindex="0">${this._typeDot(e.b)}<span class="fyear yv hv" style="--yc:var(--s-${e.status})">${esc(e.vintage)}</span>` +
          `<span class="fmid">${this._title(e.b, '')}<span class="locs">${this._histInfo(e)}</span></span>` +
          `<span class="vstat">${this._sdot(e.status)}${esc(STATUS_LABEL.drunk)}</span></div>`;
      }
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
    // ---------- Statistics (computed from the bottle list of the card, whole cellar) ----------
    _statData() {
      const d = this._data;
      if (!d) return null;
      const noOther = !this._showOther(); // the statistics follow the setting "show Other in the list": off = Other items (not wine) are left out here too
      if (this._statC && this._statC.d === d && this._statC.no === noOther) return this._statC.v;
      const bs = noOther ? d.bottles.filter((b) => b._type !== 'other') : d.bottles;
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
        total: bs.length, wines, currency, value, items: bs,
        types: arr(grp((b) => b._type)), countries: arr(grp((b) => b.country)), regions: arr(grp((b) => b.region)),
        producers: arr(grp((b) => b.producer)), grapes: arr(grp((b) => b.grapes || [])), vintages: vint,
        regionsOf, priceBands: pb, byTypeVal: arr(byTypeVal), valBy: { producer: arr(vb.producer), country: arr(vb.country), region: arr(vb.region), vintage: arr(vb.vintage) },
        oldest: vint.size ? Math.min(...Array.from(vint.keys()).map(Number)) : null,
      };
      this._statC = { d, v, no: noOther };
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
            sec = { rows: S.byTypeVal.map(([k, v]) => ({ label: typeLbl(k), n: v, text: fmt(v), dot: k, filter: ['types', k] })), total: 0, limit: 99 };
          } else {
            const g = { producer: 'producer', country: S.scoped ? 'country' : null, region: 'region', vintage: 'vintage' }[tab];
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
    // Statistics: drill-downs behind the tiles of the "Drunk" page (drunk wines, gifted, wines / producers without stock)
    _statDrunkPage(key, S) {
      const H = this._statHist(), all = this._stat && this._stat.all, lim = 15;
      const top = (list) => (all || list.length <= lim ? list : list.slice(0, lim));
      const byN = (a, b) => b.n - a.n || de.compare(a.name, b.name);
      const wrows = (list) => ({ rows: top(list).map((w) => ({ label: w.name, sub: w.producer, n: w.n, filter: ['q', w.name] })), total: list.length, limit: lim });
      const goneW = Array.from(H.wines.entries()).filter(([k]) => !S.wines.has(k)).map(([, w]) => w);
      const num = (n) => new Intl.NumberFormat(I18N.lang || 'de').format(n);
      const rLbl = (r) => (I18N.dict['hist.reason.' + r] !== undefined ? t('hist.reason.' + r) : String(r)); // consumption types come from the data
      const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
      if (key.startsWith('d:r:')) {
        const r = key.slice(4), items = H.items.filter((h) => (h.reason || 'drank') === r);
        if (r === 'drank') { // drunk: the wines drunk most
          const m = new Map();
          items.forEach((h) => { const id = h.wine || h.name; const w = m.get(id) || { name: h.name, producer: h.producer, n: 0 }; w.n++; m.set(id, w); });
          return { title: cap(rLbl(r)), sections: [wrows(Array.from(m.values()).sort(byN))] };
        }
        // Every other type (gifted, sold ...): one row per bottle, the note of the consumption instead of a bar, the date instead of the count
        const list = items.slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
        return { title: cap(rLbl(r)), sections: [{ rows: top(list).map((h) => ({ label: h.name, sub: h.producer, n: 1, note: h.note, text: h.at ? this._fmtDate(h.at) : '', filter: ['q', h.name] })), total: list.length, limit: lim }] };
      }
      switch (key) {
        case 'd:wines': return { title: t('stat.wines'), sections: [wrows(Array.from(H.wines.values()).sort(byN))] };
        case 'd:gonew': return { title: t('stat.goneWines'), sections: [wrows(goneW.slice().sort(byN))] };
        case 'd:reasons': {
          const sorted = H.items.slice().sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')));
          const yrs = new Map();
          sorted.forEach((h) => { const y = String(h.at || '').slice(0, 4); if (!/^\d{4}$/.test(y)) return; const o = yrs.get(y) || { n: 0, by: new Map() }; o.n++; const r = h.reason || 'drank'; o.by.set(r, (o.by.get(r) || 0) + 1); yrs.set(y, o); });
          return { title: t('stat.consumption'), sections: [
            { rows: H.reasons.map(([r, n]) => ({ label: rLbl(r), n, go: 'd:r:' + r })), total: 0, limit: 99 },
            { head: t('stat.recent'), rows: sorted.slice(0, 8).map((h) => ({ label: h.name, sub: h.producer, n: 1, note: h.note || ((h.reason || 'drank') === 'drank' ? '' : rLbl(h.reason)), text: h.at ? this._fmtDate(h.at) : '', filter: ['q', h.name] })), total: 0, limit: 99 },
            { head: t('stat.perYear'), rows: Array.from(yrs.entries()).sort((x, y) => y[0].localeCompare(x[0])).map(([y, o]) => ({ label: y, n: o.n, text: num(o.n) + Array.from(o.by.entries()).filter(([r]) => r !== 'drank').map(([r, n]) => ' · ' + num(n) + ' ' + rLbl(r)).join('') })), total: 0, limit: 99 },
          ] };
        }
        case 'd:gonep': {
          const stockProd = new Set(S.producers.map((x) => x[0])), m = new Map();
          goneW.forEach((w) => { if (!w.producer || stockProd.has(w.producer)) return; const o = m.get(w.producer) || { name: w.producer, n: 0 }; o.n += w.n; m.set(w.producer, o); });
          const list = Array.from(m.values()).sort(byN);
          return { title: t('stat.goneProducers'), sections: [{ rows: top(list).map((w) => ({ label: w.name, n: w.n, filter: ['producer', w.name] })), total: list.length, limit: lim }] };
        }
      }
      return { title: '', sections: [] };
    }
    // Statistics: type drill-down for "Drunk" and "Total": the most important wines, producers, countries and vintages of one wine type
    _statTypePage(k, scope, S) {
      const H = this._statHist(), items = (scope === 'arch' ? H.items : S.items.concat(H.items)).filter((b) => !k || (b._type || '') === k);
      const cnt = (fn) => { const m = new Map(); items.forEach((b) => { const x = fn(b); if (x) m.set(x, (m.get(x) || 0) + 1); }); return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || de.compare(String(a[0]), String(b[0]))); };
      const wm = new Map();
      items.forEach((b) => { const id = b.wine || b.name; const w = wm.get(id) || { name: b.name, producer: b.producer, n: 0 }; w.n++; wm.set(id, w); });
      const wl = Array.from(wm.values()).sort((a, b) => b.n - a.n || de.compare(a.name, b.name)).slice(0, 8);
      const sec = (head, list, g) => ({ head, rows: list.map(([x, n]) => ({ label: x, n, filter: [g, x] })), total: 0, limit: 99 });
      return { title: k ? typeLbl(k) : t('stat.sc.all'), sections: [
        { head: t('stat.wines'), rows: wl.map((w) => ({ label: w.name, sub: w.producer, n: w.n, filter: ['q', w.name] })), total: 0, limit: 99 },
        sec(t('stat.producers'), cnt((b) => b.producer).slice(0, 8), 'producer'),
        sec(t('stat.countries'), cnt((b) => b.country), 'country'),
        sec(t('stat.vintages'), cnt((b) => (/^\d{4}$/.test(String(b.vintage)) ? String(b.vintage) : '')).slice(0, 8), 'vintage')] };
    }
    // Statistics: value drill-down for "Drunk" (archive rows) and "Total" (stock + archive): same structure as the stock statistics (wines, producers, countries, regions, vintages, price bands, types)
    _statValue(scope, S) {
      const H = this._statHist();
      const items = scope === 'arch' ? H.items : S.items.concat(H.items), cur = S.currency;
      const wines = new Map(), pb = new Map(), tv = new Map(), vb = { producer: new Map(), country: new Map(), region: new Map(), vintage: new Map() };
      const add = (m, k, v) => { if (k) m.set(k, (m.get(k) || 0) + v); };
      items.forEach((b) => {
        if (!(typeof b.price === 'number' && b.currency === cur)) return;
        const id = b.wine || b.name;
        let w = wines.get(id);
        if (!w) { w = { name: b.name, producer: b.producer, n: 0, value: 0 }; wines.set(id, w); }
        w.n++; w.value += b.price;
        add(tv, b._type, b.price);
        if (b._price) { const o = pb.get(b._price) || { n: 0, v: 0 }; o.n++; o.v += b.price; pb.set(b._price, o); }
        add(vb.producer, b.producer, b.price); add(vb.country, b.country, b.price); add(vb.region, b.region, b.price);
        add(vb.vintage, /^\d{4}$/.test(String(b.vintage)) ? String(b.vintage) : '', b.price);
      });
      const arr = (m) => Array.from(m.entries()).sort((a, b) => b[1] - a[1] || de.compare(a[0], b[0]));
      return { scoped: true, currency: cur, wines, priceBands: pb, byTypeVal: arr(tv), valBy: { producer: arr(vb.producer), country: arr(vb.country), region: arr(vb.region), vintage: arr(vb.vintage) } };
    }
    // Statistics: statistics of the archive (consumption log), same cellar selection and "Other" setting as the stock statistics
    _statHist() {
      const d = this._data;
      if (!d) return null;
      const noOther = !this._showOther();
      if (this._statH && this._statH.d === d && this._statH.no === noOther) return this._statH.v;
      const hs = (d.history || []).filter((h) => !noOther || h._type !== 'other');
      const cur = (this._statData() || {}).currency || '';
      const cnt = (get) => {
        const m = new Map();
        hs.forEach((h) => [].concat(get(h)).forEach((v) => { if (v) m.set(v, (m.get(v) || 0) + 1); }));
        return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || de.compare(a[0], b[0]));
      };
      const ago = Date.now() - 365 * 864e5;
      let value = 0, gifted = 0, recent = 0;
      const rs = new Map();
      const years = new Map(), wines = new Map();
      hs.forEach((h) => {
        const priced = typeof h.price === 'number' && h.currency === cur;
        if (priced) value += h.price;
        if (h.reason === 'gifted') gifted++;
        rs.set(h.reason || 'drank', (rs.get(h.reason || 'drank') || 0) + 1);
        const m = /^(\d{4})/.exec(String(h.at || ''));
        if (m) { const o = years.get(m[1]) || { n: 0, v: 0 }; o.n++; if (priced) o.v += h.price; years.set(m[1], o); }
        if (h.at && Date.parse(h.at) >= ago) recent++;
        const k = h.wine || h.name;
        let w = wines.get(k);
        if (!w) { w = { name: h.name, producer: h.producer, n: 0 }; wines.set(k, w); }
        w.n++;
      });
      const v = { total: hs.length, wines, years, value, gifted, recent, reasons: Array.from(rs.entries()).sort((a, b) => b[1] - a[1]), currency: cur, items: hs,
        types: cnt((h) => h._type), producers: cnt((h) => h.producer) };
      this._statH = { d, v, no: noOther };
      return v;
    }
    // Statistics: start page of the areas "Archive" and "Total" (S = stock statistics, H = archive statistics)
    _statScopeHtml(scope, S, num) {
      const H = this._statHist();
      if (!H) return '';
      const money = this._money(S.currency);
      const dec = (n) => new Intl.NumberFormat(I18N.lang || 'de', { maximumFractionDigits: 1 }).format(n);
      const hero = (n, label) => `<div class="shero"><span class="sbig huge">${esc(num(n))}</span><span class="slbl">${esc(label)}</span></div>`;
      const tile = (big, label, go) => (go
        ? `<button class="stile nav ${go}" data-act="statscope" data-t="${go}"><span class="sbig">${esc(big)}</span><span class="slbl">${esc(label)}</span></button>`
        : `<div class="stile st"><span class="sbig">${esc(big)}</span><span class="slbl">${esc(label)}</span></div>`);
      const tileGo = (big, label, to) => `<button class="stile" data-act="statgo" data-to="${to}"><span class="sbig">${esc(big)}</span><span class="slbl">${esc(label)}</span></button>`;
      const head = (label, hint) => `<div class="wsub shead">${esc(label)}</div>` + (hint ? `<div class="wsub">${esc(hint)}</div>` : '');
      const row = (label, sub, n, mx, text, attr) => `<${attr ? 'button' : 'div'} class="srow${attr ? '' : ' st'}" ${attr || ''}><span class="srl"><span class="srt">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></span>` +
        `<span class="sbt"><span class="sbf" style="width:${Math.max(2, Math.round(n / Math.max(1, mx) * 100))}%"></span></span><span class="sbc">${esc(text)}</span></${attr ? 'button' : 'div'}>`;
      const arch = (g, v) => `data-act="statarch" data-g="${esc(g)}" data-v="${esc(v)}"`;
      if (scope === 'arch') {
        const yrs = Array.from(H.years.entries()).sort((a, b) => b[0] - a[0]);
        const ymx = Math.max(1, ...yrs.map(([, o]) => o.n));
        const top = Array.from(H.wines.values()).sort((a, b) => b.n - a.n || de.compare(a.name, b.name)).slice(0, 8);
        const tmx = Math.max(1, ...H.types.map((x) => x[1]));
        // wines and producers that are completely gone: nothing left in stock (any vintage)
        const goneW = Array.from(H.wines.entries()).filter(([k]) => !S.wines.has(k)).map(([, w]) => w);
        const stockProd = new Set(S.producers.map((x) => x[0]));
        const goneP = new Set(goneW.map((w) => w.producer).filter((pr) => pr && !stockProd.has(pr)));
        const goneTop = goneW.slice().sort((a, b) => b.n - a.n || de.compare(a.name, b.name)).slice(0, 8);
        return hero(H.total, t('stat.drunkHero')) +
          `<div class="sgrid">${tileGo(num(H.wines.size), t('stat.wines'), 'd:wines')}${H.reasons.length > 1 ? `<button class="stile" data-act="statgo" data-to="d:reasons"><span class="sbig sm">${esc(H.reasons.map(([r, n]) => num(n) + ' ' + (I18N.dict['hist.reason.' + r] !== undefined ? t('hist.reason.' + r) : r)).join(' · '))}</span><span class="slbl">${esc(t('stat.consumption'))}</span></button>` : ''}</div>` +
          (H.value > 0 ? `<button class="stile wide" data-act="statgo" data-to="value"><span class="sbig val">${esc(money(H.value))}</span><span class="slbl">${esc(t('stat.drunkValue'))}</span></button>` : '') +
          (goneW.length ? `<div class="sgrid">${tileGo(num(goneW.length), t('stat.goneWines'), 'd:gonew')}${tileGo(num(goneP.size), t('stat.goneProducers'), 'd:gonep')}</div>` +
            head(t('stat.goneTop'), t('stat.goneTopHint')) + `<div class="slist">${goneTop.map((w) => row(w.name, w.producer, w.n, goneTop[0].n, num(w.n), arch('q', w.name))).join('')}</div>` : '') +
          head(t('stat.perYear')) + `<div class="slist fx">${yrs.map(([y, o]) => row(y, '', o.n, ymx, num(o.n) + (o.v > 0 ? ' · ' + money(o.v) : ''))).join('')}</div>` +
          head(t('stat.mostDrunk')) + `<div class="slist">${top.map((w) => row(w.name, w.producer, w.n, top[0].n, num(w.n), arch('q', w.name))).join('')}</div>` +
          head(t('stat.byType')) + `<div class="sbars">${H.types.map(([k, n]) => `<button class="sbar" data-act="statgo" data-to="type:${esc(k)}">${this._glass(k, '')}<span class="sbn">${esc(typeLbl(k))}</span>` +
            `<span class="sbt"><span class="sbf" style="width:${Math.max(2, Math.round(n / tmx * 100))}%"></span></span><span class="sbc">${num(n)}</span></button>`).join('')}</div>` +
          `<div class="wsub shint">${esc(t('stat.tapHint'))}</div>`;
      }
      // Total: stock and archive together
      const sm = new Map(S.types), hm = new Map(H.types);
      const tk = Array.from(new Set([].concat(S.types.map((x) => x[0]), H.types.map((x) => x[0]))));
      tk.sort((a, b) => ((sm.get(b) || 0) + (hm.get(b) || 0)) - ((sm.get(a) || 0) + (hm.get(a) || 0)));
      const tmx = Math.max(1, ...tk.map((k) => (sm.get(k) || 0) + (hm.get(k) || 0)));
      return hero(S.total + H.total, t('stat.allBought')) +
        `<div class="sgrid">${tile(num(S.total), t('stat.sc.stock'), 'stock')}${tile(num(H.total), t('stat.sc.arch'), 'arch')}</div>` +
        (S.value + H.value > 0 ? `<button class="stile wide" data-act="statgo" data-to="value"><span class="sbig val">${esc(money(S.value + H.value))}</span><span class="slbl">${esc(t('stat.totalValue'))}</span><span class="slbl">${esc(t('stat.totalValueHint', { a: money(S.value), b: money(H.value) }))}</span></button>` : '') +
        head(t('stat.byType'), t('stat.stockVsArch')) +
        `<div class="sbars"><button class="sbar sbar2" data-act="statgo" data-to="type:"><svg class="tsp" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect width="24" height="24" rx="5" fill="#2196f3"/><path fill="#fff" d="M7 4h10l-.5 6.5a4.5 4.5 0 0 1-3.5 4V18h3v2H8v-2h3v-3.5a4.5 4.5 0 0 1-3.5-4z"/></svg><span class="sbn"><b>${esc(t('stat.sc.all'))}</b></span><span class="sbt two"><span class="sbf" style="width:${(S.total / Math.max(1, S.total + H.total) * 100).toFixed(1)}%"></span><span class="sbf" style="width:${(H.total / Math.max(1, S.total + H.total) * 100).toFixed(1)}%;background:var(--s-drunk)"></span></span><span class="sbc sbc2"><span>${num(S.total)}</span><span>·</span><span>${num(H.total)}</span></span></button>${tk.map((k) => { const a = sm.get(k) || 0, b = hm.get(k) || 0; return `<button class="sbar sbar2" data-act="statgo" data-to="type:${esc(k)}">${this._glass(k, '')}<span class="sbn">${esc(typeLbl(k))}</span>` +
          `<span class="sbt two"><span class="sbf" style="width:${(a / tmx * 100).toFixed(1)}%"></span><span class="sbf" style="width:${(b / tmx * 100).toFixed(1)}%;background:var(--s-drunk)"></span></span><span class="sbc sbc2"><span>${num(a)}</span><span>·</span><span>${num(b)}</span></span></button>`; }).join('')}</div>` +
        `<div class="wsub shint">${esc(t('stat.tapHint'))}</div>`;
    }
    _money(cur) {
      let f;
      try { f = new Intl.NumberFormat(I18N.lang || 'de', { style: 'currency', currency: cur, maximumFractionDigits: 0 }); } catch (e) { f = null; }
      return (v) => (f ? f.format(v) : Math.round(v) + (cur ? ' ' + cur : ''));
    }
    _renderStat() {
      const el = this._dlg, S = this._statData();
      if (!el || !S) return;
      const st = this._stat, num = (n) => new Intl.NumberFormat(I18N.lang || 'de').format(n);
      const keep = el.querySelector('.dsheet'); const topPos = keep && !el.hidden ? keep.scrollTop : 0;
      const key = st.path[st.path.length - 1];
      const nav = (title) => `<div class="dh">${key ? `<button class="dx" data-act="statback" aria-label="${esc(t('stat.back'))}">←</button>` : ''}<span class="wmain"><span class="wname">${esc(title)}</span></span>` +
        `<button class="dx" data-act="statclose" aria-label="${esc(t('head.close'))}">✕</button></div>`;
      const hd = (inner) => `<div class="stathead">${inner}</div>`; // header (title, close, scope tabs / pills) stays fixed while the page scrolls
      let html;
      const hh = this._statHist(), sc3 = !!(hh && hh.total > 0), scope = sc3 ? (st.scope || 'all') : 'stock'; // three areas (total | stock | drunk), only stock statistics while there is no history (old server, nothing drunk)
      const tabs3 = sc3 && !key ? `<div class="stabs">${[['all', t('stat.sc.all')], ['stock', t('stat.sc.stock')], ['arch', t('stat.sc.arch')]].map(([k, l]) => `<button class="stab${k === scope ? ' on' : ''}" data-act="statscope" data-t="${k}">${esc(l)}</button>`).join('')}</div>` : '';
      if (!key && scope !== 'stock') {
        html = hd(nav(this._data.cellar || t('stat.title')) + tabs3) + this._statScopeHtml(scope, S, num);
      } else if (!key) {
        const tile = (go, big, label) => `<button class="stile" data-act="statgo" data-to="${go}"><span class="sbig">${esc(big)}</span><span class="slbl">${esc(label)}</span></button>`;
        const mini = (go, label, val) => `<button class="smini" data-act="statgo" data-to="${go}"><span class="slbl">${esc(label)}</span><span class="sval">${esc(val || '–')}</span></button>`;
        const maxT = Math.max(1, ...S.types.map((x) => x[1]));
        html = hd(nav(this._data.cellar || t('stat.title')) + tabs3) +
          `<div class="shero"><span class="sbig huge">${esc(num(S.total))}</span><span class="slbl">${esc(t('stat.bottles'))}</span></div>` +
          `<div class="sgrid">${tile('wines', num(S.wines.size), t('stat.wines'))}${tile('countries', num(S.countries.length), t('stat.countries'))}` +
          `${tile('producers', num(S.producers.length), t('stat.producers'))}${tile('vintages', S.oldest || '–', t('stat.oldest'))}</div>` +
          (S.value > 0 ? `<button class="stile wide" data-act="statgo" data-to="value"><span class="sbig val">${esc(this._money(S.currency)(S.value))}</span><span class="slbl">${esc(t('stat.cellarValue'))}</span></button>` : '') +
          `<div class="sbars">${S.types.map(([k, n]) => `<button class="sbar" data-act="statfilter" data-g="types" data-v="${esc(k)}">${this._glass(k, '')}<span class="sbn">${esc(typeLbl(k))}</span>` +
            `<span class="sbt"><span class="sbf" style="width:${Math.max(2, Math.round(n / maxT * 100))}%;background:var(--w-${esc(k)}, var(--cb-ring))"></span></span><span class="sbc">${num(n)}</span></button>`).join('')}</div>` +
          `<div class="sgrid">${mini('countries', t('stat.topCountry'), (S.countries[0] || [])[0])}${mini('producers', t('stat.topProducer'), (S.producers[0] || [])[0])}` +
          `${mini('regions', t('stat.topRegion'), (S.regions[0] || [])[0])}${mini('grapes', t('stat.topGrape'), (S.grapes[0] || [])[0])}</div>`;
      } else {
        const pg = key.startsWith('d:') ? this._statDrunkPage(key, S) : key.startsWith('type:') && scope !== 'stock' ? this._statTypePage(key.slice(5), scope, S) : this._statPage(key, key === 'value' && scope !== 'stock' ? this._statValue(scope, S) : S, st.all);
        const fAct = scope === 'arch' ? 'statarch' : 'statfilter'; // Drunk: a tap shows the archive with this filter
        html = hd(nav(pg.title) + (pg.tabs ? `<div class="stabs">${pg.tabs.map(([k, l]) => `<button class="stab${k === pg.tab ? ' on' : ''}" data-act="stattab" data-t="${k}">${esc(l)}</button>`).join('')}</div>` : '')) + pg.sections.map((sec) => {
          const mx = Math.max(1, ...sec.rows.map((r) => r.n));
          const more = sec.total > sec.limit && sec.limit !== 99;
          const flat = sec.rows.every((r) => r.n === sec.rows[0].n); // all counts equal: the bars say nothing, so they are hidden
          return (sec.head ? `<div class="wsub shead">${esc(sec.head)}</div>` : '') + (sec.hint ? `<div class="wsub">${esc(sec.hint)}</div>` : '') +
            `<div class="slist${sec.rows.some((r) => r.text && r.text.length > 7 && !r.note) ? ' fx' : ''}">${sec.rows.map((r) => {
              const attr = r.go ? `data-act="statgo" data-to="${esc(r.go)}"` : r.filter ? `data-act="${fAct}" data-g="${esc(r.filter[0])}" data-v="${esc(r.filter[1])}"` : '';
              return `<${attr ? 'button' : 'div'} class="srow${flat ? ' flat' : ''}${attr ? '' : ' st'}" ${attr}><span class="srl">${r.dot ? this._glass(r.dot, '') : ''}<span class="srt">${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span></span>` +
                (r.note ? `<span class="srn">${esc(r.note)}</span>` : `<span class="sbt"><span class="sbf" style="width:${Math.max(2, Math.round(r.n / mx * 100))}%"></span></span>`) +
                `<span class="sbc">${esc(r.text || num(r.n))}</span></${attr ? 'button' : 'div'}>`;
            }).join('')}</div>` +
            (more || (st.all && sec.total > sec.limit) ? `<button class="btn" data-act="statall">${esc(st.all ? t('stat.less') : t('stat.all', { n: sec.total }))}</button>` : '');
        }).join('') + `<div class="wsub shint">${esc(t('stat.tapHint'))}</div>`;
      }
      el.innerHTML = `<div class="dsheet statsheet" data-sc="${key ? 'stock' : scope}" role="dialog" aria-modal="true">${html}</div>`;
      el.hidden = false;
      const sh = el.querySelector('.dsheet'); if (sh) sh.scrollTop = topPos;
    }
    // Settings page: plain list, groups, a description column (left) and a control column (right) of fixed proportions.
    // Few options: radios or a checkbox; many options: a plain dropdown; long topics collapsed. Scope: one switch with two icons plus the text.
    _renderSet() {
      const el = this._dlg;
      if (!el) return;
      const _keep = el.querySelector('.dsheet'); const _top = _keep && !el.hidden ? _keep.scrollTop : 0; // Keep the scroll position when redrawing
      const open = this._sx || (this._sx = new Set());
      const sc = Math.round(this._scale * 100);
      const gi = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>';
      const pi = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/></svg>';
      // scope: switch with the globe (all devices) on the left and the phone (this device) on the right, the text says what is set
      const sw = (k, only) => {
        const dev = only ? only === 'device' : this._local[k] !== undefined;
        const lbl = only ? (dev ? t('set.scopeDeviceFixed') : t('set.scopeAllFixed')) : (dev ? t('set.scopeDevice') : t('set.scopeAll'));
        const inner = `<span class="knob"></span><span class="ic${dev ? '' : ' act'}">${gi}</span><span class="ic${dev ? ' act' : ''}">${pi}</span>`;
        // Only one scope possible: show just that icon (highlighted, not a switch), so nothing looks switchable
        const ctl = only ? `<span class="sone" role="img" aria-label="${esc(lbl)}">${dev ? pi : gi}</span>`
          : `<button class="sw2${dev ? ' dev' : ''}" role="switch" aria-checked="${dev}" aria-label="${esc(lbl)}" data-act="scope" data-k="${k}" data-v="${dev ? 'all' : 'device'}">${inner}</button>`;
        return `<span class="sscope">${ctl}<span>${esc(lbl)}</span></span>`;
      };
      const row = (name, sub, scope, ctl) => `<div class="srow"><div class="sdesc"><span class="wname">${esc(name)}</span>` +
        (sub ? `<span class="wsub">${esc(sub)}</span>` : '') + (scope || '') + `</div><div class="sctl">${ctl}</div></div>`;
      const radios = (name, act, opts, cur, extra) => `<div class="rads" role="radiogroup">` + opts.map(([v, n]) =>
        `<label class="opt"><input type="radio" name="${esc(name)}" data-act="${act}" data-v="${esc(v)}"${extra || ''}${String(v) === String(cur) ? ' checked' : ''}><span>${esc(n)}</span></label>`).join('') + `</div>`;
      // Own dropdown inside the card (no native popup: on older tablets the native list flashes up and disappears)
      const sel = (key, opts, cur) => {
        const o = this._selOpen === key;
        const curN = (opts.find(([v]) => String(v) === String(cur)) || ['', ''])[1];
        return `<div class="ssel2"><button class="ssel${o ? ' open' : ''}" data-act="selopen" data-key="${key}" aria-haspopup="listbox" aria-expanded="${o}"><span>${esc(curN)}</span><span class="ssarr">${o ? '▴' : '▾'}</span></button>` +
          (o ? `<div class="ssopts" role="listbox">` + opts.map(([v, n]) => `<button class="ssopt${String(v) === String(cur) ? ' on' : ''}" role="option" aria-selected="${String(v) === String(cur)}" data-act="selpick" data-key="${key}" data-v="${esc(v)}">${esc(n)}</button>`).join('') + `</div>` : '') + `</div>`;
      };
      const chkOpt = (act, extra, on, label) => `<label class="opt"><input type="checkbox" data-act="${act}"${extra || ''}${on ? ' checked' : ''}><span>${esc(label)}</span></label>`;
      const grps = [];
      const grp = (name, id) => { grps.push([id, name]); return `<div class="sgrp" data-sg="${id}">${esc(name)}</div>`; };
      const wzIn = this._setViewId === 'data', forceOpen = new Set(['infod', 'racks']); // settings views: a group with a single entry shows it expanded
      const sec = (id, title, sum, body, scope) => { const o = open.has(id) || forceOpen.has(id);
        return `<div class="ssec${scope ? ' hs' : ''}">${forceOpen.has(id) ? '<div class="shead fixed">' : `<button class="shead" data-act="sx" data-id="${id}" aria-expanded="${o}">`}<span class="sdesc"><span class="wname">${esc(title)}</span><span class="wsub">${esc(sum)}</span></span>${forceOpen.has(id) ? '' : `<span class="chev">${o ? '⌄' : '›'}</span>`}${forceOpen.has(id) ? '</div>' : '</button>'}` + (scope ? `<div class="sscopeb">${scope}</div>` : '') + (o ? `<div class="sbody">${body}</div>` : '') + `</div>`; };
      const lbl = (d) => d.personal || d.infoOnly ? '[' + d.label + ']' : d.clsg !== undefined ? t('filter.cls') + ': ' + d.label : d.label; // split classification filters: "Classification: Vineyard rank"
      const fchk = (act, id, on, label) => `<input type="checkbox" data-act="${act}" data-id="${esc(id)}"${on ? ' checked' : ''} aria-label="${esc(t('set.toggle', { label }))}">`;
      const grip = `<span class="grip" role="button" aria-label="${esc(t('set2.drag'))}" title="${esc(t('set2.drag'))}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 8h14M5 12h14M5 16h14"/></svg></span>`;
      const fdefs = this._allDefs();
      const idefs = this._infoDefs();
      const iord = idefs.filter((d) => !d.fixed);
      const racks = (this._data && this._data.racks) || [];
      const frow = (d, on, grp) => `<div class="frow${on ? '' : ' off'}" data-id="${esc(d.id)}"><label class="fl">${fchk(grp === 'f' ? 'fvis' : 'ivis', d.id, on, d.label)}<span class="wname">${esc(lbl(d))}</span></label>${grp ? grip : ''}</div>`;
      // Three states per filter: visible / behind "..." / off (never offered). Stored in the hidden list: id = behind "...", id + 'off:id' = off (older cards still show it behind "...")
      const fseg = (id, st) => `<span class="fseg" role="group" aria-label="${esc(id)}">` + [['vis', t('fstate.vis'), t('fstate.visTip')], ['more', t('fstate.more'), t('fstate.moreTip')], ['off', t('fstate.off'), t('fstate.offTip')]].map(([v, l, tip]) => `<button type="button" class="${st === v ? 'on' : ''}" data-act="fstate" data-id="${esc(id)}" data-v="${v}" aria-pressed="${st === v}" title="${esc(tip)}" aria-label="${esc(tip)}">${esc(l)}</button>`).join('') + `</span>`;
      const fstOf = (d) => this._fh.has('off:' + d.id) ? 'off' : this._fh.has(d.id) ? 'more' : 'vis';
      const frowF = (d) => { const st = fstOf(d); return `<div class="frow${st === 'vis' ? '' : ' off'}" data-id="${esc(d.id)}"><span class="fl"><span class="wname">${esc(lbl(d))}</span></span>${fseg(d.id, st)}${grip}</div>`; };
      // Filter mode (Standard / OR / NOT): a fixed row below the list (not movable, always last before "..."); visible = marker 'fmode:show', off = marker 'fmode:off' (the card stays in standard mode)
      const fmSt = this._fh.has('fmode:off') ? 'off' : this._fh.has('fmode:show') ? 'vis' : 'more';
      const fmRow = `<div class="frow${fmSt === 'vis' ? '' : ' off'}" data-id="fmode"><span class="fl"><span class="wname">${esc(t('fmode.title'))}</span></span>${fseg('fmode', fmSt)}<span class="gripsp"></span></div>`;
      // Stock / Archive (flag history): fixed row before the filter mode (not movable); visible (default) = marker none, behind "..." = 'src:more', off = 'src:off'
      const srcSt = this._fh.has('src:off') ? 'off' : this._fh.has('src:more') ? 'more' : 'vis';
      const srcRow = `<div class="frow${srcSt === 'vis' ? '' : ' off'}" data-id="src"><span class="fl"><span class="wname">${esc(t('filter.history'))}</span></span>${fseg('src', srcSt)}<span class="gripsp"></span></div>`;
      const fhead = `<div class="fhead"><span class="fl">${esc(t('fhead.name'))}</span><span class="fhs">${esc(t('fhead.vis'))}</span><span class="fhg">${esc(t('fhead.sort'))}</span></div>`;
      const filtersBody = fhead + `<div class="dlist" data-g="f">` + fdefs.map((d) => frowF(d)).join('') + `</div>` + fmRow + srcRow;
      // Data fields: one checkbox per field (list; with flag infosplit a second section sets the details with its own order); the price only has the list
      const icb = (d, col, on) => `<span class="fcb"><input type="checkbox" data-act="icol" data-col="${col}" data-id="${esc(d.id)}"${on ? ' checked' : ''} aria-label="${esc(t('set.toggle', { label: lbl(d) }))}"></span>`;
      const dseg = (id, st) => `<span class="fseg" role="group" aria-label="${esc(id)}">` + [['vis', t('fstate.vis'), t('dstate.visTip')], ['more', t('fstate.more'), t('dstate.moreTip')], ['off', t('fstate.off'), t('dstate.offTip')]].map(([v, l, tip]) => `<button type="button" class="${st === v ? 'on' : ''}" data-act="dstate" data-id="${esc(id)}" data-v="${v}" aria-pressed="${st === v}" title="${esc(tip)}" aria-label="${esc(tip)}">${esc(l)}</button>`).join('') + `</span>`; // details with flag detrows: shown / behind the arrow / off
      const frowI = (d, col) => { const on = col === 'l' ? this._is.has(d.id) : !this._iOff.has(d.id); if (col === 'd') { const st = this._iOff.has(d.id) ? 'off' : this._iMore.has(d.id) ? 'more' : 'vis'; return `<div class="frow${st === 'vis' ? '' : ' off'}" data-id="${esc(d.id)}"><span class="fl"><span class="wname">${esc(lbl(d))}</span></span>${dseg(d.id, st)}${grip}</div>`; } return `<div class="frow${on ? '' : ' off'}" data-id="${esc(d.id)}"><span class="fl"><span class="wname">${esc(lbl(d))}</span></span>${icb(d, col, on)}${d.fixed ? '<span class="gripsp"></span>' : grip}</div>`; };
      const ihead = (col) => `<div class="fhead"><span class="fl">${esc(t('fhead.name'))}</span><span class="${col === 'd' ? 'fhs' : 'fcb'}">${esc(t(col === 'l' ? 'fhead.list' : 'fhead.vis'))}</span><span class="fhg">${esc(t('fhead.sort'))}</span></div>`;
      const infoBody = `<div class="wsub" style="margin:0 0 8px">${esc(t('set.infoListSub'))}</div>` + ihead('l') + `<div class="dlist" data-g="i">` + iord.map((d) => frowI(d, 'l')).join('') + `</div>` +
        idefs.filter((d) => d.fixed).map((d) => frowI(d, 'l')).join('');
      const ddefs = this._infoDefs(true);
      const infoDBody = `<div class="wsub" style="margin:0 0 8px">${esc(t('set.infoDetSub'))}</div>` + ihead('d') + `<div class="dlist" data-g="d">` + ddefs.map((d) => frowI(d, 'd')).join('') + `</div>`;
      const racksBody = racks.map((n) => { const rs = this._rs(n);
        return `<div class="rackblk"><div class="racknm">${esc(n)}</div>` +
          row(t('set.rackOrder'), '', '', radios('rk-' + n + '-order', 'rack', [['top', t('set.rackTop')], ['bottom', t('set.rackBottom')]], rs.order, ` data-n="${esc(n)}" data-k="order"`)) +
          row(t('set.rackSide'), '', '', radios('rk-' + n + '-side', 'rack', [['none', t('set.sideNone')], ['thirds', t('set.sideThirds')], ['slot', t('set.sideSlot')]], rs.side, ` data-n="${esc(n)}" data-k="side"`)) + `</div>`; }).join('');
      const langs = [['', t('set.languageAuto')]].concat(Object.entries(this._langs || {}));
      const shownF = fdefs.filter((d) => !this._fh.has(d.id)).length;
      let html = `<div class="dsheet setv2 setfix" role="dialog" aria-modal="true">` +
        `<div class="sethead"><div class="dh"><span class="wmain"><span class="wname">${esc(t('head.settings'))}</span></span>` +
        `<button class="dx" data-act="setclose" aria-label="${esc(t('head.close'))}">✕</button></div><!--pills--></div>` +
        (this._setErr ? `<div class="derr">${esc(this._setErr)}</div>` : '') + (this._setNote ? `<div class="wsub">${esc(this._setNote)}</div>` : '') +
        grp(t('set2.grpView'), 'view') +
        row(t('set.language'), t('set.languageSub'), sw('language'), sel('setlang', langs, this._langSel || '')) +
        row(t('set2.mode'), t('set.modeSub'), sw(null, 'device'), radios('mode', 'mode', [['auto', t('set.modeAuto')], ['light', t('set.modeLight')], ['dark', t('set.modeDark')]], this._mode())) +
        row(t('set.fontSize'), t('set.fontSizeSub', { pct: sc }), sw(null, 'device'), sel('setscale', [85, 100, 115, 130, 150, 175, 200].map((v) => [v, v + ' %']), sc)) +
        row(t('set2.fullw'), t('set2.fullwSub'), sw(null, 'device'), chkOpt('fullw', '', this._fullw(), t('set.on'))) +
        grp(t('set2.grpFilters'), 'filters') +
        row(t('set.keepState'), t('set.keepStateSub'), sw('keepState'), radios('keepst', 'keepst', [['on', t('set.keepOn')], ['off', t('set.keepOff')]], this._keep() ? 'on' : 'off')) +
        sec('filters', t('set.filters'), t('set2.sumFilters', { n: shownF, all: fdefs.length }), filtersBody, sw('filters')) +
        row(t('set.priceBands'), t('set.priceBandsSub'), sw(null, 'all'), `<input class="stxt" type="text" inputmode="numeric" data-pb value="${esc(PRICE_BANDS.filter((b) => b[0] !== Infinity).map((b) => b[0]).join(', '))}" aria-label="${esc(t('set.priceBands'))}">`) +
        grp(t('set2.grpList'), 'list') +
        sec('info', t('set.infoList'), t('set2.sumFilters', { n: idefs.filter((d) => this._is.has(d.id)).length, all: idefs.length }), infoBody, sw('info')) +
        row(t('set2.showOther'), t('set2.showOtherSub'), sw('hideOther'), chkOpt('showother', '', this._showOther(), t('set.on'))) +
        grp(t('set2.grpDetails'), 'details') +
        sec('infod', t('set.infoDet'), t('set2.sumFilters', { n: ddefs.filter((d) => !this._iOff.has(d.id)).length, all: ddefs.length }), infoDBody, sw('info')) +
        (racks.length ? grp(t('set2.grpPlaces'), 'places') + sec('racks', t('set.racks'), t('set2.sumRacks', { n: racks.length }), racksBody, sw(null, 'all')) : '') +
        grp(t('set2.grpData'), 'data') +
        (wzIn ? this._wzInlineHtml(sw(null, 'all')) : `<div class="ssec hs"><button class="shead" data-act="wzopen"><span class="sdesc"><span class="wname">${esc(t('set.producers'))}</span><span class="wsub">${esc(t('set.producersSub'))}</span></span><span class="chev">›</span></button><div class="sscopeb">${sw(null, 'all')}</div></div>`) +
        grp(t('set2.grpArch'), 'arch') + row(t('arch.nTitle'), t('arch.nSub'), sw('archN'), `<input class="snum" type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="99" step="1" data-archn value="${this._archN()}">`) +
        (FLAGS.length ? grp(t('set2.grpDev'), 'dev') + FLAGS.map((f) => f.opts ? row(t('flag.' + f.id), t('flag.' + f.id + 'Sub'), '', ['off'].concat(f.opts).map((o) => chkOpt('flag', ` data-id="${esc(f.id)}" data-v="${o === this._flagV(f.id) ? 'off' : o}"`, o === this._flagV(f.id), t('flag.' + f.id + '.' + o))).join('')) : row(t('flag.' + f.id), t('flag.' + f.id + 'Sub'), '', chkOpt('flag', ` data-id="${esc(f.id)}" data-v="${this._flag(f.id) ? 'off' : 'on'}"`, this._flag(f.id), t('set.on')))).join('') : '') +
        `</div>`;
      { // the pills are views, only the chosen group is shown (without its heading)
        const cur = grps.some((g) => g[0] === this._setViewId) ? this._setViewId : grps[0][0];
        const closeTag = '</div>'; let body = html.endsWith(closeTag) ? html.slice(0, -closeTag.length) : html;
        const parts = body.split(/(?=<div class="sgrp" data-sg=")/), head = parts.shift();
        const mine = parts.find((x) => x.indexOf('data-sg="' + cur + '"') === 18) || '';
        html = head + mine.replace(/^<div class="sgrp"[^>]*>[^<]*<\/div>/, '') + closeTag;
        html = html.replace('<!--pills-->', `<div class="stabs setnav">${grps.map(([id, n]) => `<button class="stab${id === cur ? ' on' : ''}" data-act="setview" data-g="${id}">${esc(n)}</button>`).join('')}</div>`);
      }
      el.innerHTML = html;
      el.hidden = false;
      if (wzIn) this._renderWzList(); else if (this._wzIn) { this._wz = null; this._wzIn = false; }
      if (_top) { const _n = el.querySelector('.dsheet'); if (_n) _n.scrollTop = _top; }
    }
    // The filter choice applies to all devices: save it in Home Assistant, report errors only quietly
    async _saveSettings() {
      const S = this._shared || {};
      // encodeURIComponent laesst ! ' ( ) * ~ stehen; die Shell-Zeile der Dev-Vorlage entfernt alles ausser [A-Za-z0-9%,._-] -> Klammern mitkodieren
      const enc = (a) => (a.length ? a.map((x) => encodeURIComponent(x).replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join(',') : '-');
      try {
        await this._call('settings',
          { o: enc(S.filterOrder || []), h: enc(S.filterHidden || []), l: S.language || '-', r: enc(Object.entries(S.rackSettings || {}).map(([n, v]) => [n, v.order, v.side].join('|'))), k: S.keepState === undefined ? 'keep' : (S.keepState ? '1' : '0'), x: S.hideOther === undefined ? 'keep' : (S.hideOther ? '1' : '0'), an: S.archN === undefined ? 'keep' : String(S.archN), pb: !Array.isArray(S.priceBands) ? 'keep' : S.priceBands.length ? S.priceBands.join(',') : '-', io: S.infoOrder === undefined ? 'keep' : enc(S.infoOrder), iv: S.infoShow === undefined ? 'keep' : enc(S.infoShow) },
          { filter_order: S.filterOrder || [], filter_hidden: S.filterHidden || [], language: S.language || '', rack_settings: S.rackSettings || {}, ...(S.keepState === undefined ? {} : { keep_state: !!S.keepState }), ...(S.hideOther === undefined ? {} : { hide_other: !!S.hideOther }), ...(S.archN === undefined ? {} : { arch_n: S.archN }), ...(Array.isArray(S.priceBands) ? { price_bands: S.priceBands } : {}), ...(S.infoOrder === undefined ? {} : { info_order: S.infoOrder }), ...(S.infoShow === undefined ? {} : { info_show: S.infoShow }) });
        this._setErr = '';
      } catch (e) {
        this._setErr = t('set.saveFailed', { err: (e && e.message) || String(e) });
      }
      if (this._set) this._renderSet();
    }
    // Producer sort words: search field, switch and list (used by the own dialog and, with flag setviews, inline in the settings)
    _wzBody(z) {
      return `<div class="row-chips"><input class="wzq" type="text" data-wzq autocomplete="off" placeholder="${esc(t('wz.search'))}" value="${esc(z.q)}">` +
        `<label class="opt"><input type="checkbox" data-act="wzall"${z.all ? '' : ' checked'}><span>${esc(t('wz.multi'))}</span></label></div>` +
        `<div class="derr" data-wzerr ${z.err ? '' : 'hidden'}>${esc(z.err)}</div><div class="wzlist"></div>`;
    }
    _wzInlineHtml(scopeHtml) {
      if (!this._wz) this._wz = { q: '', all: false, err: '', busy: false, draft: Object.assign({}, this._sortMap) };
      this._wzIn = true;
      return `<div class="ssec hs wzinl"><div class="shead fixed"><span class="sdesc"><span class="wname">${esc(t('set.producers'))}</span><span class="wsub">${esc(t('wz.hint'))}</span></span></div><div class="sscopeb">${scopeHtml}</div>${this._wzBody(this._wz)}</div>`;
    }
    _renderWz() {
      if (this._wzIn) { this._renderSet(); return; }
      const el = this._dlg, z = this._wz;
      if (!el) return;
      if (!z) { el.hidden = true; el.innerHTML = ''; return; }
      el.innerHTML = `<div class="dsheet wzv2" role="dialog" aria-modal="true">` +
        `<div class="dh"><span class="wmain"><span class="wname">${esc(t('wz.title'))}</span>` +
        `<span class="wsub">${esc(t('wz.hint'))}</span></span>` +
        `<button class="dx" data-act="wzclose" aria-label="${esc(t('wz.close'))}" ${z.busy ? 'disabled' : ''}>✕</button></div>` +
        this._wzBody(z) +
        `</div>`;
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
        return `<div class="wzrow"><span class="wzwords">${words}</span>${orphan ? `<span class="wznote">${note}</span>` : ''}</div>`;
      };
      let html = show.map((n) => row(n, false)).join('') || `<div class="msg">${esc(t('wz.empty'))}</div>`;
      if (orphans.length) html += `<div class="dsec" style="margin-top:8px">${esc(t('wz.orphans'))}</div>` + orphans.map((n) => row(n, true)).join('');
      box.innerHTML = html;
    }
    // Tap in the dialog: only the draft changes, it is saved with "Save"
    _wzTap(h, i) {
      const z = this._wz;
      if (!z || z.busy) return;
      const name = Array.from(this._data.facet.producer.keys()).concat(Object.keys(z.draft)).find((n) => this._hash(n) === h);
      if (!name) return;
      if (i < 0 || z.draft[name] === i) delete z.draft[name]; else z.draft[name] = i;
      this._renderWzList();
      this._wzSaveOne(name, z.draft[name] === undefined ? -1 : z.draft[name]); // every tap is saved at once
    }
    async _wzSaveOne(name, i) {
      const z = this._wz;
      try {
        const data = await this._call('winzer', { h: this._hash(name), i }, { name, index: i });
        this._sortMap = data.map || this._sortMap;
        if (z) z.err = '';
        this._renderHead(); this._renderList();
      } catch (e) {
        if (z && this._wz === z) { // saving failed: back to the saved state and show the error
          if (this._sortMap[name] === undefined) delete z.draft[name]; else z.draft[name] = this._sortMap[name];
          z.err = t('set.saveFailed', { err: (e && e.message) || String(e) });
          this._renderWz();
        }
      }
    }

    // ---------- Detail view and take-out ----------
    _detBottles() {
      const d = this._det;
      if (d.hist) return (this._data.history || []).filter((b) => (b.wine || b.name) === d.wine && String(b.vintage || 'NV') === d.vintage).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
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
    _flag(id) { const v = this._flagV(id); return v !== 'off' && v !== false && v !== ''; }
    // value of a flag: boolean flags give true/false, flags with options (opts) give the chosen option ('off' = not set)
    _flagV(id) {
      const L = (this._local && this._local.flags) || {};
      const def = FLAGS.find((x) => x.id === id);
      if (!def) return false; // flags that are not listed in FLAGS (the integration build has none) cannot be switched on, not even by the card config
      let v = L[id] !== undefined ? L[id] : (this._cfg.flags || {})[id];
      if (def && def.opts) return def.opts.includes(v) ? v : (v === true ? def.opts[1] : 'off');
      return !!v;
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
    // Link to the vintage in Cellarion (opens the web app)
    _edUrl(b) {
      const cid = (b && b.cellar) || (this._data && this._data.cellarId); // with several cellars the bottle knows its own
      return this._data && cid && b && b.wine ? `${this._data.url}/cellars/${encodeURIComponent(cid)}/vintages/${encodeURIComponent(b.wine)}/${encodeURIComponent(b.vintage || 'NV')}` : '';
    }
    // Racks that hold bottles of the open wine+vintage (stable order, for switching in the large view)
    _rackList(bottles) {
      const geo = (this._data && this._data.rackGeo) || {};
      const out = [];
      bottles.forEach((b) => { const r = b.where && b.where.rack; if (r && geo[r] && !out.includes(r)) out.push(r); });
      return out.sort((a, b) => de.compare(a, b));
    }
    _rackStep(dir) {
      const d = this._det; if (!d) return;
      const bottles = this._detBottles(), sel = bottles.find((b) => b.id === d.sel) || bottles[0];
      const list = this._rackList(bottles); if (list.length < 2 || !sel) return;
      const i = Math.max(0, list.indexOf(sel.where && sel.where.rack));
      const rk = list[(i + dir + list.length) % list.length];
      const nb = bottles.find((b) => b.where && b.where.rack === rk);
      if (nb) { d.sel = nb.id; d.more = false; d.botsOpen = false; this._renderDlg(); }
    }
    // Swipe left/right over the large rack picture switches the rack
    _swipe() {
      const m = this._dlg && this._dlg.querySelector ? this._dlg.querySelector('.rmap.big') : this.shadowRoot.querySelector('.rmap.big');
      if (!m || m._sw) return;
      m._sw = 1;
      let x0 = 0, y0 = 0;
      m.addEventListener('touchstart', (e) => { const t0 = e.touches[0]; x0 = t0.clientX; y0 = t0.clientY; }, { passive: true });
      m.addEventListener('touchend', (e) => {
        const t0 = e.changedTouches[0], dx = t0.clientX - x0, dy = t0.clientY - y0;
        if (Math.abs(dx) > 60 && Math.abs(dx) > 1.8 * Math.abs(dy)) this._rackStep(dx < 0 ? 1 : -1);
      }, { passive: true });
    }
    // Rack picture (large view, opened by the rack button in the detail bar): shelves from top to bottom, filled = any bottle, tinted = this vintage, solid = the selected bottle
    _rackMap(sel, bottles, big) {
      const rl = this._rackList(bottles);
      const geo = (this._data && this._data.rackGeo) || {};
      // only the rack of the selected place (the place choice in the bar decides which rack is shown)
      const rk0 = sel.where && sel.where.rack;
      const racks = rk0 && geo[rk0] ? [rk0] : [];
      if (!racks.length) return '';
      const mine = new Set(bottles.map((b) => b.id));
      return racks.map((rk) => {
        const g = geo[rk], n = g.rows.length, rs = this._rs(rk);
        const cols = g.cols || Math.max(1, ...this._data.bottles.filter((b) => b.where && b.where.rack === rk).map((b) => b.where.platz || 0)); // columns from Cellarion, else the highest used place
        const occ = new Map();
        this._data.bottles.forEach((b) => {
          const w = b.where;
          if (w && w.rack === rk && w.fach != null) occ.set(w.fach + '|' + w.lage + '|' + w.platz, b);
        });
        let shelves = '';
        for (let f = n; f >= 1; f--) {
          let lanes = '';
          for (let l = 1; l <= g.rows[f - 1]; l++) {
            let cells = '';
            for (let c = 1; c <= cols; c++) {
              const b = occ.get(f + '|' + l + '|' + c);
              const cls = b ? (b.id === sel.id ? 'f m s' : mine.has(b.id) ? 'f m' : 'f') : '';
              const own = b && mine.has(b.id); // bottles of this vintage: a tap starts the take-out for that bottle
              cells += `<i class="rm-c ${cls.replace('f m s', 's').replace('f m', 'm')}"${b ? ` title="${esc(b.name + (b.vintage ? ' ' + b.vintage : ''))}"` : ''}${own ? ` data-act="dtake" data-id="${esc(b.id)}"` : ''}></i>`;
            }
            lanes += `<div class="rm-lane" style="grid-template-columns:repeat(${cols},var(--rc,8px))">${cells}</div>`;
          }
          shelves += `<div class="rm-shelf" style="--ln:${g.rows[f - 1]}"><span class="rm-n">${rs.order === 'bottom' ? f : n - f + 1}</span><div class="rm-lanes">${lanes}</div></div>`;
        }
        const nav = (dir, ch) => `<button class="rm-nav" data-act="drnav" data-dir="${dir}" aria-label="${esc(t(dir < 0 ? 'det.rackPrev' : 'det.rackNext'))}">${ch}</button>`;
        const multiR = big && rl.length > 1;
        const zoom = '';
        return `<div class="rmap${big ? ' big' : ''}"${big ? '' : ` data-act="drack" role="button" tabindex="0" title="${esc(t('det.rackBig'))}"`}><div class="rm-head">${multiR ? nav(-1, '‹') : ''}<div class="rm-name">${esc(rk)}${multiR ? `<span class="rm-dots" aria-label="${rl.indexOf(rk) + 1}/${rl.length}">${rl.map((r) => `<i${r === rk ? ' class="on"' : ''}></i>`).join('')}</span>` : ''}</div>${multiR ? nav(1, '›') : ''}${zoom}</div><div class="rm-rack">${shelves}</div></div>`;
      }).join('');
    }
    _viewV2(sel, bottles, info) {
      const yr = new Date().getFullYear();
      const d = this._det;
      const hist = !!(d && d.hist); // drunk entry (flag history): same view, "empty" hint instead of the take-out bar
      if (hist) { // wine facts of a wine that is not in the cellar any more come from the bottle details
        const wf = (info && info.wineFacts) || {};
        sel = Object.assign({}, sel);
        ['country', 'region', 'appellation', 'sweetness'].forEach((f) => { if (!sel[f] && wf[f]) sel[f] = wf[f]; });
        if (!(sel.grapes || []).length && wf.grapes) sel.grapes = wf.grapes;
        if (!(sel._cls || []).length && wf.classification) sel._cls = String(wf.classification).split(/\s*,\s*/).filter(Boolean);
      }
      // Region and classification are already in the title line: only country and (differing) appellation here
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
      const maturity = bar || (d && d.hist ? '' : `<div>${this._sdot(st)} ${esc(STATUS_LABEL[st])}</div>`); // drunk entry: the hint box already says it
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
      let shopTxt = lot('purchaseLocation', (v) => v, false);
      let urlTxt = lot('purchaseUrl', (v) => v, false);
      { // Generic special rule: a single merchant AND a single http(s) address -> the merchant is the link, no second row
        const uq = (k) => Array.from(new Set(infos.map((i) => i[k]).filter((v) => v != null && v !== '')));
        const [ls, us] = [uq('purchaseLocation'), uq('purchaseUrl')];
        if (ls.length === 1 && us.length === 1 && /^https?:\/\//i.test(us[0])) { shopTxt = `<a class="dlink" href="${esc(us[0])}" target="_blank" rel="noopener noreferrer" title="${esc(us[0])}">${esc(ls[0])}</a>`; urlTxt = ''; }
      }
      const ratingTxt = lot('rating', (v) => String(v) + ((infos.find((i) => i.ratingScale) || {}).ratingScale ? ' / ' + infos.find((i) => i.ratingScale).ratingScale : ''), true);
      const nOrder = bottles.filter((b) => this._info[b.id] && this._info[b.id].onOrder).length;
      const rows = [
        [t('det.price'), priceTxt], [t('det.purchaseDate'), dateTxt], [t('det.shop'), shopTxt], [t('det.purchaseUrl'), urlTxt], [t('det.size'), lot('bottleSize', (v) => v, false)],
        [t('det.rating'), ratingTxt], [t('det.occasion'), lot('occasion', (v) => v, false)],
        [t('det.onOrder'), nOrder ? (nOrder === bottles.length ? '✓' : `${nOrder}/${bottles.length}` + ne) : ''],
      ];
      const loadingInfo = !info || info.loading;
      // ONE block: every data field (Cellarion, personal, bottle data, info-only attributes) is a row in the order of the data-field settings; empty and switched-off ones are left out.
      let dataBlock = '';
      {
        const im = infoMap(sel.p);
        const drow = [];
        this._infoDefs(true).filter((d) => !this._dOff(d.id)).forEach((d) => {
          const add = (k, v, ik) => { if (v) drow.push({ k, v, ik: ik && im[ik] ? ik : '', more: this._iMore.has(d.id) }); };
          if (d.clsg !== undefined) {
            add(d.label, esc((sel._cls || []).filter((v) => this._clsKind(v) === d.clsg).join(', ')), im[d.clsg] ? d.clsg : '');
          } else if (d.infoOnly) add(d.label, esc(this._infoVal(sel, d.attr)), d.attr);
          else if (d.id === 'country') add(t('filter.country'), esc(sel.country), 'country');
          else if (d.id === 'region') add(t('filter.region'), esc(sel.region), 'region');
          else if (d.id === 'appellation') add(t('filter.appellation'), esc(sel.appellation), 'appellation');
          else if (d.id === 'sweetness') add(t('filter.sweetness'), esc(sel.sweetness), '');
          else if (d.id === 'grape') add(t('filter.grape'), esc((sel.grapes || []).join(', ')), 'grape');
          else if (d.bottle) { const r = rows[BOTTLE_ROWS.findIndex((x) => x[0] === d.id)]; if (r) add(r[0], r[1], ''); }
          else if (d.personal) {
            const l = d.label, vs = Array.from(new Set(bottles.map((b) => b.p && b.p[l]).filter(Boolean)));
            add(l, vs.length ? esc(vs.map((v) => this._fmtVal(v)).join(', ')) + (vs.length > 1 ? ne : '') : '', '');
          }
        });
        const dOpen = !!(d && d.dmore), nMore = drow.filter((r) => r.more).length;
        const dl = (rs) => `<dl class="dfacts" style="margin:0">${rs.map((r) => `<dt>${esc(r.k)}</dt><dd${r.ik ? ` data-dik="${esc(r.ik)}"` : ''}>${linkify(r.v)}</dd>`).join('')}</dl>`;
        dataBlock = `<div class="d2mine d2data">` + (drow.length ? dl(drow.filter((r) => !r.more || dOpen)) : '') +
          (nMore ? `<button type="button" class="d2moreb${dOpen ? ' open' : ''}" data-act="drmore" aria-expanded="${dOpen}" aria-label="${esc(t(dOpen ? 'det.dmoreHide' : 'det.dmoreShow'))}" title="${esc(t(dOpen ? 'det.dmoreHide' : 'det.dmoreShow'))}"><span aria-hidden="true">${dOpen ? '▴' : '▾'}</span> ${esc(dOpen ? t('det.dmoreLess') : t('det.dmoreN', { n: nMore }))}</button>` : '') +
          (loadingInfo ? `<div class="dpur">${esc(t('det.noteLoading'))}</div>` : (info.error ? `<div class="dpur">${esc(t('det.noteError', { err: info.error }))}</div>` : '')) + `</div>`;
      }
      // Leave out the first note paragraph with the merchant (e.g. "Bought at ..."): it is already under My data
      const stripShop = (n, shop) => {
        const parts = String(n).split(/\n\s*\n/);
        if (shop && parts.length > 1 && parts[0].toLowerCase().includes(String(shop).toLowerCase()) && parts[0].length < 140) parts.shift();
        return parts.join('\n\n');
      };
      const notes = Array.from(new Set(infos.map((i) => (i.notes ? stripShop(i.notes, i.purchaseLocation) : '')).filter(Boolean)));
      const noteHtml = notes.length ? `<div class="dsec">${esc(t('det.myNote'))}${notes.length > 1 ? ne : ''}</div><div class="dnote">${linkify(esc(notes[0]))}</div>` : '';
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
      const _dcnt = t('hist.drunkN', { n: bottles.length });
      // flag history: drunk bottles of this wine and vintage in brackets behind the count
      const _hn = !hist ? (this._data.history || []).filter((h) => (h.wine || h.name) === sel.wine && String(h.vintage || 'NV') === String(sel.vintage || 'NV')).length : 0;
      const _dn = _hn ? t('hist.drunkN', { n: _hn }) : ''; // shown as its own purple mark behind the count
      const _ctag = this._allCellars() && sel._cn ? `<span class="ctag">${esc(sel._cn)}</span>` : ''; // all cellars together: the cellar of the chosen place
      const popup = sectionOpen ? `<div class="d2pop" role="listbox">${gRows(Array.from(groups.entries()))}</div>` : '';
      const botsSec = '';
      const actBar = `<div class="dact d2act">${popup}` +
        `<button class="d2sel" data-act="dbots" aria-expanded="${sectionOpen}" aria-haspopup="listbox"><span class="d2st"><span class="d2sub" style="color:var(--cb-text);font-weight:600">${_ctag}${esc(_rk)} · <span class="bw">${esc(_cnt)}</span><span class="bi" title="${esc(_cnt)}" aria-label="${esc(_cnt)}"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M10 2h4v2.5c0 1 .6 1.6 1.2 2.6C16 8.3 16.5 9.5 16.5 11V21a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V11c0-1.5.5-2.7 1.3-3.9C9.4 6.1 10 5.5 10 4.5z"/></svg>${_nRack}</span></span>${_places ? `<span class="loc">${esc(_places)}</span>` : ''}</span>` +
        `<span class="d2pill${multi ? ' hot' : ''}"${multi ? ` title="${esc(t('det.morePlaces', { n: groups.size - 1 }))}" aria-label="${esc(t('det.morePlaces', { n: groups.size - 1 }))}"` : ''}>${multi ? '+' + (groups.size - 1) + ' ' : ''}${sectionOpen ? '▾' : '▴'}</span></button>` +
        `<button class="btn on" data-act="dask">${esc(t('det.take'))}</button>` +
        (sel.where && sel.where.rack ? `<button class="btn rbtn round" data-act="drack" aria-pressed="${!!(d && d.rackBig)}" title="${esc(t('det.rackBig'))}" aria-label="${esc(t('det.rackBig'))}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M9 3v18M15 3v18"/></svg></button>` : '') +
        (this._edUrl(sel) ? `<a class="btn clink" href="${esc(this._edUrl(sel))}" target="_blank" rel="noopener" title="${esc(t('det.editIn'))}"><span>${esc(t('det.openIn'))}</span><img class="clogo" src="${CEL_LOGO}" alt="" width="10" height="24"></a>` : '') + `</div>`;
      let hint = '';
      if (hist) {
        const dt2 = (v) => { try { return v ? new Intl.DateTimeFormat(I18N.lang || 'de', { dateStyle: 'medium' }).format(new Date(v)) : ''; } catch (x) { return String(v || '').slice(0, 10); } };
        const line = (b) => {
          const rk = 'hist.reason.' + (b.reason || 'drank'), why = I18N.dict[rk] !== undefined ? t(rk) : String(b.reason || '');
          const rt = typeof b.rating === 'number' ? ' · ' + (b.scale && !/star/i.test(b.scale) ? b.rating + ' ' + b.scale : '★ ' + b.rating) : '';
          return `<span class="dpur">${esc('✓ ' + why + (b.at ? ' ' + dt2(b.at) : '') + rt)}</span>` + (b.note ? `<span class="dpur" style="white-space:pre-line">${esc(b.note)}</span>` : '');
        };
        // identical entries (same date, reason, rating, note) become one line with a count; the newest three lines are visible, the rest behind a button
        const grp = new Map();
        bottles.slice(0, 200).forEach((b) => { const k = [b.at, b.reason, b.rating, b.scale, b.note].join('|'); if (grp.has(k)) grp.get(k).n++; else grp.set(k, { b, n: 1 }); });
        const rows = Array.from(grp.values()), hOpen = !!(d && d.drunkOpen), shownR = hOpen ? rows : rows.slice(0, 3);
        const gl = (r) => (r.n > 1 ? line(r.b).replace('<span class="dpur">', '<span class="dpur">' + esc(r.n + '× ')) : line(r.b));
        hint = `<div class="hempty"><b>${esc(t('hist.empty'))}</b>${shownR.map(gl).join('')}` +
          (rows.length > 3 ? `<button class="dsech" data-act="ddrunk" aria-expanded="${hOpen}">${esc(hOpen ? t('det.drunkLess') : t('det.drunkMore', { n: rows.length - 3 }))}</button>` : '') + `</div>`;
      }
      // Drunk bottles of this vintage (own history) as a section above the take-out bar; other vintages are reached via the vintage bar
      let drunkSec = '';
      const dh = !hist ? (this._data.history || []).filter((h) => (h.wine || h.name) === sel.wine && String(h.vintage || 'NV') === String(sel.vintage || 'NV')).sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))) : [];
      const noteOv = dh.length > 0; // drunk entries of this vintage: the drunk mark in the header line opens an overlay with all of them
      if (false) { // the section is replaced by the overlay
        const dOpen = !!(d && d.drunkOpen);
        const dt3 = (v) => { try { return v ? new Intl.DateTimeFormat(I18N.lang || 'de', { dateStyle: 'medium' }).format(new Date(v)) : ''; } catch (x) { return String(v || '').slice(0, 10); } };
        const ln = (b) => {
          const rk = 'hist.reason.' + (b.reason || 'drank'), why = I18N.dict[rk] !== undefined ? t(rk) : String(b.reason || '');
          const rt = typeof b.rating === 'number' ? ' · ' + (b.scale && !/star/i.test(b.scale) ? b.rating + ' ' + b.scale : '★ ' + b.rating) : '';
          return `<span class="dpur">${esc('✓ ' + why + (b.at ? ' ' + dt3(b.at) : '') + rt)}</span>` + (b.note && !noteOv ? `<span class="dpur" style="white-space:pre-line">${esc(b.note)}</span>` : '');
        };
        const shown = dOpen ? dh.slice(0, 40) : dh.slice(0, 3); // the latest three are always visible, more behind a button
        drunkSec = `<div class="hempty dsec"><b>${esc(t('det.drunkSec', { n: dh.length }))}</b>${shown.map(ln).join('')}` +
          (dh.length > 3 ? `<button class="dsech" data-act="ddrunk" aria-expanded="${dOpen}">${esc(dOpen ? t('det.drunkLess') : t('det.drunkMore', { n: dh.length - 3 }))}</button>` : '') + `</div>`;
      }
      // The label photo can sit on one bottle only (own photo): then take it from any bottle of the vintage
      const imgSrc = (info && info.image) || ((bottles.map((x) => this._info[x.id]).find((i) => i && i.image)) || {}).image;
      const img = imgSrc ? `<img class="dimg" alt="${esc(t('det.label'))}" src="${esc(imgSrc)}" onerror="this.remove()">` : '';
            const mainParts = [hist ? '' : t('det.bottlesN', { n: bottles.length })].filter(Boolean).map((x) => '<span class="d2sub">' + esc(x) + '</span>').concat(_dn ? [noteOv ? `<button type="button" class="d2sub dgone dlink" data-act="dnote" aria-expanded="${!!(d && d.dnote)}" title="${esc(t('det.dnote'))}">${esc(_dn)}</button>` : '<span class="d2sub dgone">' + esc(_dn) + '</span>'] : []);
      this._vbar = '';
      let top = `<div class="d2top">${mainParts.length ? `<div>${mainParts.join(' · ')}</div>` : ''}<!--vb--></div>`;
      const main = `<div class="d2main">` + dataBlock + `</div>`;
      // Vintage bar: the other vintages of this wine (in stock: with count; completely drunk: purple)
      const wk = d.wine, cur = String(sel.vintage || 'NV');
      const vm = new Map();
      (this._data.bottles || []).forEach((b) => { if ((b.wine || b.name) === wk) { const v = String(b.vintage || 'NV'); vm.set(v, (vm.get(v) || 0) + 1); } });
      const stock = new Set(vm.keys());
      const gone = new Set();
      (this._data.history || []).forEach((h) => { if ((h.wine || h.name) === wk) { const v = String(h.vintage || 'NV'); if (!stock.has(v)) gone.add(v); } });
      const vy = (v) => (v === 'NV' ? -1 : Number(v) || 0);
      const vlist = Array.from(stock).map((v) => [v, false]).concat(Array.from(gone).map((v) => [v, true])).filter(([v]) => v !== cur).sort((a, b) => vy(b[0]) - vy(a[0]));
      const vbar = vlist.length ? `<div class="vbar"><span class="vlbl">${esc(t('det.vints'))}</span>` + vlist.map(([v, g]) =>
        `<button type="button" class="vchip${g ? ' gone' : ''}" data-act="dvint" data-v="${esc(v)}" data-h="${g ? 1 : 0}" title="${esc(g ? t('hist.empty') : t('det.bottlesN', { n: vm.get(v) }))}">${esc(v)}${g ? '' : ' · ' + vm.get(v)}</button>`).join('') + `</div>` : '';
      const bigMap = !hist && d && d.rackBig ? this._rackMap(sel, bottles, true) : '';
      if (noteOv && d && d.dnote) {
        const dt4 = (v) => { try { return v ? new Intl.DateTimeFormat(I18N.lang || 'de', { dateStyle: 'medium' }).format(new Date(v)) : ''; } catch (x) { return String(v || '').slice(0, 10); } };
        top = top.replace(/<\/div>$/, '') + `<div class="dnpop" data-act="dnote" role="dialog">${dh.slice(0, 40).map((h) => {
          const rk = 'hist.reason.' + (h.reason || 'drank'), why = I18N.dict[rk] !== undefined ? t(rk) : String(h.reason || '');
          const rt = typeof h.rating === 'number' ? ' · ' + (h.scale && !/star/i.test(h.scale) ? h.rating + ' ' + h.scale : '★ ' + h.rating) : '';
          return `<div class="dnitem"><b>${esc(why + (h.at ? ' ' + dt4(h.at) : '') + rt)}</b>${h.note ? `<span>${esc(h.note)}</span>` : ''}</div>`;
        }).join('')}</div></div>`;
      }
      top = top.replace('<!--vb-->', vbar); // own stock and other vintages share one line in the header, under the title (aligned with the vintage; wraps on narrow screens)
      this._vbar = /<div/.test(top.replace('<div class="d2top">', '')) ? top : ''; // nothing to show: no empty line
      if (bigMap) return `<div class="rm-row rm-bigrow"><div class="rm-col">${img}${main}</div>${bigMap}</div>${actBar}`;
      return `<div class="d2hero${img ? '' : ' noimg'}">${img}${main}</div>${hint}${maturity + about + noteHtml}${drunkSec}${botsSec}${hist ? this._histBar(sel) : actBar}`;
    }
    // Bottom bar of a drunk entry: no take-out, only the link to Cellarion (not for wines that are only in the log)
    _histBar(sel) {
      const u = String(sel.wine || '').startsWith('h:') ? '' : this._edUrl(sel);
      return `<div class="dact d2act"><button class="btn" data-act="dclose">${esc(t('det.done'))}</button>` +
        (u ? `<a class="btn clink" href="${esc(u)}" target="_blank" rel="noopener" title="${esc(t('det.editIn'))}"><span>${esc(t('det.openIn'))}</span><img class="clogo" src="${CEL_LOGO}" alt="" width="10" height="24"></a>` : '') + `</div>`;
    }
    _renderDlg() { this._renderDlg0(); this._hsync(); this._dlgTop(); this._swipe(); }
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
    // ---- Info overlay: all info texts of the selected bottle as tabs, opened below the clicked value ----
    // An extension may override _infoSel/_infoVal/_infoTab/_ref (e.g. a data source behind the texts).
    _infoSel() {
      const d = this._det;
      if (!d || !this._data) return null;
      const bottles = this._detBottles();
      return bottles.find((b) => b.id === d.sel) || bottles[0] || null;
    }
    // Current value of an attribute of the bottle (title of the overlay)
    _infoVal(sel, k) {
      if (!sel) return '';
      if (k === 'producer') return sel.producer || '';
      if (k === 'country') return sel.country || '';
      if (k === 'region') return sel.region || '';
      if (k === 'appellation') return sel.appellation || '';
      if (k === 'sweetness') return sel.sweetness || '';
      if (k === 'grape') return (sel.grapes || []).join(', ');
      if (this._kinds().indexOf(k) >= 0) return (sel._cls || []).filter((c) => this._clsKind(c) === k).join(', ');
      const p = sel.p || {};
      const pk = Object.keys(p).find((n) => !isInfoKey(n) && infoNorm(n) === k);
      if (pk) return [].concat(p[pk]).join(', ');
      const e = this._ref(k, this._refParse(infoMap(p)[k]).id); // no own value -> the name of the reference entry
      return e ? e.name : '';
    }
    // ---- Reference entries: the wine field info:<attribute> holds the ID of an entry (optionally "<ID> | note about this wine") ----
    // Hook for the data source (extension): _ref(attribute, id) -> {key, name, facts:[{k,l,v}], text, quellen:[{name,url}]} | null. Without an extension nothing resolves.
    _ref() { return null; }
    _refParse(v) { const s = String(v == null ? '' : v).trim(), i = s.indexOf('|'); return { id: (i < 0 ? s : s.slice(0, i)).trim(), note: i < 0 ? '' : s.slice(i + 1).trim() }; }
    // Bottles in the data that point to the same entry
    _refOwned(attr, key) {
      return ((this._data && this._data.bottles) || []).filter((b) => { const v = infoMap(b.p)[attr], e = v ? this._ref(attr, this._refParse(v).id) : null; return e && e.key === key; }).length;
    }
    // Tab content of an entry: one generic rendering for every attribute
    _refTab(x, sel) {
      const p = this._refParse(x.items[x.tab]), e = p.id ? this._ref(x.tab, p.id) : null;
      if (!e) return null;
      const n = this._refOwned(x.tab, e.key), row = (f) => `<div class="dpur"><b>${esc(f.l)}</b> ${esc(f.v)}</div>`;
      const q = (e.quellen || []).map((o) => (o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.name || o.url)} ↗</a>` : esc(o.name || ''))).filter(Boolean).join(' · ');
      return { title: e.name, sub: [infoLbl(x.tab), n ? t('info.owned', { n }) : ''].filter(Boolean).join(' · '),
        body: (e.facts || []).map(row).join('') + (e.text ? `<div class="dpur" style="white-space:pre-line;margin-top:10px">${esc(e.text)}</div>` : '') +
          (p.note ? `<div class="dsec" style="margin-top:12px">${esc(t('info.note'))}</div><div class="dpur" style="white-space:pre-line">${esc(p.note)}</div>` : '') +
          (q ? `<div class="dpur" style="margin-top:12px">${q}</div>` : '') };
    }
    // Content of one tab: {title, sub, body}
    _infoTab(x, sel) {
      { const r = this._refTab(x, sel); if (r) return r; }
      const val = this._infoVal(sel, x.tab);
      return { title: val || infoLbl(x.tab), sub: val ? infoLbl(x.tab) : '', body: `<div class="dpur" style="white-space:pre-line">${esc(x.items[x.tab])}</div>` };
    }
    _infoOpen(key, from) {
      const sel = this._infoSel();
      if (!sel) return;
      this._xv = { tab: key, items: infoMap(sel.p), anim: true, top: 0 };
      try { if (from && this._dlg) { const r = from.getBoundingClientRect(), dr = this._dlg.getBoundingClientRect(); this._xv.top = Math.max(0, Math.round(r.bottom - dr.top + 6)); } } catch (e) { /* default: top */ }
      this._renderDlg();
    }
    _infoRender() {
      const el = this._dlg, x = this._xv, sel = this._infoSel();
      if (!el || !x || !sel) return;
      // Tab order = order of the info settings (the same order as the rows of "My data"); producer first
      const defs = this._infoDefs(true);
      const rank = (k) => {
        if (k === 'producer') return -2;
        const id = this._infoDefId(k);
        const i = id ? defs.findIndex((d2) => d2.id === id) : -1;
        return i < 0 ? 999 : i;
      };
      const keys = Object.keys(x.items).filter((k) => !this._infoOff(k)).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
      if (keys.indexOf(x.tab) < 0 && keys.length) x.tab = keys[0];
      const chip = (k, label, on) => `<button class="chip${on ? ' on' : ''}" data-act="dxtab" data-k="${esc(k)}" data-v="${esc(k)}">${esc(label)}</button>`;
      const chips = keys.length > 1 ? `<div class="row-chips" style="margin-top:8px">${keys.map((k) => chip(k, infoLbl(k), k === x.tab)).join('')}</div>` : '';
      const tab = this._infoTab(x, sel);
      const anim = x.anim; x.anim = false;
      const css = '<style>.xscrim{position:absolute;inset:0;z-index:6;background:rgba(0,0,0,.25)}' +
        '.xdrop{position:absolute;z-index:7;top:var(--xt,0px);left:0;right:0;margin:0 auto;width:100%;max-width:560px;max-height:calc(100% - var(--xt,0px) - 12px);overflow-y:auto;box-sizing:border-box;' +
        'padding:14px 16px;background:var(--cb-card);color:var(--cb-text);border-radius:14px;box-shadow:0 6px 28px rgba(0,0,0,.5);border:1px solid var(--cb-line);overscroll-behavior:contain}' +
        '.xdrop .dpur{color:var(--cb-text);font-size:.95em;line-height:1.5}.xdrop .dpur a{color:var(--primary-color,#8ab4f8)}' +
        '.xdrop.xin{animation:xdown .22s ease-out}@keyframes xdown{from{clip-path:inset(0 0 100% 0);opacity:.4;transform:translateY(-8px)}to{clip-path:inset(0 0 0 0);opacity:1;transform:none}}@media(min-width:700px){.xdrop{width:calc(100% - 64px);max-width:496px}}</style>';
      const old = el.querySelector('.xscrim'); if (old) { old.remove(); const od = el.querySelector('.xdrop'); if (od) od.remove(); }
      el.insertAdjacentHTML('beforeend', css + '<div class="xscrim" data-act="dxback"></div><div class="xdrop' + (anim ? ' xin' : '') + '" style="--xt:' + (x.top || 0) + 'px" role="dialog" aria-modal="true"><div class="dh"><button class="dx" data-act="dxback" aria-label="' + esc(t('info.back')) + '">←</button>' +
        `<span class="wmain"><span class="wname">${esc(tab.title)}</span>${tab.sub ? `<span class="wsub">${esc(tab.sub)}</span>` : ''}</span>` +
        `<button class="dx" data-act="dxback" aria-label="${esc(t('head.close'))}">✕</button></div>${chips}<div style="margin-top:10px">${tab.body}</div></div>`);
      el.hidden = false;
    }
    // After each draw of the detail dialog: raw info rows go away, the values of attributes with an info text become clickable
    _infoMark() {
      const el = this._dlg, sel = this._infoSel();
      if (!el || el.hidden || !sel || !this._det || this._det.step === 'done' || this._det.step === 'confirm') return;
      const im = infoMap(sel.p), keys = Object.keys(im);
      const mark = (n, key, lbl) => { if (!n) return; n.dataset.act = 'dxi'; n.dataset.ik = key; n.dataset.lbl = lbl; n.setAttribute('style', (n.getAttribute('style') || '') + ';' + INFO_CLICK); n.title = lbl; };
      const done = new Set();
      // Rows of "My data": raw info fields are removed, a row named like an attribute makes its value clickable
      const rows = Array.from(el.querySelectorAll('dl.dfacts dt')).map((dt) => ({ dt, dd: dt.nextElementSibling, k: dt.textContent.trim() }));
      rows.forEach((r) => {
        if (isInfoKey(r.k)) { r.dt.remove(); if (r.dd) r.dd.remove(); return; }
        // A personal field with a translated attribute name shows that name (e.g. "Village" -> "Ort")
        const nk = infoNorm(r.k), tr = (k) => t('info.lbl.' + k) !== 'info.lbl.' + k;
        if (this._isPers(nk) && tr(nk)) r.dt.textContent = infoLbl(nk);
        const names = [nk].concat(r.k.split('/').map(infoNorm));
        const key = keys.find((k) => !done.has(k) && this._isPers(k) && names.indexOf(k) >= 0);
        if (key && r.dd) { mark(r.dd, key, tr(key) ? infoLbl(key) : r.k); done.add(key); }
      });
      // Flag detrows: the built-in rows of the data block carry their attribute (data-dik)
      el.querySelectorAll('.d2data dd[data-dik]').forEach((dd) => { const k = dd.dataset.dik; if (im[k] && !done.has(k)) { mark(dd, k, infoLbl(k)); done.add(k); } });
      // Producer
      if (im.producer) { mark(el.querySelector('.dh .wprod'), 'producer', infoLbl('producer')); done.add('producer'); }
      // Classification in the header line: one item per kind; the item is clickable when that kind has an info text
      this._kinds().forEach((k) => {
        const c = (sel._cls || []).filter((v) => this._clsKind(v) === k);
        const key = im[k] ? k : '';
        if (!c.length || !key) return;
        const n = Array.from(el.querySelectorAll('.dh .wreg')).find((w) => w.textContent.trim() === c.join(', '));
        if (n) { mark(n, key, infoLbl(key)); done.add(key); }
      });
      // Other built-in attributes: the sub line of the detail (appellation, grapes) and the region in the header
      const sub = Array.from(el.querySelectorAll('.d2sub'));
      if (im.appellation && !done.has('appellation')) mark(sub.find((n) => n.textContent.trim() === sel.appellation), 'appellation', infoLbl('appellation'));
      if (im.grape && !done.has('grape')) mark(sub.find((n) => n.textContent.trim() === (sel.grapes || []).join(', ')), 'grape', infoLbl('grape'));
      if (im.country && !done.has('country')) mark(sub.find((n) => n.textContent.trim() === sel.country), 'country', infoLbl('country'));
      if (im.region && !done.has('region')) mark(Array.from(el.querySelectorAll('.dh .wreg')).find((n) => n.textContent.trim() === sel.region), 'region', infoLbl('region'));
    }
    // Android back (Companion app): every open dialog level gets its own history entry, so "back" closes only the top level.
    _hdepth() {
      return (this._det ? 1 : 0) + (this._set ? 1 : 0) + (this._stat ? 1 + (this._stat.path || []).length : 0) + ((this._wz && !this._wzIn) ? 1 : 0) + (this._dd ? 1 : 0) + (this._cfm ? 1 : 0) + (this._xv ? 1 : 0);
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
      if (this._xv) { this._xv = null; this._renderDlg0(); this._hsync(); return; } // info overlay: one level back
      // one level back
      if (this._cfm) this._cfm = null;
      else if (this._dd) this._dd = null;
      else if (this._wz && !this._wzIn) { if (!this._wz.busy) this._wz = null; }
      else if (this._set) this._set = null;
      else if (this._stat) { if (this._stat.path.length) { this._stat.path.pop(); this._stat.all = false; } else this._stat = null; }
      else if (this._det) { if (!this._det.busy) this._det = null; }
      this._renderDlg0();
      this._hsync();
    }
    _renderDlg0() {
      if (this._xv && !this._det) this._xv = null;
      this._renderDlgBase();
      try { this._infoMark(); } catch (e) { /* the card keeps working without it */ }
      if (this._xv) { try { this._infoRender(); } catch (e) { /* the card keeps working */ } }
    }
    _renderDlgBase() {
      const el = this._dlg;
      if (!el) return;
      el.classList.toggle('dd', !!this._dd);
      if (this._cfm) {
        el.innerHTML = `<div class="dsheet csheet" role="dialog" aria-modal="true"><div class="dh"><span class="wmain"><span class="wname">${esc(t('rl.title'))}</span>` +
          `<span class="wsub">${esc(t('rl.text'))}</span></span></div>` +
          `<div class="dact"><button class="btn" data-act="pno">${esc(t('rl.cancel'))}</button><button class="btn on" data-act="pyes">${esc(t('rl.confirm'))}</button></div></div>`;
        el.hidden = false;
        return;
      }
      if (this._dd) { this._renderDd(); return; }
      if (this._wz && !this._wzIn) { this._renderWz(); return; }
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
      const head = `<div class="dh dhs">${this._typeDot(b0)}<span class="wmain">${this._title(b0, '', undefined, true)}<!--vb--></span>` +
        `<button class="dx" data-act="dclose" aria-label="${esc(t('head.close'))}" ${d.busy ? 'disabled' : ''}>✕</button></div>`;
      let body = '';
      this._vbar = '';
      if (d.step === 'done') {
        body = `<div class="dask">${esc(t('det.taken'))}</div><div>${esc(d.snap.name)} ${esc(d.snap.vintage || '')}${d.snap._loc !== NO_LOC ? ' · ' + esc(d.snap._loc) : ''}<br>` +
          `<span class="dpur">${esc(t('det.takenInfo', { reason: d.reasonLabel }))}</span></div>` +
          `<div class="dact">${bottles.length ? `<button class="btn" data-act="dagain">${esc(t('det.again', { n: bottles.length }))}</button>` : ''}` +
          `<button class="btn on" data-act="dclose">${esc(t('det.done'))}</button></div>`;
      } else if (d.step === 'confirm') {
        const reasons = ['drank', 'gifted', 'sold', 'other'].map((v) => [v, t('reason.' + v)]);
        body = `<div class="dask">${esc(t('det.confirmTitle'))}</div>` +
          `<div><b>${esc(sel.name)} ${esc(sel.vintage || '')}</b><br><span class="dpur">${esc(sel._loc === NO_LOC ? t('loc.noneShort') : (this._exactPlace(sel) || sel._loc))}</span></div>` +
          `<div class="dsec">${esc(t('det.reason'))}</div><div class="row-chips">` +
          reasons.map(([v, l]) => `<button class="chip${d.reason === v ? ' on' : ''}" data-act="dreason" data-v="${v}">${l}</button>`).join('') + `</div>` +
          (d.err ? `<div class="derr">${esc(d.err)}</div>` : '') +
          `<div class="dact"><button class="btn" data-act="dback" ${d.busy ? 'disabled' : ''}>${esc(t('det.cancel'))}</button>` +
          `<button class="btn danger" data-act="dgo" ${d.busy ? 'disabled' : ''}>${esc(d.busy ? t('det.taking') : t('det.takeYes'))}</button></div>`;
      } else {
        body = this._viewV2(sel, bottles, info);
      }
      const top = el.firstElementChild ? el.firstElementChild.scrollTop : 0;
      el.innerHTML = `<div class="dsheet" role="dialog" aria-modal="true">${head.replace('<!--vb-->', this._vbar || '')}${body}</div>`;
      if (el.firstElementChild) el.firstElementChild.scrollTop = top;
      el.hidden = false;
    }
    async _onDlg(act, el) {
      if (act === 'dxi') { if (this._det) this._infoOpen(el.dataset.ik, el); return; }
      if (this._xv && act === 'dxback') { this._xv = null; this._renderDlg(); return; }
      if (this._xv && act === 'dxtab') { this._xv.tab = el.dataset.v; this._renderDlg0(); return; }
      const d = this._det;
      if (!d) return;
      if (act === 'dclose') { if (!d.busy) { this._det = null; this._renderDlg(); } return; }
      if (act === 'dsel') { d.sel = el.dataset.id; d.more = false; d.botsOpen = false; }
      else if (act === 'drack') d.rackBig = !d.rackBig;
      else if (act === 'drnav') { this._rackStep(Number(el.dataset.dir) || 1); return; }
      else if (act === 'dmore') d.more = !d.more;
      else if (act === 'dbots') d.botsOpen = !d.botsOpen;
      else if (act === 'drmore') d.dmore = !d.dmore;
      else if (act === 'ddrunk') { d.drunkOpen = !d.drunkOpen; }
      else if (act === 'dnote') d.dnote = !d.dnote;
      else if (act === 'dvint') { if (d.busy) return; this._det = { wine: d.wine, vintage: el.dataset.v, hist: el.dataset.h === '1', step: 'view', reason: 'drank', sel: null, more: false, busy: false, err: '' }; }
      else if (act === 'dgrp') { d.grpOpen = d.grpOpen || new Set(); const l = el.dataset.l; if (d.grpOpen.has(l)) d.grpOpen.delete(l); else d.grpOpen.add(l); }
      else if (act === 'dask') { d.step = 'confirm'; d.err = ''; }
      else if (act === 'dtake') { d.sel = el.dataset.id; d.more = false; d.botsOpen = false; d.step = 'confirm'; d.err = ''; } // tap on a bottle in the rack picture
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
        const { domain, service } = this._svc(this._cfg.consume_service || 'cellarion_cellar_card.consume_bottle');
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
      // what lies under the click behind the backdrop (a chip, the statistics button, icons, ...): that click is passed on after closing; list rows (detail) are not, the click only closes
      let under = null;
      try { under = (this.shadowRoot.elementsFromPoint(e.clientX, e.clientY) || []).find((x) => x.dataset && x.dataset.act && x.dataset.act !== 'detail' && !x.closest('.dlg')); } catch (err) { under = null; }
      const ua = under && under.dataset.act;
      const same = !!(under && ((this._dd && ua === 'dd' && under.dataset.id === this._dd) || (this._set && ua === 'setopen') || (this._stat && ua === 'statopen'))); // same dialog: just close
      let closed = true;
      if (this._dd) this._dd = null;
      else if (this._cfm) { this._cfm = false; under = null; }
      else if (this._stat) this._stat = null;
      else if (this._wz && !this._wzIn) { if (this._wz.busy) { closed = false; } else this._wz = null; }
      else if (this._set) { this._set = null; this._selOpen = null; }
      else if (this._det && !this._det.busy) this._det = null;
      else closed = false;
      if (closed && under && !same && ACTIONS[under.dataset.act]) ACTIONS[under.dataset.act].call(this, under);
      else this._renderDlg();
      return true;
    }
    // Clicks: the element carries data-act; ACTIONS (below the class) maps each name to its handler.
    // Prefix groups: wz* = winery wizard, d* = detail dialog (_onDlg).
    _dnoteClose() { // drunk overlay in the detail view: close without redrawing (keeps the scroll position)
      if (!this._det || !this._det.dnote) return;
      this._det.dnote = false;
      this.shadowRoot.querySelectorAll('.dnpop').forEach((n) => n.remove());
      this.shadowRoot.querySelectorAll('.dlink[aria-expanded]').forEach((n) => n.setAttribute('aria-expanded', 'false'));
    }
    _onClick(e) {
      if (this._det && this._det.dnote && !(e.target.closest && e.target.closest('[data-act="dnote"]'))) { this._dnoteClose(); return; } // click outside closes the overlay
      if (this._backdropClick(e)) return;
      const t = e.target.closest && e.target.closest('[data-act]');
      if (!t) return;
      const act = t.dataset.act;
      const h = ACTIONS[act];
      if (h) h.call(this, t);
      else if (act.startsWith('wz')) this._onWz(act, t);
      else if (act.startsWith('d')) this._onDlg(act, t);
    }
    // Settings v2: drag a row by its grip (three lines); the rows swap places live, the new order is saved on release
    _onGrip(e) {
      const g = e.target.closest && e.target.closest('.grip');
      const row = g && g.closest('.frow');
      const list = row && row.parentElement;
      if (!list || !list.dataset.g) return;
      e.preventDefault();
      const ids = () => Array.from(list.children).map((r) => r.dataset.id);
      const before = ids().join('\n');
      row.classList.add('drag');
      list.style.userSelect = 'none'; // no text selection while dragging
      const move = (ev) => {
        const y = ev.clientY;
        let prev = row.previousElementSibling;
        while (prev && y < prev.getBoundingClientRect().top + prev.offsetHeight / 2) { list.insertBefore(row, prev); prev = row.previousElementSibling; }
        let next = row.nextElementSibling;
        while (next && y > next.getBoundingClientRect().top + next.offsetHeight / 2) { list.insertBefore(next, row); next = row.nextElementSibling; }
        const sh = list.closest('.dsheet');
        if (sh) { const r = sh.getBoundingClientRect(); if (y < r.top + 48) sh.scrollTop -= 14; else if (y > r.bottom - 48) sh.scrollTop += 14; }
      };
      const end = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
        list.style.userSelect = '';
        row.classList.remove('drag');
        const now = ids();
        if (now.join('\n') === before) return;
        if (list.dataset.g === 'f') { this._setFilters(now, Array.from(this._fh)); this._renderHead(); this._renderSet(); }
        else if (list.dataset.g === 'd') { this._setInfo(this._io, this._infoShowArr(), now); this._renderSet(); this._renderAll(); }
        else { this._setInfo(now, this._infoShowArr()); this._renderSet(); this._renderAll(); }
      };
      // Listen on the window, not on the grip: moving the row in the DOM releases pointer capture, so a drag bound to the grip stopped after one swap (mouse)
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    }
    _onWz(act, t) {
      if (act === 'wzclose') { if (!this._wz.busy) { this._wz = null; this._renderDlg(); } }
      else if (act === 'wzall') { this._wz.all = !this._wz.all; this._renderWz(); }
      else if (act === 'wzw') this._wzTap(t.dataset.h, Number(t.dataset.i));
      else if (act === 'wzdel') this._wzTap(t.dataset.h, -1);
    }
    _onChange(e) {
      if (e.target && e.target.dataset && e.target.dataset.pb !== undefined) { // setting Price bands (shared): upper limits, ascending; empty or the default = default
        const a = String(e.target.value).split(/[^0-9.]+/).filter(Boolean).map(Number);
        if (!a.length || bandsOk(a)) this._shared.priceBands = a; // empty = filter off
        else { this._renderSet(); return; }
        this._applyEff(); this._saveSettings();
        if (this._raw) this._ingest(this._raw);
        this._renderAll(); this._renderSet();
        return;
      }
      const s = e.target && e.target.dataset && e.target.dataset.sel;
      if (!s) return;
      if (s === 'sort') { this._sort = e.target.value; this._saveState(); }
      else if (e.target.value) { this._fsAdd(s, e.target.value); }
      this._renderAll();
    }
    _onInput(e) {
      if (e.target.dataset && e.target.dataset.archn !== undefined) { const n = Math.max(0, Math.min(99, parseInt(e.target.value, 10) || 0)); if (this._local.archN !== undefined) { this._local.archN = n; this._saveState(); } else { this._shared.archN = n; this._saveSettings(); } this._renderAll(); return; }
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
    dd(t) { this._dd = t.dataset.id; this._ddAnchor = t; this._renderDlg(); },
    ddclose() { this._dd = null; this._renderDlg(); },
    // Replace option, grape list: the & button adds the grape as a further condition (the wine must have all chosen grapes)
    ddand(t) { const id = this._dd, v = t.dataset.v; this._dd = null; if (id) this._fs(id).add(v); this._renderDlg(); this._renderAll(); },
    // Replace option: the x in the "Selected" line of the pick list clears this filter and keeps the list open
    ddclr() { // the list stays open: refresh the filters, re-find the (possibly re-created) button and redraw the list
      const id = this._dd; if (!id || !this._f[id]) return;
      this._f[id].clear(); this._renderAll();
      const an = this.shadowRoot.querySelector('[data-act="dd"][data-id="' + id + '"]'); if (an) this._ddAnchor = an;
      this._renderDlg();
    },
    ddpick(t) {
      const id = this._dd, v = t.dataset.v;
      if (id === 'fmode') { this._dd = null; this._setFm(v); this._renderDlg(); this._renderAll(); return; } // filter mode: Standard / OR / NOT
      if (this._multi() && id && id !== 'sort' && id !== 'cellarsel') { // OR / NOT: a pick adds a value and the list stays open (more values can follow)
        this._fsAdd(id, v); this._renderAll();
        const an = this.shadowRoot.querySelector('[data-act="dd"][data-id="' + id + '"]'); if (an) this._ddAnchor = an;
        this._renderDlg();
        return;
      }
      this._dd = null;
      if (id === 'sort') { const pr = SORT_PAIR[v]; this._sort = pr ? (pr.indexOf(this._sort) === 0 ? pr[1] : pr[0]) : v; this._saveState(); } // second tap on the active entry reverses
      else if (id === 'cellarsel') { // other cellar (or all): filters and search stay, open rows belong to the old selection and are cleared
        this._local.cellar = v; this._open = new Set(); this._saveState();
        if (this._raw) this._ingest(this._raw);
      } else if (id) { this._fsAdd(id, v); }
      this._renderDlg(); this._renderAll();
    },
    detail(t) {
      if (t.classList.contains('wrow') && this._open.size) { this._open = new Set(); this._renderList(); }
      this._det = { wine: t.dataset.w, vintage: t.dataset.v, hist: t.dataset.h === '1', step: 'view', reason: 'drank', sel: null, more: false, busy: false, err: '' };
      this._renderDlg();
    },
    statopen() { this._det = null; this._stat = { path: [], all: false }; this._renderDlg(); },
    statclose() { this._stat = null; this._renderDlg(); },
    statback() { if (this._stat) { this._stat.path.pop(); this._stat.all = false; this._renderDlg(); } },
    stattab(t) { if (this._stat) { this._stat.vtab = t.dataset.t; this._stat.all = false; this._renderDlg(); } },
    statall() { if (this._stat) { this._stat.all = !this._stat.all; this._renderDlg(); } },
    statscope(t) { if (this._stat) { this._stat.scope = t.dataset.t; this._stat.all = false; this._renderDlg(); } }, // switch between stock, archive and total
    statarch(t) { // tap in the archive statistics = this filter plus the archive switch
      const g = t.dataset.g, v = t.dataset.v;
      this._stat = null;
      this._f = { q: '' };
      if (g === 'q') this._f.q = v; else this._fsAdd(g, v);
      this._fs('hist').add('1');
      if (!this._filtered().length) { // the archive only lists wines with no bottle left: a wine still in the cellar is shown there instead
        this._fs('hist').clear();
        const bs = this._filtered(), ks = new Set(bs.map((b) => (b.wine || b.name) + '|' + String(b.vintage || 'NV')));
        if (ks.size === 1) this._det = { wine: bs[0].wine || bs[0].name, vintage: String(bs[0].vintage || 'NV'), step: 'view', reason: 'drank', sel: null, more: false, busy: false, err: '' };
      }
      this._open = new Set();
      this._renderDlg(); this._renderAll();
    },
    statgo(t) { if (this._stat) { this._stat.path.push(t.dataset.to); this._stat.all = false; this._renderDlg(); } },
    statfilter(t) {
      const g = t.dataset.g, v = t.dataset.v;
      if (g !== 'q' && this._fh.has('off:' + g)) return; // a filter set to "off" is not offered, so a tap in the statistics does not set it either
      this._stat = null;
      this._f = { q: '' }; // only the filter of the tap, earlier filters are cleared
      if (g === 'q') this._f.q = v; else this._fsAdd(g, v);
      // A single wine and vintage as result: straight to its detail page
      const keys = new Set(this._filtered().map((b) => (b.wine || b.name) + '|' + String(b.vintage || 'NV')));
      if (keys.size === 1) {
        const b = this._filtered()[0];
        this._det = { wine: b.wine || b.name, vintage: String(b.vintage || 'NV'), step: 'view', reason: 'drank', sel: null, more: false, busy: false, err: '' };
      }
      this._renderDlg(); this._renderAll();
    },
    setopen() { this._det = null; this._set = true; this._renderDlg(); },
    sx(t) { const o = this._sx || (this._sx = new Set()); const id = t.dataset.id; if (o.has(id)) o.delete(id); else { o.clear(); o.add(id); } this._renderSet(); }, // one section open at a time
    setview(t) { this._setViewId = t.dataset.g; this._sx = new Set(); const sh = this._dlg && this._dlg.querySelector('.dsheet'); this._renderSet(); if (sh) { const n = this._dlg.querySelector('.dsheet'); if (n) n.scrollTop = 0; } }, // flag setviews
    setclose() { this._set = null; if (this._wzIn) { this._wz = null; this._wzIn = false; } this._selOpen = null; this._renderDlg(); },
    selopen(t) { this._selOpen = this._selOpen === t.dataset.key ? null : t.dataset.key; this._renderSet(); },
    selpick(t) {
      const k = t.dataset.key, v = t.dataset.v;
      this._selOpen = null;
      if (k === 'setlang') ACTIONS.lang.call(this, { dataset: { v } });
      else if (k === 'setscale') { ACTIONS.scale.call(this, { dataset: { v } }); this._renderSet(); }
    },
    // Settings, filters: set the state of a filter (v: 'vis' visible, 'more' behind "...", 'off' never offered)
    fstate(t) {
      const id = t.dataset.id, v = t.dataset.v;
      const hid = new Set(this._fh);
      if (id === 'src') { // stock / archive: markers instead of ids
        hid.delete('src:more'); hid.delete('src:off');
        if (v === 'more') hid.add('src:more'); else if (v === 'off') hid.add('src:off');
        this._fh = hid;
        if (v !== 'vis') this._fs('hist').clear();
      } else if (id === 'fmode') { // filter mode: markers instead of ids
        hid.delete('fmode:show'); hid.delete('fmode:off');
        if (v === 'vis') hid.add('fmode:show'); else if (v === 'off') { hid.add('fmode:off'); this._fmode = 'std'; }
        this._fh = hid; // so _setFm sees the new state
        if (v === 'off') this._setFm('std');
      } else {
        hid.delete(id); hid.delete('off:' + id);
        if (v !== 'vis') { hid.add(id); delete this._f[id]; }
        if (v === 'off') hid.add('off:' + id);
      }
      this._setFilters(this._fo, Array.from(hid));
      this._renderAll(); this._renderSet();
    },
    dstate(t) { // details (flag detrows): v 'vis' shown, 'more' behind the arrow, 'off' not shown
      const id = t.dataset.id, v = t.dataset.v, off = new Set(this._iOff), more = new Set(this._iMore);
      off.delete(id); more.delete(id);
      if (v === 'off') off.add(id); else if (v === 'more') more.add(id);
      this._iOff = off; this._iMore = more;
      this._setInfo(this._infoDefs().filter((d) => !d.fixed).map((d) => d.id), this._infoShowArr()); this._renderSet(); this._renderAll();
    },
    icol(t) { // one checkbox of the data fields: column l = in the list, column d = in the details
      const id = t.dataset.id, is = new Set(this._is), off = new Set(this._iOff);
      if (t.dataset.col === 'l') { is.has(id) ? is.delete(id) : is.add(id); } else { off.has(id) ? off.delete(id) : off.add(id); }
      this._is = is; this._iOff = off;
      this._setInfo(this._infoDefs().filter((d) => !d.fixed).map((d) => d.id), this._infoShowArr()); this._renderSet(); this._renderAll();
    },
    rack(t) { this._setRack(t.dataset.n, t.dataset.k, t.dataset.v); },
    keepst(t) {
      const on = t.dataset.v === 'on';
      if (this._local.keepState !== undefined) { this._local.keepState = on; this._saveState(); }
      else { this._shared.keepState = on; this._saveSettings(); }
      this._renderSet();
    },
    flag(t) {
      this._local.flags = Object.assign({}, this._local.flags, { [t.dataset.id]: (FLAGS.find((x) => x.id === t.dataset.id) || {}).opts ? t.dataset.v : t.dataset.v === 'on' }); this._saveState(); if (t.dataset.id === 'history') { if (!this._flag('history')) delete this._f.hist; if (this._raw) this._ingest(this._raw); } this._renderSet(); this._renderAll(); this._renderDlg();
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
      if (t.dataset.v === 'device' && !dev) L[k] = k === 'language' ? (this._langSel || '') : k === 'keepState' ? this._keep() : k === 'hideOther' ? !this._showOther() : k === 'archN' ? this._archN() : k === 'info' ? { order: this._infoOrderArr(), show: this._infoShowArr() } : { filterOrder: this._fo.slice(), filterHidden: Array.from(this._fh) };
      else if (t.dataset.v === 'all' && dev) delete L[k];
      this._saveState();
      this._applyEff();
      this._initLang().then(() => {
        if (this._raw) this._ingest(this._raw);
        this._renderAll(); this._renderSet();
      });
    },
    showother() {
      const hide = this._showOther(); // now shown -> hide
      if (this._local.hideOther !== undefined) { this._local.hideOther = hide; this._saveState(); }
      else { this._shared.hideOther = hide; this._saveSettings(); }
      this._renderAll(); this._renderSet();
    },
    fullw() { this._local.fullw = !this._fullw(); this._saveState(); this._renderAll(); this._renderSet(); this._azWidth(); },
    mode(t) { this._local.mode = t.dataset.v; this._applyMode(); this._saveState(); this._renderSet(); this._renderAll(); this._renderDlg(); },
    scale(t) { this._scale = this._clampScale(Number(t.dataset.v) / 100); this._applyScale(); this._saveState(); this._renderDlg(); },
    wzopen() { this._wzOpen(); },
    chip(t) {
      const set = this._f[t.dataset.g];
      const v = t.dataset.v;
      if (set.has(v)) set.delete(v); else set.add(v);
      this._renderAll();
    },
    fmoff() { this._setFm('std'); this._renderDlg(); this._renderAll(); },
    histtoggle() { const S = this._fs('hist'); if (S.size) S.clear(); else S.add('1'); this._open = new Set(); this._renderAll(); },
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
    reset() { this._f = { q: '' }; this._setFm('std'); this._renderAll(); }, // clears the filters, the search, the archive and the filter mode (OR / NOT)
    reload() { this._refreshNow(); },
    reloadask() { if (!this._busy) { this._cfm = true; this._renderDlg(); } }, // like pulling down on the phone: ask first
  };

  if (!customElements.get('cellarion-cellar-card')) customElements.define('cellarion-cellar-card', CellarionBestandCard);
  // Tag of the 1.x versions, kept so existing dashboards keep working
  if (!customElements.get('my-cellarion-card')) customElements.define('my-cellarion-card', class extends CellarionBestandCard {});
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'cellarion-cellar-card',
    name: 'Cellar Card for Cellarion',
    description: 'Wine cellar inventory with search, filters, detail view and take-out (Cellarion).',
  });
})();

