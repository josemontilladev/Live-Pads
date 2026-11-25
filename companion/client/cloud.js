// ─────────────────────────────────────────────────────────────────────────
// Companion por internet (móvil). Si la página se abre con ?s=CÓDIGO (el QR de
// «Por internet» en LivePads), se conecta al canal en tiempo real de la nube de
// LivePads en vez de al portátil por la WiFi. Imita lo justo de un WebSocket
// (readyState, send, eventos open/message/close) para que companion.js no cambie.
//
// Canal: realtime:lpc-<código>. El portátil manda evento «m» (lo mismo que por
// la WiFi); el móvil manda evento «c» con su id: { cid, type:'hello'|'auth'|'cmd'|'ping', … }.
// Las respuestas dirigidas llevan `to: cid`.
// ─────────────────────────────────────────────────────────────────────────
(function () {
  var CFG = window.LP_CLOUD || null;
  var ok = function (c) { return !!c && /^[a-z0-9]{6,32}$/i.test(c); };
  var code = new URLSearchParams(location.search).get('s');
  if (ok(code)) { try { localStorage.setItem('lpc-code', code); } catch (_) {} }
  else { try { code = localStorage.getItem('lpc-code'); } catch (_) { code = null; } }
  if (!CFG || !ok(code)) return;

  // Monitor de escenario (?escenario): el portátil solo manda el escenario si alguien lo mira.
  var STAGE = new URLSearchParams(location.search).has('escenario');
  function cid() {
    try { var v = localStorage.getItem('lpc-cid'); if (v) return v; v = Math.random().toString(36).slice(2, 12); localStorage.setItem('lpc-cid', v); return v; }
    catch (_) { return Math.random().toString(36).slice(2, 12); }
  }

  function CloudSocket() {
    var self = this;
    this.readyState = 0;
    this._l = { open: [], message: [], close: [], error: [] };
    this._cid = cid();
    this._ref = 0;
    var topic = 'realtime:lpc-' + code.toLowerCase();
    var url = CFG.url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(CFG.key) + '&vsn=1.0.0';
    var ws = new WebSocket(url);
    this._ws = ws; this._topic = topic;
    var beat = null, alive = null;
    ws.onopen = function () {
      var r = String(++self._ref);
      ws.send(JSON.stringify({ topic: topic, event: 'phx_join', ref: r, join_ref: r, payload: { config: { broadcast: { self: false }, presence: { key: '' }, private: false } } }));
      beat = setInterval(function () { try { ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++self._ref) })); } catch (_) {} }, 25000);
      // Aviso de vida al portátil (cuenta los móviles conectados).
      alive = setInterval(function () { self.send(JSON.stringify({ type: 'ping', st: STAGE ? 1 : 0 })); }, 30000);
    };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.topic === topic && m.event === 'phx_reply' && self.readyState === 0) {
        if (m.payload && m.payload.status === 'ok') {
          self.readyState = 1;
          self._emit('open', {});
          self.send(JSON.stringify({ type: 'hello', st: STAGE ? 1 : 0 }));   // que el portátil mande lo que suena
        } else { try { ws.close(); } catch (_) {} }
        return;
      }
      if (m.topic === topic && m.event === 'broadcast' && m.payload && m.payload.event === 'm') {
        var p = m.payload.payload;
        if (!p || (p.to && p.to !== self._cid)) return;
        self._emit('message', { data: JSON.stringify(p) });
      }
    };
    ws.onclose = function () { clearInterval(beat); clearInterval(alive); self.readyState = 3; self._emit('close', {}); };
    ws.onerror = function () { self._emit('error', {}); };
  }
  CloudSocket.prototype.addEventListener = function (t, fn) { (this._l[t] || (this._l[t] = [])).push(fn); };
  CloudSocket.prototype._emit = function (t, e) { (this._l[t] || []).forEach(function (fn) { try { fn(e); } catch (_) {} }); };
  CloudSocket.prototype.send = function (data) {
    var obj; try { obj = JSON.parse(data); } catch (_) { return; }
    obj.cid = this._cid;
    try { this._ws.send(JSON.stringify({ topic: this._topic, event: 'broadcast', ref: String(++this._ref), payload: { type: 'broadcast', event: 'c', payload: obj } })); } catch (_) {}
  };
  CloudSocket.prototype.close = function () { try { this._ws.close(); } catch (_) {} };

  window.LP_CLOUD_SOCKET = function () { return new CloudSocket(); };
  window.LP_CLOUD_CODE = code;
})();
