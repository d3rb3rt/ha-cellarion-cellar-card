"""Card tests: the built card (custom_components/my_cellarion/www) in headless Chromium with a fake hass.

Run separately from the integration tests:  python -m pytest card_tests
Needs `pip install pytest playwright` and a Chromium (`playwright install chromium`).
"""
import functools
import http.server
import pathlib
import shutil
import threading

import pytest

playwright_sync = pytest.importorskip("playwright.sync_api")

HERE = pathlib.Path(__file__).parent
WWW = HERE.parent / "custom_components" / "my_cellarion" / "www"


@pytest.fixture(scope="session")
def site(tmp_path_factory):
    """A folder with the harness, the fixture inventory and the card (with its language files)."""
    d = tmp_path_factory.mktemp("site")
    shutil.copy(HERE / "harness.html", d / "harness.html")
    shutil.copy(HERE / "inventory.json", d / "inventory.json")
    shutil.copytree(WWW, d / "www")
    return d


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture(scope="session")
def base_url(site):
    """The site folder on a local web server (the card loads its language files with fetch)."""
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_Quiet, directory=str(site)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield "http://127.0.0.1:%d" % server.server_address[1]
    server.shutdown()


@pytest.fixture(scope="session")
def browser():
    with playwright_sync.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


@pytest.fixture
def card(browser, base_url):
    """Open the card; width via the `width` marker (default 1000 px). Returns a function (width) -> page."""
    pages = []

    def open_card(width=1000):
        page = browser.new_context(viewport={"width": width, "height": 700}).new_page()
        page.errors = []
        page.on("pageerror", lambda e: page.errors.append(str(e)))
        page.goto(base_url + "/harness.html")
        page.wait_for_function("window.c && c.shadowRoot && c.shadowRoot.querySelector('.wrow')", timeout=15000)
        pages.append(page)
        return page

    yield open_card
    for pg in pages:
        pg.context.close()
