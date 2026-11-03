# bbArch NewsTicker Live (website)

Teletext-style news pages at **news.bbarch.org**. Headlines from The Hindu, The Indian Express, Hindustan Times, BBC News, The Guardian and Al Jazeera, plus markets and Delhi weather and air quality.

Nothing runs on a home server. A GitHub Actions job fetches the feeds every 10 minutes and publishes `news.json` with the static site on GitHub Pages; each visitor's browser draws the pages from that file (about 90 KB).

## Layout

| Path | What it is |
|---|---|
| `site/` | The website: `index.html`, `app.js` (canvas renderer), VT323 font, logo, `CNAME` |
| `fetcher/` | `teletext/fetch.py` and `config.toml` (sources and feed URLs), shared with the Pi version |
| `.github/workflows/update.yml` | Every 10 min: fetch, then deploy to Pages |
| `.github/workflows/keepalive.yml` | Monthly empty commit if needed, so GitHub doesn't disable the schedule after 60 quiet days |

## On the page

- Pages rotate automatically: 101 index, 102+ top stories, 110 India, 120 World, 140 Business, 160 Tech, 300 Sport, 400 Weather.
- Click a headline (or a ticker item) to open the article. Click a coloured link at the bottom to jump to that section.
- Keyboard: ← → change page, type three digits to go to a page, space holds the current page, `f` or double-click for full screen.

## Changing sources

Edit `fetcher/config.toml` and push; the next run uses it. To test a feed list locally:

```bash
cd fetcher && pip install -r requirements.txt
TELETEXT_DATA=/tmp/tt TELETEXT_CONFIG=config.toml python -m teletext.fetch --check
```

## Local preview

```bash
cd fetcher && TELETEXT_DATA=../data TELETEXT_CONFIG=config.toml python -m teletext.fetch && cd ..
python3 -c "import json;d=json.load(open('data/news.json'));d.pop('_pool',None);json.dump(d,open('site/news.json','w'))"
cd site && python3 -m http.server 8000     # then open http://localhost:8000
```

Headlines and short summaries come from each publisher's RSS feed, are credited to the source and link to the original article.

Font: VT323, SIL Open Font License (`site/fonts/OFL.txt`).
