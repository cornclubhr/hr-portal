// ============================================================
// roster.js — Supervisor Roster Planner + Employee Transfer
// ------------------------------------------------------------
// Transfer model:
//   STANDARD (both from/to are regular rostering locations):
//     Request → Pending Approval → destination supervisor
//     Approves/Rejects. Approved + today's date = executes now.
//     Approved + future date = waits for the 4 AM trigger.
//   EXEMPT (either side is Head Office or Driver Location):
//     No approval needed — executes immediately (today) or is
//     auto-queued as Approved (future date), same as above from
//     that point on.
// No shift is chosen at transfer time — assigned later via normal
// roster planning by the receiving supervisor. getMyTeam flags any
// employee with zero future roster rows so this is never missed.
// ============================================================

let supId = null, supPin = null, currentData = null;

// Mirrors ROSTER_EXEMPT_LOCATIONS in RosterBackend.gs — used here only
// for immediate UI feedback (e.g. modal button label); the server is
// the actual authority and re-checks everything independently.
const ROSTER_EXEMPT_LOCATIONS = ['Head Office', 'Driver Location'];

function todayIso() { return new Date().toISOString().split('T')[0]; }
function isoToDd(iso) { const [y,m,d]=iso.split('-'); return d+'-'+m+'-'+y; }
function ddToIso(dd)  { const [d,m,y]=dd.split('-'); return y+'-'+m+'-'+d; }

async function api(method, params) {
  const url = CONFIG.API_URL.replace('/dev', '/exec');
  const qs = new URLSearchParams({ method, ...params }).toString();
  const r = await fetch(url + '?' + qs);
  return r.json();
}
async function apiPost(method, body) {
  const url = CONFIG.API_URL.replace('/dev', '/exec');
  const r = await fetch(url + '?method=' + method, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  });
  return r.json();
}

// ── Login ──────────────────────────────────────────────────
let ownLocation = null;

async function doLogin() {
  const id  = document.getElementById('supId').value.trim();
  const pin = document.getElementById('supPin').value.trim();
  const err = document.getElementById('loginErr');
  err.innerText = '';
  if (!id || !pin) { err.innerText = 'Enter ID and PIN.'; return; }

  try {
    const res = await api('voiceLogin', { supId: id, supPin: pin });
    if (!res.success) { err.innerText = res.error || 'Login failed.'; return; }
    supId = id; supPin = pin; ownLocation = res.location;
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    document.getElementById('locName').innerText = res.location + ' — Roster';
    document.getElementById('supName').innerText = res.name + ' · ' + res.teamCount + ' staff';

    // Team card, transfer requests — loaded for EVERY supervisor,
    // exempt or not, since transfer works regardless of exemption.
    loadMyTeam();
    loadIncomingRequests();
    loadOutgoingRequests();

    if (ROSTER_EXEMPT_LOCATIONS.includes(res.location)) {
      // No roster grid for exempt locations — hide toolbar + grid entirely.
      document.getElementById('toolbarCard').style.display = 'none';
      document.getElementById('gridCard').style.display = 'none';
      return;
    }

    document.getElementById('fromDate').value = todayIso();
    const to = new Date(); to.setDate(to.getDate() + 6);
    document.getElementById('toDate').value = to.toISOString().split('T')[0];

    loadDiscrepancies();
  } catch (e) {
    err.innerText = 'Connection error.';
  }
}

function logout() {
  supId = null; supPin = null; currentData = null; ownLocation = null;
  document.getElementById('mainApp').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('supId').value = '';
  document.getElementById('supPin').value = '';
  document.getElementById('toolbarCard').style.display = '';
  document.getElementById('gridCard').style.display = '';
}

// ── My Team ────────────────────────────────────────────────
async function loadMyTeam() {
  const res = await api('getMyTeam', { supId, supPin });
  const card = document.getElementById('teamCard');
  const list = document.getElementById('teamList');
  const note = document.getElementById('teamExemptNote');
  if (!res.success) { card.style.display = 'none'; return; }

  card.style.display = 'block';

  if (res.rosterExempt) {
    note.style.display = 'block';
    note.innerHTML = (res.location === 'Head Office'
      ? 'Head Office staff are automatically marked present on working days — no roster needed. '
      : 'Drivers work every day and self-report their day off via the kiosk — no roster needed. ') +
      'You can still transfer someone to another location below.';
  } else {
    note.style.display = 'none';
  }

  if (!res.employees || !res.employees.length) {
    list.innerHTML = '<p style="color:var(--muted);font-size:13px">No active staff on your team.</p>';
    return;
  }

  list.innerHTML = res.employees.map(emp =>
    '<div class="team-row">' +
      '<div>' + emp.name + '<span class="id">' + emp.id + '</span>' +
        (emp.needsRoster ? '<span class="needs-roster-badge">No roster planned</span>' : '') +
      '</div>' +
      '<button class="btn btn-outline" onclick="openTransfer(\'' + emp.id + '\',\'' +
        emp.name.replace(/'/g,"\\'") + '\')">Transfer</button>' +
    '</div>'
  ).join('');
}

// ── Discrepancies panel ───────────────────────────────────
async function loadDiscrepancies() {
  const res = await api('getDiscrepancies', { supId, supPin });
  const card = document.getElementById('discCard');
  const list = document.getElementById('discList');
  if (!res.success || !res.rows || !res.rows.length) { card.style.display = 'none'; return; }

  card.style.display = 'block';
  list.innerHTML = res.rows.map(r =>
    '<div class="disc-row">' +
      '<div>' +
        '<b>' + r.name + '</b> (' + r.empId + ') — ' + r.date + '<br>' +
        '<span class="disc-meta">Roster said: ' + r.rosterSaid + ' · Actual: ' + r.actual + '</span>' +
      '</div>' +
      '<button class="btn btn-outline" onclick="reviewDisc(' + r.rowNum + ')">Mark Reviewed</button>' +
    '</div>'
  ).join('');
}

async function reviewDisc(rowNum) {
  await api('markDiscrepancyReviewed', { supId, supPin, rowNum });
  loadDiscrepancies();
}

// ── Incoming Transfer Requests (I'm the destination) ──────────
async function loadIncomingRequests() {
  const res = await api('getIncomingTransferRequests', { supId, supPin });
  const card = document.getElementById('incomingCard');
  const list = document.getElementById('incomingList');
  if (!res.success || !res.rows || !res.rows.length) { card.style.display = 'none'; return; }

  card.style.display = 'block';
  list.innerHTML = res.rows.map(r =>
    '<div class="req-row">' +
      '<div>' +
        '<b>' + r.name + '</b> (' + r.empId + ') from <b>' + r.fromLocation + '</b><br>' +
        '<span class="req-meta">Effective ' + r.effectiveDate + ' · requested by ' + r.requestedBy +
          (r.reason ? ' · "' + r.reason + '"' : '') + '</span>' +
      '</div>' +
      '<div style="display:flex;gap:6px">' +
        '<button class="btn btn-success" onclick="approveReq(' + r.rowNum + ')">Approve</button>' +
        '<button class="btn btn-outline" onclick="openReject(' + r.rowNum + ',\'' +
          r.name.replace(/'/g,"\\'") + '\')">Reject</button>' +
      '</div>' +
    '</div>'
  ).join('');
}

async function approveReq(rowNum) {
  const res = await api('approveTransfer', { supId, supPin, rowNum });
  alert(res.success ? res.message : res.error);
  loadIncomingRequests();
  loadMyTeam();
}

let rejectTarget = null;
function openReject(rowNum, name) {
  rejectTarget = rowNum;
  document.getElementById('rejectWho').innerText = name;
  document.getElementById('rejectNote').value = '';
  document.getElementById('rejectMsg').innerText = '';
  document.getElementById('rejectModal').style.display = 'flex';
}
function closeReject() { document.getElementById('rejectModal').style.display = 'none'; }

async function submitReject() {
  const note = document.getElementById('rejectNote').value.trim();
  const res = await api('rejectTransfer', { supId, supPin, rowNum: rejectTarget, note });
  const msgEl = document.getElementById('rejectMsg');
  if (res.success) {
    msgEl.style.color = 'var(--green)'; msgEl.innerText = res.message;
    setTimeout(() => { closeReject(); loadIncomingRequests(); }, 900);
  } else {
    msgEl.style.color = 'var(--red)'; msgEl.innerText = res.error;
  }
}

// ── Outgoing Transfer Requests (I requested these) ────────────
async function loadOutgoingRequests() {
  const res = await api('getOutgoingTransferRequests', { supId, supPin });
  const card = document.getElementById('outgoingCard');
  const list = document.getElementById('outgoingList');
  if (!res.success || !res.rows || !res.rows.length) { card.style.display = 'none'; return; }

  card.style.display = 'block';
  list.innerHTML = res.rows.map(r => {
    const cls = r.status === 'Pending Approval' ? 'pending'
              : r.status === 'Approved'         ? 'approved'
              : r.status === 'Rejected'          ? 'rejected'
              : 'expired';
    const canCancel = r.status === 'Pending Approval' || r.status === 'Approved';
    return '<div class="req-row">' +
      '<div>' +
        '<b>' + r.name + '</b> (' + r.empId + ') → <b>' + r.toLocation + '</b><br>' +
        '<span class="req-meta">Effective ' + r.effectiveDate +
          (r.rejectionNote ? ' · Note: "' + r.rejectionNote + '"' : '') + '</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<span class="req-status ' + cls + '">' + r.status + '</span>' +
        (canCancel ? '<button class="btn btn-outline" onclick="cancelReq(' + r.rowNum + ')">Cancel</button>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

async function cancelReq(rowNum) {
  if (!confirm('Cancel this transfer request?')) return;
  const res = await api('cancelTransferRequest', { supId, supPin, rowNum });
  alert(res.success ? res.message : res.error);
  loadOutgoingRequests();
}

// ── Transfer request modal ────────────────────────────────────
let transferTarget = null;

async function openTransfer(empId, empName) {
  transferTarget = { empId, empName };
  document.getElementById('transferWho').innerText = empName + ' (' + empId + ')';
  document.getElementById('transferReason').value = '';
  document.getElementById('transferDate').value = todayIso();
  document.getElementById('transferDate').min = todayIso();
  document.getElementById('transferMsg').innerText = '';

  const locRes = await api('getActiveLocations', { supId, supPin });
  const sel = document.getElementById('transferLocation');
  sel.innerHTML = (locRes.locations || []).map(l => '<option value="' + l + '">' + l + '</option>').join('');

  onTransferLocationChange();
  document.getElementById('transferModal').style.display = 'flex';
}

function onTransferLocationChange() {
  const toLoc = document.getElementById('transferLocation').value;
  const isExempt = ROSTER_EXEMPT_LOCATIONS.includes(ownLocation) || ROSTER_EXEMPT_LOCATIONS.includes(toLoc);
  const note = document.getElementById('transferApprovalNote');
  const btn  = document.getElementById('transferConfirmBtn');

  if (isExempt) {
    note.innerText = 'No approval needed — one side is auto-managed.';
    btn.innerText = 'Transfer';
  } else {
    note.innerText = 'This will be sent to ' + toLoc + "'s supervisor for approval.";
    btn.innerText = 'Send Request';
  }
}

function closeTransfer() { document.getElementById('transferModal').style.display = 'none'; }

async function submitTransfer() {
  const toLocation    = document.getElementById('transferLocation').value;
  const effectiveDate = isoToDd(document.getElementById('transferDate').value);
  const reason         = document.getElementById('transferReason').value.trim();
  const msgEl          = document.getElementById('transferMsg');

  if (!toLocation) { msgEl.style.color = 'var(--red)'; msgEl.innerText = 'Pick a destination location.'; return; }

  const res = await apiPost('requestTransfer', {
    supId, supPin, empId: transferTarget.empId, toLocation, effectiveDate, reason
  });

  if (res.success) {
    msgEl.style.color = 'var(--green)'; msgEl.innerText = res.message;
    setTimeout(() => {
      closeTransfer();
      loadMyTeam();
      loadOutgoingRequests();
      if (currentData) loadRoster();
    }, 1200);
  } else {
    msgEl.style.color = 'var(--red)'; msgEl.innerText = res.error;
  }
}

// ── Load roster grid ───────────────────────────────────────
async function loadRoster() {
  const from = isoToDd(document.getElementById('fromDate').value);
  const to   = isoToDd(document.getElementById('toDate').value);
  const wrap = document.getElementById('gridWrap');
  wrap.innerHTML = '<p style="color:var(--muted)">Loading…</p>';
  setStatus('');

  const res = await api('getRosterRange', { supId, supPin, from, to });
  if (!res.success) { wrap.innerHTML = '<p style="color:var(--red)">' + res.error + '</p>'; return; }

  currentData = res;
  renderGrid();
}

// ── Grid render — ONE dropdown per cell: this location's shifts + Day Off ──
function renderGrid() {
  const { employees, dates, shifts, cells } = currentData;
  const wrap = document.getElementById('gridWrap');

  let head = '<tr><th class="emp-name-h">Employee</th>' +
    dates.map(d => '<th>' + d.slice(0,5) + '</th>').join('') + '</tr>';

  function buildOptions(selectedValue) {
    let opts = '<option value=""' + (!selectedValue ? ' selected' : '') + '>—</option>';
    opts += '<option value="Day Off"' + (selectedValue==='Day Off' ? ' selected' : '') + '>Day Off</option>';
    shifts.forEach(s => {
      opts += '<option value="' + s + '"' + (selectedValue===s ? ' selected' : '') + '>' + s + '</option>';
    });
    return opts;
  }

  let body = employees.map(emp => {
    const rowCells = dates.map(date => {
      const c = (cells[emp.id] && cells[emp.id][date]) || {};
      if (c.locked) {
        return '<td><div class="cell-locked">' + c.lockReason + '</div></td>';
      }
      const selectedValue = c.status === 'Day Off' ? 'Day Off' : (c.status === 'Working' ? c.shift : '');
      const statusCls = selectedValue === 'Day Off' ? 'off' : selectedValue ? 'working' : '';
      const pubCls = c.published ? ' cell-published' : '';
      return '<td class="' + (selectedValue ? '' : 'cell-empty') + '">' +
        '<select class="cell-select ' + statusCls + pubCls + '" ' +
          'data-emp="' + emp.id + '" data-date="' + date + '" onchange="onCellChange(this)">' +
          buildOptions(selectedValue) +
        '</select>' +
        (c.published ? '<div style="font-size:10px;color:var(--green);margin-top:2px">' +
          '<i class="bi bi-check-circle-fill"></i> <a href="#" onclick="openAmend(\'' + emp.id + '\',\'' + emp.name.replace(/'/g,"\\'") + '\',\'' + date + '\');return false;" style="color:var(--amber)">amend</a></div>' : '') +
      '</td>';
    }).join('');
    return '<tr><td class="emp-name">' + emp.name + '<br><span style="font-size:10px;color:var(--muted);font-weight:400">' + emp.id + '</span></td>' + rowCells + '</tr>';
  }).join('');

  wrap.innerHTML = '<table class="roster-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
}

function onCellChange(sel) {
  const empId = sel.getAttribute('data-emp');
  const date  = sel.getAttribute('data-date');
  const val   = sel.value;
  if (!currentData.cells[empId]) currentData.cells[empId] = {};
  if (!currentData.cells[empId][date]) currentData.cells[empId][date] = {};

  if (val === '') {
    currentData.cells[empId][date].status = '';
    currentData.cells[empId][date].shift = '';
  } else if (val === 'Day Off') {
    currentData.cells[empId][date].status = 'Day Off';
    currentData.cells[empId][date].shift = '';
  } else {
    currentData.cells[empId][date].status = 'Working';
    currentData.cells[empId][date].shift = val;
  }
  renderGrid();
}

// ── Save / Publish ─────────────────────────────────────────
function collectCellsPayload() {
  const out = {};
  document.querySelectorAll('.cell-select[data-emp]').forEach(sel => {
    const empId = sel.getAttribute('data-emp');
    const date  = sel.getAttribute('data-date');
    const val   = sel.value;
    if (!val) return;
    const status = val === 'Day Off' ? 'Day Off' : 'Working';
    const shift  = val === 'Day Off' ? '' : val;
    if (!out[empId]) out[empId] = {};
    out[empId][date] = { status, shift };
  });
  return out;
}

async function saveDraft() {
  if (!currentData) return;
  const from = isoToDd(document.getElementById('fromDate').value);
  const to   = isoToDd(document.getElementById('toDate').value);
  const cells = collectCellsPayload();
  setStatus('Saving…', '');
  const res = await apiPost('saveRosterDraft', { supId, supPin, from, to, cells: JSON.stringify(cells) });
  if (res.success) { setStatus(res.message, 'ok'); loadRoster(); loadMyTeam(); }
  else setStatus(res.error, 'err');
}

async function publish() {
  const from = isoToDd(document.getElementById('fromDate').value);
  const to   = isoToDd(document.getElementById('toDate').value);
  if (!confirm('Publish the roster for ' + from + ' to ' + to + '? This makes it live for attendance compilation.')) return;
  setStatus('Publishing…', '');
  const res = await api('publishRoster', { supId, supPin, from, to });
  if (res.success) { setStatus(res.message, 'ok'); loadRoster(); loadMyTeam(); }
  else setStatus(res.error, 'err');
}

async function copyPrevious() {
  const from = isoToDd(document.getElementById('fromDate').value);
  const to   = isoToDd(document.getElementById('toDate').value);
  setStatus('Copying previous range…', '');
  const res = await api('copyPreviousRange', { supId, supPin, from, to });
  if (!res.success) { setStatus(res.error, 'err'); return; }

  if (!currentData) await loadRoster();
  Object.keys(res.cells).forEach(empId => {
    if (!currentData.cells[empId]) currentData.cells[empId] = {};
    Object.keys(res.cells[empId]).forEach(date => {
      const existing = currentData.cells[empId][date] || {};
      if (existing.locked) return;
      currentData.cells[empId][date] = { ...existing, ...res.cells[empId][date] };
    });
  });
  renderGrid();
  setStatus('Copied from ' + res.sourceFrom + ' – ' + res.sourceTo + '. Review and Save Draft.', 'ok');
}

function setStatus(msg, cls) {
  const el = document.getElementById('statusMsg');
  el.innerText = msg;
  el.className = cls === 'ok' ? 'status-ok' : cls === 'err' ? 'status-err' : '';
}

// ── Amend modal (unchanged from before) ──────────────────────
let amendTarget = null;

function openAmend(empId, empName, date) {
  amendTarget = { empId, empName, date };
  document.getElementById('amendWho').innerText = empName + ' (' + empId + ') — ' + date;
  document.getElementById('amendReason').value = '';
  document.getElementById('amendMsg').innerText = '';

  const shiftSel = document.getElementById('amendShift');
  shiftSel.innerHTML = (currentData.shifts || []).map(s => '<option value="' + s + '">' + s + '</option>').join('');

  document.getElementById('amendModal').style.display = 'flex';
}
function closeAmend() { document.getElementById('amendModal').style.display = 'none'; }

async function submitAmend() {
  const status = document.getElementById('amendStatus').value;
  const shift  = document.getElementById('amendShift').value;
  const reason = document.getElementById('amendReason').value.trim();
  const msgEl  = document.getElementById('amendMsg');
  if (!reason) { msgEl.innerText = 'Reason is required.'; msgEl.style.color = 'var(--red)'; return; }

  const res = await apiPost('amendRosterEntry', {
    supId, supPin,
    empId: amendTarget.empId, date: amendTarget.date,
    newStatus: status, newShift: shift, reason
  });
  if (res.success) {
    msgEl.style.color = 'var(--green)';
    msgEl.innerText = res.message;
    setTimeout(() => { closeAmend(); loadRoster(); }, 1000);
  } else {
    msgEl.style.color = 'var(--red)';
    msgEl.innerText = res.error;
  }
}

// Enter key on PIN
document.addEventListener('DOMContentLoaded', () => {
  const pin = document.getElementById('supPin');
  if (pin) pin.addEventListener('keypress', e => { if (e.key === 'Enter') doLogin(); });
});
