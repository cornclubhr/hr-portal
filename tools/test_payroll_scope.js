/**
 * The bug this file exists to prove fixed:
 *
 * getLastPayrollEnd_ originally took the maximum Period End across the WHOLE of
 * Payroll_Control. Once a 12th-cycle run and a 24th-cycle run are interleaved,
 * the next run of either cycle would start from the other one's end date and
 * pay the wrong window. With six companies on two cycles that is twelve runs a
 * month all drawing from one unscoped lookup.
 *
 * Below: the unscoped answer is computed alongside the scoped one, so the test
 * shows both what would have happened and what now does.
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
    // real Sheets returns 0 for an empty sheet, never -Infinity
    getLastColumn: () => TABS[name].length ? Math.max(...TABS[name].map(r => r.length)) : 0,
    getLastRow: () => TABS[name].length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => {
        const out = [];
        for (let i = 0; i < (nr || 1); i++) {
          const row = TABS[name][r - 1 + i] || [];
          out.push(row.slice(c - 1, c - 1 + (nc || 1)));
        }
        return out;
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
let PROPS = { MAIN_SPREADSHEET_ID: 's1', ADMIN_EMAILS: 'a@b.c' };
const sandbox = {
  console,
  PropertiesService: { getScriptProperties: () => ({
    getProperties: () => Object.assign({}, PROPS), setProperty: (k, v) => { PROPS[k] = String(v); } }) },
  SpreadsheetApp: {
    openById: () => ({
      getSheetByName: n => (n in TABS ? sheetApi(n) : null),
      insertSheet: n => { TABS[n] = []; return sheetApi(n); }
    }),
    flush: () => {}
  },
  Utilities: {
    getUuid: () => 'u' + Math.random().toString(16).slice(2),
    formatDate: (d, tz, fmt) => {
      const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return String(d.getDate()).padStart(2, '0') + M[d.getMonth()];
    }
  },
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
vm.runInContext("var PAYROLL_CONTROL_TAB='Payroll_Control';", sandbox);
for (const f of ['SharedUtils.js', 'Config.js', 'Auth.js', 'Employees.js', 'Companies.js']) {
  vm.runInContext(fs.readFileSync(`${GAS}/${f}`, 'utf8'), sandbox, { filename: f });
}
vm.runInContext("var PAYROLL_CONTROL_HEADERS=['Run Date','Period Start','Period End','Employees','Total OT Hours','Tab Name','Status','Company','Cycle'];", sandbox);
// just the two functions under test, lifted out of their files
for (const [file, fn] of [['Payroll.js', 'logPayrollRun_'], ['PayrollReview.js', 'getLastPayrollEnd_']]) {
  const src = fs.readFileSync(`${GAS}/${file}`, 'utf8');
  const i = src.indexOf('function ' + fn);
  let j = src.indexOf('\n}\n', i);
  vm.runInContext(src.slice(i, j + 2), sandbox, { filename: file });
}
// helpers logPayrollRun_ depends on
for (const fn of ['payrollControlSheet_', 'payrollControlCols_']) {
  const src = fs.readFileSync(`${GAS}/Payroll.js`, 'utf8');
  const i = src.indexOf('function ' + fn);
  let j = src.indexOf('\n}\n', i);
  vm.runInContext(src.slice(i, j + 2), sandbox, { filename: 'Payroll.js' });
}
vm.runInContext("var PAYROLL_CONTROL_HEADERS=['Run Date','Period Start','Period End','Employees','Total OT Hours','Tab Name','Status','Company','Cycle'];", sandbox);

let pass = 0, fail = 0;
const d = x => x ? `${String(x.getDate()).padStart(2,'0')}-${String(x.getMonth()+1).padStart(2,'0')}-${x.getFullYear()}` : 'null';
function check(label, got, want) {
  const ok = got === want;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${got}  want ${want}`}`);
  ok ? pass++ : fail++;
}
/** what the ORIGINAL unscoped lookup would have returned */
function unscopedMax() {
  const rows = TABS['Payroll_Control'].slice(1);
  let latest = null;
  rows.forEach(r => { const e = sandbox.parseFlexibleDate_(r[2]); if (e && (!latest || e > latest)) latest = e; });
  return latest;
}

TABS['Payroll_Control'] = [];
const ss = sandbox.SpreadsheetApp.openById();

console.log('\n=== twelve runs a month: two cycles across two companies, interleaved ===');
// October: cycle 12 pays first, then cycle 24
sandbox.logPayrollRun_(ss, new Date(2026,8,11), new Date(2026,9,10), 130, 0, 'Payroll CornClub C12 11Sep-10Oct', 'review', 'Corn Club', '12');
sandbox.logPayrollRun_(ss, new Date(2026,8,11), new Date(2026,9,10),  23, 0, 'Payroll GoodPeople C12 11Sep-10Oct', 'review', 'Good People', '12');
sandbox.logPayrollRun_(ss, new Date(2026,8,23), new Date(2026,9,22), 130, 0, 'Payroll CornClub C24 23Sep-22Oct', 'review', 'Corn Club', '24');
sandbox.logPayrollRun_(ss, new Date(2026,8,23), new Date(2026,9,22),  23, 0, 'Payroll GoodPeople C24 23Sep-22Oct', 'review', 'Good People', '24');

console.log('  (the unscoped maximum across the whole sheet is ' + d(unscopedMax()) + ')');

check('Corn Club cycle 12 -> its own end',    d(sandbox.getLastPayrollEnd_(ss, 'Corn Club', '12')),   '10-10-2026');
check('Corn Club cycle 24 -> its own end',    d(sandbox.getLastPayrollEnd_(ss, 'Corn Club', '24')),   '22-10-2026');
check('Good People cycle 12 -> its own end',  d(sandbox.getLastPayrollEnd_(ss, 'Good People', '12')), '10-10-2026');
check('Good People cycle 24 -> its own end',  d(sandbox.getLastPayrollEnd_(ss, 'Good People', '24')), '22-10-2026');

console.log('\n=== the bug, stated plainly ===');
const unscoped = d(unscopedMax());
const scoped12 = d(sandbox.getLastPayrollEnd_(ss, 'Corn Club', '12'));
check('the unscoped answer differs from the cycle-12 answer', unscoped !== scoped12, true);
console.log(`        unscoped would start the next cycle-12 run the day after ${unscoped}`);
console.log(`        scoped   starts it the day after ${scoped12}  <- correct`);

console.log('\n=== a company that has never run returns null, not another company\'s date ===');
check('Dark cycle 12 has no history', d(sandbox.getLastPayrollEnd_(ss, 'Dark', '12')), 'null');
check('Corn Club on an unknown cycle', d(sandbox.getLastPayrollEnd_(ss, 'Corn Club', '99')), 'null');

console.log('\n=== November runs follow their own October run ===');
sandbox.logPayrollRun_(ss, new Date(2026,9,11), new Date(2026,10,10), 130, 0, 'Payroll CornClub C12 11Oct-10Nov', 'review', 'Corn Club', '12');
check('Corn Club 12 advanced', d(sandbox.getLastPayrollEnd_(ss, 'Corn Club', '12')), '10-11-2026');
check('Corn Club 24 did NOT move', d(sandbox.getLastPayrollEnd_(ss, 'Corn Club', '24')), '22-10-2026');
check('Good People 12 did NOT move', d(sandbox.getLastPayrollEnd_(ss, 'Good People', '12')), '10-10-2026');

console.log('\n=== a pre-split unscoped run seeds neither cycle ===');
TABS['Payroll_Control'].push(['01-01-2026','01-12-2025','31-12-2025',10,0,'Payroll old','OK','','']);
check('scoped lookup ignores the unscoped row', d(sandbox.getLastPayrollEnd_(ss, 'Corn Club', '12')), '10-11-2026');
check('unscoped lookup finds only unscoped rows', d(sandbox.getLastPayrollEnd_(ss, '', '')), '31-12-2025');

console.log(`\n${fail === 0 ? 'ALL PAYROLL SCOPE TESTS PASS' : fail + ' FAILURES'}  (${pass} passed)`);
process.exit(fail ? 1 : 0);
