// ============================================================
// attendance-ui.js — Attendance Log page
// Filters: date range, searchable employee, location dropdown,
//          stage dropdown (client-side).
//
// BACKEND NOTE: getAttendanceLog only accepts:
//   date=dd-mm-yyyy  (single date — sent when From=To)
//   empId=<employee id>
//   location=name
// Date range is filtered client-side when From ≠ To.
// ============================================================

(function () {
  const EXEC_URL = CONFIG.API_URL;
  const STAGES   = ['Check In', 'Break Out', 'Break In', 'Check Out', 'Day Off'];
  let   EMPS     = [];  // { id, name, location }
  let   LOCS     = [];  // unique location names

  function todayIso() { return new Date().toISOString().split('T')[0]; }
  function toDd(iso)  { if (!iso) return ''; const [y,m,d] = iso.split('-'); return d+'-'+m+'-'+y; }
  function ddToIso(dd){ if (!dd) return ''; const [d,m,y] = dd.split('-'); return y+'-'+m+'-'+d; }
  function adminEmail() {
    const el = document.getElementById('userEmail');
    return el && el.innerText && el.innerText !== 'Loading...' ? el.innerText.trim() : 'Admin';
  }
  // Robust time extraction — handles GAS locale timestamps like "3 Sep 2026 10:51:32"
  function extractTime(ts) {
    const m = String(ts || '').match(/(\d{1,2}:\d{2})/);
    return m ? m[1] : '';
  }

  async function api(qs) {
    const r = await fetch(EXEC_URL + '?' + qs + '&_=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'Error');
    return d;
  }
  async function post(method, body) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(EXEC_URL + '?method=' + method, {
          method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(body)
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'Error');
        return d;
      } catch (e) { if (attempt === 1) throw e; await new Promise(r => setTimeout(r, 800)); }
    }
  }

  // ── Build page ────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    const attach = () => {
      const sec = document.getElementById('page-attendance');
      if (!sec) return setTimeout(attach, 100);
      sec.innerHTML =
        '<div class="table-container mb-3">' +
          '<div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">' +
            '<h5 class="mb-0">Attendance Log</h5>' +
            '<div class="d-flex gap-2">' +
              '<button class="btn btn-outline-danger btn-sm" onclick="app.openBackfillCheckouts()">' +
                '<i class="bi bi-tools"></i> Backfill Missing Checkouts</button>' +
              '<button class="btn btn-primary btn-sm" onclick="app.openAddPunch()">' +
                '<i class="bi bi-plus-circle"></i> Add Punch</button>' +
            '</div>' +
          '</div>' +
          '<div class="row g-2 align-items-end flex-wrap">' +

            // From
            '<div class="col-auto">' +
              '<label class="form-label small mb-1">From</label>' +
              '<input type="date" id="atFrom" class="form-control form-control-sm" value="' + todayIso() + '">' +
            '</div>' +

            // To
            '<div class="col-auto">' +
              '<label class="form-label small mb-1">To</label>' +
              '<input type="date" id="atTo" class="form-control form-control-sm" value="' + todayIso() + '">' +
            '</div>' +

            // Employee — type to filter, pick from dropdown
            '<div class="col-auto" style="position:relative;min-width:220px">' +
              '<label class="form-label small mb-1">Employee</label>' +
              '<input id="atEmpSearch" class="form-control form-control-sm" placeholder="Type name or ID…"' +
                ' autocomplete="off" oninput="app.atFilterEmps()">' +
              '<select id="atEmpDrop" class="form-select form-select-sm mt-1" size="5"' +
                ' style="display:none;position:absolute;z-index:50;width:100%;max-height:140px"' +
                ' onchange="app.atPickEmp(this.value)"></select>' +
              '<input type="hidden" id="atEmpId">' +
            '</div>' +

            // Location dropdown
            '<div class="col-auto">' +
              '<label class="form-label small mb-1">Location</label>' +
              '<select id="atLocDrop" class="form-select form-select-sm" style="min-width:160px">' +
                '<option value="">All locations</option>' +
              '</select>' +
            '</div>' +

            // Stage dropdown
            '<div class="col-auto">' +
              '<label class="form-label small mb-1">Stage</label>' +
              '<select id="atStageDrop" class="form-select form-select-sm">' +
                '<option value="">All stages</option>' +
                STAGES.map(s => '<option>' + s + '</option>').join('') +
              '</select>' +
            '</div>' +

            // Buttons
            '<div class="col-auto d-flex gap-2">' +
              '<button class="btn btn-outline-secondary btn-sm" onclick="app.loadAttendance()">' +
                '<i class="bi bi-search"></i> Load</button>' +
              '<button class="btn btn-outline-secondary btn-sm" onclick="app.atClearFilters()">Clear</button>' +
            '</div>' +

          '</div>' +
        '</div>' +
        '<div id="atTableWrap" class="table-container table-responsive">' +
          '<div class="text-muted small">Set filters and click Load.</div></div>';

      // Close employee dropdown when clicking outside
      document.addEventListener('click', function (e) {
        const drop = document.getElementById('atEmpDrop');
        const inp  = document.getElementById('atEmpSearch');
        if (drop && inp && !drop.contains(e.target) && e.target !== inp)
          drop.style.display = 'none';
      });
    };
    attach();
  });

  // ── Wire ──────────────────────────────────────────────────────────────
  (function wire() {
    if (typeof app === 'undefined') return setTimeout(wire, 50);

    // Populate employee list + location dropdown from loaded data
    app.atInitFilters = function () {
      if (!app.employeesData || !app.employeesData.length) return;
      if (EMPS.length) return; // already done
      EMPS = app.employeesData.map(e => ({
        id       : e['Employee ID']    || '',
        name     : e['Name (English)'] || e['Name'] || '',
        location : e['Location']       || e['Branch'] || '',
      }));
      LOCS = [...new Set(EMPS.map(e => e.location).filter(Boolean))].sort();
      const locDrop = document.getElementById('atLocDrop');
      if (locDrop && locDrop.options.length <= 1) {
        LOCS.forEach(l => {
          const o = document.createElement('option');
          o.text = o.value = l;
          locDrop.add(o);
        });
      }
    };

    // Type in search box → show filtered dropdown
    app.atFilterEmps = function () {
      app.atInitFilters();
      const q    = (document.getElementById('atEmpSearch').value || '').toLowerCase().trim();
      const drop = document.getElementById('atEmpDrop');
      document.getElementById('atEmpId').value = '';
      if (!q) { drop.style.display = 'none'; return; }
      const hits = EMPS.filter(e =>
        e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
      ).slice(0, 20);
      drop.innerHTML = hits.map(e =>
        '<option value="' + e.id + '">' + e.id + ' — ' + e.name + '</option>'
      ).join('');
      drop.style.display = hits.length ? 'block' : 'none';
    };

    // Pick employee from dropdown
    app.atPickEmp = function (empId) {
      const emp = EMPS.find(e => e.id === empId);
      if (!emp) return;
      document.getElementById('atEmpSearch').value = emp.id + ' — ' + emp.name;
      document.getElementById('atEmpId').value     = emp.id;
      document.getElementById('atEmpDrop').style.display = 'none';
    };

    // Clear all filters
    app.atClearFilters = function () {
      const today = todayIso();
      ['atFrom','atTo'].forEach(id => { const el = document.getElementById(id); if (el) el.value = today; });
      ['atEmpSearch','atEmpId'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      ['atLocDrop','atStageDrop'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const d = document.getElementById('atEmpDrop'); if (d) d.style.display = 'none';
      const w = document.getElementById('atTableWrap');
      if (w) w.innerHTML = '<div class="text-muted small">Set filters and click Load.</div>';
    };

    // ── Load attendance ────────────────────────────────────────────────
    app.loadAttendance = async function () {
      app.atInitFilters();
      const wrap = document.getElementById('atTableWrap');
      wrap.innerHTML = '<div class="text-muted small">Loading…</div>';

      const from  = document.getElementById('atFrom').value;   // ISO yyyy-mm-dd
      const to    = document.getElementById('atTo').value;     // ISO yyyy-mm-dd
      const empId = document.getElementById('atEmpId').value.trim();
      const loc   = (document.getElementById('atLocDrop').value  || '').trim();
      const stage = (document.getElementById('atStageDrop').value || '').trim();

      // Validate
      if (!from || !to) {
        wrap.innerHTML = '<div class="alert alert-warning mb-0">Please set both From and To dates.</div>';
        return;
      }
      if (from > to) {
        wrap.innerHTML = '<div class="alert alert-warning mb-0">From date must be on or before To date.</div>';
        return;
      }

      // Build query — backend only understands: date=, empId=, location=
      // For a date range (from ≠ to) we send no date param and filter client-side.
      let qs = 'method=getAttendanceLog';
      const isRange = from !== to;
      if (!isRange) qs += '&date=' + encodeURIComponent(toDd(from));
      if (empId)    qs += '&empId=' + encodeURIComponent(empId);
      if (loc)      qs += '&location=' + encodeURIComponent(loc);

      try {
        const d = await api(qs);
        let rows = d.rows || [];

        // Client-side date range filter (when From ≠ To)
        if (isRange) {
          rows = rows.filter(r => {
            const iso = ddToIso(r.date);
            return iso >= from && iso <= to;
          });
        }

        // Client-side stage filter
        if (stage) rows = rows.filter(r => r.stage === stage);

        if (!rows.length) {
          wrap.innerHTML = '<div class="text-muted small">No punches found for this filter.</div>';
          return;
        }

        const body = rows.map(r => {
          const tm  = extractTime(r.ts);
          const gCls = /^OK/.test(r.flag) ? 'text-success' : /MANUAL/.test(r.flag) ? 'text-primary' : 'text-danger';
          return '<tr>' +
            '<td style="font-family:\'JetBrains Mono\',monospace;font-size:12px">' + r.empId + '</td>' +
            '<td>' + (r.name || '') + '</td>' +
            '<td style="font-family:\'JetBrains Mono\',monospace">' + r.date + '</td>' +
            '<td style="font-family:\'JetBrains Mono\',monospace">' + tm   + '</td>' +
            '<td>' + (r.shift  || '—') + '</td>' +
            '<td><span class="badge bg-secondary" style="font-size:12px;font-weight:500">' + r.stage + '</span></td>' +
            '<td>' + (r.branch || '') + '</td>' +
            '<td class="small ' + gCls + '">' + (r.flag || '—') + '</td>' +
            '<td class="text-end">' +
              '<button class="btn btn-outline-secondary btn-sm me-1"' +
                ' onclick="app.openEditPunch(' + r.row + ',\'' + r.stage + '\',\'' + tm + '\',\'' +
                  String(r.branch||'').replace(/'/g,"\\'") + '\')">' +
                '<i class="bi bi-pencil"></i></button>' +
              '<button class="btn btn-outline-danger btn-sm"' +
                ' onclick="app.deletePunch(' + r.row + ',\'' + r.empId + '\',\'' + r.stage + '\')">' +
                '<i class="bi bi-trash"></i></button>' +
            '</td>' +
          '</tr>';
        }).join('');

        wrap.innerHTML =
          '<div class="text-muted small mb-2">' + rows.length + ' punch' + (rows.length !== 1 ? 'es' : '') + '</div>' +
          '<table class="table table-sm table-striped align-middle">' +
            '<thead><tr>' +
              '<th>ID</th><th>Name</th><th>Date</th><th>Time</th>' +
              '<th>Shift</th><th>Stage</th><th>Location</th><th>Geo</th><th></th>' +
            '</tr></thead>' +
            '<tbody>' + body + '</tbody>' +
          '</table>';

      } catch (err) {
        wrap.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>';
      }
    };

    // ── Add Punch modal ────────────────────────────────────────────────
    app.openAddPunch = function () {
      app.atInitFilters();
      const empOpts = EMPS.map(e =>
        '<option value="' + e.id + '">' + e.name + ' (' + e.id + ')</option>'
      ).join('');
      const fromVal = (document.getElementById('atFrom') || {}).value || todayIso();
      const html =
        '<div class="modal fade" id="apModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content">' +
          '<div class="modal-header"><h5 class="modal-title">Add Punch (manual)</h5>' +
            '<button class="btn-close" data-bs-dismiss="modal"></button></div>' +
          '<div class="modal-body"><div class="row g-2">' +
            '<div class="col-12"><label class="form-label small mb-1">Employee</label>' +
              '<select id="apEmp" class="form-select form-select-sm">' + empOpts + '</select></div>' +
            '<div class="col-6"><label class="form-label small mb-1">Date</label>' +
              '<input type="date" id="apDate" class="form-control form-control-sm" value="' + fromVal + '"></div>' +
            '<div class="col-6"><label class="form-label small mb-1">Time</label>' +
              '<input type="time" id="apTime" class="form-control form-control-sm"></div>' +
            '<div class="col-6"><label class="form-label small mb-1">Stage</label>' +
              '<select id="apStage" class="form-select form-select-sm">' +
                STAGES.map(s => '<option>' + s + '</option>').join('') + '</select></div>' +
            '<div class="col-6"><label class="form-label small mb-1">Location</label>' +
              '<input id="apLoc" class="form-control form-control-sm"></div>' +
          '</div><div id="apStatus" class="mt-2"></div></div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancel</button>' +
            '<button class="btn btn-primary btn-sm" onclick="app.saveAddPunch()">' +
              '<i class="bi bi-check2"></i> Add</button></div>' +
        '</div></div></div>';
      const old = document.getElementById('apModal'); if (old) old.remove();
      document.body.insertAdjacentHTML('beforeend', html);
      new bootstrap.Modal(document.getElementById('apModal')).show();
    };

    app.saveAddPunch = async function () {
      const status  = document.getElementById('apStatus');
      const payload = {
        empId    : document.getElementById('apEmp').value,
        date     : toDd(document.getElementById('apDate').value),
        time     : document.getElementById('apTime').value,
        stage    : document.getElementById('apStage').value,
        location : document.getElementById('apLoc').value.trim(),
        by       : adminEmail()
      };
      if (!payload.empId || !payload.date) {
        status.innerHTML = '<div class="alert alert-warning mb-0 py-1">Employee and date required.</div>';
        return;
      }
      try {
        const d = await post('addAttendancePunch', payload);
        status.innerHTML = '<div class="alert alert-success mb-0 py-1">' + d.message + '</div>';
        setTimeout(() => {
          const m = bootstrap.Modal.getInstance(document.getElementById('apModal'));
          if (m) m.hide();
          app.loadAttendance();
        }, 1000);
      } catch (err) {
        status.innerHTML = '<div class="alert alert-danger mb-0 py-1">' + err.message + '</div>';
      }
    };

    // ── Backfill Missing Checkouts — Preview → Commit ───────────────────
    // Never a single "just do it" button. Preview shows exactly what would
    // be added and what's being skipped as still-in-progress; nothing is
    // written until Commit is explicitly clicked, and Commit re-detects
    // fresh server-side rather than trusting anything shown in preview.
    app.openBackfillCheckouts = function () {
      const html =
        '<div class="modal fade" id="bfModal" tabindex="-1"><div class="modal-dialog modal-xl"><div class="modal-content">' +
          '<div class="modal-header"><h5 class="modal-title">' +
            '<i class="bi bi-tools"></i> Backfill Missing Checkouts</h5>' +
            '<button class="btn-close" data-bs-dismiss="modal"></button></div>' +
          '<div class="modal-body">' +
            '<p class="text-muted small">Finds every Check In with no matching Check Out, and computes a ' +
              'checkout using that employee\'s shift length. Anything still legitimately in progress ' +
              '(the computed checkout would be in the future) is automatically excluded.</p>' +
            '<div class="row g-2 align-items-end mb-3">' +
              '<div class="col-auto"><label class="form-label small mb-1">From (optional)</label>' +
                '<input type="date" id="bfFrom" class="form-control form-control-sm"></div>' +
              '<div class="col-auto"><label class="form-label small mb-1">To (optional)</label>' +
                '<input type="date" id="bfTo" class="form-control form-control-sm"></div>' +
              '<div class="col-auto"><button class="btn btn-outline-secondary btn-sm" onclick="app.previewBackfill()">' +
                '<i class="bi bi-search"></i> Preview</button></div>' +
              '<div class="col-auto text-muted small">Leave both blank to scan your entire history.</div>' +
            '</div>' +
            '<div id="bfResults"><div class="text-muted small">Set a range (optional) and click Preview.</div></div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>' +
            '<button class="btn btn-danger" id="bfCommitBtn" style="display:none" onclick="app.commitBackfill()">' +
              '<i class="bi bi-check2-circle"></i> Commit — Add These Checkouts</button>' +
          '</div>' +
        '</div></div></div>';
      const old = document.getElementById('bfModal'); if (old) old.remove();
      document.body.insertAdjacentHTML('beforeend', html);
      new bootstrap.Modal(document.getElementById('bfModal')).show();
    };

    app.previewBackfill = async function () {
      const wrap = document.getElementById('bfResults');
      const commitBtn = document.getElementById('bfCommitBtn');
      commitBtn.style.display = 'none';
      wrap.innerHTML = '<div class="text-muted small"><span class="spinner-border spinner-border-sm"></span> Scanning entire attendance history…</div>';

      const fromIso = document.getElementById('bfFrom').value;
      const toIso   = document.getElementById('bfTo').value;
      let qs = 'method=previewMissingCheckouts';
      if (fromIso) qs += '&from=' + encodeURIComponent(toDd(fromIso));
      if (toIso)   qs += '&to='   + encodeURIComponent(toDd(toIso));

      try {
        const d = await api(qs);
        if (!d.success) { wrap.innerHTML = '<div class="alert alert-danger mb-0">' + d.error + '</div>'; return; }

        if (!d.willFixCount && !d.skippedCount) {
          wrap.innerHTML = '<div class="alert alert-success mb-0">No dangling Check Ins found in this range.</div>';
          return;
        }

        let html = '';

        if (d.willFixCount) {
          html += '<div class="alert alert-warning mb-2">' +
            '<b>' + d.willFixCount + '</b> checkout' + (d.willFixCount!==1?'s':'') + ' will be added ' +
            '(Check In is never changed — only the missing Check Out):</div>' +
            '<div class="table-responsive mb-3" style="max-height:280px;overflow-y:auto">' +
            '<table class="table table-sm table-striped">' +
              '<thead><tr><th>ID</th><th>Name</th><th>Date</th><th>Check In</th>' +
                '<th>Basis</th><th>+OT</th><th>Computed Check Out</th></tr></thead>' +
              '<tbody>' + d.willFix.map(f =>
                '<tr><td style="font-family:monospace;font-size:12px">' + f.empId + '</td>' +
                '<td>' + f.name + '</td><td>' + f.date + '</td><td>' + f.checkIn + '</td>' +
                '<td class="small">' + f.basis + '</td>' +
                '<td>' + (f.otHours > 0 ? f.otHours + 'h' : '—') + '</td>' +
                '<td><b>' + f.computedCheckOut + '</b>' +
                  (f.computedCheckOutDate !== f.date ? ' <span class="text-muted small">(' + f.computedCheckOutDate + ')</span>' : '') +
                '</td></tr>'
              ).join('') + '</tbody></table></div>';
        }

        if (d.skippedCount) {
          html += '<div class="alert alert-secondary mb-0">' +
            '<b>' + d.skippedCount + '</b> skipped — still in progress (computed checkout would be in the future):' +
            '<ul class="mb-0 small mt-1">' + d.skippedInProgress.map(f =>
              '<li>' + f.name + ' (' + f.empId + ') — checked in ' + f.date + ' ' + f.checkIn + '</li>'
            ).join('') + '</ul></div>';
        }

        wrap.innerHTML = html;
        if (d.willFixCount) commitBtn.style.display = 'inline-block';
      } catch (err) {
        wrap.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>';
      }
    };

    app.commitBackfill = async function () {
      if (!confirm('This will write real Check Out rows to Attendance_Log and recompile Attendance_Daily for every affected date. Continue?')) return;

      const wrap = document.getElementById('bfResults');
      const commitBtn = document.getElementById('bfCommitBtn');
      commitBtn.disabled = true;
      wrap.insertAdjacentHTML('afterbegin', '<div class="alert alert-info" id="bfCommitStatus"><span class="spinner-border spinner-border-sm"></span> Writing checkouts and recompiling Attendance_Daily — this may take a moment…</div>');

      const fromIso = document.getElementById('bfFrom').value;
      const toIso   = document.getElementById('bfTo').value;
      const payload = { by: adminEmail() };
      if (fromIso) payload.from = toDd(fromIso);
      if (toIso)   payload.to   = toDd(toIso);

      try {
        const d = await post('commitMissingCheckouts', payload);
        const statusEl = document.getElementById('bfCommitStatus');
        if (d.success) {
          statusEl.className = 'alert alert-success';
          statusEl.innerHTML = '<i class="bi bi-check-circle"></i> ' + d.message +
            (d.recompiledDates && d.recompiledDates.length
              ? '<div class="small mt-1">Recompiled: ' + d.recompiledDates.join(', ') + '</div>' : '');
          commitBtn.style.display = 'none';
        } else {
          statusEl.className = 'alert alert-danger';
          statusEl.innerText = d.error;
          commitBtn.disabled = false;
        }
      } catch (err) {
        const statusEl = document.getElementById('bfCommitStatus');
        statusEl.className = 'alert alert-danger';
        statusEl.innerText = err.message;
        commitBtn.disabled = false;
      }
    };

    // ── Edit Punch modal ───────────────────────────────────────────────
    app.openEditPunch = function (row, stage, time, loc) {
      const html =
        '<div class="modal fade" id="epuModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content">' +
          '<div class="modal-header"><h5 class="modal-title">Edit Punch</h5>' +
            '<button class="btn-close" data-bs-dismiss="modal"></button></div>' +
          '<div class="modal-body"><div class="row g-2">' +
            '<div class="col-6"><label class="form-label small mb-1">Stage</label>' +
              '<select id="epuStage" class="form-select form-select-sm">' +
                STAGES.map(s => '<option' + (s===stage?' selected':'') + '>' + s + '</option>').join('') +
              '</select></div>' +
            '<div class="col-6"><label class="form-label small mb-1">Time</label>' +
              '<input type="time" id="epuTime" class="form-control form-control-sm" value="' + (time||'') + '"></div>' +
            '<div class="col-12"><label class="form-label small mb-1">Location</label>' +
              '<input id="epuLoc" class="form-control form-control-sm" value="' + (loc||'') + '"></div>' +
          '</div><div id="epuStatus" class="mt-2"></div></div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancel</button>' +
            '<button class="btn btn-primary btn-sm" onclick="app.saveEditPunch(' + row + ')">' +
              '<i class="bi bi-check2"></i> Save</button></div>' +
        '</div></div></div>';
      const old = document.getElementById('epuModal'); if (old) old.remove();
      document.body.insertAdjacentHTML('beforeend', html);
      new bootstrap.Modal(document.getElementById('epuModal')).show();
    };

    app.saveEditPunch = async function (row) {
      const status  = document.getElementById('epuStatus');
      const payload = {
        row      : row,
        stage    : document.getElementById('epuStage').value,
        time     : document.getElementById('epuTime').value,
        location : document.getElementById('epuLoc').value.trim(),
        by       : adminEmail()
      };
      try {
        const d = await post('editAttendancePunch', payload);
        status.innerHTML = '<div class="alert alert-success mb-0 py-1">' + d.message + '</div>';
        setTimeout(() => {
          const m = bootstrap.Modal.getInstance(document.getElementById('epuModal'));
          if (m) m.hide();
          app.loadAttendance();
        }, 1000);
      } catch (err) {
        status.innerHTML = '<div class="alert alert-danger mb-0 py-1">' + err.message + '</div>';
      }
    };

    app.deletePunch = async function (row, empId, stage) {
      if (!confirm('Delete ' + stage + ' for ' + empId + '?')) return;
      try {
        await api('method=deleteAttendancePunch&row=' + row + '&by=' + encodeURIComponent(adminEmail()));
        app.loadAttendance();
      } catch (err) { alert(err.message); }
    };

  })();
})();
