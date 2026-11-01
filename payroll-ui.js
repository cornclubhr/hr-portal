// ============================================================
// payroll-ui.js — Payroll page (drop-in) : rolling period,
//   attendance/manual modes, seeded inputs, exclude list,
//   A5 payslip+report generation, and admin attendance amendment.
// ------------------------------------------------------------
// One line in index.html, right AFTER app.js:
//   <script src="payroll-ui.js"></script>
// Injects its own sidebar link + page — no other index.html edits.
// Backend: computeMonthlyPayroll, preparePayrollInputs,
//   generatePayrollDocs, amendAttendance (Payroll.gs / PayrollDocs.gs),
//   routed in Code.gs. Redeploy after backend changes.
// ============================================================

(function () {
  const EXEC_URL = CONFIG.API_URL;

  let lastTab = ''; // remember the most recent run's tab for doc generation

  function toDdMmYyyy(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return d + '-' + m + '-' + y; }
  function todayIso() { return new Date().toISOString().split('T')[0]; }
  function adminEmail() {
    const el = document.getElementById('userEmail');
    return el && el.innerText && el.innerText !== 'Loading...' ? el.innerText.trim() : 'Dashboard';
  }
  async function callApi(qs) {
    const res = await fetch(EXEC_URL + '?' + qs);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    return data;
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Sidebar link after Attendance
    const navList = document.querySelector('#sidebar ul.nav');
    if (navList && !document.querySelector('[data-page="payroll"]')) {
      const li = document.createElement('li');
      li.className = 'nav-item';
      li.innerHTML = '<a class="nav-link" data-page="payroll"><i class="bi bi-cash-stack"></i> Payroll</a>';
      const att = document.querySelector('[data-page="attendance"]');
      if (att && att.closest('li')) att.closest('li').insertAdjacentElement('afterend', li);
      else navList.appendChild(li);
      li.querySelector('.nav-link').addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        const pg = document.getElementById('page-payroll');
        if (pg) pg.classList.add('active');
        document.getElementById('pageTitle').innerText = 'Payroll';
      });
    }

    const anchor = document.getElementById('page-dashboard');
    if (anchor && anchor.parentElement && !document.getElementById('page-payroll')) {
      const section = document.createElement('div');
      section.className = 'page-section';
      section.id = 'page-payroll';
      section.innerHTML =
        // ---- Run Payroll ----
        '<div class="table-container mb-4">' +
          '<h5 class="mb-3"><i class="bi bi-cash-stack"></i> Run Payroll</h5>' +
          '<div class="row g-2 align-items-end mb-2">' +
            '<div class="col-auto"><label class="form-label small mb-1">Period End</label>' +
              '<input type="date" id="payrollPeriodEnd" class="form-control form-control-sm" value="' + todayIso() + '"></div>' +
            '<div class="col-auto"><label class="form-label small mb-1">Mode</label>' +
              '<select id="payrollMode" class="form-select form-select-sm">' +
                '<option value="attendance">With attendance (OT from log)</option>' +
                '<option value="manual">Without attendance (manual OT)</option>' +
              '</select></div>' +
          '</div>' +
          '<div class="row g-2 align-items-end mb-2">' +
            '<div class="col-md-8"><label class="form-label small mb-1">Exclude Employee IDs (optional, comma-separated)</label>' +
              '<input type="text" id="payrollExclude" class="form-control form-control-sm" ' +
                'placeholder="e.g. HR-EMP-00023 — staff already paid via advance/vacation"></div>' +
          '</div>' +
          '<div class="mb-2">' +
            '<a href="#" id="payrollFirstRunToggle" class="small text-muted">First payroll run ever? Click to set a start date</a>' +
            '<div id="payrollFirstRunRow" class="row g-2 align-items-end mt-1" style="display:none;">' +
              '<div class="col-auto"><label class="form-label small mb-1">Period Start (first run only)</label>' +
                '<input type="date" id="payrollPeriodStart" class="form-control form-control-sm"></div>' +
            '</div>' +
          '</div>' +
          '<div class="d-flex gap-2 mb-2">' +
            '<button id="payrollPrepBtn" class="btn btn-outline-secondary btn-sm" onclick="app.preparePayrollInputs()">' +
              '<i class="bi bi-table"></i> Prepare Inputs</button>' +
            '<button id="payrollRunBtn" class="btn btn-primary btn-sm" onclick="app.runPayroll()">' +
              '<i class="bi bi-calculator"></i> Run Payroll</button>' +
            '<button id="payrollCancelBtn" class="btn btn-outline-danger btn-sm" onclick="app.cancelPayroll()">' +
              '<i class="bi bi-arrow-counterclockwise"></i> Cancel Last Run</button>' +
          '</div>' +
          '<div id="payrollStatus" class="mb-2"></div>' +
          '<div id="payrollFlags"></div>' +
          '<div class="text-muted small">Manual mode uses <b>Manual OT Hours</b> from the Payroll_Inputs tab; both modes apply ' +
            '<b>Deductions</b> from that tab. "Prepare Inputs" seeds a row per employee for the chosen Period End. ' +
            'Runs auto-continue from the last period (Payroll_Control).</div>' +
        '</div>' +
        // ---- Generate documents ----
        '<div class="table-container mb-4">' +
          '<h5 class="mb-3"><i class="bi bi-file-earmark-pdf"></i> Payslips &amp; Report (A5 PDF)</h5>' +
          '<div class="row g-2 align-items-end mb-2">' +
            '<div class="col-md-6"><label class="form-label small mb-1">Period tab (blank = most recent run)</label>' +
              '<input type="text" id="docsTab" class="form-control form-control-sm" placeholder="e.g. Payroll 21Jul-20Aug"></div>' +
            '<div class="col-auto">' +
              '<button id="docsBtn" class="btn btn-primary btn-sm" onclick="app.generatePayrollDocs()">' +
                '<i class="bi bi-printer"></i> Generate</button></div>' +
          '</div>' +
          '<div id="docsStatus"></div>' +
          '<div class="text-muted small">One combined PDF: an A5 summary page plus one A5 payslip per employee on the tab. Saved to Drive.</div>' +
        '</div>' +
        // ---- Bank transfer ----
        '<div class="table-container mb-4">' +
          '<h5 class="mb-3"><i class="bi bi-bank"></i> Bank Transfer (Warba)</h5>' +
          '<div class="row g-2 align-items-end mb-2">' +
            '<div class="col-md-6"><label class="form-label small mb-1">Period tab to transfer from</label>' +
              '<input type="text" id="bankTab" class="form-control form-control-sm" placeholder="e.g. Payroll 01Aug-21Aug"></div>' +
            '<div class="col-md-4"><label class="form-label small mb-1">Paid in cash — exclude IDs (optional)</label>' +
              '<input type="text" id="bankExclude" class="form-control form-control-sm" placeholder="e.g. HR-EMP-00036"></div>' +
            '<div class="col-auto">' +
              '<button id="bankBtn" class="btn btn-primary btn-sm" onclick="app.populateBankTransfer()">' +
                '<i class="bi bi-bank"></i> Populate Bank Sheet</button></div>' +
          '</div>' +
          '<div id="bankStatus"></div>' +
          '<div class="text-muted small">Writes each employee\'s Total Payable into the <b>Bank Transfer Details</b> tab, matched by Civil ID. ' +
            'Flags anyone paid but missing a bank row or IBAN. Then copy that tab into the bank sheet.</div>' +
        '</div>' +
        // ---- Amend attendance ----
        '<div class="table-container">' +
          '<h5 class="mb-3"><i class="bi bi-pencil-square"></i> Amend Attendance (Admin)</h5>' +
          '<div class="row g-2 align-items-end mb-2">' +
            '<div class="col-auto"><label class="form-label small mb-1">Employee ID</label>' +
              '<input type="text" id="amendEmpId" class="form-control form-control-sm" placeholder="HR-EMP-00001"></div>' +
            '<div class="col-auto"><label class="form-label small mb-1">Date</label>' +
              '<input type="date" id="amendDate" class="form-control form-control-sm"></div>' +
            '<div class="col-auto"><label class="form-label small mb-1">Stage</label>' +
              '<select id="amendStage" class="form-select form-select-sm">' +
                '<option>Check In</option><option>Break Out</option><option>Break In</option><option>Check Out</option>' +
              '</select></div>' +
            '<div class="col-auto"><label class="form-label small mb-1">Time</label>' +
              '<input type="time" id="amendTime" class="form-control form-control-sm"></div>' +
            '<div class="col-auto"><label class="form-label small mb-1">Action</label>' +
              '<select id="amendAction" class="form-select form-select-sm">' +
                '<option value="set">Set / Add</option><option value="delete">Delete</option>' +
              '</select></div>' +
            '<div class="col-auto">' +
              '<button id="amendBtn" class="btn btn-primary btn-sm" onclick="app.amendAttendance()">' +
                '<i class="bi bi-check2"></i> Save</button></div>' +
          '</div>' +
          '<div id="amendStatus"></div>' +
          '<div class="text-muted small">Every change is logged to Attendance_Amendments. If the date falls in a period already run, ' +
            'that run is flagged NEEDS RE-RUN in Payroll_Control — re-run it to apply the correction.</div>' +
        '</div>';
      anchor.parentElement.appendChild(section);

      document.getElementById('payrollFirstRunToggle').addEventListener('click', function (e) {
        e.preventDefault();
        const row = document.getElementById('payrollFirstRunRow');
        row.style.display = row.style.display === 'none' ? 'flex' : 'none';
      });
    }
  });

  (function attach() {
    if (typeof app === 'undefined') return setTimeout(attach, 50);

    // ---- Populate bank transfer sheet ----
    app.populateBankTransfer = async function () {
      const tab = document.getElementById('bankTab').value.trim() || lastTab;
      const exclude = document.getElementById('bankExclude').value.trim();
      const status = document.getElementById('bankStatus');
      const btn = document.getElementById('bankBtn');
      if (!tab) { status.innerHTML = '<div class="alert alert-warning mb-0">Enter the payroll period tab first.</div>'; return; }
      const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Populating…';
      try {
        let qs = 'method=populateBankTransfer&tab=' + encodeURIComponent(tab);
        if (exclude) qs += '&excludeIds=' + encodeURIComponent(exclude);
        const data = await callApi(qs);
        const cls = data.reconciled ? 'alert-success' : 'alert-warning';
        status.innerHTML = '<div class="alert ' + cls + ' mb-0"><i class="bi bi-' + (data.reconciled ? 'check-circle' : 'exclamation-triangle') + '"></i> ' + data.message + '</div>';
      } catch (err) {
        status.innerHTML = '<div class="alert alert-danger mb-0"><i class="bi bi-x-circle"></i> ' + err.message + '</div>';
      } finally { btn.disabled = false; btn.innerHTML = orig; }
    };

    // ---- Cancel / Amend the most recent run ----
    app.cancelPayroll = async function () {
      const status = document.getElementById('payrollStatus');
      const flags = document.getElementById('payrollFlags');
      if (!confirm('Cancel the most recent payroll run?\n\nThis deletes its Payroll_Control entry and its period tab, and rewinds the cursor so you can re-run that period (e.g. after adding staff or fixing OT). Encashments and leave balances are not affected.')) return;
      const btn = document.getElementById('payrollCancelBtn');
      const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Cancelling…';
      flags.innerHTML = '';
      try {
        const data = await callApi('method=cancelPayrollRun');
        status.innerHTML = '<div class="alert alert-warning mb-0"><i class="bi bi-arrow-counterclockwise"></i> ' + data.message + '</div>';
      } catch (err) {
        status.innerHTML = '<div class="alert alert-danger mb-0"><i class="bi bi-x-circle"></i> ' + err.message + '</div>';
      } finally { btn.disabled = false; btn.innerHTML = orig; }
    };

    // ---- Prepare Inputs ----
    app.preparePayrollInputs = async function () {
      const periodEnd = document.getElementById('payrollPeriodEnd').value;
      const exclude = document.getElementById('payrollExclude').value.trim();
      const status = document.getElementById('payrollStatus');
      const btn = document.getElementById('payrollPrepBtn');
      if (!periodEnd) { status.innerHTML = '<div class="alert alert-warning mb-0">Pick a Period End first.</div>'; return; }
      const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Seeding…';
      try {
        let qs = 'method=preparePayrollInputs&periodEnd=' + encodeURIComponent(toDdMmYyyy(periodEnd));
        if (exclude) qs += '&excludeIds=' + encodeURIComponent(exclude);
        const data = await callApi(qs);
        status.innerHTML = '<div class="alert alert-success mb-0"><i class="bi bi-check-circle"></i> ' + data.message +
          ' Open the <strong>Payroll_Inputs</strong> tab to fill values.</div>';
      } catch (err) {
        status.innerHTML = '<div class="alert alert-danger mb-0"><i class="bi bi-x-circle"></i> ' + err.message + '</div>';
      } finally { btn.disabled = false; btn.innerHTML = orig; }
    };

    // ---- Run Payroll ----
    app.runPayroll = async function () {
      const periodEndIso = document.getElementById('payrollPeriodEnd').value;
      const periodStartIso = document.getElementById('payrollPeriodStart').value;
      const mode = document.getElementById('payrollMode').value;
      const exclude = document.getElementById('payrollExclude').value.trim();
      const btn = document.getElementById('payrollRunBtn');
      const status = document.getElementById('payrollStatus');
      const flags = document.getElementById('payrollFlags');
      if (!periodEndIso) { status.innerHTML = '<div class="alert alert-warning mb-0">Please pick a Period End date.</div>'; return; }

      const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Computing…';
      status.innerHTML = '<div class="text-muted small">' + (mode === 'manual' ? 'Computing salaries (manual OT)…' : 'Reading attendance and computing salaries…') + '</div>';
      flags.innerHTML = '';
      try {
        let qs = 'method=computeMonthlyPayroll&periodEnd=' + encodeURIComponent(toDdMmYyyy(periodEndIso)) + '&mode=' + encodeURIComponent(mode);
        if (periodStartIso) qs += '&periodStart=' + encodeURIComponent(toDdMmYyyy(periodStartIso));
        if (exclude) qs += '&excludeIds=' + encodeURIComponent(exclude);
        const data = await callApi(qs);
        lastTab = data.tab || '';
        if (document.getElementById('docsTab')) document.getElementById('docsTab').value = lastTab;
        status.innerHTML =
          '<div class="alert alert-success mb-0"><i class="bi bi-check-circle"></i> ' +
          'Wrote <strong>' + data.tab + '</strong> (' + data.periodStart + ' to ' + data.periodEnd + ', ' + data.mode + ' mode) — ' +
          data.employees + ' employees. Net total <strong>' + Number(data.totalPayable).toLocaleString('en-US',{minimumFractionDigits:3,maximumFractionDigits:3}) + ' KD</strong>.' +
          (data.flaggedEmployees ? ' <strong>' + data.flaggedEmployees + '</strong> with attendance flags.' : '') +
          '</div>';
        if (data.flags && data.flags.length) {
          const body = data.flags.map(f => '<tr><td>' + f.id + '</td><td>' + f.name + '</td><td class="text-danger small">' + f.detail + '</td></tr>').join('');
          flags.innerHTML = '<div class="mt-3"><h6 class="text-danger"><i class="bi bi-exclamation-triangle"></i> Attendance flags</h6>' +
            '<table class="table table-sm table-bordered"><thead><tr><th>ID</th><th>Name</th><th>Detail</th></tr></thead><tbody>' + body + '</tbody></table>' +
            '<div class="text-muted small">Amend the punches below, then re-run this period.</div></div>';
        }
      } catch (err) {
        if (err.message && err.message.toLowerCase().includes('periodstart')) {
          status.innerHTML = '<div class="alert alert-danger mb-0"><i class="bi bi-x-circle"></i> ' + err.message + ' Use "First payroll run ever?" above.</div>';
          document.getElementById('payrollFirstRunRow').style.display = 'flex';
        } else {
          status.innerHTML = '<div class="alert alert-danger mb-0"><i class="bi bi-x-circle"></i> ' + err.message + '</div>';
        }
      } finally { btn.disabled = false; btn.innerHTML = orig; }
    };

    // ---- Generate payslips + report ----
    app.generatePayrollDocs = async function () {
      const tab = document.getElementById('docsTab').value.trim() || lastTab;
      const status = document.getElementById('docsStatus');
      const btn = document.getElementById('docsBtn');
      const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generating…';
      status.innerHTML = '<div class="text-muted small">Building A5 payslips…</div>';
      try {
        let qs = 'method=generatePayrollDocs';
        if (tab) qs += '&tab=' + encodeURIComponent(tab);
        const data = await callApi(qs);
        status.innerHTML = '<div class="alert alert-success mb-0"><i class="bi bi-check-circle"></i> ' + data.message +
          ' <a href="' + data.pdfUrl + '" target="_blank" class="alert-link">Open PDF</a> · ' +
          '<a href="' + data.folderUrl + '" target="_blank" class="alert-link">Drive folder</a></div>';
      } catch (err) {
        status.innerHTML = '<div class="alert alert-danger mb-0"><i class="bi bi-x-circle"></i> ' + err.message + '</div>';
      } finally { btn.disabled = false; btn.innerHTML = orig; }
    };

    // ---- Amend attendance ----
    app.amendAttendance = async function () {
      const empId = document.getElementById('amendEmpId').value.trim();
      const dateIso = document.getElementById('amendDate').value;
      const stage = document.getElementById('amendStage').value;
      const time = document.getElementById('amendTime').value;
      const action = document.getElementById('amendAction').value;
      const status = document.getElementById('amendStatus');
      const btn = document.getElementById('amendBtn');
      if (!empId || !dateIso) { status.innerHTML = '<div class="alert alert-warning mb-0">Employee ID and Date are required.</div>'; return; }
      const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving…';
      try {
        let qs = 'method=amendAttendance&empId=' + encodeURIComponent(empId) +
          '&date=' + encodeURIComponent(toDdMmYyyy(dateIso)) +
          '&stage=' + encodeURIComponent(stage) +
          '&action=' + encodeURIComponent(action) +
          '&admin=' + encodeURIComponent(adminEmail());
        if (action === 'set' && time) qs += '&time=' + encodeURIComponent(time);
        const data = await callApi(qs);
        const cls = data.reRunNeeded ? 'alert-warning' : 'alert-success';
        status.innerHTML = '<div class="alert ' + cls + ' mb-0"><i class="bi bi-check-circle"></i> ' + data.message + '</div>';
      } catch (err) {
        status.innerHTML = '<div class="alert alert-danger mb-0"><i class="bi bi-x-circle"></i> ' + err.message + '</div>';
      } finally { btn.disabled = false; btn.innerHTML = orig; }
    };
  })();
})();
