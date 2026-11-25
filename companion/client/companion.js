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
    keepAwake: true,
    instrument: 'chords',  // chords | capo | bass | bb | eb | lyrics
    capo: 2,
    nums: false,
    pin: ''
  };
  const prefs = Object.assign({}, defaults, readPrefs());

  function readPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ── Acordes para cada músico (instrument.js) ───────────────────────
  let lastMsg = null;
  let songKey = '';
  function chordText(ch) {
    if (!window.LPInstrument) return ch;
    const out = window.LPInstrument.chordFor(ch, { mode: prefs.instrument, capo: prefs.capo, nums: prefs.nums, key: songKey });
    return out == null ? ch : out;
  }
  function keyLabel(key) {
    if (!key) return '—';
    if (!window.LPInstrument) return key;
    if (prefs.instrument === 'capo') return key + ' · cejilla ' + prefs.capo + ' (' + window.LPInstrument.viewKey(key, 'capo', prefs.capo) + ')';
    if (prefs.instrument === 'bb') return key + ' · en Si♭: ' + window.LPInstrument.viewKey(key, 'bb', 0);
    if (prefs.instrument === 'eb') return key + ' · en Mi♭: ' + window.LPInstrument.viewKey(key, 'eb', 0);
    return key;
  }
  function applyInstrument() {
    const sel = document.getElementById('instrument'), capo = document.getElementById('capo'), nums = document.getElementById('nums');
    if (sel) sel.value = prefs.instrument;
    if (capo) capo.value = String(prefs.capo);
    if (nums) nums.checked = !!prefs.nums;
    const row = document.getElementById('capo-row'); if (row) row.hidden = prefs.instrument !== 'capo';
    document.body.classList.toggle('lyrics-only', prefs.instrument === 'lyrics');
    if (lastMsg) render(lastMsg, true);
  }
  ['instrument', 'capo', 'nums'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      if (id === 'instrument') prefs.instrument = el.value;
      else if (id === 'capo') prefs.capo = parseInt(el.value, 10) || 0;
      else prefs.nums = el.checked;
      savePrefs(); applyInstrument();
    });
  });

  // ── Indicaciones del director ──────────────────────────────────────
  const CUES = [['repeat', 'Repetir'], ['last', 'Última vez'], ['chorus', 'Coro'], ['verse', 'Verso'], ['bridge', 'Puente'], ['pre', 'Pre coro'],
    ['instrumental', 'Instrumental'], ['ending', 'Final'], ['big-ending', 'Final grande'], ['soft', 'Suave'], ['build', 'Sube intensidad'],
    ['down', 'Baja intensidad'], ['all', 'Toda la banda'], ['acapella', 'A capella'], ['break', 'Pausa'], ['hold', 'Sostener'], ['key-up', 'Sube tono'], ['key-down', 'Baja tono']];
  let cueTimer = null;
  function showCue(text, from) {
    const ov = document.getElementById('cue-overlay');
    if (!ov) return;
    document.getElementById('cue-text').textContent = text;
    document.getElementById('cue-from').textContent = from || '';
    ov.hidden = false;
    requestAnimationFrame(() => ov.classList.add('show'));
    try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (e) {}
    clearTimeout(cueTimer);
    cueTimer = setTimeout(() => { ov.classList.remove('show'); setTimeout(() => { ov.hidden = true; }, 250); }, 4000);
  }
  document.getElementById('cue-overlay')?.addEventListener('click', (e) => { e.currentTarget.classList.remove('show'); e.currentTarget.hidden = true; });

  // ── Monitor de escenario (?escenario) ──────────────────────────────
  const STAGE = new URLSearchParams(location.search).has('escenario');
  if (STAGE) {
    document.body.classList.add('stage-mode');
    document.getElementById('stage-view').hidden = false;
  }
  const fmtT = (s) => (s > 0 ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '');
  function renderStage(m) {
    if (!STAGE) return;
    const $ = (id) => document.getElementById(id);
    if (!m.song) { $('sv-title').textContent = 'Esperando canción…'; $('sv-meta').textContent = ''; $('sv-section').textContent = '—'; return; }
    songKey = m.song.key || songKey;
    $('sv-title').textContent = m.song.title;
    $('sv-meta').textContent = [m.song.artist, m.song.key && 'Tono ' + m.song.key, m.song.bpm && m.song.bpm + ' BPM'].filter(Boolean).join(' · ');
    $('sv-section').textContent = m.section || (m.playing ? '…' : 'Preparada');
    $('sv-next-section').textContent = m.nextSection ? 'Luego: ' + m.nextSection + (m.sectionLeft != null ? ' en ' + m.sectionLeft + ' s' : '') : '';
    $('sv-chord').textContent = m.chord ? chordText(m.chord) : '—';
    $('sv-next-chord').textContent = m.nextChord ? chordText(m.nextChord) : '—';
    $('sv-time').textContent = m.dur ? '−' + fmtT(m.dur - m.pos) : '';
    $('sv-progress').style.width = m.dur ? Math.min(100, 100 * m.pos / m.dur) + '%' : '0';
    $('sv-after').textContent = m.next ? 'Siguiente canción: ' + m.next.title + (m.next.key ? ' (' + m.next.key + ')' : '') : '';
    songKey = m.song.key || songKey;
  }

  // ── Modo líder (con PIN) ───────────────────────────────────────────
  let leader = false;
  function send(obj) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) {} }
  function setLeader(on) {
    leader = on;
    document.getElementById('leader-bar').hidden = !on;
    document.getElementById('leader-on').hidden = !on;
    document.querySelector('.sheet-row--leader').hidden = on;
    document.body.classList.toggle('has-leader-bar', on);
  }
  document.getElementById('leader-go')?.addEventListener('click', () => {
    const v = (document.getElementById('leader-pin').value || '').trim();
    if (!/^\d{4}$/.test(v)) { showCue('PIN de 4 cifras', ''); return; }
    prefs.pin = v; savePrefs(); send({ type: 'auth', pin: v });
  });
  document.getElementById('leader-off')?.addEventListener('click', () => { prefs.pin = ''; savePrefs(); setLeader(false); });
  document.getElementById('leader-bar')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) { send({ type: 'cmd', cmd: b.dataset.cmd, pin: prefs.pin }); try { navigator.vibrate && navigator.vibrate(30); } catch (_) {} }
  });
  const cuesSheet = document.getElementById('cues-sheet');
  document.getElementById('cues-grid').innerHTML = CUES.map(([id, t]) => '<button type="button" data-cue="' + id + '">' + t + '</button>').join('');
  document.getElementById('cues-btn')?.addEventListener('click', () => { cuesSheet.hidden = false; });
  document.getElementById('cues-close')?.addEventListener('click', () => { cuesSheet.hidden = true; });
  cuesSheet?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cue]');
    if (!b) return;
    send({ type: 'cmd', cmd: 'cue', arg: b.dataset.cue, pin: prefs.pin, name: 'Líder' });
    cuesSheet.hidden = true;
  });

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
  applyInstrument();
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

  // Tema de LivePads: mismos colores que la cabina. Se guarda para que, al
  // abrir la página otra vez, salga ya con su tema antes de conectar.
  function hexRgb(h) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(h || '').trim());
    if (!m) return null;
    let x = m[1]; if (x.length === 3) x = x.replace(/./g, (c) => c + c);
    return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
  }
  const rgba = (h, a) => { const c = hexRgb(h); return c ? 'rgba(' + c.join(',') + ',' + a + ')' : ''; };
  let themeJson = '';
  function applyTheme(t) {
    if (!t || !t.bg) return;
    const j = JSON.stringify(t);
    if (j === themeJson) return;
    themeJson = j;
    try { localStorage.setItem('lpc.theme', j); } catch (_) {}
    const bgRgb = hexRgb(t.bg) || [10, 10, 20];
    const light = (bgRgb[0] * 299 + bgRgb[1] * 587 + bgRgb[2] * 114) / 1000 > 150;
    const fg = t.text || (light ? '#0f172a' : '#ffffff');
    const v = {
      '--bg': t.bg, '--bg-elev': t.bg2 || t.bg, '--bg-sheet': t.bg2 || t.bg,
      '--fg': fg, '--fg-dim': t.muted || rgba(fg, 0.6),
      '--accent': t.accent, '--chord': t.accent, '--section': t.accent2 || t.accent,
      '--lyric': rgba(fg, 0.92), '--border': t.border || rgba(fg, 0.08),
      '--on-accent': t.onAccent || (light ? '#ffffff' : '#0a0a14'),
      '--top-bg': rgba(t.bg, 0.92), '--bar-bg': rgba(t.bg, 0.96),
      '--soft': rgba(fg, 0.06), '--soft-2': rgba(fg, 0.12), '--line': rgba(fg, 0.16),
      '--fg-soft': rgba(fg, 0.65), '--scrim': light ? 'rgba(15,23,42,.45)' : 'rgba(0,0,0,.6)',
    };
    const s = document.documentElement.style;
    for (const k in v) if (v[k]) s.setProperty(k, v[k]);
    document.documentElement.dataset.light = light ? '1' : '';
    document.body.style.background = t.gradient || t.bg;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t.bg);
  }
  try { const saved = localStorage.getItem('lpc.theme'); if (saved) applyTheme(JSON.parse(saved)); } catch (_) {}

  function render(msg, repaint) {
    if (!msg) return;
    if (msg.theme) applyTheme(msg.theme);

    if (msg.type === 'cue') { showCue(msg.text, msg.from); return; }
    if (msg.type === 'stage') { renderStage(msg); return; }
    if (msg.type === 'auth') {
      if (msg.ok) { setLeader(true); }
      else { setLeader(false); if (prefs.pin) { prefs.pin = ''; savePrefs(); showCue('PIN incorrecto', 'Pídelo en el panel del Companion'); } }
      return;
    }

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
    lastMsg = msg;
    songKey = s.key || '';
    const songChanged = !repaint && s.id !== currentSongId;
    currentSongId = s.id;

    elKey.textContent = keyLabel(s.key);
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
    // Por internet (?s=CÓDIGO, cloud.js) o por la WiFi (el portátil sirve esta página).
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}`;

    if (!window.LP_CLOUD_SOCKET && location.protocol === 'https:') {
      setConn('closed', 'Sin enlace');
      const t = document.querySelector('.empty-title'), s = document.querySelector('.empty-sub');
      if (t) t.textContent = 'Únete a la sesión';
      if (s) {
        s.innerHTML = '';
        const p = document.createElement('p');
        p.textContent = 'Escanea el QR del Companion en LivePads, o escribe aquí su código de 6 cifras.';
        const f = document.createElement('form');
        f.className = 'join-form';
        f.innerHTML = '<input class="join-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000 000" aria-label="Código de la sesión"><button type="submit" class="join-go">Entrar</button>';
        const inp = f.querySelector('input');
        inp.addEventListener('input', () => { const d = inp.value.replace(/\D/g, '').slice(0, 6); inp.value = d.length > 3 ? d.slice(0, 3) + ' ' + d.slice(3) : d; });
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          const d = inp.value.replace(/\D/g, '');
          if (d.length !== 6) { inp.focus(); inp.classList.add('is-bad'); setTimeout(() => inp.classList.remove('is-bad'), 600); return; }
          location.href = location.pathname + '?s=' + d;
        });
        s.append(p, f);
        setTimeout(() => inp.focus(), 50);
      }
      return;
    }
    try { ws = window.LP_CLOUD_SOCKET ? window.LP_CLOUD_SOCKET() : new WebSocket(url); }
    catch (e) { setConn('closed', 'Sin conexión'); scheduleReconnect(); return; }

    ws.addEventListener('open', () => { setConn('open', 'Conectado'); retryDelay = 600; if (prefs.pin) send({ type: 'auth', pin: prefs.pin }); });
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
        html += `<div class="chord-line">${esc(rawLine.replace(/\[|\]/g, '').replace(/\S+/g, (t) => chordText(t)))}</div>`;
      } else {
        const hasChords = /\[([^\]<>]+)\]/.test(rawLine);
        const escaped = esc(rawLine);
        const withInline = escaped.replace(/\[([^\]]+)\]/g, (m, chord) => `<span class="inline-chord">${esc(chordText(chord))}</span>`);
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
    // Versión nueva de la página (SW nuevo): recargar una vez para estrenarla ya,
    // no en la visita siguiente. Solo si ya había uno (la primera instalación no recarga).
    if (navigator.serviceWorker.controller) {
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return; reloaded = true; location.reload();
      });
    }
  }
})();
