/**
 * ImportEmployees.js — bring the existing roster in, safely.
 *
 * HOW IT WORKS
 * ------------
 * Paste the reconciled CSV into a tab called _Import_Staging (first row the
 * headers), then:
 *
 *   previewImportEmployees()   says exactly what would happen. Writes nothing.
 *   commitImportEmployees()    does it.
 *
 * Preview first, always. The same discipline as every other bulk correction in
 * this system: look at what it intends to do, then let it do it.
 *
 * The import never invents data. A field the source does not supply is left
 * empty, and the preview lists what is missing so it can be chased rather than
 * guessed at.
 */

const IMPORT_TAB = '_Import_Staging';

/** Staging header -> the employee tab column. Anything unmapped is ignored. */
const IMPORT_MAP = {
  'employee_id'       : 'Employee ID',
  'name'              : 'Name (English)',
  'name_arabic'       : 'Name (Arabic)',
  'civil_id'          : 'Civil ID',
  'company'           : 'Company',
  'payroll_cycle'     : 'Payroll Cycle',
  'location'          : 'Location',
  'designation'       : 'Designation',
  'shift'             : 'Shift',
  'cid_expiry'        : 'CID Expiry',
  'passport_no'       : 'Passport No',
  'passport_expiry'   : 'Passport Expiry',
  'health_card_expiry': 'Health Card Expiry',
  'visa_expiry'       : 'Visa Expiry',
  'visa_status'       : 'Visa Status',
  'nationality'       : 'Nationality',
  'date_of_join'      : 'Date of Join',
  'basic_salary'      : 'Basic Salary',
  'food_allowance'    : 'Food Allowance',
  'accommodation'     : 'Accommodation',
  'iban'              : 'IBAN',
  'bank_name'         : 'Bank Name',
  'mobile'            : 'Mobile',
  'email'             : 'Email',
  'status'            : 'Status',
  'remark'            : 'Remark'
};

/** Without these, payroll cannot run for that person. */
const IMPORT_PAYROLL_FIELDS = ['Basic Salary', 'Date of Join', 'IBAN', 'Payroll Cycle'];

/**
 * A staging cell as TEXT, whatever Sheets decided it was. This tab is pasted
 * or imported into, and Sheets coerces: a civil id becomes a number,
 * "26-01-2026" becomes a date serial. getValues() then hands back a Number and
 * a Date, and String()-ing that Date gives "Mon Jan 26 2026 00:00:00 GMT+0300
 * (Arabian Standard Time)" -- which would be written into CID Expiry for every
 * date, for everybody.
 */
function impCell_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : formatDdMmYyyy_(v);
  }
  if (typeof v === 'number') {
    if (!isFinite(v)) return '';
    return (Math.floor(v) === v) ? v.toFixed(0) : String(v);
  }
  return String(v).trim();
}

function importStagingRows_() {
  const ss = openMain_();
  const sh = ss.getSheetByName(IMPORT_TAB);
  if (!sh) {
    throw new Error('No "' + IMPORT_TAB + '" tab. Create it and paste the ' +
                    'reconciled CSV into it, headers in row 1.');
  }
  const d = sh.getDataRange().getValues();
  if (d.length < 2) throw new Error('"' + IMPORT_TAB + '" has no data rows.');
  const hdr = d[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const rows = [];
  for (var i = 1; i < d.length; i++) {
    const rec = {};
    var any = false;
    hdr.forEach(function (h, j) {
      rec[h] = impCell_(d[i][j]);
      if (rec[h]) any = true;
    });
    if (any) { rec.__row = i + 1; rows.push(rec); }
  }
  return { rows: rows, headers: hdr };
}

function previewImportEmployees(params) { return importEmployees_(params, false); }
function commitImportEmployees(params)  { return importEmployees_(params, true); }

function importEmployees_(params, commit) {
  const lock = LockService.getScriptLock();
  try {
    if (commit) lock.waitLock(60000);
    params = params || {};
    const scope = authScope_(params);
    // Called from the editor there is no session; require a role only over the web.
    if (params.token !== undefined && !authAtLeast_(scope, 'hr_manager')) {
      return { success: false, error: 'Only an admin or HR manager can import employees.' };
    }

    const staging = importStagingRows_();
    const ss = openMain_();
    const raw = empRaw_();
    const cols = raw.cols;
    const sheet = raw.sheet;
    const width = raw.headers.length;

    // Which staging headers we can actually use.
    const usable = [], ignored = [];
    staging.headers.forEach(function (h) {
      if (!h) return;
      const target = IMPORT_MAP[h];
      if (!target) { ignored.push(h); return; }
      if (empCol_(cols, target) === -1) { ignored.push(h + ' (no "' + target + '" column)'); return; }
      usable.push({ from: h, to: target });
    });

    // Existing ids, so an import is an update rather than a duplicate.
    const cId = empCol_(cols, EMP_COL.ID);
    const existing = {};
    for (var i = 1; i < raw.data.length; i++) {
      const id = String(raw.data[i][cId] || '').trim().toUpperCase();
      if (id) existing[id] = i + 1;
    }

    const known = {};
    companiesAll_().forEach(function (c) { known[c.name.toLowerCase()] = c.name; });
    const cycleKeys = {};
    cyclesAll_().forEach(function (c) { cycleKeys[String(c.cycle).toLowerCase()] = 1; });

    const toAdd = [], toUpdate = [], problems = [], warnings = [];
    const seen = {};
    const missingCount = {};
    IMPORT_PAYROLL_FIELDS.forEach(function (f) { missingCount[f] = 0; });

    staging.rows.forEach(function (r) {
      const id = String(r['employee_id'] || '').trim().toUpperCase();
      if (!id) { problems.push('row ' + r.__row + ': no employee_id'); return; }
      if (seen[id]) { problems.push('row ' + r.__row + ': ' + id + ' appears twice in the staging tab'); return; }
      seen[id] = 1;

      if (!String(r['name'] || '').trim()) {
        problems.push('row ' + r.__row + ': ' + id + ' has no name');
      }
      const company = String(r['company'] || '').trim();
      if (!company) {
        problems.push('row ' + r.__row + ': ' + id + ' has no company - would be in no payroll run');
      } else if (!known[company.toLowerCase()]) {
        problems.push('row ' + r.__row + ': ' + id + ' is in "' + company +
                      '", which is not on the Companies tab');
      }
      const cyc = String(r['payroll_cycle'] || '').trim();
      if (cyc && !cycleKeys[cyc.toLowerCase()]) {
        problems.push('row ' + r.__row + ': ' + id + ' is on cycle "' + cyc + '", which is not defined');
      }
      IMPORT_PAYROLL_FIELDS.forEach(function (f) {
        const from = Object.keys(IMPORT_MAP).filter(function (k) { return IMPORT_MAP[k] === f; })[0];
        if (!from || !String(r[from] || '').trim()) missingCount[f]++;
      });
      (existing[id] ? toUpdate : toAdd).push({ id: id, row: r, target: existing[id] || null });
    });

    if (!commit) {
      const lines = [];
      lines.push('PREVIEW - nothing written.');
      lines.push('');
      lines.push('staging rows : ' + staging.rows.length);
      lines.push('  would add   : ' + toAdd.length);
      lines.push('  would update: ' + toUpdate.length);
      lines.push('');
      lines.push('columns mapped (' + usable.length + '): ' +
                 usable.map(function (u) { return u.from + ' -> ' + u.to; }).join(', '));
      if (ignored.length) lines.push('columns IGNORED: ' + ignored.join(', '));
      lines.push('');
      lines.push('A PIN will be generated for everyone who does not have one.');
      lines.push('');
      lines.push('Payroll cannot run for anyone missing these:');
      IMPORT_PAYROLL_FIELDS.forEach(function (f) {
        lines.push('  ' + f + ': missing for ' + missingCount[f] + ' of ' + staging.rows.length);
      });
      if (problems.length) {
        lines.push('');
        lines.push('PROBLEMS (' + problems.length + ') - fix these first:');
        problems.slice(0, 40).forEach(function (p) { lines.push('  ' + p); });
        if (problems.length > 40) lines.push('  … ' + (problems.length - 40) + ' more');
      } else {
        lines.push('');
        lines.push('No blocking problems found.');
      }
      lines.push('');
      lines.push(problems.length
        ? 'Fix the problems, then run commitImportEmployees().'
        : 'Run commitImportEmployees() to apply.');
      return {
        success: true, preview: true, add: toAdd.length, update: toUpdate.length,
        problems: problems, missing: missingCount, message: lines.join('\n')
      };
    }

    // ---- commit ----
    if (problems.length && !params.force) {
      return {
        success: false,
        error: problems.length + ' problem(s) must be fixed first, or pass force:true ' +
               'to import anyway. Run previewImportEmployees() to see them.',
        problems: problems.slice(0, 20)
      };
    }

    var added = 0, updated = 0;
    toUpdate.forEach(function (item) {
      const rowVals = sheet.getRange(item.target, 1, 1, width).getValues()[0];
      var touched = false;
      usable.forEach(function (u) {
        const v = String(item.row[u.from] || '').trim();
        if (!v) return;                       // never blank out an existing value
        const idx = empCol_(cols, u.to);
        if (idx !== -1 && String(rowVals[idx]).trim() !== v) { rowVals[idx] = v; touched = true; }
      });
      if (touched) { sheet.getRange(item.target, 1, 1, width).setValues([rowVals]); updated++; }
    });

    // Every imported person needs a PIN or they cannot use the kiosk at all.
    // Generated here in one pass, checked against the PINs already in use and
    // against each other, rather than one at a time against a stale read.
    const cPin = empCol_(cols, EMP_COL.PIN);
    const usedPins = {};
    if (cPin !== -1) {
      for (var p = 1; p < raw.data.length; p++) {
        const v = String(raw.data[p][cPin] || '').trim();
        if (v) usedPins[v] = 1;
      }
    }
    function freshPin_() {
      for (var t = 0; t < 20000; t++) {
        const pin = String(Math.floor(1000 + Math.random() * 9000));
        if (!usedPins[pin]) { usedPins[pin] = 1; return pin; }
      }
      throw new Error('Could not find an unused 4-digit PIN. Too many employees for 4 digits.');
    }
    var pinsIssued = 0;

    // An existing row with no PIN gets one too, or that person stays locked out.
    if (cPin !== -1) {
      toUpdate.forEach(function (item) {
        const cur = String(sheet.getRange(item.target, cPin + 1).getValue() || '').trim();
        if (!cur) { sheet.getRange(item.target, cPin + 1).setValue(freshPin_()); pinsIssued++; }
      });
    }

    if (toAdd.length) {
      const block = toAdd.map(function (item) {
        const rowVals = new Array(width).fill('');
        usable.forEach(function (u) {
          const v = String(item.row[u.from] || '').trim();
          const idx = empCol_(cols, u.to);
          if (idx !== -1 && v) rowVals[idx] = v;
        });
        const st = empCol_(cols, EMP_COL.STATUS);
        if (st !== -1 && !rowVals[st]) rowVals[st] = 'Active';
        if (cPin !== -1 && !rowVals[cPin]) { rowVals[cPin] = freshPin_(); pinsIssued++; }
        return rowVals;
      });
      sheet.getRange(sheet.getLastRow() + 1, 1, block.length, width).setValues(block);
      // Civil ID and IBAN must stay text, or leading zeros are lost.
      [EMP_COL.CIVIL_ID, EMP_COL.IBAN, EMP_COL.PASSPORT].forEach(function (name) {
        const idx = empCol_(cols, name);
        if (idx !== -1) {
          sheet.getRange(sheet.getLastRow() - block.length + 1, idx + 1, block.length, 1)
               .setNumberFormat('@');
        }
      });
      added = block.length;
    }

    empInvalidate_();
    SpreadsheetApp.flush();
    return {
      success: true, preview: false, added: added, updated: updated,
      pinsIssued: pinsIssued,
      message: 'Imported: ' + added + ' added, ' + updated + ' updated, ' +
               pinsIssued + ' PIN(s) issued. PINs are in the ' + HR_TAB +
               ' tab - staff need theirs to use the kiosk. ' +
               'Run checkDeployment() to see who still cannot be paid.'
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
