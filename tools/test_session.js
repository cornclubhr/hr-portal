/**
 * session.js — the fetch wrapper that carries the token and company scope.
 *
 * Fourteen UI modules each have their own callApi(). They are not edited; this
 * wrapper adds the token and the selected company to every outbound call. If it
 * is wrong, every screen is wrong, so it is tested directly.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');

const calls = [];
const inits = [];
const store = {};
const sandbox = {
  console,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  Request: undefined,
  // session.js also sets up the theme toggle on load; stub just enough DOM
  // for that to run without touching what the fetch tests exercise.
  document: {
    documentElement: {
      _attrs: {},
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k] || null; }
    },
    getElementById: () => null,
    addEventListener: () => {}
  },
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  fetch: (url, init) => {
    calls.push(String(url));
    inits.push(init || null);
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        success: true, token: 'TOK123', email: 'hr@example.com', role: 'hr_manager',
        companies: [], canSeeAll: true,
        data: [{ name: 'Corn Club' }, { name: 'Good People' }, { name: 'Dark' }]
      })
    });
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
// config.js first, exactly as the browser loads it: a top-level `const`,
// reachable by bare name but never as window.CONFIG.
vm.runInContext(
  "const CONFIG = { API_URL: 'https://script.google.com/macros/s/ABC/exec'," +
  " ALL_COMPANIES: '__ALL__', COMPANY_NAME: 'Corn Club Group' };\n" +
  fs.readFileSync('/home/claude/naeem-hr/web/session.js', 'utf8'),
  sandbox, { filename: 'config+session.js' });
// what a UI module does: fetch(EXEC_URL + '?' + qs)
const API = 'https://script.google.com/macros/s/ABC/exec';
sandbox.fetchThrough = suffix => sandbox.fetch(API + (suffix.startsWith('?') ? suffix : ''));

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}
const S = sandbox.HRSession;
const last = () => calls[calls.length - 1];
const qp = (url, k) => { const m = String(url).match(new RegExp('[?&]' + k + '=([^&]*)')); return m ? decodeURIComponent(m[1]) : null; };

(async () => {
  console.log('\n=== before sign-in, nothing is added ===');
  await sandbox.fetchThrough('x');
  check('no token yet', qp(last(), 'token'), null);

  console.log('\n=== sign-in sends the SIGNED CREDENTIAL, never a bare email ===');
  // authLogin used to accept an email, which meant anyone could ask for a token
  // for a published address. The browser must hand over Google's signed token
  // and let the server verify it.
  const d = await S.login('HEADER.PAYLOAD.SIGNATURE');
  check('login succeeded', d.success, true);
  check('token kept', S.token, 'TOK123');
  const li = inits[inits.length - 1] || {};
  check('sent as POST', li.method, 'POST');
  check('text/plain, so no CORS preflight', (li.headers || {})['Content-Type'], 'text/plain;charset=utf-8');
  check('credential in the body', JSON.parse(li.body || '{}').credential, 'HEADER.PAYLOAD.SIGNATURE');
  check('no email on the wire', qp(last(), 'email'), null);
  check('no credential in the url either', qp(last(), 'credential'), null);

  console.log('\n=== every API call now carries the token ===');
  await sandbox.fetchThrough('?method=getEmployees');
  check('token appended', qp(last(), 'token'), 'TOK123');
  check('method preserved', qp(last(), 'method'), 'getEmployees');

  console.log('\n=== "all companies" adds no company filter ===');
  check('starts on all', S.company, '__ALL__');
  await sandbox.fetchThrough('?method=getEmployees');
  check('no company param', qp(last(), 'company'), null);

  console.log('\n=== choosing a company scopes every call ===');
  S.setCompany('Corn Club');
  await sandbox.fetchThrough('?method=getEmployees');
  check('company appended', qp(last(), 'company'), 'Corn Club');
  await sandbox.fetchThrough('?method=getAttendance&date=05-11-2026');
  check('and on a different method', qp(last(), 'company'), 'Corn Club');
  check('its own params survive', qp(last(), 'date'), '05-11-2026');

  console.log('\n=== a caller that names a company keeps its own ===');
  await sandbox.fetchThrough('?method=getPayrollReview&company=Dark');
  check('not overridden', qp(last(), 'company'), 'Dark');

  console.log('\n=== a caller that already has a token keeps its own ===');
  await sandbox.fetchThrough('?method=x&token=OTHER');
  check('not overridden', qp(last(), 'token'), 'OTHER');

  console.log('\n=== non-API requests are untouched ===');
  const before = calls.length;
  await sandbox.fetch('https://example.com/thing');
  check('passed straight through', last(), 'https://example.com/thing');
  check('one call made', calls.length, before + 1);

  console.log('\n=== the change handler fires once per change ===');
  let fired = [];
  S.onCompanyChange(c => fired.push(c));
  S.setCompany('Good People');
  S.setCompany('Good People');        // same value, must not fire again
  S.setCompany('__ALL__');
  check('fired twice', fired, ['Good People', '__ALL__']);

  console.log('\n=== sign-out drops the token ===');
  S.clear();
  check('token gone', S.token, '');
  await sandbox.fetchThrough('?method=getEmployees');
  check('no token on the wire', qp(last(), 'token'), null);

  console.log('\n=== a restricted user cannot sit on "all companies" ===');
  sandbox.fetch = (url) => {
    calls.push(String(url));
    return Promise.resolve({ ok: true, json: () => Promise.resolve({
      success: true, token: 'T2', email: 'sup@example.com', role: 'supervisor',
      companies: ['Corn Club'], canSeeAll: false }) });
  };
  await S.login('HEADER.PAYLOAD.SIGNATURE');
  check('moved off all-companies', S.company, 'Corn Club');
  check('scoped', S.isScoped, true);

  console.log(`\n${fail === 0 ? 'ALL SESSION TESTS PASS' : fail + ' FAILURES'}  (${pass} passed)`);
  process.exit(fail ? 1 : 0);
})();
