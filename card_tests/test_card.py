"""Behaviour of the card in a browser: rendering, sorting, filters, dialogs, layout limits."""
import re


def q(page, js):
    return page.evaluate(js)


def count(page, sel):
    return page.evaluate("(s) => c.shadowRoot.querySelectorAll(s).length", sel)


def click(page, sel):
    assert page.evaluate("(s) => { const e = c.shadowRoot.querySelector(s); if (!e) return false; e.click(); return true; }", sel), sel
    page.wait_for_timeout(150)


def test_renders_rows_without_errors(card):
    page = card()
    assert count(page, ".wrow") > 10
    assert page.errors == []


def test_phone_has_no_horizontal_overflow(card):
    page = card(420)
    assert count(page, ".wrow") > 10
    assert q(page, "c.shadowRoot.querySelector('.list').scrollWidth <= c.shadowRoot.querySelector('.list').clientWidth + 1")
    assert page.errors == []


def test_expand_and_collapse_vintages(card):
    page = card()
    before = count(page, ".vrow")
    click(page, ".wrow[data-act=toggle]")
    assert count(page, ".vrow") > before
    click(page, ".wrow[data-act=toggle]")
    assert count(page, ".vrow") == before


def test_search_narrows_and_reset_button_follows(card):
    page = card()
    reset = "c.shadowRoot.querySelector('[data-reset]').hidden"
    assert q(page, reset) is True
    total = count(page, ".wrow")
    page.evaluate("() => { c._f.q = 'Egon'; c._renderAll(); }")
    page.wait_for_timeout(150)
    assert 0 < count(page, ".wrow") < total
    assert q(page, reset) is True  # search alone has its own cross
    page.evaluate("() => { const k = Object.keys(c._f).find((x) => x !== 'q'); c._f[k].add('x'); c._renderAll(); }")
    page.wait_for_timeout(150)
    assert q(page, reset) is False  # two things set: reset shows
    click(page, "[data-act=reset]")
    assert count(page, ".wrow") == total
    assert q(page, reset) is True


def _single_prices(page):
    return page.evaluate("""() => Array.from(c.shadowRoot.querySelectorAll('.wrow .wpm'))
        .map(e => parseFloat(e.textContent.replace(/[^0-9,]/g, '').replace(',', '.')))""")


def test_price_sort_both_directions(card):
    page = card()
    page.evaluate("() => { c._sort = 'priceAsc'; c._renderAll(); }")
    asc = _single_prices(page)
    page.evaluate("() => { c._sort = 'priceDesc'; c._renderAll(); }")
    desc = _single_prices(page)
    assert len(asc) > 3 and len(desc) > 3
    assert max(asc) == max(desc) and min(asc) == min(desc)
    # the first priced single row is cheap ascending and expensive descending
    assert asc[0] < desc[0]


def test_alphabet_sort_has_bar_and_other_sorts_do_not(card):
    page = card()
    assert q(page, "!c.shadowRoot.querySelector('.az').hidden")
    page.evaluate("() => { c._sort = 'vintage'; c._renderAll(); }")
    assert q(page, "c.shadowRoot.querySelector('.az').hidden")


def test_header_is_limited_to_alphabet_width(card):
    page = card()
    widths = page.evaluate("""() => ['.head', '.list'].map(s => c.shadowRoot.querySelector(s).style.maxWidth)""")
    assert widths[0] and widths[0] == widths[1] and widths[0].endswith("px")
    # still limited after sorting without alphabet bar
    page.evaluate("() => { c._sort = 'priceAsc'; c._renderAll(); }")
    assert page.evaluate("c.shadowRoot.querySelector('.head').style.maxWidth") == widths[0]


def test_header_layout(card):
    page = card()
    # sort sits in the count line, cellar name in the top row (not in the count text)
    assert page.evaluate("!!c.shadowRoot.querySelector('.sumline [data-id=sort]')")
    assert page.evaluate("!c.shadowRoot.querySelector('.top [data-id=sort]')")
    name = page.evaluate("c.shadowRoot.querySelector('.top .cname').textContent")
    assert name
    assert name not in page.evaluate("c.shadowRoot.querySelector('[data-sum]').textContent")
    # the count line survives a header rebuild (e.g. filters re-opening)
    before = page.evaluate("c.shadowRoot.querySelector('[data-sum]').textContent")
    page.evaluate("() => c._renderHead()")
    assert page.evaluate("c.shadowRoot.querySelector('[data-sum]').textContent") == before


def test_detail_dialog_has_edit_link(card):
    page = card()
    click(page, ".wrow[data-act=detail]")
    href = page.evaluate("c.shadowRoot.querySelector('.dlg a.dx').href")
    assert re.fullmatch(r"https://cellarion\.example/cellars/c0ffee000000000000000001/vintages/w\d+/(\d{4}|NV)", href)


def test_backdrop_click_closes_dialog(card):
    page = card()
    click(page, ".wrow[data-act=detail]")
    assert page.evaluate("!c.shadowRoot.querySelector('.dlg').hidden")
    page.evaluate("() => c.shadowRoot.querySelector('.dlg').click()")
    page.wait_for_timeout(150)
    assert page.evaluate("c.shadowRoot.querySelector('.dlg').hidden")


def test_statistics_and_settings_open_and_close(card):
    page = card()
    click(page, "[data-act=statopen]")
    assert page.evaluate("!c.shadowRoot.querySelector('.dlg').hidden")
    click(page, "[data-act=statclose]")
    assert page.evaluate("c.shadowRoot.querySelector('.dlg').hidden")
    click(page, "[data-act=setopen]")
    assert page.evaluate("!c.shadowRoot.querySelector('.dlg').hidden")
    click(page, "[data-act=setclose]")
    assert page.evaluate("c.shadowRoot.querySelector('.dlg').hidden")
    assert page.errors == []


def test_wide_filters_stay_open_while_scrolling(card):
    page = card()
    page.mouse.move(500, 450)
    for _ in range(10):
        page.mouse.wheel(0, 40)
        page.wait_for_timeout(40)
    page.wait_for_timeout(300)
    assert page.evaluate("c._more") is True


def test_phone_filters_fold_on_scroll_down_and_return_on_scroll_up(card):
    page = card(420)
    page.mouse.move(200, 450)
    assert page.evaluate("c._more") is True
    for _ in range(10):
        page.mouse.wheel(0, 40)
        page.wait_for_timeout(40)
    page.wait_for_timeout(300)
    assert page.evaluate("c._more") is False
    for _ in range(2):  # a little jitter upwards does not unfold them
        page.mouse.wheel(0, -6)
        page.wait_for_timeout(40)
    page.wait_for_timeout(300)
    assert page.evaluate("c._more") is False
    for _ in range(6):  # a real step up does, far from the top of the list
        page.mouse.wheel(0, -10)
        page.wait_for_timeout(40)
    page.wait_for_timeout(300)
    assert page.evaluate("c._more") is True
    assert page.evaluate("c._listEl.scrollTop") > 100


def test_no_filter_button_on_any_screen(card):
    for width in (1000, 420):
        page = card(width)
        assert page.evaluate("c.shadowRoot.querySelector('.fbtn')") is None


def test_feature_flags_cannot_be_switched_on_in_the_integration(card):
    page = card()
    page.evaluate("() => { c._cfg.flags = { sinv: true }; c._local.flags = { sinv: true }; c._renderAll(); }")
    assert page.evaluate("c.hasAttribute('data-sinv')") is False


def test_appearance_setting_per_device(card):
    page = card()
    assert page.evaluate("c.hasAttribute('data-mode')") is False  # Auto follows the HA theme
    page.evaluate("() => { c._set = true; c._renderDlg(); }")
    click(page, "[data-act=mode][data-v=light]")
    assert page.evaluate("c.getAttribute('data-mode')") == "light"
    click(page, "[data-act=mode][data-v=auto]")
    assert page.evaluate("c.hasAttribute('data-mode')") is False


def test_settings_page_marks_fixed_and_switchable_scopes(card):
    page = card()
    page.evaluate("() => { c._set = true; c._renderDlg(); }")
    assert count(page, ".setv2") == 1
    assert count(page, "[data-act=fdelask]") == 0  # data fields are managed in Cellarion, not in the card
    assert count(page, ".sone") >= 3  # settings with a single possible scope show only their icon, no switch
    assert count(page, ".sscopeb button.sw2") == 1  # the collapsed Filter section keeps a real switch
    click(page, ".sscopeb button.sw2")
    page.wait_for_timeout(300)
    assert count(page, ".sscopeb button.sw2.dev") == 1
    click(page, ".sscopeb button.sw2")
    page.wait_for_timeout(300)
    assert count(page, ".sscopeb button.sw2.dev") == 0
    assert page.errors == []
