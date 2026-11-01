/**
 * Employees.js — the single read path for employee records.
 *
 * WHY THIS EXISTS
 * ---------------
 * In the system this was derived from, 43 of 65 files opened the employee tab
 * directly and filtered it by hand. With one company that was merely untidy.
 * With six it is a data leak waiting to happen: one missed filter and Corn Club
 * sees Good People's salaries.
 *
 * So every employee read goes through empRows_(). The company filter lives here,
 * once. The authorisation scope (Auth.js) is applied here too, so "which rows may
 * this caller see" is answered in exactly one place.
 *
 * Columns are looked up by header name, never by index — adding a column must
 * never shift anything.
 */

// The employee master tab. Named in config so each organisation calls it
// whatever suits them; nothing in the code assumes a particular name.
const HR_TAB = cfg_('EMPLOYEE_TAB', 'Employees');

/** Canonical column names. Change a sheet header here, not in fifty files. */
const EMP_COL = {
  ID        : 'Employee ID',
  NAME      : 'Name (English)',
  NAME_AR   : 'Name (Arabic)',
  COMPANY   : 'Company',          // added for multi-company
  CYCLE     : 'Payroll Cycle',    // added for the 12th / 24th runs
  LOCATION  : 'Location',
  STATUS    : 'Status',
  BASIC     : 'Basic Salary',
  FOOD      : 'Food Allowance',
  ACCOM     : 'Accommodation',
  CONVEY    : 'Conveyance',
  BONUS     : 'Bonus',
  RATE      : 'Price Per Hour',
  DOJ       : 'Date of Join',
  CIVIL_ID  : 'Civil ID',
  PASSPORT  : 'Passport No',
  IBAN      : 'IBAN',
  PIN       : 'PIN',
  SHIFT     : 'Shift',
  DESIGNATION: 'Designation'
};

/** Columns never returned unless the caller explicitly asks and is allowed. */
const EMP_SENSITIVE = [EMP_COL.CIVIL_ID, EMP_COL.PASSPORT, EMP_COL.IBAN, EMP_COL.PIN];

/** Per-execution cache. The HR tab is read once per call chain, not per module. */
var _empCache = null;

/** Drop the cache after any write. */
function empInvalidate_() { _empCache = null; }

/**
 * Raw sheet read: { headers, cols, rows }. Internal — use empRows_().
 */
function empRaw_() {
  if (_empCache) return _empCache;
  const ss = openMain_();
  const sh = ss.getSheetByName(HR_TAB);
  if (!sh) throw new Error("'" + HR_TAB + "' tab not found in the main workbook.");
  const data = sh.getDataRange().getValues();
  if (!data.length) throw new Error("'" + HR_TAB + "' is empty.");
  const headers = data[0];
  const cols = {};
  headers.forEach(function (h, i) { cols[String(h).trim().toLowerCase()] = i; });
  _empCache = { headers: headers, cols: cols, data: data, sheet: sh };
  return _empCache;
}

/** Column index by header name, or -1. Case and space insensitive. */
function empCol_(cols, name) {
  const k = String(name).trim().toLowerCase();
  return (k in cols) ? cols[k] : -1;
}

/** Read a cell by header name; '' when the column does not exist. */
function empCell_(row, cols, name) {
  const i = empCol_(cols, name);
  return i === -1 ? '' : row[i];
}

/**
 * The one employee read.
 *
 * @param {Object} [opts]
 * @param {string|string[]} [opts.company]  one company, a list, or '' for all
 * @param {string} [opts.cycle]             payroll cycle, e.g. '12' or '24'
 * @param {string|string[]} [opts.location]
 * @param {string} [opts.status]            default 'Active'; '*' for every status
 * @param {string[]} [opts.ids]             restrict to these employee ids
 * @param {boolean} [opts.includeSensitive] include Civil ID / Passport / IBAN / PIN
 * @param {Object} [opts.scope]             auth scope from Auth.js; caps the companies
 * @returns {Array<Object>} plain records, one per matching employee
 */
function empRows_(opts) {
  opts = opts || {};
  const raw = empRaw_();
  const cols = raw.cols, data = raw.data;

  const wantCompany  = empNormList_(opts.company);
  const wantLocation = empNormList_(opts.location);
  const wantIds      = empNormList_(opts.ids);
  const wantCycle    = opts.cycle === undefined || opts.cycle === null
                       ? '' : String(opts.cycle).trim().toLowerCase();
  const wantStatus   = opts.status === undefined ? 'active'
                       : String(opts.status).trim().toLowerCase();

  // The auth scope is a ceiling, not a preference. A caller restricted to one
  // company cannot widen it by passing a different company in opts.
  const scopeCompanies = (opts.scope && opts.scope.companies && opts.scope.companies.length)
    ? opts.scope.companies.map(function (c) { return String(c).trim().toLowerCase(); })
    : null;

  const out = [];
  for (var i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(empCell_(row, cols, EMP_COL.ID) || '').trim();
    if (!id) continue;

    const company  = String(empCell_(row, cols, EMP_COL.COMPANY)  || '').trim();
    const location = String(empCell_(row, cols, EMP_COL.LOCATION) || '').trim();
    const cycle    = String(empCell_(row, cols, EMP_COL.CYCLE)    || '').trim();
    const status   = String(empCell_(row, cols, EMP_COL.STATUS)   || '').trim();

    if (scopeCompanies && scopeCompanies.indexOf(company.toLowerCase()) === -1) continue;
    if (wantCompany.length  && wantCompany.indexOf(company.toLowerCase()) === -1) continue;
    if (wantLocation.length && wantLocation.indexOf(location.toLowerCase()) === -1) continue;
    if (wantCycle && String(cycle).toLowerCase() !== wantCycle) continue;
    if (wantIds.length && wantIds.indexOf(id.toLowerCase()) === -1) continue;
    if (wantStatus !== '*' && status && status.toLowerCase() !== wantStatus) continue;
    // A blank Status is treated as Active, matching the original behaviour.
    if (wantStatus !== '*' && !status && wantStatus !== 'active') continue;

    const rec = {
      row        : i + 1,
      id         : id,
      name       : String(empCell_(row, cols, EMP_COL.NAME) || '').trim(),
      nameAr     : String(empCell_(row, cols, EMP_COL.NAME_AR) || '').trim(),
      company    : company,
      cycle      : cycle,
      location   : location,
      status     : status || 'Active',
      basic      : empNum_(empCell_(row, cols, EMP_COL.BASIC)),
      food       : empNum_(empCell_(row, cols, EMP_COL.FOOD)),
      accom      : empNum_(empCell_(row, cols, EMP_COL.ACCOM)),
      conveyance : empNum_(empCell_(row, cols, EMP_COL.CONVEY)),
      bonus      : empNum_(empCell_(row, cols, EMP_COL.BONUS)),
      rate       : empNum_(empCell_(row, cols, EMP_COL.RATE)),
      doj        : empCell_(row, cols, EMP_COL.DOJ),
      shift      : String(empCell_(row, cols, EMP_COL.SHIFT) || '').trim(),
      designation: String(empCell_(row, cols, EMP_COL.DESIGNATION) || '').trim()
    };

    if (opts.includeSensitive) {
      rec.civilId  = String(empCell_(row, cols, EMP_COL.CIVIL_ID) || '').trim();
      rec.passport = String(empCell_(row, cols, EMP_COL.PASSPORT) || '').trim();
      rec.iban     = String(empCell_(row, cols, EMP_COL.IBAN) || '').trim();
    }
    out.push(rec);
  }
  return out;
}

/** One employee by id, or null. */
function empById_(id, opts) {
  opts = opts || {};
  opts.ids = [id];
  opts.status = opts.status === undefined ? '*' : opts.status;
  const r = empRows_(opts);
  return r.length ? r[0] : null;
}

/** Distinct values of a column across the roster — used to seed dropdowns. */
function empDistinct_(colName, opts) {
  const seen = {}, out = [];
  empRows_(Object.assign({ status: '*' }, opts || {})).forEach(function (e) {
    var v;
    if (colName === EMP_COL.COMPANY)       v = e.company;
    else if (colName === EMP_COL.LOCATION) v = e.location;
    else if (colName === EMP_COL.CYCLE)    v = e.cycle;
    else v = '';
    v = String(v || '').trim();
    if (v && !seen[v.toLowerCase()]) { seen[v.toLowerCase()] = 1; out.push(v); }
  });
  return out.sort();
}

/* ------------------------------------------------------------------ helpers */

function empNormList_(v) {
  if (v === undefined || v === null || v === '') return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  const out = [];
  arr.forEach(function (x) {
    const s = String(x).trim().toLowerCase();
    if (s && s !== '__all__') out.push(s);
  });
  return out;
}

function empNum_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

/**
 * Next employee id. The prefix is configurable — this deployment uses whatever
 * EMPLOYEE_ID_PREFIX says, so an existing numbering scheme can be carried over
 * rather than renumbering everybody.
 */
function empNextId_() {
  const prefix = cfg_('EMPLOYEE_ID_PREFIX', 'HR-EMP-');
  const width  = Number(cfg_('EMPLOYEE_ID_DIGITS', '5')) || 5;
  const raw = empRaw_();
  const cId = empCol_(raw.cols, EMP_COL.ID);
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '(\\d+)$', 'i');
  var max = 0;
  for (var i = 1; i < raw.data.length; i++) {
    const m = String(raw.data[i][cId] || '').trim().match(re);
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return prefix + String(max + 1).padStart(width, '0');
}

/* -------------------------------------------------------------- API methods */

/**
 * Employee list for the UI. Company comes from the header dropdown.
 * Sensitive columns are returned only when the caller's scope allows it.
 */
function getEmployeesScoped(params) {
  try {
    params = params || {};
    const scope = authScope_(params);
    const rows = empRows_({
      company: params.company,
      cycle: params.cycle,
      location: params.location,
      status: params.status === undefined ? 'active' : params.status,
      includeSensitive: !!(params.includeSensitive && scope.canSeeSensitive),
      scope: scope
    });
    return { success: true, count: rows.length, employees: rows };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

/** Distinct companies actually present on the roster. */
function getEmployeeCompanies(params) {
  try {
    const scope = authScope_(params || {});
    return { success: true, companies: empDistinct_(EMP_COL.COMPANY, { scope: scope }) };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}
