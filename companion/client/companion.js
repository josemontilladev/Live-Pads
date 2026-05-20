// Companion client — WebSocket consumer that renders the active song with
// the same chord/section parser the cabin app uses. Adds: hide-chords
// toggle, font-size, auto-scroll, screen-wake lock, smooth song transitions.
//
// Protocol (server → client):
//   { type: 'state', song: { id, title, artist, key, bpm, lyrics } }
//   { type: 'no-song' }

(() => {
  const pill = document.getElementById('conn-pill');
  const emptyView = document.getElementById('empty-view');
  const songView = document.getElementById('song-view');
  const elKey = document.getElementById('song-key');
  const elTitle = document.getElementById('song-title');
  const elArtist = document.getElementById('song-artist');
  const elBpm = document.getElementById('song-bpm');
  const elLyrics = document.getElementById('song-lyrics');
  const elToc = document.getElementById('song-toc');
  const elLiveDot = document.getElementById('live-dot');
  const toggleBtn = document.getElementById('btn-toggle-chords');
  const settingsBtn = document.getElementById('btn-settings');
  const sheet = document.getElementById('settings-sheet');

  let ws = null;
  let retryDelay = 600;
  let currentSongId = null;

  // ── Preferences (persisted in localStorage) ────────────────────────
  const PREFS_KEY = 'livepads-companion-prefs-v1';
  const defaults = {
    chordsHidden: false,
    fontSize: 100,      // % of base
    autoScroll: false,
    scrollSpeed: 3,     // 1..10
    keepAwake: true
  };
  const prefs = Object.assign({}, defaults, readPrefs());

  function readPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ── Toggle chords ──────────────────────────────────────────────────
  function applyChordsState() {
    document.body.classList.toggle('hide-chords', prefs.chordsHidden);
    toggleBtn.setAttribute('aria-pressed', prefs.chordsHidden ? 'true' : 'false');
    toggleBtn.textContent = prefs.chordsHidden ? 'Mostrar acordes' : 'Ocultar acordes';
  }
  toggleBtn.addEventListener('click', () => {
    prefs.chordsHidden = !prefs.chordsHidden;
    savePrefs(); applyChordsState();
  });

  // ── Font size ──────────────────────────────────────────────────────
  const FONT_MIN = 75, FONT_MAX = 200, FONT_STEP = 10;
  function applyFontSize() {
    document.documentElement.style.setProperty('--lyric-scale', prefs.fontSize / 100);
    const out = document.getElementById('size-value');
    if (out) out.textContent = `${prefs.fontSize}%`;
  }
  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = btn.dataset.size === '+' ? 1 : -1;
      prefs.fontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, prefs.fontSize + dir * FONT_STEP));
      savePrefs(); applyFontSize();
    });
  });

  // ── Auto-scroll ────────────────────────────────────────────────────
  let scrollRAF = null;
  let scrollAccum = 0;
  let lastScrollTs = 0;

  function speedToPxPerSec(speed) {
    // 1 → 6 px/s (very slow ballad), 10 → 55 px/s (snappy)
    return 6 + (speed - 1) * (55 - 6) / 9;
  }

  function startAutoScroll() {
    stopAutoScroll();
    lastScrollTs = performance.now();
    scrollAccum = 0;
    const tick = (now) => {
      if (!prefs.autoScroll) return;
      const dt = (now - lastScrollTs) / 1000;
      lastScrollTs = now;
      scrollAccum += speedToPxPerSec(prefs.scrollSpeed) * dt;
      const whole = Math.floor(scrollAccum);
      if (whole >= 1) {
        scrollAccum -= whole;
        const before = window.scrollY;
        window.scrollBy(0, whole);
        // Stop at the bottom — let the user scroll back manually.
        if (window.scrollY === before) {
          prefs.autoScroll = false;
          savePrefs();
          syncAutoScrollUI();
          return;
        }
      }
      scrollRAF = requestAnimationFrame(tick);
    };
    scrollRAF = requestAnimationFrame(tick);
  }
  function stopAutoScroll() {
    if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = null; }
  }
  function syncAutoScrollUI() {
    const cb = document.getElementById('auto-scroll');
    cb.checked = prefs.autoScroll;
    document.querySelector('.sheet-row--speed').dataset.disabled = prefs.autoScroll ? 'false' : 'true';
    document.getElementById('scroll-speed').value = prefs.scrollSpeed;
    if (prefs.autoScroll) startAutoScroll(); else stopAutoScroll();
  }
  document.getElementById('auto-scroll').addEventListener('change', (e) => {
    prefs.autoScroll = e.target.checked;
    savePrefs(); syncAutoScrollUI();
  });
  document.getElementById('scroll-speed').addEventListener('input', (e) => {
    prefs.scrollSpeed = parseInt(e.target.value, 10);
    savePrefs();
  });

  // User scroll interaction pauses auto-scroll. We listen for `touchmove`
  // (an actual drag) instead of `touchstart` — otherwise tapping the
  // settings button or "Listo" would silently kill auto-scroll. Wheel is
  // always an intentional scroll on desktop.
  ['touchmove', 'wheel'].forEach(evt => {
    window.addEventListener(evt, () => {
      if (!prefs.autoScroll) return;
      prefs.autoScroll = false;
      savePrefs();
      syncAutoScrollUI();
    }, { passive: true });
  });

  // ── Screen wake lock ───────────────────────────────────────────────
  let wakeLock = null;
  async function requestWakeLock() {
    if (!prefs.keepAwake) return;
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) {
      // iOS Safari without HTTPS, or user gesture missing — silently skip.
    }
  }
  function releaseWakeLock() {
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
  }
  document.getElementById('keep-awake').addEventListener('change', (e) => {
    prefs.keepAwake = e.target.checked;
    savePrefs();
    if (prefs.keepAwake) requestWakeLock(); else releaseWakeLock();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && prefs.keepAwake) requestWakeLock();
  });

  // ── Settings sheet ─────────────────────────────────────────────────
  function openSheet() { sheet.hidden = false; requestAnimationFrame(() => sheet.classList.add('open')); }
  function closeSheet() {
    sheet.classList.remove('open');
    setTimeout(() => { sheet.hidden = true; }, 200);
  }
  settingsBtn.addEventListener('click', openSheet);
  sheet.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeSheet));

  // Initial UI sync
  applyChordsState();
  applyFontSize();
  syncAutoScrollUI();
  document.getElementById('keep-awake').checked = prefs.keepAwake;
  requestWakeLock();

  // ── Render + connection ────────────────────────────────────────────
  function setConn(state, label) {
    pill.dataset.state = state;
    pill.textContent = label;
  }

  function applyPlaying(playing) {
    if (!elLiveDot) return;
    elLiveDot.hidden = !playing;
    elLiveDot.classList.toggle('is-pulsing', !!playing);
  }

  function render(msg) {
    if (!msg) return;

    if (msg.type === 'playing') {
      applyPlaying(msg.value);
      return;
    }

    if (msg.type === 'no-song') {
      songView.hidden = true;
      emptyView.hidden = false;
      toggleBtn.hidden = true;
      settingsBtn.hidden = true;
      currentSongId = null;
      applyPlaying(false);
      if (elToc) { elToc.hidden = true; elToc.innerHTML = ''; }
      return;
    }
    if (msg.type !== 'state' || !msg.song) return;

    const s = msg.song;
    const songChanged = s.id !== currentSongId;
    currentSongId = s.id;

    elKey.textContent = s.key || '—';
    elTitle.textContent = s.title || '';
    elArtist.textContent = s.artist || '';
    elBpm.textContent = s.bpm ? `BPM ${s.bpm}` : '';
    elLyrics.innerHTML = formatLyrics(s.lyrics || '');
    buildToc();

    emptyView.hidden = true;
    songView.hidden = false;
    toggleBtn.hidden = false;
    settingsBtn.hidden = false;
    applyPlaying(!!msg.playing);

    if (songChanged) {
      // Snap back to top + brief fade so the song change feels intentional.
      window.scrollTo({ top: 0, behavior: 'instant' });
      songView.classList.remove('song-fade-in');
      void songView.offsetWidth; // restart animation
      songView.classList.add('song-fade-in');
      if (prefs.autoScroll) startAutoScroll(); // reset auto-scroll on new song
    }
  }

  function connect() {
    setConn('connecting', 'Conectando…');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}`;

    try { ws = new WebSocket(url); }
    catch (e) { setConn('closed', 'Sin conexión'); scheduleReconnect(); return; }

    ws.addEventListener('open', () => { setConn('open', 'Conectado'); retryDelay = 600; });
    ws.addEventListener('message', (ev) => {
      try { render(JSON.parse(ev.data)); }
      catch (e) { console.warn('Bad payload', e); }
    });
    ws.addEventListener('close', () => { setConn('closed', 'Reconectando…'); scheduleReconnect(); });
    ws.addEventListener('error', () => { try { ws.close(); } catch (e) {} });
  }
  function scheduleReconnect() {
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 1.5, 6000);
  }

  // ── Lyrics parser (mirrors src/js/ui/lyricsFormat.js) ──────────────
  const CHORD_REGEX = /^[A-G][b#]?(?:maj|min|m|maj7|min7|m7|dim|aug|sus\d*|add\d*|no\d*|2|4|5|6|7|9|11|13)*(?:\/[A-G][b#]?)?$/i;
  const SECTION_KEYWORDS = ['INTRO', 'VERSO', 'CORO', 'PUENTE', 'PRECORO', 'PRE-CORO', 'INSTRUMENTAL', 'OUTRO', 'SOLO', 'TAG', 'ENDING', 'ESTRIBILLO', 'VERSE', 'CHORUS', 'BRIDGE', 'PRE-CHORUS'];

  function isChordLine(line) {
    const clean = line.replace(/\[|\]/g, '').trim();
    if (!clean) return false;
    const tokens = clean.split(/\s+/);
    let chordCount = 0, wordCount = 0;
    for (const token of tokens) {
      if (/^x\d+$/i.test(token)) continue;
      const cleanToken = token.replace(/[()]/g, '');
      if (CHORD_REGEX.test(cleanToken)) chordCount++;
      else wordCount++;
    }
    return chordCount > 0 && wordCount === 0;
  }

  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatLyrics(lyrics) {
    if (!lyrics) return '<div class="lyrics-empty">No hay letra disponible.</div>';

    const lines = lyrics.replace(/\r/g, '').split('\n');
    let html = '';
    let sectionIdx = 0;

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) { html += '<div class="lyrics-spacer"></div>'; continue; }

      const isBracketedHeader = trimmed.startsWith('[') && trimmed.endsWith(']') && !isChordLine(trimmed);
      const isKeywordHeader = SECTION_KEYWORDS.some(k => trimmed.toUpperCase().startsWith(k)) && trimmed.split(/\s+/).length <= 3;

      if (isBracketedHeader || isKeywordHeader) {
        const id = `sec-${sectionIdx++}`;
        html += `<div class="section-header-line" id="${id}">${esc(trimmed.replace(/\[|\]/g, ''))}</div>`;
        continue;
      }

      if (isChordLine(rawLine)) {
        html += `<div class="chord-line">${esc(rawLine.replace(/\[|\]/g, ''))}</div>`;
      } else {
        const hasChords = /\[([^\]<>]+)\]/.test(rawLine);
        const escaped = esc(rawLine);
        const withInline = escaped.replace(/\[([^\]]+)\]/g, (m, chord) => `<span class="inline-chord">${chord}</span>`);
        html += `<div class="lyric-line ${hasChords ? 'has-inline-chords' : ''}">${withInline}</div>`;
      }
    }
    return html;
  }

  // Build the sticky TOC from the rendered .section-header-line nodes.
  // Tapping a pill smooth-scrolls to that section. The pill of the section
  // currently under the viewport top gets highlighted via IntersectionObserver.
  let tocObserver = null;
  function buildToc() {
    if (!elToc) return;
    const sections = elLyrics.querySelectorAll('.section-header-line');
    if (sections.length < 2) {
      // Single-section songs don't need a TOC.
      elToc.hidden = true;
      elToc.innerHTML = '';
      if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
      return;
    }
    elToc.hidden = false;
    elToc.innerHTML = Array.from(sections).map(s =>
      `<a class="toc-pill" href="#${s.id}" data-target="${s.id}">${s.textContent}</a>`
    ).join('');

    elToc.querySelectorAll('.toc-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.getElementById(pill.dataset.target);
        if (!target) return;
        // Offset so the section header lands below the sticky top bar + TOC.
        const tocHeight = elToc.getBoundingClientRect().height;
        const topbarHeight = document.querySelector('.top').getBoundingClientRect().height;
        const y = target.getBoundingClientRect().top + window.scrollY - (topbarHeight + tocHeight + 8);
        window.scrollTo({ top: y, behavior: 'smooth' });
      });
    });

    if (tocObserver) tocObserver.disconnect();
    tocObserver = new IntersectionObserver((entries) => {
      // Pick the section whose top is closest to (but past) the top of the
      // viewport — that's the "current" one to highlight.
      entries.forEach(entry => {
        const id = entry.target.id;
        const pill = elToc.querySelector(`.toc-pill[data-target="${id}"]`);
        if (!pill) return;
        if (entry.isIntersecting) pill.classList.add('is-current');
        else pill.classList.remove('is-current');
      });
    }, { rootMargin: '-90px 0px -60% 0px', threshold: 0 });
    sections.forEach(s => tocObserver.observe(s));
  }

  connect();

  // PWA: register the service worker so "Add to home screen" gives a
  // proper installable app. Silently no-ops on browsers that don't
  // support SW (older iOS Safari needs HTTPS, but we already require LAN).
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
