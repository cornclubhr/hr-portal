// ============================================================
// leavetypes-ui.js — Leave Types + Leave Allocation pages (drop-in)
// ------------------------------------------------------------
// One line in index.html, AFTER grant-ui.js:
//   <script src="leavetypes-ui.js"></script>
// Backend: getLeaveTypesFull, saveLeaveType, deleteLeaveType,
//          allocateLeave, migrateRemainingToAnnual.
// ============================================================

(function () {
  const EXEC_URL = CONFIG.API_URL;
  let LTYPES = [];

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
  const yn = (b) => b ? '<span class="badge bg-success">Yes</span>' : '<span class="badge bg-secondary">No</span>';

  function addNav(label, page, icon, afterPage, title, onOpen) {
    const navList = document.querySelector('#sidebar ul.nav');
    if (!navList || document.querySelector('[data-page="' + page + '"]')) return;
    const li = document.createElement('li'); li.className = 'nav-item';
    li.innerHTML = '<a class="nav-link" data-page="' + page + '"><i class="bi ' + icon + '"></i> ' + label + '</a>';
    const after = document.querySelector('[data-page="' + afterPage + '"]');
    if (after && after.closest('li')) after.closest('li').insertAdjacentElement('afterend', li);
    else navList.appendChild(li);
    li.querySelector('.nav-link').addEventListener('click', function (e) {
      e.preventDefault();
      document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active'));
      this.classList.add('active');
      document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
      const pg = document.getElementById('page-' + page); if (pg) pg.classList.add('active');
      document.getElementById('pageTitle').innerText = title;
      if (onOpen) onOpen();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    addNav('Leave Types', 'leavetypes', 'bi-tags', 'leavebal', 'Leave Types', function () { if (app.loadLeaveTypesPage) app.loadLeaveTypesPage(); });
    addNav('Leave Allocation', 'leavealloc', 'bi-diagram-3', 'leavetypes', 'Leave Allocation', function () { if (app.loadAllocPage) app.loadAllocPage(); });

    const anchor = document.getElementById('page-dashboard');
    if (!anchor || !anchor.parentElement) return;

    if (!document.getElementById('page-leavetypes')) {
      const s = document.createElement('div'); s.className = 'page-section'; s.id = 'page-leavetypes';
      s.innerHTML =
        '<div class="table-container mb-4">' +
          '<div class="d-flex justify-content-between align-items-center mb-3"><h5><i class="bi bi-tags"></i> Leave Types</h5>' +
            '<button class="btn btn-primary btn-sm" onclick="app.openLeaveType()"><i class="bi bi-plus-lg"></i> New Type</button></div>' +
          '<div id="ltTableWrap" class="table-responsive"><div class="text-muted small">Loading…</div></div>' +
          '<div class="text-muted small mt-2"><b>Is Paid = No</b> → payroll deducts those days (Basic ÷ 26 × days). <b>Excludes From Payroll = Yes</b> → status flips to On Leave.</div>' +
        '</div>';
      anchor.parentElement.appendChild(s);
    }

    if (!document.getElementById('page-leavealloc')) {
      const s = document.createElement('div'); s.className = 'page-section'; s.id = 'page-leavealloc';
      s.innerHTML =
        '<div class="table-container mb-4">' +
          '<h5 class="mb-3"><i class="bi bi-diagram-3"></i> Allocate Leave</h5>' +
          '<div class="row g-2 align-items-end">' +
            '<div class="col-md-3"><label class="form-label small mb-1">Leave Type</label><select id="alType" class="form-select form-select-sm"></select></div>' +
            '<div class="col-md-2"><label class="form-label small mb-1">Days</label><input id="alDays" type="number" class="form-control form-control-sm" min="0"></div>' +
            '<div class="col-md-2"><label class="form-label small mb-1">Mode</label><select id="alMode" class="form-select form-select-sm"><option value="set">Set to</option><option value="topup">Top-up (add)</option></select></div>' +
            '<div class="col-md-3"><label class="form-label small mb-1">Apply to</label><select id="alScope" class="form-select form-select-sm" onchange="app.allocScopeChange()"><option value="all">All employees</option><option value="branch">A branch</option><option value="ids">Specific IDs</option></select></div>' +
            '<div class="col-md-2"><button class="btn btn-primary btn-sm w-100" onclick="app.doAllocate()"><i class="bi bi-check2"></i> Allocate</button></div>' +
            '<div class="col-md-6" id="alScopeExtraWrap" style="display:none"><label class="form-label small mb-1" id="alScopeExtraLabel"></label><input id="alScopeExtra" class="form-control form-control-sm"></div>' +
          '</div>' +
          '<div id="alStatus" class="mt-2"></div>' +
        '</div>' +
        '<div class="table-container">' +
          '<h6 class="mb-2"><i class="bi bi-arrow-left-right"></i> One-time migration: Remaining Vacation → Annual</h6>' +
          '<div class="text-muted small mb-2">Seeds each employee\'s current HR HR <b>Remaining Vacation</b> into their <b>Annual</b> balance. Run once. Preview first.</div>' +
          '<button class="btn btn-outline-secondary btn-sm" onclick="app.migrateAnnual(true)"><i class="bi bi-search"></i> Preview</button> ' +
          '<button class="btn btn-warning btn-sm" onclick="app.migrateAnnual(false)"><i class="bi bi-check2-all"></i> Commit</button>' +
          '<div id="migAnnualStatus" class="mt-2"></div>' +
        '</div>';
      anchor.parentElement.appendChild(s);
    }
  });

  (function attach() {
    if (typeof app === 'undefined') return setTimeout(attach, 50);

    app.loadLeaveTypesPage = async function () {
      const wrap = document.getElementById('ltTableWrap');
      wrap.innerHTML = '<div class="text-muted small">Loading…</div>';
      try {
        const d = await callApi('method=getLeaveTypesFull'); LTYPES = d.data || [];
        if (!LTYPES.length) { wrap.innerHTML = '<div class="text-muted small">No leave types yet.</div>'; return; }
        const body = LTYPES.map(t =>
          '<tr' + (t.active ? '' : ' class="table-secondary"') + '><td><b>' + t.type + '</b></td>' +
          '<td>' + yn(t.isPaid) + '</td><td class="text-end">' + t.entitlement + '</td>' +
          '<td>' + yn(t.canEncash) + '</td><td>' + yn(t.canCarry) + '</td><td>' + yn(t.excludesFromPayroll) + '</td>' +
          '<td>' + yn(t.active) + '</td>' +
          '<td class="text-end"><button class="btn btn-outline-secondary btn-sm me-1" onclick="app.openLeaveType(\'' + t.type.replace(/'/g,"\\'") + '\')"><i class="bi bi-pencil"></i></button>' +
            '<button class="btn btn-outline-danger btn-sm" onclick="app.retireLeaveType(\'' + t.type.replace(/'/g,"\\'") + '\')"><i class="bi bi-archive"></i></button></td></tr>').join('');
        wrap.innerHTML = '<table class="table table-sm table-striped align-middle"><thead><tr>' +
          '<th>Type</th><th>Paid</th><th class="text-end">Entitlement</th><th>Encashable</th><th>Carry Fwd</th><th>Excl. Payroll</th><th>Active</th><th></th>' +
          '</tr></thead><tbody>' + body + '</tbody></table>';
      } catch (err) { wrap.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>'; }
    };

    app.openLeaveType = function (name) {
      const t = name ? LTYPES.find(x => x.type === name) : null;
      const chk = (id, on) => '<input type="checkbox" class="form-check-input" id="' + id + '"' + (on ? ' checked' : '') + '>';
      const html =
        '<div class="modal fade" id="ltModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content">' +
          '<div class="modal-header"><h5 class="modal-title">' + (t ? 'Edit' : 'New') + ' Leave Type</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>' +
          '<div class="modal-body"><div class="row g-3">' +
            '<div class="col-8"><label class="form-label small mb-1">Type name</label><input id="ltName" class="form-control form-control-sm" value="' + (t ? t.type : '') + '"' + (t ? ' readonly' : '') + '></div>' +
            '<div class="col-4"><label class="form-label small mb-1">Entitlement (days)</label><input id="ltEnt" type="number" class="form-control form-control-sm" value="' + (t ? t.entitlement : 0) + '"></div>' +
            '<div class="col-12"><div class="form-check">' + chk('ltPaid', t ? t.isPaid : true) + '<label class="form-check-label" for="ltPaid"><b>Is Paid</b> — unchecked means payroll deducts these days</label></div>' +
              '<div class="form-check">' + chk('ltExc', t ? t.excludesFromPayroll : false) + '<label class="form-check-label" for="ltExc">Excludes From Payroll (flips to On Leave)</label></div>' +
              '<div class="form-check">' + chk('ltEnc', t ? t.canEncash : false) + '<label class="form-check-label" for="ltEnc">Encashable</label></div>' +
              '<div class="form-check">' + chk('ltCar', t ? t.canCarry : false) + '<label class="form-check-label" for="ltCar">Carry Forward</label></div>' +
              '<div class="form-check">' + chk('ltAct', t ? t.active : true) + '<label class="form-check-label" for="ltAct">Active</label></div>' +
            '</div>' +
            (t ? '' : '<div class="col-12"><div class="form-check">' + chk('ltAllocAll', false) + '<label class="form-check-label" for="ltAllocAll">Allocate the entitlement to <b>all employees</b> now</label></div></div>') +
            '<div class="col-12"><label class="form-label small mb-1">Notes</label><input id="ltNotes" class="form-control form-control-sm" value="' + (t ? String(t.notes).replace(/"/g,'&quot;') : '') + '"></div>' +
          '</div><div id="ltStatus" class="mt-2"></div></div>' +
          '<div class="modal-footer"><button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancel</button>' +
            '<button class="btn btn-primary btn-sm" onclick="app.saveLeaveType()"><i class="bi bi-check2"></i> Save</button></div>' +
        '</div></div></div>';
      const old = document.getElementById('ltModal'); if (old) old.remove();
      document.body.insertAdjacentHTML('beforeend', html);
      new bootstrap.Modal(document.getElementById('ltModal')).show();
    };

    app.saveLeaveType = async function () {
      const status = document.getElementById('ltStatus');
      const chk = (id) => { const el = document.getElementById(id); return el && el.checked; };
      const name = document.getElementById('ltName').value.trim();
      if (!name) { status.innerHTML = '<div class="alert alert-warning mb-0 py-1">Name required.</div>'; return; }
      const payload = {
        name: name, entitlement: document.getElementById('ltEnt').value,
        isPaid: chk('ltPaid') ? 'Yes' : 'No', excludesFromPayroll: chk('ltExc') ? 'Yes' : 'No',
        canEncash: chk('ltEnc') ? 'Yes' : 'No', canCarry: chk('ltCar') ? 'Yes' : 'No',
        active: chk('ltAct') ? 'Yes' : 'No', notes: document.getElementById('ltNotes').value,
        allocateAll: chk('ltAllocAll') ? 'Yes' : 'No'
      };
      try {
        const d = await callPost('saveLeaveType', payload);
        status.innerHTML = '<div class="alert alert-success mb-0 py-1">' + d.message + '</div>';
        setTimeout(() => { const m = bootstrap.Modal.getInstance(document.getElementById('ltModal')); if (m) m.hide(); app.loadLeaveTypesPage(); }, 1200);
      } catch (err) { status.innerHTML = '<div class="alert alert-danger mb-0 py-1">' + err.message + '</div>'; }
    };

    app.retireLeaveType = async function (name) {
      if (!confirm('Retire leave type "' + name + '"? It will be marked inactive (history preserved). To hard-delete, do it in the sheet.')) return;
      try { await callApi('method=deleteLeaveType&name=' + encodeURIComponent(name)); app.loadLeaveTypesPage(); }
      catch (err) { alert(err.message); }
    };

    app.loadAllocPage = async function () {
      try { const d = await callApi('method=getLeaveTypesFull'); LTYPES = d.data || []; } catch (e) { LTYPES = []; }
      const sel = document.getElementById('alType');
      if (sel) sel.innerHTML = LTYPES.filter(t => t.active).map(t => '<option>' + t.type + '</option>').join('');
    };

    app.allocScopeChange = function () {
      const scope = document.getElementById('alScope').value;
      const wrap = document.getElementById('alScopeExtraWrap');
      const label = document.getElementById('alScopeExtraLabel');
      if (scope === 'branch') { wrap.style.display = ''; label.innerText = 'Branch name'; }
      else if (scope === 'ids') { wrap.style.display = ''; label.innerText = 'Employee IDs (comma-separated)'; }
      else { wrap.style.display = 'none'; }
    };

    app.doAllocate = async function () {
      const status = document.getElementById('alStatus');
      const payload = {
        type: document.getElementById('alType').value,
        days: document.getElementById('alDays').value,
        mode: document.getElementById('alMode').value,
        scope: document.getElementById('alScope').value
      };
      if (payload.scope === 'branch') payload.branch = document.getElementById('alScopeExtra').value.trim();
      if (payload.scope === 'ids') payload.ids = document.getElementById('alScopeExtra').value.trim();
      if (!payload.type || payload.days === '') { status.innerHTML = '<div class="alert alert-warning mb-0">Type and days required.</div>'; return; }
      status.innerHTML = '<div class="text-muted small">Allocating…</div>';
      try { const d = await callPost('allocateLeave', payload); status.innerHTML = '<div class="alert alert-success mb-0">' + d.message + '</div>';
        if (d.negatives && d.negatives.length) {
          alert('Heads up — these employees were negative in ' + payload.type + ' before this allocation. Allocate more if needed:\n\n' +
            d.negatives.map(x => '• ' + x.name + ' (' + x.id + '): ' + x.remaining).join('\n'));
        }
      }
      catch (err) { status.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>'; }
    };

    app.migrateAnnual = async function (preview) {
      const status = document.getElementById('migAnnualStatus');
      if (!preview && !confirm('Commit: set every employee\'s Annual balance from their current Remaining Vacation? Run this only once.')) return;
      status.innerHTML = '<div class="text-muted small">' + (preview ? 'Building preview…' : 'Migrating…') + '</div>';
      try {
        const d = await callApi('method=migrateRemainingToAnnual' + (preview ? '&preview=true' : ''));
        let html = '<div class="alert ' + (preview ? 'alert-info' : 'alert-success') + ' mb-0">' + d.message + '</div>';
        if (d.sample && d.sample.length) html += '<div class="small mt-1 text-muted">e.g. ' + d.sample.map(s => s.name + ': ' + s.remaining).join(', ') + '…</div>';
        status.innerHTML = html;
      } catch (err) { status.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>'; }
    };
  })();
})();
