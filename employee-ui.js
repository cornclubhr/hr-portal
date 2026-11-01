// ============================================================
// employee-ui.js — wires "Save Employee" (add + edit) with auto ID + PIN
// ------------------------------------------------------------
// One line in index.html, AFTER app.js (order among the *-ui.js files
// doesn't matter):  <script src="employee-ui.js"></script>
//
// Overrides app.saveEmployee to actually persist to the employee tab, and injects
// an "Edit existing employee" search into the Add Employee modal so you
// can load a person, change fields, and save an update. New employee
// (no edit selected) appends a new row with the next employee ID and a PIN.
// Backend: saveEmployee, getRoster, getEmployeeById (EmployeeAdmin.gs).
// ============================================================

(function () {
  const EXEC_URL = CONFIG.API_URL;
  let ROSTER = [];
  let editingId = ''; // '' = adding new; an id = editing

  const $ = (id) => document.getElementById(id);
  function val(id) { const el = $(id); return el ? el.value : ''; }
  function setVal(id, v) { const el = $(id); if (el) el.value = (v == null ? '' : v); }

  async function callApi(qs) {
    const res = await fetch(EXEC_URL + '?' + qs);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json(); if (!d.success) throw new Error(d.error || 'Unknown error'); return d;
  }
  async function callPost(method, body) {
    const res = await fetch(EXEC_URL + '?method=' + method, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json(); if (!d.success) throw new Error(d.error || 'Unknown error'); return d;
  }

  async function loadRoster() {
    try { const d = await callApi('method=getRoster'); ROSTER = d.data || []; } catch (e) { ROSTER = []; }
  }

  // Inject the edit-search bar + status banner into the employee modal.
  document.addEventListener('DOMContentLoaded', function () {
    loadRoster();
    const modalBody = document.querySelector('#employeeModal .modal-body');
    if (modalBody && !$('empEditBar')) {
      const bar = document.createElement('div');
      bar.id = 'empEditBar';
      bar.className = 'mb-3 p-2 rounded';
      bar.style.background = '#eef4ff';
      bar.innerHTML =
        '<div class="d-flex align-items-center gap-2 flex-wrap">' +
          '<span id="empModeBadge" class="badge bg-success">New Employee</span>' +
          '<input type="text" id="empEditSearch" class="form-control form-control-sm" style="max-width:280px" ' +
            'placeholder="Edit existing: search name / ID / Civil ID" autocomplete="off">' +
          '<button type="button" class="btn btn-outline-secondary btn-sm" onclick="app.newEmployeeReset()">＋ New (clear)</button>' +
          '<span id="empPinNote" class="small text-muted"></span>' +
        '</div>' +
        '<select id="empEditResults" class="form-select form-select-sm mt-2" size="4" style="display:none" ' +
          'onchange="app.loadEmployeeForEdit(this.value)"></select>' +
        '<input type="hidden" id="editEmployeeId" value="">';
      modalBody.insertBefore(bar, modalBody.firstChild);

      $('empEditSearch').addEventListener('input', function () {
        const q = this.value.trim().toLowerCase();
        const sel = $('empEditResults');
        if (!q) { sel.style.display = 'none'; return; }
        const hits = ROSTER.filter(r =>
          r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || (r.civilId && r.civilId.includes(q))
        ).slice(0, 12);
        sel.innerHTML = hits.map(r => '<option value="' + r.id + '">' + r.id + ' — ' + r.name + (r.civilId ? ' — ' + r.civilId : '') + '</option>').join('');
        sel.style.display = hits.length ? 'block' : 'none';
      });
    }

    // Reset to "new" every time the modal opens (so a prior edit doesn't linger).
    const modalEl = $('employeeModal');
    if (modalEl) modalEl.addEventListener('show.bs.modal', function () { if (typeof app !== 'undefined' && app.newEmployeeReset) app.newEmployeeReset(); });
  });

  (function attach() {
    if (typeof app === 'undefined') return setTimeout(attach, 50);

    app.newEmployeeReset = function () {
      editingId = '';
      setVal('editEmployeeId', '');
      const b = $('empModeBadge'); if (b) { b.className = 'badge bg-success'; b.innerText = 'New Employee'; }
      const s = $('empEditSearch'); if (s) s.value = '';
      const r = $('empEditResults'); if (r) { r.style.display = 'none'; r.innerHTML = ''; }
      const p = $('empPinNote'); if (p) p.innerText = '';
    };

    app.loadEmployeeForEdit = async function (empId) {
      if (!empId) return;
      try {
        const d = await callApi('method=getEmployeeById&employeeId=' + encodeURIComponent(empId));
        const r = d.data || {};
        const g = (k) => r[k] != null ? r[k] : '';
        setVal('empNameEnglish', g('Name (English)'));
        setVal('empNameArabic', g('Name (Arabic)'));
        setVal('empCivilId', g('Civil ID'));
        setVal('empSalary', g('Basic Salary'));
        setVal('empStatus', g('Status') || 'Active');
        editingId = empId;
        setVal('editEmployeeId', empId);
        const b = $('empModeBadge'); if (b) { b.className = 'badge bg-primary'; b.innerText = 'Editing ' + empId; }
        const p = $('empPinNote'); if (p) p.innerText = r['PIN'] ? ('PIN ' + r['PIN']) : '';
        const rr = $('empEditResults'); if (rr) rr.style.display = 'none';
      } catch (err) { alert('Could not load ' + empId + ': ' + err.message); }
    };

    app.saveEmployee = async function () {
      const nameEng = val('empNameEnglish').trim();
      const basic = val('empSalary');
      const eid = val('editEmployeeId').trim();
      if (!eid && !nameEng) { alert('Name (English) is required.'); return; }
      if (!eid && !basic) { if (!confirm('No Basic Salary entered — this employee cannot be run in payroll until it is set. Save anyway?')) return; }

      const payload = {
        nameEnglish: nameEng,
        nameArabic: val('empNameArabic').trim(),
        civilId: val('empCivilId').trim(),
        basic: basic,
        status: val('empStatus') || 'Active'
      };
      if (eid) payload.employeeId = eid;

      try {
        const d = await callPost('saveEmployee', payload);
        await loadRoster();
        if (d.edited) {
          alert(d.message);
        } else {
          alert('Employee added.\n\nID: ' + d.employeeId + '\nPIN: ' + d.pin + '\n\n(Note the PIN — it is auto-generated.)');
        }
        const modalEl = $('employeeModal');
        if (modalEl && window.bootstrap) { const m = bootstrap.Modal.getInstance(modalEl); if (m) m.hide(); }
        if (app.loadAllData) app.loadAllData();
      } catch (err) { alert('Save failed: ' + err.message); }
    };
  })();
})();
