// ============================================================
// shifts-ui.js — Shifts page: define shifts + assign to staff (drop-in)
// ------------------------------------------------------------
// index.html (after leavetypes-ui.js):  <script src="shifts-ui.js"></script>
// Backend: getShifts, saveShift, deleteShift, assignShift.
// ============================================================

(function () {
  const EXEC_URL = CONFIG.API_URL;
  let SHIFTS = [];

  async function callApi(qs) {
    const res = await fetch(EXEC_URL + '?' + qs + '&_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json(); if (!d.success) throw new Error(d.error || 'Unknown error'); return d;
  }
  async function callPost(method, body) {
    const res = await fetch(EXEC_URL + '?method=' + method, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json(); if (!d.success) throw new Error(d.error || 'Unknown error'); return d;
  }

  document.addEventListener('DOMContentLoaded', function () {
    const navList = document.querySelector('#sidebar ul.nav');
    if (navList && !document.querySelector('[data-page="shifts"]')) {
      const li = document.createElement('li'); li.className = 'nav-item';
      li.innerHTML = '<a class="nav-link" data-page="shifts"><i class="bi bi-clock-history"></i> Shifts</a>';
      const att = document.querySelector('[data-page="attendance"]');
      if (att && att.closest('li')) att.closest('li').insertAdjacentElement('afterend', li);
      else navList.appendChild(li);
      li.querySelector('.nav-link').addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        const pg = document.getElementById('page-shifts'); if (pg) pg.classList.add('active');
        document.getElementById('pageTitle').innerText = 'Shifts';
        if (app.loadShiftsPage) app.loadShiftsPage();
      });
    }

    const anchor = document.getElementById('page-dashboard');
    if (anchor && anchor.parentElement && !document.getElementById('page-shifts')) {
      const s = document.createElement('div'); s.className = 'page-section'; s.id = 'page-shifts';
      s.innerHTML =
        '<div class="table-container mb-4">' +
          '<div class="d-flex justify-content-between align-items-center mb-3"><h5><i class="bi bi-clock-history"></i> Shifts</h5>' +
            '<button class="btn btn-primary btn-sm" onclick="app.openShift()"><i class="bi bi-plus-lg"></i> New Shift</button></div>' +
          '<div id="shTableWrap" class="table-responsive"><div class="text-muted small">Loading…</div></div>' +
          '<div class="text-muted small mt-2">Normal Hours is the <b>total</b> shift length incl. break. OT = presence − Normal Hours. Grace applies to check-in only.</div>' +
        '</div>' +
        '<div class="table-container">' +
          '<h6 class="mb-3"><i class="bi bi-diagram-3"></i> Assign Shift to Staff</h6>' +
          '<div class="row g-2 align-items-end">' +
            '<div class="col-md-3"><label class="form-label small mb-1">Shift</label><select id="asShift" class="form-select form-select-sm"></select></div>' +
            '<div class="col-md-3"><label class="form-label small mb-1">Apply to</label><select id="asScope" class="form-select form-select-sm" onchange="app.shiftScopeChange()"><option value="all">All employees</option><option value="branch">A location</option><option value="ids">Specific IDs</option></select></div>' +
            '<div class="col-md-4" id="asExtraWrap" style="display:none"><label class="form-label small mb-1" id="asExtraLabel"></label><select id="asExtraLoc" class="form-select form-select-sm" style="display:none"></select><input id="asExtra" class="form-control form-control-sm"></div>' +
            '<div class="col-md-2"><button class="btn btn-primary btn-sm w-100" onclick="app.doAssignShift()"><i class="bi bi-check2"></i> Assign</button></div>' +
          '</div>' +
          '<div id="asStatus" class="mt-2"></div>' +
        '</div>';
      anchor.parentElement.appendChild(s);
    }
  });

  (function attach() {
    if (typeof app === 'undefined') return setTimeout(attach, 50);

    app.loadShiftsPage = async function () {
      const wrap = document.getElementById('shTableWrap');
      wrap.innerHTML = '<div class="text-muted small">Loading…</div>';
      try {
        const d = await callApi('method=getShifts'); SHIFTS = d.data || [];
        const body = SHIFTS.map(s =>
          '<tr' + (s.active ? '' : ' class="table-secondary"') + '><td><b>' + s.name + '</b></td>' +
          '<td>' + s.start + '</td><td>' + s.end + '</td><td class="text-end">' + s.normalHours + '</td>' +
          '<td class="text-end">' + s.breakMinutes + '</td><td class="text-end">' + s.graceMinutes + '</td>' +
          '<td>' + (s.autoPresent ? '<span class="badge bg-info text-dark">Auto ' + (s.weeklyOff ? '(off ' + s.weeklyOff + ')' : '') + '</span>' : '') + '</td>' +
          '<td>' + (s.active ? '<span class="badge bg-success">Yes</span>' : '<span class="badge bg-secondary">No</span>') + '</td>' +
          '<td class="text-end"><button class="btn btn-outline-secondary btn-sm me-1" onclick="app.openShift(\'' + s.name.replace(/'/g,"\\'") + '\')"><i class="bi bi-pencil"></i></button>' +
            '<button class="btn btn-outline-danger btn-sm" onclick="app.retireShift(\'' + s.name.replace(/'/g,"\\'") + '\')"><i class="bi bi-archive"></i></button></td></tr>').join('');
        wrap.innerHTML = '<table class="table table-sm table-striped align-middle"><thead><tr>' +
          '<th>Shift</th><th>Start</th><th>End</th><th class="text-end">Normal Hrs</th><th class="text-end">Break min</th><th class="text-end">Grace min</th><th>Attendance</th><th>Active</th><th></th>' +
          '</tr></thead><tbody>' + body + '</tbody></table>';
        const sel = document.getElementById('asShift');
        if (sel) sel.innerHTML = SHIFTS.filter(s => s.active).map(s => '<option>' + s.name + '</option>').join('');
      } catch (err) { wrap.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>'; }
    };

    app.openShift = function (name) {
      const s = name ? SHIFTS.find(x => x.name === name) : null;
      const val = (k, d) => s ? s[k] : d;
      const html =
        '<div class="modal fade" id="shModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content">' +
          '<div class="modal-header"><h5 class="modal-title">' + (s ? 'Edit' : 'New') + ' Shift</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>' +
          '<div class="modal-body"><div class="row g-3">' +
            '<div class="col-12"><label class="form-label small mb-1">Shift name</label><input id="shName" class="form-control form-control-sm" value="' + (s ? s.name : '') + '"' + (s ? ' readonly' : '') + '></div>' +
            '<div class="col-6"><label class="form-label small mb-1">Start (HH:mm)</label><input id="shStart" class="form-control form-control-sm" placeholder="05:30" value="' + val('start','') + '"></div>' +
            '<div class="col-6"><label class="form-label small mb-1">End (HH:mm)</label><input id="shEnd" class="form-control form-control-sm" placeholder="14:30" value="' + val('end','') + '"></div>' +
            '<div class="col-4"><label class="form-label small mb-1">Normal Hours</label><input id="shNH" type="number" step="0.25" class="form-control form-control-sm" value="' + val('normalHours',9) + '"></div>' +
            '<div class="col-4"><label class="form-label small mb-1">Break (min)</label><input id="shBreak" type="number" class="form-control form-control-sm" value="' + val('breakMinutes',60) + '"></div>' +
            '<div class="col-4"><label class="form-label small mb-1">Grace (min)</label><input id="shGrace" type="number" class="form-control form-control-sm" value="' + val('graceMinutes',10) + '"></div>' +
            '<div class="col-12"><div class="form-check"><input type="checkbox" class="form-check-input" id="shAutoPresent"' + (val('autoPresent',false) ? ' checked' : '') + '><label class="form-check-label" for="shAutoPresent"><b>Auto Present</b> — staff on this shift are counted present without punching (e.g. Head Office). No OT.</label></div></div>' +
            '<div class="col-12"><label class="form-label small mb-1">Weekly Off (comma-separated day names)</label><input id="shWeeklyOff" class="form-control form-control-sm" placeholder="Fri, Sat" value="' + val('weeklyOff','') + '"></div>' +
            '<div class="col-12"><div class="form-check"><input type="checkbox" class="form-check-input" id="shActive"' + (val('active',true) ? ' checked' : '') + '><label class="form-check-label" for="shActive">Active</label></div></div>' +
          '</div><div id="shStatus" class="mt-2"></div>' +
          '<div class="text-muted small mt-1">Normal Hours = full shift length incl. break (e.g. 9). End is informational — OT is presence-based.</div></div>' +
          '<div class="modal-footer"><button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancel</button>' +
            '<button class="btn btn-primary btn-sm" onclick="app.saveShift()"><i class="bi bi-check2"></i> Save</button></div>' +
        '</div></div></div>';
      const old = document.getElementById('shModal'); if (old) old.remove();
      document.body.insertAdjacentHTML('beforeend', html);
      new bootstrap.Modal(document.getElementById('shModal')).show();
    };

    app.saveShift = async function () {
      const status = document.getElementById('shStatus');
      const payload = {
        name: document.getElementById('shName').value.trim(),
        start: document.getElementById('shStart').value.trim(),
        end: document.getElementById('shEnd').value.trim(),
        normalHours: document.getElementById('shNH').value,
        breakMinutes: document.getElementById('shBreak').value,
        graceMinutes: document.getElementById('shGrace').value,
        autoPresent: document.getElementById('shAutoPresent').checked ? 'Yes' : 'No',
        weeklyOff: document.getElementById('shWeeklyOff').value.trim(),
        active: document.getElementById('shActive').checked ? 'Yes' : 'No'
      };
      if (!payload.name) { status.innerHTML = '<div class="alert alert-warning mb-0 py-1">Name required.</div>'; return; }
      try {
        const d = await callPost('saveShift', payload);
        status.innerHTML = '<div class="alert alert-success mb-0 py-1">' + d.message + '</div>';
        setTimeout(() => { const m = bootstrap.Modal.getInstance(document.getElementById('shModal')); if (m) m.hide(); app.loadShiftsPage(); }, 1000);
      } catch (err) { status.innerHTML = '<div class="alert alert-danger mb-0 py-1">' + err.message + '</div>'; }
    };

    app.retireShift = async function (name) {
      if (!confirm('Retire shift "' + name + '"? (marked inactive; history kept)')) return;
      try { await callApi('method=deleteShift&name=' + encodeURIComponent(name)); app.loadShiftsPage(); }
      catch (err) { alert(err.message); }
    };

    app.shiftScopeChange = function () {
      const scope = document.getElementById('asScope').value;
      const wrap = document.getElementById('asExtraWrap'), label = document.getElementById('asExtraLabel');
      const locSel = document.getElementById('asExtraLoc'), txt = document.getElementById('asExtra');
      if (scope === 'branch') {
        wrap.style.display = ''; label.innerText = 'Location';
        locSel.style.display = ''; txt.style.display = 'none';
        callApi('method=getLocations').then(d => { locSel.innerHTML = (d.data || []).filter(l => l.active).map(l => '<option>' + l.name + '</option>').join(''); }).catch(() => {});
      } else if (scope === 'ids') {
        wrap.style.display = ''; label.innerText = 'Employee IDs (comma-separated)';
        locSel.style.display = 'none'; txt.style.display = '';
      } else { wrap.style.display = 'none'; }
    };

    app.doAssignShift = async function () {
      const status = document.getElementById('asStatus');
      const payload = { shift: document.getElementById('asShift').value, scope: document.getElementById('asScope').value };
      if (payload.scope === 'branch') payload.branch = document.getElementById('asExtraLoc').value.trim();
      if (payload.scope === 'ids') payload.ids = document.getElementById('asExtra').value.trim();
      if (!payload.shift) { status.innerHTML = '<div class="alert alert-warning mb-0">Pick a shift.</div>'; return; }
      status.innerHTML = '<div class="text-muted small">Assigning…</div>';
      try { const d = await callPost('assignShift', payload); status.innerHTML = '<div class="alert alert-success mb-0">' + d.message + '</div>'; }
      catch (err) { status.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>'; }
    };
  })();
})();
