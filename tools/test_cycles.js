/**
 * Period arithmetic for the two payroll cycles.
 *
 * The 12th and 24th runs each cover their own window. A window that ends on a
 * day earlier than it starts wraps into the previous month — that is the case
 * that silently produces wrong pay if it is got wrong, so it is tested hard,
 * including February and 31-day boundaries.
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
    getRange: () => ({ setFontWeight: () => {}, setValue: () => {}, setValues: () => {}, setNumberFormat: () => {} }),
    setFrozenRows: () => {}, hideSheet: () => {},
    deleteRow: i => TABS[name].splice(i - 1, 1),
    getLastRow: () => TABS[name].length
  };
}
let PROPS = { MAIN_SPREADSHEET_ID: 'sheet1', ADMIN_EMAILS: 'a@b.c' };
const sandbox = {
  console,
  PropertiesService: { getScriptProperties: () => ({
    getProperties: () => Object.assign({}, PROPS), setProperty: (k, v) => { PROPS[k] = String(v); } }) },
  SpreadsheetApp: { openById: () => ({
    getSheetByName: n => (n in TABS ? sheetApi(n) : null),
    insertSheet: n => { TABS[n] = []; return sheetApi(n); } }) },
  Utilities: { getUuid: () => 'u' + Math.random().toString(16).slice(2) },
  Session: { getScriptTimeZone: () => 'Asia/Kuwait' },
  Logger: { log: () => {} }, MailApp: { sendEmail: () => {} },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  ContentService: { createTextOutput: s => ({ setMimeType: () => s }), MimeType: { JSON: 'json' } }
};
// A vm context has its own realm, so a Date built out here would fail
// `instanceof Date` inside it. Share the constructor so the code under test
// sees exactly what Apps Script would.
sandbox.Date = Date;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['SharedUtils.js', 'Config.js', 'Auth.js', 'Employees.js', 'Companies.js']) {
  vm.runInContext(fs.readFileSync(`${GAS}/${f}`, 'utf8'), sandbox, { filename: f });
}

let pass = 0, fail = 0;
const d = x => `${String(x.getDate()).padStart(2, '0')}-${String(x.getMonth() + 1).padStart(2, '0')}-${x.getFullYear()}`;
function check(label, got, want) {
  const ok = got === want;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${got}  want ${want}`}`);
  ok ? pass++ : fail++;
}

// Naeem's two cycles, as they would be configured in the Payroll_Cycles tab.
TABS['Payroll_Cycles'] = [
  ['Cycle', 'Name', 'Period Start Day', 'Period End Day', 'Pay Day', 'Status', 'Notes'],
  ['12', 'Paid on the 12th', 11, 10, 12, 'Active', ''],
  ['24', 'Paid on the 24th', 23, 22, 24, 'Active', ''],
  ['EOM', 'Calendar month',   1, 28,  1, 'Active', 'does not wrap']
];

console.log('\n=== cycle 12: period 11th -> 10th, wraps into the previous month ===');
let p = sandbox.cyclePeriodFor_('12', new Date(2026, 10, 5));     // Nov 2026
check('start', d(p.start), '11-10-2026');
check('end',   d(p.end),   '10-11-2026');

p = sandbox.cyclePeriodFor_('12', new Date(2027, 0, 5));          // Jan 2027 - year boundary
check('start crosses the year', d(p.start), '11-12-2026');
check('end',                    d(p.end),   '10-01-2027');

console.log('\n=== cycle 24: period 23rd -> 22nd ===');
p = sandbox.cyclePeriodFor_('24', new Date(2026, 10, 24));
check('start', d(p.start), '23-10-2026');
check('end',   d(p.end),   '22-11-2026');

console.log('\n=== the two cycles never overlap their own previous run ===');
const nov12 = sandbox.cyclePeriodFor_('12', new Date(2026, 10, 1));
const dec12 = sandbox.cyclePeriodFor_('12', new Date(2026, 11, 1));
check('December 12-cycle starts the day after November ended',
      d(new Date(nov12.end.getTime() + 86400000)), d(dec12.start));

console.log('\n=== a non-wrapping cycle stays inside one month ===');
p = sandbox.cyclePeriodFor_('EOM', new Date(2026, 10, 15));
check('start', d(p.start), '01-11-2026');
check('end',   d(p.end),   '28-11-2026');

console.log('\n=== short months: a day-31 window clamps, never rolls over ===');
TABS['Payroll_Cycles'].push(['LATE', 'Month end', 31, 30, 5, 'Active', '']);
vm.runInContext('_cfgCache=null;', sandbox);
p = sandbox.cyclePeriodFor_('LATE', new Date(2027, 1, 10));       // Feb 2027, 28 days
check('end clamps to the last day of February', d(p.end), '28-02-2027');
p = sandbox.cyclePeriodFor_('LATE', new Date(2028, 1, 10));       // Feb 2028, leap
check('leap February', d(p.end), '29-02-2028');

console.log('\n=== an unknown cycle is an error, never a silent default ===');
let threw = false;
try { sandbox.cyclePeriodFor_('99', new Date()); } catch (e) { threw = /Unknown payroll cycle/.test(e.message); }
check('throws on unknown cycle', threw, true);

console.log(`\n${fail === 0 ? 'ALL CYCLE TESTS PASS' : fail + ' FAILURES'}  (${pass} passed)`);
process.exit(fail ? 1 : 0);
