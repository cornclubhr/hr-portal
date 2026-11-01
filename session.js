/**
 * session.js — the session token and the company scope, in one place.
 *
 * WHY A FETCH WRAPPER
 * -------------------
 * Fourteen UI modules each define their own callApi(). Threading a token and a
 * company through all of them by hand would mean fourteen chances to forget
 * one — and a forgotten company filter is how one brand ends up seeing
 * another's payroll.
 *
 * So this wraps window.fetch once. Any request going to CONFIG.API_URL picks
 * up the current token and the selected company automatically. A module that
 * already sets company= explicitly keeps its own value.
 *
 * Load this AFTER config.js and BEFORE any *-ui.js.
 */
(function () {
  'use strict';

  const TOKEN_KEY   = 'hr_session_token';
  const COMPANY_KEY = 'hr_selected_company';
  const ALL = (typeof CONFIG !== 'undefined' && CONFIG.ALL_COMPANIES) || '__ALL__';

  // localStorage is unavailable in some privacy modes; never let that break the app.
  function store(key, val) {
    try { if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val); }
    catch (e) { /* in-memory only for this tab */ }
  }
  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  const S = {
    token: load(TOKEN_KEY) || '',
    email: '',
    role: '',
    company: load(COMPANY_KEY) || ALL,
    companies: [],          // what this user may see
    canSeeAll: true,
    listeners: []
  };

  const HRSession = {
    ALL: ALL,

    get token()   { return S.token; },
    get email()   { return S.email; },
    get role()    { return S.role; },
    get company() { return S.company; },
    get companies() { return S.companies.slice(); },

    /** True when a company is actually selected (not "all"). */
    get isScoped() { return S.company && S.company !== ALL; },

    /** The value to send as company=; empty string means every company. */
    get companyParam() { return this.isScoped ? S.company : ''; },

    setToken(t) {
      S.token = t || '';
      store(TOKEN_KEY, S.token || null);
    },

    setCompany(name) {
      const next = name || ALL;
      if (next === S.company) return;
      S.company = next;
      store(COMPANY_KEY, next);
      S.listeners.forEach(function (fn) {
        try { fn(next); } catch (e) { console.error('company change handler failed', e); }
      });
    },

    /** Run fn whenever the company changes. Used by every list screen. */
    onCompanyChange(fn) { if (typeof fn === 'function') S.listeners.push(fn); },

    clear() {
      S.token = ''; S.email = ''; S.role = '';
      store(TOKEN_KEY, null);
    },

    /**
     * Exchange a verified Google address for a server session.
     * The address is checked server-side — the browser list in config.js only
     * decides what to show.
     */
    async login(email) {
      const url = CONFIG.API_URL + '?method=authLogin&email=' + encodeURIComponent(email);
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      if (data && data.success) {
        this.setToken(data.token);
        S.email = data.email; S.role = data.role;
        S.companies = data.companies || [];
        S.canSeeAll = !(S.companies.length);
        // Someone restricted to a single company starts on it, and the
        // "All companies" option is never offered to them.
        if (!S.canSeeAll && (!this.isScoped || S.companies.indexOf(S.company) === -1)) {
          this.setCompany(S.companies[0]);
        }
      }
      return data;
    },

    /** Build the header dropdown from the Companies tab. */
    async renderCompanyPicker(selectEl) {
      if (!selectEl) return;
      try {
        const res = await fetch(CONFIG.API_URL + '?method=getCompanies&token=' +
                                encodeURIComponent(S.token) + '&_=' + Date.now(),
                                { cache: 'no-store' });
        const data = await res.json();
        const list = (data && data.success) ? (data.data || []) : [];
        S.canSeeAll = !!(data && data.canSeeAll);

        const names = list.map(function (c) { return c.name; });
        S.companies = names;

        selectEl.innerHTML =
          (S.canSeeAll ? '<option value="' + ALL + '">All companies</option>' : '') +
          names.map(function (n) {
            return '<option value="' + n.replace(/"/g, '&quot;') + '">' + n + '</option>';
          }).join('');

        // A stored choice that is no longer valid must not silently persist.
        if (this.isScoped && names.indexOf(S.company) === -1) {
          this.setCompany(S.canSeeAll ? ALL : (names[0] || ALL));
        }
        selectEl.value = S.company;
        selectEl.disabled = (names.length <= 1 && !S.canSeeAll);

        selectEl.onchange = function () { HRSession.setCompany(selectEl.value); };
      } catch (err) {
        console.error('could not load companies', err);
        selectEl.innerHTML = '<option value="' + ALL + '">All companies</option>';
      }
    }
  };

  /* ------------------------------------------------------------------
   * The wrapper. Every call to the Apps Script endpoint carries the token,
   * and the selected company unless the caller named one itself.
   * ---------------------------------------------------------------- */
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      const isRequest = (typeof Request !== 'undefined') && (input instanceof Request);
      let url = isRequest ? input.url : String(input);

      if (typeof CONFIG !== 'undefined' && CONFIG.API_URL && url.indexOf(CONFIG.API_URL) === 0) {
        const sep = url.indexOf('?') === -1 ? '?' : '&';
        const add = [];
        if (S.token && !/[?&]token=/.test(url)) {
          add.push('token=' + encodeURIComponent(S.token));
        }
        if (!/[?&]company=/.test(url) && HRSession.isScoped) {
          add.push('company=' + encodeURIComponent(S.company));
        }
        if (add.length) {
          url = url + sep + add.join('&');
          if (isRequest) {
            return nativeFetch(new Request(url, input), init);
          }
          return nativeFetch(url, init);
        }
      }
    } catch (e) {
      // never let the wrapper break a request it does not understand
    }
    return nativeFetch(input, init);
  };

  window.HRSession = HRSession;

  /* ------------------------------------------------------------------
   * Theme. The choice is remembered per browser; with none saved the page
   * follows the operating system and keeps following it.
   * ---------------------------------------------------------------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-bs-theme', t);
    const btn = document.getElementById('themeToggle');
    if (btn) {
      const icon = btn.querySelector('i');
      if (icon) icon.className = (t === 'dark') ? 'bi bi-sun' : 'bi bi-moon-stars';
      btn.title = (t === 'dark') ? 'Switch to light' : 'Switch to dark';
    }
  }
  function currentTheme() {
    return document.documentElement.getAttribute('data-bs-theme') || 'light';
  }
  document.addEventListener('DOMContentLoaded', function () {
    applyTheme(currentTheme());

    // The rail mark comes from the organisation's own name, not a letter
    // baked into the markup. No name set, no letter - just the app icon.
    const logo = document.getElementById('sidebarLogo');
    if (logo && !logo.textContent.trim()) {
      const name = ((typeof CONFIG !== 'undefined' && CONFIG.COMPANY_NAME) || '').trim();
      if (name) {
        logo.textContent = name.charAt(0).toUpperCase();
        logo.title = name;
      } else {
        logo.innerHTML = '<i class="bi bi-people-fill"></i>';
      }
    }
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      store('hr_theme', next);
    });
  });
  // With nothing chosen, follow the system if it changes.
  if (window.matchMedia) {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        if (!load('hr_theme')) applyTheme(e.matches ? 'dark' : 'light');
      });
    } catch (err) { /* older browsers */ }
  }
})();
