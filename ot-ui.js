// ============================================================
// ot-ui.js — OT entry + summary page (drop-in)
// ------------------------------------------------------------
// One line in index.html, AFTER leave-ui.js:
//   <script src="ot-ui.js"></script>
// Injects its own sidebar link + page. Backend: addOtEntry,
// getOtSummary, generateOtReport (OT.gs), routed in Code.gs.
//
// ACCESS GATING (optional): put the OT compiler's email(s) in
// OT_ALLOWED below. If the list is non-empty and the signed-in
// user isn't on it, the page shows a "no access" notice. Leave the
// list empty to let anyone who can log in use it.
// ============================================================

(function () {
  const EXEC_URL = CONFIG.API_URL;

  // Who may open the OT screen. Empty means "anyone the server lets in" —
  // the real check is server-side in Auth.js, this only hides the tab.
  // Set OT_COMPILER_EMAILS in the script's Script Properties to control it.
  const OT_ALLOWED = [];
  let OT_ROSTER = [];

  function todayIso() { return new Date().toISOString().split('T')[0]; }
  function toDdMmYyyy(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return d + '-' + m + '-' + y; }
  function userEmail() { const el = document.getElementById('userEmail'); return el && el.innerText && el.innerText !== 'Loading...' ? el.innerText.trim() : ''; }
  function allowed() { return OT_ALLOWED.length === 0 || OT_ALLOWED.map(x => x.toLowerCase()).indexOf(userEmail().toLowerCase()) !== -1; }
  function money(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }); }

  async function callApi(qs) {
    const res = await fetch(EXEC_URL + '?' + qs);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');
    return data;
  }

  function toHM(h) {
    if (h == null || h === '' || isNaN(Number(h))) return '—';
    h = Number(h);
    if (h === 0) return '0h';
    const neg = h < 0; h = Math.abs(h);
    const hrs = Math.floor(h), min = Math.round((h - hrs) * 60);
    let s = (hrs > 0 ? hrs + 'h' : '') + (min > 0 ? (hrs > 0 ? ' ' : '') + min + 'm' : '');
    return (neg ? '-' : '') + (s || '0h');
  }
  function decToHM(dec) {
    dec = Math.max(0, Number(dec) || 0);
    return { h: Math.floor(dec), m: Math.round((dec - Math.floor(dec)) * 60) };
  }
  function hmToDec(hEl, mEl) {
    return (parseInt(hEl ? hEl.value : 0) || 0) + (parseInt(mEl ? mEl.value : 0) || 0) / 60;
  }


  document.addEventListener('DOMContentLoaded', function () {
    const navList = document.querySelector('#sidebar ul.nav');
    if (navList && !document.querySelector('[data-page="ot"]')) {
      const li = document.createElement('li');
      li.className = 'nav-item';
      li.innerHTML = '<a class="nav-link" data-page="ot"><i class="bi bi-stopwatch"></i> Overtime</a>';
      const lb = document.querySelector('[data-page="leavebal"]') || document.querySelector('[data-page="payroll"]');
      if (lb && lb.closest('li')) lb.closest('li').insertAdjacentElement('afterend', li);
      else navList.appendChild(li);
      li.querySelector('.nav-link').addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        const pg = document.getElementById('page-ot');
        if (pg) pg.classList.add('active');
        document.getElementById('pageTitle').innerText = 'Overtime';
        if (typeof app !== 'undefined' && app.otLoadRoster) app.otLoadRoster();
      });
    }

    const anchor = document.getElementById('page-dashboard');
    if (anchor && anchor.parentElement && !document.getElementById('page-ot')) {
      const s = document.createElement('div');
      s.className = 'page-section';
      s.id = 'page-ot';
      s.innerHTML =
        '<div id="otGate"></div>' +
        '<div id="otBody">' +
          // Add OT
          '<div class="table-container mb-4">' +
            '<h5 class="mb-3"><i class="bi bi-stopwatch"></i> Add Overtime</h5>' +
            '<div class="row g-2 align-items-end">' +
              '<div class="col-auto"><label class="form-label small mb-1">Date</label>' +
                '<input type="date" id="otDate" class="form-control form-control-sm" value="' + todayIso() + '"></div>' +
              '<div class="col-auto position-relative"><label class="form-label small mb-1">Employee (name / ID / Civil ID)</label>' +
                '<input type="text" id="otEmpSearch" class="form-control form-control-sm" style="min-width:240px" placeholder="Type name, MT-ID or Civil ID" autocomplete="off">' +
                '<input type="hidden" id="otEmp">' +
                '<select id="otEmpResults" class="form-select form-select-sm mt-1" size="5" style="display:none;position:absolute;z-index:30;min-width:240px" onchange="app.otPickEmployee(this.value)"></select>' +
                '<div id="otEmpPicked" class="small text-success mt-1"></div></div>' +
              '<div class="col-auto"><label class="form-label small mb-1">OT</label>' +
                '<div class="d-flex align-items-center gap-1">' +
                '<input type="number" id="otH" class="form-control form-control-sm" min="0" max="23" value="0" style="width:54px;text-align:center" placeholder="h">' +
                '<span class="text-muted small">h</span>' +
                '<input type="number" id="otM" class="form-control form-control-sm" min="0" max="59" value="0" style="width:54px;text-align:center" placeholder="m">' +
                '<span class="text-muted small">m</span>' +
                '</div></div>' +
              '<div class="col-auto"><label class="form-label small mb-1">Remark</label>' +
                '<input type="text" id="otRemark" class="form-control form-control-sm" placeholder="optional"></div>' +
              '<div class="col-auto">' +
                '<button id="otAddBtn" class="btn btn-primary btn-sm" onclick="app.addOt()"><i class="bi bi-plus-circle"></i> Add</button></div>' +
            '</div>' +
            '<div id="otAddStatus" class="mt-2"></div>' +
            '<div class="text-muted small mt-1">One OT figure per employee per day — re-adding the same date overwrites it. Dates shown as dd-mm-yyyy.</div>' +
          '</div>' +
          // Summary / report
          '<div class="table-container">' +
            '<div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">' +
              '<h5><i class="bi bi-bar-chart"></i> OT Summary</h5>' +
              '<div class="d-flex gap-2 align-items-end">' +
                '<div><label class="form-label small mb-1">From</label><input type="date" id="otFrom" class="form-control form-control-sm"></div>' +
                '<div><label class="form-label small mb-1">To</label><input type="date" id="otTo" class="form-control form-control-sm"></div>' +
                '<button class="btn btn-outline-secondary btn-sm" onclick="app.otSummary()"><i class="bi bi-search"></i> View</button>' +
                '<button class="btn btn-primary btn-sm" onclick="app.otReport()"><i class="bi bi-file-earmark-spreadsheet"></i> Save Report</button>' +
              '</div>' +
            '</div>' +
            '<div id="otSummaryWrap"><div class="text-muted small">Pick a From–To range and click View. Leave blank for all-time.</div></div>' +
          '</div>' +
        '</div>';
      anchor.parentElement.appendChild(s);

      // Employee search wiring (name / ID / Civil ID)
      const se = document.getElementById('otEmpSearch');
      if (se) se.addEventListener('input', function () {
        const q = this.value.trim().toLowerCase();
        const sel = document.getElementById('otEmpResults');
        document.getElementById('otEmp').value = '';
        document.getElementById('otEmpPicked').innerText = '';
        if (!q) { sel.style.display = 'none'; return; }
        const hits = OT_ROSTER.filter(r =>
          r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || (r.civilId && r.civilId.includes(q))
        ).slice(0, 15);
        sel.innerHTML = hits.map(r => '<option value="' + r.id + '">' + r.id + ' — ' + r.name + (r.civilId ? ' — ' + r.civilId : '') + '</option>').join('');
        sel.style.display = hits.length ? 'block' : 'none';
      });
    }
  });

  (function attach() {
    if (typeof app === 'undefined') return setTimeout(attach, 50);

    function guard() {
      const gate = document.getElementById('otGate');
      const body = document.getElementById('otBody');
      if (!gate || !body) return true;
      if (!allowed()) {
        gate.innerHTML = '<div class="alert alert-warning"><i class="bi bi-lock"></i> This page is restricted to the OT compiler. Signed in as ' + (userEmail() || 'unknown') + '.</div>';
        body.style.display = 'none';
        return false;
      }
      gate.innerHTML = ''; body.style.display = 'block';
      return true;
    }

    app.otLoadRoster = async function () {
      try { const d = await callApi('method=getRoster'); OT_ROSTER = d.data || []; } catch (e) { OT_ROSTER = []; }
    };

    app.otPickEmployee = function (id) {
      if (!id) return;
      const r = OT_ROSTER.find(x => x.id === id);
      document.getElementById('otEmp').value = id;
      const sel = document.getElementById('otEmpResults'); if (sel) sel.style.display = 'none';
      const se = document.getElementById('otEmpSearch'); if (se && r) se.value = r.name;
      const p = document.getElementById('otEmpPicked'); if (p && r) p.innerText = '✓ ' + r.id + ' — ' + r.name;
    };

    app.addOt = async function () {
      if (!guard()) return;
      const status = document.getElementById('otAddStatus');
      const dateIso = document.getElementById('otDate').value;
      const empId = document.getElementById('otEmp').value.trim();
      const hours = hmToDec(document.getElementById('otH'), document.getElementById('otM'));
      const remark = document.getElementById('otRemark').value.trim();
      if (!dateIso || !empId || !hours) { status.innerHTML = '<div class="alert alert-warning mb-0">Date, Employee (pick from search) and OT Hours are required.</div>'; return; }
      const btn = document.getElementById('otAddBtn'); const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
      try {
        const qs = 'method=addOtEntry&date=' + encodeURIComponent(toDdMmYyyy(dateIso)) +
          '&empId=' + encodeURIComponent(empId) + '&hours=' + encodeURIComponent(hours) +
          '&remark=' + encodeURIComponent(remark) + '&by=' + encodeURIComponent(userEmail() || 'Dashboard');
        const data = await callApi(qs);
        status.innerHTML = '<div class="alert alert-success mb-0"><i class="bi bi-check-circle"></i> ' + data.message + '</div>';
        document.getElementById('otH').value = '0'; document.getElementById('otM').value = '0'; document.getElementById('otRemark').value = '';
      } catch (err) { status.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>'; }
      finally { btn.disabled = false; btn.innerHTML = orig; }
    };

    function summaryQs() {
      const from = document.getElementById('otFrom').value;
      const to = document.getElementById('otTo').value;
      let qs = '';
      if (from) qs += '&from=' + encodeURIComponent(toDdMmYyyy(from));
      if (to) qs += '&to=' + encodeURIComponent(toDdMmYyyy(to));
      return qs;
    }

    app.otSummary = async function () {
      if (!guard()) return;
      const wrap = document.getElementById('otSummaryWrap');
      wrap.innerHTML = '<div class="text-muted small">Loading…</div>';
      try {
        const data = await callApi('method=getOtSummary' + summaryQs());
        if (!data.data || !data.data.length) { wrap.innerHTML = '<div class="text-muted small">No OT in this range.</div>'; return; }
        const body = data.data.map(r =>
          '<tr><td>' + r.empId + '</td><td>' + r.name + '</td><td class="text-end">' + r.days + '</td>' +
          '<td class="text-end">' + r.hours + '</td><td class="text-end">' + money(r.rate) + '</td>' +
          '<td class="text-end fw-bold">' + money(r.amount) + '</td></tr>').join('');
        wrap.innerHTML = '<table class="table table-sm table-striped"><thead><tr>' +
          '<th>ID</th><th>Name</th><th class="text-end">Days</th><th class="text-end">OT Hours</th>' +
          '<th class="text-end">Rate</th><th class="text-end">OT Amount</th></tr></thead><tbody>' + body + '</tbody>' +
          '<tfoot><tr class="fw-bold"><td colspan="3">TOTALS (' + data.employees + ')</td>' +
          '<td class="text-end">' + data.totalHours + '</td><td></td><td class="text-end">' + money(data.totalAmount) + '</td></tr></tfoot></table>';
      } catch (err) { wrap.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>'; }
    };

    app.otReport = async function () {
      if (!guard()) return;
      const wrap = document.getElementById('otSummaryWrap');
      try {
        const data = await callApi('method=generateOtReport' + summaryQs());
        wrap.insertAdjacentHTML('afterbegin', '<div class="alert alert-success"><i class="bi bi-check-circle"></i> ' + data.message + '</div>');
      } catch (err) { wrap.insertAdjacentHTML('afterbegin', '<div class="alert alert-danger">' + err.message + '</div>'); }
    };
  })();
})();
