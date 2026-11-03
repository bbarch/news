// bbArch NewsTicker Live: teletext pages drawn in the browser from news.json.
// Layout mirrors the Pi renderer (render.py) on a fixed 1920x1080 grid, scaled to the window.
'use strict';

// ---- layout grid (1920x1080 units) -----------------------------------------
const BW = 1920, BH = 1080, M = 60;
const HEADER_Y = 16, HEADER_H = 38, MAST_Y = 60, MAST_H = 72, BODY_Y = 146, FAST_H = 36;
const FAST_Y = BH - 18 - FAST_H, TICK_H = 60, TICK_Y = FAST_Y - 12 - TICK_H, BODY_H = TICK_Y - 14 - BODY_Y;
const TICK_FONT = 45, TICK_LABEL_W = 285;
const SIDE_W = 384, SIDE_X = BW - M - SIDE_W, SIDE_Y = MAST_Y, SIDE_H = TICK_Y - 14 - SIDE_Y;
const CR = SIDE_X - 26, CONTENT_W = CR - M;
const REVEAL_S = 0.45, SEARCH_S = 0.6;
const STORY_S = 20, INDEX_S = 16, TICK_SPEED = 175;   // px per second
const DATA_URL = 'news.json', DATA_EVERY_MS = 120000;

const NAME = 'bbArch NewsTicker Live';
const TZ = 'Asia/Kolkata';
const CLOCKS = [['Delhi', TZ], ['London', 'Europe/London'], ['New York', 'America/New_York'],
                ['Dubai', 'Asia/Dubai'], ['Singapore', 'Asia/Singapore']];

// ---- palette ------------------------------------------------------------------
const rgb = (r, g, b) => `rgb(${r},${g},${b})`;
const BG = rgb(7, 9, 13), WHITE = rgb(237, 233, 223), BRIGHT = rgb(255, 255, 255),
      YELLOW = rgb(255, 210, 63), CYAN = rgb(79, 209, 232), GREEN = rgb(107, 227, 138),
      RED = rgb(255, 90, 78), MAGENTA = rgb(224, 95, 208), BLUE = rgb(23, 71, 201),
      DIM = rgb(58, 63, 74), GREY = rgb(150, 150, 150), SOFT = rgb(185, 182, 172),
      AMBER = rgb(255, 150, 40);

const SECTIONS = {
  top:      [101, null, BLUE, CYAN],
  india:    [110, 'INDIA', rgb(150, 42, 36), YELLOW],
  world:    [120, 'WORLD', rgb(14, 100, 62), CYAN],
  business: [140, 'BUSINESS', rgb(112, 34, 122), YELLOW],
  tech:     [160, 'TECH', rgb(8, 98, 118), YELLOW],
  sport:    [300, 'SPORT', rgb(176, 104, 0), BRIGHT],
  weather:  [400, 'WEATHER', BLUE, YELLOW],
};
const FASTEXT = [['India 110', RED, 110], ['World 120', GREEN, 120], ['Business 140', YELLOW, 140],
                 ['Tech 160', MAGENTA, 160], ['Sport 300', AMBER, 300], ['Weather 400', CYAN, 400]];
const AQI_BANDS = [[50, 'GOOD', GREEN], [100, 'MODERATE', YELLOW], [150, 'POOR', AMBER],
                   [200, 'UNHEALTHY', RED], [300, 'VERY UNHEALTHY', MAGENTA], [1e9, 'HAZARDOUS', rgb(190, 40, 70)]];

// ---- text helpers ---------------------------------------------------------------
const scratch = document.createElement('canvas').getContext('2d');
const metricCache = {};
function metrics(size) {
  if (!metricCache[size]) {
    scratch.font = `${size}px VT323`;
    const m = scratch.measureText('Hg');
    metricCache[size] = {
      asc: m.fontBoundingBoxAscent ?? size * 0.8,
      desc: m.fontBoundingBoxDescent ?? size * 0.2,
    };
  }
  return metricCache[size];
}
function width(s, size) { scratch.font = `${size}px VT323`; return scratch.measureText(s).width; }

// anchor: [l|m|r][a|m] like Pillow: left/middle/right, ascender-top/middle.
function text(ctx, x, y, s, size, color, anchor = 'la') {
  if (!s) return;
  const { asc, desc } = metrics(size);
  ctx.font = `${size}px VT323`;
  ctx.fillStyle = color;
  ctx.textAlign = anchor[0] === 'r' ? 'right' : anchor[0] === 'm' ? 'center' : 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, anchor[1] === 'm' ? y + (asc - desc) / 2 : y + asc);
}
function fit(s, size, maxW) {
  if (width(s, size) <= maxW) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (width(s.slice(0, mid) + '...', size) <= maxW) lo = mid; else hi = mid - 1;
  }
  return s.slice(0, lo).replace(/[ ,;:-]+$/, '') + '...';
}
function wrap(s, size, maxW, maxLines) {
  const words = (s || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const trial = cur ? cur + ' ' + words[i] : words[i];
    if (width(trial, size) <= maxW) { cur = trial; continue; }
    if (cur) lines.push(cur);
    cur = words[i];
    if (lines.length === maxLines) {
      const last = lines[maxLines - 1];
      lines[maxLines - 1] = fit(last + ' ' + words.slice(i).join(' '), size, maxW);
      return lines;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}
function rect(ctx, x0, y0, x1, y1, color) { ctx.fillStyle = color; ctx.fillRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1); }
function dashed(ctx, x, y, w, color) { for (let dx = 0; dx < w; dx += 22) rect(ctx, x + dx, y, x + Math.min(dx + 13, w), y + 2, color); }
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// ---- time ----------------------------------------------------------------------
const fmtCache = {};
function fmt(tz, opts) {
  const key = tz + JSON.stringify(opts);
  return fmtCache[key] || (fmtCache[key] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }));
}
const hhmm = (d, tz = TZ) => fmt(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
const hhmmss = (d) => fmt(TZ, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  .format(d).replace(/:(\d\d)$/, '/$1');
const dayLabel = (d, tz = TZ) => fmt(tz, { weekday: 'short', day: '2-digit', month: 'short' }).format(d).replace(',', '');
const dayKey = (d, tz = TZ) => fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
function ago(ts) {
  const d = new Date(ts * 1000);
  if (dayKey(d) === dayKey(new Date())) return hhmm(d);
  return fmt(TZ, { day: '2-digit', month: 'short' }).format(d) + ' ' + hhmm(d);
}
const latest = (s) => s.latest || s.published;

function fmtPrice(m) {
  if (m.price == null) return ['--', GREY];
  const p = m.price;
  const val = p < 1000 ? p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                       : Math.round(p).toLocaleString('en-US');
  const up = m.change >= 0;
  return [`${val} ${up ? '+' : '-'}${Math.abs(m.pct).toFixed(1)}%`, m.label === 'USD/INR' ? WHITE : up ? GREEN : RED];
}
const aqiBand = (aqi) => AQI_BANDS.find(([lim]) => aqi <= lim);

// ---- page planning ---------------------------------------------------------------
const STORY_TAG = 36, STORY_LINE = 42, STORY_SUM = 28, STORY_SEP = 38;
const SEC_COL_W = Math.floor((CONTENT_W - 70) / 2), SEC_HEAD = 26, SEC_LINE = 30, SEC_SUM = 25, SEC_GAP = 22;

function storyH(s) {
  return STORY_TAG + wrap(s.title, 42, CONTENT_W, 2).length * STORY_LINE + 6
       + wrap(s.summary, 26, CONTENT_W, 4).length * STORY_SUM + STORY_SEP;
}
function secItemH(it) {
  return SEC_HEAD + wrap(it.title, 28, SEC_COL_W, 2).length * SEC_LINE + (it.summary ? SEC_SUM : 0) + SEC_GAP;
}
function paginate(items, maxPages = 2) {
  const pages = []; let cols = [], col = [], used = 0;
  for (const it of items) {
    const h = secItemH(it);
    if (used + h > BODY_H - 6 && col.length) {
      cols.push(col); col = []; used = 0;
      if (cols.length === 2) { pages.push(cols); cols = []; if (pages.length === maxPages) return pages; }
    }
    col.push(it); used += h;
  }
  if (col.length) cols.push(col);
  if (cols.length && pages.length < maxPages) pages.push(cols);
  return pages.length ? pages : [[[]]];
}
function plan(news) {
  const top = news.top || [];
  const pages = [{ kind: 'index', num: 101, sec: 'top', dur: INDEX_S }];
  const groups = []; let cur = [], used = 0;
  for (const st of top) {
    const h = storyH(st);
    if (cur.length && used + h > BODY_H) { groups.push(cur); cur = []; used = 0; }
    cur.push(st); used += h;
  }
  if (cur.length) groups.push(cur);
  const storyPage = {}; let first = 0;
  groups.forEach((stories, g) => {
    stories.forEach((_, i) => { storyPage[first + i] = 102 + g; });
    pages.push({ kind: 'story', num: 102 + g, sec: 'top', stories, first, dur: STORY_S, sub: [g + 1, groups.length] });
    first += stories.length;
  });
  for (const sec of ['india', 'world', 'business', 'tech', 'sport']) {
    const chunks = paginate((news.sections || {})[sec] || []);
    chunks.forEach((cols, j) => pages.push({ kind: 'section', num: SECTIONS[sec][0], sec, cols, dur: INDEX_S, sub: [j + 1, chunks.length] }));
  }
  pages.push({ kind: 'weather', num: 400, sec: 'weather', dur: INDEX_S });
  return { pages, storyPage };
}

// ---- page layers -------------------------------------------------------------------
const logo = new Image();
let logoReady = false;
logo.onload = () => { logoReady = true; layerCache.clear(); };
logo.src = 'bbarch-logo.png';

function masthead(sec, subtitle) {
  const c = canvas(CR + 1, MAST_H), d = c.getContext('2d');
  const [, label, band, mosaic] = SECTIONS[sec];
  const x0 = M, x1 = CR, bandEnd = x1 - (MAST_H + 14);
  rect(d, x0, 0, bandEnd, MAST_H - 1, band);
  rect(d, x0, 0, x0 + 112, MAST_H - 1, BG);
  [56, 42, 28, 14].forEach((h, i) => rect(d, x0 + 18 + i * 22, MAST_H - 8 - h, x0 + 32 + i * 22, MAST_H - 9, mosaic));
  text(d, x0 + 140, MAST_H / 2 + 2, label || NAME, 62, BRIGHT, 'lm');
  text(d, bandEnd - 24, MAST_H / 2 + 2, subtitle, 28, YELLOW, 'rm');
  if (logoReady) d.drawImage(logo, x1 - MAST_H + 1, 0, MAST_H, MAST_H);
  return c;
}

function tagRow(d, x, y, s, rightX, links, size = 22) {
  const ts = latest(s), h = size + 6;
  let cx = x;
  if (Date.now() / 1000 - ts < 90 * 60) {
    const w = width('LIVE', size) + 16;
    rect(d, cx, y, cx + w, y + h, RED);
    text(d, cx + 8, y + h / 2, 'LIVE', size, BG, 'lm');
    cx += w + 12;
  }
  text(d, cx, y + h / 2, `${s.source_name.toUpperCase()}  ${ago(ts)}`, size, CYAN, 'lm');
  const others = (s.sources || []).filter((o) => o !== s.source);
  if (others.length && rightX) text(d, rightX, y + h / 2, 'also: ' + others.join(', '), size - 2, GREEN, 'rm');
  return y + h + 8;
}

// Each headline drawn with a link records its box so clicks can open the article.
function addLink(links, url, x, y, w, h) { if (url) links.push({ url, x, y: y + BODY_Y, w, h }); }

function bodyIndex(d, page, news, links, storyPage) {
  const top = news.top || [], colw = CONTENT_W, x = M;
  let y = 4;
  if (!top.length) { text(d, x, y, 'Waiting for the first news fetch...', 40, YELLOW); return; }
  const lead = top[0];
  y = tagRow(d, x, y, lead, x + colw);
  const y0 = y;
  for (const line of wrap(lead.title, 44, colw, 2)) { text(d, x, y, line, 44, YELLOW); y += 44; }
  addLink(links, lead.link, x, y0, colw, y - y0);
  y += 8;
  for (const line of wrap(lead.summary, 25, colw, 3)) { text(d, x, y, line, 25, WHITE); y += 27; }
  y += 12; dashed(d, x, y, colw, CYAN); y += 18;
  top.slice(1).forEach((s, k) => {
    const i = k + 1;
    text(d, x, y, String(storyPage[i] || 102), 26, GREEN);
    const t = fit(s.title, 26, colw - 68 - 150);
    text(d, x + 68, y, t, 26, WHITE);
    addLink(links, s.link, x + 68, y, width(t, 26), 30);
    text(d, x + colw, y + 3, s.source, 20, CYAN, 'ra');
    y += 34;
  });
  const shown = new Set(top.map((s) => s.title));
  const bySrc = new Map();
  for (const t of news.ticker || []) if (!shown.has(t.title)) {
    if (!bySrc.has(t.source)) bySrc.set(t.source, []);
    bySrc.get(t.source).push(t);
  }
  const more = [];
  while ([...bySrc.values()].some((q) => q.length)) for (const q of bySrc.values()) if (q.length) more.push(q.shift());
  if (more.length && y + 80 < BODY_H) {
    y += 10;
    rect(d, x, y, x + colw, y + 30, rgb(60, 24, 64));
    text(d, x + 10, y + 15, 'LATEST HEADLINES', 22, MAGENTA, 'lm');
    text(d, x + colw - 10, y + 15, 'all sections', 20, GREY, 'rm');
    y += 40;
    for (const t of more) {
      if (y + 28 > BODY_H) break;
      text(d, x, y + 2, t.source, 20, CYAN);
      const tt = fit(t.title, 24, colw - 132 - 90);
      text(d, x + 132, y, tt, 24, SOFT);
      addLink(links, t.link, x + 132, y, width(tt, 24), 28);
      if (t.published) text(d, x + colw, y + 2, ago(t.published), 20, GREY, 'ra');
      y += 30;
    }
  }
}

function bodyStory(d, page, news, links) {
  const x = M, maxw = CONTENT_W;
  let y = 4;
  page.stories.forEach((s, n) => {
    text(d, x, y + 2, String(page.first + n + 1).padStart(2), 22, GREEN);
    y = tagRow(d, x + 44, y, s, x + maxw);
    const y0 = y;
    for (const line of wrap(s.title, 42, maxw, 2)) { text(d, x, y, line, 42, YELLOW); y += 42; }
    addLink(links, s.link, x, y0, maxw, y - y0);
    y += 6;
    for (const line of wrap(s.summary, 26, maxw, 4)) { text(d, x, y, line, 26, WHITE); y += 28; }
    y += 14;
    if (n < page.stories.length - 1) { dashed(d, x, y, maxw, DIM); y += 18; }
  });
}

function bodySection(d, page, news, links) {
  const colw = SEC_COL_W;
  page.cols.forEach((items, c) => {
    const x = M + c * (colw + 70);
    let y = 4;
    if (!items.length) text(d, x, y, 'No stories in this section yet.', 30, GREY);
    for (const it of items) {
      text(d, x, y, it.source, 22, CYAN);
      text(d, x + width(it.source, 22) + 16, y, ago(latest(it)), 22, GREY);
      const others = (it.sources || []).filter((o) => o !== it.source);
      if (others.length) text(d, x + colw, y, '+' + others.join(', '), 20, GREEN, 'ra');
      y += SEC_HEAD;
      const y0 = y;
      for (const line of wrap(it.title, 28, colw, 2)) { text(d, x, y, line, 28, WHITE); y += SEC_LINE; }
      addLink(links, it.link, x, y0, colw, y - y0);
      if (it.summary) { text(d, x, y, fit(it.summary, 22, colw), 22, SOFT); y += SEC_SUM; }
      y += SEC_GAP;
      d.fillStyle = DIM; d.fillRect(x, y - 12, colw, 1);
    }
    if (c === 0 && page.cols.length > 1) { d.fillStyle = DIM; d.fillRect(x + colw + 35, 4, 1, BODY_H - 12); }
  });
}

function bodyWeather(d, page, news) {
  const w = news.weather || {}, x = M, maxw = CONTENT_W;
  let y = 4;
  if (w.temp == null) { text(d, x, y, 'Weather data unavailable.', 36, GREY); return; }
  text(d, x, y - 6, `${Math.round(w.temp)}°C`, 100, YELLOW);
  text(d, x + 260, y + 6, w.cond, 44, WHITE);
  text(d, x + 260, y + 58, `Humidity ${Math.round(w.humidity)}%    Wind ${Math.round(w.wind)} km/h`, 28, CYAN);
  if (w.aqi != null) {
    const [, lbl, col] = aqiBand(w.aqi), ax = CR - 520;
    rect(d, ax, y, CR, y + 112, rgb(30, 18, 20));
    text(d, ax + 18, y + 10, 'AIR QUALITY  (US AQI)', 24, GREY);
    text(d, ax + 18, y + 38, String(Math.round(w.aqi)), 64, col);
    text(d, ax + 150, y + 44, lbl, 32, col);
    text(d, ax + 150, y + 80, `PM2.5 ${Math.round(w.pm25)}   PM10 ${Math.round(w.pm10)}`, 24, WHITE);
  }
  y += 140;
  const hours = w.hours || [];
  if (hours.length) {
    rect(d, x, y, x + maxw, y + 36, BLUE);
    text(d, x + 12, y + 18, 'NEXT 12 HOURS', 26, BRIGHT, 'lm');
    y += 48;
    const cw = Math.floor(maxw / hours.length);
    hours.forEach((h, i) => {
      const cx = x + i * cw;
      text(d, cx, y, h.time, 26, CYAN);
      text(d, cx, y + 32, `${Math.round(h.temp)}°C`, 40, YELLOW);
      text(d, cx, y + 78, fit(h.cond, 22, cw - 20), 22, WHITE);
      text(d, cx, y + 104, `rain ${Math.round(h.rain)}%`, 22, GREY);
    });
    y += 146;
  }
  rect(d, x, y, x + maxw, y + 36, BLUE);
  text(d, x + 12, y + 18, '7-DAY OUTLOOK', 26, BRIGHT, 'lm');
  text(d, x + maxw - 12, y + 18, 'RAIN     MAX     MIN', 26, BRIGHT, 'rm');
  y += 48;
  for (const day of (w.days || []).slice(0, 7)) {
    if (y + 32 > BODY_H - 30) break;
    const label = dayLabel(new Date(day.date + 'T12:00:00Z'), 'UTC');
    text(d, x, y, label, 30, CYAN);
    text(d, x + 260, y, day.cond, 30, WHITE);
    const pad = (v, n) => String(Math.round(v ?? 0)).padStart(n);
    text(d, x + maxw - 12, y, `${pad(day.rain, 3)}%    ${pad(day.max, 3)}°    ${pad(day.min, 3)}°`, 30, YELLOW, 'ra');
    y += 36;
  }
  text(d, x, BODY_H - 26, 'Source: Open-Meteo', 22, GREY);
}

function fastext(page, news) {
  const c = canvas(BW, FAST_H), d = c.getContext('2d');
  const hits = [];
  let x = M;
  for (const [label, col, num] of FASTEXT) {
    text(d, x, FAST_H / 2, label, 24, col, 'lm');
    const w = width(label, 24);
    hits.push({ page: num, x, y: FAST_Y, w, h: FAST_H });
    x += w + 34;
  }
  if (news.generated) {
    const feeds = Object.values(news.feeds || {});
    const ok = feeds.filter((f) => f.ok).length;
    text(d, BW / 2 + 260, FAST_H / 2, `Updated ${ago(news.generated)}  ·  ${ok}/${feeds.length} feeds`, 22, GREY, 'lm');
  }
  const [cur, total] = page.sub || [1, 1];
  if (total > 1) {
    const bx = BW - M - total * 30;
    for (let i = 0; i < total; i++) rect(d, bx + i * 30, 11, bx + i * 30 + 24, 25, i + 1 === cur ? WHITE : DIM);
    text(d, bx - 12, FAST_H / 2, `${cur}/${total}`, 24, WHITE, 'rm');
  }
  return { canvas: c, hits };
}

const layerCache = new Map();
function pageLayers(page) {
  if (layerCache.has(page)) return layerCache.get(page);
  const sub = page.kind === 'index' ? 'TOP STORIES'
    : page.kind === 'story' ? `TOP STORIES  ${page.sub[0]}/${page.sub[1]}` : `P${page.num}`;
  const body = canvas(CR + 1, BODY_H), d = body.getContext('2d');
  const links = [];
  ({ index: bodyIndex, story: bodyStory, section: bodySection, weather: bodyWeather })[page.kind](d, page, state.news, links, state.storyPage);
  const fast = fastext(page, state.news);
  const layers = { mast: masthead(page.sec, sub), body, fast: fast.canvas, links, fastHits: fast.hits };
  layerCache.clear();                      // keep only the current page
  layerCache.set(page, layers);
  return layers;
}

// ---- right-hand panel ----------------------------------------------------------------
function sidebar(now) {
  const c = canvas(SIDE_W, SIDE_H), d = c.getContext('2d');
  const x0 = 0, x1 = SIDE_W, news = state.news;
  let y = 0;
  const wx = news.weather || {};
  const top = y;
  rect(d, x0, y, x1, y + 34, BLUE);
  text(d, x0 + 12, y + 17, `${wx.city || 'WEATHER'} NOW`, 24, BRIGHT, 'lm');
  text(d, x1 - 12, y + 17, '400', 24, YELLOW, 'rm');
  y += 44;
  if (wx.temp != null) {
    text(d, x0 + 12, y - 4, `${Math.round(wx.temp)}°C`, 64, YELLOW);
    text(d, x1 - 12, y + 2, fit(wx.cond, 24, 190), 24, WHITE, 'ra');
    text(d, x1 - 12, y + 30, `Hum ${Math.round(wx.humidity)}%  Wind ${Math.round(wx.wind)}`, 20, CYAN, 'ra');
    y += 70;
    if (wx.aqi != null) {
      const [, lbl, col] = aqiBand(wx.aqi);
      rect(d, x0 + 12, y, x1 - 12, y + 34, rgb(30, 18, 20));
      text(d, x0 + 22, y + 17, `AQI ${Math.round(wx.aqi)}`, 26, col, 'lm');
      text(d, x1 - 22, y + 17, fit(lbl, 24, 200), 24, col, 'rm');
      y += 40;
      text(d, x0 + 12, y, `PM2.5 ${Math.round(wx.pm25)}   PM10 ${Math.round(wx.pm10)}`, 20, SOFT);
      y += 28;
    }
    if (wx.sunrise) { text(d, x0 + 12, y, `Sunrise ${wx.sunrise}   Sunset ${wx.sunset}`, 20, SOFT); y += 28; }
    y += 4;
    for (const h of (wx.hours || []).slice(0, 4)) {
      text(d, x0 + 12, y, h.time, 22, GREY);
      text(d, x0 + 90, y, fit(h.cond, 22, 190), 22, SOFT);
      text(d, x1 - 12, y, `${Math.round(h.temp)}°`, 22, YELLOW, 'ra');
      y += 27;
    }
  } else { text(d, x0 + 12, y, 'No weather data yet', 22, GREY); y += 30; }
  y += 6;
  d.strokeStyle = rgb(28, 48, 110); d.strokeRect(x0 + 0.5, top + 34.5, x1 - 1, y - top - 34);
  y += 14;

  rect(d, x0, y, x1, y + 34, rgb(20, 90, 44));
  text(d, x0 + 12, y + 17, 'MARKETS', 24, BRIGHT, 'lm');
  y += 42;
  const mtop = y - 8;
  for (const m of news.markets || []) {
    const [val, col] = fmtPrice(m);
    text(d, x0 + 12, y, m.label, 22, WHITE);
    text(d, x1 - 12, y, val, 22, col, 'ra');
    y += 28;
  }
  d.strokeStyle = rgb(20, 70, 36); d.strokeRect(x0 + 0.5, mtop + 0.5, x1 - 1, y + 2 - mtop);
  y += 16;

  let cy = Math.max(y, SIDE_H - 34 - 8 - CLOCKS.length * 28 - 6);
  rect(d, x0, cy, x1, cy + 34, rgb(70, 70, 84));
  text(d, x0 + 12, cy + 17, 'WORLD TIME', 24, BRIGHT, 'lm');
  cy += 42;
  const today = dayKey(now);
  for (const [name, tz] of CLOCKS) {
    const k = dayKey(now, tz);
    const day = k === today ? '' : k > today ? ' +1' : ' -1';
    const home = tz === TZ;
    text(d, x0 + 12, cy, name, 22, home ? YELLOW : WHITE);
    text(d, x1 - 12, cy, hhmm(now, tz) + day, 22, home ? YELLOW : CYAN, 'ra');
    cy += 28;
  }
  return c;
}

// ---- ticker -------------------------------------------------------------------------
function buildTicker(news) {
  const items = (news.ticker && news.ticker.length) ? news.ticker : [{ source: NAME, title: 'Waiting for the first news fetch' }];
  const parts = [];
  for (const it of items) {
    parts.push({ s: it.source + ': ', color: rgb(16, 46, 150) });
    parts.push({ s: it.title, color: BG, link: it.link });
    parts.push({ s: '   +++   ', color: rgb(150, 30, 20) });
  }
  let x = 0;
  for (const p of parts) { p.x = x; p.w = width(p.s, TICK_FONT); x += p.w; }
  return { parts, total: x };
}
function drawTicker(ctx, t) {
  const x0 = M + TICK_LABEL_W, x1 = BW - M;
  rect(ctx, x0, TICK_Y, x1, TICK_Y + TICK_H - 1, YELLOW);
  text(ctx, M + 20, TICK_Y + TICK_H / 2 + 1, 'NEWSFLASH', TICK_FONT, YELLOW, 'lm');
  const { parts, total } = state.ticker;
  const off = (t * TICK_SPEED) % total;
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, TICK_Y, x1 - x0, TICK_H); ctx.clip();
  state.tickerHits = [];
  for (let rep = 0; rep < 2; rep++) {
    for (const p of parts) {
      const px = x0 - off + p.x + rep * total;
      if (px > x1) break;
      if (px + p.w < x0) continue;
      text(ctx, px, TICK_Y + TICK_H / 2 + 1, p.s, TICK_FONT, p.color, 'lm');
      if (p.link) state.tickerHits.push({ url: p.link, x: px, y: TICK_Y, w: p.w, h: TICK_H });
    }
  }
  ctx.restore();
}

// ---- header -------------------------------------------------------------------------
function drawHeader(ctx, num, now) {
  const y = HEADER_Y + HEADER_H / 2;
  text(ctx, M, y, `P${num}`, 26, WHITE, 'lm');
  text(ctx, M + 80, y, NAME, 26, YELLOW, 'lm');
  if (state.hold) text(ctx, M + 80 + width(NAME, 26) + 30, y, 'HOLD', 26, RED, 'lm');
  if (state.typed) text(ctx, M + 80 + width(NAME, 26) + 30, y, `P${state.typed.padEnd(3, '-')}`, 26, CYAN, 'lm');
  const clock = hhmmss(now);
  text(ctx, BW - M, y, clock, 26, YELLOW, 'rm');
  text(ctx, BW - M - width(clock, 26) - 24, y, dayLabel(now), 26, CYAN, 'rm');
}

// ---- state, rotation, frame loop -----------------------------------------------------------
const state = {
  news: {}, pages: [], storyPage: {}, idx: 0, pageStart: 0, hold: false, typed: '',
  pending: null, ticker: { parts: [], total: 1 }, side: null, sideKey: '', tickerHits: [],
  t0: performance.now(),
};

function setNews(news) {
  state.news = news;
  const p = plan(news);
  state.pages = p.pages; state.storyPage = p.storyPage;
  state.ticker = buildTicker(news);
  layerCache.clear();
  state.sideKey = '';
  if (state.idx >= state.pages.length) state.idx = 0;
}

function go(idx, now) {
  state.idx = (idx + state.pages.length) % state.pages.length;
  if (state.idx === 0 && state.pending) { setNews(state.pending); state.pending = null; }
  state.pageStart = now;
}
function goPage(num, now) {
  const i = state.pages.findIndex((p) => p.num === num);
  if (i >= 0) go(i, now);
}

const view = document.getElementById('screen');
const ctx = view.getContext('2d');

function frame(ts) {
  const t = (ts - state.t0) / 1000;
  const now = new Date();
  if (!state.pages.length) { requestAnimationFrame(frame); return; }
  let page = state.pages[state.idx];
  if (!state.hold && t - state.pageStart >= page.dur) { go(state.idx + 1, t); page = state.pages[state.idx]; }
  const pt = t - state.pageStart;
  const layers = pageLayers(page);

  rect(ctx, 0, 0, BW - 1, BH - 1, BG);
  drawHeader(ctx, pt < SEARCH_S ? page.num - 9 + Math.floor(pt / SEARCH_S * 9) : page.num, now);
  ctx.drawImage(layers.mast, 0, MAST_Y);
  const rows = 16, n = pt >= REVEAL_S ? rows : Math.floor(pt / REVEAL_S * rows);
  const h = Math.floor(BODY_H * n / rows);
  if (h > 0) ctx.drawImage(layers.body, 0, 0, layers.body.width, h, 0, BODY_Y, layers.body.width, h);

  const key = hhmm(now) + '|' + (state.news.generated || 0);
  if (key !== state.sideKey) { state.side = sidebar(now); state.sideKey = key; }
  ctx.drawImage(state.side, SIDE_X, SIDE_Y);

  drawTicker(ctx, t);
  ctx.drawImage(layers.fast, 0, FAST_Y);
  requestAnimationFrame(frame);
}

// ---- input: clicks open articles, fastext jumps, keys page like a remote -------------------
function toGrid(ev) {
  const r = view.getBoundingClientRect();
  return { x: (ev.clientX - r.left) * BW / r.width, y: (ev.clientY - r.top) * BH / r.height };
}
function hitAt(p) {
  const page = state.pages[state.idx];
  if (!page) return null;
  const L = pageLayers(page);
  const inside = (b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  for (const b of L.links) if (inside(b)) return { url: b.url };
  for (const b of state.tickerHits) if (inside(b)) return { url: b.url };
  for (const b of L.fastHits) if (inside(b)) return { page: b.page };
  if (inside({ x: SIDE_X, y: SIDE_Y, w: SIDE_W, h: 400 })) return { page: 400 };
  return null;
}
const nowT = () => (performance.now() - state.t0) / 1000;
view.addEventListener('click', (ev) => {
  const hit = hitAt(toGrid(ev));
  if (hit && hit.url) window.open(hit.url, '_blank', 'noopener');
  else if (hit && hit.page) goPage(hit.page, nowT());
});
view.addEventListener('mousemove', (ev) => { view.style.cursor = hitAt(toGrid(ev)) ? 'pointer' : 'default'; });
view.addEventListener('dblclick', () => {
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
});
window.addEventListener('keydown', (ev) => {
  const t = nowT();
  if (ev.key === 'ArrowRight' || ev.key === 'PageDown') go(state.idx + 1, t);
  else if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') go(state.idx - 1, t);
  else if (ev.key === ' ') { state.hold = !state.hold; ev.preventDefault(); }
  else if (ev.key === 'f') view.dispatchEvent(new Event('dblclick'));
  else if (/^\d$/.test(ev.key)) {
    state.typed += ev.key;
    if (state.typed.length === 3) { goPage(Number(state.typed), t); state.typed = ''; }
  } else if (ev.key === 'Escape') state.typed = '';
});

// ---- data -------------------------------------------------------------------------------------
async function loadData(first) {
  try {
    const r = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const news = await r.json();
    if (first || !state.news.generated) setNews(news);
    else if (news.generated !== state.news.generated) state.pending = news;   // applied at the top of the rotation
  } catch (e) {
    if (first) setNews({});
    console.warn('news.json not loaded:', e);
  }
}

// ---- sizing: keep 16:9, letterbox to the window, sharp on high-DPI screens -----------------------
function fitScreen() {
  const s = Math.min(window.innerWidth / BW, window.innerHeight / BH);
  const frameEl = view.parentElement;
  frameEl.style.width = `${Math.floor(BW * s)}px`;
  frameEl.style.height = `${Math.floor(BH * s)}px`;
}
window.addEventListener('resize', fitScreen);

(async () => {
  fitScreen();
  try { await document.fonts.load('30px VT323'); } catch (e) { /* fall back to monospace */ }
  for (const k in metricCache) delete metricCache[k];
  await loadData(true);
  setInterval(() => loadData(false), DATA_EVERY_MS);
  requestAnimationFrame(frame);
})();
