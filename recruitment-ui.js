// ============================================================
// recruitment-ui.js — Recruitment page (drop-in, like the other UIs)
// ------------------------------------------------------------
// index.html (after employee-ui.js):
//   <script src="recruitment-ui.js"></script>
// Backend: getRecruitment, saveCandidate, setCandidateStage,
//          convertCandidateToEmployee, saveAgency, issueAgencyPin,
//          revokeAgencyPin  (Recruitment.gs)
//
// A candidate is not an employee: no Employee ID, no attendance, no pay,
// until Convert on their first working day. The page is the five stages
// as columns of counts, one table, and the buttons that move a person
// along — each stamping its own date in the sheet.
// ============================================================

(function () {
  // The endpoint lives in config.js and nowhere else. /dev only ever answers
  // the script owner, so it is coerced to /exec the way api.js does.
  const execUrl = () => {
    const u = (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.API_URL) ? String(CONFIG.API_URL) : '';
    if (!u) throw new Error('config.js is missing — API_URL not set');
    return u.replace('/dev', '/exec');
  };
  const SUBMITTED = 'Submitted';          // an agent's own submission, waiting for HR
  const STAGES = ['Selected', 'Visa Issued', 'Travelling', 'Arrived', 'Employee'];
  const OTHER  = ['On Hold', 'Cancelled'];
  const STAGE_COLOR = {
    'Submitted': 'warning', 'Selected': 'secondary', 'Visa Issued': 'info', 'Travelling': 'primary',
    'Arrived': 'warning', 'Employee': 'success', 'On Hold': 'dark', 'Cancelled': 'danger'
  };
  let CAND = [], AGENCIES = [], FILTER = '';

  async function callApi(qs) {
    const r = await fetch(execUrl() + '?' + qs + '&_=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json(); if (!d.success) throw new Error(d.error || 'error'); return d;
  }
  async function callPost(method, body) {
    const r = await fetch(execUrl() + '?method=' + method, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json(); if (!d.success) throw new Error(d.error || 'error'); return d;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const todayIso = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  const isoToDd = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? (m[3] + '-' + m[2] + '-' + m[1]) : String(s || ''); };
  const say = (id, html, bad) => { const el = document.getElementById(id); if (el) el.innerHTML = html ? '<div class="alert alert-' + (bad ? 'danger' : 'success') + ' py-1 mb-0">' + html + '</div>' : ''; };

  function pageHtml() {
    return (
      '<div class="table-container mb-3">' +
        '<div class="d-flex justify-content-between align-items-center mb-2">' +
          '<h5 class="mb-0"><i class="bi bi-airplane"></i> Add candidate</h5>' +
          '<button class="btn btn-outline-secondary btn-sm" onclick="app.loadRecruitment()"><i class="bi bi-arrow-repeat"></i> Refresh</button>' +
        '</div>' +
        '<div class="row g-2 align-items-end">' +
          '<div class="col-md-3"><label class="form-label small mb-1">Name (as in passport)</label><input id="rcName" class="form-control form-control-sm"></div>' +
          '<div class="col-md-2"><label class="form-label small mb-1">Passport No</label><input id="rcPassport" class="form-control form-control-sm"></div>' +
          '<div class="col-md-2"><label class="form-label small mb-1">Nationality</label><input id="rcNat" class="form-control form-control-sm" value="Nepalese"></div>' +
          '<div class="col-md-2"><label class="form-label small mb-1">Agency</label><select id="rcAgency" class="form-select form-select-sm"></select></div>' +
          '<div class="col-md-3"><label class="form-label small mb-1">Mobile / WhatsApp</label><input id="rcMobile" class="form-control form-control-sm"></div>' +
          '<div class="col-md-2"><label class="form-label small mb-1">Position</label><input id="rcPosition" class="form-control form-control-sm" placeholder="Helper"></div>' +
          '<div class="col-md-2"><label class="form-label small mb-1">Location</label><select id="rcLocation" class="form-select form-select-sm"></select></div>' +
          '<div class="col-md-1"><label class="form-label small mb-1">Basic</label><input id="rcBasic" type="number" step="0.001" class="form-control form-control-sm" value="120"></div>' +
          '<div class="col-md-1"><label class="form-label small mb-1">Food</label><input id="rcFood" type="number" step="0.001" class="form-control form-control-sm" value="0"></div>' +
          '<div class="col-md-1"><label class="form-label small mb-1">Accom.</label><input id="rcAccom" type="number" step="0.001" class="form-control form-control-sm" value="0"></div>' +
          '<div class="col-md-1"><label class="form-label small mb-1">Conv.</label><input id="rcConv" type="number" step="0.001" class="form-control form-control-sm" value="0"></div>' +
          '<div class="col-md-1"><label class="form-label small mb-1">Contract</label><input id="rcYears" class="form-control form-control-sm" value="2"></div>' +
          '<div class="col-md-3"><label class="form-label small mb-1">Remark</label><input id="rcRemark" class="form-control form-control-sm" placeholder="e.g. Ticket sent for 01-10-2026"></div>' +
          '<div class="col-md-2"><button class="btn btn-primary btn-sm w-100" onclick="app.addCandidate()"><i class="bi bi-plus-lg"></i> Add as Selected</button></div>' +
        '</div>' +
        '<div id="rcAddStatus" class="mt-2"></div>' +
        '<div class="text-muted small mt-1">They stay here — out of attendance and payroll — until you convert them on their first working day.</div>' +
      '</div>' +

      '<div class="table-container mb-3">' +
        '<div id="rcCounts" class="d-flex flex-wrap gap-2 mb-2"></div>' +
        '<div id="rcStatus" class="mb-2"></div>' +
        '<div id="rcTableWrap" class="table-responsive"><div class="text-muted small">Loading…</div></div>' +
      '</div>' +

      '<div class="table-container">' +
        '<h6 class="mb-2"><i class="bi bi-building"></i> Agencies</h6>' +
        '<div class="row g-2 align-items-end">' +
          '<div class="col-md-3"><label class="form-label small mb-1">Agency name</label><input id="agName" class="form-control form-control-sm"></div>' +
          '<div class="col-md-2"><label class="form-label small mb-1">License No</label><input id="agLicense" class="form-control form-control-sm"></div>' +
          '<div class="col-md-2"><label class="form-label small mb-1">Country</label><input id="agCountry" class="form-control form-control-sm" value="Nepal"></div>' +
          '<div class="col-md-2"><label class="form-label small mb-1">Contact person</label><input id="agContact" class="form-control form-control-sm"></div>' +
          '<div class="col-md-2"><label class="form-label small mb-1">WhatsApp</label><input id="agWhatsapp" class="form-control form-control-sm"></div>' +
          '<div class="col-md-1"><button class="btn btn-success btn-sm w-100" onclick="app.addAgency()">Add</button></div>' +
        '</div>' +
        '<div id="agStatus" class="mt-2"></div>' +
        '<div id="agListWrap" class="mt-2"></div>' +
      '</div>'
    );
  }

  document.addEventListener('DOMContentLoaded', function () {
    const navList = document.querySelector('#sidebar ul.nav');
    if (navList && !document.querySelector('[data-page="recruitment"]')) {
      const li = document.createElement('li'); li.className = 'nav-item';
      li.innerHTML = '<a class="nav-link" data-page="recruitment"><i class="bi bi-airplane"></i> Recruitment</a>';
      const emp = document.querySelector('[data-page="employees"]');
      if (emp && emp.closest('li')) emp.closest('li').insertAdjacentElement('afterend', li);
      else navList.appendChild(li);
      li.querySelector('.nav-link').addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        const pg = document.getElementById('page-recruitment'); if (pg) pg.classList.add('active');
        document.getElementById('pageTitle').innerText = 'Recruitment';
        if (app.loadRecruitment) app.loadRecruitment();
      });
    }
    const anchor = document.getElementById('page-dashboard');
    if (anchor && anchor.parentElement && !document.getElementById('page-recruitment')) {
      const s = document.createElement('div');
      s.className = 'page-section'; s.id = 'page-recruitment';
      s.innerHTML = pageHtml();
      anchor.parentElement.appendChild(s);
    }
  });

  (function attach() {
    if (typeof app === 'undefined') return setTimeout(attach, 50);

    app.loadRecruitment = async function () {
      try {
        const d = await callApi('method=getRecruitment');
        CAND = d.data || []; AGENCIES = d.agencies || [];
        fillAgencySelect(); fillLocationSelect(); renderCounts(d.counts || {}); renderTable(); renderAgencies();
      } catch (err) {
        document.getElementById('rcTableWrap').innerHTML = '<div class="alert alert-danger py-1">' + esc(err.message) + '</div>';
      }
    };

    function fillAgencySelect() {
      const sel = document.getElementById('rcAgency'); if (!sel) return;
      const keep = sel.value;
      sel.innerHTML = '<option value="">— none —</option>' +
        AGENCIES.filter(a => a.status !== 'Inactive')
                .map(a => '<option value="' + esc(a.id) + '">' + esc(a.name || a.id) + '</option>').join('');
      if (keep) sel.value = keep;
    }
    function fillLocationSelect() {
      const sel = document.getElementById('rcLocation'); if (!sel) return;
      const locs = (typeof app.LOCATION_NAMES !== 'undefined' && app.LOCATION_NAMES.length) ? app.LOCATION_NAMES : [];
      sel.innerHTML = '<option value="">— not decided —</option>' + locs.map(l => '<option>' + esc(l) + '</option>').join('');
    }
    function renderCounts(counts) {
      const el = document.getElementById('rcCounts'); if (!el) return;
      const chip = (label, n) => '<button class="btn btn-sm btn-' + (FILTER === label ? '' : 'outline-') +
        (STAGE_COLOR[label] || 'secondary') + '" onclick="app.filterRecruitment(\'' + label + '\')">' +
        esc(label) + ' <span class="badge bg-light text-dark">' + (n || 0) + '</span></button>';
      el.innerHTML = '<button class="btn btn-sm btn-' + (FILTER ? 'outline-' : '') + 'secondary" onclick="app.filterRecruitment(\'\')">All ' +
        '<span class="badge bg-light text-dark">' + CAND.length + '</span></button>' +
        [SUBMITTED].concat(STAGES).concat(OTHER).map(s => chip(s, counts[s])).join('');
    }
    app.filterRecruitment = function (stage) {
      FILTER = (FILTER === stage) ? '' : stage;
      renderCounts(countsOf()); renderTable();
    };
    function countsOf() {
      const c = {}; [SUBMITTED].concat(STAGES).concat(OTHER).forEach(s => c[s] = 0);
      CAND.forEach(r => { const s = String(r['Status'] || '').trim(); if (s in c) c[s]++; });
      return c;
    }

    function renderTable() {
      const wrap = document.getElementById('rcTableWrap'); if (!wrap) return;
      const rows = FILTER ? CAND.filter(r => String(r['Status']).trim() === FILTER) : CAND;
      if (!rows.length) { wrap.innerHTML = '<div class="text-muted small">No candidates' + (FILTER ? ' at ' + esc(FILTER) : '') + '.</div>'; return; }
      // Every stage a candidate can be put at, in the order they happen.
      // A dropdown, not a one-way button: a man's visa gets cancelled, a
      // ticket falls through, somebody clicks the wrong thing — all of it
      // needs to go backwards as easily as forwards.
      const PICKABLE = [SUBMITTED].concat(STAGES.filter(x => x !== 'Employee')).concat(OTHER);
      const stagePicker = (r, st) => {
        if (st === 'Employee') {
          return '<span class="badge bg-success">Employee</span>' +
                 '<div class="text-muted small">' + esc(r['Employee ID'] || '') + '</div>';
        }
        return '<select class="form-select form-select-sm rc-stage" data-id="' + esc(r['Candidate ID']) + '"' +
               ' data-current="' + esc(st) + '" style="min-width:130px">' +
          PICKABLE.map(x => '<option' + (x === st ? ' selected' : '') + '>' + esc(x) + '</option>').join('') +
          '</select>';
      };
      wrap.innerHTML =
        '<table class="table table-sm align-middle"><thead><tr>' +
          '<th>ID</th><th>Name</th><th>Passport</th><th>Position</th><th>Agency</th>' +
          '<th>Stage</th><th>Dates</th><th>Remark</th><th class="text-end">Action</th>' +
        '</tr></thead><tbody>' +
        rows.map(r => {
          const st = String(r['Status'] || '').trim();
          const dates =[['Sel', r['Selected On']], ['Visa', r['Visa Issued On']], ['Travel', r['Travel Date']],
                         ['Arr', r['Arrived On']], ['Join', r['Joined On']]]
            .filter(x => x[1]).map(x => x[0] + ' ' + esc(x[1])).join(' · ');
          // Convert is the only thing that is not a stage change: it creates
          // the the employee tab row, so it stays a deliberate button.
          let action = '';
          if (st === 'Arrived') action = '<button class="btn btn-success btn-sm" onclick="app.convertCandidate(\'' + r['Candidate ID'] + '\')"><i class="bi bi-person-check"></i> Convert</button>';
          else if (st === 'Employee') action = '<span class="text-muted small">on the payroll</span>';
          return '<tr>' +
            '<td class="small">' + esc(r['Candidate ID']) + '</td>' +
            '<td><b>' + esc(r['Name (English)']) + '</b><div class="text-muted small">' + esc(r['Nationality'] || '') + (r['Mobile / WhatsApp'] ? ' · ' + esc(r['Mobile / WhatsApp']) : '') + '</div></td>' +
            '<td class="small">' + esc(r['Passport No'] || '—') +
              (r['Passport Expiry'] ? '<div class="text-muted small">exp ' + esc(r['Passport Expiry']) + '</div>' : '') + '</td>' +
            '<td class="small">' + esc(r['Position'] || '—') +
              '<div class="text-muted small">' + esc([r['Location'], r['Visa Status'],
                (r['Experience (years)'] ? r['Experience (years)'] + ' yrs' : ''),
                r['Languages']].filter(Boolean).join(' · ')) + '</div></td>' +
            '<td class="small">' + esc(r['Agency'] || r['Agency ID'] || '—') + '</td>' +
            '<td>' + stagePicker(r, st) + '</td>' +
            '<td class="small text-muted">' + (dates || '—') + '</td>' +
            '<td class="small">' + esc(r['Remark'] || '') +
              // What the agent attached, if anything.
              (r['Photo'] || r['CV']
                ? '<div class="small">' +
                  (r['Photo'] ? '<a href="' + esc(r['Photo']) + '" target="_blank" rel="noopener">Photo</a> ' : '') +
                  (r['CV'] ? '<a href="' + esc(r['CV']) + '" target="_blank" rel="noopener">CV</a>' : '') + '</div>'
                : '') + '</td>' +
            '<td class="text-end text-nowrap">' + action + '</td>' +
          '</tr>';
        }).join('') + '</tbody></table>';

      // Changing the dropdown IS the action — no second click to confirm.
      wrap.querySelectorAll('.rc-stage').forEach(sel => {
        sel.addEventListener('change', function () {
          app.setStage(this.getAttribute('data-id'), this.value, this.getAttribute('data-current'), this);
        });
      });
    }

    app.addCandidate = async function () {
      const v = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
      if (!v('rcName')) { say('rcAddStatus', 'Name is required.', true); return; }
      try {
        const d = await callPost('saveCandidate', {
          name: v('rcName'), passportNo: v('rcPassport'), nationality: v('rcNat'),
          agencyId: v('rcAgency'), mobile: v('rcMobile'), position: v('rcPosition'),
          location: v('rcLocation'), basic: v('rcBasic'), food: v('rcFood'),
          accom: v('rcAccom'), conv: v('rcConv'), contractYears: v('rcYears'),
          remark: v('rcRemark'), status: 'Selected'
        });
        say('rcAddStatus', esc(d.message));
        ['rcName', 'rcPassport', 'rcMobile', 'rcRemark'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        app.loadRecruitment();
      } catch (err) { say('rcAddStatus', esc(err.message), true); }
    };

    // Any stage, any direction. The date is only asked for where the sheet
    // keeps one for that stage; On Hold and Cancelled ask for the reason.
    const STAGE_DATE = { 'Selected': 'Selected on', 'Visa Issued': 'Visa issued on',
                         'Travelling': 'Travel date', 'Arrived': 'Arrived on' };
    app.setStage = async function (id, stage, current, el) {
      if (stage === current) return;
      const body = { candidateId: id, status: stage };

      if (STAGE_DATE[stage]) {
        const when = prompt(STAGE_DATE[stage] + '? (dd-mm-yyyy)', isoToDd(todayIso()));
        if (when === null) { if (el) el.value = current; return; }          // cancelled — put it back
        body.date = String(when).trim();
      } else if (stage === 'On Hold' || stage === 'Cancelled') {
        const why = prompt(stage + ' — reason (optional):', '');
        if (why === null) { if (el) el.value = current; return; }
        if (String(why).trim()) body.note = String(why).trim();
      }

      if (el) el.disabled = true;
      try {
        const d = await callPost('setCandidateStage', body);
        say('rcStatus', esc(d.message)); app.loadRecruitment();
      } catch (err) {
        say('rcStatus', esc(err.message), true);
        if (el) { el.value = current; el.disabled = false; }               // leave the row as it was
      }
    };

    app.moveCandidate = async function (id, stage) {
      const when = prompt(stage + ' on which date? (dd-mm-yyyy)', isoToDd(todayIso()));
      if (when === null) return;
      try {
        const d = await callPost('setCandidateStage', { candidateId: id, status: stage, date: String(when).trim() });
        say('rcStatus', esc(d.message)); app.loadRecruitment();
      } catch (err) { say('rcStatus', esc(err.message), true); }
    };

    app.holdCandidate = async function (id) {
      const what = prompt('Type "hold" to put on hold, or "cancel" to cancel. Add a reason after a space.\ne.g. cancel family emergency', 'hold');
      if (!what) return;
      const parts = String(what).trim().split(/\s+/);
      const word = parts.shift().toLowerCase();
      const note = parts.join(' ');
      const status = word === 'cancel' ? 'Cancelled' : word === 'hold' ? 'On Hold' : '';
      if (!status) { say('rcStatus', 'Type hold or cancel.', true); return; }
      try {
        const d = await callPost('setCandidateStage', { candidateId: id, status: status, note: note });
        say('rcStatus', esc(d.message)); app.loadRecruitment();
      } catch (err) { say('rcStatus', esc(err.message), true); }
    };

    app.convertCandidate = async function (id) {
      const c = CAND.find(x => x['Candidate ID'] === id) || {};
      const when = prompt('First working day for ' + (c['Name (English)'] || id) + '? (dd-mm-yyyy)\n' +
                          'This creates the Employee ID and PIN, and attendance starts from this date.', isoToDd(todayIso()));
      if (when === null) return;
      if (!confirm('Convert ' + (c['Name (English)'] || id) + ' to an employee, joining ' + when + '?')) return;
      try {
        const d = await callPost('convertCandidateToEmployee', { candidateId: id, joinDate: String(when).trim() });
        say('rcStatus', esc(d.message));
        alert(d.message);          // the PIN matters — make sure it is seen
        app.loadRecruitment();
        if (app.loadAllData) app.loadAllData();
      } catch (err) { say('rcStatus', esc(err.message), true); }
    };

    app.addAgency = async function () {
      const v = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
      if (!v('agName')) { say('agStatus', 'Agency name is required.', true); return; }
      try {
        const d = await callPost('saveAgency', {
          name: v('agName'), license: v('agLicense'), country: v('agCountry'),
          contact: v('agContact'), whatsapp: v('agWhatsapp')
        });
        say('agStatus', esc(d.message));
        ['agName', 'agLicense', 'agContact', 'agWhatsapp'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        app.loadRecruitment();
      } catch (err) { say('agStatus', esc(err.message), true); }
    };

    function renderAgencies() {
      const el = document.getElementById('agListWrap'); if (!el) return;
      if (!AGENCIES.length) { el.innerHTML = '<div class="text-muted small">No agencies yet.</div>'; return; }
      // Portal column: whether this agency can sign in, and the buttons that
      // issue or cut off that access. The PIN itself is never listed — it is
      // shown once, when issued, so it can be sent to the agent.
      el.innerHTML = '<table class="table table-sm align-middle mb-0"><thead><tr>' +
          '<th>ID</th><th>Agency</th><th>Country</th><th>Contact</th><th>Portal</th><th class="text-end">Access</th>' +
        '</tr></thead><tbody>' + AGENCIES.map(a => {
        const p = a.portal || 'None';
        const badge = p === 'Active' ? 'success' : (p === 'Revoked' ? 'danger' : 'secondary');
        const btn = (p === 'Active')
          ? '<button class="btn btn-outline-primary btn-sm" onclick="app.issueAgencyPin(\'' + a.id + '\')">New PIN</button> ' +
            '<button class="btn btn-outline-danger btn-sm" onclick="app.revokeAgencyPin(\'' + a.id + '\')">Revoke</button>'
          : '<button class="btn btn-outline-primary btn-sm" onclick="app.issueAgencyPin(\'' + a.id + '\')">Issue PIN</button>';
        return '<tr><td class="small">' + esc(a.id) + '</td><td><b>' + esc(a.name) + '</b>' +
          (a.license ? '<div class="text-muted small">Lic. ' + esc(a.license) + '</div>' : '') + '</td>' +
          '<td class="small">' + esc(a.country || '') + '</td>' +
          '<td class="small">' + esc(a.contact || '') + (a.whatsapp ? ' · ' + esc(a.whatsapp) : '') + '</td>' +
          '<td><span class="badge bg-' + badge + '">' + esc(p === 'None' ? 'No access' : p) + '</span></td>' +
          '<td class="text-end text-nowrap">' + btn + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div id="agPinBox" class="mt-2"></div>';
    }

    app.issueAgencyPin = async function (id) {
      const a = AGENCIES.find(x => x.id === id) || {};
      if (a.portal === 'Active' && !confirm('Issue a NEW PIN for ' + (a.name || id) + '?\nThe PIN they have now stops working immediately.')) return;
      try {
        const d = await callPost('issueAgencyPin', { agencyId: id });
        const msg = 'Your Company agent portal\nAgency ID: ' + d.agencyId + '\nPIN: ' + d.pin +
                    '\nKeep this private — it is for ' + (d.name || id) + ' only.';
        const box = document.getElementById('agPinBox');
        if (box) box.innerHTML =
          '<div class="alert alert-success py-2 mb-0"><div class="fw-bold mb-1">' + esc(d.name || id) + ' — PIN ' + esc(d.pin) + '</div>' +
          '<div class="small mb-2">Shown once. Send it to the agent with the Agency ID; it is not listed again.</div>' +
          '<textarea class="form-control form-control-sm" rows="4" id="agPinMsg">' + esc(msg) + '</textarea>' +
          '<button class="btn btn-sm btn-outline-secondary mt-2" onclick="app.copyAgencyPin()">Copy message</button>' +
          (a.whatsapp ? ' <a class="btn btn-sm btn-success mt-2" target="_blank" rel="noopener" href="https://wa.me/' +
             encodeURIComponent(String(a.whatsapp).replace(/[^0-9]/g, '')) + '?text=' + encodeURIComponent(msg) + '">Send on WhatsApp</a>' : '') +
          '</div>';
        app.loadRecruitment();
      } catch (err) { say('agStatus', esc(err.message), true); }
    };
    app.copyAgencyPin = function () {
      const t = document.getElementById('agPinMsg'); if (!t) return;
      t.select(); try { document.execCommand('copy'); say('agStatus', 'Copied.'); } catch (e) { say('agStatus', 'Select and copy manually.', true); }
    };
    app.revokeAgencyPin = async function (id) {
      const a = AGENCIES.find(x => x.id === id) || {};
      if (!confirm('Revoke portal access for ' + (a.name || id) + '?')) return;
      try { const d = await callPost('revokeAgencyPin', { agencyId: id }); say('agStatus', esc(d.message)); app.loadRecruitment(); }
      catch (err) { say('agStatus', esc(err.message), true); }
    };
  })();
})();
