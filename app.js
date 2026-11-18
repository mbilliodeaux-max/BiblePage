/* NIV Study Bible reader — works from file:// (data files are loaded on demand as <script> tags). */
(function () {
  'use strict';

  // ------------------------------------------------------------------ data registry (data/*.js call these)
  const S = { m: null, books: {}, sections: {}, verses: {}, search: {}, conc: {}, view: null, bid: null, snum: null };
  window.NIV = {
    manifest(m) { S.m = m; },
    book(id, d) { S.books[id] = d; },
    section(n, d) { S.sections[n] = d; },
    verses(id, d) {
      const keys = Object.keys(d), idx = new Map(), chFirst = new Map(), chLast = new Map();
      keys.forEach((k, i) => { idx.set(k, i); const c = +k.split(':')[0]; if (!chFirst.has(c)) chFirst.set(c, i); chLast.set(c, i); });
      S.verses[id] = { d, keys, idx, chFirst, chLast };
    },
    search(id, d) { S.search[id] = d; },
    conc(letter, d) { S.conc[letter] = d; },
  };

  const loading = {};
  function load(path) {
    if (loading[path]) return loading[path];
    return (loading[path] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'data/' + path + '.js';
      s.onload = () => resolve();
      s.onerror = () => { delete loading[path]; reject(new Error('Could not load ' + path)); };
      document.head.appendChild(s);
    }));
  }
  const getBook = id => load('books/' + id).then(() => S.books[id]);
  const getVerses = id => load('verses/' + id).then(() => S.verses[id]);
  const getConc = l => load('conc/' + l).then(() => S.conc[l]);
  const pad3 = n => String(n).padStart(3, '0');
  const getSection = n => load('sections/' + pad3(n)).then(() => S.sections[n]);
  // section anchors: s-NNN-k (block), s-NNN-fK (figure)
  function parseSid(id) {
    const m = /^s-(\d{3})-(.+)$/.exec(id || '');
    return m ? { num: +m[1], rest: m[2] } : null;
  }

  // ------------------------------------------------------------------ helpers
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const strip = h => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const num = cv => cv[0] * 1000 + cv[1];
  let B = {}, ORDER = [];
  const main = () => $('#main');

  function parseId(id) {
    const m = /^([vchiafn])-([0-9a-z]{3})-(.+)$/.exec(id || '');
    if (!m || !B[m[2]]) return null;
    const o = { t: m[1], bid: m[2], rest: m[3] };
    if (o.t === 'v') { const [c, v] = m[3].split('-').map(Number); o.c = c; o.v = v; }
    if (o.t === 'c') o.c = +m[3];
    return o;
  }

  function refLabel(a, b) {
    const p = parseId(a); if (!p) return '';
    const bk = B[p.bid];
    const q = b ? parseId(b) : null;
    if (p.t === 'c') {
      let s = `${bk.name} ${p.c}`;
      if (q && q.t === 'c' && q.c !== p.c) s += `–${q.c}`;
      else if (q && q.t === 'v') s += `:1–${q.c}:${q.v}`;
      return s;
    }
    let s = `${bk.abbr} ${p.c}:${p.v}`;
    if (q && q.t === 'v') { if (q.c === p.c) { if (q.v !== p.v) s += `–${q.v}`; } else s += `—${q.c}:${q.v}`; }
    if (q && q.t === 'c') s += `—${q.c}`;
    return s;
  }

  async function passage(a, b, cap) {
    const p = parseId(a); if (!p) return { verses: [], more: 0 };
    const V = await getVerses(p.bid);
    let i0 = p.t === 'c' ? V.chFirst.get(p.c) : V.idx.get(`${p.c}:${p.v}`);
    if (i0 == null && p.t === 'v') i0 = V.chFirst.get(p.c);
    if (i0 == null) return { verses: [], more: 0, bid: p.bid };
    let i1 = null;
    const q = b ? parseId(b) : null;
    if (q && q.bid === p.bid) i1 = q.t === 'c' ? V.chLast.get(q.c) : V.idx.get(`${q.c}:${q.v}`);
    else if (p.t === 'c') i1 = V.chLast.get(p.c);
    if (i1 == null || i1 < i0) i1 = i0;
    const total = i1 - i0 + 1, n = Math.min(total, cap || 1e9);
    const out = [];
    for (let i = i0; i < i0 + n; i++) { const k = V.keys[i]; out.push([k, V.d[k]]); }
    return { verses: out, more: total - n, bid: p.bid };
  }

  function versesHtml(list, bid, opts = {}) {
    let html = '', lastC = null;
    for (const [k, t] of list) {
      const [c, v] = k.split(':');
      if (opts.chapters && c !== lastC && lastC !== null) html += `</p><p><b>${c}</b> `;
      lastC = c;
      if (v === '0') html += `<i>${esc(t)}</i> `;
      else html += `<span class="v" data-v="${c}:${v}"${opts.ids ? ` id="pv-${bid}-${c}-${v}"` : ''}><span class="vn">${v}</span>${esc(t)}</span> `;
    }
    return `<p>${html}</p>`;
  }

  function openPdf(pdf) {
    if (!pdf) return;
    const [f, frag] = pdf.split('#');
    window.open('../NIV%20books/' + encodeURIComponent(f) + (frag ? '#' + frag : ''), '_blank');
  }

  // ------------------------------------------------------------------ navigation / routing
  function saveScroll() {
    try { history.replaceState({ scroll: main().scrollTop, hash: location.hash }, ''); } catch (e) { /* ignore */ }
  }
  function go(hash) {
    saveScroll();
    if (decodeURIComponent(location.hash.slice(1)) === hash) route();
    else location.hash = hash;
  }

  function activate(id, a) {
    closePops();
    closeSearch();
    if (!id) return go('');
    if (id.startsWith('pdf:')) return openPdf(id.slice(4));
    if (id.startsWith('view:') || id.startsWith('k-') || id.startsWith('intro-') || parseSid(id)) { closeModal(); return go(id); }
    const p = parseId(id); if (!p) return;
    const bk = B[p.bid];
    if ('afn'.includes(p.t)) return bk.converted ? openModal(id) : openPdf(a && a.dataset.pdf);
    if (bk.converted) { closeModal(); return go(id); }
    if (p.t === 'v' || p.t === 'c') return openPassage(id, a && a.dataset.end, a && a.dataset.pdf);
    openPdf(a && a.dataset.pdf);
  }

  async function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    const st = history.state;
    const restore = st && st.scroll != null && st.hash === location.hash ? st.scroll : null;
    if (!h) return showHome(restore);
    if (h === 'view:figures') return showFigures(restore);
    if (h === 'view:conc') return showConc(null, restore);
    if (h.startsWith('k-')) return showConc(h, restore);
    const sp = parseSid(h);
    if (sp) {
      await showSection(sp.num);
      if (restore != null) { main().scrollTop = restore; return; }
      return scrollToId(h);
    }
    if (h.startsWith('intro-') && B[h.slice(6)]) {
      await showBook(h.slice(6));
      if (restore != null) { main().scrollTop = restore; onScroll(); return; }
      return scrollToId(h);
    }
    const p = parseId(h);
    if (!p || !B[p.bid].converted) return showHome(restore);
    await showBook(p.bid);
    if (restore != null) { main().scrollTop = restore; onScroll(); return; }
    if ('afn'.includes(p.t)) return openModal(h);
    scrollToId(h);
  }

  function scrollToId(id) {
    const el = document.getElementById(id);
    if (!el) return;
    main().scrollTop = Math.max(0, el.offsetTop - 18);
    const p = parseId(id);
    if (p && p.t === 'v') {
      $$(`.reader .v[data-v="${p.c}:${p.v}"]`).forEach(s => { s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); });
    }
    onScroll();
  }

  // ------------------------------------------------------------------ views
  function setView(name, html) {
    S.view = name;
    $('#view').innerHTML = html;
    main().scrollTop = 0;
  }

  function showHome(restore) {
    S.bid = null;
    const grid = list => list.map(b => `<a href="${b.converted ? '#intro-' + b.id : '#pdf:' + esc(sec(b.sec).file || '')}" class="${b.converted ? '' : 'off'}">${esc(b.name)}<span>${b.converted ? b.chapters + ' chapter' + (b.chapters > 1 ? 's' : '') : 'PDF for now'}</span></a>`).join('');
    const refSec = ['Articles', 'Zondervan’s Full-Color Maps', 'Index to Maps', 'Table of Weights and Measures', 'Introduction to the Old Testament', 'Introduction to the New Testament', 'The Time Between the Testaments', 'How to Use This eBible']
      .map(t => S.m.sections.find(s => s.title === t)).filter(s => s && s.converted);
    setView('home', `<div class="reader"><div class="welcome">
      <h1>NIV Zondervan Study Bible</h1>
      <p>Read the text in the middle; study notes for whatever is on screen appear on the right. Hover any reference to preview it, and use the search bar for scripture, study notes, charts and the concordance.</p>
      <h2 class="sec">Old Testament</h2><div class="book-grid">${grid(S.m.books.slice(0, 39))}</div>
      <h2 class="sec">New Testament</h2><div class="book-grid">${grid(S.m.books.slice(39))}</div>
      <h2 class="sec">Reference</h2><div class="book-grid">${refSec.map(s => `<a href="#s-${pad3(s.num)}-1">${esc(s.title)}<span>Section</span></a>`).join('')}<a href="#view:figures">Charts, maps &amp; pictures<span>${S.m.figures.length} items</span></a><a href="#view:conc">Concordance<span>${S.m.concordance.length.toLocaleString()} words</span></a></div>
      <p style="font-size:.8em">Built ${esc(S.m.built)}.</p>
    </div></div>`);
    if (restore != null) main().scrollTop = restore;
    renderRight();
  }

  const sec = n => S.m.sections.find(s => s.num === n) || {};

  async function showBook(bid) {
    if (S.view === 'book' && S.bid === bid) return;
    $('#view').innerHTML = '<div class="reader"><p class="loading">Loading…</p></div>';
    const bk = await getBook(bid);
    S.bid = bid;
    const info = B[bid];
    const chapters = bk.chapters.map(c => `<section class="chapter"><h2 id="c-${bid}-${c.c}">${esc(info.name)} ${c.c}</h2>${c.html}</section>`).join('');
    setView('book', `<div class="reader" id="reader">
      <h1 class="book-title">${esc(info.name)}</h1>
      <div class="book-sub">${info.chapters} chapters · ${bk.annotations.length} study notes · ${bk.figures.length} charts, maps &amp; illustrations</div>
      <section class="intro" id="intro-${bid}"><h2>Introduction</h2>${bk.intro}</section>
      ${chapters}</div>`);
    indexVerses();
    lastRangeKey = null;
    openNavBook(bid);
  }

  async function showSection(n) {
    if (S.view === 'section' && S.snum === n) return;
    $('#view').innerHTML = '<div class="reader"><p class="loading">Loading…</p></div>';
    const d = await getSection(n);
    S.bid = null; S.snum = n;
    setView('section', `<div class="reader section" id="reader"><h1 class="book-title">${esc(d.title)}</h1>${d.html}</div>`);
    vnEls = []; vnTops = []; vnKeys = []; vSpans = [];
    lastRangeKey = null;
    openNavSection(n);
    renderRight();
  }

  // verse index for the scroll-linked sidebar
  let vnEls = [], vnKeys = [], vnTops = [], vSpans = [], lastRangeKey = null;
  function indexVerses() {
    vnEls = $$('.reader .vn[id]');
    vnKeys = vnEls.map(e => { const p = parseId(e.id); return p.c * 1000 + p.v; });
    vSpans = $$('.reader .v').map(e => { const [c, v] = e.dataset.v.split(':').map(Number); return [e, c * 1000 + v]; });
    measure();
    const reader = $('#reader');
    if (reader && window.ResizeObserver) {
      let t = null;
      new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { measure(); onScroll(true); }, 120); }).observe(reader);
    }
  }
  function measure() { vnTops = vnEls.map(e => e.offsetTop); }
  function upper(arr, x) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo; }
  function visRange() {
    if (!vnTops.length) return null;
    const m = main(), top = m.scrollTop + 10, bot = m.scrollTop + m.clientHeight - 24;
    let i = upper(vnTops, top) - 1;
    if (i < 0) { if (vnTops[0] > bot) return null; i = 0; }
    // a previous chapter's last verse that ends above a chapter heading is not really on screen
    if (i + 1 < vnTops.length && vnTops[i + 1] <= bot && Math.floor(vnKeys[i] / 1000) !== Math.floor(vnKeys[i + 1] / 1000)) {
      const h = document.getElementById(`c-${S.bid}-${Math.floor(vnKeys[i + 1] / 1000)}`);
      if (h && h.offsetTop <= top + 30) i += 1;
    }
    let j = upper(vnTops, bot) - 1;
    if (j < i) j = i;
    return [vnKeys[i], vnKeys[j]];
  }

  let scrollQueued = false;
  function onScroll(force) {
    if (force === true) { lastRangeKey = null; }
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => { scrollQueued = false; renderRight(); syncNav(); });
  }

  // ------------------------------------------------------------------ right sidebar (study notes for what is on screen)
  function annText(a) { return a._txt || (a._txt = strip(a.html)); }
  function renderRight() {
    const body = $('#right-body'), head = $('#right-range');
    if (S.view === 'section') {
      const s = sec(S.snum);
      const items = (s.nav || []).filter(x => x[2] <= 3 || x[2] === 4);
      // current heading = last heading above the top of the view
      const top = main().scrollTop + 40;
      let cur = null;
      for (const x of items) { const el = document.getElementById(x[0]); if (el && el.offsetTop <= top) cur = x[0]; else if (el) break; }
      const key = 'sec-' + S.snum + '-' + cur;
      if (key === lastRangeKey) return;
      lastRangeKey = key;
      head.textContent = s.title || '';
      body.innerHTML = items.length
        ? `<div class="rs-group">On this page</div><nav class="outline">${items.map(x => `<a href="#${x[0]}" class="lvl${x[2]}${x[0] === cur ? ' on' : ''}">${x[3] ? `<span class="ico f">${ICON[x[3]] || '▦'}</span>` : ''}${esc(x[1])}</a>`).join('')}</nav>`
        : `<div class="rs-empty">Hover any scripture reference in this section to preview it.</div>`;
      return;
    }
    if (S.view !== 'book') {
      if (lastRangeKey === 'none') return;
      lastRangeKey = 'none';
      head.textContent = '';
      body.innerHTML = `<div class="rs-empty">Open a book and its study notes, overviews and charts for the verses on screen appear here.</div>`;
      return;
    }
    const bk = S.books[S.bid], info = B[S.bid];
    const r = visRange();
    const key = r ? r.join('-') : 'intro';
    if (key === lastRangeKey) return;
    lastRangeKey = key;
    if (!r) {
      head.textContent = `${info.name} — Introduction`;
      const figs = bk.figures.filter(f => f.where === 'intro');
      body.innerHTML = `<div class="rs-empty">Study notes appear here as the scripture text comes into view.</div>` +
        (figs.length ? `<div class="rs-group">In the introduction</div>` + figs.map(figCard).join('') : '');
      return;
    }
    const [a, b] = r;
    const fmt = n => `${Math.floor(n / 1000)}:${n % 1000}`;
    const ca = Math.floor(a / 1000), cb = Math.floor(b / 1000);
    head.textContent = `${info.name} ${fmt(a)}–${ca === cb ? b % 1000 : fmt(b)}`;
    const anns = bk.annotations.filter(x => num(x.s) <= b && num(x.e) >= a);
    const over = anns.filter(x => x.big || x.e[0] > x.s[0]);
    const spec = anns.filter(x => !over.includes(x));
    const ids = new Set(anns.map(x => x.id));
    const figs = bk.figures.filter(f => f.ann && ids.has(f.ann));
    let html = '';
    if (over.length) html += `<div class="rs-group">Section overviews</div>` + over.map(x => noteCard(x, true)).join('');
    if (spec.length) html += `<div class="rs-group">Verse notes</div>` + spec.map(x => noteCard(x, false)).join('');
    if (figs.length) html += `<div class="rs-group">Charts, maps &amp; pictures</div>` + figs.map(figCard).join('');
    body.innerHTML = html || `<div class="rs-empty">No study notes for these verses.</div>`;
  }
  function noteCard(x, big) {
    const label = x.t ? `<span class="t">${esc(x.t)}</span>` : '';
    return `<button class="note-card${big ? ' big' : ''}" data-open="${x.id}" data-s="${num(x.s)}" data-e="${num(x.e)}">
      <span class="r">${esc(x.ref)}</span>${label}${big ? '' : `<span class="s">${esc(snippet(x))}</span>`}</button>`;
  }
  function snippet(x) {
    let t = annText(x).replace(/^\S+\s*/, '');           // drop the verse reference
    if (x.t && t.toLowerCase().startsWith(x.t.toLowerCase())) t = t.slice(x.t.length).replace(/^[.\s]+/, '');
    return t.slice(0, 220);
  }
  function figCard(f) {
    return `<button class="note-card fig" data-open="${f.id}"><span class="r">${esc(f.kind)}</span><span class="t">${esc(f.title)}</span></button>`;
  }
  function highlightRange(s, e, on) {
    for (const [el, n] of vSpans) if (n >= s && n <= e) el.classList.toggle('hl', on);
  }

  // ------------------------------------------------------------------ modal (annotations, figures, notes, passages)
  const modal = () => $('#modal');
  function closeModal() { const m = modal(); if (m.open) m.close(); }
  function showModal(title, body, foot) {
    const m = modal();
    $('#modal-title').innerHTML = title;
    $('#modal-body').innerHTML = body;
    $('#modal-foot').innerHTML = foot || '';
    $('#modal-foot').hidden = !foot;
    if (!m.open) m.showModal();
    $('#modal-body').scrollTop = 0;
    closePops();
  }

  async function openModal(id) {
    const p = parseId(id); if (!p) return;
    const bk = await getBook(p.bid), info = B[p.bid];
    if (p.t === 'a') {
      const i = bk.annotations.findIndex(x => x.id === id);
      const x = bk.annotations[i]; if (!x) return;
      const s = `v-${p.bid}-${x.s[0]}-${x.s[1]}`, e = `v-${p.bid}-${x.e[0]}-${x.e[1]}`;
      let quote = '';
      if (num(x.e) - num(x.s) < 8) {
        const r = await passage(s, e, 8);
        quote = `<div class="verse-quote">${versesHtml(r.verses, p.bid)}</div>`;
      }
      const figs = (x.figs || []).map(fid => bk.figures.find(f => f.id === fid)).filter(Boolean);
      const prev = bk.annotations[i - 1], next = bk.annotations[i + 1];
      showModal(
        `<span class="k">Study note</span><span class="r">${esc(info.abbr)} ${esc(x.ref)}</span>${esc(x.t || '')}`,
        quote + x.html,
        `<button data-open="${prev ? prev.id : ''}" ${prev ? '' : 'disabled'}>‹ Previous</button>
         <button data-open="${next ? next.id : ''}" ${next ? '' : 'disabled'}>Next ›</button>
         <span class="chips-row">${figs.map(f => `<button data-open="${f.id}">${esc(f.kind)}: ${esc(f.title)}</button>`).join('')}</span>
         <span class="sp"></span><button data-go="${s}">Show in text</button>`);
    } else if (p.t === 'f') {
      const f = bk.figures.find(x => x.id === id); if (!f) return;
      const ann = f.ann ? bk.annotations.find(x => x.id === f.ann) : null;
      showModal(`<span class="k">${esc(f.kind)}</span>${esc(f.title)}`, f.html,
        `${ann ? `<button data-open="${ann.id}">Study note ${esc(info.abbr)} ${esc(ann.ref)}</button>` : ''}<span class="sp"></span>` +
        (ann ? `<button data-go="v-${p.bid}-${ann.s[0]}-${ann.s[1]}">Show in text</button>` : `<button data-go="intro-${p.bid}">Show in introduction</button>`));
    } else if (p.t === 'n') {
      const n = bk.notes[id]; if (!n) return;
      showModal(`<span class="k">${/\d/.test(n.m) ? 'Footnote' : 'Cross references'}</span>${esc(info.name)} ${n.c || ''} <span class="r">${esc(n.m)}</span>`, `<p>${n.html}</p>`, '');
    }
  }

  async function openPassage(id, end, pdf) {
    const p = parseId(id); if (!p) return;
    const V = await getVerses(p.bid), info = B[p.bid];
    const c = p.c;
    const r = await passage(`c-${p.bid}-${c}`, null);
    const foot = `<button data-passage="c-${p.bid}-${c - 1}" ${V.chFirst.has(c - 1) ? '' : 'disabled'}>‹ ${esc(info.abbr)} ${c - 1}</button>
      <button data-passage="c-${p.bid}-${c + 1}" ${V.chFirst.has(c + 1) ? '' : 'disabled'}>${esc(info.abbr)} ${c + 1} ›</button>
      <span class="sp"></span>${pdf ? `<button data-pdf="${esc(pdf)}">Open in PDF (with study notes)</button>` : ''}`;
    showModal(`<span class="k">Scripture</span>${esc(refLabel(id, end) || info.name + ' ' + c)}`,
      `<div class="passage">${versesHtml(r.verses, p.bid, { ids: true })}</div>`, foot);
    if (p.t === 'v') {
      const q = end ? parseId(end) : null;
      const lo = p.v, hi = q && q.t === 'v' && q.c === c ? q.v : p.v;
      let first = null;
      for (let v = lo; v <= hi; v++) {
        const el = document.getElementById(`pv-${p.bid}-${c}-${v}`);
        if (el) { el.classList.add('flash'); first = first || el; }
      }
      if (first) $('#modal-body').scrollTop = first.offsetTop - $('#modal-body').offsetTop - 40;
    }
  }

  // ------------------------------------------------------------------ hover previews (nested)
  const pops = [];
  let openTimer = null, closeTimer = null;
  const canHover = () => window.matchMedia('(hover: hover)').matches;
  function previewable(a) {
    if (a.closest('.search-panel')) return false;
    if (a.classList.contains('vn')) return !!a.dataset.ann && !a.closest('.pop, .verse-quote, .passage');
    const h = a.getAttribute('href') || '';
    if (/^#s-\d{3}-/.test(h)) return !a.closest('.outline, .nav, .fig-list');
    return /^#[vcnaf]-/.test(h) && !!parseId(h.slice(1));
  }
  function truncate(level) {
    while (pops.length > level) pops.pop().el.remove();
  }
  function closePops() { clearTimeout(openTimer); clearTimeout(closeTimer); truncate(0); }

  document.addEventListener('mouseover', e => {
    if (!canHover()) return;
    const t = e.target;
    const popEl = t.closest && t.closest('.pop');
    let level = popEl ? pops.findIndex(p => p.el === popEl) + 1 : 0;
    const a = t.closest && t.closest('a');
    if (a && pops[level] && pops[level].src === a) level += 1;
    clearTimeout(closeTimer);
    if (level < pops.length) closeTimer = setTimeout(() => truncate(level), 320);
    clearTimeout(openTimer);
    if (a && previewable(a) && !(pops[level - 1] && pops[level - 1].src === a)) {
      openTimer = setTimeout(() => { clearTimeout(closeTimer); truncate(level); showPop(a); }, a.classList.contains('vn') ? 450 : 230);
    }
  });
  document.addEventListener('mouseout', e => {
    if (!e.relatedTarget) { clearTimeout(openTimer); clearTimeout(closeTimer); closeTimer = setTimeout(() => truncate(0), 320); }
  });

  async function showPop(a) {
    const el = document.createElement('div');
    el.className = 'pop';
    el.innerHTML = '<div class="loading">Loading…</div>';
    (modal().open ? modal() : $('#pops')).appendChild(el);
    pops.push({ el, src: a });
    place(el, a);
    try { el.innerHTML = await previewHtml(a); }
    catch (err) { el.innerHTML = '<div class="loading">Preview unavailable.</div>'; }
    if (el.isConnected) place(el, a);
  }
  function place(el, a) {
    const r = a.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    const x = Math.max(8, Math.min(r.left - 24, window.innerWidth - w - 8));
    let y = r.bottom + 6;
    if (y + h > window.innerHeight - 8 && r.top - h - 6 > 8) y = r.top - h - 6;
    el.style.left = x + 'px';
    el.style.top = Math.max(8, y) + 'px';
  }
  async function annPreview(id) {
    const p = parseId(id); if (!p) return '';
    const bk = await getBook(p.bid);
    const x = bk.annotations.find(z => z.id === id); if (!x) return '';
    return `<div class="pop-h"><span class="k">Study note</span>${esc(B[p.bid].abbr)} ${esc(x.ref)}<span class="go">click to open</span></div>${x.html}`;
  }
  const secDom = {};
  async function sectionPreview(id, sp) {
    const d = await getSection(sp.num);
    if (!secDom[sp.num]) { const t = document.createElement('template'); t.innerHTML = d.html; secDom[sp.num] = t.content; }
    const el = secDom[sp.num].getElementById(id);
    if (!el) return '';
    // the target block plus the next couple of blocks, so headings and bylines carry some text
    let html = '', n = 0, x = el;
    if (x.tagName === 'SPAN' && !x.textContent) x = x.nextElementSibling;
    while (x && n < 3) {
      if (n && /^H[23]$/.test(x.tagName)) break;
      html += x.outerHTML.replace(/\sid="[^"]*"/g, '');
      if (x.tagName === 'FIGURE' || x.classList.contains('idx-cols')) break;
      x = x.nextElementSibling; n++;
    }
    return `<div class="pop-h"><span class="k">${esc(d.title)}</span><span class="go">click to go there</span></div>${html}`;
  }
  async function previewHtml(a) {
    if (a.classList.contains('vn')) return annPreview(a.dataset.ann);
    const sp = parseSid(a.getAttribute('href').slice(1));
    if (sp) return sectionPreview(a.getAttribute('href').slice(1), sp);
    const id = a.getAttribute('href').slice(1), p = parseId(id), info = B[p.bid];
    if (p.t === 'v' || p.t === 'c') {
      const end = a.dataset.end;
      const r = await passage(id, end, 12);
      return `<div class="pop-h">${esc(refLabel(id, end))}${info.converted ? '' : '<span class="k">preview</span>'}<span class="go">click to ${info.converted ? 'go there' : 'read chapter'}</span></div>` +
        versesHtml(r.verses, p.bid, { chapters: true }) + (r.more ? `<div class="more">+ ${r.more} more verses</div>` : '');
    }
    if (p.t === 'n') {
      const bk = await getBook(p.bid), n = bk.notes[id];
      if (!n) return '';
      return `<div class="pop-h"><span class="k">${/\d/.test(n.m) ? 'Footnote' : 'Cross references'}</span>${esc(info.abbr)} ${n.c || ''} · ${esc(n.m)}</div><p>${n.html}</p>`;
    }
    if (p.t === 'a') return annPreview(id);
    if (p.t === 'f') {
      const bk = await getBook(p.bid), f = bk.figures.find(x => x.id === id);
      return f ? `<div class="pop-h"><span class="k">${esc(f.kind)}</span>${esc(f.title)}<span class="go">click to open</span></div>${f.html}` : '';
    }
    return '';
  }

  // ------------------------------------------------------------------ left navigation
  const ICON = { h: '¶', a: '✎', f: '▦', map: '⌖', chart: '▦', illustration: '◩' };
  function buildNav() {
    const books = S.m.books;
    const bookNode = b => {
      if (!b.converted) {
        const chs = Array.from({ length: b.chapters }, (_, i) => `<a href="#c-${b.id}-${i + 1}">${i + 1}</a>`).join('');
        return `<details class="lvl0" data-bid="${b.id}"><summary><span>${esc(b.name)}</span><span class="pdf-tag">PDF</span></summary>
          <a class="leaf lvl1 muted" href="#pdf:${esc(sec(b.sec).file || '')}">Open book PDF (intro, notes, charts)</a>
          <div class="ch-grid">${chs}</div></details>`;
      }
      return `<details class="lvl0" data-bid="${b.id}"><summary><span class="book-name">${esc(b.name)}</span></summary><div class="kids"></div></details>`;
    };
    const byNum = {};
    books.forEach(b => { byNum[b.sec] = b; });
    const secNode = s => {
      if (s.title === 'Concordance') return `<a class="leaf" href="#view:conc"><span class="ico">A</span>Concordance</a>`;
      if (!s.converted) return `<a class="leaf" href="#pdf:${esc(s.file || '')}"><span class="ico">⎙</span>${esc(s.title)}</a>`;
      const items = (s.nav || []).filter(x => x[2] === 2 || x[2] === 4);
      const label = s.title.replace(/^Introduction to the /, 'Intro: ');
      if (!items.length) return `<a class="leaf sec-leaf" data-snum="${s.num}" href="#s-${pad3(s.num)}-1"><span class="ico">§</span>${esc(label)}</a>`;
      return `<details class="lvl0" data-snum="${s.num}"><summary><span>§ ${esc(label)}</span></summary>
        <a class="leaf lvl1" href="#s-${pad3(s.num)}-1"><span class="ico"></span><span>Start</span></a>
        ${items.map(x => `<a class="leaf lvl1" href="#${x[0]}"><span class="ico ${x[3] ? 'f' : ''}">${x[3] ? ICON[x[3]] || '▦' : ''}</span><span>${esc(x[1])}</span></a>`).join('')}</details>`;
    };
    let html = '<nav class="nav"><div class="nav-group">Front matter</div>', group = 'front';
    for (const s of S.m.sections) {
      if (s.title === 'OLD TESTAMENT') { html += '<div class="nav-group">Old Testament</div>'; group = 'ot'; continue; }
      if (s.title === 'NEW TESTAMENT') { html += '<div class="nav-group">New Testament</div>'; group = 'nt'; continue; }
      if (byNum[s.num]) { html += bookNode(byNum[s.num]); if (byNum[s.num].id === 'rev') { html += '<div class="nav-group">Reference</div><a class="leaf" href="#view:figures"><span class="ico f">▦</span>Charts, maps &amp; pictures</a>'; group = 'ref'; } continue; }
      html += secNode(s);
    }
    $('#tab-nav').innerHTML = html + '</nav>';
    $$('#tab-nav details[data-bid]').forEach(d => d.addEventListener('toggle', () => { if (d.open) fillBookNav(d); }));
  }
  function openNavSection(n) {
    $$('#tab-nav .active').forEach(e => e.classList.remove('active'));
    const d = $(`#tab-nav [data-snum="${n}"]`);
    if (!d) return;
    if (d.tagName === 'DETAILS') d.open = true;
    d.classList.add('active');
  }
  function fillBookNav(d) {
    const kids = $('.kids', d);
    if (!kids || kids.dataset.done) return;
    kids.dataset.done = '1';
    const b = B[d.dataset.bid], nav = b.nav;
    const leaf = (cls, id, label, ico, icoCls) => `<a class="leaf ${cls}" href="#${id}"><span class="ico ${icoCls || ''}">${ico || ''}</span><span>${esc(label)}</span></a>`;
    let html = `<details class="lvl1"><summary>Introduction</summary>${leaf('lvl2', 'intro-' + b.id, 'Start of introduction', '')}` +
      nav.intro.map(([id, label, kind]) => leaf('lvl2', id, label, kind ? ICON[kind] : '', kind ? 'f' : '')).join('') + `</details>`;
    for (let c = 1; c <= b.chapters; c++) {
      const items = nav.chapters[c] || [];
      html += `<details class="lvl1" data-c="${c}"><summary><a href="#c-${b.id}-${c}">Chapter ${c}</a></summary>` +
        items.map(([k, id, label, fk]) => leaf('lvl2', id, label, k === 'f' ? ICON[fk] : ICON[k], k)).join('') + `</details>`;
    }
    kids.innerHTML = html;
  }
  function openNavBook(bid) {
    const d = $(`#tab-nav details[data-bid="${bid}"]`);
    if (d && !d.open) { d.open = true; fillBookNav(d); }
  }
  let navC = null;
  function syncNav() {
    if (S.view !== 'book') return;
    const r = visRange();
    const c = r ? Math.floor(r[0] / 1000) : null;
    if (c === navC) return;
    navC = c;
    $$('#tab-nav .active').forEach(e => e.classList.remove('active'));
    if (c == null) return;
    const d = $(`#tab-nav details[data-bid="${S.bid}"] details[data-c="${c}"]`);
    if (d) d.classList.add('active');
  }

  // ------------------------------------------------------------------ concordance
  function concFilterBook() { const v = $('#conc-book').value; return v === '' ? null : +v; }
  function renderConcList() {
    const q = $('#conc-q').value.trim().toUpperCase();
    const b = concFilterBook();
    let items = S.m.concordance;
    if (b !== null) items = items.filter(x => x[3].includes(b));
    if (q) {
      const st = items.filter(x => x[1].toUpperCase().startsWith(q));
      const ct = items.filter(x => !x[1].toUpperCase().startsWith(q) && x[1].toUpperCase().includes(q));
      items = st.concat(ct);
    }
    const max = 500;
    $('#conc-count').textContent = `${items.length.toLocaleString()} word${items.length === 1 ? '' : 's'}${b !== null ? ' in ' + S.m.books[b].name : ''}`;
    $('#conc-list').innerHTML = items.slice(0, max).map(x => `<li><a href="#${x[0]}" data-k="${x[0]}">${esc(x[1])}</a></li>`).join('') +
      (items.length > max ? `<li class="more">Keep typing to narrow ${items.length - max} more…</li>` : '');
  }
  async function showConc(id, restore) {
    const entry = id ? S.m.concordance.find(x => x[0] === id) : null;
    const letter = entry ? entry[2] : (S.concLetter || 'a');
    S.concLetter = letter;
    const rows = await getConc(letter);
    S.bid = null;
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('').filter(l => S.m.concordance.some(x => x[2] === l));
    const body = rows.map(([eid, head, rs]) => `<section class="ce" id="${eid}"><h3>${head.replace(/<\/?a[^>]*>/g, '')}</h3><ul>${rs.map(([bs, h]) => `<li data-b="${bs.join(',')}">${h}</li>`).join('')}</ul><div class="none" hidden>No references in this book.</div></section>`).join('');
    setView('conc', `<div class="reader"><h1 class="book-title">Concordance</h1>
      <div class="letters">${letters.map(l => `<a href="#${(S.m.concordance.find(x => x[2] === l) || [])[0]}" class="${l === letter ? 'on' : ''}">${l.toUpperCase()}</a>`).join('')}</div>${body}</div>`);
    applyConcBookFilter();
    switchTab('conc');
    $$('#conc-list a.active').forEach(a => a.classList.remove('active'));
    if (id) {
      const el = document.getElementById(id);
      if (el) { el.classList.add('focus'); main().scrollTop = restore != null ? restore : el.offsetTop - 18; }
      const la = $(`#conc-list a[data-k="${id}"]`); if (la) la.classList.add('active');
    } else if (restore != null) main().scrollTop = restore;
    renderRight();
  }
  function applyConcBookFilter() {
    const b = concFilterBook();
    $$('.ce').forEach(sec => {
      let any = false;
      $$('li', sec).forEach(li => {
        const show = b === null || li.dataset.b.split(',').includes(String(b));
        li.hidden = !show; any = any || show;
      });
      $('.none', sec).hidden = any;
      sec.hidden = !any && b !== null && !sec.classList.contains('focus');
    });
  }

  // ------------------------------------------------------------------ charts & maps view
  function showFigures(restore) {
    S.bid = null;
    const groups = new Map();
    // colour maps first, then everything in book order
    const all = S.m.figures.slice().sort((a, b) => (a[0] === 's-100' ? -1 : 0) - (b[0] === 's-100' ? -1 : 0));
    all.forEach(([g, id, title, kind]) => { if (!groups.has(g)) groups.set(g, []); groups.get(g).push([id, title, kind]); });
    const gname = g => B[g] ? B[g].name : (sec(+g.slice(2)).title || g);
    const refs = ['Maps Index', 'Charts Index', 'Illustrations Index', 'Index to Maps', 'Table of Weights and Measures', 'Old Testament Chronology', 'New Testament Chronology']
      .map(t => S.m.sections.find(s => s.title === t)).filter(s => s && s.converted);
    setView('figures', `<div class="reader"><h1 class="book-title">Charts, maps &amp; pictures</h1>
      <div class="book-sub">${S.m.figures.length} charts, maps and pictures. Kind filters are in the search bar too.</div>
      <h2 class="sec">Indexes &amp; tables</h2><div class="fig-list">${refs.map(s => `<a href="#s-${pad3(s.num)}-1"><span class="k">§</span>${esc(s.title)}</a>`).join('')}</div>
      ${[...groups].map(([g, list]) => `<h2 class="sec">${esc(gname(g))}</h2><div class="fig-list">${list.map(([id, title, kind]) => `<a href="#${id}"><span class="k">${esc(kind)}</span>${esc(title)}</a>`).join('')}</div>`).join('')}</div>`);
    if (restore != null) main().scrollTop = restore;
    renderRight();
  }

  // ------------------------------------------------------------------ search
  let index = null, indexing = null;
  const norm = s => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  function ensureIndex() {
    if (index) return Promise.resolve(index);
    if (indexing) return indexing;
    const conv = S.m.books.filter(b => b.converted);
    const hasSec = S.m.sections.some(s => s.converted);
    indexing = Promise.all([...S.m.books.map(b => getVerses(b.id)), ...conv.map(b => load('search/' + b.id)), ...(hasSec ? [load('search/sections')] : [])]).then(() => {
      const verses = [];
      S.m.books.forEach((b, bi) => {
        const V = S.verses[b.id];
        V.keys.forEach(k => { if (!k.endsWith(':0')) verses.push({ bi, bid: b.id, k, t: V.d[k], l: norm(V.d[k]) }); });
      });
      const docs = [];
      conv.forEach(b => (S.search[b.id] || []).forEach(([id, kind, label, text]) => docs.push({ bi: ORDER.indexOf(b.id), id, kind, label, t: text, l: norm(text), ll: norm(label) })));
      (S.search.sections || []).forEach(([id, kind, label, text]) => docs.push({ bi: -1, id, kind, label, t: text, l: norm(text), ll: norm(label) }));
      index = { verses, docs };
      return index;
    });
    return indexing;
  }
  function parseQuery(q) {
    const terms = [];
    q.replace(/"([^"]+)"|(\S+)/g, (_, ph, w) => {
      const t = norm((ph || w).replace(/^[^\w']+|[^\w']+$/g, ''));
      if (t) terms.push(t);
    });
    return terms;
  }
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function termRegexes(terms) { return terms.map(t => new RegExp('(?:^|[^a-z0-9])' + reEsc(t), '')); }
  function highlight(text, terms, maxLen) {
    let lower = norm(text), start = 0;
    if (maxLen && text.length > maxLen) {
      let pos = -1;
      for (const t of terms) { const p = lower.indexOf(t); if (p >= 0 && (pos < 0 || p < pos)) pos = p; }
      start = Math.max(0, pos - 60);
      text = (start ? '…' : '') + text.slice(start, start + maxLen) + (start + maxLen < text.length ? '…' : '');
      lower = norm(text);
    }
    const marks = [];
    for (const t of terms) { let p = 0; while ((p = lower.indexOf(t, p)) >= 0) { marks.push([p, p + t.length]); p += t.length; } }
    marks.sort((a, b) => a[0] - b[0]);
    let out = '', i = 0;
    for (const [a, b] of marks) { if (a < i) continue; out += esc(text.slice(i, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>'; i = b; }
    return out + esc(text.slice(i));
  }
  function parseRef(q) {
    const m = /^\s*([1-3]?\s*[a-z][a-z .]*?)\.?\s*(\d+)(?:\s*[:.]\s*(\d+)(?:\s*[-–—]\s*(\d+))?)?\s*$/i.exec(q);
    if (!m) return null;
    const name = m[1].toLowerCase().replace(/[\s.]/g, '');
    let bk = S.m.books.find(b => [b.id, b.name, b.abbr, ...b.aliases.split(' ')].some(x => x.toLowerCase().replace(/[\s.]/g, '') === name));
    if (!bk) { const c = S.m.books.filter(b => b.name.toLowerCase().replace(/\s/g, '').startsWith(name)); if (c.length === 1) bk = c[0]; }
    if (!bk) return null;
    const c = +m[2];
    if (c < 1 || c > bk.chapters) return null;
    if (!m[3]) return { id: `c-${bk.id}-${c}` };
    return { id: `v-${bk.id}-${c}-${m[3]}`, end: m[4] ? `v-${bk.id}-${c}-${m[4]}` : null };
  }
  let sKind = 'all', sMore = false, sTimer = null;
  function scopeOk(bi) {
    const v = $('#search-scope').value;
    if (v === 'all') return true;
    if (bi < 0) return false;
    if (v === 'ot') return bi < 39;
    if (v === 'nt') return bi >= 39;
    return S.m.books[bi].id === v;
  }
  async function runSearch() {
    const q = $('#q').value.trim();
    const panel = $('#search-panel'), out = $('#search-results');
    if (!q) { out.innerHTML = `<div class="sr-empty">Type words to search, use "quotes" for phrases, or a reference like <b>Ps 23</b> or <b>John 3:16</b>.</div>`; return; }
    panel.hidden = false;
    const ref = parseRef(q);
    let html = '';
    if (ref) {
      const r = await passage(ref.id, ref.end, 3);
      const txt = r.verses.map(([k, t]) => t).join(' ');
      html += `<div class="sr-group">Go to</div><a class="sr-item" href="#${ref.id}"${ref.end ? ` data-end="${ref.end}"` : ''}><div class="sr-label">${esc(refLabel(ref.id, ref.end))}</div><div class="sr-snip">${esc(txt.slice(0, 220))}${txt.length > 220 ? '…' : ''}</div></a>`;
    }
    if (!index) out.innerHTML = html + `<div class="sr-empty">Loading the search index…</div>`;
    const ix = await ensureIndex();
    if ($('#q').value.trim() !== q) return;
    const terms = parseQuery(q);
    if (!terms.length) { out.innerHTML = html; return; }
    const res = termRegexes(terms);
    const want = k => sKind === 'all' || sKind === k;
    if (want('scripture')) {
      const hits = [];
      for (const v of ix.verses) if (scopeOk(v.bi) && res.every(r => r.test(v.l))) hits.push(v);
      const lim = sMore || sKind === 'scripture' ? 200 : 25;
      if (hits.length) {
        html += `<div class="sr-group"><span>Scripture</span><span>${hits.length.toLocaleString()}</span></div>` +
          hits.slice(0, lim).map(v => { const [c, n] = v.k.split(':'); return `<a class="sr-item" href="#v-${v.bid}-${c}-${n}"><div class="sr-label">${esc(S.m.books[v.bi].name)} ${v.k}</div><div class="sr-snip">${highlight(v.t, terms)}</div></a>`; }).join('') +
          (hits.length > lim ? `<div class="sr-more"><button class="btn" data-more>Show more scripture</button></div>` : '');
      }
    }
    const docHits = kinds => {
      const hits = [];
      for (const d of ix.docs) {
        if (!kinds.includes(d.kind) || !scopeOk(d.bi)) continue;
        if (!res.every(r => r.test(d.l) || r.test(d.ll))) continue;
        let score = 0;
        for (const t of terms) { if (d.ll.includes(t)) score += 20; let p = 0, n = 0; while ((p = d.l.indexOf(t, p)) >= 0 && n < 10) { n++; p += t.length; } score += n; }
        hits.push([score, d]);
      }
      return hits.sort((a, b) => b[0] - a[0]).map(x => x[1]);
    };
    if (want('notes')) {
      const hits = docHits(['note', 'intro']);
      const lim = sKind === 'notes' ? 100 : 12;
      if (hits.length) html += `<div class="sr-group"><span>Study notes &amp; introductions</span><span>${hits.length}</span></div>` +
        hits.slice(0, lim).map(d => `<a class="sr-item" href="#${d.id}"><div class="sr-label">${highlight(d.label, terms)}<span class="kind">${d.kind === 'intro' ? 'introduction' : 'study note'}</span></div><div class="sr-snip">${highlight(d.t, terms, 220)}</div></a>`).join('');
    }
    if (want('articles')) {
      const hits = docHits(['article']);
      const lim = sKind === 'articles' ? 100 : 8;
      if (hits.length) html += `<div class="sr-group"><span>Articles &amp; reference</span><span>${hits.length}</span></div>` +
        hits.slice(0, lim).map(d => `<a class="sr-item" href="#${d.id}"><div class="sr-label">${highlight(d.label, terms)}</div><div class="sr-snip">${highlight(d.t, terms, 220)}</div></a>`).join('');
    }
    if (want('figures')) {
      const hits = docHits(['chart', 'map', 'illustration']);
      if (hits.length) html += `<div class="sr-group"><span>Charts, maps &amp; pictures</span><span>${hits.length}</span></div>` +
        hits.slice(0, sKind === 'figures' ? 100 : 8).map(d => `<a class="sr-item" href="#${d.id}"><div class="sr-label">${highlight(d.label, terms)}<span class="kind">${d.kind}</span></div><div class="sr-snip">${highlight(d.t, terms, 160)}</div></a>`).join('');
    }
    if (want('conc') && !ref) {
      const t0 = terms[0].toUpperCase();
      let hits = S.m.concordance.filter(x => x[1].toUpperCase().startsWith(t0));
      const sv = $('#search-scope').value;
      if (sv !== 'all') hits = hits.filter(x => x[3].some(scopeOk));
      if (hits.length) html += `<div class="sr-group"><span>Concordance</span><span>${hits.length}</span></div>` +
        hits.slice(0, sKind === 'conc' ? 100 : 8).map(x => `<a class="sr-item" href="#${x[0]}"><div class="sr-label">${esc(x[1])}<span class="kind">${x[3].length} book${x[3].length === 1 ? '' : 's'}</span></div></a>`).join('');
    }
    out.innerHTML = html || `<div class="sr-empty">No matches for “${esc(q)}”.</div>`;
    selIdx = -1;
  }
  let selIdx = -1;
  function moveSel(d) {
    const items = $$('#search-results .sr-item');
    if (!items.length) return;
    selIdx = Math.max(0, Math.min(items.length - 1, selIdx + d));
    items.forEach((x, i) => x.classList.toggle('sel', i === selIdx));
    items[selIdx].scrollIntoView({ block: 'nearest' });
  }
  function closeSearch() { $('#search-panel').hidden = true; }

  // ------------------------------------------------------------------ chrome: tabs, toggles, theme, font
  function switchTab(t) {
    $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $('#tab-nav').hidden = t !== 'nav';
    $('#tab-conc').hidden = t !== 'conc';
  }
  const narrow = q => window.matchMedia(q).matches;
  function toggleSide(side) {
    const b = document.body;
    const drawer = side === 'left' ? narrow('(max-width: 760px)') : narrow('(max-width: 1020px)');
    if (drawer) { b.classList.toggle('show-' + side); b.classList.remove('show-' + (side === 'left' ? 'right' : 'left')); }
    else { b.classList.toggle('no-' + side); store.set('niv-' + side, b.classList.contains('no-' + side) ? 'off' : 'on'); setTimeout(() => { measure(); onScroll(true); }, 50); }
  }

  function init() {
    if (!S.m) { $('#view').innerHTML = '<div class="reader"><p>Could not load <code>data/manifest.js</code>.</p></div>'; return; }
    S.m.books.forEach(b => { B[b.id] = b; ORDER.push(b.id); });
    buildNav();
    // book filters
    const opts = S.m.books.map((b, i) => `<option value="${i}">${esc(b.name)}</option>`).join('');
    $('#conc-book').insertAdjacentHTML('beforeend', opts);
    $('#search-scope').insertAdjacentHTML('beforeend', `<optgroup label="Book">${S.m.books.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</optgroup>`);
    renderConcList();
    if (store.get('niv-left') === 'off') document.body.classList.add('no-left');
    if (store.get('niv-right') === 'off') document.body.classList.add('no-right');

    // global link handling
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-open],[data-go],[data-passage],[data-pdf]:not(a),[data-more]');
      if (btn && !btn.matches('a')) {
        if (btn.hasAttribute('data-more')) { sMore = true; runSearch(); return; }
        if (btn.dataset.open) return openModal(btn.dataset.open);
        if (btn.dataset.go) { closeModal(); return go(btn.dataset.go); }
        if (btn.dataset.passage) return openPassage(btn.dataset.passage);
        if (btn.dataset.pdf) return openPdf(btn.dataset.pdf);
        return;
      }
      const a = e.target.closest('a');
      if (!a) return;
      if (a.classList.contains('vn')) { e.preventDefault(); if (a.dataset.ann) openModal(a.dataset.ann); return; }
      const href = a.getAttribute('href');
      if (href == null || !href.startsWith('#')) return;
      e.preventDefault();
      if (a.closest('#search-results')) { $('#q').blur(); }
      if (window.matchMedia('(max-width: 760px)').matches && a.closest('.left')) document.body.classList.remove('show-left');
      activate(decodeURIComponent(href.slice(1)), a);
    });
    window.addEventListener('hashchange', route);
    main().addEventListener('scroll', () => { closePops(); onScroll(); }, { passive: true });
    window.addEventListener('resize', () => { measure(); onScroll(true); });

    // right sidebar: hover highlights verses
    $('#right-body').addEventListener('mouseover', e => {
      const c = e.target.closest('.note-card[data-s]');
      $$('.v.hl').forEach(x => x.classList.remove('hl'));
      if (c && !c.classList.contains('big')) highlightRange(+c.dataset.s, +c.dataset.e, true);
    });
    $('#right-body').addEventListener('mouseleave', () => $$('.v.hl').forEach(x => x.classList.remove('hl')));

    // modal
    $('#modal-close').addEventListener('click', closeModal);
    modal().addEventListener('click', e => { if (e.target === modal()) closeModal(); });
    modal().addEventListener('close', () => closePops());

    // tabs & toggles
    $$('.tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    $('#toggle-left').addEventListener('click', () => toggleSide('left'));
    $('#toggle-right').addEventListener('click', () => toggleSide('right'));
    $('#scrim').addEventListener('click', () => document.body.classList.remove('show-left', 'show-right'));
    $('#theme').addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.dataset.theme = dark ? 'light' : 'dark';
      store.set('niv-theme', document.documentElement.dataset.theme);
    });
    const font = d => {
      const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--read-size')) || 19;
      const n = Math.max(14, Math.min(28, cur + d));
      document.documentElement.style.setProperty('--read-size', n + 'px');
      store.set('niv-font', String(n));
      setTimeout(() => { measure(); onScroll(true); }, 50);
    };
    $('#font-down').addEventListener('click', () => font(-1));
    $('#font-up').addEventListener('click', () => font(1));

    // concordance panel
    $('#conc-q').addEventListener('input', renderConcList);
    $('#conc-book').addEventListener('change', () => { renderConcList(); if (S.view === 'conc') applyConcBookFilter(); });

    // search
    const q = $('#q');
    q.addEventListener('focus', () => { $('#search-panel').hidden = false; ensureIndex(); runSearch(); });
    q.addEventListener('input', () => { sMore = false; clearTimeout(sTimer); sTimer = setTimeout(runSearch, 140); });
    q.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
      else if (e.key === 'Enter') {
        const items = $$('#search-results .sr-item');
        const it = items[selIdx >= 0 ? selIdx : 0];
        if (it) { e.preventDefault(); q.blur(); activate(decodeURIComponent(it.getAttribute('href').slice(1)), it); }
      } else if (e.key === 'Escape') { closeSearch(); q.blur(); }
    });
    $$('#search-kinds button').forEach(b => b.addEventListener('click', () => {
      sKind = b.dataset.k; sMore = false;
      $$('#search-kinds button').forEach(x => x.classList.toggle('on', x === b));
      runSearch(); q.focus();
    }));
    $('#search-scope').addEventListener('change', () => { sMore = false; runSearch(); });
    document.addEventListener('mousedown', e => { if (!e.target.closest('#search')) closeSearch(); });
    document.addEventListener('keydown', e => {
      if (e.key === '/' && document.activeElement === document.body) { e.preventDefault(); q.focus(); }
    });

    route();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
