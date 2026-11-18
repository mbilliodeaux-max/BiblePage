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
    if (h === 'view:notes' || h.startsWith('view:notes:')) return showNotes(h.slice(11), restore);
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
      <h2 class="sec">Reference</h2><div class="book-grid">${refSec.map(s => `<a href="#s-${pad3(s.num)}-1">${esc(s.title)}<span>Section</span></a>`).join('')}<a href="#view:figures">Charts, maps &amp; pictures<span>${S.m.figures.length} items</span></a><a href="#view:conc">Concordance<span>${S.m.concordance.length.toLocaleString()} words</span></a><a href="#view:notes">My notes<span>${N.list.length} saved</span></a></div>
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
    paintNotes();
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
    const mine = sortedNotes(N.list.filter(n => n.bid === S.bid && n.s && nnum(n.s) <= b && nnum(n.e) >= a));
    let html = '';
    if (mine.length) html += `<div class="rs-group">My notes</div>` + mine.map(n => `<button class="note-card mine" data-note-edit="${n.id}" data-s="${nnum(n.s)}" data-e="${nnum(n.e)}">
      <span class="dot uh-${n.color}"></span><span class="r">${esc(shortRef(n))}</span><span class="s">${esc(n.text.trim() || n.quote)}</span></button>`).join('');
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
  function closeModal() { const m = modal(); if (m.open) m.close(); finishEdit(); }
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
    markConcMentions();
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

  // ------------------------------------------------------------------ my notes (highlights, notes, #tags, @mentions)
  // Kept in this browser's localStorage; Export / Import moves them between devices.
  const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange'];
  const TAG_RE = /(^|[^\w#@&])#([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)/g;
  const MEN_RE = /(^|[^\w#@&.])@([A-Za-z][A-Za-z0-9_-]*)/g;
  const N = { list: [], byId: new Map(), warned: false };
  const nnum = p => p[0] * 1000 + p[1];
  const mkey = s => s.toUpperCase().replace(/[_-]+/g, ' ').trim();
  const newId = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function reindexNotes() { N.byId = new Map(N.list.map(n => [n.id, n])); }
  function loadNotes() {
    try {
      const d = JSON.parse(localStorage.getItem('niv-notes') || 'null');
      if (d && Array.isArray(d.notes)) N.list = d.notes.map(cleanNote).filter(Boolean);
    } catch (e) { /* no saved notes */ }
    reindexNotes();
  }
  function saveNotes() {
    try { localStorage.setItem('niv-notes', JSON.stringify({ v: 1, notes: N.list })); }
    catch (e) {
      if (!N.warned) { N.warned = true; alert('Your notes could not be saved in this browser (storage is blocked or full). Use Export on the My notes page to keep a copy.'); }
    }
  }
  function parseTokens(n) {
    n.tags = [...new Set([...n.text.matchAll(TAG_RE)].map(m => m[2]))];
    n.mentions = [...new Set([...n.text.matchAll(MEN_RE)].map(m => m[2]))];
  }
  // accepts a note from storage or an import file; returns a safe copy or null
  function cleanNote(x) {
    if (!x || typeof x.id !== 'string') return null;
    const pt = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite) ? p.map(Number) : null;
    const s = pt(x.s), e = pt(x.e), anchored = !!(s && e && B[x.bid]);
    const n = {
      id: x.id, bid: anchored ? x.bid : null, s: anchored ? s : null, e: anchored ? e : null,
      quote: anchored ? String(x.quote || '') : '', color: COLORS.includes(x.color) ? x.color : 'yellow',
      text: String(x.text || ''), created: +x.created || Date.now(), updated: +x.updated || Date.now(),
    };
    parseTokens(n);
    return n;
  }

  let concIds = null;
  function concId(word) {
    if (!concIds) concIds = new Map(S.m.concordance.map(x => [mkey(x[1]), x[0]]));
    return concIds.get(mkey(word)) || null;
  }
  const mentionOf = word => word.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, p, c) => p + c.toUpperCase()).replace(/\s+/g, '_');

  function shortRef(n) {
    const [c, v] = n.s, [c2, v2] = n.e;
    return `${c}:${v}` + (c2 === c ? (v2 !== v ? `–${v2}` : '') : `–${c2}:${v2}`);
  }
  const noteRef = n => n.bid ? `${B[n.bid].abbr} ${shortRef(n)}` : '';
  function noteHtml(text) {
    return esc(text)
      .replace(TAG_RE, (m, p, t) => `${p}<a class="tag" href="#view:notes:${encodeURIComponent('#' + t)}">#${t}</a>`)
      .replace(MEN_RE, (m, p, w) => {
        const k = concId(w);
        return `${p}<a class="men${k ? '' : ' free'}" href="#${k || 'view:notes:' + encodeURIComponent('@' + w)}" title="${k ? 'Open in the concordance' : 'Not a concordance word — shows notes that mention it'}">@${w}</a>`;
      })
      .replace(/\n/g, '<br>');
  }
  function sortedNotes(list) {
    const bi = n => n.bid ? ORDER.indexOf(n.bid) : -1;
    return list.slice().sort((a, b) => bi(a) - bi(b) || (a.s && b.s ? nnum(a.s) - nnum(b.s) || a.s[2] - b.s[2] : 0) || a.created - b.created);
  }
  function matchNote(n, terms) {
    return terms.every(t => {
      if (t[0] === '#' && t.length > 1) { const f = t.slice(1).toLowerCase(); return n.tags.some(x => { x = x.toLowerCase(); return x === f || x.startsWith(f + '.'); }); }
      if (t[0] === '@' && t.length > 1) { const f = mkey(t.slice(1)); return n.mentions.some(x => mkey(x) === f); }
      return (n.text + ' ' + n.quote + ' ' + noteRef(n)).toLowerCase().includes(t.toLowerCase());
    });
  }

  // ---- highlights in the reading text: positions are character offsets inside a verse (verse numbers and footnote letters don't count)
  let vmFor = null, vm = null;
  function verseMap() {
    if (vmFor !== vSpans) {
      vm = new Map(); vmFor = vSpans;
      for (const [el] of vSpans) { const k = el.dataset.v; if (!vm.has(k)) vm.set(k, []); vm.get(k).push(el); }
    }
    return vm;
  }
  function verseNodes(key) {
    const out = [];
    for (const el of verseMap().get(key) || []) {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: t => t.parentElement.closest('.vn, sup') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      let t; while ((t = w.nextNode())) out.push(t);
    }
    return out;
  }
  function pointOffset(nodes, node, off) {
    const r = document.createRange(); r.setStart(node, off); r.collapse(true);
    let acc = 0;
    for (const t of nodes) {
      if (t === node) return acc + off;
      if (r.comparePoint(t, 0) >= 0) return acc;      // this text starts at or after the point
      acc += t.length;
    }
    return acc;
  }
  function captureSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || S.view !== 'book') return null;
    const r = sel.getRangeAt(0), reader = $('#reader');
    if (!reader || !reader.contains(r.commonAncestorContainer)) return null;
    const keys = [];
    for (const [el] of vSpans) if (r.intersectsNode(el) && keys[keys.length - 1] !== el.dataset.v) keys.push(el.dataset.v);
    if (!keys.length) return null;
    const text = k => verseNodes(k).map(t => t.data).join('');
    let so = pointOffset(verseNodes(keys[0]), r.startContainer, r.startOffset);
    let eo = pointOffset(verseNodes(keys[keys.length - 1]), r.endContainer, r.endOffset);
    // drop a first verse the selection only touches the end of, and a last verse it only touches the start of
    while (keys.length > 1 && !text(keys[0]).slice(so).trim()) { keys.shift(); so = 0; }
    while (keys.length > 1 && !text(keys[keys.length - 1]).slice(0, eo).trim()) { keys.pop(); eo = text(keys[keys.length - 1]).length; }
    const quote = keys.map((k, i) => text(k).slice(i === 0 ? so : 0, i === keys.length - 1 ? eo : undefined)).join('').replace(/\s+/g, ' ').trim();
    if (!quote) return null;
    const a = keys[0].split(':').map(Number), b = keys[keys.length - 1].split(':').map(Number);
    return { bid: S.bid, s: [a[0], a[1], so], e: [b[0], b[1], eo], quote: quote.length > 600 ? quote.slice(0, 600) + '…' : quote, rect: r.getBoundingClientRect() };
  }
  function clearPaint() {
    $$('#reader .uh').forEach(u => { const p = u.parentNode; while (u.firstChild) p.insertBefore(u.firstChild, u); p.removeChild(u); p.normalize(); });
  }
  function paintNotes() {
    if (S.view !== 'book') return;
    clearPaint();
    for (const n of N.list) {
      if (n.bid !== S.bid || !n.s) continue;
      const a = nnum(n.s), b = nnum(n.e), ka = `${n.s[0]}:${n.s[1]}`, kb = `${n.e[0]}:${n.e[1]}`;
      const keys = new Set();
      for (const [el, k] of vSpans) if (k >= a && k <= b) keys.add(el.dataset.v);
      for (const key of keys) {
        const lo = key === ka ? n.s[2] : 0, hi = key === kb ? n.e[2] : Infinity;
        let pos = 0;
        for (const t of verseNodes(key)) {
          const len = t.length, x = Math.max(lo - pos, 0), y = Math.min(hi - pos, len);
          pos += len;
          if (x >= y) continue;
          let m = t;
          if (x > 0) m = t.splitText(x);
          if (y - x < m.length) m.splitText(y - x);
          const sp = document.createElement('span');
          sp.className = `uh uh-${n.color}${n.text.trim() ? ' noted' : ''}`;
          sp.dataset.n = n.id;
          m.parentNode.insertBefore(sp, m);
          sp.appendChild(m);
        }
      }
    }
  }

  // ---- selection toolbar
  let pend = null, selTimer = null, barHeld = false;
  function hideSelBar() { $('#sel-bar').hidden = true; pend = null; }
  function onSelChange() {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const bar = $('#sel-bar'), c = modal().open ? null : captureSelection();
      if (!c) { if (!barHeld) hideSelBar(); return; }
      pend = c;
      bar.hidden = false;
      const docked = narrow('(max-width: 760px)') || !canHover();
      bar.classList.toggle('dock', docked);
      if (docked) { bar.style.left = bar.style.top = ''; return; }
      const w = bar.offsetWidth, h = bar.offsetHeight, r = c.rect;
      let y = r.bottom + 8;
      if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 8);
      bar.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8)) + 'px';
      bar.style.top = y + 'px';
    }, 260);
  }
  function addHighlight(color, open) {
    const c = pend; if (!c) return;
    const now = Date.now();
    const n = { id: newId(), bid: c.bid, s: c.s, e: c.e, quote: c.quote, color, text: '', tags: [], mentions: [], created: now, updated: now };
    N.list.push(n);
    store.set('niv-hl', color);
    const sel = window.getSelection(); if (sel) sel.removeAllRanges();
    hideSelBar();
    saveNotes();
    refreshNotes();
    if (open) editNote(n.id);
  }
  function newNote() {
    const now = Date.now();
    const n = { id: newId(), bid: null, s: null, e: null, quote: '', color: 'yellow', text: '', tags: [], mentions: [], created: now, updated: now };
    N.list.push(n); reindexNotes();
    editNote(n.id);
  }
  function deleteNote(id) {
    N.list = N.list.filter(n => n.id !== id);
    saveNotes();
    refreshNotes();
  }
  function refreshNotes() {
    reindexNotes();
    paintNotes();
    lastRangeKey = null; renderRight();
    renderNotesTab();
    if (S.view === 'notes') renderNotesList();
    if (S.view === 'conc') markConcMentions();
  }

  // ---- editor (in the shared modal)
  let editing = null, saveTimer = null;
  function editNote(id) {
    const n = N.byId.get(id); if (!n) return;
    showModal(
      `<span class="k">${n.s ? (n.text.trim() ? 'My note' : 'My highlight') : 'My note'}</span>${n.bid ? `<span class="r">${esc(noteRef(n))}</span>` : ''}`,
      `${n.quote ? `<blockquote class="mn-quote uh-${n.color}" id="note-quote">${esc(n.quote)}</blockquote>` : ''}
       <div class="swatches">${COLORS.map(c => `<button class="sw uh-${c}${c === n.color ? ' on' : ''}" data-note-color="${c}" title="${c}" aria-label="${c}"></button>`).join('')}</div>
       <textarea id="note-text" rows="6" placeholder="Type your note. Tag it with #Group.WedNight (dots nest tags) and link a concordance word with @Abel.">${esc(n.text)}</textarea>
       <div class="suggest" id="note-suggest"></div>
       <div class="mn-text" id="note-preview"></div>`,
      `<button data-note-del="${id}">Delete</button><span class="sp"></span>${n.bid ? `<button data-go="v-${n.bid}-${n.s[0]}-${n.s[1]}">Show in text</button>` : ''}<button data-note-done>Done</button>`);
    editing = id;
    const ta = $('#note-text');
    const sync = () => {
      n.text = ta.value; n.updated = Date.now(); parseTokens(n);
      $('#note-preview').innerHTML = n.tags.length || n.mentions.length ? noteHtml(n.text) : '';
      suggest(ta);
      clearTimeout(saveTimer); saveTimer = setTimeout(saveNotes, 400);
    };
    ta.addEventListener('input', sync);
    ta.addEventListener('click', () => suggest(ta));
    ta.addEventListener('keyup', e => { if (e.key && e.key.startsWith('Arrow')) suggest(ta); });
    $('#note-preview').innerHTML = n.tags.length || n.mentions.length ? noteHtml(n.text) : '';
    if (!n.text) ta.focus();
  }
  function finishEdit() {
    if (!editing) return;
    const n = N.byId.get(editing);
    editing = null;
    clearTimeout(saveTimer);
    if (n && !n.s && !n.text.trim()) N.list = N.list.filter(x => x !== n);   // an empty loose note is not kept
    saveNotes();
    refreshNotes();
  }
  // suggestions for the #tag or @word being typed
  function suggest(ta) {
    const box = $('#note-suggest'); if (!box) return;
    const m = /(^|[\s(])([#@])([\w.-]*)$/.exec(ta.value.slice(0, ta.selectionStart));
    let items = [];
    if (m && m[2] === '#') {
      const f = m[3].toLowerCase(), all = new Map();
      for (const n of N.list) for (const t of n.tags) t.split('.').forEach((_, i, a) => { const p = a.slice(0, i + 1).join('.'); all.set(p.toLowerCase(), p); });
      items = [...all].filter(([k]) => k.startsWith(f) && k !== f).sort().slice(0, 8).map(([, p]) => '#' + p);
    } else if (m && m[3]) {
      const f = mkey(m[3]);
      items = S.m.concordance.filter(x => mkey(x[1]).startsWith(f)).slice(0, 8).map(x => '@' + mentionOf(x[1]));
    }
    box.innerHTML = items.map(t => `<button data-sug="${esc(t)}" data-len="${m[3].length + 1}">${esc(t)}</button>`).join('');
  }
  function applySuggestion(btn) {
    const ta = $('#note-text'); if (!ta) return;
    const end = ta.selectionStart, start = end - +btn.dataset.len;
    ta.setRangeText(btn.dataset.sug + ' ', start, end, 'end');
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  }

  // ---- left tab: tag tree, mentions
  function tagTree() {
    const root = { kids: new Map() };
    for (const n of N.list) {
      const seen = new Set();
      for (const t of n.tags) {
        let node = root, path = '';
        for (const part of t.split('.')) {
          path = path ? path + '.' + part : part;
          const k = part.toLowerCase();
          if (!node.kids.has(k)) node.kids.set(k, { label: part, path, kids: new Map(), n: 0 });
          node = node.kids.get(k);
          if (!seen.has(path.toLowerCase())) { seen.add(path.toLowerCase()); node.n++; }
        }
      }
    }
    return root;
  }
  function tagNodeHtml(node, depth) {
    return [...node.kids.values()].sort((a, b) => a.label.localeCompare(b.label)).map(k => {
      const link = `<a href="#view:notes:${encodeURIComponent('#' + k.path)}">${depth ? '' : '#'}${esc(k.label)}</a><span class="cnt">${k.n}</span>`;
      return k.kids.size
        ? `<details open style="--d:${depth}"><summary>${link}</summary>${tagNodeHtml(k, depth + 1)}</details>`
        : `<div class="leaf" style="--d:${depth}">${link}</div>`;
    }).join('');
  }
  function mentionCounts() {
    const out = new Map();
    for (const n of N.list) for (const w of new Set(n.mentions.map(mkey))) {
      if (!out.has(w)) out.set(w, { label: n.mentions.find(x => mkey(x) === w), n: 0 });
      out.get(w).n++;
    }
    return out;
  }
  function renderNotesTab() {
    const tags = tagNodeHtml(tagTree(), 0);
    const mens = [...mentionCounts().values()].sort((a, b) => a.label.localeCompare(b.label))
      .map(x => `<div class="leaf" style="--d:0"><a href="#view:notes:${encodeURIComponent('@' + x.label)}">@${esc(x.label)}</a><span class="cnt">${x.n}</span></div>`).join('');
    const hl = N.list.filter(n => n.s).length;
    $('#tab-notes').innerHTML = `<div class="mn-tools"><a class="btn" href="#view:notes">All notes <b>${N.list.length}</b></a><button class="btn" data-note-new>New note</button></div>
      <div class="mn-hint">${N.list.length ? `${hl} highlight${hl === 1 ? '' : 's'} · ${N.list.length - hl} loose note${N.list.length - hl === 1 ? '' : 's'}` : 'Select words in any verse to highlight them or add a note.'}</div>
      <div class="nav-group">Tags</div><div class="mn-tree">${tags || '<div class="mn-none">Type #Group.WedNight in a note to tag it. Dots nest tags.</div>'}</div>
      <div class="nav-group">Concordance links</div><div class="mn-tree">${mens || '<div class="mn-none">Type @Abel in a note to link a concordance word.</div>'}</div>`;
  }

  // ---- main view
  function showNotes(filter, restore) {
    S.bid = null;
    setView('notes', `<div class="reader notes-view"><h1 class="book-title">My notes</h1>
      <div class="book-sub" id="mn-sub"></div>
      <div class="mn-bar"><input id="mn-q" type="search" autocomplete="off" spellcheck="false" placeholder="Filter by words, #tag or @word" value="${esc(filter || '')}">
        <button class="btn" data-note-new>New note</button><button class="btn" data-note-export>Export</button><button class="btn" data-note-import>Import</button></div>
      <div id="mn-list"></div></div>`);
    $('#mn-q').addEventListener('input', renderNotesList);
    renderNotesList();
    switchTab('notes');
    if (restore != null) main().scrollTop = restore;
    renderRight();
  }
  function renderNotesList() {
    const box = $('#mn-list'); if (!box) return;
    const terms = $('#mn-q').value.trim().split(/\s+/).filter(Boolean);
    const list = sortedNotes(N.list.filter(n => matchNote(n, terms)));
    $('#mn-sub').textContent = `${list.length} of ${N.list.length} note${N.list.length === 1 ? '' : 's'} and highlights · saved in this browser only — use Export to back up or move them`;
    let html = '', last;
    for (const n of list) {
      if (n.bid !== last) { last = n.bid; html += `<h2 class="sec">${n.bid ? esc(B[n.bid].name) : 'Loose notes'}</h2>`; }
      html += `<article class="mn-card" data-note="${n.id}">
        <div class="mn-head"><span class="dot uh-${n.color}"></span>${n.bid ? `<a class="mn-ref" href="#v-${n.bid}-${n.s[0]}-${n.s[1]}">${esc(noteRef(n))}</a>` : ''}<span class="mn-date">${new Date(n.updated).toLocaleDateString()}</span><button class="btn" data-note-edit="${n.id}">Edit</button></div>
        ${n.quote ? `<blockquote class="mn-quote uh-${n.color}">${esc(n.quote)}</blockquote>` : ''}
        ${n.text.trim() ? `<div class="mn-text">${noteHtml(n.text)}</div>` : ''}</article>`;
    }
    box.innerHTML = html || `<div class="rs-empty">${N.list.length ? 'No notes match this filter.' : 'No notes yet. Open a book, select some words in a verse, then pick a colour or tap Note.'}</div>`;
  }
  // concordance entries show how many of my notes link to them
  function markConcMentions() {
    $$('.ce .mn-link').forEach(a => a.remove());
    for (const [w, x] of mentionCounts()) {
      const id = concId(w), el = id && document.getElementById(id);
      if (el) $('h3', el).insertAdjacentHTML('beforeend', ` <a class="mn-link" href="#view:notes:${encodeURIComponent('@' + x.label)}">${x.n} of my notes</a>`);
    }
  }

  function exportNotes() {
    const blob = new Blob([JSON.stringify({ app: 'niv-notes', v: 1, exported: new Date().toISOString(), notes: N.list }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bible-notes-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function importNotes() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', async () => {
      const f = inp.files[0]; if (!f) return;
      let added = 0, updated = 0;
      try {
        const d = JSON.parse(await f.text());
        if (!d || !Array.isArray(d.notes)) throw new Error('not a notes file');
        for (const raw of d.notes) {
          const n = cleanNote(raw); if (!n) continue;
          const old = N.byId.get(n.id);
          if (!old) { N.list.push(n); N.byId.set(n.id, n); added++; }
          else if (n.updated > old.updated) { N.list[N.list.indexOf(old)] = n; N.byId.set(n.id, n); updated++; }
        }
      } catch (e) { alert('That file could not be read as a notes export.'); return; }
      saveNotes();
      refreshNotes();
      alert(`Import finished: ${added} added, ${updated} updated.`);
    });
    inp.click();
  }

  function initNotes() {
    renderNotesTab();
    const bar = $('#sel-bar');
    bar.innerHTML = COLORS.map(c => `<button class="sw uh-${c}" data-hl="${c}" title="Highlight ${c}" aria-label="Highlight ${c}"></button>`).join('') + `<button class="btn" data-hl-note>Note</button>`;
    bar.addEventListener('mousedown', e => e.preventDefault());           // keep the text selected
    bar.addEventListener('pointerdown', () => { barHeld = true; });
    document.addEventListener('pointerup', () => setTimeout(() => { barHeld = false; }, 500));
    document.addEventListener('selectionchange', onSelChange);
    document.addEventListener('mousedown', e => { if (e.target.closest('[data-sug]')) e.preventDefault(); });   // keep the caret in the note
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-hl],[data-hl-note],[data-sug],[data-note-new],[data-note-edit],[data-note-del],[data-note-done],[data-note-color],[data-note-export],[data-note-import]');
      if (t) {
        const d = t.dataset;
        if (d.hl) return addHighlight(d.hl, false);
        if ('hlNote' in d) return addHighlight(store.get('niv-hl') || 'yellow', true);
        if (d.sug) return applySuggestion(t);
        if ('noteNew' in d) return newNote();
        if (d.noteEdit) return editNote(d.noteEdit);
        if ('noteDone' in d) return closeModal();
        if ('noteExport' in d) return exportNotes();
        if ('noteImport' in d) return importNotes();
        if (d.noteDel) { if (confirm('Delete this note and its highlight?')) { editing = null; closeModal(); deleteNote(d.noteDel); } return; }
        if (d.noteColor) {
          const n = N.byId.get(editing); if (!n) return;
          n.color = d.noteColor; n.updated = Date.now(); store.set('niv-hl', n.color);
          $$('.swatches .sw').forEach(b => b.classList.toggle('on', b === t));
          const q = $('#note-quote'); if (q) q.className = `mn-quote uh-${n.color}`;
          saveNotes();
        }
        return;
      }
      if (e.target.closest('a, button, input, textarea, summary')) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const u = e.target.closest('.uh[data-n]');
      if (u) return editNote(u.dataset.n);
      const card = e.target.closest('.mn-card[data-note]');
      if (card) editNote(card.dataset.note);
    });
    modal().addEventListener('close', finishEdit);
    window.addEventListener('pagehide', () => { if (editing) saveNotes(); });
  }

  // ------------------------------------------------------------------ chrome: tabs, toggles, theme, font
  function switchTab(t) {
    $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $('#tab-nav').hidden = t !== 'nav';
    $('#tab-conc').hidden = t !== 'conc';
    $('#tab-notes').hidden = t !== 'notes';
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
    loadNotes();
    initNotes();
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
    main().addEventListener('scroll', () => { closePops(); onScroll(); if (pend) onSelChange(); }, { passive: true });
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
