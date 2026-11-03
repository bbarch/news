"""Pull RSS feeds, markets and weather; write data/news.json.

    python -m teletext.fetch           # normal run (systemd timer)
    python -m teletext.fetch --check   # test every feed and print a report
"""
import argparse
import calendar
import math
import hashlib
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import feedparser
import requests

from .common import NEWS_FILE, clean_text, load_config, read_json, trim_summary, write_json

SECTIONS = ["india", "world", "business", "tech", "sport"]
STOP = set("""a an the of to in on for and or but with at by from as is are was were be been
it its this that after over into new says said amid how why what who will has have had not
than more up out about vs""".split())


# --- feeds -------------------------------------------------------------------

def _key(title: str) -> str:
    return hashlib.sha1(re.sub(r"[^a-z0-9]", "", title.lower()).encode()).hexdigest()[:12]


def _words(title: str) -> set:
    out = set()
    for w in re.findall(r"[a-z0-9]+", title.lower()):
        if w in STOP or len(w) < 3:
            continue
        if len(w) > 4 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]          # coasts -> coast, rains -> rain
        out.add(w)
    return out


def _published(entry) -> float | None:
    for k in ("published_parsed", "updated_parsed"):
        t = entry.get(k)
        if t:
            return float(calendar.timegm(t))
    return None


def fetch_feed(src: dict, feed: dict, cfg: dict) -> tuple[str, list, str | None]:
    url = feed["url"]
    try:
        r = requests.get(url, timeout=cfg["timeout"], headers={"User-Agent": cfg["user_agent"]})
        r.raise_for_status()
        parsed = feedparser.parse(r.content)
    except Exception as e:  # network, HTTP, parse
        return url, [], f"{type(e).__name__}: {e}"[:160]
    if not parsed.entries:
        return url, [], "no entries" + (f" ({parsed.bozo_exception})" if parsed.bozo else "")

    now = time.time()
    items = []
    for e in parsed.entries:
        title = clean_text(e.get("title", ""))
        if not title or any(p.search(title) for p in _skip(cfg)):
            continue
        summary = clean_text(e.get("summary", "") or e.get("description", ""))
        # Feeds that repeat the headline as the description add nothing.
        if summary.lower().startswith(title.lower()[:40]):
            summary = summary[len(title):].lstrip(" .:-")
        items.append({
            "id": _key(title),
            "title": title,
            "summary": trim_summary(summary, cfg["summary_chars"]),
            "link": e.get("link", ""),
            # Some feeds stamp local time as GMT; never let a story sit in the future.
            "published": min(_published(e) or now, now),
            "source": src["short"],
            "source_name": src["name"],
            "region": src["region"],
            "section": feed["section"],
        })
    return url, items, None


DEFAULT_SKIP = [
    r"\blive updates?\b.*\d{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)",
    r"^(gold|silver|petrol|diesel) (rate|price)s? today", r"\bhoroscope\b", r"\bcrossword\b",
    r"\bwordle\b", r"\bquiz\b", r"morning brief", r"\bphotos?:", r"^watch:", r"\bin pictures\b",
]
_SKIP_CACHE: list = []


def _skip(cfg: dict) -> list:
    if not _SKIP_CACHE:
        pats = cfg.get("skip_patterns", DEFAULT_SKIP)
        _SKIP_CACHE.extend(re.compile(p, re.I) for p in pats)
    return _SKIP_CACHE


class Similarity:
    """Weighted word overlap between headlines.

    Plain word overlap misses most real matches ("Cyclone Murasu makes
    landfall" vs "Eye of Cyclone Murasu crosses Andhra coast"), because outlets
    word things differently. Weighting each shared word by how rare it is
    across all current headlines fixes that: a shared "Murasu" counts for far
    more than a shared "India". Score = weight of shared words / weight of the
    shorter headline's words.
    """

    def __init__(self, titles: list[str], threshold: float = 0.35):
        self.n = max(len(titles), 1)
        self.df: dict = {}
        for t in titles:
            for w in _words(t):
                self.df[w] = self.df.get(w, 0) + 1
        self.threshold = threshold

    def idf(self, w: str) -> float:
        return math.log((self.n + 1) / (self.df.get(w, 0) + 1)) + 0.1

    def same(self, a: set, b: set, threshold: float | None = None) -> bool:
        if not a or not b:
            return False
        shared = sum(self.idf(w) for w in a & b)
        small = min(sum(self.idf(w) for w in a), sum(self.idf(w) for w in b))
        return small > 0 and shared / small >= (threshold or self.threshold)


def cluster(stories: list, sim: Similarity) -> list:
    """Merge the same story reported by several outlets.

    The earliest report is kept as the cluster head and the others are counted,
    so a story carried by three outlets ranks above one carried by one.
    """
    stories = sorted(stories, key=lambda s: s["published"])
    kept: list = []
    for s in stories:
        w = _words(s["title"])
        for k in kept:
            if sim.same(w, k["_w"]):
                if s["source"] not in k["sources"]:
                    k["sources"].append(s["source"])
                if len(s["summary"]) > len(k["summary"]):
                    k["summary"] = s["summary"]
                k["latest"] = max(k["latest"], s["published"])
                break
        else:
            kept.append(dict(s, sources=[s["source"]], _w=w, latest=s["published"]))
    for k in kept:
        k.pop("_w", None)
    return kept


def pick_top(india: list, world: list, sim: Similarity, n: int = 8, per_source: int = 2) -> list:
    """Alternate India and World picks, best first, at most `per_source` per outlet.

    A story's score rises 4 points for each extra outlet carrying it and falls
    half a point per hour since its latest report.
    """
    now = time.time()

    def score(s):
        return (len(s["sources"]) - 1) * 4 - (now - s["latest"]) / 3600 * 0.5

    pools = [sorted(india, key=score, reverse=True), sorted(world, key=score, reverse=True)]
    out, per = [], {}
    while len(out) < n and any(pools):
        for pool in pools:
            while pool and len(out) < n:
                s = pool.pop(0)
                if per.get(s["source"], 0) >= per_source:
                    continue
                # Looser test here: top stories should be different stories, not
                # two angles on the same one.
                if any(sim.same(_words(s["title"]), _words(o["title"]), 0.25) for o in out):
                    continue
                out.append(s)
                per[s["source"]] = per.get(s["source"], 0) + 1
                break
    return out


def balanced(stories: list, n: int, per_source: int) -> list:
    """Take turns between outlets, newest story from each in turn.

    Hindustan Times posts several times as often as the others, so a plain
    newest-first list would be mostly HT. Round-robin keeps each sub-page mixed.
    """
    by_src: dict = {}
    for s in sorted(stories, key=lambda s: s["latest"], reverse=True):
        by_src.setdefault(s["source"], []).append(s)
    queues = [q[:per_source] for q in sorted(by_src.values(), key=lambda q: q[0]["latest"], reverse=True)]
    out = []
    while len(out) < n and any(queues):
        for q in queues:
            if q and len(out) < n:
                out.append(q.pop(0))
    return out


# --- markets and weather -----------------------------------------------------

YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=1d&interval=1d"
MARKETS = [("SENSEX", "^BSESN"), ("NIFTY 50", "^NSEI"), ("USD/INR", "INR=X"),
           ("GOLD $/oz", "GC=F"), ("BRENT $", "BZ=F"), ("DOW", "^DJI"), ("NASDAQ", "^IXIC")]


def fetch_markets(cfg: dict) -> list:
    with ThreadPoolExecutor(max_workers=len(MARKETS)) as pool:
        return list(pool.map(lambda m: _market(m[0], m[1], cfg), MARKETS))


def _market(label: str, sym: str, cfg: dict) -> dict:
    try:
        r = requests.get(YAHOO.format(sym=sym), timeout=cfg["timeout"],
                         headers={"User-Agent": "Mozilla/5.0"})
        meta = r.json()["chart"]["result"][0]["meta"]
        price = float(meta["regularMarketPrice"])
        prev = float(meta.get("chartPreviousClose") or meta.get("previousClose") or price)
        return {"label": label, "price": price, "change": price - prev,
                "pct": (price - prev) / prev * 100 if prev else 0.0}
    except Exception:
        return {"label": label, "price": None, "change": None, "pct": None}


def get_json(url: str, cfg: dict, params: dict | None = None, tries: int = 2):
    """GET JSON with one retry; Open-Meteo occasionally stalls for a request."""
    for attempt in range(tries):
        try:
            r = requests.get(url, params=params, timeout=cfg["timeout"],
                             headers={"User-Agent": cfg["user_agent"]})
            r.raise_for_status()
            return r.json()
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(2)


WMO = {0: "CLEAR", 1: "MAINLY CLEAR", 2: "PARTLY CLOUDY", 3: "OVERCAST", 45: "FOG", 48: "FOG",
       51: "DRIZZLE", 53: "DRIZZLE", 55: "DRIZZLE", 61: "LIGHT RAIN", 63: "RAIN", 65: "HEAVY RAIN",
       71: "SNOW", 73: "SNOW", 75: "SNOW", 80: "SHOWERS", 81: "SHOWERS", 82: "HEAVY SHOWERS",
       95: "THUNDERSTORM", 96: "THUNDERSTORM", 99: "THUNDERSTORM"}


def fetch_weather(station: dict, cfg: dict) -> dict:
    lat, lon, tz = station["latitude"], station["longitude"], station["timezone"]
    w = {"city": station["city"]}
    try:
        d = get_json("https://api.open-meteo.com/v1/forecast", cfg, params={
            "latitude": lat, "longitude": lon, "timezone": tz, "forecast_days": 7,
            "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
            "daily": "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset",
            "hourly": "temperature_2m,precipitation_probability,weather_code"})
        c = d["current"]
        w.update(temp=c["temperature_2m"], humidity=c["relative_humidity_2m"],
                 wind=c["wind_speed_10m"], cond=WMO.get(c["weather_code"], "-"))
        days = d["daily"]
        w["days"] = [{"date": days["time"][i], "max": days["temperature_2m_max"][i],
                      "min": days["temperature_2m_min"][i],
                      "rain": days["precipitation_probability_max"][i],
                      "cond": WMO.get(days["weather_code"][i], "-")} for i in range(len(days["time"]))]
        w["sunrise"], w["sunset"] = days["sunrise"][0][11:16], days["sunset"][0][11:16]
        # Next 12 hours in 2-hour steps, starting from the current hour.
        h = d["hourly"]
        now_hour = c["time"][:13]
        start = next((i for i, t in enumerate(h["time"]) if t[:13] >= now_hour), 0)
        w["hours"] = [{"time": h["time"][i][11:16], "temp": h["temperature_2m"][i],
                       "rain": h["precipitation_probability"][i],
                       "cond": WMO.get(h["weather_code"][i], "-")}
                      for i in range(start + 2, min(start + 14, len(h["time"])), 2)]
    except Exception as e:
        print(f"weather fetch failed: {type(e).__name__}: {e}", flush=True)
    try:
        c = get_json("https://air-quality-api.open-meteo.com/v1/air-quality", cfg,
                     params={"latitude": lat, "longitude": lon, "timezone": tz,
                             "current": "us_aqi,pm2_5,pm10"})["current"]
        w.update(aqi=c["us_aqi"], pm25=c["pm2_5"], pm10=c["pm10"])
    except Exception as e:
        print(f"air quality fetch failed: {type(e).__name__}: {e}", flush=True)
    return w


# --- main --------------------------------------------------------------------

def run(check: bool = False) -> int:
    conf = load_config()
    fcfg = conf["fetch"]
    jobs = [(src, feed) for src in conf["source"] for feed in src["feeds"]]

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda j: (j[0], *fetch_feed(j[0], j[1], fcfg)), jobs))

    status = {}
    fresh = []
    for src, url, items, err in results:
        status[url] = {"source": src["short"], "ok": err is None, "items": len(items), "error": err}
        fresh.extend(items)

    if check:
        width = max(len(u) for u in status)
        for url, s in status.items():
            mark = "OK  " if s["ok"] else "FAIL"
            print(f"{mark} {s['source']:<10} {s['items']:>3}  {url:<{width}}  {s['error'] or ''}")
        bad = sum(not s["ok"] for s in status.values())
        print(f"\n{len(status) - bad}/{len(status)} feeds working, {len(fresh)} items")
        return 1 if bad == len(status) else 0

    # Keep stories from the previous run so a feed hiccup doesn't empty a page.
    old = read_json(NEWS_FILE, {}) or {}
    pool_by_id = {s["id"]: s for s in old.get("_pool", [])}
    for s in fresh:
        prev = pool_by_id.get(s["id"])
        if prev:
            s["published"] = min(s["published"], prev["published"])
        pool_by_id[s["id"]] = s
    cutoff = time.time() - fcfg["max_age_hours"] * 3600
    pool_items = [s for s in pool_by_id.values() if s["published"] >= cutoff]

    sim = Similarity([s["title"] for s in pool_items])
    clustered = {sec: cluster([s for s in pool_items if s["section"] == sec], sim) for sec in SECTIONS}
    top = pick_top(clustered["india"], clustered["world"], sim, n=12, per_source=3)
    sections = {sec: balanced(v, 28, 6) for sec, v in clustered.items()}

    # Ticker: newest headlines across everything, one per story, mixed sources.
    ticker, per = [], {}
    for s in sorted(cluster(pool_items, sim), key=lambda s: s["latest"], reverse=True):
        if per.get(s["source"], 0) < 7:
            ticker.append(s)
            per[s["source"]] = per.get(s["source"], 0) + 1
        if len(ticker) == 40:
            break

    # A failed weather or market request keeps the last good values rather than
    # blanking the panel until the next run.
    weather = fetch_weather(conf["station"], fcfg)
    old_w = old.get("weather", {})
    for k in ("temp", "humidity", "wind", "cond", "days", "hours", "sunrise", "sunset"):
        if k not in weather and k in old_w:
            weather[k] = old_w[k]
    for k in ("aqi", "pm25", "pm10"):
        if k not in weather and k in old_w:
            weather[k] = old_w[k]
    markets = fetch_markets(fcfg)
    old_m = {m["label"]: m for m in old.get("markets", [])}
    markets = [old_m.get(m["label"], m) if m["price"] is None else m for m in markets]

    news = {
        "generated": time.time(),
        "top": top,
        "sections": sections,
        "ticker": [{"source": s["source"], "title": s["title"], "published": s["latest"],
                    "link": s.get("link", "")} for s in ticker],
        "markets": markets,
        "weather": weather,
        "feeds": status,
        "_pool": pool_items,
    }
    write_json(NEWS_FILE, news)
    ok = sum(s["ok"] for s in status.values())
    print(f"wrote {NEWS_FILE}: {len(top)} top, "
          + ", ".join(f"{k} {len(v)}" for k, v in sections.items())
          + f"; feeds {ok}/{len(status)} ok")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="test feeds and print a report")
    sys.exit(run(check=ap.parse_args().check))


if __name__ == "__main__":
    main()
