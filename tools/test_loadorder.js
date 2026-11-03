/**
 * Does the script even LOAD?
 *
 * Apps Script evaluates every file into one global scope, in the order the
 * project lists them — alphabetical. A top-level `const` in a later file is in
 * the temporal dead zone for an earlier one, so a line like
 *
 *     const DOB_STAFF_TAB = HR_TAB;        // DateOfBirth.js
 *
 * where HR_TAB lives in Employees.js throws ReferenceError at LOAD time. That
 * kills every request to the web app, not just the module that did it.
 *
 * The other harnesses concatenate files in dependency order, which is exactly
 * what hides this. This one concatenates them the way Google does: sorted by
 * filename. If the bundle evaluates, the deployment boots.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const { GAS, WEB } = require('./paths');

const files = fs.readdirSync(GAS).filter(f => f.endsWith('.js')).sort();

let TABS = {};
function sheetApi(name) {
  return {
    getName: () => name,
    appendRow: r => TABS[name].push(r.slice()),
    getDataRange: () => ({ getValues: () => TABS[name].map(r => r.slice()) }),
    getLastColumn: () => TABS[name].length ? Math.max(...TABS[name].map(r => r.length)) : 0,
    getLastRow: () => TABS[name].length,
    clear: () => { TABS[name] = []; },
    getRange: () => ({
      getValues: () => [[]], setValue: () => ({ setFontWeight: () => {} }),
      setValues: () => {}, setFontWeight: () => ({ setFontWeight: () => {} }),
      setNumberFormat: () => {}, clearContent: () => {}
    }),
    setFrozenRows: () => {}, hideSheet: () => {}, deleteRow: () => {}
  };
}
const SS = {
  getId: () => 'SHEET-ID-1',
  getName: () => 'HR Master',
  getSheetByName: n => (n in TABS ? sheetApi(n) : null),
  insertSheet: n => { TABS[n] = []; return sheetApi(n); },
  getSheets: () => Object.keys(TABS).map(sheetApi)
};
const sandbox = {
  console,
  PropertiesService: { getScriptProperties: () => ({
    getProperties: () => ({}), getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: {
    openById: () => SS, getActiveSpreadsheet: () => SS,
    getUi: () => { throw new Error('no ui'); }, flush: () => {}
  },
  Utilities: {
    getUuid: () => 'u' + Math.random().toString(16).slice(2),
    formatDate: () => '01-01-2026', sleep: () => {},
    computeDigest: () => [1, 2, 3], DigestAlgorithm: { MD5: 'md5', SHA_256: 'sha256' },
    base64Encode: s => String(s), newBlob: () => ({ getBytes: () => [] })
  },
  Session: { getScriptTimeZone: () => 'Asia/Kuwait', getActiveUser: () => ({ getEmail: () => '' }) },
  Logger: { log: () => {} },
  MailApp: { sendEmail: () => {} },
  GmailApp: { sendEmail: () => {} },
  DriveApp: { getFileById: () => ({ getName: () => 'x' }), createFile: () => ({}) },
  UrlFetchApp: { fetch: () => ({ getContentText: () => '{}' }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {}, tryLock: () => true }) },
  ScriptApp: {
    getProjectTriggers: () => [], newTrigger: () => ({
      timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create: () => {} }) }) })
    }), deleteTrigger: () => {}
  },
  HtmlService: { createHtmlOutput: s => s, createTemplateFromFile: () => ({ evaluate: () => '' }) },
  ContentService: { createTextOutput: s => ({ setMimeType: () => s }), MimeType: { JSON: 'json' } },
  DocumentApp: {}, SitesApp: {}, CalendarApp: {}, FormApp: {}
};
sandbox.Date = Date;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

console.log(`\n=== evaluating ${files.length} files in Apps Script load order ===`);
console.log(`    ${files[0]} … ${files[files.length - 1]}\n`);

const bundle = files
  .map(f => `\n//<<< ${f} >>>\n` + fs.readFileSync(`${GAS}/${f}`, 'utf8'))
  .join('\n;\n');

let pass = 0, fail = 0;
try {
  vm.runInContext(bundle, sandbox, { filename: 'apps-script-bundle.js' });
  console.log('  PASS  the whole project evaluates with no top-level throw');
  pass++;
} catch (err) {
  // Work out WHICH file, by re-running one file at a time cumulatively.
  let culprit = '(unknown)';
  let acc = '';
  for (const f of files) {
    const next = acc + '\n;\n' + fs.readFileSync(`${GAS}/${f}`, 'utf8');
    const probe = {};
    Object.assign(probe, sandbox);
    probe.globalThis = probe;
    vm.createContext(probe);
    try { vm.runInContext(next, probe, { filename: f }); acc = next; }
    catch (e) { culprit = f; break; }
  }
  console.log(`  FAIL  ${err.name}: ${err.message}`);
  console.log(`        first file that fails to evaluate: ${culprit}`);
  fail++;
}

// The entry points Google calls must exist once the bundle is loaded.
['doGet', 'doPost', 'handleRequest', 'onOpen', 'ensureWorkbook_', 'authGuard_']
  .forEach(fn => {
    const ok = typeof sandbox[fn] === 'function';
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${fn} is defined after load`);
    ok ? pass++ : fail++;
  });

console.log(`\n${fail === 0 ? 'ALL LOAD-ORDER TESTS PASS' : fail + ' FAILURES'}  (${pass} passed)`);
process.exit(fail ? 1 : 0);
