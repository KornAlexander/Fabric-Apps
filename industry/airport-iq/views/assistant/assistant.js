/*
 * Airport IQ assistant widget — self-contained, framework-free.
 *
 * Injects a floating launcher + chat drawer into any page. Streams grounded
 * answers from the thin Foundry backend (POST /api/assistant/stream, NDJSON)
 * and offers realtime voice (WebRTC straight to Azure OpenAI Realtime using an
 * ephemeral secret minted by the backend). Ported from the digital-twin
 * ChatPanel.tsx + voiceController.ts into vanilla JS.
 *
 * Backend base URL comes from window.AIRPORT_IQ_API_BASE (see config.js).
 * The airport (DUS / BER) is read from ?ap= and sent with every request; the
 * backend falls back to its default airport for unsupported codes.
 */
(function () {
  'use strict';

  var API_BASE = (window.AIRPORT_IQ_API_BASE || '').replace(/\/$/, '');
  var AP = (new URLSearchParams(location.search).get('ap') || 'DUS').toUpperCase();
  var GROUNDED = AP === 'DUS' || AP === 'BER'; // ops snapshot exists for these

  var SUGGESTIONS = GROUNDED
    ? [
        'Summarize operations right now',
        'Which gate has a conflict and why?',
        'Show the most delayed flights',
        'What should operators do next?'
      ]
    : [
        'Which gate has a conflict at DUS?',
        'Summarize DUS operations',
        'Show the most delayed flights at BER'
      ];

  // ── styles ─────────────────────────────────────────────────────────
  var CSS = [
    '.aiq-fab{position:fixed;right:20px;bottom:20px;z-index:99998;display:flex;align-items:center;gap:9px;',
    'padding:12px 18px;border:none;border-radius:26px;cursor:pointer;font:600 14px/1 "Segoe UI",system-ui,sans-serif;',
    'color:#06131f;background:linear-gradient(135deg,#39d98a,#2fb0f0);box-shadow:0 10px 30px rgba(0,0,0,.45);transition:.18s}',
    '.aiq-fab:hover{transform:translateY(-2px);box-shadow:0 16px 40px rgba(0,0,0,.55)}',
    '.aiq-fab svg{width:20px;height:20px}',
    '.aiq-fab.hide{display:none}',
    '.aiq-panel{position:fixed;right:20px;bottom:20px;z-index:99999;width:400px;max-width:calc(100vw - 40px);',
    'height:620px;max-height:calc(100vh - 40px);display:none;flex-direction:column;overflow:hidden;',
    'background:#0d1626f2;backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.12);border-radius:18px;',
    'box-shadow:0 24px 60px rgba(0,0,0,.6);color:#e7edf7;font-family:"Segoe UI",system-ui,sans-serif}',
    '.aiq-panel.open{display:flex}',
    '.aiq-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08)}',
    '.aiq-head .dot{width:9px;height:9px;border-radius:50%;background:#39d98a;box-shadow:0 0 8px #39d98a}',
    '.aiq-head b{font-size:15px}',
    '.aiq-head .sub{font-size:11px;color:#8ea3c6;margin-top:2px}',
    '.aiq-head .grow{flex:1}',
    '.aiq-x{background:none;border:none;color:#8ea3c6;font-size:20px;cursor:pointer;line-height:1;padding:2px 6px;border-radius:8px}',
    '.aiq-x:hover{background:rgba(255,255,255,.08);color:#fff}',
    '.aiq-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px}',
    '.aiq-msg{display:flex;flex-direction:column;gap:4px;max-width:92%}',
    '.aiq-msg.user{align-self:flex-end;align-items:flex-end}',
    '.aiq-msg.assistant{align-self:flex-start}',
    '.aiq-bubble{padding:10px 13px;border-radius:14px;font-size:13.5px;line-height:1.5;white-space:normal;word-wrap:break-word}',
    '.aiq-msg.user .aiq-bubble{background:linear-gradient(135deg,#2fb0f0,#2f6df0);color:#04121f}',
    '.aiq-msg.assistant .aiq-bubble{background:#16233f;border:1px solid rgba(255,255,255,.07)}',
    '.aiq-bubble.streaming::after{content:"▌";animation:aiqblink 1s steps(2) infinite;color:#39d98a}',
    '@keyframes aiqblink{0%,50%{opacity:1}50.01%,100%{opacity:0}}',
    '.aiq-bubble strong{color:#fff}',
    '.aiq-bubble ul{margin:6px 0;padding-left:18px}',
    '.aiq-bubble li{margin:2px 0}',
    '.aiq-meta{font-size:10.5px;color:#7286a8}',
    '.aiq-sugg{display:flex;flex-wrap:wrap;gap:7px;padding:0 16px 10px}',
    '.aiq-sugg button{background:#16233f;border:1px solid rgba(255,255,255,.1);color:#b9c9e4;border-radius:14px;',
    'padding:7px 11px;font-size:12px;cursor:pointer;transition:.15s}',
    '.aiq-sugg button:hover:not(:disabled){border-color:#39d98a;color:#fff}',
    '.aiq-sugg button:disabled{opacity:.5;cursor:default}',
    '.aiq-compose{display:flex;gap:8px;align-items:center;padding:12px 14px;border-top:1px solid rgba(255,255,255,.08)}',
    '.aiq-compose input{flex:1;background:#0a1120;border:1px solid rgba(255,255,255,.14);color:#e7edf7;',
    'border-radius:12px;padding:11px 13px;font-size:13.5px;outline:none}',
    '.aiq-compose input:focus{border-color:#39d98a}',
    '.aiq-btn{border:none;border-radius:12px;cursor:pointer;width:42px;height:42px;display:flex;align-items:center;',
    'justify-content:center;transition:.15s;flex:none}',
    '.aiq-btn svg{width:19px;height:19px}',
    '.aiq-send{background:linear-gradient(135deg,#39d98a,#2fb0f0);color:#06131f}',
    '.aiq-send:disabled{opacity:.5;cursor:default}',
    '.aiq-mic{background:#16233f;border:1px solid rgba(255,255,255,.14);color:#b9c9e4}',
    '.aiq-mic.live{background:linear-gradient(135deg,#ff5470,#ff8a5c);color:#150406;border-color:transparent;',
    'animation:aiqpulse 1.4s ease-in-out infinite}',
    '.aiq-mic.starting{opacity:.7}',
    '.aiq-mic.error{background:#5c1f28;color:#ffb3bf}',
    '@keyframes aiqpulse{0%,100%{box-shadow:0 0 0 0 rgba(255,84,112,.5)}50%{box-shadow:0 0 0 8px rgba(255,84,112,0)}}',
    '.aiq-voicepill{font-size:11px;color:#8ea3c6;padding:0 16px 8px;min-height:14px}',
    '.aiq-voicepill.live{color:#ffb0bd}'
  ].join('');

  // ── icons ──────────────────────────────────────────────────────────
  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  var ICON_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>';

  // ── DOM build ──────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  var fab = document.createElement('button');
  fab.className = 'aiq-fab';
  fab.innerHTML = ICON_CHAT + '<span>Ask Airport IQ</span>';

  var panel = document.createElement('div');
  panel.className = 'aiq-panel';
  panel.innerHTML =
    '<div class="aiq-head"><span class="dot"></span><div><b>Airport IQ copilot</b>' +
    '<div class="sub">Grounded in live gate operations' + (GROUNDED ? ' · ' + AP : '') + '</div></div>' +
    '<span class="grow"></span><button class="aiq-x" title="Close">\u2715</button></div>' +
    '<div class="aiq-msgs"></div>' +
    '<div class="aiq-voicepill"></div>' +
    '<div class="aiq-sugg"></div>' +
    '<div class="aiq-compose">' +
    '<input type="text" placeholder="Ask about gates, delays, conflicts\u2026" aria-label="Ask Airport IQ"/>' +
    '<button class="aiq-btn aiq-mic" title="Voice">' + ICON_MIC + '</button>' +
    '<button class="aiq-btn aiq-send" title="Send">' + ICON_SEND + '</button></div>';

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  var msgsEl = panel.querySelector('.aiq-msgs');
  var suggEl = panel.querySelector('.aiq-sugg');
  var inputEl = panel.querySelector('.aiq-compose input');
  var sendBtn = panel.querySelector('.aiq-send');
  var micBtn = panel.querySelector('.aiq-mic');
  var voicePill = panel.querySelector('.aiq-voicepill');
  var closeBtn = panel.querySelector('.aiq-x');

  var busy = false;

  function openPanel() {
    panel.classList.add('open');
    fab.classList.add('hide');
    setTimeout(function () { inputEl.focus(); }, 60);
  }
  function closePanel() {
    panel.classList.remove('open');
    fab.classList.remove('hide');
  }
  fab.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);

  // ── message rendering (light, safe markdown) ───────────────────────
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function renderMarkdown(text) {
    var safe = escapeHtml(text);
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // italic: single * or _ pairs left after bold
    safe = safe.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    var lines = safe.split('\n');
    var html = '';
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var h = ln.match(/^\s*#{1,6}\s+(.*)$/);
      if (h) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<div style="margin:8px 0 3px;color:#fff;font-weight:700">' + h[1] + '</div>';
        continue;
      }
      var m = ln.match(/^\s*(?:[-\u2022]|\d+[.)])\s+(.*)$/);
      if (m) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + m[1] + '</li>';
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        if (ln.trim()) html += ln + '<br>';
        else html += '<br>';
      }
    }
    if (inList) html += '</ul>';
    return html;
  }

  function addMessage(role, text, meta) {
    var wrap = document.createElement('div');
    wrap.className = 'aiq-msg ' + role;
    var bubble = document.createElement('div');
    bubble.className = 'aiq-bubble';
    bubble.innerHTML = role === 'assistant' ? renderMarkdown(text || '') : escapeHtml(text || '');
    var m = document.createElement('div');
    m.className = 'aiq-meta';
    m.textContent = meta || '';
    wrap.appendChild(bubble);
    wrap.appendChild(m);
    msgsEl.appendChild(wrap);
    scrollDown();
    return { wrap: wrap, bubble: bubble, meta: m };
  }
  function scrollDown() {
    requestAnimationFrame(function () { msgsEl.scrollTop = msgsEl.scrollHeight; });
  }

  // suggestions
  SUGGESTIONS.forEach(function (s) {
    var b = document.createElement('button');
    b.textContent = s;
    b.addEventListener('click', function () { if (!busy) runPrompt(s); });
    suggEl.appendChild(b);
  });

  // greeting
  addMessage(
    'assistant',
    GROUNDED
      ? 'Hi, I am the Airport IQ copilot. Ask me about gate occupancy, delays, or cascading gate conflicts at ' + AP + '.'
      : 'Hi, I am the Airport IQ copilot. I can answer about gate operations for DUS and BER (delays, gate conflicts, occupancy).',
    'Foundry-grounded assistant'
  );

  // ── streaming chat ─────────────────────────────────────────────────
  function runPrompt(text) {
    text = (text || '').trim();
    if (!text || busy || !API_BASE) {
      if (!API_BASE) addMessage('assistant', 'The assistant backend URL is not configured.', 'Error');
      return;
    }
    busy = true;
    setComposerEnabled(false);
    addMessage('user', text, 'Operator');
    var a = addMessage('assistant', '', 'Streaming from Foundry\u2026');
    a.bubble.classList.add('streaming');

    var streamed = '';
    fetch(API_BASE + '/api/assistant/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: text, airport: AP, sessionId: 'airport-iq' })
    })
      .then(function (resp) {
        if (!resp.ok || !resp.body) throw new Error(resp.status + ' ' + resp.statusText);
        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        var metaLabel = 'Streaming from Foundry\u2026';
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            buffer += decoder.decode(r.value, { stream: true });
            var lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (var i = 0; i < lines.length; i++) {
              var ln = lines[i].trim();
              if (!ln) continue;
              var ev;
              try { ev = JSON.parse(ln); } catch (e) { continue; }
              if (ev.type === 'status') {
                a.meta.textContent = ev.message;
              } else if (ev.type === 'metadata') {
                if (ev.model) { metaLabel = ev.provider + ' / ' + ev.model; a.meta.textContent = metaLabel; }
              } else if (ev.type === 'delta') {
                streamed += ev.text;
                a.bubble.innerHTML = renderMarkdown(streamed);
                scrollDown();
              } else if (ev.type === 'error') {
                throw new Error(ev.message);
              }
            }
            return pump();
          });
        }
        return pump().then(function () {
          a.bubble.classList.remove('streaming');
          a.bubble.innerHTML = renderMarkdown(streamed || '(no answer)');
          a.meta.textContent = metaLabel;
        });
      })
      .catch(function (err) {
        a.bubble.classList.remove('streaming');
        a.bubble.innerHTML = renderMarkdown('The assistant could not answer: ' + (err && err.message ? err.message : 'unknown error') + '.');
        a.meta.textContent = 'Error';
      })
      .finally(function () {
        busy = false;
        setComposerEnabled(true);
        inputEl.focus();
      });
  }

  function setComposerEnabled(on) {
    inputEl.disabled = !on;
    sendBtn.disabled = !on;
    suggEl.querySelectorAll('button').forEach(function (b) { b.disabled = !on; });
  }

  sendBtn.addEventListener('click', function () {
    var t = inputEl.value.trim();
    if (!t) return;
    inputEl.value = '';
    runPrompt(t);
  });
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); sendBtn.click(); }
  });

  // ── realtime voice (WebRTC) ────────────────────────────────────────
  var voice = new VoiceController(API_BASE, AP, micBtn, voicePill);
  micBtn.addEventListener('click', function () { voice.toggle(); });

  function VoiceController(base, ap, btn, pill) {
    this.base = base; this.ap = ap; this.btn = btn; this.pill = pill;
    this.pc = null; this.dc = null; this.mic = null; this.audio = null;
    this.starting = false; this.ready = false; this.greeted = false;
    this.pending = null; this.transcript = '';
  }
  VoiceController.prototype.setState = function (o) {
    o = o || {};
    this.btn.classList.toggle('live', !!o.active && !o.error);
    this.btn.classList.toggle('error', !!o.error);
    this.btn.classList.toggle('starting', !!this.starting);
    this.pill.classList.toggle('live', !!o.active && !o.error);
    if (o.status != null) this.pill.textContent = o.status;
    else if (!o.active && !o.error) this.pill.textContent = '';
  };
  VoiceController.prototype.pillText = function (t) { if (t) { this.pill.textContent = t; this.pill.classList.add('live'); } };
  VoiceController.prototype.send = function (ev) {
    if (!this.dc || this.dc.readyState !== 'open') return false;
    this.dc.send(JSON.stringify(ev)); return true;
  };
  VoiceController.prototype.toggle = function () { if (this.pc) this.stop(); else this.start(); };
  VoiceController.prototype.apiPost = function (path, body) {
    var sep = path.indexOf('?') >= 0 ? '&' : '?';
    return fetch(this.base + path + sep + 'airport=' + this.ap, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {})
    }).then(function (r) { if (!r.ok) throw new Error(r.status + ' ' + r.statusText); return r.json(); });
  };
  VoiceController.prototype.callTool = function (name, args) {
    return this.apiPost('/api/tools/' + name, Object.assign({ airport: this.ap }, args || {}));
  };
  VoiceController.prototype.start = function () {
    if (this.starting || !this.base) { if (!this.base) this.setState({ status: 'Backend not configured', error: true }); return; }
    var self = this;
    this.starting = true; this.ready = false; this.greeted = false;
    this.setState({ status: 'Requesting microphone\u2026', active: true });
    var prefs = { voice: 'sage' };
    Promise.all([this.apiPost('/api/realtime/session', prefs), this.apiPost('/api/realtime/client-secret', prefs)])
      .then(function (res) {
        var plan = res[0], secretResp = res[1];
        var endpoint = String(plan.endpoint || '').replace(/\/$/, '');
        var callsUrl = String(plan.realtimeCallsUrl || '').replace(/\/$/, '');
        if (!endpoint && !callsUrl) throw new Error('Realtime endpoint not configured on the server.');
        var secret = secretResp && (secretResp.value || (secretResp.client_secret && (secretResp.client_secret.value || secretResp.client_secret)));
        if (!secret || typeof secret !== 'string') throw new Error('No realtime client secret returned.');
        return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (micStream) {
          var pc = new RTCPeerConnection();
          var audio = new Audio(); audio.autoplay = true;
          self.mic = micStream; self.pc = pc; self.audio = audio;
          micStream.getTracks().forEach(function (t) { pc.addTrack(t, micStream); });
          pc.ontrack = function (e) { audio.srcObject = e.streams[0]; audio.play().catch(function () {}); };
          pc.onconnectionstatechange = function () {
            var cs = pc.connectionState;
            if (cs === 'failed' || cs === 'disconnected' || cs === 'closed') {
              self.setState({ status: 'Voice connection ' + cs + '.', active: false, error: cs === 'failed' });
            }
          };
          var dc = pc.createDataChannel('oai-events');
          self.dc = dc;
          dc.onopen = function () { self.setState({ status: 'Connecting voice\u2026', active: true }); };
          dc.onmessage = function (m) { try { self.handleEvent(JSON.parse(m.data)); } catch (e) {} };
          return pc.createOffer().then(function (offer) {
            return pc.setLocalDescription(offer).then(function () {
              var url = callsUrl || (endpoint + '/openai/v1/realtime/calls');
              return fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/sdp' }, body: offer.sdp });
            });
          }).then(function (resp) {
            if (!resp.ok) throw new Error('Realtime SDP exchange failed: ' + resp.status);
            return resp.text();
          }).then(function (answer) {
            return pc.setRemoteDescription({ type: 'answer', sdp: answer });
          }).then(function () { self.starting = false; });
        });
      })
      .catch(function (err) {
        self.stop({ quiet: true });
        self.starting = false;
        self.setState({ status: (err && err.message) || 'Voice error', active: false, error: true });
      });
  };
  VoiceController.prototype.stop = function (opts) {
    opts = opts || {};
    if (this.dc) this.dc.close();
    if (this.pc) this.pc.close();
    if (this.mic) this.mic.getTracks().forEach(function (t) { t.stop(); });
    if (this.audio) this.audio.pause();
    this.dc = this.pc = this.mic = this.audio = null;
    this.ready = false; this.greeted = false; this.pending = null; this.starting = false;
    if (!opts.quiet) this.setState({ status: '', active: false });
  };
  VoiceController.prototype.requestGreeting = function () {
    if (!this.ready || this.greeted) return;
    this.greeted = true;
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Start the voice session. Greet me in one short friendly sentence and ask how you can help with airport operations today. Do not call tools for this greeting.' }] } });
    this.send({ type: 'response.create' });
  };
  VoiceController.prototype.requestToolSummary = function (isError) {
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: isError ? 'The tool returned an error. Briefly say the data check failed and ask for a valid flight number or gate.' : 'Summarize the tool result now in a compact spoken answer: key finding, affected flight or gate, delay in minutes, and next action. Do not call another tool.' }] } });
    this.send({ type: 'response.create' });
    this.setState({ status: 'Summarizing\u2026', active: true });
  };
  VoiceController.prototype.executePending = function () {
    var self = this;
    var p = this.pending;
    if (!p) return Promise.resolve(false);
    this.pending = null;
    this.setState({ status: 'Reading ' + p.name.replace(/_/g, ' ') + '\u2026', active: true });
    var args = {};
    try { args = p.arguments ? JSON.parse(p.arguments) : {}; } catch (e) {}
    return this.callTool(p.name, args).then(function (result) {
      self.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: p.callId, output: JSON.stringify(result) } });
      self.requestToolSummary(false);
      return true;
    }).catch(function (err) {
      self.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: p.callId, output: JSON.stringify({ error: (err && err.message) || 'tool error' }) } });
      self.requestToolSummary(true);
      return true;
    });
  };
  VoiceController.prototype.handleEvent = function (ev) {
    var self = this;
    switch (ev.type) {
      case 'session.created':
      case 'session.updated':
        this.ready = true;
        setTimeout(function () { self.requestGreeting(); }, 150);
        return;
      case 'response.created':
        this.transcript = '';
        this.pillText('Listening\u2026');
        return;
      case 'input_audio_buffer.speech_started':
        this.setState({ status: 'Listening\u2026', active: true });
        return;
      case 'input_audio_buffer.speech_stopped':
        this.setState({ status: 'Thinking\u2026', active: true });
        return;
      case 'response.audio_transcript.delta':
      case 'response.output_audio_transcript.delta':
      case 'response.output_text.delta':
      case 'response.text.delta':
        if (ev.delta) { this.transcript += ev.delta; this.pillText(this.transcript); }
        return;
      case 'response.function_call_arguments.done': {
        var name = ev.name || (ev.item && ev.item.name);
        if (!name) return;
        this.pending = { callId: ev.call_id || (ev.item && ev.item.call_id), name: name, arguments: ev.arguments || (ev.item && ev.item.arguments) || '{}' };
        this.setState({ status: 'Preparing ' + name.replace(/_/g, ' ') + '\u2026', active: true });
        return;
      }
      case 'response.output_item.done':
        if (ev.item && ev.item.type === 'function_call' && !this.pending) {
          this.pending = { callId: ev.item.call_id, name: ev.item.name, arguments: ev.item.arguments || '{}' };
          this.setState({ status: 'Preparing ' + ev.item.name.replace(/_/g, ' ') + '\u2026', active: true });
        }
        return;
      case 'response.done':
        this.executePending().then(function (handled) {
          if (handled) return;
          if (self.transcript.trim()) self.setState({ active: true });
          else self.setState({ status: 'Voice is live. Ask the next question.', active: true });
        });
        return;
      case 'error':
        this.setState({ status: (ev.error && ev.error.message) || 'Realtime voice error.', active: false, error: true });
        return;
      default:
        return;
    }
  };
})();
