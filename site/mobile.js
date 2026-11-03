// Phone layout: below 900 px wide the 16:9 TV screen would be unreadable, so the same
// news.json is shown as a scrolling teletext-styled page with section tabs.
// Uses the helpers and colours defined in app.js. All feed text goes in via
// textContent, never innerHTML.
'use strict';

const MobileView = (() => {
  const TABS = [
    ['top', 'Top', 101, CYAN], ['india', 'India', 110, RED], ['world', 'World', 120, GREEN],
    ['business', 'Business', 140, YELLOW], ['tech', 'Tech', 160, MAGENTA], ['sport', 'Sport', 300, AMBER],
    ['weather', 'Weather', 400, CYAN],
  ];
  let root, news = {}, tab = 'top', clockTimer = null;

  function el(tag, cls, txt, style) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    if (style) Object.assign(e.style, style);
    return e;
  }
  const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : null;
  function headline(s, cls) {
    const url = safeUrl(s.link);
    const a = el(url ? 'a' : 'span', cls, s.title);
    if (url) { a.href = url; a.target = '_blank'; a.rel = 'noopener'; }
    return a;
  }
  function meta(s) {
    const row = el('div', 'm-meta');
    const ts = latest(s);
    if (Date.now() / 1000 - ts < 90 * 60) row.append(el('span', 'm-live', 'LIVE'));
    row.append(el('span', 'm-src', s.source_name || s.source), el('span', 'm-time', ago(ts)));
    const others = (s.sources || []).filter((o) => o !== s.source);
    if (others.length) row.append(el('span', 'm-also', 'also ' + others.join(', ')));
    return row;
  }

  function build() {
    root = document.getElementById('mobile');
    root.replaceChildren();
    const top = el('header', 'm-top');
    top.append(el('span', 'm-pnum'), el('span', 'm-name', NAME), el('span', 'm-clock'));
    const mast = el('div', 'm-mast');
    mast.append(el('span', 'm-label'), Object.assign(el('img', 'm-logo'), { src: 'bbarch-logo.png', alt: 'bbArch' }));
    const tabs = el('nav', 'm-tabs');
    tabs.setAttribute('aria-label', 'Sections');
    for (const [key, label, num, color] of TABS) {
      const b = el('button', 'm-tab', `${label} ${num}`, { color });
      b.dataset.tab = key;
      b.addEventListener('click', () => show(key, true));
      tabs.append(b);
    }
    const info = el('section', 'm-info');
    const list = el('main', 'm-list');
    const ticker = el('div', 'm-ticker');
    ticker.append(el('span', 'm-flash', 'NEWSFLASH'), el('div', 'm-tickwrap'));
    root.append(top, mast, tabs, info, list, ticker);

    // Swipe left/right to change section.
    let x0 = null, y0 = null;
    list.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    list.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) {
        const i = TABS.findIndex((t) => t[0] === tab);
        show(TABS[(i + (dx < 0 ? 1 : TABS.length - 1)) % TABS.length][0], true);
      }
    });
  }

  function tickClock() {
    const c = root && root.querySelector('.m-clock');
    if (c) c.textContent = `${dayLabel(new Date())}  ${hhmm(new Date())}`;
  }

  function renderInfo() {
    const box = root.querySelector('.m-info');
    box.replaceChildren();
    const w = news.weather || {};
    const wx = el('div', 'm-wx');
    if (w.temp != null) {
      wx.append(el('span', 'm-temp', `${Math.round(w.temp)}°C`));
      const right = el('div', 'm-wxr');
      right.append(el('div', 'm-cond', `${w.city || 'Delhi'} · ${w.cond}`));
      if (w.aqi != null) {
        const [, lbl, col] = aqiBand(w.aqi);
        right.append(el('div', 'm-aqi', `AQI ${Math.round(w.aqi)} ${lbl}`, { color: col }));
      }
      wx.append(right);
    } else wx.append(el('span', 'm-dim', 'Weather loading...'));
    const mk = el('div', 'm-markets');
    for (const m of news.markets || []) {
      const [val, col] = fmtPrice(m);
      const cell = el('div', 'm-mk');
      cell.append(el('span', 'm-mkl', m.label), el('span', 'm-mkv', val, { color: col }));
      mk.append(cell);
    }
    box.append(wx, mk);
  }

  function storyCard(s, lead) {
    const card = el('article', lead ? 'm-lead' : 'm-item');
    card.append(meta(s), headline(s, lead ? 'm-h1' : 'm-h2'));
    if (s.summary) card.append(el('p', 'm-sum', s.summary));
    return card;
  }

  function renderList() {
    const list = root.querySelector('.m-list');
    list.replaceChildren();
    const [key, label, num, color] = TABS.find((t) => t[0] === tab);
    const meta0 = SECTIONS[key];
    root.querySelector('.m-pnum').textContent = `P${num}`;
    const mast = root.querySelector('.m-mast');
    mast.style.background = meta0[2];
    mast.querySelector('.m-label').textContent = key === 'top' ? 'TOP STORIES' : meta0[1];
    root.querySelectorAll('.m-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === key));

    if (key === 'top') {
      const top = news.top || [];
      if (!top.length) { list.append(el('p', 'm-dim', 'Waiting for the first news fetch...')); return; }
      list.append(storyCard(top[0], true));
      top.slice(1).forEach((s) => list.append(storyCard(s, false)));
      const shown = new Set(top.map((s) => s.title));
      const more = (news.ticker || []).filter((t) => !shown.has(t.title)).slice(0, 15);
      if (more.length) {
        list.append(el('h2', 'm-sub', 'LATEST HEADLINES'));
        for (const t of more) {
          const row = el('div', 'm-row');
          row.append(el('span', 'm-src', t.source), headline(t, 'm-h3'));
          if (t.published) row.append(el('span', 'm-time', ago(t.published)));
          list.append(row);
        }
      }
    } else if (key === 'weather') {
      renderWeather(list);
    } else {
      const items = (news.sections || {})[key] || [];
      if (!items.length) list.append(el('p', 'm-dim', 'No stories in this section yet.'));
      items.forEach((s) => list.append(storyCard(s, false)));
    }
    if (news.generated) list.append(el('p', 'm-foot', `Updated ${ago(news.generated)}`));
    list.append(el('p', 'm-disc', DISCLAIMER));
  }

  function renderWeather(list) {
    const w = news.weather || {};
    if (w.temp == null) { list.append(el('p', 'm-dim', 'Weather data unavailable.')); return; }
    const now = el('div', 'm-wnow');
    now.append(el('div', 'm-wbig', `${Math.round(w.temp)}°C`),
               el('div', 'm-cond', w.cond),
               el('div', 'm-dim', `Humidity ${Math.round(w.humidity)}% · Wind ${Math.round(w.wind)} km/h`));
    if (w.sunrise) now.append(el('div', 'm-dim', `Sunrise ${w.sunrise} · Sunset ${w.sunset}`));
    list.append(now);
    if (w.aqi != null) {
      const [, lbl, col] = aqiBand(w.aqi);
      const a = el('div', 'm-aqibox');
      a.append(el('div', 'm-dim', 'AIR QUALITY (US AQI)'),
               el('div', 'm-aqibig', `${Math.round(w.aqi)} ${lbl}`, { color: col }),
               el('div', 'm-dim', `PM2.5 ${Math.round(w.pm25)} · PM10 ${Math.round(w.pm10)}`));
      list.append(a);
    }
    if ((w.hours || []).length) {
      list.append(el('h2', 'm-sub', 'NEXT 12 HOURS'));
      const g = el('div', 'm-hours');
      for (const h of w.hours) {
        const c = el('div', 'm-hour');
        c.append(el('div', 'm-time', h.time), el('div', 'm-htemp', `${Math.round(h.temp)}°`),
                 el('div', 'm-dim', h.cond), el('div', 'm-dim', `rain ${Math.round(h.rain)}%`));
        g.append(c);
      }
      list.append(g);
    }
    list.append(el('h2', 'm-sub', '7-DAY OUTLOOK'));
    for (const d of (w.days || []).slice(0, 7)) {
      const r = el('div', 'm-day');
      r.append(el('span', 'm-src', dayLabel(new Date(d.date + 'T12:00:00Z'), 'UTC')),
               el('span', 'm-dcond', d.cond),
               el('span', 'm-dt', `${Math.round(d.max)}° / ${Math.round(d.min)}°`));
      list.append(r);
    }
  }

  function renderTicker() {
    const wrap = root.querySelector('.m-tickwrap');
    wrap.replaceChildren();
    const line = el('div', 'm-tickline');
    const items = (news.ticker || []).slice(0, 20);
    for (let rep = 0; rep < 2; rep++) {       // two copies so the loop is seamless
      for (const t of items) {
        line.append(el('b', null, t.source + ': '), document.createTextNode(t.title + '   +++   '));
      }
    }
    const chars = items.reduce((n, t) => n + t.source.length + t.title.length + 11, 0);
    line.style.animationDuration = `${Math.max(30, chars * 0.13)}s`;
    wrap.append(line);
  }

  function show(key, scroll) {
    tab = key;
    renderList();
    if (scroll) window.scrollTo({ top: 0 });
  }

  return {
    render(n) {
      news = n || {};
      if (!root) build();
      const y = window.scrollY;
      renderInfo(); renderList(); renderTicker(); tickClock();
      window.scrollTo({ top: y });
    },
    activate(on) {
      if (on && !root) build();
      document.body.classList.toggle('mobile', on);
      document.documentElement.classList.toggle('mobile', on);
      if (on && !clockTimer) clockTimer = setInterval(tickClock, 15000);
      if (!on && clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    },
  };
})();
