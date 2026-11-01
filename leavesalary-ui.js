// ============================================================
// leavesalary-ui.js — Leave Salary: pay a man before he flies
// ------------------------------------------------------------
// One line in index.html, after grant-ui.js:
//   <script src="leavesalary-ui.js"></script>
//
// This is NOT payroll. The month's run may already be closed and the
// man leaves tomorrow, so this pays him separately and prints a
// voucher, the same way leave encashment does.
//
// The page lists every approved leave that takes someone off the
// payroll while they are away. Tick one man or ten, set the months
// (2 by default), type any days a salary already covered, and it
// shows the total before anything is committed. What has been paid
// is remembered against the leave, so the second payment months
// later starts where the first one stopped.
//
// Backend: getLeaveSalaryList, payLeaveSalary, cancelLeaveSalary,
//          getLeaveSalaryHistory, generateLeaveSalaryVoucher,
//          setLeaveTicketAmount
// ============================================================

(function () {
  // The endpoint lives in config.js and nowhere else.
  const execUrl = () => {
    const u = (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.API_URL) ? String(CONFIG.API_URL) : '';
    if (!u) throw new Error('config.js is missing — API_URL not set');
    return u.replace('/dev', '/exec');
  };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kd = (n) => (Math.round((Number(n) || 0) * 1000) / 1000).toFixed(3);
  const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
  const adminEmail = () => {
    const el = document.getElementById('userEmail');
    return el && el.innerText && el.innerText !== 'Loading...' ? el.innerText.trim() : 'Dashboard';
  };

  async function callApi(qs) {
    const r = await fetch(execUrl() + '?' + qs + '&_=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'Unknown error');
    return d;
  }
  async function postApi(method, body) {
    const r = await fetch(execUrl() + '?method=' + method, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'Unknown error');
    return d;
  }

  const WHEN_BADGE = {
    running:  '<span class="badge bg-info text-dark">on leave now</span>',
    upcoming: '<span class="badge bg-primary">upcoming</span>',
    ended:    '<span class="badge bg-secondary">leave ended</span>'
  };

  function pageHtml() {
    return (
      '<div class="table-container mb-3">' +
        '<div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">' +
          '<h5 class="mb-0"><i class="bi bi-airplane-engines"></i> Leave Salary</h5>' +
          '<div class="d-flex gap-2 flex-wrap align-items-center">' +
            '<input type="text" id="lsSearch" class="form-control form-control-sm" style="width:180px" placeholder="Search name / ID">' +
            '<span class="text-muted small">Ticket</span>' +
            '<div class="input-group input-group-sm" style="width:140px">' +
              '<span class="input-group-text">KD</span>' +
              '<input type="number" step="0.001" id="lsTicket" class="form-control form-control-sm">' +
              '<button class="btn btn-outline-secondary" onclick="app.lsSaveTicket()" title="Save as the standard ticket amount"><i class="bi bi-save"></i></button>' +
            '</div>' +
            '<button class="btn btn-outline-secondary btn-sm" onclick="app.loadLeaveSalary()"><i class="bi bi-arrow-repeat"></i> Refresh</button>' +
          '</div>' +
        '</div>' +
        '<p class="text-muted small mb-2">Paid <b>separately from payroll</b>, before the man travels. ' +
          'Rate is Basic &divide; 30, a month is 30 days. What you pay is remembered against the leave, ' +
          'so the next payment picks up where this one stops.</p>' +
        '<div id="lsChips" class="mb-2"></div>' +
        '<div id="lsStatus" class="mb-2"></div>' +
        '<datalist id="lsDedReasons">' +
          '<option value="Food allowance already paid for the leave period">' +
          '<option value="Accommodation allowance already paid for the leave period">' +
          '<option value="Salary advance">' +
          '<option value="Loan instalment">' +
        '</datalist>' +
        '<div id="lsTableWrap" class="table-responsive"><div class="text-muted small">Loading…</div></div>' +
        '<div id="lsBar" class="mt-2"></div>' +
      '</div>' +

      '<div class="table-container">' +
        '<div class="d-flex justify-content-between align-items-center mb-2">' +
          '<h6 class="mb-0"><i class="bi bi-receipt"></i> Payments already made</h6>' +
          '<button class="btn btn-outline-secondary btn-sm" onclick="app.loadLeaveSalaryHistory()"><i class="bi bi-arrow-repeat"></i></button>' +
        '</div>' +
        '<div id="lsHistWrap"><div class="text-muted small">Loading…</div></div>' +
      '</div>'
    );
  }

  document.addEventListener('DOMContentLoaded', function () {
    const navList = document.querySelector('#sidebar ul.nav');
    if (navList && !document.querySelector('[data-page="leavesalary"]')) {
      const li = document.createElement('li');
      li.className = 'nav-item';
      li.innerHTML = '<a class="nav-link" data-page="leavesalary"><i class="bi bi-airplane-engines"></i> Leave Salary' +
                     '<span id="lsNavBadge" class="badge bg-warning text-dark ms-1" style="display:none"></span></a>';
      const reg = document.querySelector('[data-page="leaveregister"]');
      if (reg && reg.closest('li')) reg.closest('li').insertAdjacentElement('afterend', li);
      else navList.appendChild(li);
      li.querySelector('.nav-link').addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        const pg = document.getElementById('page-leavesalary'); if (pg) pg.classList.add('active');
        const t = document.getElementById('pageTitle'); if (t) t.innerText = 'Leave Salary';
        const g = document.getElementById('pageGroup'); if (g) g.innerText = 'Admin';
        if (app.loadLeaveSalary) app.loadLeaveSalary();
      });
    }

    try {
      if (typeof PAGE_META === 'object' && PAGE_META && !PAGE_META.leavesalary) {
        PAGE_META.leavesalary = { title: 'Leave Salary', group: 'Admin' };
      }
    } catch (e) { /* our own handler covers it */ }

    const anchor = document.getElementById('page-dashboard');
    if (anchor && anchor.parentElement && !document.getElementById('page-leavesalary')) {
      const s = document.createElement('div');
      s.className = 'page-section'; s.id = 'page-leavesalary';
      s.innerHTML = pageHtml();
      anchor.parentElement.appendChild(s);
      const se = s.querySelector('#lsSearch');
      if (se) se.addEventListener('input', function () { app.LSQ = this.value.trim().toLowerCase(); app.renderLeaveSalary(); });
    }
  });

  (function attach() {
    if (typeof app === 'undefined') return setTimeout(attach, 50);

    app.LSDATA = null;      // rows from the backend
    app.LSSEL = {};         // grantId -> { months, lessDays, ticket, on }
    app.LSQ = '';           // search text
    app.LSFILTER = 'owing'; // owing | upcoming | running | ended | all
    app.LSTICKET = 0;

    const say = (html, bad) => {
      const el = document.getElementById('lsStatus');
      if (el) el.innerHTML = html ? '<div class="alert alert-' + (bad ? 'danger' : 'success') + ' py-2 mb-0">' + html + '</div>' : '';
    };

    app.loadLeaveSalary = async function () {
      const wrap = document.getElementById('lsTableWrap');
      if (!wrap) return;
      wrap.innerHTML = '<div class="text-muted small">Loading…</div>';
      app.LSSEL = {};
      try {
        const d = await callApi('method=getLeaveSalaryList');
        app.LSDATA = d;
        app.LSTICKET = Number(d.ticket) || 0;
        const t = document.getElementById('lsTicket');
        if (t && !t.value) t.value = app.LSTICKET;
        app.renderLeaveSalary();
        app.refreshLeaveSalaryBadge();
      } catch (err) {
        wrap.innerHTML = '<div class="alert alert-danger mb-0">' + esc(err.message) + '</div>';
      }
      app.loadLeaveSalaryHistory();
    };

    app.lsRows = function () {
      if (!app.LSDATA) return [];
      return app.LSDATA.data.filter(r => {
        if (app.LSFILTER === 'owing' && r.fullyPaid) return false;
        if (app.LSFILTER === 'upcoming' && r.when !== 'upcoming') return false;
        if (app.LSFILTER === 'running' && r.when !== 'running') return false;
        if (app.LSFILTER === 'ended' && r.when !== 'ended') return false;
        if (app.LSQ && !((r.name || '').toLowerCase().includes(app.LSQ) ||
                         (r.empId || '').toLowerCase().includes(app.LSQ))) return false;
        return true;
      });
    };

    app.lsFilter = function (f) { app.LSFILTER = f; app.renderLeaveSalary(); };

    // The sum, done exactly the way the backend does it, so the number on
    // screen is the number that gets paid.
    app.lsCalc = function (r, sel) {
      const asked = Math.round((Number(sel.months) || 0) * (app.LSDATA.daysPerMonth || 30));
      const daysPaid = Math.max(0, Math.min(asked, r.daysRemaining));
      const lessDays = Math.max(0, Number(sel.lessDays) || 0);
      const leaveSalary = r3(r.ratePerDay * daysPaid);
      const lessAmount = r3(r.ratePerDay * lessDays);
      const otherDeduction = r3(Math.max(0, Number(sel.otherDeduction) || 0));
      const ticket = sel.on ? r3(Number(sel.ticket) || 0) : 0;
      const net = r3(leaveSalary - lessAmount - otherDeduction + ticket);
      return {
        daysPaid: daysPaid, capped: daysPaid < asked, lessDays: lessDays,
        leaveSalary: leaveSalary, lessAmount: lessAmount,
        otherDeduction: otherDeduction, ticket: ticket, net: net,
        bad: lessDays > daysPaid || daysPaid <= 0 || net < 0
      };
    };

    app.renderLeaveSalary = function () {
      const wrap = document.getElementById('lsTableWrap');
      const chips = document.getElementById('lsChips');
      if (!wrap || !app.LSDATA) return;
      const all = app.LSDATA.data;

      if (chips) {
        const n = (f) => f === 'all' ? all.length
          : f === 'owing' ? all.filter(r => !r.fullyPaid).length
          : all.filter(r => r.when === f).length;
        const chip = (label, f, cls) =>
          '<button class="btn btn-sm btn-' + (app.LSFILTER === f ? '' : 'outline-') + cls + ' me-1" ' +
          'onclick="app.lsFilter(\'' + f + '\')">' + label + ' <span class="badge bg-light text-dark">' + n(f) + '</span></button>';
        chips.innerHTML = chip('Still owed', 'owing', 'warning') + chip('Upcoming', 'upcoming', 'primary') +
                          chip('On leave now', 'running', 'info') + chip('Ended', 'ended', 'secondary') +
                          chip('All', 'all', 'dark');
      }

      const rows = app.lsRows();
      if (!rows.length) {
        wrap.innerHTML = '<div class="text-muted small">Nothing here.</div>';
        app.renderLeaveSalaryBar(); return;
      }

      wrap.innerHTML =
        '<table class="table table-sm align-middle"><thead><tr>' +
          '<th style="width:28px"></th><th>Employee</th><th>Leave</th>' +
          '<th class="text-end">Owed</th><th style="width:90px">Months</th>' +
          '<th style="width:110px">Days already<br>paid in salary</th>' +
          '<th style="width:190px">Other deduction</th>' +
          '<th style="width:120px">Ticket</th>' +
          '<th class="text-end">This payment</th>' +
        '</tr></thead><tbody>' +
        rows.map(r => {
          const sel = app.LSSEL[r.grantId];
          const on = !!sel;
          const s = sel || { months: r.suggestMonths || 1, lessDays: 0, otherDeduction: 0,
                             deductionNote: '', ticket: app.LSTICKET, on: true };
          const c = app.lsCalc(r, s);
          const paidNote = r.daysPaid
            ? '<div class="text-muted small">already paid ' + r.daysPaid + 'd to ' + esc(r.paidTo) + '</div>' : '';
          const warn = r.noBasic ? '<div class="text-danger small">no Basic Salary on file</div>' : '';
          return '<tr data-gid="' + esc(r.grantId) + '"' + (r.fullyPaid ? ' class="table-light"' : '') + '>' +
            '<td>' + (r.fullyPaid || r.noBasic ? '' :
              '<input type="checkbox" class="form-check-input ls-tick" data-gid="' + esc(r.grantId) + '"' + (on ? ' checked' : '') + '>') + '</td>' +
            '<td><b>' + esc(r.name) + '</b><div class="text-muted small">' + esc(r.empId) +
              (r.designation ? ' · ' + esc(r.designation) : '') + '</div>' + warn + '</td>' +
            '<td class="small">' + esc(r.type) + ' ' + esc(r.start) + ' → ' + esc(r.end) +
              ' <span class="text-muted">(' + r.leaveDays + 'd)</span><br>' +
              (WHEN_BADGE[r.when] || '') +
              (r.when === 'upcoming' && r.daysToStart <= 7 ? ' <span class="badge bg-danger">in ' + r.daysToStart + ' day' + (r.daysToStart === 1 ? '' : 's') + '</span>' : '') +
              paidNote + '</td>' +
            '<td class="text-end">' + (r.fullyPaid
              ? '<span class="badge bg-success">paid in full</span>'
              : '<b>' + r.daysRemaining + '</b> d<div class="text-muted small">from ' + esc(r.nextFrom) + '</div>') + '</td>' +
            (r.fullyPaid || r.noBasic
              ? '<td colspan="5" class="text-muted small text-end">' +
                  (r.fullyPaid ? 'Nothing owed on this leave.' : 'Fix the Basic Salary on his employee row first.') + '</td>'
              : '<td><input type="number" min="0.5" step="0.5" class="form-control form-control-sm ls-months" value="' + s.months + '"></td>' +
                '<td><input type="number" min="0" step="1" class="form-control form-control-sm ls-less" value="' + s.lessDays + '"></td>' +
                '<td>' +
                  '<div class="input-group input-group-sm mb-1"><span class="input-group-text">KD</span>' +
                    '<input type="number" min="0" step="0.001" class="form-control form-control-sm ls-ded" value="' + (s.otherDeduction || '') + '" placeholder="0"></div>' +
                  '<input type="text" class="form-control form-control-sm ls-dednote" value="' + esc(s.deductionNote || '') +
                    '" placeholder="what for" list="lsDedReasons">' +
                '</td>' +
                '<td><div class="input-group input-group-sm">' +
                  '<div class="input-group-text"><input class="form-check-input mt-0 ls-tkt-on" type="checkbox"' + (s.on ? ' checked' : '') + ' title="Travelling — pay the ticket"></div>' +
                  '<input type="number" step="0.001" class="form-control form-control-sm ls-tkt" value="' + kd(s.ticket) + '"' + (s.on ? '' : ' disabled') + '>' +
                '</div></td>' +
                '<td class="text-end ls-net">' + app.lsNetHtml(r, c) + '</td>') +
            '</tr>';
        }).join('') + '</tbody></table>';

      // Everything recalculates as it is typed — no Calculate button.
      wrap.querySelectorAll('tr[data-gid]').forEach(tr => {
        const gid = tr.getAttribute('data-gid');
        const tick = tr.querySelector('.ls-tick');
        const recalc = () => app.lsRowChanged(gid, tr);
        if (tick) tick.addEventListener('change', recalc);
        ['.ls-months', '.ls-less', '.ls-ded', '.ls-dednote', '.ls-tkt'].forEach(sel => {
          const el = tr.querySelector(sel); if (el) el.addEventListener('input', recalc);
        });
        const tkton = tr.querySelector('.ls-tkt-on');
        if (tkton) tkton.addEventListener('change', function () {
          const amt = tr.querySelector('.ls-tkt'); if (amt) amt.disabled = !this.checked;
          recalc();
        });
      });
      app.renderLeaveSalaryBar();
    };

    app.lsNetHtml = function (r, c) {
      if (c.bad) return '<span class="text-danger small">check the numbers</span>';
      const bits = [];
      bits.push('<b>KD ' + kd(c.net) + '</b>');
      bits.push('<div class="text-muted small">' + c.daysPaid + 'd × ' + kd(r.ratePerDay) +
        (c.lessDays ? ' − ' + c.lessDays + 'd' : '') +
        (c.otherDeduction ? ' − ' + kd(c.otherDeduction) : '') +
        (c.ticket ? ' + tkt' : '') + '</div>');
      if (c.capped) bits.push('<div class="text-warning small">capped to what is left</div>');
      return bits.join('');
    };

    app.lsRowChanged = function (gid, tr) {
      const r = app.LSDATA.data.find(x => x.grantId === gid);
      if (!r) return;
      const tick = tr.querySelector('.ls-tick');
      const months = Number((tr.querySelector('.ls-months') || {}).value) || 0;
      const lessDays = Number((tr.querySelector('.ls-less') || {}).value) || 0;
      const otherDeduction = Number((tr.querySelector('.ls-ded') || {}).value) || 0;
      const deductionNote = String((tr.querySelector('.ls-dednote') || {}).value || '').trim();
      const tkton = tr.querySelector('.ls-tkt-on');
      const ticket = Number((tr.querySelector('.ls-tkt') || {}).value) || 0;
      const sel = { months: months, lessDays: lessDays, otherDeduction: otherDeduction,
                    deductionNote: deductionNote, ticket: ticket, on: tkton ? tkton.checked : false };
      if (tick && tick.checked) app.LSSEL[gid] = sel; else delete app.LSSEL[gid];
      const cell = tr.querySelector('.ls-net');
      if (cell) cell.innerHTML = app.lsNetHtml(r, app.lsCalc(r, sel));
      app.renderLeaveSalaryBar();
    };

    app.renderLeaveSalaryBar = function () {
      const bar = document.getElementById('lsBar');
      if (!bar || !app.LSDATA) return;
      const ids = Object.keys(app.LSSEL);
      if (!ids.length) {
        bar.innerHTML = '<div class="text-muted small">Tick the men you are paying. ' +
          'Nothing leaves this page until you press Pay.</div>';
        return;
      }
      let total = 0, bad = 0;
      ids.forEach(gid => {
        const r = app.LSDATA.data.find(x => x.grantId === gid); if (!r) return;
        const c = app.lsCalc(r, app.LSSEL[gid]);
        if (c.bad) bad++; else total += c.net;
      });
      bar.innerHTML =
        '<div class="d-flex align-items-center gap-3 flex-wrap border-top pt-2">' +
          '<div><b>' + ids.length + '</b> selected · <b class="fs-5">KD ' + kd(total) + '</b></div>' +
          (bad ? '<span class="text-danger small">' + bad + ' row(s) need fixing</span>' : '') +
          '<button class="btn btn-primary btn-sm"' + (bad ? ' disabled' : '') +
            ' onclick="app.lsPay()"><i class="bi bi-cash-coin"></i> Pay &amp; print vouchers</button>' +
          '<button class="btn btn-outline-secondary btn-sm" onclick="app.lsSettle()" title="They were paid some other way — just stop showing them as owed">' +
            'Mark settled, no payment</button>' +
          '<button class="btn btn-link btn-sm" onclick="app.lsClear()">clear</button>' +
        '</div>';
    };

    app.lsClear = function () { app.LSSEL = {}; app.renderLeaveSalary(); };

    app.lsItems = function (settle) {
      return Object.keys(app.LSSEL).map(gid => {
        const s = app.LSSEL[gid];
        const it = { grantId: gid, months: s.months, lessDays: s.lessDays,
                     otherDeduction: s.otherDeduction, deductionNote: s.deductionNote,
                     ticket: s.on ? s.ticket : 0 };
        if (settle) { it.settle = true; it.months = 999; }
        return it;
      });
    };

    // Paying is three separate stages and they must stay separate.
    // Before the money is written, any error means nothing happened and we
    // stop. After it is written, NOTHING below may make it look as though
    // the payment failed — a voucher that will not print is a printing
    // problem, and the man has still been paid.
    app.lsPay = async function () {
      const items = app.lsItems(false);
      if (!items.length) return;
      say('');

      // ── Stage 1: what would be paid. Nothing is written yet. ──────────
      let pv;
      try {
        pv = await postApi('payLeaveSalary', { items: items, by: adminEmail(), preview: true });
      } catch (err) { say(esc(err.message), true); return; }

      const rows = Array.isArray(pv.paid) ? pv.paid : [];
      const refused = Array.isArray(pv.refused) ? pv.refused : [];
      if (!rows.length) {
        say('Nothing can be paid.' + (refused.length
          ? '<ul class="mb-0 mt-1 small">' + refused.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>'
          : ''), true);
        return;
      }

      const lines = rows.map(p => '  ' + p.name + '   ' + p.paidFrom + ' → ' + p.paidTo +
        '   ' + p.daysPaid + 'd' + (p.lessDays ? ' less ' + p.lessDays + 'd' : '') +
        (p.otherDeduction ? ' less KD ' + kd(p.otherDeduction) + (p.deductionNote ? ' (' + p.deductionNote + ')' : '') : '') +
        (p.ticket ? ' + ticket' : '') + '   KD ' + kd(p.net)).join('\n');
      const skipped = refused.length ? '\n\nSkipped:\n' + refused.join('\n') : '';
      if (!confirm('Pay ' + rows.length + ' leave salary payment(s), KD ' + kd(pv.total) + ' in total?\n\n' +
                   lines + skipped + '\n\nThis is paid outside payroll and cannot be undone except by cancelling the voucher.')) return;

      // ── Stage 2: the payment. If this throws, nothing was written. ────
      let d;
      try {
        d = await postApi('payLeaveSalary', { items: items, by: adminEmail() });
      } catch (err) { say(esc(err.message), true); return; }

      app.LSSEL = {};
      const nos = (Array.isArray(d.paid) ? d.paid : [])
                    .map(p => (p && p.voucherNo) ? String(p.voucherNo) : '')
                    .filter(Boolean);
      const turned = Array.isArray(d.refused) ? d.refused : [];

      // The backend can accept the request and still pay nobody — every man
      // refused for a reason it knows and the screen does not. Say the
      // reason. Never print, and never leave it looking like a payment.
      if (!nos.length) {
        say('<b>Nothing was paid.</b>' + (turned.length
          ? '<ul class="mb-0 mt-1 small">' + turned.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>'
          : ' ' + esc(d.message)), true);
        app.loadLeaveSalary();
        return;
      }

      // From here the money IS recorded in the log.
      say(esc(d.message));

      // ── Stage 3: the vouchers. One at a time, by voucher number, so a
      // voucher that fails cannot take the rest of them down with it. ──
      const ok = [], bad = [];
      for (let i = 0; i < nos.length; i++) {
        try {
          const v = await callApi('method=generateLeaveSalaryVoucher&voucherNo=' + encodeURIComponent(nos[i]));
          if (v && v.url) ok.push({ voucherNo: nos[i], url: v.url }); else bad.push(nos[i]);
        } catch (e) { bad.push(nos[i]); }
      }

      let html = esc(d.message);
      if (ok.length) {
        html += '<div class="mt-2">' + ok.map(x =>
          '<a class="btn btn-sm btn-outline-primary me-1 mb-1" target="_blank" rel="noopener" href="' + esc(x.url) + '">' +
          '<i class="bi bi-file-earmark-pdf"></i> ' + esc(x.voucherNo) + '</a>').join('') + '</div>';
      }
      if (bad.length) {
        html += '<div class="mt-2 small text-danger"><b>Paid, but the voucher did not print.</b> ' +
                'The payment is recorded — do not pay again. Press to try printing:</div>' +
                '<div class="mt-1">' + bad.map(no =>
                  '<button class="btn btn-sm btn-outline-danger me-1 mb-1" onclick="app.lsPrint(\'' + esc(no) + '\')">' +
                  '<i class="bi bi-printer"></i> ' + esc(no) + '</button>').join('') + '</div>';
      }
      say(html);
      app.loadLeaveSalary();
    };

    app.lsSettle = async function () {
      const items = app.lsItems(true);
      if (!items.length) return;
      const names = Object.keys(app.LSSEL).map(g => {
        const r = app.LSDATA.data.find(x => x.grantId === g); return r ? r.name : g;
      });
      if (!confirm('Mark these leaves as settled WITHOUT paying anything?\n\n' + names.join('\n') +
                   '\n\nUse this only when they were already paid some other way. It stops them showing as owed.')) return;
      try {
        const d = await postApi('payLeaveSalary', { items: items, by: adminEmail() });
        say(esc(d.message));
        app.LSSEL = {};
        app.loadLeaveSalary();
      } catch (err) { say(esc(err.message), true); }
    };

    app.lsSaveTicket = async function () {
      const el = document.getElementById('lsTicket');
      const v = Number(el && el.value);
      if (!(v >= 0)) { say('Ticket must be zero or more.', true); return; }
      try {
        const d = await postApi('setLeaveTicketAmount', { amount: v });
        app.LSTICKET = v;
        say(esc(d.message));
        app.renderLeaveSalary();
      } catch (err) { say(esc(err.message), true); }
    };

    // ── What has been paid already ──────────────────────────────────────
    app.loadLeaveSalaryHistory = async function () {
      const wrap = document.getElementById('lsHistWrap');
      if (!wrap) return;
      try {
        const d = await callApi('method=getLeaveSalaryHistory');
        if (!d.rows.length) { wrap.innerHTML = '<div class="text-muted small">No leave salary paid yet.</div>'; return; }
        wrap.innerHTML = '<div class="table-responsive"><table class="table table-sm align-middle">' +
          '<thead><tr><th>Voucher</th><th>Employee</th><th>Covers</th><th class="text-end">Days</th>' +
          '<th class="text-end">Deducted</th><th class="text-end">Ticket</th><th class="text-end">Net</th>' +
          '<th>Paid</th><th></th></tr></thead><tbody>' +
          d.rows.map(r => {
            const dead = String(r.status).toLowerCase() === 'cancelled';
            const settled = String(r.status).toLowerCase() === 'settled';
            return '<tr' + (dead ? ' class="table-light text-muted"' : '') + '>' +
              '<td class="small">' + esc(r.voucherNo) +
                (dead ? ' <span class="badge bg-secondary">cancelled</span>' : '') +
                (settled ? ' <span class="badge bg-dark">settled, not paid</span>' : '') + '</td>' +
              '<td class="small"><b>' + esc(r.name) + '</b><div class="text-muted small">' + esc(r.empId) + '</div></td>' +
              '<td class="small">' + esc(r.paidFrom) + ' → ' + esc(r.paidTo) + '</td>' +
              '<td class="text-end small">' + r.daysPaid + (r.lessDays ? ' <span class="text-muted">(−' + r.lessDays + ')</span>' : '') + '</td>' +
              '<td class="text-end small">' + (r.otherDeduction
                ? kd(r.otherDeduction) + (r.deductionNote ? '<div class="text-muted small">' + esc(r.deductionNote) + '</div>' : '')
                : '—') + '</td>' +
              '<td class="text-end small">' + (r.ticket ? kd(r.ticket) : '—') + '</td>' +
              '<td class="text-end"><b>' + kd(r.net) + '</b></td>' +
              '<td class="small">' + esc(r.paidOn) + '<div class="text-muted small">' + esc(r.paidBy) + '</div></td>' +
              '<td class="text-end text-nowrap">' +
                (dead ? '' :
                  '<button class="btn btn-outline-secondary btn-sm me-1" onclick="app.lsPrint(\'' + esc(r.voucherNo) + '\')" title="Print again"><i class="bi bi-printer"></i></button>' +
                  '<button class="btn btn-outline-danger btn-sm" onclick="app.lsCancel(\'' + esc(r.voucherNo) + '\')" title="Cancel this voucher">Cancel</button>') +
              '</td></tr>';
          }).join('') + '</tbody></table></div>';
      } catch (err) {
        wrap.innerHTML = '<div class="alert alert-danger py-1 mb-0">' + esc(err.message) + '</div>';
      }
    };

    // The window is opened on the click itself, before the wait, or the
    // browser treats it as a pop-up and blocks it.
    app.lsPrint = async function (voucherNo) {
      const w = window.open('', '_blank');
      if (w) { try { w.opener = null; } catch (e) {} }
      try {
        const d = await callApi('method=generateLeaveSalaryVoucher&voucherNo=' + encodeURIComponent(voucherNo));
        if (!d || !d.url) throw new Error('No voucher file came back.');
        if (w) w.location.href = d.url; else window.open(d.url, '_blank');
      } catch (err) {
        if (w) { try { w.close(); } catch (e) {} }
        alert(err.message);
      }
    };

    app.lsCancel = async function (voucherNo) {
      const why = prompt('Cancel ' + voucherNo + '.\n\nThe days go back to being owed. Reason:', '');
      if (why === null) return;
      try {
        const d = await postApi('cancelLeaveSalary', { voucherNo: voucherNo, by: adminEmail(), reason: why });
        say(esc(d.message));
        app.loadLeaveSalary();
      } catch (err) { say(esc(err.message), true); }
    };

    // How many men are owed leave salary, on the sidebar.
    app.refreshLeaveSalaryBadge = async function () {
      const b = document.getElementById('lsNavBadge');
      if (!b) return;
      try {
        const d = app.LSDATA || await callApi('method=getLeaveSalaryList');
        const n = Number(d.owing) || 0;
        if (n) { b.innerText = n; b.style.display = ''; } else { b.style.display = 'none'; }
      } catch (e) { b.style.display = 'none'; }
    };

    setTimeout(function () { app.refreshLeaveSalaryBadge(); }, 2000);
  })();
})();
