/**
 * Companies.js — the company dimension and the payroll cycles.
 *
 * TWO INDEPENDENT DIMENSIONS
 * --------------------------
 * Company and Location are NOT a hierarchy. In this organisation six of the
 * sixteen locations carry more than one brand — Hawalli alone has five. So a
 * location does not belong to a company, and the Location dropdown must never
 * be filtered by the Company dropdown. They are two separate filters, both
 * applicable at once.
 *
 * PAYROLL CYCLES
 * --------------
 * Staff are paid on two different dates. Each employee carries a cycle flag and
 * each cycle defines its own period window, so the 12th run and the 24th run
 * never borrow each other's dates. Everything about a cycle lives in the
 * Payroll_Cycles tab — nothing here is hardcoded.
 */

const COMPANIES_TAB      = 'Companies';
const PAYROLL_CYCLES_TAB = 'Payroll_Cycles';

const COMPANY_HEADERS = ['Name', 'Short Code', 'CR Number', 'Bank Account',
                         'Status', 'Notes'];
const CYCLE_HEADERS   = ['Cycle', 'Name', 'Period Start Day', 'Period End Day',
                         'Pay Day', 'Status', 'Notes'];

/* ---------------------------------------------------------------- companies */

function companiesSheet_() {
  const ss = openMain_();
  var sh = ss.getSheetByName(COMPANIES_TAB);
  if (!sh) {
    sh = ss.insertSheet(COMPANIES_TAB);
    sh.appendRow(COMPANY_HEADERS);
    sh.getRange(1, 1, 1, COMPANY_HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function cmpCols_(H) {
  const c = {};
  H.forEach(function (h, i) { c[String(h).trim().toLowerCase()] = i; });
  return c;
}

/** Every company, active first. Internal — returns plain records. */
function companiesAll_() {
  const sh = companiesSheet_();
  const d = sh.getDataRange().getValues();
  if (d.length < 2) return [];
  const c = cmpCols_(d[0]);
  const out = [];
  for (var i = 1; i < d.length; i++) {
    const name = String(d[i][c['name']] || '').trim();
    if (!name) continue;
    out.push({
      row: i + 1,
      name: name,
      shortCode: String(d[i][c['short code']] || '').trim(),
      crNumber: String(d[i][c['cr number']] || '').trim(),
      bankAccount: String(d[i][c['bank account']] || '').trim(),
      status: String(d[i][c['status']] || 'Active').trim(),
      notes: String(d[i][c['notes']] || '').trim()
    });
  }
  return out;
}

/**
 * Companies for the header dropdown, narrowed to what the caller may see.
 * The UI builds its <select> from this — nothing is listed in the HTML.
 */
function getCompanies(params) {
  try {
    const scope = authScope_(params || {});
    var list = companiesAll_();
    if (scope.companies && scope.companies.length) {
      const allowed = scope.companies.map(function (s) { return String(s).toLowerCase(); });
      list = list.filter(function (c) { return allowed.indexOf(c.name.toLowerCase()) !== -1; });
    }
    const active = list.filter(function (c) { return c.status.toLowerCase() !== 'inactive'; });
    return {
      success: true,
      data: active,
      // true only when the caller may legitimately look across all of them
      canSeeAll: !(scope.companies && scope.companies.length)
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

/** Create or update a company. Name is the key. */
function saveCompany(params) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    params = params || {};
    const scope = authScope_(params);
    if (!authAtLeast_(scope, 'hr_manager')) {
      return { success: false, error: 'Only an admin or HR manager can change companies.' };
    }
    const name = String(params.name || '').trim();
    if (!name) return { success: false, error: 'Company name is required.' };

    const sh = companiesSheet_();
    const d = sh.getDataRange().getValues();
    const c = cmpCols_(d[0]);
    const original = String(params.originalName || name).trim().toLowerCase();

    var rowNum = -1;
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][c['name']] || '').trim().toLowerCase() === original) { rowNum = i + 1; break; }
    }
    // a rename must not collide with another company
    for (var j = 1; j < d.length; j++) {
      if (j + 1 === rowNum) continue;
      if (String(d[j][c['name']] || '').trim().toLowerCase() === name.toLowerCase()) {
        return { success: false, error: 'A company called "' + name + '" already exists.' };
      }
    }

    const row = [];
    row[c['name']]         = name;
    row[c['short code']]   = String(params.shortCode || '').trim();
    row[c['cr number']]    = String(params.crNumber || '').trim();
    row[c['bank account']] = String(params.bankAccount || '').trim();
    row[c['status']]       = String(params.status || 'Active').trim();
    row[c['notes']]        = String(params.notes || '').trim();
    for (var k = 0; k < COMPANY_HEADERS.length; k++) if (row[k] === undefined) row[k] = '';

    if (rowNum === -1) {
      sh.appendRow(row);
      empInvalidate_();
      return { success: true, created: true, message: 'Company "' + name + '" added.' };
    }
    sh.getRange(rowNum, 1, 1, COMPANY_HEADERS.length).setValues([row]);

    // A rename must carry through to the employees, or their rows orphan.
    const oldName = String(d[rowNum - 1][c['name']] || '').trim();
    var moved = 0;
    if (oldName && oldName.toLowerCase() !== name.toLowerCase()) {
      moved = companyRenameEmployees_(oldName, name);
    }
    empInvalidate_();
    return {
      success: true, created: false,
      message: 'Company "' + name + '" updated.' +
               (moved ? ' ' + moved + ' employee record(s) moved from "' + oldName + '".' : '')
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Point every employee on the old company name at the new one. */
function companyRenameEmployees_(oldName, newName) {
  const raw = empRaw_();
  const cCompany = empCol_(raw.cols, EMP_COL.COMPANY);
  if (cCompany === -1) return 0;
  var n = 0;
  for (var i = 1; i < raw.data.length; i++) {
    if (String(raw.data[i][cCompany] || '').trim().toLowerCase() === oldName.toLowerCase()) {
      raw.sheet.getRange(i + 1, cCompany + 1).setValue(newName);
      n++;
    }
  }
  return n;
}

/**
 * Delete a company. Refused while employees still reference it — deleting it
 * would silently orphan them and they would vanish from every scoped list.
 */
function deleteCompany(params) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    params = params || {};
    const scope = authScope_(params);
    if (!authAtLeast_(scope, 'hr_manager')) {
      return { success: false, error: 'Only an admin or HR manager can delete a company.' };
    }
    const name = String(params.name || '').trim();
    if (!name) return { success: false, error: 'Company name is required.' };

    const inUse = empRows_({ company: name, status: '*' }).length;
    if (inUse) {
      return {
        success: false,
        error: inUse + ' employee(s) are still in "' + name + '". Move them first, ' +
               'or set the company to Inactive instead of deleting it.'
      };
    }
    const sh = companiesSheet_();
    const d = sh.getDataRange().getValues();
    const c = cmpCols_(d[0]);
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][c['name']] || '').trim().toLowerCase() === name.toLowerCase()) {
        sh.deleteRow(i + 1);
        empInvalidate_();
        return { success: true, message: 'Company "' + name + '" deleted.' };
      }
    }
    return { success: false, error: 'Company "' + name + '" not found.' };
  } catch (err) {
    return { success: false, error: err.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* ------------------------------------------------------------------ cycles */

function cyclesSheet_() {
  const ss = openMain_();
  var sh = ss.getSheetByName(PAYROLL_CYCLES_TAB);
  if (!sh) {
    sh = ss.insertSheet(PAYROLL_CYCLES_TAB);
    sh.appendRow(CYCLE_HEADERS);
    sh.getRange(1, 1, 1, CYCLE_HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Every cycle. A cycle is defined by the day of month its period starts and
 * ends, plus the day staff are paid. Nothing about "12th" or "24th" is baked
 * into code — change the tab and the behaviour changes.
 */
function cyclesAll_() {
  const sh = cyclesSheet_();
  const d = sh.getDataRange().getValues();
  if (d.length < 2) return [];
  const c = cmpCols_(d[0]);
  const out = [];
  for (var i = 1; i < d.length; i++) {
    const key = String(d[i][c['cycle']] || '').trim();
    if (!key) continue;
    out.push({
      row: i + 1,
      cycle: key,
      name: String(d[i][c['name']] || '').trim() || ('Cycle ' + key),
      periodStartDay: Number(d[i][c['period start day']]) || 0,
      periodEndDay: Number(d[i][c['period end day']]) || 0,
      payDay: Number(d[i][c['pay day']]) || 0,
      status: String(d[i][c['status']] || 'Active').trim(),
      notes: String(d[i][c['notes']] || '').trim()
    });
  }
  return out;
}

function getPayrollCycles(params) {
  try {
    authScope_(params || {});
    const list = cyclesAll_().filter(function (c) {
      return c.status.toLowerCase() !== 'inactive';
    });
    return { success: true, data: list };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function savePayrollCycle(params) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    params = params || {};
    const scope = authScope_(params);
    if (!authAtLeast_(scope, 'hr_manager')) {
      return { success: false, error: 'Only an admin or HR manager can change payroll cycles.' };
    }
    const key = String(params.cycle || '').trim();
    if (!key) return { success: false, error: 'Cycle key is required (e.g. 12 or 24).' };

    const sDay = Number(params.periodStartDay), eDay = Number(params.periodEndDay),
          pDay = Number(params.payDay);
    const bad = [];
    [['Period Start Day', sDay], ['Period End Day', eDay], ['Pay Day', pDay]].forEach(function (p) {
      if (!p[1] || p[1] < 1 || p[1] > 31) bad.push(p[0]);
    });
    if (bad.length) {
      return { success: false, error: bad.join(' and ') + ' must be a day of the month, 1 to 31.' };
    }

    const sh = cyclesSheet_();
    const d = sh.getDataRange().getValues();
    const c = cmpCols_(d[0]);
    const row = [];
    row[c['cycle']]            = key;
    row[c['name']]             = String(params.name || ('Paid on the ' + pDay)).trim();
    row[c['period start day']] = sDay;
    row[c['period end day']]   = eDay;
    row[c['pay day']]          = pDay;
    row[c['status']]           = String(params.status || 'Active').trim();
    row[c['notes']]            = String(params.notes || '').trim();
    for (var k = 0; k < CYCLE_HEADERS.length; k++) if (row[k] === undefined) row[k] = '';

    for (var i = 1; i < d.length; i++) {
      if (String(d[i][c['cycle']] || '').trim().toLowerCase() === key.toLowerCase()) {
        sh.getRange(i + 1, 1, 1, CYCLE_HEADERS.length).setValues([row]);
        return { success: true, created: false, message: 'Cycle "' + key + '" updated.' };
      }
    }
    sh.appendRow(row);
    return { success: true, created: true, message: 'Cycle "' + key + '" added.' };
  } catch (err) {
    return { success: false, error: err.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** One cycle by key, or null. */
function cycleByKey_(key) {
  const k = String(key || '').trim().toLowerCase();
  if (!k) return null;
  const all = cyclesAll_();
  for (var i = 0; i < all.length; i++) {
    if (all[i].cycle.toLowerCase() === k) return all[i];
  }
  return null;
}

/**
 * The period a cycle covers, for the run being paid in a given month.
 *
 * A cycle whose period end day is on or after its start day sits inside one
 * calendar month. One that wraps — start 23, end 22 — begins in the previous
 * month. Both are handled, so the 12th and 24th runs can be defined whichever
 * way the business actually works.
 *
 * @param {string} cycleKey
 * @param {Date} payMonthAnchor any date inside the month being paid
 * @returns {{start: Date, end: Date, cycle: Object}}
 */
function cyclePeriodFor_(cycleKey, payMonthAnchor) {
  const cyc = cycleByKey_(cycleKey);
  if (!cyc) throw new Error('Unknown payroll cycle: ' + cycleKey);
  const anchor = payMonthAnchor ? new Date(payMonthAnchor) : new Date();
  const y = anchor.getFullYear(), m = anchor.getMonth();

  var end = new Date(y, m, Math.min(cyc.periodEndDay, daysInMonth_(y, m)));
  var start;
  if (cyc.periodStartDay <= cyc.periodEndDay) {
    start = new Date(y, m, Math.min(cyc.periodStartDay, daysInMonth_(y, m)));
  } else {
    const pm = m - 1, py = pm < 0 ? y - 1 : y, pmm = (pm + 12) % 12;
    start = new Date(py, pmm, Math.min(cyc.periodStartDay, daysInMonth_(py, pmm)));
  }
  return { start: startOfDay_(start), end: endOfDay_(end), cycle: cyc };
}

function daysInMonth_(y, m) { return new Date(y, m + 1, 0).getDate(); }
