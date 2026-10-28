/*
 * Planning poker client.
 *
 * Data flow:
 *   - Every player signs in anonymously, so the database knows who they are.
 *   - All writes are calls to database functions (join_room, cast_vote, ...).
 *   - Room and player changes arrive over Supabase Realtime.
 *   - Votes are fetched only after the reveal. Before that, the database
 *     refuses to send anyone else's card, so they can't be peeked at.
 *   - Realtime presence tells us who still has the page open, and realtime
 *     broadcast carries the throwaway stuff: emoji reactions and nudges.
 */
(function () {
  'use strict';

  // ---------- basics ----------
  var $ = function (s) { return document.querySelector(s); };
  var DECKS = {
    fib:    { label: 'Fibonacci',          cards: ['0', '½', '1', '2', '3', '5', '8', '13', '21', '34', '?', '☕'] },
    mfib:   { label: 'Modified Fibonacci', cards: ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100', '?', '☕'] },
    tshirt: { label: 'T-shirt sizes',      cards: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '?', '☕'] },
    pow2:   { label: 'Powers of 2',        cards: ['0', '1', '2', '4', '8', '16', '32', '64', '?', '☕'] }
  };
  var SPECIAL = { '?': 1, '☕': 1 };
  var REACTS = [['👍', 'Thumbs up'], ['😂', 'Laughing'], ['🤔', 'Hmm'], ['😱', 'Yikes'], ['🎉', 'Celebrate']];
  var POKE = '👋';
  var ROOM_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
  var ADJ = ['brisk', 'calm', 'clever', 'eager', 'fuzzy', 'gentle', 'jolly', 'lucky', 'mellow', 'nimble', 'plucky', 'quiet', 'rapid', 'sunny', 'tidy', 'witty'];
  var NOUN = ['heron', 'otter', 'badger', 'falcon', 'lynx', 'marten', 'osprey', 'panda', 'quokka', 'raven', 'tapir', 'walrus', 'yak', 'zebra', 'gecko', 'bison'];

  var Theme = window.PokerTheme || {
    brand: { appName: 'Planning poker', orgName: '', logo: null, logoDark: null, logoAlt: '' },
    themes: function () { return []; }, theme: function () { return ''; }, mode: function () { return 'auto'; },
    resolvedMode: function () { return 'light'; }, setTheme: function () {}, setMode: function () {}, onChange: function () {}
  };
  var brand = Theme.brand;

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  function clip(v, n) {
    if (typeof v !== 'string') return '';
    var s = v.replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b\u200c\u200e\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '');
    s = Array.from(s);
    return (s.length > n ? s.slice(0, n - 1).join('') + '…' : s.join('')).trim();
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function newCode() { return pick(ADJ) + '-' + pick(NOUN) + '-' + (10 + Math.floor(Math.random() * 90)); }
  function cleanCode(v) {
    return String(v || '').trim().toLowerCase().replace(/[\s_.]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+/, '').slice(0, 48);
  }
  function num(v) { return v === '½' ? 0.5 : (/^\d+$/.test(v) ? Number(v) : null); }
  function fmt(n) { return String(Math.round(n * 10) / 10); }
  function len(v) { return Array.from(v).length; }
  function fine() { return window.matchMedia && matchMedia('(pointer: fine)').matches; }
  function calm() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function mmss(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function dur(sec) { if (typeof sec !== 'number') return ''; return sec < 60 ? sec + ' s' : Math.round(sec / 60) + ' min'; }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
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

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  var lastLive = '';
  function announce(msg) { if (msg !== lastLive) { lastLive = msg; $('#live').textContent = msg; } }

  function copyText(text, okMsg, failMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
      toast(ok ? okMsg : failMsg);
    }
    try { navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback); }
    catch (e) { fallback(); }
  }

  function friendly(e) {
    var m = (e && e.message) || '';
    if (e && e.code === 'PGRST202') return 'The database isn’t set up yet. Run the SQL files in supabase/migrations, in order, in the Supabase SQL editor.';
    if (/anonymous sign-ins are disabled/i.test(m)) return 'Anonymous sign-ins are turned off for this Supabase project. Turn them on under Authentication, then Sign In / Providers.';
    if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Can’t reach the database. Check your connection and try again.';
    if (/rate limit/i.test(m)) return 'Too many sign-ins from this network right now. Wait a few minutes and try again.';
    return m || 'Something went wrong. Try again.';
  }

  // ---------- Supabase ----------
  var cfg = window.POKER_CONFIG || {};
  var configured = typeof cfg.supabaseUrl === 'string' && /^https?:\/\//.test(cfg.supabaseUrl) &&
    typeof cfg.supabaseAnonKey === 'string' && cfg.supabaseAnonKey.length > 20 &&
    !/YOUR[-_]/i.test(cfg.supabaseUrl + cfg.supabaseAnonKey);
  var sb = (configured && window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : null;

  async function ensureUser() {
    var got = await sb.auth.getSession();
    var session = got.data && got.data.session;
    if (!session) {
      var res = await sb.auth.signInAnonymously();
      if (res.error) throw res.error;
      session = res.data.session;
    }
    if (sb.realtime && typeof sb.realtime.setAuth === 'function') sb.realtime.setAuth(session.access_token);
    return session.user;
  }

  // ---------- state ----------
  var uid = null, code = '', room = null;
  var players = new Map();   // user_id -> { name, spectator, voted_round }
  var online = null;         // Set of user_ids with the page open; null until presence syncs
  var votes = new Map(), votesRound = -1, votesLoaded = -1, votesReq = 0;
  var hist = [], histVersion = -1, histReq = 0;
  var queue = [], queueVersion = -1, queueReq = 0;
  var myVote = null, votePending = 0;
  var me = { name: '', spec: false };
  var channel = null, onTable = false, sess = 0;
  var spreadMemo = {}, seenUnrevealed = -1, confettiRound = -1;
  var autoKey = '', autoTimer = null, lastSend = 0, lastHeard = {};

  function applyRoom(r) {
    if (!r || r.code !== code) return;
    if (room && typeof r.version === 'number' && r.version < room.version) return; // stale
    var prev = room;
    room = {
      code: r.code, round: r.round, revealed: !!r.revealed, story: r.story || '',
      deck: DECKS[r.deck] ? r.deck : 'fib', final: r.final || null,
      hist_version: r.hist_version || 0, queue_version: r.queue_version || 0, version: r.version || 0,
      auto_reveal: !!r.auto_reveal, anonymous: !!r.anonymous,
      timer_ends_at: r.timer_ends_at ? Date.parse(r.timer_ends_at) : null,
      story_rounds: r.story_rounds || 1
    };
    if (!prev || prev.round !== room.round) {
      votes = new Map(); votesRound = -1; votesLoaded = -1;
      if (prev) myVote = null;
    }
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
    render();
  }
  async function loadQueue() {
    var want = room ? room.queue_version : 0, req = ++queueReq;
    var res = await sb.from('queue').select('id,story').eq('room_code', code)
      .order('position', { ascending: true }).order('id', { ascending: true }).limit(200);
    if (req !== queueReq || res.error) return;
    queue = res.data; queueVersion = want;
    render(); renderQueueDlg();
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

  function subscribe(my) {
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
      .on('presence', { event: 'sync' }, function () {
        if (my !== sess) return;
        online = new Set(Object.keys(channel.presenceState()));
        render();
      })
      .on('broadcast', { event: 'react' }, function (msg) {
        if (my !== sess) return;
        heard(msg && msg.payload);
      })
      .subscribe(function (status) {
        if (my !== sess) return;
        if (status === 'SUBSCRIBED') { setConn('live'); channel.track({ at: Date.now() }); resync(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConn('connecting');
        else if (status === 'CLOSED') setConn('offline');
      });
  }

  function setConn(s) {
    var c = $('#conn');
    c.className = 'conn ' + s;
    c.textContent = { live: 'Live', connecting: 'Connecting…', offline: 'Offline', idle: '' }[s] || '';
    c.hidden = s === 'idle';
    var b = $('#banner');
    var msg = s === 'offline' ? 'You’re disconnected from the table. Reload the page to rejoin.' : '';
    b.textContent = msg; b.hidden = !msg;
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
      toast('Saved with an estimate of ' + v);
      if (fine()) $('#story').focus();
    });
  }

  // Auto-reveal: once every present voter is ready, the first voter's
  // browser (by id) flips after a beat. Others wait longer as a backup.
  // The database ignores a second reveal, so a race is harmless.
  function clearAuto() { if (autoTimer) clearTimeout(autoTimer); autoTimer = null; autoKey = ''; }
  function maybeAutoReveal(list) {
    if (!room.auto_reveal || room.revealed) { clearAuto(); return; }
    var voters = list.filter(function (p) { return !p.spec && !p.away; });
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
  function react(emoji) { if (send(emoji)) floatAt(uid, emoji); }
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
        toast(who + ' nudged you' + (myVote || me.spec || room.revealed ? '' : '. Your turn to pick a card.'));
      }
    } else {
      floatAt(p.from, p.emoji);
    }
  }
  function confetti() {
    if (calm()) return;
    var box = h('div', { class: 'confetti', 'aria-hidden': 'true' });
    var colors = ['var(--accent)', 'var(--card-red)', 'var(--felt)', 'var(--card)', 'var(--felt-ink)'];
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
    var out = [];
    players.forEach(function (p, id) {
      var isMe = id === uid;
      var here = isMe || !online || online.has(id);
      var spec = isMe ? me.spec : !!p.spectator;
      var v = (room.revealed && !spec) ? (votes.get(id) || null) : null;
      if (!here && !v) return;
      var name = isMe ? me.name : (clip(p.name, 24) || 'Someone');
      out.push({
        peer: id, isMe: isMe, away: !here, spec: spec, v: v, nick: name, name: name,
        ready: !spec && (isMe ? !!myVote : p.voted_round === room.round)
      });
    });
    if (uid && !players.has(uid)) out.push({ peer: uid, isMe: true, away: false, spec: me.spec, v: null, nick: me.name, name: me.name, ready: !me.spec && !!myVote });
    out.sort(function (a, b) {
      return ((a.spec ? 1 : 0) - (b.spec ? 1 : 0)) || a.nick.toLowerCase().localeCompare(b.nick.toLowerCase()) || (a.peer < b.peer ? -1 : 1);
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
    var res = {
      dist: dist, avg: null, suggestion: null, lo: null, hi: null, total: list.length,
      consensus: real.length > 0 && Object.keys(distinct).length === 1,
      realCount: real.length,
      unsure: list.filter(function (x) { return x.v === '?'; }).length,
      breaks: list.filter(function (x) { return x.v === '☕'; }).length
    };
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
        if (!best || d <= best.d + 1e-9) best = { c: c, d: d }; // ties round up
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

  function bigOrFuzzy(st) {
    if (st.total > 0 && st.unsure * 2 >= st.total) return true;
    var s = room.final || st.suggestion;
    if (!s) return false;
    if (room.deck === 'tshirt') return s === 'XL' || s === 'XXL';
    var n = num(s);
    return n !== null && n >= (room.deck === 'pow2' ? 16 : 13);
  }
  function joinNames(list) {
    var n = list.map(function (x) { return x.name; });
    if (n.length === 1) return n[0];
    if (n.length === 2) return n[0] + ' and ' + n[1];
    return n[0] + ', ' + n[1] + ' and ' + (n.length - 2) + ' more';
  }
  function cardLabel(v) {
    if (v === '?') return 'Not sure';
    if (v === '☕') return 'Need a break';
    return room && room.deck === 'tshirt' ? 'Size ' + v : v + (v === '1' ? ' point' : ' points');
  }
  function anchors(v) {
    var out = [];
    for (var i = hist.length - 1; i >= 0 && out.length < 2; i--) if (hist[i].estimate === v) out.push(clip(hist[i].story, 32));
    return out;
  }

  // ---------- rendering ----------
  var seatEls = new Map();
  var centerSig = '', histSig = null, queueSig = null, handDeck = '', clearArmed = false, clearTimer = null;

  function makeSeat(pl) {
    var el = h('div', { class: 'seat', role: 'listitem' });
    var box = pl.isMe
      ? h('div', { class: 'seat-btn', style: 'cursor:default' })
      : h('button', { type: 'button', class: 'seat-btn', onclick: function () { poke(pl.peer); } });
    var mini = h('div', { class: 'mini', 'aria-hidden': 'true' });
    var inn = h('div', { class: 'mini-in' });
    var front = h('div', { class: 'face front' });
    inn.append(h('div', { class: 'face back' }), front);
    mini.append(h('div', { class: 'slot' }), inn);
    var nm = h('div', { class: 'nm' }), st = h('div', { class: 'st' });
    box.append(mini, nm, st);
    el.append(box);
    el._box = box; el._in = inn; el._front = front; el._name = nm; el._status = st;
    return el;
  }

  function renderSeats(list, st) {
    var wrap = $('#seats');
    var lo = {}, hi = {};
    if (st && st.lo && !room.anonymous) { st.lo.forEach(function (x) { lo[x.peer] = 1; }); st.hi.forEach(function (x) { hi[x.peer] = 1; }); }
    var order = [], keep = {}, flipIndex = 0;
    list.forEach(function (pl) {
      keep[pl.peer] = 1;
      var el = seatEls.get(pl.peer);
      if (!el) { el = makeSeat(pl); seatEls.set(pl.peer, el); }
      var flip = room.revealed && !!pl.v && !room.anonymous;
      var shown = room.revealed ? !!pl.v : pl.ready;
      el.classList.toggle('spec', pl.spec);
      el.classList.toggle('voted', shown);
      el.classList.toggle('away', pl.away);
      if (flip && !el.classList.contains('flipped')) el._in.style.transitionDelay = (flipIndex * 45) + 'ms';
      else if (!flip) el._in.style.transitionDelay = '0ms';
      if (flip) flipIndex++;
      el._front.textContent = flip ? pl.v : '';
      el._front.classList.toggle('red', flip && !!SPECIAL[pl.v]);
      el._front.setAttribute('data-len', flip ? String(len(pl.v)) : '1');
      el.classList.toggle('flipped', flip);
      el.classList.toggle('edge', !!(flip && (lo[pl.peer] || hi[pl.peer])));
      el._name.textContent = pl.nick;
      var status = pl.spec ? 'watching'
        : !room.revealed ? (pl.ready ? 'ready' : 'thinking')
        : !pl.v ? 'no vote'
        : room.anonymous ? 'voted'
        : lo[pl.peer] ? 'lowest' : hi[pl.peer] ? 'highest' : pl.away ? 'left' : '';
      el._status.replaceChildren();
      if (pl.isMe) el._status.append(h('span', { class: 'you' }, 'you'));
      if (status) el._status.append(document.createTextNode(status));
      var desc = pl.nick + (pl.isMe ? ' (you)' : '') + ': ' + (flip ? cardLabel(pl.v) + (status ? ', ' + status : '') : status);
      el.setAttribute('aria-label', desc);
      if (!pl.isMe) el._box.setAttribute('aria-label', 'Nudge ' + desc);
      order.push(el);
    });
    seatEls.forEach(function (el, k) { if (!keep[k]) { el.remove(); seatEls.delete(k); } });
    order.forEach(function (el, i) { if (wrap.children[i] !== el) wrap.insertBefore(el, wrap.children[i] || null); });
  }

  function timerRow(st) {
    if (!st || st.consensus || st.realCount < 2) return null;
    if (room.timer_ends_at) {
      var left = room.timer_ends_at - Date.now();
      if (left > 0) {
        return h('div', { class: 'timer' }, h('b', { id: 'timerTxt' }, mmss(left)), ' left to talk it through ',
          h('button', { type: 'button', class: 'link', 'data-act': 'timer-stop', onclick: function () { rpc('start_timer', { p_seconds: 0 }).then(useRoom); } }, 'Stop'));
      }
      return h('div', { class: 'timer done' }, h('b', null, 'Time’s up.'), ' Settle on a number or vote again.');
    }
    return h('button', { type: 'button', class: 'btn secondary small', 'data-act': 'timer', onclick: function () { rpc('start_timer', { p_seconds: 120 }).then(useRoom); } }, 'Start a 2-minute timer');
  }

  function renderCenter(list, st) {
    var voters = list.filter(function (p) { return !p.spec && !p.away; });
    var ready = voters.filter(function (p) { return p.ready; });
    var shown = list.filter(function (p) { return p.v; });
    var timerDone = !!(room.timer_ends_at && room.timer_ends_at <= Date.now());
    var sig = JSON.stringify([room.revealed, room.final, room.deck, room.anonymous, room.auto_reveal, room.timer_ends_at, timerDone,
      room.story, room.story_rounds, voters.length, ready.length, votesLoaded === room.round,
      room.revealed ? shown.map(function (p) { return [p.peer, p.v, p.nick]; }) : 0]);
    if (sig === centerSig) return;
    centerSig = sig;
    var c = $('#center');
    var act = c.contains(document.activeElement) ? document.activeElement.getAttribute('data-act') : null;
    c.replaceChildren();

    if (!room.revealed) {
      var all = ready.length > 0 && ready.length === voters.length;
      var countTxt = voters.length ? ready.length + ' of ' + voters.length + ' voted' : 'Everyone here is watching';
      var btn = h('button', { type: 'button', class: 'btn primary' + (all ? ' ready' : ''), 'data-act': 'reveal', onclick: reveal }, 'Reveal cards');
      btn.disabled = ready.length === 0;
      var hint = room.auto_reveal
        ? (all && voters.length > 1 ? 'Everyone’s in. Flipping…' : 'Cards flip on their own once everyone’s in.')
        : all ? 'Everyone’s in. Flip when ready.'
        : ready.length ? 'Anyone can reveal, even if someone is still thinking.'
        : 'Cards stay face down until someone reveals them.';
      c.append(h('p', { class: 'count' }, countTxt), btn, h('p', { class: 'hint' }, hint));
      if (voters.length > 1 && ready.length < voters.length && ready.length > 0) c.append(h('p', { class: 'hint' }, 'Tap someone’s seat to give them a nudge.'));
      announce(countTxt);
    } else if (votesLoaded !== room.round) {
      c.append(h('p', { class: 'count' }, 'Flipping cards…'));
    } else {
      var verdict = room.final ? 'Agreed: ' + room.final
        : st.realCount === 0 ? 'No estimate yet'
        : st.realCount === 1 ? 'One vote: ' + st.suggestion
        : st.consensus ? 'Consensus on ' + st.suggestion
        : 'Suggested: ' + st.suggestion;
      var parts = [];
      if (st.avg !== null && st.realCount > 1) parts.push('Average ' + fmt(st.avg) + '.');
      if (st.lo) parts.push('Votes ran from ' + st.lo[0].v + ' to ' + st.hi[0].v + '.');
      if (!room.final && !st.consensus && st.realCount > 1) parts.push(room.deck === 'tshirt' ? 'The suggestion is the most picked size.' : 'The suggestion is the card nearest the average.');
      if (st.unsure) parts.push(st.unsure + ' not sure.');
      if (st.breaks) parts.push(st.breaks + (st.breaks === 1 ? ' person wants' : ' people want') + ' a break.');

      // Did a re-vote on the same story narrow the spread?
      if (st.lo) spreadMemo[room.round] = { story: room.story, lo: st.lo[0].v, hi: st.hi[0].v };
      var prevSpread = room.story_rounds > 1 ? spreadMemo[room.round - 1] : null;
      var converge = (prevSpread && prevSpread.story === room.story && prevSpread.lo)
        ? 'Last round ran from ' + prevSpread.lo + ' to ' + prevSpread.hi + '. ' + (st.consensus ? 'Now you agree.' : st.lo ? 'This one runs from ' + st.lo[0].v + ' to ' + st.hi[0].v + '.' : '')
        : '';

      c.append(h('p', { class: 'verdict' }, verdict));
      if (parts.length) c.append(h('p', { class: 'detail' }, parts.join(' ')));
      if (converge) c.append(h('p', { class: 'talk' }, converge));
      if (st.lo && !room.final) c.append(h('p', { class: 'talk' }, room.anonymous
        ? 'Hear from someone who picked ' + st.lo[0].v + ' and someone who picked ' + st.hi[0].v + ' before you settle.'
        : 'Hear from ' + joinNames(st.lo) + ' (' + st.lo[0].v + ') and ' + joinNames(st.hi) + ' (' + st.hi[0].v + ') before you settle.'));
      if (bigOrFuzzy(st)) c.append(h('p', { class: 'nudge-line' }, 'This one is big or fuzzy. Stories this size tend to hide surprises, so consider splitting it before you commit.'));
      var tr = timerRow(st);
      if (tr) c.append(tr);

      var dist = h('div', { class: 'dist', role: 'group', 'aria-label': 'Votes. Pick one to set the agreed estimate.' });
      st.dist.forEach(function (d) {
        var special = !!SPECIAL[d.v];
        var b = h('button', {
          type: 'button', class: 'dchip' + (special ? ' red' : ''), 'data-act': 'fin-' + d.v,
          'aria-pressed': String(room.final === d.v), 'aria-label': cardLabel(d.v) + ', ' + d.n + (d.n === 1 ? ' vote' : ' votes')
        }, h('span', { class: 'v' }, d.v), h('span', { class: 'n' }, d.n === 1 ? '1 vote' : d.n + ' votes'));
        if (special) b.disabled = true; else b.onclick = function () { setFinal(d.v); };
        dist.append(b);
      });
      c.append(dist);

      var sel = h('select', { 'data-act': 'other', 'aria-label': 'Agree on a different value' });
      sel.append(h('option', { value: '' }, 'Pick a value'));
      DECKS[room.deck].cards.forEach(function (v) {
        if (SPECIAL[v]) return;
        var o = h('option', { value: v }, v);
        if (room.final === v) o.selected = true;
        sel.append(o);
      });
      sel.onchange = function () { if (sel.value) rpc('set_final', { p_value: sel.value }).then(useRoom); };
      c.append(h('label', { class: 'other' }, 'Or agree on', sel));
      c.append(h('p', { class: 'hint' }, room.final ? 'Tap the agreed card again to clear it.'
        : 'Tap a card to set the agreed estimate. Next story saves it' + (queue.length ? ' and brings up the next one.' : ' to the list below.')));
      c.append(h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn primary', 'data-act': 'next', onclick: nextStory }, 'Next story'),
        h('button', { type: 'button', class: 'btn secondary', 'data-act': 'again', onclick: voteAgain }, 'Vote again')
      ));
      announce('Cards revealed. ' + verdict);
    }
    if (act) {
      var f = c.querySelector('[data-act="' + CSS.escape(act) + '"]');
      if (f) f.focus();
    }
  }

  function renderUpnext() {
    var sig = JSON.stringify([queue.length, queue[0] && queue[0].story]);
    if (sig === queueSig) return;
    queueSig = sig;
    var u = $('#upnext');
    u.replaceChildren();
    if (queue.length) {
      u.append(document.createTextNode('Up next: '), h('b', null, clip(queue[0].story, 48)),
        document.createTextNode(queue.length > 1 ? ' and ' + (queue.length - 1) + ' more' : ''),
        h('button', { type: 'button', class: 'link', onclick: openQueue }, 'Edit queue'));
    } else {
      u.append(h('button', { type: 'button', class: 'link', onclick: openQueue }, 'Add a list of stories'));
    }
  }

  function renderHand() {
    var row = $('#handRow');
    if (handDeck !== room.deck) {
      handDeck = room.deck;
      row.replaceChildren();
      DECKS[room.deck].cards.forEach(function (v) {
        row.append(h('button', {
          type: 'button', class: 'hcard' + (SPECIAL[v] ? ' red' : ''), 'data-v': v, 'data-len': String(len(v)),
          'aria-label': cardLabel(v), 'aria-pressed': 'false', onclick: function () { vote(v); }
        }, h('span', { class: 'idx tl', 'aria-hidden': 'true' }, v), h('span', { class: 'val', 'aria-hidden': 'true' }, v), h('span', { class: 'idx br', 'aria-hidden': 'true' }, v)));
      });
    }
    var locked = room.revealed || me.spec;
    Array.prototype.forEach.call(row.children, function (b) {
      var on = b.getAttribute('data-v') === myVote;
      b.classList.toggle('sel', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.disabled = locked;
    });
    var hint;
    if (me.spec) hint = 'You’re watching this round.';
    else if (room.revealed) hint = 'Cards are locked. Start the next story or vote again.';
    else if (myVote) {
      var a = SPECIAL[myVote] ? [] : anchors(myVote);
      hint = 'You picked ' + myVote + '. ' + (a.length ? 'Earlier stories at ' + myVote + ': ' + a.join(', ') + '.' : 'Tap it again to take it back.');
    } else hint = 'Pick a card. No one can see it until the reveal.';
    $('#handHint').textContent = hint;
    $('#specBtn').textContent = me.spec ? 'Join the vote' : 'Just watch';
  }

  function summaryText() {
    var n = hist.length, pts = 0, anyNum = false, agreed = 0;
    hist.forEach(function (x) { var v = num(x.estimate); if (v !== null) { pts += v; anyNum = true; } if (x.consensus) agreed++; });
    var secs = hist.map(function (x) { return x.seconds; }).filter(function (s) { return typeof s === 'number'; }).sort(function (a, b) { return a - b; });
    var lines = [(brand.orgName ? brand.orgName + ' ' : '') + brand.appName + ': ' + code];
    lines.push(n + (n === 1 ? ' story' : ' stories') + (anyNum ? ', ' + fmt(pts) + ' points' : ''));
    lines.push('Agreed on the first vote: ' + agreed + ' of ' + n);
    if (secs.length) lines.push('Typical time per story: ' + dur(secs[Math.floor(secs.length / 2)]));
    lines.push('');
    hist.forEach(function (x) { lines.push('- ' + x.story + ': ' + x.estimate); });
    return lines.join('\n');
  }

  function renderHistory() {
    var sig = JSON.stringify(hist) + clearArmed;
    if (sig === histSig) return;
    histSig = sig;
    var sec = $('#history');
    var act = sec.contains(document.activeElement) ? document.activeElement.getAttribute('data-act') : null;
    sec.replaceChildren(h('h2', null, 'Estimated stories'));
    if (!hist.length) {
      sec.append(h('p', { class: 'muted' }, 'When you move to the next story, the one you just estimated lands here with its number, how many rounds it took and how long.'));
      return;
    }
    var pts = 0, anyNum = false, agreed = 0;
    hist.forEach(function (x) { var v = num(x.estimate); if (v !== null) { pts += v; anyNum = true; } if (x.consensus) agreed++; });
    var n = hist.length;
    sec.append(h('p', { class: 'muted' }, n + (n === 1 ? ' story' : ' stories') + (anyNum ? ', ' + fmt(pts) + ' points in total' : '') +
      '. Agreed on the first vote ' + agreed + ' of ' + n + ' times.'));
    var ul = h('ul', { class: 'hlist' });
    hist.forEach(function (x) {
      var meta = [x.consensus ? 'agreed first time' : (x.rounds || 1) + ((x.rounds || 1) === 1 ? ' round' : ' rounds'), dur(x.seconds)].filter(Boolean).join(', ');
      ul.append(h('li', null, h('span', { class: 's' }, x.story, h('span', { class: 'meta' }, meta)), h('span', { class: 'v' }, x.estimate)));
    });
    sec.append(ul);
    sec.append(h('div', { class: 'hactions' },
      h('button', { type: 'button', class: 'btn plain small', 'data-act': 'summary', onclick: function () {
        copyText(summaryText(), 'Summary copied. Paste it into Slack or Teams.', 'Couldn’t copy here. Select the list and copy it yourself.');
      } }, 'Copy summary'),
      h('button', { type: 'button', class: 'btn plain small', 'data-act': 'copy', onclick: function () {
        var tsv = 'Story\tEstimate\tRounds\tMinutes\n' + hist.map(function (x) {
          return x.story.replace(/[\t\n]/g, ' ') + '\t' + x.estimate + '\t' + (x.rounds || 1) + '\t' + (typeof x.seconds === 'number' ? fmt(x.seconds / 60) : '');
        }).join('\n');
        copyText(tsv, 'Copied. Paste it into a spreadsheet or your tracker.', 'Couldn’t copy here. Select the list and copy it yourself.');
      } }, 'Copy for spreadsheet'),
      h('button', { type: 'button', class: 'btn plain small', 'data-act': 'clear', onclick: function () {
        if (!clearArmed) {
          clearArmed = true; renderHistory();
          clearTimeout(clearTimer);
          clearTimer = setTimeout(function () { clearArmed = false; renderHistory(); }, 3500);
        } else {
          clearArmed = false; clearTimeout(clearTimer);
          rpc('clear_history').then(function (r) { if (r) { useRoom(r); toast('List cleared'); } });
        }
      } }, clearArmed ? 'Tap again to clear for everyone' : 'Clear list')
    ));
    if (act) { var f = sec.querySelector('[data-act="' + act + '"]'); if (f) f.focus(); }
  }

  function render() {
    if (!onTable || !room) return;
    var storyIn = $('#story');
    if (document.activeElement !== storyIn && storyIn.value !== room.story) storyIn.value = room.story;
    var list = seatList();
    var st = room.revealed ? stats(list.filter(function (p) { return p.v; }), room.deck) : null;
    if (!room.revealed) seenUnrevealed = room.round;
    renderSeats(list, st);
    renderCenter(list, st);
    renderUpnext();
    renderHand();
    renderHistory();
    maybeAutoReveal(list);
    if (st && votesLoaded === room.round && st.consensus && st.realCount >= 2 &&
        seenUnrevealed === room.round && confettiRound !== room.round) {
      confettiRound = room.round;
      confetti();
    }
    if ($('#settingsDlg').open) syncTableOpts();
  }

  setInterval(function () {
    if (!onTable || !room || !room.timer_ends_at || !room.revealed) return;
    var t = $('#timerTxt');
    var left = room.timer_ends_at - Date.now();
    if (left <= 0) { if (t) render(); }
    else if (t) t.textContent = mmss(left);
  }, 1000);

  // ---------- settings & queue dialogs ----------
  function openDialog(d) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }

  function renderThemes() {
    var wrap = $('#themeList');
    wrap.replaceChildren();
    Theme.themes().forEach(function (t) {
      var input = h('input', { type: 'radio', name: 'theme', value: t.id });
      input.checked = t.id === Theme.theme();
      input.onchange = function () { Theme.setTheme(t.id); };
      var sw = h('span', { class: 'sw', 'aria-hidden': 'true' });
      t.swatch.forEach(function (c) { var i = h('i'); i.style.background = c; sw.append(i); });
      wrap.append(h('label', { class: 'tchip' }, input, sw, t.label));
    });
    document.querySelectorAll('input[name="mode"]').forEach(function (r) { r.checked = r.value === Theme.mode(); });
  }
  function syncTableOpts() {
    $('#tableOpts').hidden = !onTable || !room;
    $('#leaveBtn').hidden = !onTable;
    if (!room) return;
    $('#deckSel').value = room.deck;
    $('#optAuto').checked = room.auto_reveal;
    $('#optAnon').checked = room.anonymous;
  }
  function openSettings() { renderThemes(); syncTableOpts(); openDialog($('#settingsDlg')); }

  function renderQueueDlg() {
    var ul = $('#queueList');
    ul.replaceChildren();
    queue.forEach(function (q) {
      ul.append(h('li', null, h('span', null, q.story),
        h('button', { type: 'button', class: 'link', 'aria-label': 'Remove ' + q.story, onclick: function () { rpc('queue_remove', { p_id: q.id }).then(useRoom); } }, 'Remove')));
    });
    $('#queueCount').textContent = queue.length ? queue.length + (queue.length === 1 ? ' story waiting' : ' stories waiting') : 'Nothing queued yet';
    $('#queueClearBtn').hidden = !queue.length;
  }
  function openQueue() { renderQueueDlg(); openDialog($('#queueDlg')); if (fine()) $('#queueInput').focus(); }

  // ---------- views ----------
  function applyBrand() {
    document.title = brand.orgName ? brand.orgName + ' ' + brand.appName : brand.appName;
    $('#heroTitle').textContent = brand.appName;
    $('#markText').textContent = brand.appName;
    updateLogo();
  }
  function updateLogo() {
    var img = $('#logo');
    if (!brand.logo) { img.hidden = true; return; }
    var dark = Theme.resolvedMode() === 'dark';
    var src = dark && brand.logoDark ? brand.logoDark : brand.logo;
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    img.alt = brand.logoAlt || '';
    img.classList.toggle('plate', dark && !brand.logoDark);
    img.onerror = function () { img.hidden = true; };
    img.hidden = false;
  }

  function resetTableState() {
    room = null; players = new Map(); online = null;
    votes = new Map(); votesRound = -1; votesLoaded = -1; hist = []; histVersion = -1;
    queue = []; queueVersion = -1; myVote = null; votePending = 0;
    spreadMemo = {}; seenUnrevealed = -1; confettiRound = -1; clearAuto();
    seatEls.clear(); $('#seats').replaceChildren();
    centerSig = ''; histSig = null; queueSig = null; handDeck = '';
  }
  function showTable() {
    onTable = true;
    $('#joinView').hidden = true;
    $('#tableView').hidden = false;
    $('#topbar').classList.remove('joining');
    $('#inviteBtn').hidden = false;
  }
  function showJoin() {
    onTable = false;
    $('#tableView').hidden = true;
    $('#joinView').hidden = false;
    $('#topbar').classList.add('joining');
    $('#inviteBtn').hidden = true;
    $('#code').value = code || newCode();
  }
  function joinError(msg) {
    var err = $('#nickErr');
    err.textContent = msg;
    err.hidden = !msg;
  }

  async function joinTable() {
    var nick = clip($('#nick').value, 24);
    if (!nick) { joinError('Add your name so the team knows whose card is whose.'); $('#nick').focus(); return; }
    joinError('');
    if (!sb) { $('#setupNote').hidden = false; return; }
    var c = cleanCode($('#code').value);
    if (!ROOM_RE.test(c)) c = newCode();
    $('#code').value = c;
    me.name = nick; me.spec = $('#spec').checked;
    store.set('pp.nick', nick); store.set('pp.room', c); store.set('pp.spec', me.spec ? '1' : '0');

    var btn = $('#joinBtn');
    btn.disabled = true; btn.textContent = 'Taking your seat…';
    var my = ++sess;
    try {
      uid = (await ensureUser()).id;
      var res = await sb.rpc('join_room', { p_code: c, p_name: nick, p_spectator: me.spec });
      if (res.error) throw res.error;
      if (my !== sess) return;
      code = c;
      resetTableState();
      applyRoom(res.data);
      showTable();
      setConn('connecting');
      try { window.history.replaceState(null, '', '#' + code); } catch (e) {}
      loadPlayers(); loadMyVote();
      subscribe(my);
      render();
    } catch (e) {
      if (my === sess) joinError(friendly(e));
    } finally {
      btn.disabled = false; btn.textContent = 'Take a seat';
    }
  }

  function leaveTable() {
    sess++;
    clearAuto();
    if (channel) { sb.removeChannel(channel); channel = null; }
    setConn('idle');
    showJoin();
  }

  // ---------- wiring ----------
  var deckSel = $('#deckSel');
  Object.keys(DECKS).forEach(function (k) { deckSel.append(h('option', { value: k }, DECKS[k].label)); });
  deckSel.addEventListener('change', function () {
    if (!room || deckSel.value === room.deck) return;
    rpc('set_deck', { p_deck: deckSel.value }).then(function (r) {
      if (r) { useRoom(r); toast('Deck changed for everyone. Votes were cleared.'); } else syncTableOpts();
    });
  });
  $('#optAuto').addEventListener('change', function (e) { rpc('set_options', { p_auto_reveal: e.target.checked, p_anonymous: null }).then(useRoom); });
  $('#optAnon').addEventListener('change', function (e) { rpc('set_options', { p_auto_reveal: null, p_anonymous: e.target.checked }).then(useRoom); });
  document.querySelectorAll('input[name="mode"]').forEach(function (r) {
    r.addEventListener('change', function () { if (r.checked) Theme.setMode(r.value); });
  });
  Theme.onChange(updateLogo);

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

  $('#queueAddBtn').addEventListener('click', function () {
    var lines = $('#queueInput').value.split(/\r?\n/).map(function (l) { return clip(l, 140); }).filter(Boolean);
    if (!lines.length) { toast('Paste at least one story first'); return; }
    var batch = lines.slice(0, 50);
    rpc('queue_add', { p_stories: batch }).then(function (r) {
      if (!r) return;
      useRoom(r);
      $('#queueInput').value = '';
      toast(lines.length > 50 ? 'Added the first 50. Paste the rest in another batch.' : 'Added ' + batch.length + (batch.length === 1 ? ' story' : ' stories'));
    });
  });
  $('#queueClearBtn').addEventListener('click', function () { rpc('queue_remove', { p_id: null }).then(useRoom); });

  var reacts = $('#reacts');
  REACTS.forEach(function (r) { reacts.append(h('button', { type: 'button', 'aria-label': r[1], title: r[1], onclick: function () { react(r[0]); } }, r[0])); });

  $('#specBtn').addEventListener('click', function () {
    me.spec = !me.spec; myVote = null;
    store.set('pp.spec', me.spec ? '1' : '0');
    render();
    rpc('set_spectator', { p_spectator: me.spec });
  });
  $('#inviteBtn').addEventListener('click', function () {
    var link = location.href.split('#')[0] + '#' + code;
    copyText(link, 'Invite link copied', 'Room code: ' + code);
  });
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#leaveBtn').addEventListener('click', function () { $('#settingsDlg').close(); leaveTable(); });
  $('#newCodeBtn').addEventListener('click', function () { $('#code').value = newCode(); });
  $('#joinForm').addEventListener('submit', function (e) { e.preventDefault(); joinTable(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && onTable && sb) resync();
  });

  function hashCode() {
    var t = '';
    try { t = cleanCode(decodeURIComponent(location.hash.slice(1))); } catch (e) {}
    return ROOM_RE.test(t) ? t : '';
  }
  window.addEventListener('hashchange', function () { var c = hashCode(); if (c && !onTable) $('#code').value = c; });

  applyBrand();
  $('#nick').value = store.get('pp.nick') || '';
  $('#code').value = hashCode() || store.get('pp.room') || newCode();
  $('#spec').checked = store.get('pp.spec') === '1';
  if (!sb) $('#setupNote').hidden = false;
})();
