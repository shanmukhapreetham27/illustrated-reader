/* Reader: pagination, picture placement, Illustrate, Explain, gestures.
   Nothing here is random or time-based: for a given screen size and text size the
   same taps always produce the same pages. */
(() => {
  'use strict';
  const D = JSON.parse(document.getElementById('reader-data').textContent);
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const app = $('app'), frame = $('frame'), flow = $('flow');
  const illusBtn = $('illus'), illusLabel = $('illusLabel'), pageBtn = $('pageno');
  const explainBtn = $('explainBtn'), toastEl = $('toast'), menu = $('menu'), sheet = $('sheet');

  const PARA = {}, FIG = {};
  D.paragraphs.forEach(p => { PARA[p.id] = p; });
  D.figures.forEach(f => { FIG[f.id] = f; });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k) { try { return localStorage.getItem('mi.' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('mi.' + k, v); } catch (e) { /* storage blocked */ } },
  };
  const S = {
    page: 0, pages: 1, W: 0, H: 0, G: 48, step: 48, fs: 18,
    active: new Set(), map: {}, sel: null, grounded: null, busy: false, booted: false,
    fmt: store.get('fmt') === 'pct' ? 'pct' : 'pages',
  };
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------ text -> DOM
  function sentenceHTML(p, si) {
    const s = p.sentences[si];
    let pos = s.a, out = '';
    for (const ph of p.phrases) {
      if (ph.s !== si) continue;
      out += esc(p.text.slice(pos, ph.a)) +
        `<span class="ph" data-f="${ph.f}" data-k="${ph.key}" data-n="${ph.n}">${esc(p.text.slice(ph.a, ph.b))}</span>`;
      pos = ph.b;
    }
    return `<span class="s" data-s="${si}">${out}${esc(p.text.slice(pos, s.b))}</span>`;
  }
  function paraEl(p, from, to, cls) {
    const el = document.createElement('p');
    el.className = 'para' + (cls ? ' ' + cls : '');
    el.dataset.p = p.id;
    let html = '';
    for (let si = from; si <= to; si++) {
      if (si > from) html += p.text.slice(p.sentences[si - 1].b, p.sentences[si].a);
      html += sentenceHTML(p, si);
    }
    el.innerHTML = html;
    return el;
  }
  // Title page. The vignette is a door, not the insect: in 1915 Kafka asked his
  // publisher not to draw the insect on the cover.
  const DOOR = '<svg class="art cover-art" viewBox="0 0 200 240" aria-hidden="true">' +
    '<path class="ochre" opacity=".45" d="M128,222 L140,222 L182,238 L150,238 Z"/>' +
    '<rect class="wood k" x="50" y="26" width="100" height="196" rx="2"/>' +
    '<rect class="ochre k k1" x="60" y="36" width="80" height="186"/>' +
    '<path class="wood2 k" d="M60,36 L128,46 L128,214 L60,222 Z"/>' +
    '<path class="k n k1" d="M72,58 L116,63 L116,118 L72,116 Z M72,134 L116,135 L116,196 L72,201 Z"/>' +
    '<circle class="ochre k k1" cx="120" cy="128" r="4"/><path class="k n k1" d="M120,137 v6"/>' +
    '<path class="k n k1" d="M20,222 H180"/></svg>';
  const titlePage = () => `<section class="titlepage" style="height:${S.H}px">${DOOR}` +
    `<div class="bk">${esc(D.meta.title)}</div><div class="au">${esc(D.meta.author)}</div>` +
    `<div class="tr">translated by ${esc(D.meta.translator)}</div>` +
    `<div class="part">Part ${esc(D.meta.part)}</div>` +
    '<p class="how">Swipe or tap the right edge to start reading. Tap <b>Illustrate</b> to picture every page. ' +
    'Tap a paragraph to explain it.</p></section>';
  const ENDING = `<div class="endmark"><p>End of the excerpt (${esc(D.meta.excerpt)}).</p>` +
    '<p>Tap Illustrate to picture every page. Tap the top of the page for the menu: text size, night mode, How it works, Credits.</p></div>';

  function renderBase() {
    flow.innerHTML = titlePage();
    for (const p of D.paragraphs) flow.appendChild(paraEl(p, 0, p.sentences.length - 1));
    flow.insertAdjacentHTML('beforeend', ENDING);
  }

  // ------------------------------------------------------------- geometry
  function measure() {
    root.style.setProperty('--fs', S.fs + 'px');
    const vw = window.innerWidth;
    const side = Math.max(18, Math.round(vw * 0.055));
    const W = Math.floor(Math.min(vw - 2 * side, S.fs * 34));
    frame.style.left = Math.floor((vw - W) / 2) + 'px';
    frame.style.width = W + 'px';
    const H = Math.floor(frame.getBoundingClientRect().height);
    S.W = W; S.H = H; S.step = W + S.G;
    Object.assign(flow.style, { width: W + 'px', height: H + 'px', columnWidth: W + 'px', columnGap: S.G + 'px', transform: 'none' });
  }
  const origin = () => flow.getBoundingClientRect();
  const pageAt = (left, o) => Math.floor((left - o.left + 1) / S.step);
  function pagesOf(el, o = origin()) {
    const set = new Set();
    for (const r of el.getClientRects()) if (r.width > 0 || r.height > 0) set.add(pageAt(r.left, o));
    return [...set].sort((a, b) => a - b);
  }
  const anchorEl = f => flow.querySelector(`.ph[data-f="${f.id}"][data-k="${f.anchor}"]`);
  const figEl = id => flow.querySelector(`figure[data-f="${id}"]`);

  // -------------------------------------------------------------- pictures
  const svgCache = {};
  const svgFor = f => svgCache[f.id] || (svgCache[f.id] = Art.render(f));
  const CAP = 24, PAD = 14;

  function makeFigure(f, h) {
    const el = document.createElement('figure');
    el.className = 'fig' + (f.imagined ? ' imagined' : '');
    el.dataset.f = f.id;
    el.style.height = h + 'px';
    el.innerHTML = `<div class="art-wrap" style="height:${h - CAP - PAD}px">${svgFor(f)}</div>` +
      `<figcaption><span class="ttl">${esc(f.title)}</span><span class="tag">¶${PARA[f.p].n}</span></figcaption>`;
    return el;
  }
  function figureHeights() {
    const natural = Math.floor(S.W * 320 / 480) + CAP + PAD;
    const cap = Math.floor(S.H * (S.H > S.W * 1.15 ? 0.42 : 0.62));
    const max = Math.min(natural, cap);
    // Smallest size still leaves a drawing at least 120px tall.
    return { max, min: Math.max(120 + CAP + PAD, Math.floor(max * 0.5)) };
  }

  // Pictures always come after the text they show. tryPlace puts one at a candidate spot
  // after the anchor sentence and measures it; it returns null (DOM restored) unless the
  // picture is whole and on the page where its anchor phrase ends, or, if `next` is set,
  // on the page right after.
  function tryPlace(f, cand, h, next) {
    const pEl = flow.querySelector(`p.para[data-p="${f.p}"]`);
    const fig = makeFigure(f, h);
    let undo;
    if (cand.type === 'after') { pEl.after(fig); undo = () => fig.remove(); }
    else {
      const p = PARA[f.p], last = p.sentences.length - 1;
      const head = paraEl(p, 0, cand.b, '');
      const tail = paraEl(p, cand.b + 1, last, 'cont' + (p.sentences[cand.b].q ? ' reopen' : ''));
      pEl.replaceWith(head); head.after(fig); fig.after(tail);
      undo = () => { fig.remove(); tail.remove(); head.replaceWith(pEl); };
    }
    const o = origin(), r = fig.getBoundingClientRect();
    const whole = Math.abs(r.height - h) < 2 && r.top >= o.top - 1 && r.bottom <= o.top + S.H + 1;
    const figPage = pageAt(r.left, o);
    const anchorPages = pagesOf(anchorEl(f), o);
    const ok = whole && (next ? figPage === anchorPages[anchorPages.length - 1] + 1 : anchorPages.includes(figPage));
    if (!ok) { undo(); return null; }
    const marks = [...flow.querySelectorAll(`.ph[data-f="${f.id}"]`)];
    const prev = fig.previousElementSibling, pr = prev.getClientRects(), lr = pr[pr.length - 1];
    fig.dataset.place = `${cand.type}${cand.b !== undefined ? ':' + cand.b : ''}${next ? '/nextpage' : ''}@${h}`;
    return {
      undo,
      read: marks.filter(m => m.compareDocumentPosition(fig) & Node.DOCUMENT_POSITION_FOLLOWING).length / marks.length,
      here: marks.filter(m => pagesOf(m, o).includes(figPage)).length / marks.length,
      gap: pageAt(lr.left, o) === figPage - 1 ? Math.max(0, o.top + S.H - lr.bottom) : 0,
    };
  }

  function placeFigure(f) {
    const { max, min } = figureHeights();
    const p = PARA[f.p], last = p.sentences.length - 1, k = f.anchorSentence;
    const lastQuoted = Math.max(...p.phrases.filter(ph => ph.f === f.id).map(ph => ph.s));
    const spots = upTo => {
      const list = [];
      for (let b = k; b <= Math.min(upTo, last - 1); b++) list.push({ type: 'split', b, bonus: p.sentences[b].q ? -0.05 : 0 });
      list.push({ type: 'after', b: undefined, bonus: 0.1 });
      return list;
    };
    const pick = (cands, sizes, next, score, perfect) => {
      let best = null;
      for (const h of sizes) {
        for (const c of cands) {
          const t = tryPlace(f, c, h, next);
          if (!t) continue;
          t.undo();
          const sc = score(t, c, h);
          if (!best || sc > best.sc + 1e-9) best = { c, h, sc };
          if (perfect(t, h)) return best;
        }
      }
      return best;
    };
    // Same page as the anchor: after the anchor sentence, after a later sentence the
    // picture quotes, or after the paragraph. Details already read and visible count
    // most, then size, then not splitting the paragraph.
    const sizes = [...new Set([max, Math.round(max * 0.8), Math.round(max * 0.62), min].map(h => Math.max(min, h)))];
    let best = pick(spots(lastQuoted), sizes, false,
      (t, c, h) => 1.5 * t.here + t.read + h / max + c.bonus,
      (t, h) => t.here === 1 && t.read === 1 && h === max);
    let next = false;
    // No room left on that page: like a printed book, the picture goes at the first
    // sentence break on the next page, so it still directly follows its text.
    if (!best) {
      next = true;
      best = pick(spots(last), [max], true,
        (t, c) => -1.2 * t.gap / S.H - 0.05 * ((c.b === undefined ? last : c.b) - k),
        t => t.gap < 2);
    }
    if (best && tryPlace(f, best.c, best.h, next)) return true;
    // Should never happen. Keep the picture visible and let the self-test flag it.
    const fig = makeFigure(f, min);
    fig.dataset.place = 'fallback';
    flow.querySelector(`p.para[data-p="${f.p}"]`).after(fig);
    return false;
  }

  function paginate() {
    const o = origin();
    const lastRects = flow.lastElementChild.getClientRects();
    S.pages = pageAt(lastRects[lastRects.length - 1].left, o) + 1;
    S.map = {};
    for (const f of D.figures) {
      const fe = figEl(f.id);
      S.map[f.id] = { anchor: pagesOf(anchorEl(f), o), fig: fe ? pageAt(fe.getBoundingClientRect().left, o) : null };
    }
  }

  function layout(keep) {
    clearSel();
    const grounded = S.grounded;
    S.grounded = null;
    measure();
    renderBase();
    for (const f of D.figures) if (S.active.has(f.id)) placeFigure(f);
    paginate();
    let page = 0;
    if (keep) {
      const s = flow.querySelector(`.para[data-p="${keep.p}"] .s[data-s="${keep.s}"]`);
      if (s) page = pagesOf(s)[0] || 0;
    }
    goTo(page);
    if (grounded && S.active.has(grounded)) { S.grounded = grounded; applyGround(); }
  }

  function firstVisible() {
    const o = origin();
    for (const s of flow.querySelectorAll('.s')) {
      for (const r of s.getClientRects()) if (pageAt(r.left, o) === S.page) return { p: s.closest('.para').dataset.p, s: +s.dataset.s };
    }
    return null;
  }

  // ------------------------------------------------------------ navigation
  function goTo(i) {
    S.page = Math.max(0, Math.min(S.pages - 1, i));
    flow.style.transform = `translateX(${-S.page * S.step}px)`;
    updateFooter();
  }
  function turn(d) {
    clearSel(); clearGround();
    if (!menu.hidden) closeMenu();
    goTo(S.page + d);
  }
  function updateFooter() {
    pageBtn.textContent = S.fmt === 'pct'
      ? (100 * (S.page + 1) / S.pages).toFixed(1) + '%'
      : `${S.page + 1} / ${S.pages}`;
    if (!S.busy) illusLabel.textContent = S.active.size ? 'Hide pictures' : 'Illustrate';
  }

  // ------------------------------------------------------------ Illustrate
  // One tap pictures the whole excerpt; the next tap hides every picture. The reader
  // stays on the text they were reading.
  async function illustrate(opts = {}) {
    if (S.busy) return;
    clearSel(); clearGround();
    if (S.active.size) {
      const keep = firstVisible();
      S.active = new Set();
      layout(keep);
      toast('Pictures hidden.');
      return;
    }
    const quick = opts.instant || reducedMotion;
    S.busy = true;
    illusBtn.classList.add('working');
    illusLabel.textContent = 'Reading';
    toast(`Reading all ${D.paragraphs.length} paragraphs…`, 0);
    // Show the work on the page being read: highlight the words pictures are drawn from.
    const o = origin();
    const marks = [...flow.querySelectorAll('.ph')].filter(el => pagesOf(el, o).includes(S.page));
    for (const el of marks) { el.classList.add('scan'); if (!quick) await sleep(90); }
    toast(`Found ${D.figures.length} scenes: ${D.figures.map(f => f.title).join(' · ')}`, 0);
    if (!quick) await sleep(900);
    const keep = firstVisible();
    D.figures.forEach(f => S.active.add(f.id));
    S.busy = false;
    illusBtn.classList.remove('working');
    layout(keep);
    const ahead = D.figures.map(f => S.map[f.id].fig).filter(pg => pg > S.page);
    const here = D.figures.some(f => S.map[f.id].fig === S.page);
    toast(`${D.figures.length} pictures added across the excerpt. ` + (here || !ahead.length
      ? 'Tap one to see the words it’s drawn from.'
      : `The next one is on page ${Math.min(...ahead) + 1}.`), 5000);
  }

  function setAll(on) {
    const keep = firstVisible();
    S.active = new Set(on ? D.figures.map(f => f.id) : []);
    layout(keep);
    toast(on ? `${D.figures.length} pictures placed across the excerpt.` : 'All pictures removed.');
  }

  // --------------------------------------------------------------- Explain
  function select(pid, x, y) {
    clearSel(); clearGround();
    S.sel = pid;
    flow.querySelectorAll(`.para[data-p="${pid}"]`).forEach(el => el.classList.add('sel'));
    explainBtn.textContent = `Explain ¶${PARA[pid].n}`;
    explainBtn.hidden = false;
    const bw = explainBtn.offsetWidth, bh = explainBtn.offsetHeight;
    let top = y - bh - 26;
    if (top < 12) top = y + 28;
    const left = Math.max(12, Math.min(window.innerWidth - bw - 12, Math.round(x - bw / 2)));
    explainBtn.style.left = left + 'px';
    explainBtn.style.top = Math.round(top) + 'px';
  }
  function clearSel() {
    explainBtn.hidden = true;
    if (!S.sel) return;
    flow.querySelectorAll('.para.sel').forEach(el => el.classList.remove('sel'));
    S.sel = null;
  }
  const refs = t => esc(t).replace(/¶(\d+)/g, (m, d) => `<button type="button" class="pref" data-goto="p${d}">¶${d}</button>`);

  function openExplain(pid) {
    const e = D.explain[pid], p = PARA[pid];
    const fig = D.figures.find(f => f.p === pid);
    let html = `<section><h3>In plain words</h3><p>${refs(e.gist)}</p></section>` +
      `<section><h3>Context so far</h3><ul>${e.context.map(c => `<li>${refs(c)}</li>`).join('')}</ul></section>` +
      `<section><h3>Words</h3><dl>${e.terms.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${refs(d)}</dd>`).join('')}</dl></section>` +
      `<section><h3>Why it matters</h3><p>${refs(e.why)}</p></section>`;
    if (fig) html += `<p class="figlink"><button type="button" class="kbtn" data-show="${fig.id}">Show the picture for ¶${p.n}</button></p>`;
    openSheet(`Explain ¶${p.n}`, html, p.n === 1 ? 'Uses only ¶1. No spoilers.' : `Uses only ¶1–¶${p.n}. No spoilers.`);
  }

  function showPara(pid) {
    closeSheet();
    const el = flow.querySelector(`.para[data-p="${pid}"]`);
    if (!el) return;
    goTo(pagesOf(el)[0]);
    const all = flow.querySelectorAll(`.para[data-p="${pid}"]`);
    all.forEach(x => x.classList.add('flash'));
    setTimeout(() => all.forEach(x => x.classList.remove('flash')), 1600);
  }
  function showFigure(fid) {
    closeSheet();
    if (!S.active.has(fid)) { D.figures.forEach(f => S.active.add(f.id)); layout(firstVisible()); }
    goTo(S.map[fid].fig);
    toggleGround(fid);
  }

  // ------------------------------------------- grounding (numbered phrases)
  function toggleGround(fid) {
    const same = S.grounded === fid;
    clearSel(); clearGround();
    if (same) return;
    S.grounded = fid;
    applyGround();
  }
  function applyGround() {
    const fid = S.grounded, fe = figEl(fid);
    if (!fe) { S.grounded = null; return; }
    fe.classList.add('grounded');
    const o = origin(), pg = S.map[fid].fig;
    const marks = flow.querySelectorAll(`.ph[data-f="${fid}"]`);
    let here = 0;
    marks.forEach(m => { m.classList.add('on'); if (pagesOf(m, o).includes(pg)) here++; });
    fe.querySelector('.tag').textContent = here === marks.length
      ? `${marks.length} details, numbered in the text`
      : `${here} of ${marks.length} details on this page`;
  }
  function clearGround() {
    if (!S.grounded) return;
    const fe = figEl(S.grounded);
    if (fe) { fe.classList.remove('grounded'); fe.querySelector('.tag').textContent = `¶${PARA[FIG[S.grounded].p].n}`; }
    flow.querySelectorAll('.ph.on').forEach(m => m.classList.remove('on'));
    S.grounded = null;
  }

  // ------------------------------------------------------- toast / sheets
  let toastTimer = 0;
  function toast(msg, ms = 4200) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
  }
  let lastFocus = null;
  function openSheet(title, html, note) {
    closeMenu();
    lastFocus = document.activeElement;
    $('sheetTitle').textContent = title;
    $('sheetBody').innerHTML = html;
    $('sheetBody').scrollTop = 0;
    $('sheetNote').textContent = note || '';
    sheet.hidden = false;
    $('sheetClose').focus({ preventScroll: true });
  }
  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  function openMenu() { clearSel(); clearGround(); menu.hidden = false; }
  function closeMenu() { menu.hidden = true; }

  function howItWorks() {
    const checks = D.figures.map(f => {
      const fp = Art.fingerprint(f), ok = fp === D.fingerprints[f.id];
      return { f, fp, ok };
    });
    const good = checks.filter(c => c.ok).length;
    openSheet('How it works', `
      <section><h3>When you tap Illustrate</h3><ol>
        <li><b>Read.</b> The app looks up the scene specs for the whole excerpt and, on the page you are on, highlights the words each picture is drawn from.</li>
        <li><b>Draw.</b> A small SVG engine in this page draws each spec. No image model runs while you read.</li>
        <li><b>Place.</b> A layout pass puts every picture on the same page as the sentence it shows, and redoes it whenever the screen or text size changes.</li>
      </ol></section>
      <section><h3>Left without pictures</h3><ul>${Object.values(D.skips).map(r => `<li>${refs(r)}</li>`).join('')}</ul></section>
      <section><h3>Where the AI comes in</h3>
        <p>An AI reads each passage once, when the book is added. For every scene it writes a spec: what to draw, with each element tied to an exact phrase. It also writes a spoiler-safe explanation for each paragraph. A build step rejects any spec whose quotes don’t match the text word for word, and any explanation that points ahead.</p></section>
      <section><h3>Why deterministic</h3><ul>
        <li>Every reader sees the same picture, so people can talk about the same image.</li>
        <li>No AI cost and no waiting on a page turn.</li>
        <li>Specs are small text files a person can review and correct once, for everyone.</li>
      </ul></section>
      <section><h3>Checked on this device</h3>
        <p><span class="ok">${good} of ${checks.length}</span> pictures match the reference fingerprints byte for byte.</p>
        <p class="mono">${checks.map(c => `${c.f.id} ${c.fp} ${c.ok ? '✓' : '✗'}`).join(' · ')}</p></section>`,
      `${D.figures.length} pictures · ${D.paragraphs.length} explanations · no AI calls while reading`);
  }
  function credits() {
    openSheet('Credits', `
      <section><h3>Text</h3>
        <p>Franz Kafka, <i>Die Verwandlung</i> (1915), Part I, paragraphs 1 to 9. English translation by David Wyllie, from Project Gutenberg eBook #5200, where it is a copyrighted eBook distributed with the translator’s permission.</p>
        <p>“This eBook is for the use of anyone anywhere in the United States and most other parts of the world at no cost and with almost no restrictions whatsoever. You may copy it, give it away or re-use it under the terms of the Project Gutenberg License included with this eBook or online at www.gutenberg.org.”</p>
        <p><a href="https://www.gutenberg.org/policy/license.html" target="_blank" rel="noopener">Read the Project Gutenberg License</a></p></section>
      <section><h3>Pictures and explanations</h3>
        <p>Pictures are drawn by code in this page from scene specs. Explanations were written for this excerpt and only refer back, never ahead.</p>
        <p>The title page shows a door rather than the insect: in 1915 Kafka asked his publisher not to draw the insect on the cover.</p></section>
      <section><h3>Reading view</h3>
        <p>Modelled on a tuned <a href="https://koreader.rocks" target="_blank" rel="noopener">KOReader</a> setup. Fonts: Literata and Charis SIL for text, Noto Sans for controls (SIL Open Font License).</p></section>
      <section><h3>About</h3><p>A concept prototype. Not affiliated with any company.</p></section>`, '');
  }

  // ------------------------------------------------------------- gestures
  let ptr = null, lpTimer = 0;
  frame.addEventListener('contextmenu', e => e.preventDefault());
  app.addEventListener('pointerdown', e => {
    if (e.target.closest('.ui') || e.button > 0) return;
    ptr = { x: e.clientX, y: e.clientY, long: false };
    clearTimeout(lpTimer);
    lpTimer = setTimeout(() => { if (ptr) { ptr.long = true; longPress(ptr.x, ptr.y); } }, 480);
  });
  app.addEventListener('pointermove', e => {
    if (ptr && Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y) > 12) clearTimeout(lpTimer);
  });
  app.addEventListener('pointerup', e => {
    if (!ptr) return;
    clearTimeout(lpTimer);
    const p = ptr; ptr = null;
    if (p.long) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 45) {
      if (Math.abs(dx) > Math.abs(dy)) turn(dx < 0 ? 1 : -1); else turn(dy < 0 ? 1 : -1);
      return;
    }
    tap(p.x, p.y, document.elementFromPoint(p.x, p.y) || app);
  });
  app.addEventListener('pointercancel', () => { ptr = null; clearTimeout(lpTimer); });

  function tap(x, y, target) {
    if (!menu.hidden) { closeMenu(); return; }
    const fig = target.closest('.fig');
    if (fig) { toggleGround(fig.dataset.f); return; }
    if (S.sel || S.grounded) { clearSel(); clearGround(); return; }
    const vw = window.innerWidth, vh = window.innerHeight;
    if (y < vh * 0.08) { openMenu(); return; }
    if (x < vw * 0.22) { turn(-1); return; }
    if (x > vw * 0.78) { turn(1); return; }
    const p = target.closest('.para');
    if (p) select(p.dataset.p, x, y);
  }
  function longPress(x, y) {
    const t = document.elementFromPoint(x, y);
    if (!t) return;
    const fig = t.closest('.fig');
    if (fig) { toggleGround(fig.dataset.f); return; }
    const p = t.closest('.para');
    if (p) select(p.dataset.p, x, y);
  }

  let wheelAt = 0;
  app.addEventListener('wheel', e => {
    if (!sheet.hidden || Math.abs(e.deltaY) < 4) return;
    const now = performance.now();
    if (now - wheelAt < 280) return;
    wheelAt = now;
    turn(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (!sheet.hidden) closeSheet(); else { closeMenu(); clearSel(); clearGround(); } return; }
    if (!sheet.hidden || (e.target.closest && e.target.closest('#menu'))) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); turn(1); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); turn(-1); }
    else if (e.key === 'i' || e.key === 'I') illustrate();
    else if (e.key === 'm' || e.key === 'M') menu.hidden ? openMenu() : closeMenu();
  });

  illusBtn.addEventListener('click', () => illustrate());
  pageBtn.addEventListener('click', () => { S.fmt = S.fmt === 'pct' ? 'pages' : 'pct'; store.set('fmt', S.fmt); updateFooter(); });
  explainBtn.addEventListener('click', () => { if (S.sel) { const pid = S.sel; clearSel(); openExplain(pid); } });
  toastEl.addEventListener('click', () => { toastEl.hidden = true; });
  $('sheetX').addEventListener('click', closeSheet);
  $('sheetClose').addEventListener('click', closeSheet);
  sheet.addEventListener('click', e => {
    if (e.target === sheet) { closeSheet(); return; }
    const go = e.target.closest('[data-goto]');
    if (go) { showPara(go.dataset.goto); return; }
    const show = e.target.closest('[data-show]');
    if (show) showFigure(show.dataset.show);
  });
  menu.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'smaller' || act === 'bigger') {
      S.fs = Math.max(14, Math.min(30, S.fs + (act === 'bigger' ? 1 : -1)));
      store.set('fs', S.fs);
      layout(firstVisible());
    } else if (act === 'night') {
      const dark = getComputedStyle(root).colorScheme.includes('dark');
      root.dataset.theme = dark ? 'light' : 'dark';
      store.set('theme', root.dataset.theme);
    } else if (act === 'how') howItWorks();
    else if (act === 'credits') credits();
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (S.booted) layout(firstVisible()); }, 150);
  });

  // ------------------------------------------------------------ self-tests
  // readerSelfTest(): place every picture, then check alignment, clipping, overlap,
  // layout determinism and SVG fingerprints. readerButtonTest(): with no pictures,
  // one Illustrate tap must place them all and keep the reading position; the next
  // tap must hide them.
  function audit() {
    const o = origin(), rep = { viewport: [window.innerWidth, window.innerHeight], fontSize: S.fs, column: [S.W, S.H], pages: S.pages, figures: [], problems: [] };
    const figRects = [];
    for (const f of D.figures) {
      const fe = figEl(f.id);
      if (!fe) continue;
      const m = S.map[f.id], r = fe.getBoundingClientRect();
      const aligned = m.anchor.includes(m.fig);
      const nextPage = m.fig === m.anchor[m.anchor.length - 1] + 1;
      const follows = !!(anchorEl(f).compareDocumentPosition(fe) & Node.DOCUMENT_POSITION_FOLLOWING);
      const whole = r.top >= o.top - 1 && r.bottom <= o.top + S.H + 1;
      const marks = [...flow.querySelectorAll(`.ph[data-f="${f.id}"]`)];
      const here = marks.filter(x => pagesOf(x, o).includes(m.fig)).length;
      const read = marks.filter(x => x.compareDocumentPosition(fe) & Node.DOCUMENT_POSITION_FOLLOWING).length;
      const svg = fe.querySelector('svg').getBoundingClientRect();
      const prev = fe.previousElementSibling, pr = prev ? prev.getClientRects() : [], lr = pr[pr.length - 1];
      const gap = lr && pageAt(lr.left, o) === m.fig - 1 ? Math.round(o.top + S.H - lr.bottom) : 0;
      rep.figures.push({ id: f.id, p: f.p, page: m.fig + 1, anchorPages: m.anchor.map(x => x + 1), place: fe.dataset.place, gap, height: Math.round(r.height), svg: [Math.round(svg.width), Math.round(svg.height)], aligned, nextPage, follows, whole, detailsOnPage: `${here}/${marks.length}`, detailsRead: `${read}/${marks.length}` });
      if (!follows) rep.problems.push(`${f.id} comes before the text it shows`);
      if (!aligned && !nextPage) rep.problems.push(`${f.id} is not on (or right after) the page of its anchor phrase`);
      if (!whole) rep.problems.push(`${f.id} is cut by a page edge`);
      if (svg.width < 40 || svg.height < 40) rep.problems.push(`${f.id} drawing is too small`);
      figRects.push([f.id, svg], [f.id, fe.querySelector('figcaption').getBoundingClientRect()]);
    }
    for (const s of flow.querySelectorAll('.s')) {
      for (const r of s.getClientRects()) {
        for (const [id, fr] of figRects) {
          if (r.left < fr.right - 1 && fr.left < r.right - 1 && r.top < fr.bottom - 1 && fr.top < r.bottom - 1) rep.problems.push(`text overlaps ${id}`);
        }
        if (r.bottom > o.top + S.H + 1) rep.problems.push('a line runs below the page');
      }
    }
    return rep;
  }
  window.readerSelfTest = function () {
    const before = new Set(S.active), keep = firstVisible();
    S.active = new Set(D.figures.map(f => f.id));
    layout(null);
    const rep = audit();
    const html = flow.innerHTML;
    const t0 = performance.now();
    layout(null);
    rep.layoutMs = Math.round(performance.now() - t0);
    rep.deterministicLayout = html === flow.innerHTML;
    rep.fingerprints = D.figures.map(f => `${f.id}:${Art.fingerprint(f) === D.fingerprints[f.id] ? 'match' : 'DIFFERENT'}`);
    rep.ok = !rep.problems.length && rep.deterministicLayout && rep.fingerprints.every(x => x.endsWith(':match')) && rep.figures.length === D.figures.length;
    S.active = before;
    layout(keep);
    return rep;
  };
  window.readerButtonTest = async function () {
    const before = new Set(S.active), keep0 = firstVisible();
    const steps = [], problems = [];
    let rep = null;
    for (const start of [0, Math.floor(S.pages / 2)]) {
      S.active = new Set();
      layout(null);
      goTo(start);
      const keep = firstVisible();
      await illustrate({ instant: true });
      const s = keep && flow.querySelector(`.para[data-p="${keep.p}"] .s[data-s="${keep.s}"]`);
      const stayed = s ? pagesOf(s).includes(S.page) : S.page === start;
      steps.push(`tap on page ${start + 1}: ${S.active.size} pictures, kept place ${stayed ? 'yes' : 'NO'}`);
      if (S.active.size !== D.figures.length) problems.push(`one tap on page ${start + 1} placed ${S.active.size} pictures`);
      if (!stayed) problems.push(`tap on page ${start + 1} lost the reading position`);
      rep = rep || audit();
      await illustrate({ instant: true });
      if (S.active.size) problems.push('second tap did not hide the pictures');
    }
    rep.steps = steps;
    rep.problems.push(...problems);
    rep.ok = !rep.problems.length;
    toastEl.hidden = true;
    S.active = before;
    layout(keep0);
    return rep;
  };

  // Small handle for the test harness (tests/run.mjs) and for poking at it in devtools.
  window.reader = {
    goTo, illustrate, setAll, openExplain, toggleGround, closeSheet,
    state: () => ({ page: S.page, pages: S.pages, active: [...S.active], fs: S.fs, map: S.map }),
    selectPara(pid) {
      const el = flow.querySelector(`.para[data-p="${pid}"]`);
      goTo(pagesOf(el)[0]);
      const r = [...el.getClientRects()].find(x => pageAt(x.left, origin()) === S.page) || el.getClientRects()[0];
      select(pid, r.left + r.width / 2, r.top + Math.min(r.height / 2, 40));
    },
  };

  // ------------------------------------------------------------------ boot
  function defaultFontSize() {
    const m = Math.min(window.innerWidth, window.innerHeight);
    return m < 520 ? 18 : 21;
  }
  async function boot() {
    const savedTheme = store.get('theme');
    if (savedTheme === 'dark' || savedTheme === 'light') root.dataset.theme = savedTheme;
    S.fs = Number(store.get('fs')) || defaultFontSize();
    measure();
    renderBase();
    if (document.fonts && document.fonts.load) {
      const want = [`${S.fs}px Literata`, `${S.fs}px "Charis SIL"`, `italic ${S.fs}px Literata`, `italic ${S.fs}px "Charis SIL"`, '14px "Noto Sans"', '700 14px "Noto Sans"'];
      await Promise.race([Promise.all(want.map(w => document.fonts.load(w).catch(() => null))), sleep(2500)]);
    }
    layout(null);
    S.booted = true;
    app.classList.remove('booting');
    if (document.fonts) document.fonts.addEventListener('loadingdone', e => {
      if ([...e.fontfaces].some(ff => /Literata|Charis/.test(ff.family))) layout(firstVisible());
    });
  }
  boot();
})();
