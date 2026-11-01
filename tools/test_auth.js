/**
 * Behavioural test for the auth gate.
 *
 * Apps Script globals are stubbed just enough to run Config.js, Auth.js and
 * Employees.js in Node, then the gate is exercised against real method names.
 * This proves the gate blocks and admits the right things — syntax checks do not.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');

const GAS = '/home/claude/naeem-hr/gas';

// ---- in-memory spreadsheet -------------------------------------------------
const TABS = {};
function makeSheet(name, rows) {
  TABS[name] = rows || [];
  return sheetApi(name);
}
function sheetApi(name) {
  return {
    getName: () => name,
    appendRow: r => { TABS[name].push(r.slice()); },
    getDataRange: () => ({ getValues: () => TABS[name].map(r => r.slice()) }),
    getRange: () => ({ setFontWeight: () => {}, setValue: () => {}, setNumberFormat: () => {} }),
    setFrozenRows: () => {}, hideSheet: () => {},
    deleteRow: i => { TABS[name].splice(i - 1, 1); },
    getLastRow: () => TABS[name].length
  };
}

let PROPS = {};
const sandbox = {
  console,
  PropertiesService: {
    getScriptProperties: () => ({
      getProperties: () => Object.assign({}, PROPS),
      setProperty: (k, v) => { PROPS[k] = String(v); }
    })
  },
  SpreadsheetApp: {
    openById: () => ({
      getSheetByName: n => (n in TABS ? sheetApi(n) : null),
      insertSheet: n => makeSheet(n, [])
    })
  },
  Utilities: {
    getUuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    })
  },
  Session: { getScriptTimeZone: () => 'Asia/Kuwait' },
  Logger: { log: () => {} },
  MailApp: { sendEmail: () => {} },
  ContentService: { createTextOutput: s => ({ setMimeType: () => s }), MimeType: { JSON: 'json' } }
};
// A vm context has its own realm, so a Date built out here would fail
// `instanceof Date` inside it. Share the constructor so the code under test
// sees exactly what Apps Script would.
sandbox.Date = Date;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['Config.js', 'Auth.js', 'Employees.js']) {
  vm.runInContext(fs.readFileSync(`${GAS}/${f}`, 'utf8'), sandbox, { filename: f });
}

// ---- fixtures --------------------------------------------------------------
let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}

makeSheet('Employees', [
  ['Employee ID', 'Name (English)', 'Company', 'Payroll Cycle', 'Location', 'Status', 'Basic Salary', 'IBAN', 'Civil ID'],
  ['HR-EMP-00001', 'Aisha',  'Corn Club',   '12', 'Hawalli', 'Active',   300, 'KW11AAA', '111'],
  ['HR-EMP-00002', 'Bilal',  'Good People', '24', 'Hawalli', 'Active',   250, 'KW22BBB', '222'],
  ['HR-EMP-00003', 'Chandra','Corn Club',   '24', 'Jahra',   'Active',   280, 'KW33CCC', '333'],
  ['HR-EMP-00004', 'Deepak', 'Dark',        '12', 'Hawalli', 'Inactive', 200, 'KW44DDD', '444']
]);

console.log('\n=== 1. an unconfigured deployment refuses everything non-kiosk ===');
PROPS = { MAIN_SPREADSHEET_ID: 'sheet1' };
vm.runInContext('_cfgCache=null;_cfgSheetCache=null;_empCache=null;', sandbox);
check('getPayrollData blocked', sandbox.authGuard_('getPayrollData', {}).ok, false);
check('kiosk login still allowed', sandbox.authGuard_('loginStaffKiosk', {}).ok, true);

console.log('\n=== 2. configured, but no token ===');
PROPS = {
  MAIN_SPREADSHEET_ID: 'sheet1',
  ADMIN_EMAILS: 'naeem@example.com',
  HR_MANAGER_EMAILS: 'hr@example.com',
  SUPERVISOR_EMAILS: 'sup@example.com',
  'COMPANY_SCOPE_sup@example.com': 'Corn Club'
};
vm.runInContext('_cfgCache=null;_cfgSheetCache=null;_empCache=null;', sandbox);
for (const m of ['getPayrollData', 'saveEmployee', 'approvePendingOt', 'getEmployees']) {
  check(`${m} blocked without a token`, sandbox.authGuard_(m, {}).ok, false);
}
console.log('  -- the five kiosk methods stay open --');
for (const m of ['loginStaffKiosk', 'markKioskAttendance', 'getDailyKioskStatus', 'submitOtRequest']) {
  check(`${m} public`, sandbox.authGuard_(m, {}).ok, true);
}

console.log('\n=== 3. login ===');
check('unknown address refused', sandbox.authLogin({ email: 'nobody@example.com' }).success, false);
const admin = sandbox.authLogin({ email: 'naeem@example.com' });
check('admin admitted', admin.success, true);
check('admin role', admin.role, 'admin');
check('admin sees sensitive', admin.canSeeSensitive, true);
const sup = sandbox.authLogin({ email: 'sup@example.com' });
check('supervisor role', sup.role, 'supervisor');
check('supervisor scoped to one company', sup.companies, ['corn club']);
check('supervisor cannot see sensitive', sup.canSeeSensitive, false);

console.log('\n=== 4. a token gets you through ===');
check('admin token admits getPayrollData', sandbox.authGuard_('getPayrollData', { token: admin.token }).ok, true);
check('garbage token refused', sandbox.authGuard_('getPayrollData', { token: 'nope' }).ok, false);

console.log('\n=== 5. company scope is a ceiling, not a preference ===');
const supScope = sandbox.authScope_({ token: sup.token });
const supRows = sandbox.empRows_({ scope: supScope });
check('supervisor sees only Corn Club', supRows.map(r => r.name), ['Aisha', 'Chandra']);

const widened = sandbox.empRows_({ company: 'Good People', scope: supScope });
check('supervisor cannot widen to another company', widened.length, 0);

const adminRows = sandbox.empRows_({ scope: sandbox.authScope_({ token: admin.token }) });
check('admin sees all active', adminRows.map(r => r.name), ['Aisha', 'Bilal', 'Chandra']);

console.log('\n=== 6. filters ===');
check('cycle 12 only', sandbox.empRows_({ cycle: '12' }).map(r => r.name), ['Aisha']);
check('cycle 24 only', sandbox.empRows_({ cycle: '24' }).map(r => r.name), ['Bilal', 'Chandra']);
check('company + cycle', sandbox.empRows_({ company: 'Corn Club', cycle: '24' }).map(r => r.name), ['Chandra']);
check('inactive excluded by default', sandbox.empRows_({}).map(r => r.name), ['Aisha', 'Bilal', 'Chandra']);
check('status * includes inactive', sandbox.empRows_({ status: '*' }).length, 4);
check('location filter', sandbox.empRows_({ location: 'Jahra' }).map(r => r.name), ['Chandra']);

console.log('\n=== 7. sensitive columns ===');
check('withheld by default', sandbox.empRows_({})[0].iban, undefined);
check('returned when asked and allowed', sandbox.empRows_({ includeSensitive: true })[0].iban, 'KW11AAA');
const viaApi = sandbox.getEmployeesScoped({ token: sup.token, includeSensitive: true });
check('supervisor asking for sensitive gets none', viaApi.employees[0].iban, undefined);

console.log('\n=== 8. next employee id uses the configured prefix ===');
PROPS.EMPLOYEE_ID_PREFIX = 'HR-EMP-';
vm.runInContext('_cfgCache=null;_cfgSheetCache=null;_empCache=null;', sandbox);
check('next id', sandbox.empNextId_(), 'HR-EMP-00005');

console.log(`\n${fail === 0 ? 'ALL AUTH TESTS PASS' : fail + ' FAILURES'}  (${pass} passed)`);
process.exit(fail ? 1 : 0);
