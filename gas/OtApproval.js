/**
 * OtApproval.js — two-stage overtime approval.
 *
 * THE CHAIN
 * ---------
 *   staff submits (kiosk)        -> Pending
 *   supervisor approves          -> Supervisor Approved
 *   HR manager approves          -> HR Approved, and only now posted to OT_Entries
 *
 * The system this was derived from had ONE stage: approvePendingOt posted
 * straight to OT_Entries with no role check at all, and recorded the approver
 * as whatever free text the caller sent. Here each stage checks the caller's
 * role through Auth.js, and both verdicts are stamped with who and when, so a
 * disputed hour can be traced to two named people.
 *
 * OT only reaches payroll from OT_Entries. A row that stops at Supervisor
 * Approved is not paid — which is the point of the second stage.
 */

/** Statuses. The order here is the order of the chain. */
const OTA_STATUS = {
  PENDING   : 'Pending',
  SUP_OK    : 'Supervisor Approved',
  HR_OK     : 'HR Approved',
  SUP_REJECT: 'Rejected (Supervisor)',
  HR_REJECT : 'Rejected (HR)'
};

/** Columns added to OT_Pending for the second stage. */
const OTA_EXTRA_HEADERS = ['Supervisor By', 'Supervisor At', 'Supervisor Note',
                           'HR By', 'HR At', 'HR Note'];

/**
 * OT_Pending with the two-stage columns present.
 * Appends them in place on an existing sheet rather than asking anyone to edit it.
 */
function otaSheet_(ss) {
  const sheet = ensureOtPendingTab_(ss);
  const last = Math.max(sheet.getLastColumn(), 1);
  const H = sheet.getRange(1, 1, 1, last).getValues()[0]
                 .map(function (h) { return String(h).trim().toLowerCase(); });
  OTA_EXTRA_HEADERS.forEach(function (name) {
    if (H.indexOf(name.toLowerCase()) === -1) {
      const col = sheet.getLastColumn() + 1;
      sheet.getRange(1, col).setValue(name).setFontWeight('bold');
      H.push(name.toLowerCase());
    }
  });
  return sheet;
}

function otaCols_(sheet) {
  const H = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const c = {};
  H.forEach(function (h, i) { c[String(h).trim().toLowerCase()] = i; });
  return c;
}

/**
 * Pending OT at a given stage, narrowed to what the caller may see.
 *
 * A supervisor sees rows still at Pending, for their own companies only.
 * An HR manager sees rows a supervisor has already passed.
 *
 * @param {Object} params { token, stage?: 'supervisor'|'hr', company? }
 */
function getOtForApproval(params) {
  try {
    params = params || {};
    const scope = authScope_(params);
    if (!scope.role) return { success: false, error: 'Not signed in.' };

    const stage = String(params.stage || '').trim().toLowerCase() ||
                  (scope.role === 'supervisor' ? 'supervisor' : 'hr');
    if (stage === 'hr' && !authAtLeast_(scope, 'hr_manager')) {
      return { success: false, error: 'Only an HR manager or admin can see the HR approval queue.' };
    }
    const want = (stage === 'supervisor') ? OTA_STATUS.PENDING : OTA_STATUS.SUP_OK;

    const ss = openMain_();
    const sheet = otaSheet_(ss);
    const c = otaCols_(sheet);
    const d = sheet.getDataRange().getValues();

    // Company for each employee, so the queue can be scoped the same way
    // every other list is.
    const byId = {};
    empRows_({ status: '*', scope: scope }).forEach(function (e) { byId[e.id.toUpperCase()] = e; });

    const wantCompany = String(params.company || '').trim().toLowerCase();
    const rows = [];
    for (var i = 1; i < d.length; i++) {
      const empId = String(d[i][c['employee id']] || '').trim();
      if (!empId) continue;
      if (String(d[i][c['status']] || '').trim().toLowerCase() !== want.toLowerCase()) continue;

      const emp = byId[empId.toUpperCase()];
      if (!emp) continue;                       // outside this caller's scope
      if (wantCompany && String(emp.company || '').toLowerCase() !== wantCompany) continue;

      rows.push({
        row: i + 1,
        id: d[i][c['id']],
        empId: empId,
        name: String(d[i][c['name']] || '').trim(),
        company: emp.company,
        location: emp.location,
        date: d[i][c['date']],
        hours: Number(d[i][c['hours']]) || 0,
        source: String(d[i][c['source']] || '').trim(),
        status: String(d[i][c['status']] || '').trim(),
        submitted: d[i][c['submitted']],
        geoFlag: d[i][c['geo flag']] || '',
        computedOt: d[i][c['computed ot']] || '',
        supervisorBy: d[i][c['supervisor by']] || '',
        supervisorAt: d[i][c['supervisor at']] || '',
        supervisorNote: d[i][c['supervisor note']] || ''
      });
    }
    return { success: true, stage: stage, count: rows.length, rows: rows };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

/**
 * Stage one. A supervisor passes the claim up, or rejects it.
 *
 * @param {Object} params { token, row, hours?, note?, decision: 'approve'|'reject' }
 */
function supervisorDecideOt(params) {
  return otaDecide_(params, 'supervisor');
}

/**
 * Stage two. The HR manager makes the final call. Only an approval here
 * posts to OT_Entries, and therefore only this reaches payroll.
 */
function hrDecideOt(params) {
  return otaDecide_(params, 'hr');
}

function otaDecide_(params, stage) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    params = params || {};
    const scope = authScope_(params);

    if (stage === 'supervisor') {
      if (!authAtLeast_(scope, 'supervisor')) {
        return { success: false, error: 'Only a supervisor, HR manager or admin can do this.' };
      }
    } else if (!authAtLeast_(scope, 'hr_manager')) {
      return { success: false, error: 'Only an HR manager or admin can give final OT approval.' };
    }

    const rowNum = Number(params.row);
    if (!rowNum || rowNum < 2) return { success: false, error: 'Valid row required.' };
    const decision = String(params.decision || '').trim().toLowerCase();
    if (decision !== 'approve' && decision !== 'reject') {
      return { success: false, error: "decision must be 'approve' or 'reject'." };
    }

    const ss = openMain_();
    const sheet = otaSheet_(ss);
    const c = otaCols_(sheet);
    const width = sheet.getLastColumn();
    const r = sheet.getRange(rowNum, 1, 1, width).getValues()[0];

    const empId = String(r[c['employee id']] || '').trim();
    if (!empId) return { success: false, error: 'That row has no employee.' };

    // The claim must belong to a company this caller may act on.
    const emp = empById_(empId, { scope: scope });
    if (!emp) {
      return { success: false, error: 'That claim is outside your companies.' };
    }

    const current = String(r[c['status']] || '').trim();
    const expected = (stage === 'supervisor') ? OTA_STATUS.PENDING : OTA_STATUS.SUP_OK;
    if (current.toLowerCase() !== expected.toLowerCase()) {
      return {
        success: false,
        error: 'This claim is "' + current + '", not "' + expected + '". ' +
               (stage === 'hr' ? 'A supervisor must pass it first.' : 'It has already been dealt with.')
      };
    }

    // An approver may correct the hours; the correction is recorded, not silent.
    const originalHours = Number(r[c['hours']]) || 0;
    const hours = (params.hours !== undefined && params.hours !== '')
      ? Number(params.hours) : originalHours;
    if (isNaN(hours) || hours < 0) return { success: false, error: 'Hours must be a positive number.' };
    if (hours > Number(cfg_('OT_MAX_HOURS_PER_DAY', '12'))) {
      return { success: false, error: 'Hours exceed the per-day maximum set for this deployment.' };
    }

    const now = new Date();
    const who = scope.email || scope.role;
    const note = String(params.note || '').trim();

    if (stage === 'supervisor') {
      sheet.getRange(rowNum, c['supervisor by'] + 1).setValue(who);
      sheet.getRange(rowNum, c['supervisor at'] + 1).setValue(formatDdMmYyyyHm_(now));
      if (note) sheet.getRange(rowNum, c['supervisor note'] + 1).setValue(note);
      if (hours !== originalHours) sheet.getRange(rowNum, c['hours'] + 1).setValue(hours);
      const next = (decision === 'approve') ? OTA_STATUS.SUP_OK : OTA_STATUS.SUP_REJECT;
      sheet.getRange(rowNum, c['status'] + 1).setValue(next);
      return {
        success: true, status: next,
        message: decision === 'approve'
          ? 'Passed to HR: ' + hours + 'h for ' + emp.name + '.'
          : 'Rejected: ' + emp.name + '.'
      };
    }

    // ---- HR, the final stage -------------------------------------------
    sheet.getRange(rowNum, c['hr by'] + 1).setValue(who);
    sheet.getRange(rowNum, c['hr at'] + 1).setValue(formatDdMmYyyyHm_(now));
    if (note) sheet.getRange(rowNum, c['hr note'] + 1).setValue(note);
    if (hours !== originalHours) sheet.getRange(rowNum, c['hours'] + 1).setValue(hours);

    if (decision === 'reject') {
      sheet.getRange(rowNum, c['status'] + 1).setValue(OTA_STATUS.HR_REJECT);
      return { success: true, status: OTA_STATUS.HR_REJECT, message: 'Rejected: ' + emp.name + '.' };
    }

    // Post to OT_Entries. This is the only path by which OT becomes payable.
    const dd = String(r[c['date']] || '').trim();
    var ent = ss.getSheetByName(OT_ENTRIES_TAB);
    if (!ent) {
      ent = ss.insertSheet(OT_ENTRIES_TAB);
      ent.appendRow(['Date', 'Employee ID', 'Name', 'OT Hours', 'Remark', 'Added By']);
    }
    ent.appendRow([dd, empId, emp.name, hours,
                   'Self-submitted, supervisor + HR approved',
                   'HR approval (' + who + ')']);
    ent.getRange(ent.getLastRow(), 1).setNumberFormat('@');

    sheet.getRange(rowNum, c['status'] + 1).setValue(OTA_STATUS.HR_OK);
    return {
      success: true, status: OTA_STATUS.HR_OK,
      message: 'Approved ' + hours + 'h for ' + emp.name + ' (' + dd + ') — posted to OT_Entries.'
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Where every claim currently sits. The HR manager's overview.
 */
function getOtApprovalSummary(params) {
  try {
    params = params || {};
    const scope = authScope_(params);
    if (!scope.role) return { success: false, error: 'Not signed in.' };

    const ss = openMain_();
    const sheet = otaSheet_(ss);
    const c = otaCols_(sheet);
    const d = sheet.getDataRange().getValues();

    const byId = {};
    empRows_({ status: '*', scope: scope }).forEach(function (e) { byId[e.id.toUpperCase()] = e; });

    const counts = {}, byCompany = {};
    for (var i = 1; i < d.length; i++) {
      const empId = String(d[i][c['employee id']] || '').trim();
      if (!empId) continue;
      const emp = byId[empId.toUpperCase()];
      if (!emp) continue;
      const st = String(d[i][c['status']] || '').trim() || OTA_STATUS.PENDING;
      const hrs = Number(d[i][c['hours']]) || 0;
      counts[st] = (counts[st] || 0) + 1;
      const key = emp.company || '(no company)';
      byCompany[key] = byCompany[key] || {};
      byCompany[key][st] = byCompany[key][st] || { claims: 0, hours: 0 };
      byCompany[key][st].claims++;
      byCompany[key][st].hours += hrs;
    }
    return { success: true, statuses: OTA_STATUS, counts: counts, byCompany: byCompany };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}
