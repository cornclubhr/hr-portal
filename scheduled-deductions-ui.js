// ============================================================
// scheduled-deductions-ui.js — log deductions in advance (drop-in page)
// ------------------------------------------------------------
// index.html (after payroll-review-ui.js):
//   <script src="scheduled-deductions-ui.js"></script>
// Backend: getScheduledDeductions, saveScheduledDeduction, cancelScheduledDeduction,
//          getScheduledExtras, saveScheduledExtra, cancelScheduledExtra,
//          getManualAttnEmployees (for the employee picker).
//
// Same page, two halves (22-09-2026):
//   Scheduled Deductions — taken off pay in the chosen month.
//   Scheduled Extras     — bonuses / extras ADDED to pay in the chosen month.
// Payroll Review applies both for the run's month, then locks them.
// ============================================================

(function () {
  const EXEC_URL = CONFIG.API_URL;
  let EMPS = [];
  const TYPES = ['Loan', 'Advance', 'Disciplinary', 'Fine', 'Other'];

  async function callApi(qs) { const r = await fetch(EXEC_URL + '?' + qs + '&_=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); const d = await r.json(); if (!d.success) throw new Error(d.error || 'err'); return d; }
  async function callPost(m, b) { const r = await fetch(EXEC_URL + '?method=' + m, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(b) }); if (!r.ok) throw new Error('HTTP ' + r.status); const d = await r.json(); if (!d.success) throw new Error(d.error || 'err'); return d; }
  const kd = (n) => (Math.round((Number(n) || 0) * 1000) / 1000).toFixed(3);

  // Build month options: current + next 11 months as "MMM-yyyy".
  function monthOptions() {
    const out = []; const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      out.push(d.toLocaleString('en-US', { month: 'short' }) + '-' + d.getFullYear());
    }
    return out;
  }

  // The extras half of the page. Injected into the page whether the page
  // was built here or pre-baked in index.html.
  function extrasHtml() {
    return (
        '<div class="table-container mb-3">' +
          '<h5 class="mb-3"><i class="bi bi-gift"></i> Schedule an Extra (bonus, incentive…)</h5>' +
          '<div class="row g-2 align-items-end">' +
            '<div class="col-md-3"><label class="form-label small mb-1">Employee</label><input id="seEmpSearch" class="form-control form-control-sm mb-1" placeholder="filter…" oninput="app.seFilterEmps()"><select id="seEmp" class="form-select form-select-sm"></select></div>' +
            '<div class="col-md-2"><label class="form-label small mb-1">Type</label><input id="seType" list="seTypeList" class="form-control form-control-sm" placeholder="e.g. Bonus"><datalist id="seTypeList"></datalist></div>' +
            '<div class="col-md-2"><label class="form-label small mb-1">Amount (KD)</label><input id="seAmount" type="number" step="0.001" min="0" class="form-control form-control-sm"></div>' +
            '<div class="col-md-2"><label class="form-label small mb-1">Month</label><select id="seMonth" class="form-select form-select-sm">' + monthOptions().map(m => '<option>' + m + '</option>').join('') + '</select></div>' +
            '<div class="col-md-2"><label class="form-label small mb-1">Remark</label><input id="seRemark" class="form-control form-control-sm"></div>' +
            '<div class="col-md-1"><button class="btn btn-success btn-sm w-100" onclick="app.addSchedExtra()">Add</button></div>' +
          '</div>' +
          '<div id="seStatus" class="mt-2"></div>' +
          '<div class="text-muted small mt-1">Added to pay in that month\'s payroll (Bonus/Additional), then locked as Applied. One row per person.</div>' +
        '</div>' +
        '<div class="table-container"><div class="d-flex justify-content-between mb-2"><h6 class="mb-0">Scheduled extras</h6>' +
          '<button class="btn btn-outline-secondary btn-sm" onclick="app.loadSchedExtras()"><i class="bi bi-arrow-repeat"></i></button></div>' +
          '<div id="seTableWrap" class="table-responsive"><div class="text-muted small">Loading…</div></div></div>'
    );
  }

  document.addEventListener('DOMContentLoaded', function () {
    const navList = document.querySelector('#sidebar ul.nav');
    if (navList && !document.querySelector('[data-page="scheddeduct"]')) {
      const li = document.createElement('li'); li.className = 'nav-item';
      li.innerHTML = '<a class="nav-link" data-page="scheddeduct"><i class="bi bi-cash-stack"></i> Scheduled Deductions</a>';
      const pr = document.querySelector('[data-page="payrollreview"]') || document.querySelector('[data-page="payroll"]');
      if (pr && pr.closest('li')) pr.closest('li').insertAdjacentElement('afterend', li);
      else navList.appendChild(li);
      li.querySelector('.nav-link').addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        const pg = document.getElementById('page-scheddeduct'); if (pg) pg.classList.add('active');
        document.getElementById('pageTitle').innerText = 'Scheduled Deductions & Extras';
        if (app.loadSchedDeduct) app.loadSchedDeduct();
      });
    }
    const anchor = document.getElementById('page-dashboard');
    if (anchor && anchor.parentElement && !document.getElementById('page-scheddeduct')) {
      const s = document.createElement('div'); s.className = 'page-section'; s.id = 'page-scheddeduct';
      s.innerHTML =
        '<div class="table-container mb-3">' +
          '<h5 class="mb-3"><i class="bi bi-cash-stack"></i> Schedule a Deduction</h5>' +
          '<div class="row g-2 align-items-end">' +
            '<div class="col-md-3"><label class="form-label small mb-1">Employee</label><input id="sdEmpSearch" class="form-control form-control-sm mb-1" placeholder="filter…" oninput="app.sdFilterEmps()"><select id="sdEmp" class="form-select form-select-sm"></select></div>' +
            '<div class="col-md-2"><label class="form-label small mb-1">Type</label><select id="sdType" class="form-select form-select-sm">' + TYPES.map(t => '<option>' + t + '</option>').join('') + '</select></div>' +
            '<div class="col-md-2"><label class="form-label small mb-1">Amount (KD)</label><input id="sdAmount" type="number" step="0.001" class="form-control form-control-sm"></div>' +
            '<div class="col-md-2"><label class="form-label small mb-1">Month</label><select id="sdMonth" class="form-select form-select-sm">' + monthOptions().map(m => '<option>' + m + '</option>').join('') + '</select></div>' +
            '<div class="col-md-2"><label class="form-label small mb-1">Remark</label><input id="sdRemark" class="form-control form-control-sm"></div>' +
            '<div class="col-md-1"><button class="btn btn-primary btn-sm w-100" onclick="app.addSchedDeduct()">Add</button></div>' +
          '</div>' +
          '<div id="sdStatus" class="mt-2"></div>' +
          '<div class="text-muted small mt-1">Split a fine across months by adding one row per month (e.g. 30 in Sep, 20 in Oct). Payroll auto-applies the month\'s pending rows, then locks them.</div>' +
        '</div>' +
        '<div class="table-container mb-4"><div class="d-flex justify-content-between mb-2"><h6 class="mb-0">Scheduled deductions</h6>' +
          '<button class="btn btn-outline-secondary btn-sm" onclick="app.loadSchedDeduct()"><i class="bi bi-arrow-repeat"></i></button></div>' +
          '<div id="sdTableWrap" class="table-responsive"><div class="text-muted small">Loading…</div></div></div>' +
        extrasHtml();
      anchor.parentElement.appendChild(s);
    }
    // index.html pre-bakes the deductions page — add the extras half to it.
    const page = document.getElementById('page-scheddeduct');
    if (page && !document.getElementById('seTableWrap')) {
      const div = document.createElement('div');
      div.className = 'mt-4';
      div.innerHTML = extrasHtml();
      page.appendChild(div);
    }
  });

  (function attach() {
    if (typeof app === 'undefined') return setTimeout(attach, 50);

    app.loadSchedDeduct = async function () {
      if (!EMPS.length) { try { const e = await callApi('method=getManualAttnEmployees'); EMPS = e.employees || []; app.sdRenderEmps(EMPS); app.seRenderEmps(EMPS); } catch (e) {} }
      app.loadSchedExtras();
      const wrap = document.getElementById('sdTableWrap');
      try {
        const d = await callApi('method=getScheduledDeductions');
        const rows = (d.data || []).filter(r => String(r.status).toLowerCase() !== 'cancelled');
        if (!rows.length) { wrap.innerHTML = '<div class="text-muted small">No scheduled deductions.</div>'; return; }
        const body = rows.map(r => {
          const badge = r.status === 'Applied' ? '<span class="badge bg-secondary">Applied</span>' : r.status === 'Cancelled' ? '<span class="badge bg-danger">Cancelled</span>' : '<span class="badge bg-warning text-dark">Pending</span>';
          const cancel = String(r.status).toLowerCase() === 'pending' ? '<button class="btn btn-outline-danger btn-sm" onclick="app.cancelSched(\'' + r.id + '\')"><i class="bi bi-x"></i></button>' : '';
          return '<tr><td>' + r.empId + '</td><td>' + r.name + '</td><td>' + r.type + '</td><td class="text-end">' + kd(r.amount) + '</td><td>' + r.month + '</td><td>' + (r.remark || '') + '</td><td>' + badge + (r.appliedIn ? ' <span class="small text-muted">' + r.appliedIn + '</span>' : '') + '</td><td class="text-end">' + cancel + '</td></tr>';
        }).join('');
        wrap.innerHTML = '<table class="table table-sm table-striped align-middle"><thead><tr><th>ID</th><th>Name</th><th>Type</th><th class="text-end">Amount</th><th>Month</th><th>Remark</th><th>Status</th><th></th></tr></thead><tbody>' + body + '</tbody></table>';
      } catch (err) { wrap.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>'; }
    };

    app.sdRenderEmps = function (list) { document.getElementById('sdEmp').innerHTML = list.map(e => '<option value="' + e.id + '">' + e.name + ' (' + e.id + ')</option>').join(''); };
    app.sdFilterEmps = function () { const q = document.getElementById('sdEmpSearch').value.toLowerCase(); app.sdRenderEmps(EMPS.filter(e => (e.name + ' ' + e.id).toLowerCase().includes(q))); };

    app.addSchedDeduct = async function () {
      const status = document.getElementById('sdStatus');
      const payload = {
        empId: document.getElementById('sdEmp').value,
        type: document.getElementById('sdType').value,
        amount: document.getElementById('sdAmount').value,
        month: document.getElementById('sdMonth').value,
        remark: document.getElementById('sdRemark').value
      };
      if (!payload.empId || !payload.amount) { status.innerHTML = '<div class="alert alert-warning mb-0 py-1">Employee and amount required.</div>'; return; }
      try { const d = await callPost('saveScheduledDeduction', payload); status.innerHTML = '<div class="alert alert-success mb-0 py-1">' + d.message + '</div>'; document.getElementById('sdAmount').value = ''; document.getElementById('sdRemark').value = ''; app.loadSchedDeduct(); }
      catch (err) { status.innerHTML = '<div class="alert alert-danger mb-0 py-1">' + err.message + '</div>'; }
    };

    // ── Scheduled extras ─────────────────────────────────────────
    app.loadSchedExtras = async function () {
      const wrap = document.getElementById('seTableWrap');
      if (!wrap) return;
      try {
        const d = await callApi('method=getScheduledExtras');
        document.getElementById('seTypeList').innerHTML = (d.types || []).map(t => '<option value="' + t + '">').join('');
        const rows = (d.data || []).filter(r => String(r.status).toLowerCase() !== 'cancelled');
        if (!rows.length) { wrap.innerHTML = '<div class="text-muted small">No scheduled extras.</div>'; return; }
        let pending = 0;
        const body = rows.map(r => {
          const p = String(r.status).toLowerCase() === 'pending';
          if (p) pending += Number(r.amount) || 0;
          const badge = r.status === 'Applied' ? '<span class="badge bg-secondary">Applied</span>' : '<span class="badge bg-warning text-dark">Pending</span>';
          const cancel = p ? '<button class="btn btn-outline-danger btn-sm" onclick="app.cancelExtra(\'' + r.id + '\')"><i class="bi bi-x"></i></button>' : '';
          return '<tr><td>' + r.empId + '</td><td>' + r.name + '</td><td>' + r.type + '</td><td class="text-end">' + kd(r.amount) + '</td><td>' + r.month + '</td><td>' + (r.remark || '') + '</td><td>' + badge + (r.appliedIn ? ' <span class="small text-muted">' + r.appliedIn + '</span>' : '') + '</td><td class="text-end">' + cancel + '</td></tr>';
        }).join('');
        wrap.innerHTML = '<table class="table table-sm table-striped align-middle"><thead><tr><th>ID</th><th>Name</th><th>Type</th><th class="text-end">Amount</th><th>Month</th><th>Remark</th><th>Status</th><th></th></tr></thead><tbody>' + body +
          '</tbody><tfoot><tr><th colspan="3">Pending total</th><th class="text-end">' + kd(pending) + '</th><th colspan="4"></th></tr></tfoot></table>';
      } catch (err) { wrap.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>'; }
    };
    app.seRenderEmps = function (list) { const el = document.getElementById('seEmp'); if (el) el.innerHTML = list.map(e => '<option value="' + e.id + '">' + e.name + ' (' + e.id + ')</option>').join(''); };
    app.seFilterEmps = function () { const q = document.getElementById('seEmpSearch').value.toLowerCase(); app.seRenderEmps(EMPS.filter(e => (e.name + ' ' + e.id).toLowerCase().includes(q))); };
    app.addSchedExtra = async function () {
      const status = document.getElementById('seStatus');
      const payload = {
        empId: document.getElementById('seEmp').value,
        type: document.getElementById('seType').value.trim(),
        amount: document.getElementById('seAmount').value,
        month: document.getElementById('seMonth').value,
        remark: document.getElementById('seRemark').value
      };
      if (!payload.empId || !payload.type || !(Number(payload.amount) > 0)) { status.innerHTML = '<div class="alert alert-warning mb-0 py-1">Employee, type and amount required.</div>'; return; }
      try { const d = await callPost('saveScheduledExtra', payload); status.innerHTML = '<div class="alert alert-success mb-0 py-1">' + d.message + '</div>'; document.getElementById('seAmount').value = ''; document.getElementById('seRemark').value = ''; app.loadSchedExtras(); }
      catch (err) { status.innerHTML = '<div class="alert alert-danger mb-0 py-1">' + err.message + '</div>'; }
    };
    app.cancelExtra = async function (id) {
      if (!confirm('Cancel this scheduled extra?')) return;
      try { await callApi('method=cancelScheduledExtra&id=' + encodeURIComponent(id)); app.loadSchedExtras(); }
      catch (err) { alert(err.message); }
    };

    app.cancelSched = async function (id) {
      if (!confirm('Cancel this scheduled deduction?')) return;
      try { await callApi('method=cancelScheduledDeduction&id=' + encodeURIComponent(id)); app.loadSchedDeduct(); }
      catch (err) { alert(err.message); }
    };
  })();
})();
