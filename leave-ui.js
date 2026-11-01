// ============================================================
// leave-ui.js — Leave Balances page (drop-in)
// ------------------------------------------------------------
// One line in index.html, AFTER payroll-ui.js:
//   <script src="leave-ui.js"></script>
// Injects its own sidebar link + page. Backend: ensureLeaveTabs,
// getLeaveTypes, getLeaveBalances, upsertLeaveBalance,
// bulkUploadLeaveBalances, encashLeave, migrateLeaveBalances
// (LeaveEncashment.gs, routed in Code.gs). Redeploy after backend changes.
// ============================================================

(function () {
  const EXEC_URL = CONFIG.API_URL;

  let TYPES = [];      // [{type, canEncash, canCarry, entitlement}]
  function todayIso() { return new Date().toISOString().split('T')[0]; }
  function toDdMmYyyy(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return d + '-' + m + '-' + y; }
  function adminEmail() { const el = document.getElementById('userEmail'); return el && el.innerText && el.innerText !== 'Loading...' ? el.innerText.trim() : 'Dashboard'; }

  async function callApi(qs) {
    const res = await fetch(EXEC_URL + '?' + qs);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    return data;
  }
  async function callPost(method, bodyObj) {
    const res = await fetch(EXEC_URL + '?method=' + method, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(bodyObj)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    return data;
  }

  document.addEventListener('DOMContentLoaded', function () {
    const navList = document.querySelector('#sidebar ul.nav');
    if (navList && !document.querySelector('[data-page="leavebal"]')) {
      const li = document.createElement('li');
      li.className = 'nav-item';
      li.innerHTML = '<a class="nav-link" data-page="leavebal"><i class="bi bi-calendar2-week"></i> Leave Balances</a>';
      const payroll = document.querySelector('[data-page="payroll"]');
      if (payroll && payroll.closest('li')) payroll.closest('li').insertAdjacentElement('afterend', li);
      else navList.appendChild(li);
      li.querySelector('.nav-link').addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        const pg = document.getElementById('page-leavebal');
        if (pg) pg.classList.add('active');
        document.getElementById('pageTitle').innerText = 'Leave Balances';
        if (typeof app !== 'undefined' && app.loadLeaveTypes) app.loadLeaveTypes();
      });
    }

    const anchor = document.getElementById('page-dashboard');
    if (anchor && anchor.parentElement && !document.getElementById('page-leavebal')) {
      const s = document.createElement('div');
      s.className = 'page-section';
      s.id = 'page-leavebal';
      s.innerHTML =
        // View balances
        '<div class="table-container mb-4">' +
          '<div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">' +
            '<h5><i class="bi bi-calendar2-week"></i> Leave Balances</h5>' +
            '<div class="d-flex gap-2">' +
              '<input type="text" id="balSearch" class="form-control form-control-sm" style="width:170px" placeholder="Filter by Employee ID">' +
              '<button class="btn btn-outline-secondary btn-sm" onclick="app.loadLeaveBalances()"><i class="bi bi-arrow-repeat"></i> Load</button>' +
            '</div>' +
          '</div>' +
          '<div id="balTableWrap" class="table-responsive"><div class="text-muted small">Click Load to view balances.</div></div>' +
        '</div>' +
        // Add / edit + Encash
        '<div class="row g-4 mb-4">' +
          '<div class="col-lg-6"><div class="table-container h-100">' +
            '<h6 class="mb-3"><i class="bi bi-pencil-square"></i> Add / Edit Balance</h6>' +
            '<div class="row g-2">' +
              '<div class="col-6"><label class="form-label small mb-1">Employee ID</label><input id="ubEmp" class="form-control form-control-sm" placeholder="HR-EMP-00001"></div>' +
              '<div class="col-6"><label class="form-label small mb-1">Type</label><select id="ubType" class="form-select form-select-sm"></select></div>' +
              '<div class="col-4"><label class="form-label small mb-1">Entitled</label><input id="ubEnt" type="number" class="form-control form-control-sm"></div>' +
              '<div class="col-4"><label class="form-label small mb-1">Taken</label><input id="ubTaken" type="number" class="form-control form-control-sm" value="0"></div>' +
              '<div class="col-4"><label class="form-label small mb-1">Encashed</label><input id="ubEnc" type="number" class="form-control form-control-sm" value="0"></div>' +
            '</div>' +
            '<button class="btn btn-primary btn-sm mt-3" onclick="app.saveLeaveBalance()"><i class="bi bi-check2"></i> Save Balance</button>' +
            '<div id="ubStatus" class="mt-2"></div>' +
            '<div class="text-muted small mt-1">Remaining is computed as Entitled − Taken − Encashed.</div>' +
          '</div></div>' +
          '<div class="col-lg-6"><div class="table-container h-100">' +
            '<h6 class="mb-3"><i class="bi bi-cash-coin"></i> Encash Leave</h6>' +
            '<div class="row g-2">' +
              '<div class="col-6"><label class="form-label small mb-1">Employee ID</label><input id="enEmp" class="form-control form-control-sm" placeholder="HR-EMP-00001"></div>' +
              '<div class="col-6"><label class="form-label small mb-1">Type (encashable only)</label><select id="enType" class="form-select form-select-sm"></select></div>' +
              '<div class="col-6"><label class="form-label small mb-1">Days</label><input id="enDays" type="number" class="form-control form-control-sm" min="1"></div>' +
              '<div class="col-6"><label class="form-label small mb-1">Encash Date</label><input id="enDate" type="date" class="form-control form-control-sm" value="' + todayIso() + '"></div>' +
            '</div>' +
            '<button class="btn btn-success btn-sm mt-3" onclick="app.encashLeave()"><i class="bi bi-cash-coin"></i> Encash</button>' +
            '<div id="enStatus" class="mt-2"></div>' +
            '<div class="text-muted small mt-1">Amount = Basic ÷ 30 × days (a month = 30 days; 60 days = 2 basic salaries). Excludes OT. Reduces Remaining and is paid in the run ending on/after the encash date.</div>' +
          '</div></div>' +
        '</div>' +
        // Bulk upload + migration
        '<div class="row g-4">' +
          '<div class="col-lg-7"><div class="table-container h-100">' +
            '<h6 class="mb-3"><i class="bi bi-upload"></i> Bulk Upload Balances</h6>' +
            '<div class="text-muted small mb-1">Paste rows: <code>EmployeeID, Type, Entitled, Taken, Encashed</code> (one per line; Taken/Encashed optional).</div>' +
            '<textarea id="bulkText" class="form-control form-control-sm" rows="6" placeholder="HR-EMP-00001, Annual, 30, 4, 0&#10;HR-EMP-00002, Sick, 15, 0, 0"></textarea>' +
            '<button class="btn btn-primary btn-sm mt-2" onclick="app.bulkUploadLeave()"><i class="bi bi-upload"></i> Upload</button>' +
            '<div id="bulkStatus" class="mt-2"></div>' +
          '</div></div>' +
          '<div class="col-lg-5"><div class="table-container h-100">' +
            '<h6 class="mb-3"><i class="bi bi-arrow-left-right"></i> Migrate Old Balances</h6>' +
            '<div class="text-muted small mb-2">Pulls the old Vacation / Sick Leave tabs and matches names to Employee IDs. Preview first, then commit.</div>' +
            '<div class="d-flex gap-2">' +
              '<button class="btn btn-outline-secondary btn-sm" onclick="app.migrateLeave(false)"><i class="bi bi-search"></i> Preview</button>' +
              '<button class="btn btn-warning btn-sm" onclick="app.migrateLeave(true)"><i class="bi bi-check2-all"></i> Commit</button>' +
            '</div>' +
            '<div id="migStatus" class="mt-2"></div>' +
          '</div></div>' +
        '</div>' +
        // Encashment history + reprint voucher
        '<div class="table-container mt-4">' +
          '<div class="d-flex justify-content-between align-items-center mb-2"><h6 class="mb-0"><i class="bi bi-receipt"></i> Encashment History</h6>' +
            '<button class="btn btn-outline-secondary btn-sm" onclick="app.loadEncashHistory()"><i class="bi bi-arrow-repeat"></i> Load</button></div>' +
          '<div id="encHistWrap" class="table-responsive"><div class="text-muted small">Click Load to view past encashments and reprint vouchers.</div></div>' +
        '</div>';
      anchor.parentElement.appendChild(s);
    }
  });

  (function attach() {
    if (typeof app === 'undefined') return setTimeout(attach, 50);

    app.loadEncashHistory = async function () {
      const wrap = document.getElementById('encHistWrap');
      wrap.innerHTML = '<div class="text-muted small">Loading…</div>';
      try {
        const d = await callApi('method=getEncashmentHistory');
        if (!d.rows || !d.rows.length) { wrap.innerHTML = '<div class="text-muted small">No encashments recorded.</div>'; return; }
        const money = (n) => (Math.round((Number(n)||0)*1000)/1000).toFixed(3);
        const body = d.rows.map(r =>
          '<tr><td>' + r.empId + '</td><td>' + r.name + '</td><td>' + r.type + '</td>' +
          '<td class="text-end">' + r.days + '</td><td class="text-end">' + money(r.amount) + '</td>' +
          '<td>' + (r.encashDate || '') + '</td><td class="small text-muted">' + (r.voucherNo || '—') + '</td>' +
          '<td class="text-end"><button class="btn btn-outline-primary btn-sm" onclick="app.reprintVoucher(' + r.row + ', this)"><i class="bi bi-printer"></i> Print</button></td></tr>').join('');
        wrap.innerHTML = '<table class="table table-sm table-striped align-middle"><thead><tr>' +
          '<th>ID</th><th>Name</th><th>Type</th><th class="text-end">Days</th><th class="text-end">Amount</th><th>Date</th><th>Voucher No</th><th></th>' +
          '</tr></thead><tbody>' + body + '</tbody></table>';
      } catch (err) { wrap.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>'; }
    };

    app.reprintVoucher = async function (row, btn) {
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>'; }
      try {
        const d = await callApi('method=reprintEncashmentVoucher&row=' + row);
        if (btn) { btn.outerHTML = '<a class="btn btn-primary btn-sm" href="' + d.url + '" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right"></i> Open</a>'; }
      } catch (err) { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-printer"></i> Print'; } alert(err.message); }
    };

    app.loadLeaveTypes = async function () {
      try {
        const data = await callApi('method=getLeaveTypes');
        TYPES = data.data || [];
        const ub = document.getElementById('ubType');
        const en = document.getElementById('enType');
        if (ub) ub.innerHTML = TYPES.map(t => '<option>' + t.type + '</option>').join('');
        if (en) {
          const enc = TYPES.filter(t => t.canEncash);
          en.innerHTML = enc.length ? enc.map(t => '<option>' + t.type + '</option>').join('') : '<option value="">(none encashable)</option>';
        }
      } catch (err) { /* types load silently; forms still usable */ }
    };

    app.loadLeaveBalances = async function () {
      const wrap = document.getElementById('balTableWrap');
      const filter = document.getElementById('balSearch').value.trim();
      wrap.innerHTML = '<div class="text-muted small">Loading…</div>';
      try {
        let qs = 'method=getLeaveBalances';
        if (filter) qs += '&empId=' + encodeURIComponent(filter);
        const data = await callApi(qs);
        if (!data.data || !data.data.length) { wrap.innerHTML = '<div class="text-muted small">No balances found.</div>'; return; }
        const body = data.data.map(b =>
          '<tr><td>' + b.empId + '</td><td>' + b.name + '</td><td>' + b.type + '</td>' +
          '<td class="text-end">' + b.entitled + '</td><td class="text-end">' + b.taken + '</td>' +
          '<td class="text-end">' + b.encashed + '</td><td class="text-end fw-bold">' + b.remaining + '</td></tr>').join('');
        wrap.innerHTML = '<table class="table table-sm table-striped"><thead><tr>' +
          '<th>ID</th><th>Name</th><th>Type</th><th class="text-end">Entitled</th><th class="text-end">Taken</th>' +
          '<th class="text-end">Encashed</th><th class="text-end">Remaining</th></tr></thead><tbody>' + body + '</tbody></table>';
      } catch (err) { wrap.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>'; }
    };

    app.saveLeaveBalance = async function () {
      const status = document.getElementById('ubStatus');
      const empId = document.getElementById('ubEmp').value.trim();
      const type = document.getElementById('ubType').value;
      if (!empId || !type) { status.innerHTML = '<div class="alert alert-warning mb-0">Employee ID and Type required.</div>'; return; }
      try {
        const qs = 'method=upsertLeaveBalance&empId=' + encodeURIComponent(empId) + '&type=' + encodeURIComponent(type) +
          '&entitled=' + encodeURIComponent(document.getElementById('ubEnt').value) +
          '&taken=' + encodeURIComponent(document.getElementById('ubTaken').value) +
          '&encashed=' + encodeURIComponent(document.getElementById('ubEnc').value);
        const data = await callApi(qs);
        status.innerHTML = '<div class="alert alert-success mb-0">' + data.message + '</div>';
        app.loadLeaveBalances();
      } catch (err) { status.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>'; }
    };

    app.encashLeave = async function () {
      const status = document.getElementById('enStatus');
      const empId = document.getElementById('enEmp').value.trim();
      const type = document.getElementById('enType').value;
      const days = document.getElementById('enDays').value;
      const dateIso = document.getElementById('enDate').value;
      if (!empId || !type || !days) { status.innerHTML = '<div class="alert alert-warning mb-0">Employee, type and days required.</div>'; return; }
      try {
        const qs = 'method=encashLeave&empId=' + encodeURIComponent(empId) + '&type=' + encodeURIComponent(type) +
          '&days=' + encodeURIComponent(days) + '&encashDate=' + encodeURIComponent(toDdMmYyyy(dateIso)) +
          '&by=' + encodeURIComponent(adminEmail());
        const data = await callApi(qs);
        let okHtml = '<div class="alert alert-success mb-0"><i class="bi bi-check-circle"></i> ' + data.message + '</div>';
        if (data.voucherNo) {
          okHtml += '<button class="btn btn-outline-primary btn-sm mt-2" onclick="app.printVoucher(\'' + data.voucherNo + '\', this)"><i class="bi bi-printer"></i> Print Encashment Voucher</button>';
        }
        status.innerHTML = okHtml;
        app.loadLeaveBalances();
      } catch (err) { status.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>'; }
    };

    app.printVoucher = async function (voucherNo, btn) {
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generating…'; }
      try {
        const d = await callApi('method=generateEncashmentVoucher&voucherNo=' + encodeURIComponent(voucherNo));
        if (btn) { btn.outerHTML = '<a class="btn btn-primary btn-sm mt-2" href="' + d.url + '" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right"></i> Open Voucher PDF</a>'; }
      } catch (err) { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-printer"></i> Print Encashment Voucher'; } alert(err.message); }
    };

    app.bulkUploadLeave = async function () {
      const status = document.getElementById('bulkStatus');
      const text = document.getElementById('bulkText').value.trim();
      if (!text) { status.innerHTML = '<div class="alert alert-warning mb-0">Paste some rows first.</div>'; return; }
      const rows = [];
      text.split(/\r?\n/).forEach(line => {
        if (!line.trim()) return;
        const p = line.split(/[,\t]/).map(x => x.trim());
        if (p.length < 2) return;
        rows.push({ empId: p[0], type: p[1], entitled: p[2] || '', taken: p[3] || '', encashed: p[4] || '' });
      });
      if (!rows.length) { status.innerHTML = '<div class="alert alert-warning mb-0">No valid rows parsed.</div>'; return; }
      status.innerHTML = '<div class="text-muted small">Uploading ' + rows.length + ' rows…</div>';
      try {
        const data = await callPost('bulkUploadLeaveBalances', { rows: rows });
        let html = '<div class="alert alert-success mb-0">' + data.message + '</div>';
        if (data.errors && data.errors.length) html += '<div class="text-danger small mt-1">' + data.errors.map(e => '• ' + e).join('<br>') + '</div>';
        status.innerHTML = html;
        app.loadLeaveBalances();
      } catch (err) { status.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>'; }
    };

    app.migrateLeave = async function (commit) {
      const status = document.getElementById('migStatus');
      status.innerHTML = '<div class="text-muted small">' + (commit ? 'Committing…' : 'Building preview…') + '</div>';
      try {
        const data = await callApi('method=migrateLeaveBalances' + (commit ? '&commit=true' : ''));
        if (commit) {
          status.innerHTML = '<div class="alert alert-success mb-0">' + data.message + '</div>';
          app.loadLeaveBalances();
        } else {
          let html = '<div class="alert alert-info mb-0">' + data.message + '</div>';
          if (data.unmatched && data.unmatched.length) {
            html += '<div class="small mt-2"><b>Unmatched (won\'t migrate):</b><br>' +
              data.unmatched.map(u => '• ' + u.name + ' (' + u.type + ', ' + u.remaining + ')').join('<br>') + '</div>';
          }
          status.innerHTML = html;
        }
      } catch (err) { status.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>'; }
    };
  })();
})();
