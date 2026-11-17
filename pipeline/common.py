"""Shared helpers for the data pipeline (stdlib only, so it runs anywhere)."""
import http.cookiejar
import json
import os
import re
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "site", "data")
RAW_DIR = os.path.join(ROOT, "data", "raw")

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 commodity-atlas-pipeline"
)

# The ten launch commodities and the names each source uses for them.
COMMODITIES = {
    "onion": {"nhb": ("VEGETABLES", "ONION"), "doca": "Onion", "ogd": "Onion"},
    "tomato": {"nhb": ("VEGETABLES", "TOMATO"), "doca": "Tomato", "ogd": "Tomato"},
    "potato": {"nhb": ("VEGETABLES", "POTATO"), "doca": "Potato", "ogd": "Potato"},
    "brinjal": {"nhb": ("VEGETABLES", "BRINJAL"), "doca": "Brinjal", "ogd": "Brinjal"},
    "cauliflower": {"nhb": ("VEGETABLES", "CAULIFLOWER"), "doca": None, "ogd": "Cauliflower"},
    "green-chilli": {"nhb": ("VEGETABLES", "GREEN CHILLY"), "doca": None, "ogd": "Green Chilli"},
    "banana": {"nhb": ("FRUITS", "BANANA"), "doca": "Banana", "ogd": "Banana"},
    "mango": {"nhb": ("FRUITS", "MANGO"), "doca": None, "ogd": "Mango"},
    "apple": {"nhb": ("FRUITS", "APPLE"), "doca": None, "ogd": "Apple"},
    "grapes": {"nhb": ("FRUITS", "GRAPES"), "doca": None, "ogd": "Grapes"},
}


class Session:
    """Tiny cookie-keeping HTTP client."""

    def __init__(self, timeout=60):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.timeout = timeout

    def get(self, url, headers=None):
        return self._open(urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})}))

    def post(self, url, fields, headers=None):
        body = urllib.parse.urlencode(fields, doseq=True).encode()
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "User-Agent": UA,
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": url,
                **(headers or {}),
            },
        )
        return self._open(req)

    def _open(self, req, tries=3):
        for attempt in range(tries):
            try:
                with self.opener.open(req, timeout=self.timeout) as r:
                    return r.read().decode("utf-8", errors="ignore")
            except Exception:
                if attempt == tries - 1:
                    raise
                time.sleep(2 * (attempt + 1))


class FormParser(HTMLParser):
    """Collects hidden inputs and <select> options of an ASP.NET page."""

    def __init__(self):
        super().__init__()
        self.hidden = {}
        self.selects = {}
        self._sel = None
        self._opt = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "input" and a.get("type") == "hidden" and a.get("name"):
            self.hidden[a["name"]] = a.get("value", "")
        elif tag == "select":
            self._sel = a.get("name")
            self.selects[self._sel] = []
        elif tag == "option" and self._sel:
            self._opt = {"value": a.get("value", ""), "text": "", "selected": "selected" in a}

    def handle_data(self, data):
        if self._opt is not None:
            self._opt["text"] += data

    def handle_endtag(self, tag):
        if tag == "option" and self._opt is not None and self._sel:
            self._opt["text"] = self._opt["text"].strip()
            self.selects[self._sel].append(self._opt)
            self._opt = None
        elif tag == "select":
            self._sel = None


def parse_form(html):
    p = FormParser()
    p.feed(html)
    return p


class TableParser(HTMLParser):
    """Extracts every <table> as a list of rows of cell text."""

    def __init__(self):
        super().__init__()
        self.tables = []
        self._stack = []
        self._row = None
        self._cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._stack.append([])
        elif tag == "tr" and self._stack:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = ""

    def handle_data(self, data):
        if self._cell is not None:
            self._cell += data

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(re.sub(r"\s+", " ", self._cell).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None and self._stack:
            self._stack[-1].append(self._row)
            self._row = None
        elif tag == "table" and self._stack:
            self.tables.append(self._stack.pop())


def parse_tables(html):
    p = TableParser()
    p.feed(html)
    return p.tables


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def read_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)
