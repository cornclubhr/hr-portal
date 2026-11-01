// ============================================================
// ot-review-ui.js — OT Review: verify attendance-computed OT,
// post to OT_Entries.
// All hour values display and input as "Xh Ym" not decimal.
// ============================================================

(function () {
  const EXEC_URL = CONFIG.API_URL;
  let DRAFT = null;

  function todayIso() { return new Date().toISOString().split('T')[0]; }
  function toDd(iso)  { if (!iso) return ''; const [y,m,d] = iso.split('-'); return d+'-'+m+'-'+y; }
  function adminEmail() {
    const el = document.getElementById('userEmail');
    return el && el.innerText && el.innerText !== 'Loading...' ? el.innerText.trim() : 'Compiler';
  }

  // ── Decimal hours → "Xh Ym" ────────────────────────────────────────
  function toHM(h) {
    if (h == null || h === '' || isNaN(Number(h))) return '—';
    h = Number(h);
    if (h === 0) return '0h';
    const neg = h < 0;
    h = Math.abs(h);
    const hrs = Math.floor(h);
    const min = Math.round((h - hrs) * 60);
    let s = (hrs > 0 ? hrs + 'h' : '') + (min > 0 ? (hrs > 0 ? ' ' : '') + min + 'm' : '');
    return (neg ? '-' : '') + (s || '0h');
  }

  // ── Decimal → { h, m } for populating H+M inputs ─────────────────
  function decToHM(dec) {
    dec = Math.max(0, Number(dec) || 0);
    return { h: Math.floor(dec), m: Math.round((dec - Math.floor(dec)) * 60) };
  }

  // ── Read H+M inputs → decimal hours ──────────────────────────────
  function hmToDec(hEl, mEl) {
    const h = parseInt(hEl ? hEl.value : 0) || 0;
    const m = parseInt(mEl ? mEl.value : 0) || 0;
    return h + m / 60;
  }

  // ── Render a compact H+M input pair ──────────────────────────────
  function hmInputs(dec, clsH, clsM, w) {
    const { h, m } = decToHM(dec);
    w = w || '50px';
    return '<div class="d-flex align-items-center gap-1">' +
      '<input type="number" class="form-control form-control-sm ' + clsH + '" ' +
        'min="0" max="99" value="' + h + '" style="width:' + w + ';text-align:center">' +
      '<span class="text-muted small">h</span>' +
      '<input type="number" class="form-control form-control-sm ' + clsM + '" ' +
        'min="0" max="59" value="' + m + '" style="width:' + w + ';text-align:center">' +
      '<span class="text-muted small">m</span>' +
    '</div>';
  }

  // ── Format computedOt string from backend ─────────────────────────
  function fmtComputed(raw) {
    if (!raw || raw === '—') return '—';
    if (/incomplete|no punch/i.test(raw)) {
      return '<span class="text-warning small">' + raw + '</span>';
    }
    const m = raw.match(/([\d.]+)h\s*\(presence\s*([\d.]+)h\)/);
    if (m) return toHM(m[1]) + ' <span class="text-muted small">(presence ' + toHM(m[2]) + ')</span>';
    const n = raw.match(/([\d.]+)h?/);
    if (n) return toHM(n[1]);
    return raw;
  }

  async function callApi(qs) {
    const res = await fetch(EXEC_URL + '?' + qs + '&_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    if (!d.success) throw new Error(d.error || 'Unknown error');
    return d;
  }
  async function callPost(method, body) {
    const res = await fetch(EXEC_URL + '?method=' + method, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    if (!d.success) throw new Error(d.error || 'Unknown error');
    return d;
  }

  document.addEventListener('DOMContentLoaded', function () {
    const navList = document.querySelector('#sidebar ul.nav');
    if (navList && !document.querySelector('[data-page="otreview"]')) {
      const li = document.createElement('li'); li.className = 'nav-item';
      li.innerHTML = '<a class="nav-link" data-page="otreview"><i class="bi bi-clipboard-check"></i> OT Review</a>';
      const ot = document.querySelector('[data-page="overtime"]') || document.querySelector('[data-page="attendance"]');
      if (ot && ot.closest('li')) ot.closest('li').insertAdjacentElement('afterend', li);
      else navList.appendChild(li);
      li.querySelector('.nav-link').addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        const pg = document.getElementById('page-otreview'); if (pg) pg.classList.add('active');
        document.getElementById('pageTitle').innerText = 'OT Review';
      });
    }

    const anchor = document.getElementById('page-dashboard');
    if (anchor && anchor.parentElement && !document.getElementById('page-otreview')) {
      const s = document.createElement('div'); s.className = 'page-section'; s.id = 'page-otreview';
      s.innerHTML =
        '<div class="table-container mb-3">' +
          '<h5 class="mb-1"><i class="bi bi-patch-check"></i> OT Verification</h5>' +
          '<p class="text-muted small mb-2">Claims submitted by staff on the kiosk. ' +
            'The claim is what you are verifying — punch figures are shown for context only ' +
            'and do not decide anything. Nothing is paid until you submit.</p>' +
          '<div class="row g-2 align-items-end mb-2">' +
            '<div class="col-auto"><label class="form-label small mb-1">From</label>' +
              '<input type="date" id="otvFrom" class="form-control form-control-sm"></div>' +
            '<div class="col-auto"><label class="form-label small mb-1">To</label>' +
              '<input type="date" id="otvTo" class="form-control form-control-sm"></div>' +
            '<div class="col-auto"><button class="btn btn-primary btn-sm" onclick="app.loadOtVerify()">' +
              '<i class="bi bi-search"></i> Load claims</button></div>' +
            '<div class="col-auto"><button class="btn btn-outline-success btn-sm" onclick="app.otvBulk(\'approve\')">' +
              'Approve all shown</button></div>' +
            '<div class="col-auto"><button class="btn btn-outline-secondary btn-sm" onclick="app.otvClear()">' +
              'Clear</button></div>' +
          '</div>' +
          '<div id="otvSummary" class="mb-2"></div>' +
          '<div id="otvWrap" class="table-responsive"><div class="text-muted small">' +
            'Pick a range and click Load claims.</div></div>' +
          '<div id="otvBar" class="mt-2"></div>' +
        '</div>' +
        '<div class="table-container mb-3">' +
          '<h5 class="mb-3"><i class="bi bi-clipboard-check"></i> OT Review &amp; Post</h5>' +
          '<div class="row g-2 align-items-end">' +
            '<div class="col-auto"><label class="form-label small mb-1">From</label>' +
              '<input type="date" id="orFrom" class="form-control form-control-sm"></div>' +
            '<div class="col-auto"><label class="form-label small mb-1">To</label>' +
              '<input type="date" id="orTo" class="form-control form-control-sm" value="' + todayIso() + '"></div>' +
            '<div class="col-auto"><button class="btn btn-primary btn-sm" onclick="app.loadOtDraft()">' +
              '<i class="bi bi-search"></i> Compute</button></div>' +
            '<div class="col-auto"><input type="text" id="orSearch" class="form-control form-control-sm" ' +
              'placeholder="Filter name/ID" style="width:170px"></div>' +
            '<div class="col-auto form-check ms-2"><input type="checkbox" class="form-check-input" id="orFlagsOnly">' +
              '<label class="form-check-label small" for="orFlagsOnly">Flagged only</label></div>' +
          '</div>' +
          '<div class="text-muted small mt-2">OT = presence − shift Normal Hours. ' +
            'Enter hours and minutes directly — no decimals.</div>' +
        '</div>' +
        '<div id="orTableWrap" class="table-container table-responsive">' +
          '<div class="text-muted small">Pick a range and click Compute.</div></div>' +
        '<div id="orPostBar"></div>';
      anchor.parentElement.appendChild(s);
      const se = s.querySelector('#orSearch');    if (se) se.addEventListener('input', () => app.renderOtDraft());
      const fo = s.querySelector('#orFlagsOnly'); if (fo) fo.addEventListener('change', () => app.renderOtDraft());
    }
  });

  (function attach() {
    if (typeof app === 'undefined') return setTimeout(attach, 50);

    app.loadOtDraft = async function () {
      app.loadOtVerify();
      const wrap = document.getElementById('orTableWrap');
      const from = document.getElementById('orFrom').value;
      const to   = document.getElementById('orTo').value;
      wrap.innerHTML = '<div class="text-muted small">Computing…</div>';
      document.getElementById('orPostBar').innerHTML = '';
      try {
        let qs = 'method=getAttendanceOtDraft';
        if (from) qs += '&from=' + encodeURIComponent(toDd(from));
        if (to)   qs += '&to='   + encodeURIComponent(toDd(to));
        DRAFT = await callApi(qs);
        app.renderOtDraft();
      } catch (err) {
        wrap.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>';
      }
    };

    // ══════════════════════════════════════════════════════════════
    // OT VERIFICATION — claims submitted by staff on the kiosk
    // ══════════════════════════════════════════════════════════════
    // The CLAIM is what is being verified. It is the employee's own
    // statement of what they worked, so it is the starting point — not
    // something to be silently overwritten by a computed figure.
    //
    // Punch data (computed OT, presence, in/out) is shown alongside as
    // CONTEXT ONLY. It informs the decision; it does not make it.
    //
    // Nothing reaches OT_Entries until the verifier submits.
    const FLAG_LABEL = {
      'consistent'          : 'Matches punches',
      'claim-above-punches' : 'Claim above punches',
      'claim-below-punches' : 'Claim below punches',
      'no-ot-in-punches'    : 'No OT in punches',
      'incomplete-punch'    : 'Checked in, never out',
      'no-attendance'       : 'No attendance row',
      'not-present'         : 'Not marked Present',
      'overnight-spillover' : 'Belongs to another shift',
      'worked-day-off'      : 'Worked a day off (no punches)',
      'no-punch-data'       : 'No punch data (manual/auto day)',
      'rounded-up'          : 'Rounded up to a whole hour',
      'ambiguous-session'   : 'Which session? (two ended that morning)',
      'already-posted'      : 'Already in OT_Entries — his entry stands',
    };
    let VROWS = [], VDEC = {}, VFILTER = null, VVERIFIED = 0, VUNVERIFIED = 0;

    app.loadOtVerify = async function () {
      const wrap = document.getElementById('otvWrap');
      if (!wrap) return;
      wrap.innerHTML = '<div class="text-muted small">Loading claims…</div>';
      try {
        let qs = 'method=getOtCompileList';
        const f = document.getElementById('otvFrom');
        const t = document.getElementById('otvTo');
        if (f && f.value) qs += '&from=' + encodeURIComponent(toDd(f.value));
        if (t && t.value) qs += '&to='   + encodeURIComponent(toDd(t.value));
        const d = await callApi(qs);
        VROWS = d.rows || []; VDEC = {}; VFILTER = null;
        VVERIFIED = d.verified || 0; VUNVERIFIED = d.unverified || 0;
        app.renderOtVerifySummary(d.summary, d.count);
        app.renderOtVerify();
      } catch (err) {
        wrap.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>';
      }
    };

    app.renderOtVerifySummary = function (summary, total) {
      const el = document.getElementById('otvSummary');
      if (!el) return;
      if (!summary || !total) { el.innerHTML = ''; return; }
      let h = '<span class="badge bg-dark me-1" style="cursor:pointer" ' +
              'onclick="app.otvFilter(null)">All ' + total + '</span>';
      // The supervisor's statement is the only thing that can settle a claim
      // the punches cannot, so it filters first.
      if (VVERIFIED) h += '<span class="badge bg-primary me-1" style="cursor:pointer" ' +
        'onclick="app.otvFilter(\'@verified\')" title="A supervisor has vouched for these">' +
        'Supervisor verified ' + VVERIFIED + '</span>';
      if (VUNVERIFIED) h += '<span class="badge bg-light text-dark border me-1" style="cursor:pointer" ' +
        'onclick="app.otvFilter(\'@unverified\')" title="Nobody has vouched for these yet">' +
        'Not verified ' + VUNVERIFIED + '</span>';
      Object.keys(summary).sort((a,b) => summary[b]-summary[a]).forEach(f => {
        const cls = f === 'consistent' ? 'bg-success'
                  : f === 'no-ot-in-punches' ? 'bg-danger'
                  : f === 'claim-above-punches' ? 'bg-warning text-dark'
                  : f === 'overnight-spillover' ? 'bg-info text-dark'
                  : f === 'worked-day-off' ? 'bg-dark'
                  : f === 'no-punch-data' ? 'bg-light text-dark border'
                  : f === 'rounded-up' ? 'bg-warning text-dark'
                  : f === 'already-posted' ? 'bg-primary'
                  : 'bg-secondary';
        h += '<span class="badge ' + cls + ' me-1" style="cursor:pointer" ' +
             'onclick="app.otvFilter(\'' + f + '\')">' +
             (FLAG_LABEL[f] || f) + ' ' + summary[f] + '</span>';
      });
      el.innerHTML = h;
    };

    app.otvFilter = function (f) { VFILTER = f; app.renderOtVerify(); };

    // The rows currently on screen. '@verified' / '@unverified' filter on the
    // supervisor's answer rather than on a punch flag.
    app.otvList = function () {
      if (VFILTER === '@verified')   return VROWS.filter(r => r.supVerdict);
      if (VFILTER === '@unverified') return VROWS.filter(r => !r.supVerdict);
      return VFILTER ? VROWS.filter(r => r.flag === VFILTER) : VROWS;
    };

    app.renderOtVerify = function () {
      const wrap = document.getElementById('otvWrap');
      const list = app.otvList();
      if (!list.length) {
        wrap.innerHTML = '<div class="text-muted small">No pending claims in this range.</div>';
        app.renderOtVerifyBar(); return;
      }
      const body = list.map(r => {
        const d = VDEC[r.row];
        const flagCls = r.flag === 'consistent' ? 'bg-success'
                      : r.flag === 'no-ot-in-punches' ? 'bg-danger'
                      : r.flag === 'claim-above-punches' ? 'bg-warning text-dark'
                      : r.flag === 'overnight-spillover' ? 'bg-info text-dark'
                      : r.flag === 'worked-day-off' ? 'bg-dark'
                      : r.flag === 'no-punch-data' ? 'bg-light text-dark border'
                      : r.flag === 'rounded-up' ? 'bg-warning text-dark'
                      : r.flag === 'already-posted' ? 'bg-primary'
                      : 'bg-secondary';
        return '<tr' + (d ? ' class="table-light"' : '') + '>' +
          '<td><b>' + r.name + '</b><br><span class="small text-muted" style="font-family:monospace">' + r.empId + '</span></td>' +
          '<td style="font-family:monospace">' + r.date + '</td>' +
          '<td class="small">' + (r.location || '—') + '<br><span class="text-muted">' + (r.shift || '') + '</span></td>' +
          '<td><b style="font-size:1.05rem">' + r.claimedHm + '</b></td>' +
          '<td class="small text-muted" style="font-family:monospace">' +
            (r.flag === 'overnight-spillover' && r.prevComputedHm
              ? '<span class="text-info-emphasis">' + r.prevComputedHm + '</span>' +
                '<br><span style="font-size:10px">from ' + r.prevDate + '</span>'
              : r.computedHm) + '</td>' +
          '<td class="small text-muted" style="font-family:monospace">' + r.presenceHm + '</td>' +
          '<td class="small text-muted" style="font-family:monospace">' +
            (r.checkIn || '—') + ' → ' + (r.checkOut || '—') + '</td>' +
          '<td><span class="badge ' + flagCls + '" title="' + r.flagWhy + '">' +
            (FLAG_LABEL[r.flag] || r.flag) + '</span></td>' +
          '<td class="small">' + (r.supVerdict
            ? '<span class="badge ' + (r.supVerdict === 'Confirmed' ? 'bg-success'
                : r.supVerdict === 'Partly' ? 'bg-warning text-dark' : 'bg-danger') + '">' +
              r.supVerdict + (r.supHoursHm ? ' ' + r.supHoursHm : '') + '</span>' +
              '<br><span class="text-muted" style="font-size:10px">' + (r.supBy || '') + '</span>'
            : '<span class="text-muted">not asked yet</span>') + '</td>' +
          '<td><div class="btn-group btn-group-sm">' +
            '<button class="btn ' + (d && d.decision==='approve' ? 'btn-success' : 'btn-outline-success') +
              '" onclick="app.otvDecide(' + r.row + ',\'approve\')" title="Pay the claim as submitted">✓</button>' +
            '<button class="btn ' + (d && d.decision==='adjust'  ? 'btn-warning' : 'btn-outline-warning') +
              '" onclick="app.otvDecide(' + r.row + ',\'adjust\')" title="Pay a different amount">±</button>' +
            '<button class="btn ' + (d && d.decision==='reject'  ? 'btn-danger'  : 'btn-outline-danger') +
              '" onclick="app.otvDecide(' + r.row + ',\'reject\')" title="Pay nothing">✕</button>' +
          '</div></td>' +
          '<td><input class="form-control form-control-sm" style="width:72px;text-align:center;font-family:monospace" ' +
            'id="otvh' + r.row + '" value="' + (d ? d.hours : (r.suggested != null ? r.suggested : r.claimed)) + '" ' +
            (d && d.decision==='reject' ? 'disabled' : '') +
            ' onchange="app.otvHours(' + r.row + ')"></td>' +
          '<td><input class="form-control form-control-sm" id="otvn' + r.row + '" ' +
            'value="' + (d && d.note ? d.note : '') + '" placeholder="reason" ' +
            'onchange="app.otvNote(' + r.row + ')"></td>' +
        '</tr>';
      }).join('');

      wrap.innerHTML =
        '<table class="table table-sm align-middle" style="min-width:1320px">' +
          '<thead><tr>' +
            '<th>Employee</th><th>Date</th><th>Location</th>' +
            '<th>Claimed</th><th>Punches say</th><th>Presence</th><th>In / Out</th>' +
            '<th>Flag</th><th>Supervisor says</th><th>Decision</th><th>Pay</th><th>Note</th>' +
          '</tr></thead><tbody>' + body + '</tbody>' +
        '</table>';
      app.renderOtVerifyBar();
    };

    app.otvDecide = function (row, decision) {
      const r = VROWS.find(x => x.row === row);
      const base = (r.suggested != null ? r.suggested : r.claimed);
      if (VDEC[row] && VDEC[row].decision === decision) delete VDEC[row];
      else {
        const hours = decision === 'reject' ? 0 : (VDEC[row] ? VDEC[row].hours : base);
        // Paying anything other than what was claimed is an adjustment, even
        // when the figure came from the supervisor.
        const dec = (decision === 'approve' && Math.abs(hours - r.claimed) > 0.001)
                      ? 'adjust' : decision;
        VDEC[row] = { row: row, decision: dec, hours: hours,
                      note: VDEC[row] ? VDEC[row].note : '' };
      }
      app.renderOtVerify();
    };
    app.otvHours = function (row) {
      const v = parseFloat(document.getElementById('otvh' + row).value);
      const r = VROWS.find(x => x.row === row);
      if (!VDEC[row]) VDEC[row] = { row: row, decision: 'adjust', hours: v, note: '' };
      else VDEC[row].hours = v;
      // Changing the figure means it is no longer the claim as submitted.
      if (VDEC[row].decision === 'approve' && Math.abs(v - r.claimed) > 0.001)
        VDEC[row].decision = 'adjust';
      app.renderOtVerify();
    };
    app.otvNote = function (row) {
      if (VDEC[row]) VDEC[row].note = document.getElementById('otvn' + row).value;
    };

    app.otvBulk = function (decision) {
      const list = app.otvList();
      if (!list.length) return;
      if (!confirm(decision + ' all ' + list.length + ' claim(s) currently shown?')) return;
      list.forEach(r => {
        const base = (r.suggested != null ? r.suggested : r.claimed);
        const hours = decision === 'reject' ? 0 : base;
        const dec = (decision === 'approve' && Math.abs(hours - r.claimed) > 0.001)
                      ? 'adjust' : decision;
        VDEC[r.row] = { row: r.row, decision: dec, hours: hours, note: '' };
      });
      app.renderOtVerify();
    };
    app.otvClear = function () { VDEC = {}; app.renderOtVerify(); };

    app.renderOtVerifyBar = function () {
      const el = document.getElementById('otvBar');
      if (!el) return;
      const ds  = Object.keys(VDEC).map(k => VDEC[k]);
      const pay = ds.filter(d => d.decision !== 'reject');
      const rej = ds.filter(d => d.decision === 'reject');
      const hrs = pay.reduce((s, d) => s + (Number(d.hours) || 0), 0);
      el.innerHTML =
        '<div class="d-flex justify-content-between align-items-center flex-wrap gap-2">' +
          '<div class="small">' + (ds.length
            ? '<b>' + pay.length + '</b> to pay (' + toHM(hrs) + ') · <b>' + rej.length +
              '</b> rejected · ' + (VROWS.length - ds.length) + ' undecided'
            : 'No decisions yet. Nothing will be submitted.') + '</div>' +
          '<button class="btn btn-success btn-sm" ' + (ds.length ? '' : 'disabled') +
            ' onclick="app.otvSubmit()"><i class="bi bi-check2-circle"></i> Submit decisions</button>' +
        '</div>';
    };

    app.otvSubmit = async function () {
      const ds = Object.keys(VDEC).map(k => VDEC[k]);
      if (!ds.length) return;
      const bad = ds.filter(d => d.decision !== 'reject' && (!d.hours || d.hours <= 0));
      if (bad.length) { alert(bad.length + ' row(s) have no hours. Set an amount or reject them.'); return; }
      if (!confirm('Submit ' + ds.length + ' decision(s)?\n\nApproved hours go to OT_Entries and will be paid.')) return;
      const bar = document.getElementById('otvBar');
      bar.innerHTML = '<div class="alert alert-info mb-0 py-2"><span class="spinner-border spinner-border-sm"></span> Submitting…</div>';
      try {
        const d = await callPost('postApprovedOt', { decisions: ds, by: adminEmail() });
        alert(d.message +
              (d.settledList && d.settledList.length ? '\n\n' + d.settledList.join('\n') : '') +
              (d.errors && d.errors.length ? '\n\n' + d.errors.join('\n') : ''));
        app.loadOtVerify();
      } catch (err) {
        bar.innerHTML = '<div class="alert alert-danger mb-0 py-2">' + err.message + '</div>';
      }
    };

    // ── Attendance-computed OT draft ──────────────────────────────────
    app.renderOtDraft = function () {
      const wrap = document.getElementById('orTableWrap');
      if (!DRAFT || !DRAFT.rows.length) {
        wrap.innerHTML = '<div class="text-muted small">No attendance days in range.</div>';
        return;
      }
      const q         = (document.getElementById('orSearch').value || '').toLowerCase();
      const flagsOnly = document.getElementById('orFlagsOnly').checked;
      let rows = DRAFT.rows.map((r, i) => Object.assign({ _i: i }, r));
      if (q)         rows = rows.filter(r => (r.name||'').toLowerCase().includes(q) || (r.empId||'').toLowerCase().includes(q));
      if (flagsOnly) rows = rows.filter(r => r.flags);

      const body = rows.map(r => {
        const flagCell = r.flags
          ? '<span class="text-danger small">' + r.flags + '</span>'
          : '<span class="text-success small">OK</span>';
        const dayBadge = r.dayType === 'Half'
          ? '<span class="badge bg-warning text-dark">Half</span>'
          : r.dayType === 'Full'
          ? '<span class="badge bg-success">Full</span>'
          : '—';
        const presenceDisplay = r.presence == null ? '—' : toHM(r.presence);
        // H+M inputs for OT
        const otInputs = hmInputs(r.ot || 0, 'or-h', 'or-m', '46px');
        return '<tr data-i="' + r._i + '"' + (r.flags ? ' class="table-warning"' : '') + '>' +
          '<td style="font-size:12px;font-family:monospace">' + r.empId + '</td>' +
          '<td>' + r.name + '</td>' +
          '<td>' + r.date + '</td>' +
          '<td>' + (r.shift || '<span class="text-danger">—</span>') + '</td>' +
          '<td>' + (r.checkIn  || '—') + '</td>' +
          '<td>' + (r.checkOut || '—') + '</td>' +
          '<td class="text-end">' + presenceDisplay + '</td>' +
          '<td>' + dayBadge + '</td>' +
          '<td class="text-end">' + r.breakMin +
            (r.breakOver ? ' <span class="text-danger">(+' + r.breakOver + ')</span>' : '') +
          '</td>' +
          '<td>' + otInputs + '</td>' +
          '<td>' + flagCell + '</td>' +
          '<td class="text-center">' +
            '<input type="checkbox" class="form-check-input or-pick"' + ((r.ot > 0) ? ' checked' : '') + '>' +
          '</td>' +
        '</tr>';
      }).join('');

      wrap.innerHTML =
        '<table class="table table-sm table-striped align-middle" style="min-width:1100px">' +
          '<thead><tr>' +
            '<th>ID</th><th>Name</th><th>Date</th><th>Shift</th>' +
            '<th>In</th><th>Out</th>' +
            '<th class="text-end">Presence</th>' +
            '<th>Day</th>' +
            '<th class="text-end">Break (m)</th>' +
            '<th>OT</th>' +
            '<th>Flags</th><th>Post?</th>' +
          '</tr></thead>' +
          '<tbody>' + body + '</tbody>' +
        '</table>';

      app.renderOtPostBar();
    };

    app.renderOtPostBar = function () {
      // Sum up all ticked OT from H+M inputs
      const totalDec = (() => {
        if (!DRAFT) return 0;
        let t = 0;
        document.querySelectorAll('#orTableWrap tr[data-i]').forEach(tr => {
          if (tr.querySelector('.or-pick') && tr.querySelector('.or-pick').checked) {
            t += hmToDec(tr.querySelector('.or-h'), tr.querySelector('.or-m'));
          }
        });
        return t;
      })();
      document.getElementById('orPostBar').innerHTML =
        '<div class="table-container d-flex justify-content-between align-items-center flex-wrap gap-2">' +
          '<div class="text-muted small">Total OT in range: <b>' + toHM(DRAFT ? DRAFT.totalOt : 0) + '</b>' +
            ' across ' + (DRAFT ? DRAFT.count : 0) + ' day-rows. ' +
            'Only ticked rows with OT &gt; 0 are posted.</div>' +
          '<button class="btn btn-success" onclick="app.postOt()">' +
            '<i class="bi bi-upload"></i> Post ticked to OT_Entries</button>' +
        '</div>';
    };

    app.postOt = async function () {
      const picks = [];
      document.querySelectorAll('#orTableWrap tr[data-i]').forEach(tr => {
        if (!tr.querySelector('.or-pick').checked) return;
        const r  = DRAFT.rows[+tr.getAttribute('data-i')];
        const ot = hmToDec(tr.querySelector('.or-h'), tr.querySelector('.or-m'));
        if (ot > 0) picks.push({ empId: r.empId, name: r.name, date: r.date, ot, remark: 'Auto from attendance' });
      });
      if (!picks.length) { alert('No ticked rows with OT > 0 to post.'); return; }
      if (!confirm('Post ' + picks.length + ' OT row(s) to OT_Entries?')) return;
      const bar = document.getElementById('orPostBar');
      bar.innerHTML = '<div class="alert alert-info"><span class="spinner-border spinner-border-sm"></span> Posting…</div>';
      try {
        const d = await callPost('postOtToEntries', { rows: picks, by: adminEmail() });
        bar.innerHTML = '<div class="alert alert-success"><i class="bi bi-check-circle"></i> ' + d.message + '</div>';
      } catch (err) {
        bar.innerHTML = '<div class="alert alert-danger">' + err.message + '</div>';
        app.renderOtPostBar();
      }
    };

  })();
})();
