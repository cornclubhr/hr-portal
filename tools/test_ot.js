/**
 * Two-stage OT approval.
 *
 * What must hold:
 *   - a claim reaches OT_Entries only after BOTH a supervisor and HR approve
 *   - a supervisor cannot give final approval
 *   - neither stage can act on a claim outside their companies
 *   - stages cannot be skipped or replayed
 *   - the old single-stage endpoint cannot make anything payable
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const { GAS, WEB } = require('./paths');

const TABS = {};
function sheetApi(name) {
  return {
    getName: () => name,
    appendRow: r => TABS[name].push(r.slice()),
    getDataRange: () => ({ getValues: () => TABS[name].map(r => r.slice()) }),
    getLastColumn: () => TABS[name].length ? Math.max(...TABS[name].map(r => r.length)) : 0,
    getLastRow: () => TABS[name].length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => {
        const o = [];
        for (let i = 0; i < (nr || 1); i++) {
          const row = TABS[name][r - 1 + i] || [];
          const slice = row.slice(c - 1, c - 1 + (nc || 1));
          while (slice.length < (nc || 1)) slice.push('');
          o.push(slice);
        }
        return o;
      },
      setValue: v => {
        while (TABS[name].length < r) TABS[name].push([]);
        if (!TABS[name][r - 1]) TABS[name][r - 1] = [];
        while (TABS[name][r - 1].length < c - 1) TABS[name][r - 1].push('');
        TABS[name][r - 1][c - 1] = v;
        return { setFontWeight: () => {}, setNumberFormat: () => {} };
      },
      setValues: () => {}, setFontWeight: () => ({ setFontWeight: () => {} }),
      setNumberFormat: () => {}, clearContent: () => {}
    }),
    setFrozenRows: () => {}, hideSheet: () => {}, deleteRow: i => TABS[name].splice(i - 1, 1)
  };
}
let PROPS = { GOOGLE_CLIENT_ID: 'TEST-CLIENT-ID.apps.googleusercontent.com',
  MAIN_SPREADSHEET_ID: 's1',
  ADMIN_EMAILS: 'naeem@example.com',
  HR_MANAGER_EMAILS: 'hr@example.com',
  SUPERVISOR_EMAILS: 'sup.corn@example.com, sup.good@example.com',
  'COMPANY_SCOPE_sup.corn@example.com': 'Corn Club',
  'COMPANY_SCOPE_sup.good@example.com': 'Good People',
  OT_MAX_HOURS_PER_DAY: '12'
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
    getProperties: () => Object.assign({}, PROPS), setProperty: (k, v) => { PROPS[k] = String(v); } }) },
  SpreadsheetApp: { openById: () => ({
    getSheetByName: n => (n in TABS ? sheetApi(n) : null),
    insertSheet: n => { TABS[n] = []; return sheetApi(n); } }), flush: () => {} },
  Utilities: { getUuid: () => 'u' + Math.random().toString(16).slice(2) },
  Session: { getScriptTimeZone: () => 'Asia/Kuwait' },
  Logger: { log: () => {} }, MailApp: { sendEmail: () => {} },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  ContentService: { createTextOutput: s => ({ setMimeType: () => s }), MimeType: { JSON: 'json' } }
};
sandbox.Date = Date;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext("var OT_PENDING_TAB='OT_Pending'; var OT_ENTRIES_TAB='OT_Entries';", sandbox);
vm.runInContext(`function ensureOtPendingTab_(ss){
  let sh = ss.getSheetByName(OT_PENDING_TAB);
  if (!sh) { sh = ss.insertSheet(OT_PENDING_TAB);
    sh.appendRow(['ID','Employee ID','Name','Date','Hours','Source','Status','Submitted','Geo Flag','Computed OT']); }
  return sh; }`, sandbox);
for (const f of ['SharedUtils.js', 'Config.js', 'Auth.js', 'Employees.js', 'OtApproval.js']) {
  vm.runInContext(fs.readFileSync(`${GAS}/${f}`, 'utf8'), sandbox, { filename: f });
}

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}
const entries = () => (TABS['OT_Entries'] || []).slice(1);

TABS['Employees'] = [
  ['Employee ID', 'Name (English)', 'Company', 'Payroll Cycle', 'Location', 'Status'],
  ['HR-EMP-00001', 'Aisha',   'Corn Club',   '12', 'Hawalli', 'Active'],
  ['HR-EMP-00002', 'Bilal',   'Good People', '24', 'Hawalli', 'Active']
];
TABS['OT_Pending'] = [
  ['ID', 'Employee ID', 'Name', 'Date', 'Hours', 'Source', 'Status', 'Submitted', 'Geo Flag', 'Computed OT'],
  ['OT1', 'HR-EMP-00001', 'Aisha', '05-11-2026', 3, 'kiosk', 'Pending', '', '', ''],
  ['OT2', 'HR-EMP-00002', 'Bilal', '05-11-2026', 2, 'kiosk', 'Pending', '', '', '']
];
const admin   = sandbox.authLogin({ credential: 'GOOD:' + 'naeem@example.com' });
const hr      = sandbox.authLogin({ credential: 'GOOD:' + 'hr@example.com' });
const supCorn = sandbox.authLogin({ credential: 'GOOD:' + 'sup.corn@example.com' });
const supGood = sandbox.authLogin({ credential: 'GOOD:' + 'sup.good@example.com' });

console.log('\n=== the queue is scoped ===');
let q = sandbox.getOtForApproval({ token: supCorn.token, stage: 'supervisor' });
check('Corn Club supervisor sees only their own', q.rows.map(r => r.name), ['Aisha']);
q = sandbox.getOtForApproval({ token: supGood.token, stage: 'supervisor' });
check('Good People supervisor sees only theirs', q.rows.map(r => r.name), ['Bilal']);
check('supervisor cannot open the HR queue',
      sandbox.getOtForApproval({ token: supCorn.token, stage: 'hr' }).success, false);

console.log('\n=== stages cannot be skipped ===');
check('HR cannot approve a claim no supervisor has passed',
      sandbox.hrDecideOt({ token: hr.token, row: 2, decision: 'approve' }).success, false);
check('nothing posted', entries().length, 0);

console.log('\n=== a supervisor cannot act outside their companies ===');
check('Good People supervisor refused on a Corn Club claim',
      sandbox.supervisorDecideOt({ token: supGood.token, row: 2, decision: 'approve' }).success, false);

console.log('\n=== stage one ===');
let r = sandbox.supervisorDecideOt({ token: supCorn.token, row: 2, decision: 'approve', note: 'covered the close' });
check('supervisor approves', r.success, true);
check('status moves on', r.status, 'Supervisor Approved');
check('still NOT payable', entries().length, 0);
check('supervisor cannot approve twice',
      sandbox.supervisorDecideOt({ token: supCorn.token, row: 2, decision: 'approve' }).success, false);

console.log('\n=== a supervisor still cannot give final approval ===');
const supHr = sandbox.getOtForApproval({ token: supCorn.token, stage: 'hr' });
check('HR queue refused to the supervisor', supHr.success, false);

console.log('\n=== stage two ===');
q = sandbox.getOtForApproval({ token: hr.token, stage: 'hr' });
check('HR sees the passed claim', q.rows.map(r => r.name), ['Aisha']);
check('HR sees who passed it', q.rows[0].supervisorBy, 'sup.corn@example.com');

r = sandbox.hrDecideOt({ token: hr.token, row: 2, decision: 'approve' });
check('HR approves', r.success, true);
check('status final', r.status, 'HR Approved');
check('NOW it is payable', entries().length, 1);
check('posted hours', entries()[0][3], 3);
check('audit trail names HR', String(entries()[0][5]).indexOf('hr@example.com') !== -1, true);

console.log('\n=== an approver may correct the hours, and it is recorded ===');
r = sandbox.supervisorDecideOt({ token: supGood.token, row: 3, decision: 'approve', hours: 1.5 });
check('supervisor trims the claim', r.success, true);
r = sandbox.hrDecideOt({ token: hr.token, row: 3, decision: 'approve' });
check('HR approves the trimmed claim', r.success, true);
check('corrected hours posted, not the original', entries()[1][3], 1.5);

console.log('\n=== guards ===');
TABS['OT_Pending'].push(['OT3', 'HR-EMP-00001', 'Aisha', '06-11-2026', 3, 'kiosk', 'Pending', '', '', '']);
check('absurd hours refused',
      sandbox.supervisorDecideOt({ token: supCorn.token, row: 4, decision: 'approve', hours: 99 }).success, false);
check('unknown decision refused',
      sandbox.supervisorDecideOt({ token: supCorn.token, row: 4, decision: 'maybe' }).success, false);
check('no token, no verdict',
      sandbox.supervisorDecideOt({ row: 4, decision: 'approve' }).success, false);

console.log('\n=== the old single-stage endpoint cannot make anything payable ===');
const before = entries().length;
vm.runInContext(fs.readFileSync(`${GAS}/OtSubmit.js`, 'utf8').match(/function approvePendingOt[\s\S]*?\n}/)[0], sandbox);
const legacy = sandbox.approvePendingOt({ row: 4, hours: 5, by: 'anyone' });
check('refused', legacy.success, false);
check('code explains why', legacy.code, 'USE_TWO_STAGE');
check('nothing posted', entries().length, before);

console.log(`\n${fail === 0 ? 'ALL OT APPROVAL TESTS PASS' : fail + ' FAILURES'}  (${pass} passed)`);
process.exit(fail ? 1 : 0);
