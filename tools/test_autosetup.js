/**
 * The workbook builds itself.
 *
 * What must hold:
 *   - an empty spreadsheet gains every tab with the right headers, with nobody
 *     running anything
 *   - the owner can sign in immediately, without a Script Property being set
 *   - running it again adds nothing and destroys nothing
 *   - a tab holding real data is never cleared, and its extra columns survive
 *   - a new column in a later version is added to an existing tab
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const GAS = '/home/claude/naeem-hr/gas';

let TABS = {};
function sheetApi(name) {
  return {
    getName: () => name,
    appendRow: r => TABS[name].push(r.slice()),
    getDataRange: () => ({ getValues: () => TABS[name].map(r => r.slice()) }),
    getLastColumn: () => TABS[name].length ? Math.max(...TABS[name].map(r => r.length)) : 0,
    getLastRow: () => TABS[name].length,
    clear: () => { TABS[name] = []; },
    getRange: (r, c, nr, nc) => ({
      getValues: () => {
        const o = [];
        for (let i = 0; i < (nr || 1); i++) {
          const row = TABS[name][r - 1 + i] || [];
          const sl = row.slice(c - 1, c - 1 + (nc || 1));
          while (sl.length < (nc || 1)) sl.push('');
          o.push(sl);
        }
        return o;
      },
      setValue: v => {
        while (TABS[name].length < r) TABS[name].push([]);
        if (!TABS[name][r - 1]) TABS[name][r - 1] = [];
        while (TABS[name][r - 1].length < c - 1) TABS[name][r - 1].push('');
        TABS[name][r - 1][c - 1] = v;
        return { setFontWeight: () => {} };
      },
      setValues: () => {}, setFontWeight: () => ({ setFontWeight: () => {} }),
      setNumberFormat: () => {}, clearContent: () => {}
    }),
    setFrozenRows: () => {}, hideSheet: () => {}, deleteRow: i => TABS[name].splice(i - 1, 1)
  };
}
let PROPS = { GOOGLE_CLIENT_ID: 'TEST-CLIENT-ID.apps.googleusercontent.com' };
const SS = {
  getId: () => 'SHEET-ID-1',
  getName: () => 'HR Master',
  getSheetByName: n => (n in TABS ? sheetApi(n) : null),
  insertSheet: n => { TABS[n] = []; return sheetApi(n); },
  getSheets: () => Object.keys(TABS).map(sheetApi)
};
const sandbox = {
  console,
  // Fake Google tokeninfo. A valid credential is "GOOD:<email>"; anything else
  // is rejected the way Google rejects a forged or stale token. This is what
  // makes the authLogin tests meaningful: a bare email must buy nothing.
  UrlFetchApp: { fetch: (url) => {
    const m = String(url).match(/id_token=([^&]*)/);
    const tok = m ? decodeURIComponent(m[1]) : '';
    if (tok.indexOf('GOOD:') !== 0) {
      return { getResponseCode: () => 400, getContentText: () => '{"error":"invalid_token"}' };
    }
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({
      aud: 'TEST-CLIENT-ID.apps.googleusercontent.com',
      iss: 'https://accounts.google.com',
      email: tok.slice(5), email_verified: 'true',
      exp: String(Math.floor(Date.now() / 1000) + 3600)
    }) };
  } },
  PropertiesService: { getScriptProperties: () => ({
    getProperties: () => Object.assign({}, PROPS),
    setProperty: (k, v) => { PROPS[k] = String(v); } }) },
  SpreadsheetApp: {
    openById: () => SS,
    getActiveSpreadsheet: () => SS,
    getUi: () => { throw new Error('no ui'); },
    flush: () => {}
  },
  Utilities: { getUuid: () => 'u' + Math.random().toString(16).slice(2) },
  Session: { getScriptTimeZone: () => 'Asia/Kuwait' },
  Logger: { log: () => {} }, MailApp: { sendEmail: () => {} },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  ContentService: { createTextOutput: s => ({ setMimeType: () => s }), MimeType: { JSON: 'json' } }
};
sandbox.Date = Date;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
// Apps Script evaluates every file into ONE global scope, so a `const` in
// SetupWorkbook.js is visible from AutoSetup.js. Loading them as separate vm
// scripts would not reproduce that, and would hide real cross-file breakage.
// Concatenating is the faithful arrangement.
const FILES = ['SharedUtils.js', 'Config.js', 'Auth.js', 'Employees.js', 'Companies.js',
               'SetupWorkbook.js', 'AutoSetup.js'];
vm.runInContext(FILES.map(f => fs.readFileSync(`${GAS}/${f}`, 'utf8')).join('\n;\n'),
                sandbox, { filename: 'bundle.js' });
// expose the top-level consts the test asserts against
sandbox.SETUP_TABS = vm.runInContext('SETUP_TABS', sandbox);

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}
const reset = () => { vm.runInContext('_cfgCache=null;_cfgSheetCache=null;_empCache=null;_ensuredThisExecution=false;', sandbox); };

console.log('\n=== an empty workbook, nobody runs anything ===');
TABS = {}; PROPS = { GOOGLE_CLIENT_ID: 'TEST-CLIENT-ID.apps.googleusercontent.com' }; reset();
let r = sandbox.ensureWorkbook_();
check('setup ran', r.ok, true);
const expected = Object.keys(sandbox.SETUP_TABS);
check('every tab created', expected.filter(t => !(t in TABS)), []);
console.log('        ' + expected.length + ' tabs: ' + expected.slice(0, 5).join(', ') + ' …');

console.log('\n=== headers are right ===');
const emp = TABS['Employees'][0];
['Employee ID', 'Name (English)', 'Company', 'Payroll Cycle', 'PIN', 'IBAN', 'Basic Salary']
  .forEach(h => check('Employees has "' + h + '"', emp.indexOf(h) !== -1, true));
check('Payroll_Control has Cycle', TABS['Payroll_Control'][0].indexOf('Cycle') !== -1, true);
check('OT_Pending has the HR stage', TABS['OT_Pending'][0].indexOf('HR By') !== -1, true);

console.log('\n=== the owner can sign in straight away ===');
reset();
check('ADMIN_EMAILS seeded', sandbox.adminEmails_(), ['cornclubhr@gmail.com']);
const login = sandbox.authLogin({ credential: 'GOOD:' + 'cornclubhr@gmail.com' });
check('owner admitted', login.success, true);
check('as admin', login.role, 'admin');
check('a stranger is not', sandbox.authLogin({ credential: 'GOOD:' + 'someone@else.com' }).success, false);

console.log('\n=== the workbook id resolved itself ===');
check('no manual id needed', PROPS['MAIN_SPREADSHEET_ID'], 'SHEET-ID-1');

console.log('\n=== running again changes nothing ===');
const before = JSON.stringify(TABS);
reset();
r = sandbox.ensureWorkbook_();
check('skipped, version matches', !!r.skipped, true);
reset();
r = sandbox.ensureWorkbook_(true);            // forced
check('forced run creates nothing new', (r.built.created || []).length, 0);
check('nothing changed', JSON.stringify(TABS) === before, true);

console.log('\n=== real data is never touched ===');
TABS['Employees'].push(['HR-EMP-00001', 'Aisha', '', 'Corn Club', '12']);
TABS['Companies'].push(['Corn Club', 'CORN', '', '', 'Active', '']);
const rows = TABS['Employees'].length, comps = TABS['Companies'].length;
reset();
sandbox.ensureWorkbook_(true);
check('employee row still there', TABS['Employees'].length, rows);
check('company row still there', TABS['Companies'].length, comps);
check('the data itself', TABS['Employees'][1][1], 'Aisha');

console.log('\n=== a column added in a later version appears ===');
TABS['Companies'][0] = ['Name', 'Short Code'];     // an older, narrower tab
reset();
sandbox.ensureWorkbook_(true);
const ch = TABS['Companies'][0];
check('CR Number added', ch.indexOf('CR Number') !== -1, true);
check('Bank Account added', ch.indexOf('Bank Account') !== -1, true);
check('existing headers kept in place', ch.slice(0, 2), ['Name', 'Short Code']);

console.log('\n=== a configured owner is never overwritten ===');
TABS = {}; PROPS = { GOOGLE_CLIENT_ID: 'TEST-CLIENT-ID.apps.googleusercontent.com', ADMIN_EMAILS: 'someone.else@company.com' }; reset();
sandbox.ensureWorkbook_(true);
check('left alone', sandbox.adminEmails_(), ['someone.else@company.com']);

console.log('\n=== status report ===');
TABS = {}; PROPS = { GOOGLE_CLIENT_ID: 'TEST-CLIENT-ID.apps.googleusercontent.com' }; reset();
const st = sandbox.getSetupStatus();
check('reports success', st.success, true);
check('no missing tabs', st.missingTabs, []);
check('names the workbook', st.workbook, 'HR Master');

console.log(`\n${fail === 0 ? 'ALL AUTO-SETUP TESTS PASS' : fail + ' FAILURES'}  (${pass} passed)`);
process.exit(fail ? 1 : 0);
