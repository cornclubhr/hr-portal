/**
 * Config.js — every value that differs between one deployment and another.
 *
 * Nothing in this file is a hardcoded business value. Spreadsheet IDs, admin
 * addresses and tunables all come from Script Properties or the Admin_Settings
 * tab, so the same code runs for any company without being edited.
 *
 * Precedence, highest first:
 *   1. Script Properties   (File > Project Settings > Script Properties)
 *   2. Admin_Settings tab  (Key | Value | Notes)
 *   3. the default passed at the call site
 *
 * Script Properties win because they are per-deployment and are never exported
 * with the workbook. Admin_Settings is there so an HR manager can change a
 * setting without opening the script editor.
 *
 * First-run setup is in SetupWorkbook.js — `setupNewDeployment()`.
 */

/** Tab holding operator-editable settings. */
const ADMIN_SETTINGS_TAB = 'Admin_Settings';

/** Keys this deployment understands. Documented here, never scattered in code. */
const CFG_KEYS = {
  MAIN_SPREADSHEET_ID      : 'MAIN_SPREADSHEET_ID',
  PAYROLL_SPREADSHEET_ID   : 'PAYROLL_SPREADSHEET_ID',
  SOURCE_SPREADSHEET_ID    : 'SOURCE_SPREADSHEET_ID',
  STAFF_DOCS_SPREADSHEET_ID: 'STAFF_DOCS_SPREADSHEET_ID',
  ADMIN_EMAILS             : 'ADMIN_EMAILS',          // comma separated
  HR_MANAGER_EMAILS        : 'HR_MANAGER_EMAILS',     // comma separated
  API_TOKEN                : 'API_TOKEN',             // guards non-kiosk methods
  ORG_NAME                 : 'ORG_NAME',
  CURRENCY                 : 'CURRENCY',
  TIMEZONE                 : 'TIMEZONE'
};

/** In-memory cache for one execution. Script Properties cost a round trip. */
var _cfgCache = null;
var _cfgSheetCache = null;

/**
 * Read a setting. Script Properties first, then Admin_Settings, then fallback.
 * @param {string} key one of CFG_KEYS
 * @param {*} [fallback] used when neither source has the key
 */
function cfg_(key, fallback) {
  if (_cfgCache === null) {
    try {
      _cfgCache = PropertiesService.getScriptProperties().getProperties() || {};
    } catch (err) {
      _cfgCache = {};
    }
  }
  var v = _cfgCache[key];
  if (v !== undefined && String(v).trim() !== '') return String(v).trim();

  var fromSheet = cfgFromSheet_(key);
  if (fromSheet !== null) return fromSheet;

  return (fallback === undefined) ? '' : fallback;
}

/**
 * Admin_Settings lookup. Only attempted once the main workbook id is known,
 * otherwise this would recurse while resolving that very id.
 */
function cfgFromSheet_(key) {
  if (key === CFG_KEYS.MAIN_SPREADSHEET_ID) return null;   // would recurse
  try {
    if (_cfgSheetCache === null) {
      _cfgSheetCache = {};
      var id = cfg_(CFG_KEYS.MAIN_SPREADSHEET_ID, '');
      if (!id) return null;
      var sh = SpreadsheetApp.openById(id).getSheetByName(ADMIN_SETTINGS_TAB);
      if (!sh) return null;
      var d = sh.getDataRange().getValues();
      for (var i = 1; i < d.length; i++) {
        var k = String(d[i][0] || '').trim();
        if (k) _cfgSheetCache[k] = String(d[i][1] === undefined ? '' : d[i][1]).trim();
      }
    }
    var v = _cfgSheetCache[key];
    return (v !== undefined && v !== '') ? v : null;
  } catch (err) {
    return null;
  }
}

/** Write a setting to Script Properties and clear the cache. */
function cfgSet_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
  _cfgCache = null;
  _cfgSheetCache = null;
}

/** A setting that must exist. Throws with a message naming the key. */
function cfgRequired_(key) {
  var v = cfg_(key, '');
  if (!v) {
    throw new Error(
      'Missing configuration: ' + key + '. Set it in File > Project Settings > ' +
      'Script Properties, or in the ' + ADMIN_SETTINGS_TAB + ' tab. ' +
      'Run setupNewDeployment() if this is a fresh install.');
  }
  return v;
}

/** Comma-separated setting as a trimmed, lowercased, de-duplicated list. */
function cfgList_(key) {
  var raw = cfg_(key, '');
  if (!raw) return [];
  var seen = {}, out = [];
  String(raw).split(',').forEach(function (p) {
    var v = String(p).trim().toLowerCase();
    if (v && !seen[v]) { seen[v] = 1; out.push(v); }
  });
  return out;
}

/* ---------------------------------------------------------------------------
 * Workbook handles.
 *
 * The four ids the system uses. A fresh deployment may run entirely out of the
 * main workbook: when one of the optional ids is not set it falls back to the
 * main one, so Naeem does not need four spreadsheets on day one.
 * ------------------------------------------------------------------------- */

function mainSpreadsheetId_() {
  // Configured value first; otherwise the workbook this script is bound to,
  // which AutoSetup remembers on the first run. Nothing to copy by hand.
  const configured = cfg_(CFG_KEYS.MAIN_SPREADSHEET_ID, '');
  if (configured) return configured;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) { cfgSet_(CFG_KEYS.MAIN_SPREADSHEET_ID, ss.getId()); return ss.getId(); }
  } catch (err) { /* fall through to the explicit error */ }
  return cfgRequired_(CFG_KEYS.MAIN_SPREADSHEET_ID);
}
function payrollSpreadsheetId_()   { return cfg_(CFG_KEYS.PAYROLL_SPREADSHEET_ID, '')    || mainSpreadsheetId_(); }
function sourceSpreadsheetId_()    { return cfg_(CFG_KEYS.SOURCE_SPREADSHEET_ID, '')     || mainSpreadsheetId_(); }
function staffDocsSpreadsheetId_() { return cfg_(CFG_KEYS.STAFF_DOCS_SPREADSHEET_ID, '') || mainSpreadsheetId_(); }

function openMain_()      { return SpreadsheetApp.openById(mainSpreadsheetId_()); }
function openPayroll_()   { return SpreadsheetApp.openById(payrollSpreadsheetId_()); }
function openSource_()    { return SpreadsheetApp.openById(sourceSpreadsheetId_()); }
function openStaffDocs_() { return SpreadsheetApp.openById(staffDocsSpreadsheetId_()); }

/* ---------------------------------------------------------------------------
 * Compatibility shims.
 *
 * The existing modules refer to MAIN_SPREADSHEET_ID and friends as constants.
 * Apps Script shares one global scope, so defining them here as getters keeps
 * all 50-odd files working unchanged while the value still comes from config.
 * Nothing is hardcoded; these resolve on every read.
 * ------------------------------------------------------------------------- */
Object.defineProperty(this, 'MAIN_SPREADSHEET_ID', {
  get: function () { return mainSpreadsheetId_(); }, configurable: true
});
Object.defineProperty(this, 'PAYROLL_SPREADSHEET_ID', {
  get: function () { return payrollSpreadsheetId_(); }, configurable: true
});
Object.defineProperty(this, 'SOURCE_SPREADSHEET_ID', {
  get: function () { return sourceSpreadsheetId_(); }, configurable: true
});
Object.defineProperty(this, 'STAFF_DOCS_SPREADSHEET_ID', {
  get: function () { return staffDocsSpreadsheetId_(); }, configurable: true
});

/** Admin addresses, from config. Never a literal in code. */
function adminEmails_()     { return cfgList_(CFG_KEYS.ADMIN_EMAILS); }
function hrManagerEmails_() { return cfgList_(CFG_KEYS.HR_MANAGER_EMAILS); }

/** Primary notification recipient: first admin address, or '' if unset. */
function primaryAdminEmail_() {
  var a = adminEmails_();
  return a.length ? a[0] : '';
}

/** Organisation display name, used on vouchers and payslips. */
function orgName_() { return cfg_(CFG_KEYS.ORG_NAME, 'Company'); }

/** Currency code. Kuwait default; still overridable per deployment. */
function currency_() { return cfg_(CFG_KEYS.CURRENCY, 'KWD'); }

/** Report the current configuration without revealing the API token. */
function getConfigStatus() {
  try {
    var out = {}, keys = Object.keys(CFG_KEYS);
    keys.forEach(function (k) {
      var v = cfg_(CFG_KEYS[k], '');
      out[CFG_KEYS[k]] = (CFG_KEYS[k] === CFG_KEYS.API_TOKEN)
        ? (v ? 'set (' + String(v).length + ' chars)' : 'NOT SET')
        : (v || 'NOT SET');
    });
    return { success: true, config: out, timeZone: Session.getScriptTimeZone() };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}
