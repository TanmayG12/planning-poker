/*
 * Themes.
 *
 * Every color in the app is a CSS variable. A theme is a light and a dark set
 * of those variables. Two themes ship with the app; a brand pack (brand.json,
 * kept outside the repo) can add more, plus a logo. Each person picks their
 * own theme and light, dark or device mode; it's saved in their browser.
 */
(function () {
  'use strict';

  var TOKENS = ['bg', 'surface', 'ink', 'muted', 'line', 'felt', 'felt-2', 'felt-ink', 'felt-muted', 'rail',
    'card', 'card-ink', 'card-red', 'accent', 'accent-ink', 'ok', 'warn', 'bad', 'focus', 'toast-bg', 'toast-ink'];

  var BUILTIN = {
    felt: {
      label: 'Card table',
      light: {
        bg: '#E4EAE5', surface: '#F6F8F6', ink: '#17211D', muted: '#53625A', line: '#C7D1CA',
        felt: '#1E5544', 'felt-2': '#16463A', 'felt-ink': '#EAF3EE', 'felt-muted': '#A8C3B6', rail: '#4E3420',
        card: '#FBF9F3', 'card-ink': '#1A1F1C', 'card-red': '#B4322A', accent: '#C99D40', 'accent-ink': '#1A1F1C',
        ok: '#2E7D4F', warn: '#9A6514', bad: '#B4322A', focus: '#1F6FB8', 'toast-bg': '#17211D', 'toast-ink': '#F6F8F6'
      },
      dark: {
        bg: '#0E1714', surface: '#15211C', ink: '#E3ECE6', muted: '#93A59B', line: '#2A3A33',
        felt: '#1A4A3B', 'felt-2': '#123629', 'felt-ink': '#E6F0EA', 'felt-muted': '#9FBCAE', rail: '#3A2617',
        card: '#F2EEE3', 'card-ink': '#1A1F1C', 'card-red': '#B4322A', accent: '#D4AE57', 'accent-ink': '#1A1F1C',
        ok: '#5CC08A', warn: '#E0A84A', bad: '#EF6B60', focus: '#8CC3FF', 'toast-bg': '#E3ECE6', 'toast-ink': '#0E1714'
      }
    },
    slate: {
      label: 'Slate',
      light: {
        bg: '#ECEFF3', surface: '#FFFFFF', ink: '#151A21', muted: '#59616E', line: '#D4D9E0',
        felt: '#2A3441', 'felt-2': '#212A35', 'felt-ink': '#EEF2F7', 'felt-muted': '#B1BBC8', rail: '#141A22',
        card: '#FFFFFF', 'card-ink': '#151A21', 'card-red': '#C2352B', accent: '#8FB8FF', 'accent-ink': '#0B1424',
        ok: '#2E7D4F', warn: '#9A6514', bad: '#B4322A', focus: '#1F6FB8', 'toast-bg': '#151A21', 'toast-ink': '#FFFFFF'
      },
      dark: {
        bg: '#0E1116', surface: '#161B23', ink: '#E5E9EF', muted: '#949DAA', line: '#29303A',
        felt: '#1F2833', 'felt-2': '#18202A', 'felt-ink': '#E9EEF4', 'felt-muted': '#A3AEBB', rail: '#090C11',
        card: '#F4F6F9', 'card-ink': '#151A21', 'card-red': '#C2352B', accent: '#8FB8FF', 'accent-ink': '#0B1424',
        ok: '#5CC08A', warn: '#E0A84A', bad: '#EF6B60', focus: '#8CC3FF', 'toast-bg': '#E5E9EF', 'toast-ink': '#0E1116'
      }
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

  // ---------- brand pack ----------
  var raw = window.POKER_BRAND && typeof window.POKER_BRAND === 'object' ? window.POKER_BRAND : null;
  var brand = {
    appName: (raw && str(raw.appName, 40)) || 'Planning poker',
    orgName: (raw && str(raw.orgName, 40)) || '',
    logo: raw ? asset(raw.logo) : null,
    logoDark: raw ? asset(raw.logoDark) : null,
    logoAlt: (raw && str(raw.logoAlt, 60)) || (raw && str(raw.orgName, 40)) || '',
    defaultTheme: raw ? str(raw.defaultTheme, 40) : ''
  };

  var THEMES = {};
  if (raw && raw.themes && typeof raw.themes === 'object') {
    Object.keys(raw.themes).slice(0, 6).forEach(function (id) {
      if (!/^[a-z0-9-]{1,40}$/.test(id) || BUILTIN[id]) return;
      var t = raw.themes[id] || {};
      THEMES[id] = {
        label: str(t.label, 30) || id,
        light: cleanMode(t.light, BUILTIN.felt.light),
        dark: cleanMode(t.dark, BUILTIN.felt.dark),
        brand: true
      };
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
  if (!THEMES[themeId]) themeId = THEMES[brand.defaultTheme] ? brand.defaultTheme : Object.keys(THEMES)[0];
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
    root.setAttribute('data-theme', themeId);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', set.bg);
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  if (media && media.addEventListener) media.addEventListener('change', function () { if (mode === 'auto') apply(); });

  window.PokerTheme = {
    brand: brand,
    themes: function () {
      return Object.keys(THEMES).map(function (id) {
        var t = THEMES[id];
        return { id: id, label: t.label, brand: !!t.brand, swatch: [t.light.felt, t.light.accent, t.light.card, t.dark.felt] };
      });
    },
    theme: function () { return themeId; },
    mode: function () { return mode; },
    resolvedMode: resolved,
    setTheme: function (id) { if (THEMES[id]) { themeId = id; store.set('pp.theme', id); apply(); } },
    setMode: function (m) { if (['light', 'dark', 'auto'].indexOf(m) >= 0) { mode = m; store.set('pp.mode', m); apply(); } },
    onChange: function (fn) { listeners.push(fn); }
  };

  apply();
})();
