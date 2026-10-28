/*
 * Planning poker client.
 *
 *   - Players sign in anonymously, so the database knows who they are.
 *   - Every write is a database function call (create_room, join_game,
 *     cast_vote, ...). Room and player changes arrive over Supabase Realtime.
 *   - Votes are fetched only after the reveal; before that the database
 *     refuses to send anyone else's card.
 *   - Realtime presence says who has the page open and whether it's visible.
 *     Broadcast carries reactions and nudges.
 */
(function () {
  'use strict';

  // ---------- constants ----------
  var DECKS = {
    fib:    { label: 'Fibonacci',   cards: ['0', '½', '1', '2', '3', '5', '8', '13', '21', '34', '?', '☕'] },
    mfib:   { label: 'Modified',    cards: ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100', '?', '☕'] },
    tshirt: { label: 'T-shirt',     cards: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '?', '☕'] },
    pow2:   { label: 'Powers of 2', cards: ['0', '1', '2', '4', '8', '16', '32', '64', '?', '☕'] }
  };
  var SPECIAL = { '?': 1, '☕': 1 };
  var REACTS = [['👍', 'Thumbs up'], ['😂', 'Laughing'], ['🤔', 'Hmm'], ['😱', 'Yikes'], ['🎉', 'Celebrate']];
  var POKE = '👋';
  var ROOM_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
  var KEY_RE = /^([A-Z][A-Z0-9]{1,9}-\d{1,7})(?=$|[\s:.,\-–—])[\s:.,\-–—]*/;
  var KEY_ONLY = /^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/;
  var GRACE = 2 * 60 * 1000;
  var ADJ = ['brisk', 'calm', 'clever', 'eager', 'fuzzy', 'gentle', 'jolly', 'lucky', 'mellow', 'nimble', 'plucky', 'quiet', 'rapid', 'sunny', 'tidy', 'witty'];
  var NOUN = ['heron', 'otter', 'badger', 'falcon', 'lynx', 'marten', 'osprey', 'panda', 'quokka', 'raven', 'tapir', 'walrus', 'yak', 'zebra', 'gecko', 'bison'];
  var LIB_XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var LIB_QR = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';

  var ICON = {
    down: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M6 13l6 6 6-6"/></svg>',
    up: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>',
    moon: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    off: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 5.2-2.7"/><path d="M19 12.9a10 10 0 0 0-2.1-1.4"/><path d="M2 8.8a15 15 0 0 1 4.2-2.6"/><path d="M22 8.8a15 15 0 0 0-11.3-3.7"/><path d="M12 20h.01"/></svg>',
    eye: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    cup: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 3v3"/><path d="M12 3v3"/></svg>',
    cupSmall: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17"/></svg>',
    reveal: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    timer: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9 2h6"/></svg>',
    again: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-3.9L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 13a8 8 0 0 0 14.9 3.9l1.1-1.4"/><path d="M20 20v-4.5h-4.5"/></svg>',
    tick: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
    x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    copy: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
    download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>',
    sheet: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M9 4v16"/></svg>',
    bolt: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>',
    hide: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4"/><path d="M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'
  };

  // ---------- basics ----------
  var $ = function (s) { return document.querySelector(s); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  function clip(v, n) {
    if (typeof v !== 'string') return '';
    var s = Array.from(v.replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b\u200c\u200e\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ' ').replace(/\s+/g, ' ').trim());
    return s.length > n ? s.slice(0, n - 1).join('') + '…' : s.join('');
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function newCode() { return pick(ADJ) + '-' + pick(NOUN) + '-' + (10 + Math.floor(Math.random() * 90)); }
  function cleanCode(v) {
    return String(v || '').trim().toLowerCase().replace(/[\s_.]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+/, '').slice(0, 48);
  }
  function codeFrom(input) {
    var s = String(input || '').trim();
    var i = s.indexOf('#');
    if (i >= 0) s = s.slice(i + 1);
    else if (/^https?:\/\//i.test(s)) s = '';
    try { s = decodeURIComponent(s); } catch (e) {}
    return cleanCode(s);
  }
  function num(v) { return v === '½' ? 0.5 : (/^\d+$/.test(v) ? Number(v) : null); }
  function fmt(n) { return String(Math.round(n * 10) / 10); }
  function len(v) { return Array.from(v).length; }
  function calm() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function mmss(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function dur(sec) { if (typeof sec !== 'number') return ''; return sec < 60 ? sec + ' s' : Math.round(sec / 60) + ' min'; }
  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function splitKey(story) {
    var s = String(story || '');
    var m = s.match(KEY_RE);
    if (!m) return { key: '', title: s };
    var rest = s.slice(m[0].length).trim();
    return { key: m[1], title: rest };
  }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.slice(0, 2) === 'on') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  function svg(markup) { var t = document.createElement('template'); t.innerHTML = markup; return t.content.firstChild; }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }
  var lastLive = '';
  function announce(msg) { if (msg !== lastLive) { lastLive = msg; $('#live').textContent = msg; } }

  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
      toast(ok ? okMsg : 'Couldn’t copy');
    }
    try { navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback); }
    catch (e) { fallback(); }
  }
  function download(name, text, type) {
    try {
      var blob = new Blob([text], { type: type || 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = h('a', { href: url, download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (e) { toast('Couldn’t download'); }
  }
  var libs = {};
  function loadScript(src) {
    if (!libs[src]) libs[src] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = true; s.onload = res; s.onerror = function () { delete libs[src]; rej(new Error('load')); };
      document.head.append(s);
    });
    return libs[src];
  }

  function friendly(e) {
    var m = (e && e.message) || '';
    var c = e && e.code;
    if (c === 'PGRST202') return 'The database needs an update. See the README.';
    if (c === 'P0002' || /no game with that code/i.test(m)) return 'No game with that code';
    if (/anonymous sign-ins are disabled/i.test(m)) return 'Anonymous sign-ins are off in Supabase';
    if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Can’t reach the server. Check your connection.';
    if (/rate limit/i.test(m)) return 'Too many sign-ins from this network. Try again soon.';
    return m || 'Something went wrong';
  }

  // ---------- Supabase ----------
  var Theme = window.PokerTheme || { brand: { appName: 'Planning poker' }, themes: function () { return []; }, theme: function () { return ''; }, mode: function () { return 'auto'; }, resolvedMode: function () { return 'light'; }, setTheme: function () {}, setMode: function () {}, onChange: function () {} };
  var brand = Theme.brand;
  var cfg = window.POKER_CONFIG || {};
  var configured = typeof cfg.supabaseUrl === 'string' && /^https?:\/\//.test(cfg.supabaseUrl) &&
    typeof cfg.supabaseAnonKey === 'string' && cfg.supabaseAnonKey.length > 20 && !/YOUR[-_]/i.test(cfg.supabaseUrl + cfg.supabaseAnonKey);
  var sb = (configured && window.supabase && window.supabase.createClient) ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

  async function ensureUser() {
    var got = await sb.auth.getSession();
    var session = got.data && got.data.session;
    if (!session) {
      var res = await sb.auth.signInAnonymously();
      if (res.error) throw res.error;
      session = res.data.session;
    }
    if (sb.realtime && typeof sb.realtime.setAuth === 'function') sb.realtime.setAuth(session.access_token);
    uid = session.user.id;
    return session.user;
  }

  // ---------- state ----------
  var uid = null, code = '', room = null;
  var players = new Map();
  var online = null;               // Map user_id -> visible (true/false); null until presence syncs
  var offlineSince = new Map();    // user_id -> ms when they dropped out of presence
  var votes = new Map(), votesRound = -1, votesLoaded = -1, votesReq = 0;
  var hist = [], histVersion = -1, histReq = 0;
  var queue = [], queueVersion = -1, queueReq = 0;
  var myVote = null, votePending = 0;
  var me = { name: '', spec: false };
  var channel = null, channelReady = false, onTable = false, sess = 0, connState = 'idle';
  var seenUnrevealed = -1, confettiRound = -1, autoKey = '', autoTimer = null, lastSend = 0, lastHeard = {};
  var newOpts = { deck: 'fib', auto: true, anon: false };
  var drafts = [];                 // stories collected before a new game exists
  var storiesDraftMode = false;
  var pending = null;              // parsed import awaiting confirmation

  function applyRoom(r) {
    if (!r || r.code !== code) return;
    if (room && typeof r.version === 'number' && r.version < room.version) return;
    var prev = room;
    room = {
      code: r.code, title: r.title || '', round: r.round, revealed: !!r.revealed, story: r.story || '',
      deck: DECKS[r.deck] ? r.deck : 'fib', final: r.final || null,
      hist_version: r.hist_version || 0, queue_version: r.queue_version || 0, version: r.version || 0,
      auto_reveal: !!r.auto_reveal, anonymous: !!r.anonymous,
      timer_ends_at: r.timer_ends_at ? Date.parse(r.timer_ends_at) : null, story_rounds: r.story_rounds || 1
    };
    if (!prev || prev.round !== room.round) {
      votes = new Map(); votesRound = -1; votesLoaded = -1;
      if (prev) myVote = null;
    }
    if (!prev || prev.title !== room.title) rememberGame();
    if (room.revealed && votesRound !== room.round) loadVotes();
    if (histVersion !== room.hist_version) loadHistory();
    if (queueVersion !== room.queue_version) loadQueue();
  }

  async function loadRoom() {
    var res = await sb.from('rooms').select('*').eq('code', code).maybeSingle();
    if (!res.error && res.data) { applyRoom(res.data); render(); }
  }
  async function loadPlayers() {
    var my = sess;
    var res = await sb.from('players').select('user_id,name,spectator,voted_round').eq('room_code', code);
    if (my !== sess || res.error) return;
    players = new Map(res.data.map(function (p) { return [p.user_id, p]; }));
    render();
  }
  async function loadVotes() {
    var rnd = room.round, req = ++votesReq;
    votesRound = rnd;
    var res = await sb.from('votes').select('user_id,value').eq('room_code', code).eq('round', rnd);
    if (req !== votesReq) return;
    if (res.error) { votesRound = -1; return; }
    if (!room || room.round !== rnd) return;
    votes = new Map(res.data.map(function (v) { return [v.user_id, v.value]; }));
    votesLoaded = rnd;
    render();
  }
  async function loadHistory() {
    var want = room ? room.hist_version : 0, req = ++histReq;
    var res = await sb.from('history').select('story,estimate,rounds,seconds,consensus').eq('room_code', code)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(500);
    if (req !== histReq || res.error) return;
    hist = res.data; histVersion = want;
    rememberGame();
    render(); renderStories();
  }
  async function loadQueue() {
    var want = room ? room.queue_version : 0, req = ++queueReq;
    var res = await sb.from('queue').select('id,story').eq('room_code', code)
      .order('position', { ascending: true }).order('id', { ascending: true }).limit(200);
    if (req !== queueReq || res.error) return;
    queue = res.data; queueVersion = want;
    render(); renderStories();
  }
  async function loadMyVote() {
    if (!room || votePending) return;
    var rnd = room.round;
    var res = await sb.from('votes').select('value').eq('room_code', code).eq('round', rnd).eq('user_id', uid).maybeSingle();
    if (res.error || votePending || !room || room.round !== rnd) return;
    myVote = res.data ? res.data.value : null;
    render();
  }
  function resync() { loadRoom(); loadPlayers(); loadMyVote(); }

  // ---------- realtime ----------
  function trackMe() {
    if (channel && channelReady) channel.track({ v: document.visibilityState === 'hidden' ? 0 : 1 });
  }
  function syncPresence() {
    var st = channel.presenceState();
    var now = Date.now();
    var next = new Map();
    Object.keys(st).forEach(function (k) {
      var metas = st[k] || [];
      next.set(k, metas.some(function (m) { return !m || m.v !== 0; }));
    });
    if (online) online.forEach(function (_, k) { if (!next.has(k)) offlineSince.set(k, now); });
    next.forEach(function (_, k) { offlineSince.delete(k); });
    online = next;
    render();
  }
  function subscribe(my) {
    channelReady = false;
    channel = sb.channel('poker-' + code, { config: { presence: { key: uid }, broadcast: { self: false } } });
    channel
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: 'code=eq.' + code }, function (p) {
        if (my !== sess) return;
        applyRoom(p.new); render();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: 'room_code=eq.' + code }, function (p) {
        if (my !== sess || !p.new || !p.new.user_id) return;
        players.set(p.new.user_id, p.new); render();
      })
      .on('presence', { event: 'sync' }, function () { if (my === sess) syncPresence(); })
      .on('broadcast', { event: 'react' }, function (msg) { if (my === sess) heard(msg && msg.payload); })
      .subscribe(function (status) {
        if (my !== sess) return;
        if (status === 'SUBSCRIBED') { channelReady = true; setConn('live'); trackMe(); resync(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConn('connecting');
        else if (status === 'CLOSED') setConn('offline');
      });
  }
  function setConn(s) {
    connState = s;
    var d = $('#connDot');
    d.className = 'dot' + (s === 'live' ? ' live' : s === 'offline' ? ' offline' : '');
    $('#roomPill').setAttribute('aria-label', (s === 'live' ? 'Live' : s === 'offline' ? 'Offline' : 'Connecting') + '. Invite');
    var b = $('#banner');
    b.textContent = s === 'offline' ? 'Disconnected. Reload to rejoin.' : '';
    b.hidden = s !== 'offline';
  }

  // ---------- calls ----------
  async function rpc(fn, args) {
    var res = await sb.rpc(fn, Object.assign({ p_code: code }, args || {}));
    if (res.error) { toast(friendly(res.error)); resync(); return null; }
    return res.data || true;
  }
  function useRoom(r) { if (r && typeof r === 'object' && r.code) { applyRoom(r); render(); } return r; }

  function vote(v) {
    if (!room || room.revealed || me.spec) return;
    var next = myVote === v ? null : v;
    myVote = next; render();
    votePending++;
    rpc('cast_vote', { p_value: next }).then(function () { votePending--; });
  }
  function reveal() { if (room && !room.revealed) rpc('reveal_round').then(useRoom); }
  function voteAgain() { rpc('start_round', { p_save: false, p_estimate: null }).then(useRoom); }
  function setFinal(v) { rpc('set_final', { p_value: room.final === v ? null : v }).then(useRoom); }
  function nextStory() {
    var st = stats(seatList().filter(function (p) { return p.v; }), room.deck);
    var v = room.final || st.suggestion || '—';
    rpc('start_round', { p_save: true, p_estimate: v }).then(function (r) {
      if (!r) return;
      useRoom(r);
      toast('Saved: ' + v);
    });
  }
  function toggleTimer() {
    var running = room.timer_ends_at && room.timer_ends_at > Date.now();
    rpc('start_timer', { p_seconds: running ? 0 : 120 }).then(useRoom);
  }
  async function queueStories(list) {
    var added = 0;
    for (var i = 0; i < list.length; i += 50) {
      var r = await rpc('queue_add', { p_stories: list.slice(i, i + 50) });
      if (!r) break;
      useRoom(r);
      added += Math.min(50, list.length - i);
    }
    return added;
  }

  function clearAuto() { if (autoTimer) clearTimeout(autoTimer); autoTimer = null; autoKey = ''; }
  function maybeAutoReveal(list) {
    if (!room.auto_reveal || room.revealed) { clearAuto(); return; }
    var voters = list.filter(function (p) { return !p.spec && p.presence !== 'off'; });
    if (voters.length < 2 || !voters.every(function (p) { return p.ready; })) { clearAuto(); return; }
    var key = room.round + '|' + voters.map(function (p) { return p.peer; }).join(',');
    if (key === autoKey && autoTimer) return;
    clearAuto();
    autoKey = key;
    var leader = voters.map(function (p) { return p.peer; }).sort()[0];
    function fire() {
      if (votePending) { autoTimer = setTimeout(fire, 400); return; }
      autoTimer = null;
      if (room && !room.revealed) reveal();
    }
    autoTimer = setTimeout(fire, leader === uid ? 1200 : 4000);
  }

  // ---------- reactions & nudges ----------
  var seatEls = new Map();
  function floatAt(peer, emoji) {
    if (calm()) return;
    var el = seatEls.get(peer);
    if (!el) return;
    var r = el.getBoundingClientRect();
    var f = h('span', { class: 'float', 'aria-hidden': 'true' }, emoji);
    f.style.left = (r.left + r.width / 2) + 'px';
    f.style.top = (r.top - 6) + 'px';
    document.body.append(f);
    setTimeout(function () { f.remove(); }, 1600);
  }
  function send(emoji, to) {
    var now = Date.now();
    if (now - lastSend < 600 || !channel) return false;
    lastSend = now;
    channel.send({ type: 'broadcast', event: 'react', payload: { from: uid, emoji: emoji, to: to || null } });
    return true;
  }
  function react(emoji) { if (send(emoji)) floatAt(uid, emoji); closeTray(); }
  function poke(peer) {
    var p = players.get(peer);
    if (!p || peer === uid) return;
    if (send(POKE, peer)) { floatAt(peer, POKE); toast('Nudged ' + clip(p.name, 24)); }
  }
  function heard(p) {
    if (!p || typeof p.from !== 'string' || !players.has(p.from)) return;
    var ok = p.emoji === POKE || REACTS.some(function (r) { return r[0] === p.emoji; });
    if (!ok) return;
    var now = Date.now();
    if (now - (lastHeard[p.from] || 0) < 300) return;
    lastHeard[p.from] = now;
    var who = clip(players.get(p.from).name, 24) || 'Someone';
    if (p.emoji === POKE && typeof p.to === 'string') {
      floatAt(p.to, POKE);
      if (p.to === uid) {
        var hand = $('#hand');
        hand.classList.remove('nudged'); void hand.offsetWidth; hand.classList.add('nudged');
        setTimeout(function () { hand.classList.remove('nudged'); }, 1100);
        toast(who + ' nudged you');
      }
    } else floatAt(p.from, p.emoji);
  }
  function confetti() {
    if (calm()) return;
    var box = h('div', { class: 'confetti', 'aria-hidden': 'true' });
    var colors = ['var(--accent)', 'var(--card-red)', 'var(--table)', 'var(--card)', 'var(--rail)'];
    for (var i = 0; i < 32; i++) {
      var bit = h('i');
      bit.style.left = (Math.random() * 100) + '%';
      bit.style.background = colors[i % colors.length];
      bit.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px');
      bit.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
      bit.style.animationDelay = (Math.random() * 0.25) + 's';
      box.append(bit);
    }
    document.body.append(box);
    setTimeout(function () { box.remove(); }, 2200);
  }

  // ---------- players & scoring ----------
  function seatList() {
    var out = [], now = Date.now();
    players.forEach(function (p, id) {
      var isMe = id === uid;
      var presence;
      if (isMe || !online) presence = 'live';
      else if (online.has(id)) presence = online.get(id) ? 'live' : 'away';
      else if (offlineSince.has(id) && now - offlineSince.get(id) < GRACE) presence = 'off';
      var spec = isMe ? me.spec : !!p.spectator;
      var v = (room.revealed && !spec) ? (votes.get(id) || null) : null;
      var ready = !spec && (isMe ? !!myVote : p.voted_round === room.round);
      if (!presence) {
        if (v || (ready && !room.revealed)) presence = 'off';
        else return;
      }
      var name = isMe ? me.name : (clip(p.name, 24) || 'Someone');
      out.push({ peer: id, isMe: isMe, spec: spec, v: v, ready: ready, presence: presence, name: name });
    });
    if (uid && !players.has(uid)) out.push({ peer: uid, isMe: true, spec: me.spec, v: null, ready: !me.spec && !!myVote, presence: 'live', name: me.name });
    out.sort(function (a, b) {
      return ((a.spec ? 1 : 0) - (b.spec ? 1 : 0)) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.peer < b.peer ? -1 : 1);
    });
    return out;
  }

  function stats(list, deck) {
    var cards = DECKS[deck].cards;
    var counts = {};
    list.forEach(function (x) { counts[x.v] = (counts[x.v] || 0) + 1; });
    var dist = cards.filter(function (c) { return counts[c]; }).map(function (c) { return { v: c, n: counts[c] }; });
    var real = list.filter(function (x) { return !SPECIAL[x.v]; });
    var distinct = {};
    real.forEach(function (x) { distinct[x.v] = 1; });
    var res = { dist: dist, avg: null, suggestion: null, lo: null, hi: null, realCount: real.length, consensus: real.length > 0 && Object.keys(distinct).length === 1 };
    if (!real.length) return res;
    var rank;
    if (deck !== 'tshirt') {
      var nums = real.map(function (x) { return num(x.v); });
      res.avg = nums.reduce(function (a, b) { return a + b; }, 0) / nums.length;
      var best = null;
      cards.forEach(function (c) {
        var n = num(c);
        if (n === null) return;
        var d = Math.abs(n - res.avg);
        if (!best || d <= best.d + 1e-9) best = { c: c, d: d };
      });
      res.suggestion = best.c;
      rank = function (v) { return num(v); };
    } else {
      var top = null;
      dist.forEach(function (d) { if (!SPECIAL[d.v] && (!top || d.n >= top.n)) top = d; });
      res.suggestion = top.v;
      rank = function (v) { return cards.indexOf(v); };
    }
    var ranks = real.map(function (x) { return rank(x.v); });
    var mn = Math.min.apply(null, ranks), mx = Math.max.apply(null, ranks);
    if (mn !== mx) {
      res.lo = real.filter(function (x) { return rank(x.v) === mn; });
      res.hi = real.filter(function (x) { return rank(x.v) === mx; });
    }
    return res;
  }
  function cardLabel(v) {
    if (v === '?') return 'Not sure';
    if (v === '☕') return 'Break';
    return room && room.deck === 'tshirt' ? 'Size ' + v : v + (v === '1' ? ' point' : ' points');
  }

  // ---------- rendering: table ----------
  var centerSig = '', handDeck = '', railSig = '';

  function makeSeat(pl) {
    var item = h('div', { role: 'listitem' });
    var box = pl.isMe ? h('div', { class: 'seat' }) : h('button', { type: 'button', class: 'seat', onclick: function () { poke(pl.peer); } });
    var mini = h('div', { class: 'mini', 'aria-hidden': 'true' });
    var inn = h('div', { class: 'mini-in' });
    var front = h('div', { class: 'face front' });
    inn.append(h('div', { class: 'face back' }), front);
    var watching = h('div', { class: 'watching', html: ICON.eye });
    var topB = h('span', { class: 'chip-badge top' });
    var botB = h('span', { class: 'chip-badge bottom' });
    mini.append(h('div', { class: 'slot' }), inn, watching, topB, botB);
    var dot = h('i');
    var nmText = h('span', { class: 't' });
    var nm = h('div', { class: 'nm' }, dot, nmText);
    box.append(mini, nm);
    item.append(box);
    item._box = box; item._in = inn; item._front = front; item._watch = watching;
    item._top = topB; item._bot = botB; item._dot = dot; item._name = nmText;
    return item;
  }

  function renderSeats(list, st) {
    var wrap = $('#seats');
    wrap.classList.toggle('compact', list.length > 9);
    var lo = {}, hi = {};
    if (st && st.lo && !room.anonymous) { st.lo.forEach(function (x) { lo[x.peer] = 1; }); st.hi.forEach(function (x) { hi[x.peer] = 1; }); }
    var order = [], keep = {}, flipIndex = 0;
    list.forEach(function (pl) {
      keep[pl.peer] = 1;
      var el = seatEls.get(pl.peer);
      if (!el) { el = makeSeat(pl); seatEls.set(pl.peer, el); }
      var b = el._box;
      var flip = room.revealed && !!pl.v && !room.anonymous;
      var shown = room.revealed ? !!pl.v : pl.ready;
      b.classList.toggle('voted', shown);
      b.classList.toggle('off', pl.presence === 'off');
      if (flip && !b.classList.contains('flipped')) el._in.style.transitionDelay = (flipIndex * 45) + 'ms';
      else if (!flip) el._in.style.transitionDelay = '0ms';
      if (flip) flipIndex++;
      el._front.textContent = flip ? pl.v : '';
      el._front.classList.toggle('red', flip && !!SPECIAL[pl.v]);
      el._front.setAttribute('data-len', flip ? String(len(pl.v)) : '1');
      b.classList.toggle('flipped', flip);
      var isLo = flip && lo[pl.peer], isHi = flip && hi[pl.peer];
      b.classList.toggle('edge', !!(isLo || isHi));
      el._watch.hidden = !pl.spec;
      el._top.hidden = !(isLo || isHi);
      if (isLo || isHi) el._top.innerHTML = isLo ? ICON.down : ICON.up;
      el._bot.hidden = pl.presence === 'live';
      if (pl.presence !== 'live') el._bot.innerHTML = pl.presence === 'away' ? ICON.moon : ICON.off;
      el._dot.hidden = !pl.isMe;
      el._name.textContent = pl.name;
      var state = pl.spec ? 'watching' : room.revealed ? (flip ? cardLabel(pl.v) : pl.v ? 'voted' : 'no vote') : (pl.ready ? 'ready' : 'thinking');
      var extra = [isLo ? 'lowest' : '', isHi ? 'highest' : '', pl.presence === 'away' ? 'away' : '', pl.presence === 'off' ? 'offline' : ''].filter(Boolean).join(', ');
      var label = pl.name + (pl.isMe ? ' (you)' : '') + ': ' + state + (extra ? ', ' + extra : '');
      b.setAttribute('aria-label', pl.isMe ? label : 'Nudge ' + label);
      order.push(el);
    });
    seatEls.forEach(function (el, k) { if (!keep[k]) { el.remove(); seatEls.delete(k); } });
    order.forEach(function (el, i) { if (wrap.children[i] !== el) wrap.insertBefore(el, wrap.children[i] || null); });
  }

  function renderCenter(list, st) {
    var voters = list.filter(function (p) { return !p.spec && p.presence !== 'off'; });
    var ready = voters.filter(function (p) { return p.ready; });
    var anyReady = list.some(function (p) { return p.ready; });
    var shown = list.filter(function (p) { return p.v; });
    var running = !!(room.timer_ends_at && room.timer_ends_at > Date.now());
    var sig = JSON.stringify([room.revealed, room.final, room.deck, room.anonymous, room.auto_reveal, room.timer_ends_at, running,
      voters.length, ready.length, anyReady, votesLoaded === room.round,
      room.revealed ? shown.map(function (p) { return [p.peer, p.v]; }) : 0]);
    if (sig === centerSig) return;
    centerSig = sig;
    var c = $('#center');
    var act = c.contains(document.activeElement) ? document.activeElement.getAttribute('data-act') : null;
    c.replaceChildren();

    if (!room.revealed) {
      var all = ready.length > 0 && ready.length === voters.length;
      var countTxt = voters.length ? ready.length + '/' + voters.length : '0';
      var btn = h('button', { type: 'button', class: 'reveal' + (all ? ' ready' : ''), 'data-act': 'reveal', onclick: reveal }, svg(ICON.reveal), 'Reveal');
      btn.disabled = !anyReady;
      c.append(h('div', { class: 'count', 'aria-label': ready.length + ' of ' + voters.length + ' voted' }, countTxt), btn);
      announce(ready.length + ' of ' + voters.length + ' voted');
    } else if (votesLoaded !== room.round) {
      c.append(h('div', { class: 'count' }, '…'));
    } else {
      var value = room.final || st.suggestion || '—';
      var card = h('div', { class: 'result-card' + (len(value) > 2 ? ' long' : ''), 'aria-label': (room.final ? 'Agreed ' : 'Suggested ') + value }, value);
      var side = h('div', { class: 'result-side' });
      if (st.avg !== null && st.realCount > 1) side.append(h('div', { class: 'avg' }, 'avg ' + fmt(st.avg)));
      var dist = h('div', { class: 'dist', role: 'group', 'aria-label': 'Votes. Pick one to agree on it.' });
      st.dist.forEach(function (d) {
        var special = !!SPECIAL[d.v];
        var b = h('button', { type: 'button', class: 'dchip' + (special ? ' red' : ''), 'data-act': 'fin-' + d.v,
          'aria-pressed': String(room.final === d.v), 'aria-label': cardLabel(d.v) + ', ' + d.n + (d.n === 1 ? ' vote' : ' votes') },
          d.v === '☕' ? h('b', { html: ICON.cupSmall }) : h('b', null, d.v), h('small', { 'aria-hidden': 'true' }, '•'.repeat(Math.min(d.n, 9))));
        if (special) b.disabled = true; else b.onclick = function () { setFinal(d.v); };
        dist.append(b);
      });
      side.append(dist);
      c.append(h('div', { class: 'result' }, card, side));

      var actions = h('div', { class: 'actions' });
      if (!st.consensus && st.realCount >= 2) {
        var tLeft = running ? room.timer_ends_at - Date.now() : 0;
        var done = !!(room.timer_ends_at && !running);
        actions.append(h('button', { type: 'button', class: 'btn soft timer' + (done ? ' done' : ''), 'data-act': 'timer', onclick: toggleTimer,
          'aria-label': running ? 'Stop timer' : 'Start a 2 minute timer' }, svg(ICON.timer), h('span', { id: 'timerTxt' }, running ? mmss(tLeft) : done ? '0:00' : '2:00')));
      }
      actions.append(
        h('button', { type: 'button', class: 'btn soft', 'data-act': 'again', onclick: voteAgain }, svg(ICON.again), 'Re-vote'),
        h('button', { type: 'button', class: 'btn accent', 'data-act': 'next', onclick: nextStory }, 'Next')
      );
      c.append(actions);
      announce('Cards revealed. ' + (room.final ? 'Agreed ' : 'Suggested ') + value);
    }
    if (act) { var f = c.querySelector('[data-act="' + CSS.escape(act) + '"]'); if (f) f.focus(); }
  }

  function renderHand() {
    var row = $('#handRow');
    if (handDeck !== room.deck) {
      handDeck = room.deck;
      row.replaceChildren();
      DECKS[room.deck].cards.forEach(function (v) {
        var b = h('button', { type: 'button', class: 'hcard' + (SPECIAL[v] ? ' red' : ''), 'data-v': v, 'data-len': String(len(v)),
          'aria-label': cardLabel(v), 'aria-pressed': 'false', onclick: function () { vote(v); } });
        if (v === '☕') b.innerHTML = ICON.cup; else b.textContent = v;
        row.append(b);
      });
    }
    var locked = room.revealed || me.spec;
    Array.prototype.forEach.call(row.children, function (b) {
      var on = b.getAttribute('data-v') === myVote;
      b.classList.toggle('sel', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.disabled = locked;
    });
    $('#watchBtn').setAttribute('aria-pressed', me.spec ? 'true' : 'false');
  }

  function renderRail() {
    var sig = JSON.stringify([queue.map(function (q) { return q.story; }).slice(0, 6), queue.length, hist.map(function (x) { return [x.story, x.estimate]; })]);
    var badge = $('#queueBadge');
    badge.textContent = queue.length > 99 ? '99+' : String(queue.length);
    badge.hidden = !queue.length;
    $('#queueBtn').setAttribute('aria-label', 'Stories' + (queue.length ? ', ' + queue.length + ' up next' : ''));
    if (sig === railSig) return;
    railSig = sig;
    var rail = $('#rail');
    rail.replaceChildren();
    var up = h('section', { class: 'rail-card', 'aria-label': 'Up next' },
      h('div', { class: 'rail-head' }, h('h2', null, 'Up next'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Add stories', html: ICON.plus, onclick: function () { openStories(false); } })));
    var ul = h('ul');
    if (!queue.length) up.append(h('div', { class: 'empty' }, 'Nothing queued'));
    queue.slice(0, 6).forEach(function (q) { ul.append(h('li', null, h('span', null, q.story))); });
    if (queue.length > 6) ul.append(h('li', null, h('span', { class: 'muted' }, '+' + (queue.length - 6))));
    up.append(ul);
    var pts = 0;
    hist.forEach(function (x) { var n = num(x.estimate); if (n !== null) pts += n; });
    var done = h('section', { class: 'rail-card', 'aria-label': 'Done' },
      h('div', { class: 'rail-head' }, h('h2', null, 'Done'),
        hist.length ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Copy summary', html: ICON.copy, onclick: copySummary }) : h('span', { class: 'muted' }, '')));
    var dl = h('ul');
    if (!hist.length) done.append(h('div', { class: 'empty' }, 'No stories yet'));
    hist.slice(-8).forEach(function (x) { dl.append(h('li', null, h('span', null, x.story), h('span', { class: 'est' }, x.estimate))); });
    done.append(dl);
    if (hist.length) done.append(h('div', { class: 'empty', style: 'padding-top:2px' }, hist.length + (hist.length === 1 ? ' story' : ' stories') + (pts ? ', ' + fmt(pts) + ' pts' : '')));
    rail.append(up, done);
  }

  function render() {
    if (!onTable || !room) return;
    $('#roomCode').textContent = code;
    var storyIn = $('#story');
    if (document.activeElement !== storyIn && storyIn.value !== room.story) storyIn.value = room.story;
    var list = seatList();
    var st = room.revealed ? stats(list.filter(function (p) { return p.v; }), room.deck) : null;
    if (!room.revealed) seenUnrevealed = room.round;
    renderSeats(list, st);
    renderCenter(list, st);
    renderHand();
    renderRail();
    maybeAutoReveal(list);
    if (st && votesLoaded === room.round && st.consensus && st.realCount >= 2 && seenUnrevealed === room.round && confettiRound !== room.round) {
      confettiRound = room.round;
      confetti();
    }
    if ($('#settingsDlg').open) renderSettings();
  }

  setInterval(function () {
    if (!onTable || !room) return;
    var t = $('#timerTxt');
    if (room.timer_ends_at && room.revealed) {
      var left = room.timer_ends_at - Date.now();
      if (left <= 0 && t && t.textContent !== '0:00') { centerSig = ''; render(); }
      else if (t && left > 0) t.textContent = mmss(left);
    }
  }, 1000);
  setInterval(function () { if (onTable && room && offlineSince.size) render(); }, 10000);

  // ---------- reactions tray ----------
  function closeTray() { $('#tray').hidden = true; $('#reactBtn').setAttribute('aria-expanded', 'false'); }
  REACTS.forEach(function (r) {
    $('#tray').append(h('button', { type: 'button', 'aria-label': r[1], onclick: function () { react(r[0]); } }, r[0]));
  });
  $('#reactBtn').addEventListener('click', function () {
    var t = $('#tray');
    t.hidden = !t.hidden;
    $('#reactBtn').setAttribute('aria-expanded', t.hidden ? 'false' : 'true');
  });
  document.addEventListener('click', function (e) {
    if (!$('#tray').hidden && !e.target.closest('#tray') && !e.target.closest('#reactBtn')) closeTray();
  });

  // ---------- dialogs ----------
  function openSheet(d) {
    if (d.open) return;
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }
  function closeSheet(d) {
    if (typeof d.close === 'function') d.close();
    else if (d.hasAttribute('open')) { d.removeAttribute('open'); d.dispatchEvent(new Event('close')); }
  }
  document.querySelectorAll('dialog').forEach(function (d) {
    d.addEventListener('click', function (e) { if (e.target === d) closeSheet(d); });
    if (typeof d.showModal !== 'function') {
      var f = d.querySelector('form[method="dialog"]');
      if (f) f.addEventListener('submit', function (e) { e.preventDefault(); closeSheet(d); });
    }
  });

  function deckChips(wrap, current, onPick) {
    wrap.replaceChildren();
    Object.keys(DECKS).forEach(function (k) {
      wrap.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(k === current), onclick: function () { onPick(k); } }, DECKS[k].label));
    });
  }
  function toggleRows(wrap, items) {
    wrap.replaceChildren();
    items.forEach(function (o) {
      wrap.append(h('button', { type: 'button', class: 'toggle', role: 'switch', 'aria-checked': String(!!o.on), onclick: o.flip },
        svg(o.icon), h('span', { class: 't' }, o.name), h('span', { class: 'switch', 'aria-hidden': 'true' })));
    });
  }

  // settings
  function renderSettings() {
    var list = $('#themeList');
    list.replaceChildren();
    Theme.themes().forEach(function (t) {
      var sw = h('span', { class: 'sw', 'aria-hidden': 'true' }, h('i'));
      sw.style.background = t.table; sw.style.borderColor = t.rail;
      var chip = sw.firstChild; chip.style.background = t.card; chip.style.boxShadow = '4px 0 0 ' + t.accent;
      list.append(h('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-checked': String(t.id === Theme.theme()),
        onclick: function () { Theme.setTheme(t.id); renderSettings(); } }, sw, t.label));
    });
    document.querySelectorAll('#modeSeg button').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-mode') === Theme.mode())); });
    var showTable = onTable && !!room;
    $('#tableOpts').hidden = !showTable;
    $('#leaveBtn').hidden = !onTable;
    if (!showTable) return;
    deckChips($('#tableDecks'), room.deck, function (k) {
      if (k === room.deck) return;
      rpc('set_deck', { p_deck: k }).then(function (r) { if (r) { useRoom(r); toast('Deck changed'); } });
    });
    toggleRows($('#tableToggles'), [
      { name: 'Auto-flip', icon: ICON.bolt, on: room.auto_reveal, flip: function () { rpc('set_options', { p_auto_reveal: !room.auto_reveal, p_anonymous: null }).then(useRoom); } },
      { name: 'Hide names', icon: ICON.hide, on: room.anonymous, flip: function () { rpc('set_options', { p_auto_reveal: null, p_anonymous: !room.anonymous }).then(useRoom); } }
    ]);
  }
  document.querySelectorAll('#modeSeg button').forEach(function (b) {
    b.addEventListener('click', function () { Theme.setMode(b.getAttribute('data-mode')); renderSettings(); });
  });
  function openSettings() { renderSettings(); openSheet($('#settingsDlg')); }

  // new game
  function renderNew() {
    deckChips($('#newDecks'), newOpts.deck, function (k) { newOpts.deck = k; renderNew(); });
    toggleRows($('#newToggles'), [
      { name: 'Auto-flip', icon: ICON.bolt, on: newOpts.auto, flip: function () { newOpts.auto = !newOpts.auto; renderNew(); } },
      { name: 'Hide names', icon: ICON.hide, on: newOpts.anon, flip: function () { newOpts.anon = !newOpts.anon; renderNew(); } }
    ]);
    $('#newStoriesCount').textContent = drafts.length ? String(drafts.length) : 'Optional';
  }

  // invite
  var qrFor = '';
  function inviteLink() { return location.href.split('#')[0] + '#' + code; }
  async function renderQR() {
    var box = $('#qr');
    var link = inviteLink();
    if (qrFor === link) return;
    try {
      await loadScript(LIB_QR);
      var qr = window.qrcode(0, 'M');
      qr.addData(link);
      qr.make();
      var n = qr.getModuleCount(), d = '';
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (qr.isDark(y, x)) d += 'M' + x + ' ' + y + 'h1v1h-1z';
      box.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" aria-hidden="true"><path fill="#0E1830" d="' + d + '"/></svg>';
      box.hidden = false;
      qrFor = link;
    } catch (e) { box.hidden = true; }
  }
  function openInvite() {
    $('#inviteTitle').textContent = (room && room.title) || brand.appName;
    $('#inviteCode').textContent = code;
    $('#copyLinkLabel').textContent = 'Copy link';
    renderQR();
    openSheet($('#inviteDlg'));
  }
  $('#copyLinkBtn').addEventListener('click', function () { copyText(inviteLink(), 'Link copied'); $('#copyLinkLabel').textContent = 'Copied'; });
  $('#shareBtn').addEventListener('click', function () {
    var data = { title: (room && room.title) || brand.appName, url: inviteLink() };
    if (navigator.share) navigator.share(data).catch(function () {});
    else copyText(data.url, 'Link copied');
  });

  // ---------- stories: import ----------
  var HEADER_ANY = /^(issue ?key|key|id|ticket|issue id|summary|title|name|story|subject|description|issue type|status|story points?|priority|assignee)$/i;
  var HEADER_KEY = /^(issue ?key|key|ticket|issue id|id)$/i;
  var HEADER_TITLE = /^(summary|title|story|name|subject)$/i;

  function parseDelimited(text, delim) {
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function rowsFromPaste(text) {
    text = String(text || '').replace(/\r\n?/g, '\n');
    if (text.indexOf('\t') >= 0) return parseDelimited(text, '\t');
    return text.split('\n').map(function (l) { return [l]; });
  }
  function rowsFromCSV(text) {
    var first = (text.split(/\r?\n/)[0] || '');
    var counts = { ',': (first.match(/,/g) || []).length, ';': (first.match(/;/g) || []).length, '\t': (first.match(/\t/g) || []).length };
    var delim = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
    if (!counts[delim]) return text.split(/\r?\n/).map(function (l) { return [l]; });
    return parseDelimited(text, delim);
  }

  function buildPending(rows, source) {
    rows = rows.map(function (r) { return r.map(function (c) { return String(c == null ? '' : c).trim(); }); })
      .filter(function (r) { return r.some(function (c) { return c; }); });
    if (!rows.length) { toast('Nothing to add'); return; }
    var width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    var first = rows[0];
    var hasHeader = width > 1 && first.some(function (c) { return HEADER_ANY.test(c); });
    var data = hasHeader ? rows.slice(1) : rows;
    var cols = [];
    for (var i = 0; i < width; i++) cols.push((hasHeader && first[i]) ? first[i] : 'Column ' + String.fromCharCode(65 + (i % 26)));
    var keyCol = -1, titleCol = 0;
    if (width > 1) {
      if (hasHeader) {
        keyCol = first.findIndex(function (c) { return HEADER_KEY.test(c); });
        titleCol = first.findIndex(function (c, j) { return j !== keyCol && HEADER_TITLE.test(c); });
      }
      if (keyCol < 0) {
        for (var k = 0; k < width; k++) {
          var hits = data.filter(function (r) { return KEY_ONLY.test(r[k] || ''); }).length;
          if (data.length && hits / data.length >= 0.6) { keyCol = k; break; }
        }
      }
      if (titleCol < 0) {
        var bestLen = -1;
        for (var t = 0; t < width; t++) {
          if (t === keyCol) continue;
          var avg = data.reduce(function (s, r) { return s + (r[t] || '').length; }, 0) / Math.max(1, data.length);
          if (avg > bestLen) { bestLen = avg; titleCol = t; }
        }
      }
    }
    pending = { source: source, cols: cols, data: data, keyCol: keyCol, titleCol: titleCol, picks: {} };
    renderStories();
  }

  function existingIndex() {
    var keys = {}, texts = {};
    function add(s, tag) {
      var sk = splitKey(s);
      if (sk.key) keys[sk.key] = keys[sk.key] || tag;
      texts[norm(s)] = texts[norm(s)] || tag;
    }
    hist.forEach(function (x) { add(x.story, 'done'); });
    queue.forEach(function (q) { add(q.story, 'queued'); });
    drafts.forEach(function (s) { add(s, 'queued'); });
    if (room && room.story) add(room.story, 'now');
    return { keys: keys, texts: texts };
  }
  function pendingItems() {
    if (!pending) return [];
    var ex = existingIndex(), seen = {}, out = [];
    pending.data.forEach(function (r, i) {
      var key = pending.keyCol >= 0 ? (r[pending.keyCol] || '').trim() : '';
      var title = (r[pending.titleCol] || '').trim();
      if (!key) { var sk = splitKey(title); if (sk.key) { key = sk.key; title = sk.title; } }
      if (key && !KEY_ONLY.test(key)) { title = (key + ' ' + title).trim(); key = ''; }
      if (!title && !key) return;
      var story = clip(key ? key + (title ? ' ' + title : '') : title, 140);
      var n = norm(story);
      if (seen[n]) return;
      seen[n] = 1;
      var tag = (key && ex.keys[key]) || ex.texts[n] || '';
      var on = pending.picks[i] !== undefined ? pending.picks[i] : !tag;
      out.push({ i: i, key: key, title: title || key, story: story, tag: tag, on: on });
    });
    return out;
  }

  function renderStories() {
    var dlg = $('#storiesDlg');
    if (!dlg.open) return;
    var pbox = $('#pendingBox');
    var lists = $('#listsBox');
    if (pending) {
      pbox.hidden = false; lists.hidden = true;
      var items = pendingItems();
      var chips = $('#mapChips');
      chips.replaceChildren(h('span', { class: 'info-chip' }, svg(ICON.sheet), pending.source + ', ' + items.length + (items.length === 1 ? ' row' : ' rows')));
      if (pending.cols.length > 1) {
        var mk = function (label, val, allowNone, onPick) {
          var sel = h('select', { 'aria-label': label + ' column' });
          if (allowNone) sel.append(h('option', { value: '-1' }, 'None'));
          pending.cols.forEach(function (c, j) { var o = h('option', { value: String(j) }, clip(c, 24)); if (j === val) o.selected = true; sel.append(o); });
          if (val < 0 && allowNone) sel.value = '-1';
          sel.onchange = function () { onPick(Number(sel.value)); };
          return h('label', { class: 'map-chip' }, h('span', null, label), sel);
        };
        chips.append(
          mk('Key', pending.keyCol, true, function (v) { pending.keyCol = v; pending.picks = {}; renderStories(); }),
          mk('Title', pending.titleCol, false, function (v) { pending.titleCol = v; pending.picks = {}; renderStories(); })
        );
      }
      var rowsBox = $('#pendingRows');
      rowsBox.replaceChildren();
      items.forEach(function (it) {
        rowsBox.append(h('button', { type: 'button', class: 'row' + (it.on ? '' : ' off'), role: 'checkbox', 'aria-checked': String(it.on),
          onclick: function () { pending.picks[it.i] = !it.on; renderStories(); } },
          h('span', { class: 'tick', 'aria-hidden': 'true', html: it.on ? ICON.tick : '' }),
          it.key ? h('span', { class: 'key' }, it.key) : null,
          h('span', { class: 't' }, it.title),
          it.tag ? h('span', { class: 'tag' }, it.tag) : null));
      });
      var n = items.filter(function (x) { return x.on; }).length;
      var addBtn = $('#addPendingBtn');
      addBtn.textContent = n ? 'Add ' + n : 'Add';
      addBtn.disabled = !n;
      return;
    }
    pbox.hidden = true; lists.hidden = false;
    lists.replaceChildren();
    var upItems = storiesDraftMode ? drafts.map(function (s, i) { return { story: s, remove: function () { drafts.splice(i, 1); renderStories(); renderNew(); } }; })
      : queue.map(function (q) { return { story: q.story, remove: function () { rpc('queue_remove', { p_id: q.id }).then(useRoom); } }; });
    var head = h('div', { class: 'list-head' }, h('h3', null, 'Up next' + (upItems.length ? ' (' + upItems.length + ')' : '')));
    if (upItems.length && !storiesDraftMode) head.append(h('button', { type: 'button', class: 'linkish', onclick: function () { rpc('queue_remove', { p_id: null }).then(useRoom); } }, 'Clear'));
    lists.append(head);
    if (!upItems.length) lists.append(h('p', { class: 'empty-note' }, 'Nothing queued'));
    upItems.forEach(function (u) {
      var sk = splitKey(u.story);
      lists.append(h('div', { class: 'qitem' }, sk.key ? h('span', { class: 'key' }, sk.key) : null, h('span', { class: 't' }, sk.key ? (sk.title || sk.key) : u.story),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove ' + u.story, html: ICON.x, onclick: u.remove })));
    });
    if (storiesDraftMode || !hist.length) return;
    lists.append(h('div', { style: 'height:18px' }));
    lists.append(h('div', { class: 'list-head' }, h('h3', null, 'Done (' + hist.length + ')'),
      h('span', { class: 'acts' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Copy summary', html: ICON.copy, onclick: copySummary }),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Export CSV', html: ICON.download, onclick: exportCSV }))));
    hist.forEach(function (x) {
      var sk = splitKey(x.story);
      lists.append(h('div', { class: 'qitem' }, sk.key ? h('span', { class: 'key' }, sk.key) : null,
        h('span', { class: 't' }, sk.key ? (sk.title || sk.key) : x.story), h('span', { class: 'est' }, x.estimate)));
    });
  }

  function openStories(draft) {
    storiesDraftMode = !!draft;
    pending = null;
    $('#typeStory').value = '';
    openSheet($('#storiesDlg'));
    renderStories();
  }
  async function commitStories(list) {
    if (!list.length) return;
    if (storiesDraftMode) {
      list.forEach(function (s) { drafts.push(s); });
      toast('Added ' + list.length);
      renderNew();
    } else {
      var n = await queueStories(list);
      if (n) toast('Added ' + n);
    }
    pending = null;
    renderStories();
  }
  function readFile(file, asBuffer) {
    if (asBuffer && typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    if (!asBuffer && typeof file.text === 'function') return file.text();
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      if (asBuffer) r.readAsArrayBuffer(file); else r.readAsText(file);
    });
  }
  async function handleFile(file) {
    if (!file) return;
    var name = clip(file.name || 'file', 28);
    try {
      if (/\.xlsx?$/i.test(file.name || '')) {
        await loadScript(LIB_XLSX);
        var wb = window.XLSX.read(await readFile(file, true), { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        buildPending(window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, blankrows: false, defval: '' }), name);
      } else {
        buildPending(rowsFromCSV(await readFile(file, false)), name);
      }
    } catch (e) { toast('Couldn’t read that file'); }
  }

  $('#typeStory').addEventListener('paste', function (e) {
    var text = (e.clipboardData || window.clipboardData).getData('text');
    if (/[\n\t]/.test(text.trim())) { e.preventDefault(); buildPending(rowsFromPaste(text), 'Pasted'); }
  });
  function addTyped() {
    var v = clip($('#typeStory').value, 140);
    if (!v) return;
    $('#typeStory').value = '';
    commitStories([v]);
  }
  $('#typeStory').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } });
  $('#typeAddBtn').addEventListener('click', addTyped);
  $('#pasteBtn').addEventListener('click', async function () {
    try {
      var text = await navigator.clipboard.readText();
      if (!text.trim()) { toast('Clipboard is empty'); return; }
      buildPending(rowsFromPaste(text), 'Pasted');
    } catch (e) { $('#typeStory').focus(); toast('Press Ctrl+V or long-press to paste'); }
  });
  $('#fileBtn').addEventListener('click', function () { $('#fileInput').click(); });
  $('#fileInput').addEventListener('change', function (e) { handleFile(e.target.files[0]); e.target.value = ''; });
  (function () {
    var body = $('#storiesBody'), tile = $('#fileBtn');
    body.addEventListener('dragover', function (e) { e.preventDefault(); tile.classList.add('drag'); });
    body.addEventListener('dragleave', function () { tile.classList.remove('drag'); });
    body.addEventListener('drop', function (e) { e.preventDefault(); tile.classList.remove('drag'); handleFile(e.dataTransfer.files[0]); });
  })();
  $('#clearPendingBtn').addEventListener('click', function () { pending = null; renderStories(); });
  $('#addPendingBtn').addEventListener('click', function () {
    commitStories(pendingItems().filter(function (x) { return x.on; }).map(function (x) { return x.story; }));
  });

  function summaryText() {
    var n = hist.length, pts = 0, anyNum = false, agreed = 0;
    hist.forEach(function (x) { var v = num(x.estimate); if (v !== null) { pts += v; anyNum = true; } if (x.consensus) agreed++; });
    var secs = hist.map(function (x) { return x.seconds; }).filter(function (s) { return typeof s === 'number'; }).sort(function (a, b) { return a - b; });
    var lines = [((room && room.title) || brand.appName) + ' (' + code + ')'];
    lines.push(n + (n === 1 ? ' story' : ' stories') + (anyNum ? ', ' + fmt(pts) + ' points' : ''));
    lines.push('Agreed on the first vote: ' + agreed + ' of ' + n);
    if (secs.length) lines.push('Typical time per story: ' + dur(secs[Math.floor(secs.length / 2)]));
    lines.push('');
    hist.forEach(function (x) { lines.push('- ' + x.story + ': ' + x.estimate); });
    return lines.join('\n');
  }
  function copySummary() { copyText(summaryText(), 'Summary copied'); }
  function exportCSV() {
    var q = function (s) { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var lines = ['Issue key,Summary,Story points,Rounds,Minutes'];
    hist.forEach(function (x) {
      var sk = splitKey(x.story);
      lines.push([sk.key, sk.key ? sk.title : x.story, x.estimate, x.rounds || 1, typeof x.seconds === 'number' ? fmt(x.seconds / 60) : ''].map(q).join(','));
    });
    download(code + '-estimates.csv', lines.join('\n') + '\n', 'text/csv');
  }

  // ---------- recent games (kept only in this browser) ----------
  var RECENT_KEY = 'pp.recent', RECENT_MAX = 5;
  function readRecent() {
    try {
      var list = JSON.parse(store.get(RECENT_KEY) || '[]');
      return Array.isArray(list) ? list.filter(function (g) { return g && ROOM_RE.test(g.code); }).slice(0, RECENT_MAX) : [];
    } catch (e) { return []; }
  }
  function writeRecent(list) { store.set(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); }
  function rememberGame() {
    if (!room) return;
    var list = readRecent().filter(function (g) { return g.code !== code; });
    list.unshift({ code: code, title: clip(room.title || '', 60), at: Date.now(), done: hist.length });
    writeRecent(list);
  }
  function forgetGame(c) { writeRecent(readRecent().filter(function (g) { return g.code !== c; })); renderRecent(); }
  function whenText(ms) {
    var d = new Date(ms), now = new Date();
    var day = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var days = Math.round((day(now) - day(d)) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + ' days ago';
    if (days < 35) return Math.floor(days / 7) + ' wk ago';
    try { return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return d.toDateString().slice(4, 10); }
  }
  function renderRecent() {
    var box = $('#recentBox');
    var list = readRecent();
    $('#startInner').classList.toggle('compact', list.length > 0);
    box.hidden = !list.length;
    box.replaceChildren();
    if (!list.length) return;
    box.append(h('div', { class: 'recent-head' }, h('h2', null, 'Recent'),
      h('button', { type: 'button', onclick: function () { writeRecent([]); renderRecent(); } }, 'Clear')));
    list.forEach(function (g) {
      var name = g.title || g.code;
      var when = whenText(g.at || 0);
      var done = Number(g.done) || 0;
      box.append(h('div', { class: 'recent-row' },
        h('button', { type: 'button', class: 'go', 'aria-label': 'Rejoin ' + name + ', ' + done + (done === 1 ? ' story' : ' stories') + ' done, ' + when,
          onclick: function () { $('#code').value = g.code; joinExisting(g.code); } },
          h('span', { class: 'names' }, h('span', { class: 'n1' }, name), g.title ? h('span', { class: 'n2' }, g.code) : null),
          h('span', { class: 'meta' }, h('span', null, when), h('b', { 'aria-hidden': 'true' }, svg(ICON.tick), String(done)))),
        h('button', { type: 'button', class: 'x', 'aria-label': 'Forget ' + name, html: ICON.x, onclick: function () { forgetGame(g.code); } })));
    });
  }

  // ---------- help ----------
  function openHelp() { openSheet($('#helpDlg')); }
  document.querySelectorAll('#faq .faq-q').forEach(function (q) {
    q.addEventListener('click', function () {
      var open = q.getAttribute('aria-expanded') === 'true';
      document.querySelectorAll('#faq .faq-q').forEach(function (o) {
        o.setAttribute('aria-expanded', 'false');
        document.getElementById(o.getAttribute('aria-controls')).hidden = true;
      });
      if (!open) {
        q.setAttribute('aria-expanded', 'true');
        document.getElementById(q.getAttribute('aria-controls')).hidden = false;
      }
    });
  });
  $('#helpBtnStart').addEventListener('click', openHelp);
  $('#helpBtnTable').addEventListener('click', function () { closeSheet($('#settingsDlg')); openHelp(); });

  // ---------- views ----------
  function updateLogo() {
    var dark = Theme.resolvedMode() === 'dark';
    ['#startLogo', '#barLogo'].forEach(function (sel) {
      var img = $(sel);
      if (!brand.logo) { img.hidden = true; return; }
      var src = dark && brand.logoDark ? brand.logoDark : brand.logo;
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
      img.alt = brand.logoAlt || '';
      img.classList.toggle('plate', dark && !brand.logoDark);
      img.onerror = function () { img.hidden = true; };
      img.hidden = false;
    });
  }
  function applyBrand() {
    document.title = brand.appName;
    $('#heroTitle').textContent = brand.appName;
    $('#barTitle').textContent = brand.appName;
    updateLogo();
  }
  function resetTableState() {
    room = null; players = new Map(); online = null; offlineSince = new Map();
    votes = new Map(); votesRound = -1; votesLoaded = -1; hist = []; histVersion = -1;
    queue = []; queueVersion = -1; myVote = null; votePending = 0;
    seenUnrevealed = -1; confettiRound = -1; clearAuto(); qrFor = '';
    seatEls.clear(); $('#seats').replaceChildren();
    centerSig = ''; handDeck = ''; railSig = '';
  }
  function showTable() {
    onTable = true;
    $('#startView').hidden = true;
    $('#tableView').hidden = false;
  }
  function showStart() {
    renderRecent();
    onTable = false;
    $('#tableView').hidden = true;
    $('#startView').hidden = false;
  }
  function startError(msg) { var e = $('#startErr'); e.textContent = msg || ''; e.hidden = !msg; }

  function needName() {
    var nick = clip($('#nick').value, 24);
    if (!nick) { startError('Add your name first'); $('#nick').focus(); return null; }
    startError('');
    if (!sb) { $('#setupNote').hidden = false; return null; }
    me.name = nick; me.spec = $('#spec').checked;
    store.set('pp.nick', nick); store.set('pp.spec', me.spec ? '1' : '0');
    return nick;
  }
  async function enterTable(roomRow, my) {
    code = roomRow.code;
    store.set('pp.room', code);
    resetTableState();
    applyRoom(roomRow);
    showTable();
    setConn('connecting');
    try { window.history.replaceState(null, '', '#' + code); } catch (e) {}
    loadPlayers(); loadMyVote();
    subscribe(my);
    render();
  }

  async function joinExisting(raw) {
    if (!needName()) return;
    var c = codeFrom(raw);
    if (!ROOM_RE.test(c)) { startError('Check the room code'); $('#code').focus(); return; }
    var btn = $('#joinBtn');
    btn.disabled = true;
    var my = ++sess;
    try {
      await ensureUser();
      var res = await sb.rpc('join_game', { p_code: c, p_name: me.name, p_spectator: me.spec });
      if (res.error) throw res.error;
      if (my !== sess) return;
      await enterTable(res.data, my);
    } catch (e) {
      if (my === sess) startError(friendly(e));
    } finally { btn.disabled = false; }
  }

  async function createGame() {
    var btn = $('#startBtn');
    btn.disabled = true; btn.textContent = 'Starting…';
    var my = ++sess;
    try {
      await ensureUser();
      var res = null;
      for (var attempt = 0; attempt < 4; attempt++) {
        res = await sb.rpc('create_room', { p_code: newCode(), p_name: me.name, p_spectator: me.spec, p_title: clip($('#gameName').value, 60),
          p_deck: newOpts.deck, p_auto_reveal: newOpts.auto, p_anonymous: newOpts.anon });
        if (!res.error || res.error.code !== '23505') break;
      }
      if (res.error) throw res.error;
      if (my !== sess) return;
      closeSheet($('#newDlg'));
      await enterTable(res.data, my);
      if (drafts.length) {
        var list = drafts.slice();
        drafts = [];
        await queueStories(list);
      }
      $('#gameName').value = '';
      openInvite();
    } catch (e) {
      if (my === sess) { closeSheet($('#newDlg')); startError(friendly(e)); }
    } finally { btn.disabled = false; btn.textContent = 'Start'; }
  }

  function leaveTable() {
    sess++;
    clearAuto();
    if (channel) { sb.removeChannel(channel); channel = null; }
    channelReady = false;
    setConn('idle');
    showStart();
    try { window.history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    $('#code').value = '';
  }

  // ---------- wiring ----------
  $('#startForm').addEventListener('submit', function (e) { e.preventDefault(); joinExisting($('#code').value); });
  $('#newBtn').addEventListener('click', function () { if (!needName()) return; drafts = []; renderNew(); openSheet($('#newDlg')); });
  $('#startBtn').addEventListener('click', createGame);
  $('#newStoriesBtn').addEventListener('click', function () { openStories(true); });
  $('#lookBtn').addEventListener('click', openSettings);
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#roomPill').addEventListener('click', openInvite);
  $('#queueBtn').addEventListener('click', function () { openStories(false); });
  $('#leaveBtn').addEventListener('click', function () { closeSheet($('#settingsDlg')); leaveTable(); });
  $('#watchBtn').addEventListener('click', function () {
    me.spec = !me.spec; myVote = null;
    store.set('pp.spec', me.spec ? '1' : '0');
    render();
    rpc('set_spectator', { p_spectator: me.spec });
  });
  $('#storiesDlg').addEventListener('close', function () { pending = null; if (storiesDraftMode) renderNew(); storiesDraftMode = false; });

  var storyIn = $('#story'), storyTimer = null;
  function commitStory() {
    clearTimeout(storyTimer);
    if (!room) return;
    var v = clip(storyIn.value, 140);
    if (v !== room.story) rpc('set_story', { p_story: v }).then(useRoom);
  }
  storyIn.addEventListener('input', function () { clearTimeout(storyTimer); storyTimer = setTimeout(commitStory, 700); });
  storyIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commitStory(); storyIn.blur(); } });
  storyIn.addEventListener('blur', function () { commitStory(); render(); });

  document.addEventListener('visibilitychange', function () {
    trackMe();
    if (document.visibilityState === 'visible' && onTable && sb) resync();
  });
  Theme.onChange(function () { updateLogo(); if ($('#settingsDlg').open) renderSettings(); });

  function hashCode() { return codeFrom(location.hash); }
  window.addEventListener('hashchange', function () { var c = hashCode(); if (c && !onTable) $('#code').value = c; });

  applyBrand();
  renderRecent();
  $('#nick').value = store.get('pp.nick') || '';
  $('#spec').checked = store.get('pp.spec') === '1';
  var initial = hashCode();
  if (initial) $('#code').value = initial;
  if (!sb) $('#setupNote').hidden = false;
  else if (initial && ROOM_RE.test(initial) && $('#nick').value) joinExisting(initial);

  window.__poker = { rowsFromPaste: rowsFromPaste, rowsFromCSV: rowsFromCSV, splitKey: splitKey, codeFrom: codeFrom };
})();
