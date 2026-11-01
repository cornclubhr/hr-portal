// ============================================================
// payroll-review-ui.js — frontend-driven Payroll Review + Run
// ------------------------------------------------------------
// Adds a "Payroll Review" page: pick period end, load every Active
// employee with base pay + OT (whole OT_Entries tab) + encashment +
// auto Unpaid-leave deduction, edit Bonus/Loan/Advance/Disciplinary
// inline (itemised), see live Net + grand total, and Run from the page.
// Scheduled Extras (bonus etc. logged on the Scheduled Deductions & Extras
// page) for the run's month are shown in their own column and added to Net.
// Running archives OT_Entries and starts a fresh tab.
//
// index.html (after payroll-ui.js):  <script src="payroll-review-ui.js"></script>
// Backend: getPayrollReview, runPayrollFromReview.
// ============================================================

(function () {
  const EXEC_URL = CONFIG.API_URL;
  let REVIEW = null;

  const KD = (n) => (Math.round((Number(n) || 0) * 1000) / 1000);
  const fmt = (n) => KD(n).toFixed(3);
  function todayIso() { return new Date().toISOString().split('T')[0]; }
  function toDd(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return d + '-' + m + '-' + y; }
  function adminEmail() { const el = document.getElementById('userEmail'); return el && el.innerText && el.innerText !== 'Loading...' ? el.innerText.trim() : 'Dashboard'; }

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
    if (navList && !document.querySelector('[data-page="payrollreview"]')) {
      const li = document.createElement('li'); li.className = 'nav-item';
      li.innerHTML = '<a class="nav-link" data-page="payrollreview"><i class="bi bi-calculator"></i> Payroll Review</a>';
      const pay = document.querySelector('[data-page="payroll"]');
      if (pay && pay.closest('li')) pay.closest('li').insertAdjacentElement('afterend', li);
      else navList.appendChild(li);
      li.querySelector('.nav-link').addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        const pg = document.getElementById('page-payrollreview'); if (pg) pg.classList.add('active');
        document.getElementById('pageTitle').innerText = 'Payroll Review';
      });
    }

    const anchor = document.getElementById('page-dashboard');
    if (anchor && anchor.parentElement && !document.getElementById('page-payrollreview')) {
      const s = document.createElement('div'); s.className = 'page-section'; s.id = 'page-payrollreview';
      s.innerHTML =
        '<div class="table-container mb-3">' +
          '<h5 class="mb-3"><i class="bi bi-calculator"></i> Payroll Review &amp; Run</h5>' +
          '<div class="row g-2 align-items-end">' +
            '<div class="col-auto"><label class="form-label small mb-1">Period end (cutoff)</label><input type="date" id="prEnd" class="form-control form-control-sm" value="' + todayIso() + '"></div>' +
            '<div class="col-auto"><label class="form-label small mb-1">Period start (optional)</label><input type="date" id="prStart" class="form-control form-control-sm"></div>' +
            '<div class="col-auto"><label class="form-label small mb-1">Exclude IDs (cash/advance)</label><input type="text" id="prExclude" class="form-control form-control-sm" placeholder="HR-EMP-00036"></div>' +
            '<div class="col-auto"><button class="btn btn-primary btn-sm" onclick="app.loadPayrollReview()"><i class="bi bi-search"></i> Load</button></div>' +
          '</div>' +
          '<div class="text-muted small mt-2">OT is taken from the <b>entire</b> OT_Entries tab. Unpaid-leave deductions auto-fill from granted Unpaid leave in the period. Running archives OT_Entries and starts fresh.</div>' +
        '</div>' +
        '<div id="prTableWrap" class="table-container table-responsive"><div class="text-muted small">Pick a period end and click Load.</div></div>' +
        '<div id="prRunBar"></div>';
      anchor.parentElement.appendChild(s);
    }
  });

  (function attach() {
    if (typeof app === 'undefined') return setTimeout(attach, 50);

    app.loadPayrollReview = async function () {
      const wrap = document.getElementById('prTableWrap');
      const end = document.getElementById('prEnd').value;
      const start = document.getElementById('prStart').value;
      const excl = document.getElementById('prExclude').value.trim();
      if (!end) { wrap.innerHTML = '<div class="alert alert-warning mb-0">Pick a period end.</div>'; return; }
      wrap.innerHTML = '<div class="text-muted small">Loading…</div>';
      document.getElementById('prRunBar').innerHTML = '';
      try {
        let qs = 'method=getPayrollReview&periodEnd=' + encodeURIComponent(toDd(end));
        if (start) qs += '&periodStart=' + encodeURIComponent(toDd(start));
        if (excl) qs += '&excludeIds=' + encodeURIComponent(excl);
        REVIEW = await callApi(qs);
        app.renderPayrollReview();
      } catch (err) { wrap.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>'; }
    };

    app.renderPayrollReview = function () {
      const wrap = document.getElementById('prTableWrap');
      if (!REVIEW || !REVIEW.employees.length) { wrap.innerHTML = '<div class="text-muted small">No Active employees for this period.</div>'; return; }
      const body = REVIEW.employees.map((e, i) => {
        const unp = e.unpaidDays ? ('<span title="' + (e.unpaidNote || '') + '">' + fmt(e.unpaidAmt) + '<br><span class="text-muted" style="font-size:11px">' + e.unpaidDays + 'd</span></span>') : '0.000';
        return '<tr data-i="' + i + '">' +
          '<td>' + e.id + '</td><td>' + e.name + '</td>' +
          '<td class="text-end">' + fmt(e.gross) + '</td>' +
          '<td class="text-end">' + e.otHours + '<br><span class="text-muted" style="font-size:11px">' + fmt(e.otAmount) + '</span></td>' +
          '<td class="text-end">' + fmt(e.encAmt) + '</td>' +
          '<td><input type="number" step="0.001" class="form-control form-control-sm pr-bonus text-end" value="0" style="width:90px"></td>' +
          '<td class="text-end pr-extra" data-v="' + KD(e.extra || 0) + '">' + (e.extra ? '<span class="text-success" title="' + (e.extraItems||[]).map(it=>it.type+' '+fmt(it.amount)+(it.remark?' ('+it.remark+')':'')).join(', ') + '">+' + fmt(e.extra) + '</span>' : '0.000') + '</td>' +
          '<td class="text-end pr-unpaid" data-v="' + KD(e.unpaidAmt) + '">' + unp + '</td>' +
          '<td class="text-end pr-sched" data-v="' + KD(e.scheduled || 0) + '">' + (e.scheduled ? '<span title="' + (e.scheduledItems||[]).map(it=>it.type+' '+fmt(it.amount)).join(', ') + '">' + fmt(e.scheduled) + '</span>' : '0.000') + '</td>' +
          '<td><input type="number" step="0.001" class="form-control form-control-sm pr-loan text-end" value="0" style="width:90px"></td>' +
          '<td><input type="number" step="0.001" class="form-control form-control-sm pr-adv text-end" value="0" style="width:90px"></td>' +
          '<td><input type="number" step="0.001" class="form-control form-control-sm pr-disc text-end" value="0" style="width:90px"></td>' +
          '<td class="text-end fw-bold pr-net">' + fmt(e.net) + '</td>' +
          '</tr>';
      }).join('');
      wrap.innerHTML = '<table class="table table-sm table-striped align-middle" style="min-width:1050px"><thead><tr>' +
        '<th>ID</th><th>Name</th><th class="text-end">Gross</th><th class="text-end">OT (hrs/KD)</th><th class="text-end">Encash</th>' +
        '<th class="text-end">Bonus/Add</th><th class="text-end" title="From Scheduled Extras for this month">Sched. extras</th><th class="text-end">Unpaid</th><th class="text-end">Scheduled</th><th class="text-end">Loan</th><th class="text-end">Advance</th><th class="text-end">Discipline</th>' +
        '<th class="text-end">Net</th></tr></thead><tbody>' + body + '</tbody></table>';

      wrap.querySelectorAll('tr[data-i]').forEach(tr => {
        tr.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => app.recalcRow(tr)));
      });
      app.renderRunBar();
    };

    app.recalcRow = function (tr) {
      const i = +tr.getAttribute('data-i');
      const e = REVIEW.employees[i];
      const num = (sel) => { const el = tr.querySelector(sel); return Number(el.value) || 0; };
      const bonus = num('.pr-bonus'), loan = num('.pr-loan'), adv = num('.pr-adv'), disc = num('.pr-disc');
      const unpaid = Number(tr.querySelector('.pr-unpaid').getAttribute('data-v')) || 0;
      const sched = Number((tr.querySelector('.pr-sched') || {}).getAttribute ? tr.querySelector('.pr-sched').getAttribute('data-v') : 0) || 0;
      const extra = Number(tr.querySelector('.pr-extra').getAttribute('data-v')) || 0;
      const net = KD(e.gross + e.otAmount + e.encAmt + bonus + extra - (unpaid + sched + loan + adv + disc));
      tr.querySelector('.pr-net').innerText = fmt(net);
      app.renderRunBar();
    };

    app.renderRunBar = function () {
      let total = 0;
      document.querySelectorAll('#prTableWrap tr[data-i]').forEach(tr => { total += Number(tr.querySelector('.pr-net').innerText) || 0; });
      document.getElementById('prRunBar').innerHTML =
        '<div class="table-container d-flex justify-content-between align-items-center flex-wrap gap-2">' +
          '<div><b>Period:</b> ' + REVIEW.periodStart + ' → ' + REVIEW.periodEnd + ' &nbsp; <b>Staff:</b> ' + REVIEW.employees.length +
            ' &nbsp; <b>Total Net:</b> <span class="fs-5">' + fmt(total) + '</span> KD</div>' +
          '<div><button class="btn btn-success" onclick="app.runPayrollFromReview()"><i class="bi bi-play-circle"></i> Run Payroll</button></div>' +
        '</div>';
    };

    app.runPayrollFromReview = async function () {
      if (!REVIEW) return;
      if (!confirm('Run payroll for ' + REVIEW.periodStart + ' → ' + REVIEW.periodEnd + '?\n\nThis writes the period tab, then ARCHIVES OT_Entries and starts a fresh OT tab. Make sure all OT for this period is entered.')) return;
      const rows = [];
      document.querySelectorAll('#prTableWrap tr[data-i]').forEach(tr => {
        const e = REVIEW.employees[+tr.getAttribute('data-i')];
        const num = (sel) => Number(tr.querySelector(sel).value) || 0;
        rows.push({ id: e.id, bonus: num('.pr-bonus'), loan: num('.pr-loan'), advance: num('.pr-adv'), disciplinary: num('.pr-disc') });
      });
      const bar = document.getElementById('prRunBar');
      bar.innerHTML = '<div class="alert alert-info"><span class="spinner-border spinner-border-sm"></span> Running…</div>';
      try {
        const d = await callPost('runPayrollFromReview', {
          periodStart: toDd(document.getElementById('prStart').value) || REVIEW.periodStart,
          periodEnd: REVIEW.periodEnd, rows: rows, by: adminEmail()
        });
        bar.innerHTML = '<div class="alert alert-success"><i class="bi bi-check-circle"></i> ' + d.message + '</div>';
      } catch (err) { bar.innerHTML = '<div class="alert alert-danger">' + err.message + '</div>'; app.renderRunBar(); }
    };
  })();
})();
