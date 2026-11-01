/**
 * AutoSetup.js — the workbook builds itself.
 *
 * There is nothing to run by hand. Every tab, header and default setting is
 * created the first time either of these happens:
 *
 *   - the spreadsheet is opened          (onOpen, a simple trigger)
 *   - the web app receives its first call (ensureWorkbook_, from handleRequest)
 *
 * After that it is a single cached property read per execution, so it costs
 * nothing to leave in the request path. Bump SCHEMA_VERSION when a tab or a
 * column is added and every deployment picks the change up on its next use.
 *
 * It only ever ADDS. No tab is cleared, no column reordered, no value
 * overwritten — so running it against a workbook full of real data is safe.
 */

/** Raise this when SETUP_TABS or SETUP_SETTINGS changes. */
const SCHEMA_VERSION = '4';
const SCHEMA_KEY = 'WORKBOOK_SCHEMA_VERSION';

/**
 * The address that owns this deployment.
 *
 * One line, deliberately. It seeds ADMIN_EMAILS on the very first run so the
 * system is usable the moment it is deployed, rather than refusing everything
 * until somebody sets a Script Property. Changing the owner later is done in
 * Script Properties, not here — this value is only ever read when nothing is
 * configured yet.
 */
const DEPLOYMENT_OWNER_EMAIL = 'cornclubhr@gmail.com';

/* ------------------------------------------------------------------ guards */

var _ensuredThisExecution = false;

/**
 * Make sure the workbook has everything, exactly once per execution and in
 * full only when the schema has moved on.
 *
 * @param {boolean} [force] rebuild the check even if the version matches
 */
function ensureWorkbook_(force) {
  if (_ensuredThisExecution && !force) return { ok: true, skipped: 'already this run' };
  _ensuredThisExecution = true;
  try {
    if (!force && cfg_(SCHEMA_KEY, '') === SCHEMA_VERSION) {
      return { ok: true, skipped: 'up to date' };
    }
    const result = buildWorkbook_();
    cfgSet_(SCHEMA_KEY, SCHEMA_VERSION);
    return { ok: true, built: result };
  } catch (err) {
    // Never let setup take the whole request down. A caller that genuinely
    // needs a missing tab will say so itself, with a clearer message.
    try { Logger.log('ensureWorkbook_ failed: ' + err); } catch (e) {}
    return { ok: false, error: String(err) };
  }
}

/**
 * Create every tab, add missing headers, seed settings. Idempotent.
 * Shared by onOpen, the first web request, and the menu item.
 */
function buildWorkbook_() {
  const ss = resolveWorkbook_();
  const made = [], updated = [];

  Object.keys(SETUP_TABS).forEach(function (name) {
    const headers = SETUP_TABS[name];
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.appendRow(headers);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sh.setFrozenRows(1);
      made.push(name);
      return;
    }
    const last = Math.max(sh.getLastColumn(), 1);
    const H = sh.getRange(1, 1, 1, last).getValues()[0]
                .map(function (h) { return String(h).trim().toLowerCase(); });
    var added = 0;
    headers.forEach(function (h) {
      if (H.indexOf(h.toLowerCase()) === -1) {
        sh.getRange(1, sh.getLastColumn() + 1).setValue(h).setFontWeight('bold');
        H.push(h.toLowerCase());
        added++;
      }
    });
    if (added) updated.push(name + ' (+' + added + ')');
  });

  // Settings: only keys that are not already present.
  const set = ss.getSheetByName(ADMIN_SETTINGS_TAB);
  var seeded = 0;
  if (set) {
    const have = {};
    set.getDataRange().getValues().slice(1).forEach(function (r) {
      have[String(r[0]).trim().toUpperCase()] = true;
    });
    SETUP_SETTINGS.forEach(function (row) {
      if (!have[String(row[0]).toUpperCase()]) { set.appendRow(row); seeded++; }
    });
  }

  // The owner, so the system is usable immediately rather than locked shut.
  var ownerSeeded = false;
  if (!adminEmails_().length && DEPLOYMENT_OWNER_EMAIL) {
    cfgSet_(CFG_KEYS.ADMIN_EMAILS, DEPLOYMENT_OWNER_EMAIL);
    ownerSeeded = true;
  }
  return { created: made, updated: updated, seeded: seeded, ownerSeeded: ownerSeeded };
}

/**
 * The workbook this script belongs to.
 *
 * A container-bound script knows its own spreadsheet, so there is no id to
 * copy anywhere. The id is remembered the first time it is resolved, which
 * also makes the standalone case work once it has been set by hand.
 */
function resolveWorkbook_() {
  const configured = cfg_(CFG_KEYS.MAIN_SPREADSHEET_ID, '');
  if (configured) {
    try { return SpreadsheetApp.openById(configured); } catch (err) { /* fall through */ }
  }
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (err) { ss = null; }
  if (!ss) {
    throw new Error(
      'No workbook. This script should be bound to a Google Sheet ' +
      '(open the Sheet, Extensions > Apps Script). If it is standalone, set ' +
      'MAIN_SPREADSHEET_ID in Script Properties.');
  }
  if (!configured) cfgSet_(CFG_KEYS.MAIN_SPREADSHEET_ID, ss.getId());
  return ss;
}

/* ------------------------------------------------------------------ onOpen */

/**
 * Simple trigger: runs whenever someone opens the spreadsheet.
 *
 * Builds anything missing and adds a menu, so the first person to open the
 * sheet after deployment gets a working system without being told to run
 * anything.
 */
function onOpen(e) {
  try {
    ensureWorkbook_();
  } catch (err) { /* a broken setup must not stop the sheet opening */ }
  try {
    SpreadsheetApp.getUi()
      .createMenu('HR System')
      .addItem('Check setup', 'menuCheckSetup_')
      .addItem('Rebuild missing tabs', 'menuRebuild_')
      .addSeparator()
      .addItem('Preview employee import', 'menuPreviewImport_')
      .addItem('Commit employee import', 'menuCommitImport_')
      .addToUi();
  } catch (err) { /* no UI in a trigger context */ }
}

function menuCheckSetup_() {
  const r = checkDeployment();
  const lines = [];
  lines.push(r.ready ? 'Ready to use.' : 'Not ready yet.');
  if (r.summary) {
    lines.push('');
    lines.push('Employees: ' + r.summary.employees +
               '   Companies: ' + r.summary.companies +
               '   Cycles: ' + r.summary.cycles);
  }
  if (r.problems && r.problems.length) {
    lines.push('');
    lines.push('To fix:');
    r.problems.slice(0, 12).forEach(function (p) { lines.push('  - ' + p); });
  }
  if (r.notes && r.notes.length) {
    lines.push('');
    r.notes.forEach(function (n) { lines.push('  note: ' + n); });
  }
  uiAlert_('Setup check', lines.join('\n'));
}

function menuRebuild_() {
  const r = ensureWorkbook_(true);
  if (!r.ok) { uiAlert_('Rebuild failed', r.error); return; }
  const b = r.built || {};
  uiAlert_('Rebuild done',
    'Tabs created: ' + ((b.created || []).join(', ') || 'none') + '\n' +
    'Tabs updated: ' + ((b.updated || []).join(', ') || 'none') + '\n' +
    'Settings seeded: ' + (b.seeded || 0) + '\n\n' +
    'Nothing was cleared or overwritten.');
}

function menuPreviewImport_() {
  const r = previewImportEmployees({});
  uiAlert_('Import preview', r.message || r.error || 'No result.');
}

function menuCommitImport_() {
  const r = commitImportEmployees({});
  uiAlert_('Import', r.message || r.error || 'No result.');
}

function uiAlert_(title, body) {
  try {
    SpreadsheetApp.getUi().alert(title, String(body).slice(0, 1400), SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    Logger.log(title + '\n' + body);
  }
}

/**
 * What setup did, for the frontend. Useful right after deploying, before
 * anyone has opened the sheet.
 */
function getSetupStatus() {
  try {
    const r = ensureWorkbook_();
    const ss = resolveWorkbook_();
    const tabs = ss.getSheets().map(function (s) { return s.getName(); });
    const missing = Object.keys(SETUP_TABS).filter(function (t) { return tabs.indexOf(t) === -1; });
    return {
      success: true,
      schemaVersion: SCHEMA_VERSION,
      workbook: ss.getName(),
      tabs: tabs.length,
      missingTabs: missing,
      ensure: r,
      adminsConfigured: adminEmails_().length
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}
