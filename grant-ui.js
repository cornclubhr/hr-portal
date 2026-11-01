// ============================================================
// grant-ui.js — Leave Management: request leave + the Leave Register
// ------------------------------------------------------------
// One line in index.html, AFTER leave-ui.js:
//   <script src="grant-ui.js"></script>
//
// TWO PAGES, ONE FILE:
//   Grant Leave     — the per-employee request matrix (unchanged in shape;
//                     the button now REQUESTS rather than approves).
//   Leave Register  — every leave ever recorded, in one place, with the
//                     approve / reject / cancel decisions on the row
//                     itself. This is the page that did not exist.
//
// Requesting leave no longer puts anyone on leave. It writes a PENDING
// APPROVAL row and holds the days against the balance. Nothing reaches
// attendance or payroll until somebody approves it in the register.
//
// Backend: getGrantMatrix, grantLeave, getLeaveRegister, approveLeaveGrant,
//          rejectLeaveGrant, cancelLeaveGrant, auditLeaveGrants,
//          previewLeaveApprovalMigration, commitLeaveApprovalMigration,
//          getLeaveStatusReminders, applyLeaveStatusChanges
// ============================================================

(function () {
  // The endpoint lives in config.js and nowhere else. /dev only ever answers
  // the script owner, so it is coerced to /exec the way api.js does.
  const execUrl = () => {
    const u = (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.API_URL) ? String(CONFIG.API_URL) : '';
    if (!u) throw new Error('config.js is missing — API_URL not set');
    return u.replace('/dev', '/exec');
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function toDdMmYyyy(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return d + '-' + m + '-' + y; }
  // The sheet keeps dd-mm-yyyy; <input type="date"> only speaks yyyy-mm-dd.
  function toIso(dd) {
    const m = String(dd || '').trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (!m) return '';
    return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
  }
  function daysBetween(isoA, isoB) {
    if (!isoA || !isoB) return 0;
    const n = Math.round((new Date(isoB) - new Date(isoA)) / 86400000) + 1;
    return n > 0 ? n : 0;
  }
  function adminEmail() { const el = document.getElementById('userEmail'); return el && el.innerText && el.innerText !== 'Loading...' ? el.innerText.trim() : 'Dashboard'; }

  async function callApi(qs) {
    // One auto-retry for Apps Script cold-start (transient 404/network).
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(execUrl() + '?' + qs + '&_=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const d = await res.json(); if (!d.success) throw new Error(d.error || 'Unknown error'); return d;
      } catch (e) { if (attempt === 1) throw e; await new Promise(r => setTimeout(r, 800)); }
    }
  }
  // Same POST, but a refusal comes back as data instead of an exception.
  // Amending needs that: the overlap guard answers with success:false AND an
  // overlaps list, and the user has to be able to see it and decide.
  async function postRaw(method, body) {
    const res = await fetch(execUrl() + '?method=' + method, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  }

  // Decisions go by POST: a bulk approve can carry more ids than a URL should.
  async function postApi(method, body) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(execUrl() + '?method=' + method, {
          method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const d = await res.json(); if (!d.success) throw new Error(d.error || 'Unknown error'); return d;
      } catch (e) { if (attempt === 1) throw e; await new Promise(r => setTimeout(r, 800)); }
    }
  }

  const STATUS_CLASS = {
    'pending approval': 'bg-warning text-dark',
    'approved':         'bg-success',
    'rejected':         'bg-danger',
    'cancelled':        'bg-secondary',
  };

  document.addEventListener('DOMContentLoaded', function () {
    const navList = document.querySelector('#sidebar ul.nav');

    // ── Grant Leave nav + page (only if index.html has not pre-baked it) ──
    if (navList && !document.querySelector('[data-page="grantleave"]')) {
      const li = document.createElement('li');
      li.className = 'nav-item';
      li.innerHTML = '<a class="nav-link" data-page="grantleave"><i class="bi bi-calendar-plus"></i> Grant Leave</a>';
      const bal = document.querySelector('[data-page="leavebal"]');
      if (bal && bal.closest('li')) bal.closest('li').insertAdjacentElement('afterend', li);
      else navList.appendChild(li);
      li.querySelector('.nav-link').addEventListener('click', function (e) {
        e.preventDefault(); showPage(this, 'grantleave', 'Grant Leave');
        if (app.loadGrantPage) app.loadGrantPage();
      });
    }

    // ── Leave Register nav + page (always injected — it is new) ──────────
    if (navList && !document.querySelector('[data-page="leaveregister"]')) {
      const li = document.createElement('li');
      li.className = 'nav-item';
      li.innerHTML = '<a class="nav-link" data-page="leaveregister" title="Leave Register">' +
                     '<i class="bi bi-journal-text"></i> Leave Register' +
                     '<span id="lrNavBadge" class="badge bg-warning text-dark ms-1" style="display:none"></span></a>';
      const gl = document.querySelector('[data-page="grantleave"]');
      if (gl && gl.closest('li')) gl.closest('li').insertAdjacentElement('afterend', li);
      else navList.appendChild(li);
      li.querySelector('.nav-link').addEventListener('click', function (e) {
        e.preventDefault(); showPage(this, 'leaveregister', 'Leave Register');
        if (app.loadLeaveRegister) app.loadLeaveRegister();
      });
    }

    // index.html's delegated handler bails on an unknown page id, so tell it
    // about this one — otherwise the header title goes stale on the way in.
    try {
      if (typeof PAGE_META === 'object' && PAGE_META && !PAGE_META.leaveregister) {
        PAGE_META.leaveregister = { title: 'Leave Register', group: 'Admin' };
      }
    } catch (e) { /* PAGE_META not in scope — our own handler covers it */ }

    function showPage(link, pid, title) {
      document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
      const pg = document.getElementById('page-' + pid);
      if (pg) pg.classList.add('active');
      const t = document.getElementById('pageTitle'); if (t) t.innerText = title;
      const g = document.getElementById('pageGroup'); if (g) g.innerText = 'Admin';
    }

    const anchor = document.getElementById('page-dashboard');
    if (!anchor || !anchor.parentElement) return;

    // ── Grant Leave page body ───────────────────────────────────────────
    if (!document.getElementById('page-grantleave')) {
      const s = document.createElement('div');
      s.className = 'page-section'; s.id = 'page-grantleave';
      s.innerHTML =
        '<div id="reactivateWrap"></div>' +
        '<div class="table-container mb-4">' +
          '<div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">' +
            '<h5><i class="bi bi-calendar-plus"></i> Request Leave</h5>' +
            '<div class="d-flex gap-2">' +
              '<input type="text" id="grantSearch" class="form-control form-control-sm" style="width:200px" placeholder="Search name / ID">' +
              '<button class="btn btn-warning btn-sm" onclick="app.applyStatusNow()" title="Flip anyone currently on approved leave to On Leave, and list those to reactivate"><i class="bi bi-lightning-charge"></i> Apply Status Changes Now</button>' +
              '<button class="btn btn-outline-secondary btn-sm" onclick="app.loadGrantPage()"><i class="bi bi-arrow-repeat"></i> Refresh</button>' +
            '</div>' +
          '</div>' +
          '<p class="text-muted small mb-3">Requests go to the <b>Leave Register</b> as ' +
            '<span class="badge bg-warning text-dark">Pending Approval</span>. The days are held against ' +
            'the balance straight away, but nothing reaches attendance or payroll until somebody approves it.</p>' +
          '<div id="grantTableWrap" class="table-responsive"><div class="text-muted small">Loading…</div></div>' +
        '</div>';
      anchor.parentElement.appendChild(s);
      const se = s.querySelector('#grantSearch');
      if (se) se.addEventListener('input', function () { app.renderGrantTable(this.value.trim().toLowerCase()); });
    } else {
      // index.html pre-baked the page — just correct the wording in place.
      const h = document.querySelector('#page-grantleave h5');
      if (h && /Grant Leave/i.test(h.innerText)) h.innerHTML = '<i class="bi bi-calendar-plus"></i> Request Leave';
      const wrap = document.getElementById('grantTableWrap');
      if (wrap && !document.getElementById('grantPendingNote')) {
        const p = document.createElement('p');
        p.id = 'grantPendingNote'; p.className = 'text-muted small mb-3';
        p.innerHTML = 'Requests go to the <b>Leave Register</b> as ' +
          '<span class="badge bg-warning text-dark">Pending Approval</span>. The days are held against ' +
          'the balance straight away, but nothing reaches attendance or payroll until somebody approves it.';
        wrap.parentElement.insertBefore(p, wrap);
      }
      const se = document.getElementById('grantSearch');
      if (se && !se.dataset.wired) {
        se.dataset.wired = '1';
        se.addEventListener('input', function () { app.renderGrantTable(this.value.trim().toLowerCase()); });
      }
    }

    // ── Leave Register page body ────────────────────────────────────────
    if (!document.getElementById('page-leaveregister')) {
      const s = document.createElement('div');
      s.className = 'page-section'; s.id = 'page-leaveregister';
      s.innerHTML =
        '<div id="lrAuditWrap"></div>' +
        '<div id="lrMigrateWrap"></div>' +
        '<div class="table-container">' +
          '<div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">' +
            '<h5><i class="bi bi-journal-text"></i> Leave Register</h5>' +
            '<div class="d-flex gap-2 flex-wrap">' +
              '<input type="text" id="lrSearch" class="form-control form-control-sm" style="width:190px" placeholder="Search name / ID">' +
              '<select id="lrType" class="form-select form-select-sm" style="width:150px"><option value="">All types</option></select>' +
              '<button class="btn btn-outline-secondary btn-sm" onclick="app.loadLeaveRegister()"><i class="bi bi-arrow-repeat"></i> Refresh</button>' +
            '</div>' +
          '</div>' +
          '<div id="lrChips" class="mb-2"></div>' +
          '<div id="lrBulk" class="mb-2"></div>' +
          '<div id="lrTableWrap" class="table-responsive"><div class="text-muted small">Loading…</div></div>' +
        '</div>';
      anchor.parentElement.appendChild(s);
      const se = s.querySelector('#lrSearch');
      if (se) se.addEventListener('input', function () { app.LRQ = this.value.trim().toLowerCase(); app.renderLeaveRegister(); });
      const ty = s.querySelector('#lrType');
      if (ty) ty.addEventListener('change', function () { app.LRTYPE = this.value; app.renderLeaveRegister(); });
    }
  });

  (function attach() {
    if (typeof app === 'undefined') return setTimeout(attach, 50);

    app.GMATRIX = null;
    app.LREG = null;          // the register payload
    app.LRSTATUS = '';        // active status filter
    app.LRQ = '';             // search text
    app.LRTYPE = '';          // type filter
    app.LRSEL = {};           // ticked grant ids
    app.LREDIT = null;        // grant id currently open for editing

    // ══════════════════ Request Leave ══════════════════
    app.loadGrantPage = async function () {
      const wrap = document.getElementById('grantTableWrap');
      if (!wrap) return;
      wrap.innerHTML = '<div class="text-muted small">Loading…</div>';
      try {
        const d = await callApi('method=getGrantMatrix');
        app.GMATRIX = d;
        app.renderGrantTable('');
      } catch (err) { wrap.innerHTML = '<div class="alert alert-danger mb-0">' + esc(err.message) + '</div>'; }
      app.loadReactivateReminders();
      app.refreshPendingBadge();
    };

    app.balFor = function (empId, type) {
      const b = app.GMATRIX && app.GMATRIX.balances[empId];
      if (!b) return null;
      const v = b[String(type).toLowerCase()];
      return (v === undefined) ? null : v;
    };

    app.renderGrantTable = function (q) {
      const wrap = document.getElementById('grantTableWrap');
      const M = app.GMATRIX;
      if (!wrap) return;
      if (!M) { wrap.innerHTML = '<div class="text-muted small">No data.</div>'; return; }
      let emps = M.employees;
      if (q) emps = emps.filter(r => (r.name || '').toLowerCase().includes(q) || (r.id || '').toLowerCase().includes(q));
      if (!emps.length) { wrap.innerHTML = '<div class="text-muted small">No employees.</div>'; return; }
      const typeOpts = M.types.map(t => '<option>' + esc(t.type) + '</option>').join('');
      const today = new Date().toISOString().split('T')[0];

      const body = emps.map(r => {
        const badge = String(r.status).toLowerCase() === 'on leave' ? '<span class="badge bg-info text-dark">On Leave</span>'
                    : String(r.status).toLowerCase() === 'inactive' ? '<span class="badge bg-secondary">Inactive</span>'
                    : '<span class="badge bg-success">Active</span>';
        const firstType = M.types.length ? M.types[0].type : 'Annual';
        const bal = app.balFor(r.id, firstType);
        const balHtml = bal === null ? '<span class="text-warning">not allocated</span>' : (bal < 0 ? '<b class="text-danger">' + bal + '</b>' : '<b>' + bal + '</b>');
        return '<tr data-emp="' + esc(r.id) + '">' +
          '<td>' + esc(r.id) + '</td><td>' + esc(r.name) + '</td><td>' + badge + '</td>' +
          '<td><select class="form-select form-select-sm gv-type" style="min-width:130px" onchange="app.onTypeChange(\'' + esc(r.id) + '\')">' + typeOpts + '</select></td>' +
          '<td class="text-end gv-bal" style="min-width:90px">' + balHtml + '</td>' +
          '<td><input type="date" class="form-control form-control-sm gv-start" value="' + today + '" style="min-width:140px"></td>' +
          '<td><input type="date" class="form-control form-control-sm gv-end" value="' + today + '" style="min-width:140px"></td>' +
          '<td class="text-end gv-days">1</td>' +
          '<td class="text-end"><button class="btn btn-primary btn-sm" onclick="app.grantRow(\'' + esc(r.id) + '\')"><i class="bi bi-send"></i> Request</button></td>' +
          '</tr>';
      }).join('');
      wrap.innerHTML = '<table class="table table-sm table-striped align-middle"><thead><tr>' +
        '<th>ID</th><th>Name</th><th>Status</th><th>Leave Type</th><th class="text-end">Balance</th><th>Start</th><th>End</th><th class="text-end">Days</th><th></th>' +
        '</tr></thead><tbody>' + body + '</tbody></table>';

      wrap.querySelectorAll('tr[data-emp]').forEach(tr => {
        const s = tr.querySelector('.gv-start'), e = tr.querySelector('.gv-end'), dd = tr.querySelector('.gv-days');
        const calc = () => { const a = s.value, b = e.value; if (a && b) { const n = Math.round((new Date(b) - new Date(a)) / 86400000) + 1; dd.innerText = n > 0 ? n : '—'; } };
        s.addEventListener('change', calc); e.addEventListener('change', calc);
      });
    };

    app.onTypeChange = function (empId) {
      const tr = document.querySelector('tr[data-emp="' + empId + '"]');
      if (!tr) return;
      const type = tr.querySelector('.gv-type').value;
      const bal = app.balFor(empId, type);
      tr.querySelector('.gv-bal').innerHTML = bal === null ? '<span class="text-warning">not allocated</span>' : (bal < 0 ? '<b class="text-danger">' + bal + '</b>' : '<b>' + bal + '</b>');
    };

    app.grantRow = async function (empId) {
      const tr = document.querySelector('tr[data-emp="' + empId + '"]');
      if (!tr) return;
      const type = tr.querySelector('.gv-type').value;
      const start = tr.querySelector('.gv-start').value;
      const end = tr.querySelector('.gv-end').value;
      const btn = tr.querySelector('button');
      if (!start || !end) { alert('Start and end dates required.'); return; }
      if (new Date(end) < new Date(start)) { alert('End is before start.'); return; }
      const bal = app.balFor(empId, type);
      if (bal === null) { if (!confirm(type + ' is not allocated to this employee. Allocate it first (Leave Allocation), or continue anyway?')) return; }
      const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
      try {
        const qs = 'method=grantLeave&empId=' + encodeURIComponent(empId) + '&type=' + encodeURIComponent(type) +
          '&start=' + encodeURIComponent(toDdMmYyyy(start)) + '&end=' + encodeURIComponent(toDdMmYyyy(end)) +
          '&by=' + encodeURIComponent(adminEmail());
        const d = await callApi(qs);
        btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Pending';
        btn.className = 'btn btn-warning btn-sm';
        if (d.negative) alert(d.message);
        setTimeout(() => app.loadGrantPage(), 1200);
      } catch (err) {
        // The overlap guard comes back as a plain refusal — show it, do not swallow it.
        alert(err.message);
        btn.disabled = false; btn.innerHTML = orig;
      }
    };

    app.loadReactivateReminders = async function () {
      const wrap = document.getElementById('reactivateWrap');
      if (!wrap) return;
      try {
        const d = await callApi('method=getLeaveStatusReminders');
        if (d.toReactivate && d.toReactivate.length) {
          wrap.innerHTML = '<div class="alert alert-warning"><b><i class="bi bi-bell"></i> Leave ended — reactivate:</b> ' +
            d.toReactivate.map(r => esc(r.name) + ' (' + esc(r.id) + ')').join(', ') +
            '. <span class="text-muted small">Set their Status back to Active on the employee page.</span></div>';
        } else { wrap.innerHTML = ''; }
      } catch (e) { wrap.innerHTML = ''; }
    };

    app.applyStatusNow = async function () {
      try {
        const d = await callApi('method=applyLeaveStatusChanges&by=' + encodeURIComponent(adminEmail()));
        alert(d.message);
        app.loadGrantPage();
      } catch (err) { alert(err.message); }
    };

    // ══════════════════ Leave Register ══════════════════
    app.loadLeaveRegister = async function () {
      const wrap = document.getElementById('lrTableWrap');
      if (!wrap) return;
      wrap.innerHTML = '<div class="text-muted small">Loading…</div>';
      app.LRSEL = {}; app.LREDIT = null;
      try {
        app.LREG = await callApi('method=getLeaveRegister');
        app.renderLeaveTypeFilter();
        app.renderLeaveRegister();
        app.refreshPendingBadge();
      } catch (err) { wrap.innerHTML = '<div class="alert alert-danger mb-0">' + esc(err.message) + '</div>'; }
      app.loadLeaveAudit();
      app.loadMigrationCard();
    };

    app.renderLeaveTypeFilter = function () {
      const sel = document.getElementById('lrType');
      if (!sel || !app.LREG) return;
      const types = {};
      app.LREG.data.forEach(r => { if (r.type) types[r.type] = true; });
      const cur = sel.value;
      sel.innerHTML = '<option value="">All types</option>' +
        Object.keys(types).sort().map(t => '<option' + (t === cur ? ' selected' : '') + '>' + esc(t) + '</option>').join('');
    };

    app.lrFilter = function (status) {
      app.LRSTATUS = (app.LRSTATUS === status) ? '' : status;
      app.renderLeaveRegister();
    };

    app.lrRows = function () {
      if (!app.LREG) return [];
      return app.LREG.data.filter(r => {
        if (app.LRSTATUS && String(r.status).toLowerCase() !== app.LRSTATUS) return false;
        if (app.LRTYPE && r.type !== app.LRTYPE) return false;
        if (app.LRQ && !((r.name || '').toLowerCase().includes(app.LRQ) || (r.empId || '').toLowerCase().includes(app.LRQ))) return false;
        return true;
      });
    };

    app.renderLeaveRegister = function () {
      const wrap = document.getElementById('lrTableWrap');
      const chips = document.getElementById('lrChips');
      if (!wrap || !app.LREG) return;
      const c = app.LREG.counts || {};

      if (chips) {
        const chip = (label, key, cls, n) =>
          '<span class="badge ' + cls + ' me-1" style="cursor:pointer;' +
          (app.LRSTATUS === key ? 'outline:2px solid #0d6efd;outline-offset:2px' : '') + '" ' +
          'onclick="app.lrFilter(\'' + key + '\')">' + label + ' ' + (n || 0) + '</span>';
        chips.innerHTML =
          '<span class="badge bg-dark me-1" style="cursor:pointer" onclick="app.lrFilter(\'\')">All ' + app.LREG.total + '</span>' +
          chip('Pending approval', 'pending approval', 'bg-warning text-dark', c.pending) +
          chip('Approved', 'approved', 'bg-success', c.approved) +
          chip('Rejected', 'rejected', 'bg-danger', c.rejected) +
          chip('Cancelled', 'cancelled', 'bg-secondary', c.cancelled) +
          (c.other ? chip('Unknown status', 'x-unknown', 'bg-danger', c.other) : '');
      }

      const rows = app.lrRows();
      if (!rows.length) {
        wrap.innerHTML = '<div class="text-muted small">Nothing matches this filter.</div>';
        app.renderBulkBar(); return;
      }

      const body = rows.map(r => {
        const st = String(r.status).toLowerCase();
        if (app.LREDIT === r.grantId) return editRowHtml(r, st);
        const cls = STATUS_CLASS[st] || 'bg-danger';
        const when = r.inProgress ? ' <span class="badge bg-info text-dark">in progress</span>'
                   : r.startsInFuture ? ' <span class="text-muted small">upcoming</span>' : '';
        const pay = r.isPaid ? '' : ' <span class="badge bg-dark" title="Unpaid — this will be deducted">unpaid</span>';
        const acts = [];
        if (r.canApprove) acts.push('<button class="btn btn-success btn-sm me-1" onclick="app.lrDecide(\'approve\',\'' + esc(r.grantId) + '\')"><i class="bi bi-check2"></i> Approve</button>');
        if (r.canReject)  acts.push('<button class="btn btn-outline-danger btn-sm me-1" onclick="app.lrDecide(\'reject\',\'' + esc(r.grantId) + '\')">Reject</button>');
        if (r.canCancel && st === 'approved') acts.push('<button class="btn btn-outline-secondary btn-sm me-1" onclick="app.lrDecide(\'cancel\',\'' + esc(r.grantId) + '\')">Cancel</button>');
        // Dates change after the fact — a flight moves, a man comes back
        // early. Editable while the leave is live, which includes Approved.
        if (st === 'pending approval' || st === 'approved') {
          acts.push('<button class="btn btn-outline-primary btn-sm" title="Change the dates or the type" ' +
            'onclick="app.lrEdit(\'' + esc(r.grantId) + '\')"><i class="bi bi-pencil"></i> Edit</button>');
        }
        const tick = r.canApprove
          ? '<input type="checkbox" class="form-check-input lr-tick" data-gid="' + esc(r.grantId) + '"' + (app.LRSEL[r.grantId] ? ' checked' : '') + '>'
          : '';
        const decided = r.decidedBy
          ? '<span class="text-muted small">' + esc(r.decidedBy) + (r.decidedOn ? '<br>' + esc(r.decidedOn) : '') + '</span>' : '';
        return '<tr>' +
          '<td>' + tick + '</td>' +
          '<td><b>' + esc(r.name) + '</b><br><span class="text-muted small">' + esc(r.empId) + '</span></td>' +
          '<td>' + esc(r.type) + pay + '</td>' +
          '<td style="white-space:nowrap">' + esc(r.start) + ' → ' + esc(r.end) + when + '</td>' +
          '<td class="text-end">' + esc(r.days) + '</td>' +
          '<td><span class="badge ' + cls + '">' + esc(r.status) + '</span></td>' +
          '<td><span class="text-muted small">' + esc(r.grantedBy) + (r.grantedOn ? '<br>' + esc(r.grantedOn) : '') + '</span></td>' +
          '<td>' + decided + '</td>' +
          '<td class="text-end" style="white-space:nowrap">' + acts.join('') + '</td>' +
          '</tr>';
      }).join('');

      wrap.innerHTML = '<table class="table table-sm table-striped align-middle"><thead><tr>' +
        '<th style="width:28px"></th><th>Employee</th><th>Type</th><th>Dates</th><th class="text-end">Days</th>' +
        '<th>Status</th><th>Requested by</th><th>Decided by</th><th></th>' +
        '</tr></thead><tbody>' + body + '</tbody></table>';

      wrap.querySelectorAll('.lr-tick').forEach(cb => cb.addEventListener('change', function () {
        if (this.checked) app.LRSEL[this.dataset.gid] = true; else delete app.LRSEL[this.dataset.gid];
        app.renderBulkBar();
      }));

      // Live day count while the dates are being changed, so nobody has to
      // count on their fingers before saving.
      const ed = wrap.querySelector('tr.lr-editing');
      if (ed) {
        const s = ed.querySelector('.lre-start'), e = ed.querySelector('.lre-end'), d = ed.querySelector('.lre-days');
        const calc = () => { const n = daysBetween(s.value, e.value); d.innerHTML = n ? '<b>' + n + '</b>' : '<span class="text-danger">—</span>'; };
        s.addEventListener('change', calc); e.addEventListener('change', calc);
        setTimeout(() => { try { s.focus(); } catch (x) {} }, 0);
      }
      app.renderBulkBar();
    };

    // ── Amending a leave that is already on the books ────────────────────
    // The row turns into its own little form: type is a dropdown, the dates
    // are real date pickers, the day count follows along. Saving moves only
    // the difference in balance and rebuilds attendance across both the old
    // and the new range, so a shortened leave gives the days back and the
    // days it no longer covers stop being leave.
    function editRowHtml(r, st) {
      const types = (app.LREG && app.LREG.data ? app.LREG.data : []).reduce((a, x) => { if (x.type) a[x.type] = true; return a; }, {});
      types[r.type] = true;
      const typeOpts = Object.keys(types).sort()
        .map(t => '<option' + (t === r.type ? ' selected' : '') + '>' + esc(t) + '</option>').join('');
      const cls = STATUS_CLASS[st] || 'bg-danger';
      return '<tr class="lr-editing table-warning" data-gid="' + esc(r.grantId) + '">' +
        '<td></td>' +
        '<td><b>' + esc(r.name) + '</b><br><span class="text-muted small">' + esc(r.empId) + '</span></td>' +
        '<td><select class="form-select form-select-sm lre-type" style="min-width:130px">' + typeOpts + '</select></td>' +
        '<td style="white-space:nowrap">' +
          '<input type="date" class="form-control form-control-sm lre-start mb-1" value="' + esc(toIso(r.start)) + '" style="min-width:140px">' +
          '<input type="date" class="form-control form-control-sm lre-end" value="' + esc(toIso(r.end)) + '" style="min-width:140px">' +
        '</td>' +
        '<td class="text-end lre-days"><b>' + esc(r.days) + '</b></td>' +
        '<td><span class="badge ' + cls + '">' + esc(r.status) + '</span></td>' +
        '<td colspan="2" class="small text-muted">' +
          (st === 'approved'
            ? 'Approved leave. Saving rewrites the attendance rows for the old dates and the new ones, and moves only the difference in balance.'
            : 'Still pending. Saving only changes the request.') +
        '</td>' +
        '<td class="text-end" style="white-space:nowrap">' +
          '<button class="btn btn-primary btn-sm me-1" onclick="app.lrSaveEdit(\'' + esc(r.grantId) + '\')"><i class="bi bi-check2"></i> Save</button>' +
          '<button class="btn btn-link btn-sm" onclick="app.lrCancelEdit()">Cancel</button>' +
        '</td>' +
        '</tr>';
    }

    app.lrEdit = function (grantId) { app.LREDIT = grantId; app.renderLeaveRegister(); };
    app.lrCancelEdit = function () { app.LREDIT = null; app.renderLeaveRegister(); };

    app.lrSaveEdit = async function (grantId) {
      const tr = document.querySelector('tr.lr-editing[data-gid="' + grantId + '"]');
      if (!tr) return;
      const r = (app.LREG.data.find(x => x.grantId === grantId)) || {};
      const type = tr.querySelector('.lre-type').value;
      const startIso = tr.querySelector('.lre-start').value;
      const endIso = tr.querySelector('.lre-end').value;
      if (!startIso || !endIso) { alert('Both dates are needed.'); return; }
      if (new Date(endIso) < new Date(startIso)) { alert('End date is before the start date.'); return; }
      const days = daysBetween(startIso, endIso);
      const unchanged = (type === r.type) && (toIso(r.start) === startIso) && (toIso(r.end) === endIso);
      if (unchanged) { app.lrCancelEdit(); return; }

      const what = r.name + ': ' + r.type + ' ' + r.start + ' → ' + r.end + ' (' + r.days + ' days)\n' +
                   'becomes ' + type + ' ' + toDdMmYyyy(startIso) + ' → ' + toDdMmYyyy(endIso) + ' (' + days + ' days)';
      if (!confirm(what + '\n\nSave this change?')) return;
      const note = prompt('Why is it changing? (recorded against the leave)', '');
      if (note === null) return;

      const btn = tr.querySelector('button');
      btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
      const body = { grantId: grantId, type: type, start: toDdMmYyyy(startIso), end: toDdMmYyyy(endIso),
                     by: adminEmail(), note: note };
      try {
        let d = await postRaw('amendLeaveGrant', body);
        // The overlap guard is a refusal with the clashing leaves attached.
        // Show them and let the decision be made, rather than hiding it.
        if (!d.success && d.overlaps && d.overlaps.length) {
          if (confirm(d.error + '\n\nSave it anyway?')) {
            body.force = true;
            d = await postRaw('amendLeaveGrant', body);
          } else {
            btn.disabled = false; btn.innerHTML = '<i class="bi bi-check2"></i> Save'; return;
          }
        }
        if (!d.success) throw new Error(d.error || 'Unknown error');
        app.LREDIT = null;
        alert(d.message);
        app.loadLeaveRegister();
      } catch (err) {
        alert(err.message);
        btn.disabled = false; btn.innerHTML = '<i class="bi bi-check2"></i> Save';
      }
    };

    app.renderBulkBar = function () {
      const bar = document.getElementById('lrBulk');
      if (!bar) return;
      const n = Object.keys(app.LRSEL).length;
      const pendingShown = app.lrRows().filter(r => r.canApprove).length;
      if (!pendingShown) { bar.innerHTML = ''; return; }
      bar.innerHTML =
        '<div class="d-flex align-items-center gap-2 flex-wrap">' +
          '<button class="btn btn-outline-secondary btn-sm" onclick="app.lrSelectAll()">Select all ' + pendingShown + ' pending</button>' +
          (n ? '<button class="btn btn-success btn-sm" onclick="app.lrDecideSelected(\'approve\')"><i class="bi bi-check2-all"></i> Approve ' + n + '</button>' +
               '<button class="btn btn-outline-danger btn-sm" onclick="app.lrDecideSelected(\'reject\')">Reject ' + n + '</button>' +
               '<button class="btn btn-link btn-sm" onclick="app.lrClearSel()">clear</button>'
             : '<span class="text-muted small">Tick rows to approve or reject several at once.</span>') +
        '</div>';
    };
    app.lrSelectAll = function () { app.lrRows().filter(r => r.canApprove).forEach(r => app.LRSEL[r.grantId] = true); app.renderLeaveRegister(); };
    app.lrClearSel = function () { app.LRSEL = {}; app.renderLeaveRegister(); };

    app.lrDecide = async function (action, grantId) {
      const r = app.LREG.data.find(x => x.grantId === grantId) || {};
      const verb = action === 'approve' ? 'Approve' : action === 'reject' ? 'Reject' : 'Cancel';
      let note = '';
      if (action === 'reject' || action === 'cancel') {
        note = prompt(verb + ' ' + r.days + ' day(s) of ' + r.type + ' for ' + r.name + '.\n\nReason (recorded against the leave):', '');
        if (note === null) return;
      } else if (!confirm('Approve ' + r.days + ' day(s) of ' + r.type + ' for ' + r.name + ' (' + r.start + ' → ' + r.end + ')?\n\nThis puts it on the attendance sheet and into payroll.')) {
        return;
      }
      try {
        const d = await postApi(action + 'LeaveGrant', { grantId: grantId, by: adminEmail(), note: note });
        alert(d.message);
        app.loadLeaveRegister();
      } catch (err) { alert(err.message); }
    };

    app.lrDecideSelected = async function (action) {
      const ids = Object.keys(app.LRSEL);
      if (!ids.length) return;
      const verb = action === 'approve' ? 'Approve' : 'Reject';
      let note = '';
      if (action === 'reject') {
        note = prompt('Reject ' + ids.length + ' request(s).\n\nReason (recorded against each):', '');
        if (note === null) return;
      } else if (!confirm(verb + ' ' + ids.length + ' leave request(s)?\n\nThis puts them on the attendance sheet and into payroll.')) {
        return;
      }
      try {
        const d = await postApi(action + 'LeaveGrant', { grantIds: ids, by: adminEmail(), note: note });
        let m = d.message;
        if (d.skipped && d.skipped.length) m += '\n\nSkipped:\n' + d.skipped.join('\n');
        alert(m);
        app.loadLeaveRegister();
      } catch (err) { alert(err.message); }
    };

    // ── Audit banner ────────────────────────────────────────────────────
    app.loadLeaveAudit = async function () {
      const wrap = document.getElementById('lrAuditWrap');
      if (!wrap) return;
      try {
        const d = await callApi('method=auditLeaveGrants');
        if (!d.problems || !d.problems.length) { wrap.innerHTML = ''; return; }
        const rows = d.problems.map(p =>
          '<li><b>' + esc(p.name) + '</b> — ' + esc(p.problem) +
          '<br><span class="text-muted small">' + esc(p.why) + '</span>' +
          (p.grantId ? ' <span class="text-muted small">(' + esc(p.grantId) + ')</span>' : '') + '</li>').join('');
        wrap.innerHTML =
          '<div class="alert ' + (d.high ? 'alert-danger' : 'alert-warning') + '">' +
            '<b><i class="bi bi-exclamation-triangle"></i> ' + esc(d.message) + '</b>' +
            '<ul class="mb-0 mt-2 small">' + rows + '</ul>' +
            '<div class="small mt-2">Fix these in the Leave_Grants tab, then press Refresh. ' +
            'Rows edited by hand do not update attendance on their own.</div>' +
          '</div>';
      } catch (e) { wrap.innerHTML = ''; }
    };

    // ── One-off migration card ──────────────────────────────────────────
    // Only appears while there is something to migrate. It disappears by
    // itself once the queue is empty, so nobody runs it twice by accident.
    app.loadMigrationCard = async function () {
      const wrap = document.getElementById('lrMigrateWrap');
      if (!wrap) return;
      try {
        const d = await callApi('method=previewLeaveApprovalMigration');
        if (!d.count) { wrap.innerHTML = ''; return; }
        const list = d.willChange.map(w =>
          '<li>' + esc(w.name) + ' — ' + esc(w.type) + ' ' + esc(w.start) + ' → ' + esc(w.end) +
          ' (' + esc(w.days) + ' days, requested by ' + esc(w.grantedBy) + ')</li>').join('');
        wrap.innerHTML =
          '<div class="alert alert-info">' +
            '<b><i class="bi bi-hourglass-split"></i> ' + d.count + ' future-dated leave(s) were auto-approved before the approval step existed.</b>' +
            '<ul class="mb-2 mt-2 small">' + list + '</ul>' +
            '<div class="small mb-2">Moving these to <b>Pending Approval</b> changes no balances and no attendance — ' +
            'they start in the future, so there are no attendance rows for them yet. ' +
            'Leave already running or finished is left alone.</div>' +
            '<button class="btn btn-primary btn-sm" onclick="app.runLeaveMigration()">' +
            'Move ' + d.count + ' to Pending Approval</button>' +
          '</div>';
      } catch (e) { wrap.innerHTML = ''; }
    };

    app.runLeaveMigration = async function () {
      if (!confirm('Move every future-dated annual leave to Pending Approval?\n\nNo balances move and no attendance changes. They will appear in the pending queue for approval.')) return;
      try {
        const d = await postApi('commitLeaveApprovalMigration', { by: adminEmail() });
        alert(d.message);
        app.loadLeaveRegister();
      } catch (err) { alert(err.message); }
    };

    // Pending count on the sidebar, so a queue is never invisible.
    app.refreshPendingBadge = async function () {
      const b = document.getElementById('lrNavBadge');
      if (!b) return;
      try {
        const d = app.LREG || await callApi('method=getLeaveRegister');
        const n = (d.counts && d.counts.pending) || 0;
        if (n) { b.innerText = n; b.style.display = ''; } else { b.style.display = 'none'; }
      } catch (e) { b.style.display = 'none'; }
    };

    // Load the badge once at start-up so a pending queue is visible from
    // whatever page the user happens to land on.
    setTimeout(function () { app.refreshPendingBadge(); }, 1500);
  })();
})();
