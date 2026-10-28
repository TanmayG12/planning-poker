/*
 * Themes.
 *
 * Every color in the app is a CSS variable. A theme is a light and a dark set
 * of those variables. Four themes ship with the app; an optional brand pack
 * (brand.json, kept outside the repo) can add more and a logo. Each person
 * picks a theme and light, dark or device mode; it's saved in their browser.
 */
(function () {
  'use strict';

  var TOKENS = ['page', 'surface', 'ink', 'muted', 'line', 'table', 'table-2', 'table-ink', 'table-muted', 'rail',
    'card', 'card-ink', 'card-red', 'accent', 'accent-ink', 'ok', 'warn', 'bad', 'focus', 'toast-bg', 'toast-ink'];

  var LIGHT_UI = { ok: '#17733D', warn: '#9A6514', bad: '#B4322A', focus: '#1F6FB8' };
  var DARK_UI = { ok: '#3CC47A', warn: '#E0A84A', bad: '#EF6B60', focus: '#8CC3FF' };
  function mk(base, ui, toastBg, toastInk) {
    var o = Object.assign({}, base, ui);
    o['toast-bg'] = toastBg; o['toast-ink'] = toastInk;
    return o;
  }

  var BUILTIN = {
    navy: {
      label: 'Navy',
      light: mk({ page: '#F1F3F8', surface: '#FFFFFF', ink: '#0E1830', muted: '#566176', line: '#DCE1EA', table: '#0B2D6B', 'table-2': '#082255', 'table-ink': '#FFFFFF', 'table-muted': '#BFCBE3', rail: '#C8102E', card: '#FFFFFF', 'card-ink': '#0E1830', 'card-red': '#C8102E', accent: '#C8102E', 'accent-ink': '#FFFFFF' }, LIGHT_UI, '#0E1830', '#FFFFFF'),
      dark: mk({ page: '#070C18', surface: '#101A2E', ink: '#E8ECF4', muted: '#9AA6BC', line: '#22304D', table: '#0F2F68', 'table-2': '#0A2350', 'table-ink': '#FFFFFF', 'table-muted': '#B4C2DE', rail: '#8E0C22', card: '#F6F7FA', 'card-ink': '#0E1830', 'card-red': '#C8102E', accent: '#D42638', 'accent-ink': '#FFFFFF' }, DARK_UI, '#E8ECF4', '#070C18')
    },
    crimson: {
      label: 'Crimson',
      light: mk({ page: '#F5F5F7', surface: '#FFFFFF', ink: '#14161D', muted: '#5B6070', line: '#DADCE3', table: '#C8102E', 'table-2': '#A00C24', 'table-ink': '#FFFFFF', 'table-muted': '#FFE1E5', rail: '#0B2D6B', card: '#FFFFFF', 'card-ink': '#14161D', 'card-red': '#C8102E', accent: '#0B2D6B', 'accent-ink': '#FFFFFF' }, LIGHT_UI, '#14161D', '#FFFFFF'),
      dark: mk({ page: '#0D0F16', surface: '#171A24', ink: '#ECEEF3', muted: '#A1A6B4', line: '#2A2E3B', table: '#9C1027', 'table-2': '#7C0C1F', 'table-ink': '#FFFFFF', 'table-muted': '#FFD6DC', rail: '#050812', card: '#F6F7FA', 'card-ink': '#14161D', 'card-red': '#C8102E', accent: '#FFFFFF', 'accent-ink': '#9C1027' }, DARK_UI, '#ECEEF3', '#0D0F16')
    },
    felt: {
      label: 'Felt',
      light: mk({ page: '#E6ECE8', surface: '#F7F9F7', ink: '#17211D', muted: '#53625A', line: '#C9D3CC', table: '#1E5544', 'table-2': '#16463A', 'table-ink': '#EAF3EE', 'table-muted': '#A8C3B6', rail: '#4E3420', card: '#FBF9F3', 'card-ink': '#1A1F1C', 'card-red': '#B4322A', accent: '#C99D40', 'accent-ink': '#1A1F1C' }, LIGHT_UI, '#17211D', '#F7F9F7'),
      dark: mk({ page: '#0E1714', surface: '#15211C', ink: '#E3ECE6', muted: '#93A59B', line: '#2A3A33', table: '#1A4A3B', 'table-2': '#123629', 'table-ink': '#E6F0EA', 'table-muted': '#9FBCAE', rail: '#3A2617', card: '#F2EEE3', 'card-ink': '#1A1F1C', 'card-red': '#B4322A', accent: '#D4AE57', 'accent-ink': '#1A1F1C' }, DARK_UI, '#E3ECE6', '#0E1714')
    },
    slate: {
      label: 'Slate',
      light: mk({ page: '#ECEFF3', surface: '#FFFFFF', ink: '#151A21', muted: '#59616E', line: '#D4D9E0', table: '#2A3441', 'table-2': '#212A35', 'table-ink': '#EEF2F7', 'table-muted': '#B1BBC8', rail: '#141A22', card: '#FFFFFF', 'card-ink': '#151A21', 'card-red': '#C2352B', accent: '#8FB8FF', 'accent-ink': '#0B1424' }, LIGHT_UI, '#151A21', '#FFFFFF'),
      dark: mk({ page: '#0E1116', surface: '#161B23', ink: '#E5E9EF', muted: '#949DAA', line: '#29303A', table: '#1F2833', 'table-2': '#18202A', 'table-ink': '#E9EEF4', 'table-muted': '#A3AEBB', rail: '#090C11', card: '#F4F6F9', 'card-ink': '#151A21', 'card-red': '#C2352B', accent: '#8FB8FF', 'accent-ink': '#0B1424' }, DARK_UI, '#E5E9EF', '#0E1116')
    }
  };

  function color(v) { return (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v)) ? v : null; }
  function str(v, n) { return typeof v === 'string' ? v.trim().slice(0, n) : ''; }
  function asset(v) { return (typeof v === 'string' && /^[\w][\w./-]*$/.test(v) && v.indexOf('..') < 0) ? 'brand/' + v : null; }
  function cleanMode(src, fallback) {
    var out = {};
    TOKENS.forEach(function (t) { out[t] = color(src && src[t]) || fallback[t]; });
    return out;
  }

  // ---------- optional brand pack ----------
  var raw = window.POKER_BRAND && typeof window.POKER_BRAND === 'object' ? window.POKER_BRAND : null;
  var brand = {
    appName: (raw && str(raw.appName, 40)) || 'Planning poker',
    logo: raw ? asset(raw.logo) : null,
    logoDark: raw ? asset(raw.logoDark) : null,
    logoAlt: (raw && str(raw.logoAlt, 60)) || '',
    defaultTheme: raw ? str(raw.defaultTheme, 40) : ''
  };

  var THEMES = {};
  if (raw && raw.themes && typeof raw.themes === 'object') {
    Object.keys(raw.themes).slice(0, 6).forEach(function (id) {
      if (!/^[a-z0-9-]{1,40}$/.test(id) || BUILTIN[id]) return;
      var t = raw.themes[id] || {};
      THEMES[id] = { label: str(t.label, 24) || id, light: cleanMode(t.light, BUILTIN.navy.light), dark: cleanMode(t.dark, BUILTIN.navy.dark) };
    });
  }
  Object.keys(BUILTIN).forEach(function (id) { THEMES[id] = BUILTIN[id]; });

  // ---------- applying ----------
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  var media = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  var themeId = store.get('pp.theme');
  if (!THEMES[themeId]) themeId = THEMES[brand.defaultTheme] ? brand.defaultTheme : 'navy';
  var mode = store.get('pp.mode');
  if (['light', 'dark', 'auto'].indexOf(mode) < 0) mode = 'auto';
  var listeners = [];

  function resolved() { return mode === 'auto' ? ((media && media.matches) ? 'dark' : 'light') : mode; }
  function apply() {
    var m = resolved();
    var set = THEMES[themeId][m];
    var root = document.documentElement;
    TOKENS.forEach(function (t) { root.style.setProperty('--' + t, set[t]); });
    root.style.colorScheme = m;
    root.setAttribute('data-mode', m);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', set.table);
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  if (media && media.addEventListener) media.addEventListener('change', function () { if (mode === 'auto') apply(); });

  window.PokerTheme = {
    brand: brand,
    themes: function () {
      return Object.keys(THEMES).map(function (id) {
        var t = THEMES[id][resolved()];
        return { id: id, label: THEMES[id].label, table: t.table, rail: t.rail, card: t.card, accent: t.accent };
      });
    },
    theme: function () { return themeId; },
    mode: function () { return mode; },
    resolvedMode: resolved,
    setTheme: function (id) { if (THEMES[id]) { themeId = id; store.set('pp.theme', id); apply(); } },
    setMode: function (m) { if (['light', 'dark', 'auto'].indexOf(m) >= 0) { mode = m; store.set('pp.mode', m); apply(); } },
    onChange: function (fn) { listeners.push(fn); },
    _builtin: BUILTIN
  };
  apply();
})();
