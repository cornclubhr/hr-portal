// ============================================================
// kiosk.js  — Staff Kiosk v2
// ============================================================
// State machine:
//   none / checked_out
//     └─ Day Off screen ("Is today your Day Off?")
//          ├─ Yes  → markKioskAttendance('Day Off') → done screen
//          └─ No   → Check In button
//               + "Log a previous Day Off" (backdated, ≤ 7 days)
//
//   checked_in / checked_in_after_break
//     └─ Break Out (big) + Check Out (secondary)
//
//   on_break
//     └─ Break In (full width)
//
//   break_done / checked_in_after_break   (returned from break)
//     └─ Break Out | Check Out  (side by side — another break or finish)
//
//   done / day_off → completed screen
// ============================================================

let currentEmpId  = null;
let currentEmpPin = null;
let _afterCheckIn = false;  // true = first checked-in (no break yet)
let _buttonsLocked = false;

// ── Helpers ───────────────────────────────────────────────────────────
function todayIso() { return new Date().toISOString().split('T')[0]; }
function isoToDd(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return d + '-' + m + '-' + y;
}
function lockButtons(lock) {
    _buttonsLocked = lock;
    document.querySelectorAll(
        '.stage-btn-single, .btn-half, .btn-dayoff-yes, .btn-checkin-go, .btn-skip'
    ).forEach(b => { b.disabled = lock; });
}

// ── 1. Login ──────────────────────────────────────────────────────────
async function kioskLogin() {
    const empId = document.getElementById('kioskEmpId').value.trim();
    const pin   = document.getElementById('kioskPin').value.trim();
    const errEl = document.getElementById('kioskError');
    const btn   = document.getElementById('kioskLoginBtn');

    errEl.innerText = '';
    if (!empId || !pin) { errEl.innerText = 'Please enter your ID and PIN.'; return; }

    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Verifying…';

    try {
        const result = await loginStaffKiosk(empId, pin);
        if (!result) { errEl.innerText = 'Connection error. Please check the network.'; return; }

        if (result.success) {
            currentEmpId  = empId;
            currentEmpPin = pin;

            document.getElementById('loginScreen').style.display  = 'none';
            document.getElementById('kioskDashboard').style.display = 'block';
            document.getElementById('kioskEmpName').innerText     = result.name;
            document.getElementById('kioskEmpIdDisplay').innerText = 'ID: ' + result.id;

            updateButtons(result.currentStatus);
        } else {
            errEl.innerText = result.error || 'Invalid ID or PIN.';
        }
    } catch (err) {
        console.error(err);
        errEl.innerText = 'Connection error. Please check the network.';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Clock In / Out';
    }
}

// ── 2. State → UI ─────────────────────────────────────────────────────
function updateButtons(status) {
    const host = document.getElementById('stageHost');
    if (!host) return;

    // Hide OT button when done / day off (nothing to submit OT against)
    const otBtn = document.getElementById('otBtn');
    if (otBtn) otBtn.style.display =
        (status === 'done' || status === 'day_off') ? 'none' : 'block';

    if (status === 'none' || status === 'checked_out') {
        _afterCheckIn = false;
        showDayOffScreen(host);
    } else if (status === 'checked_in') {
        _afterCheckIn = true;
        showCheckedInButtons(host);
    } else if (status === 'on_break') {
        _afterCheckIn = false;
        showBreakInButton(host);
    } else if (status === 'break_done' || status === 'checked_in_after_break') {
        _afterCheckIn = false;
        showAfterBreakButtons(host);
    } else if (status === 'done' || status === 'day_off') {
        showDoneScreen(host, status === 'day_off' ? 'Day Off recorded.' : 'All done for today.');
    } else {
        // Unknown — show Check In as safe fallback
        showSingleButton(host, 'Check In', 'btn-check-in', 'bi-play-circle');
    }
}

// ── Day Off screen ────────────────────────────────────────────────────
function showDayOffScreen(host) {
    host.innerHTML =
        '<div class="dayoff-card">' +
            '<h4>Is today your Day Off?</h4>' +
            '<div class="dayoff-btn-row">' +
                '<button class="btn-dayoff-yes" onclick="doTodayDayOff()">' +
                    '<i class="bi bi-moon-stars" style="font-size:1.8rem;display:block;margin-bottom:4px"></i>' +
                    'Yes — Day Off' +
                '</button>' +
                '<button class="btn-checkin-go" onclick="doCheckIn()">' +
                    '<i class="bi bi-play-circle" style="font-size:1.8rem;display:block;margin-bottom:4px"></i>' +
                    'No — Check In' +
                '</button>' +
            '</div>' +
        '</div>';
    // "Log a previous Day Off" now lives as a persistent link/modal below —
    // same one regardless of today's stage, see openBackdatedModal().
}

// ── After Check In: Break Out (primary) + Check Out (secondary) ───────
function showCheckedInButtons(host) {
    host.innerHTML =
        '<div class="two-btn-wrap">' +
            '<button class="stage-btn-single btn-break-out" id="stageBtn" onclick="kioskAction(\'Break Out\')">' +
                '<i class="bi bi-pause-circle"></i>' +
                '<span>Break Out</span>' +
            '</button>' +
            '<button class="btn-skip" onclick="kioskAction(\'Check Out\')">' +
                '<i class="bi bi-stop-circle"></i> Check Out (no break)' +
            '</button>' +
        '</div>';
}

// ── On Break: Break In only ───────────────────────────────────────────
function showBreakInButton(host) {
    host.innerHTML =
        '<button class="stage-btn-single btn-break-in" id="stageBtn" onclick="kioskAction(\'Break In\')">' +
            '<i class="bi bi-play-circle"></i>' +
            '<span>Break In</span>' +
        '</button>';
}

// ── After returning from break: Another Break | Check Out ─────────────
function showAfterBreakButtons(host) {
    host.innerHTML =
        '<div class="two-btn-row">' +
            '<button class="btn-half btn-break-out" id="stageBtnBreak" onclick="kioskAction(\'Break Out\')">' +
                '<i class="bi bi-pause-circle"></i>' +
                '<span>Break Out</span>' +
            '</button>' +
            '<button class="btn-half btn-check-out" id="stageBtnOut" onclick="kioskAction(\'Check Out\')">' +
                '<i class="bi bi-stop-circle"></i>' +
                '<span>Check Out</span>' +
            '</button>' +
        '</div>';
}

// ── Single full-width button (fallback) ───────────────────────────────
function showSingleButton(host, stage, cls, icon) {
    host.innerHTML =
        '<button class="stage-btn-single ' + cls + '" id="stageBtn" onclick="kioskAction(\'' + stage + '\')">' +
            '<i class="bi ' + icon + '"></i>' +
            '<span>' + stage + '</span>' +
        '</button>';
}

// ── Completed / Day Off screen ────────────────────────────────────────
function showDoneScreen(host, msg) {
    host.innerHTML =
        '<div class="stage-done">' +
            '<i class="bi bi-check-circle"></i>' +
            '<div class="done-title">' + (msg || 'All done for today') + '</div>' +
            '<div class="done-sub">Have a great rest of your day!</div>' +
        '</div>';
}

// ── 3. Actions ────────────────────────────────────────────────────────

// Mark today as Day Off
async function doTodayDayOff() {
    if (_buttonsLocked) return;
    lockButtons(true);
    try {
        const pos    = await getKioskLocation();
        const result = await markKioskAttendance(currentEmpId, currentEmpPin, 'Day Off', pos.lat, pos.lng);
        if (result && result.success) {
            updateButtons('day_off');
        } else {
            alert((result && result.error) || 'Could not record Day Off. Try again.');
            lockButtons(false);
        }
    } catch (err) {
        alert('Network error. Please try again.');
        lockButtons(false);
    }
}

// ── Update my documents ──────────────────────────────────────────────
// The staff document form. The man signed in here with his Employee ID
// and PIN, so the kiosk already knows who he is. It asks the backend for
// a signed half-hour link and passes it along, and the form then opens
// on HIS page — his own documents, and which of them have run out —
// instead of making him find himself in a list of 68 names.
// Staff document-update form for THIS deployment. Set DOCS_UPDATE_URL in
// config.js; empty hides the link rather than pointing at another company.
const DOCS_UPDATE_URL = (typeof CONFIG !== 'undefined' && CONFIG.DOCS_UPDATE_URL) || '';
async function openDocsUpdate() {
    const nameEl = document.getElementById('kioskEmpName');
    const name = nameEl ? String(nameEl.innerText || '').trim() : '';
    const q = [];
    if (name && name.toLowerCase() !== 'welcome') q.push('name=' + encodeURIComponent(name));
    if (currentEmpId) q.push('id=' + encodeURIComponent(currentEmpId));

    // The tab is opened HERE, empty, while we are still inside the tap.
    // A window.open after an await is no longer part of the tap and phones
    // block it as a pop-up — so the tab is taken first and pointed at the
    // form once the signed link comes back. That way the signature is only
    // ever fetched when somebody actually presses this button, instead of
    // on every single login by every man, several times a day.
    //
    // NOT 'noopener' here: that flag makes window.open return null by
    // design, and then there is no tab left to point anywhere. The link
    // it protects against is cut by hand instead, on the line below.
    const w = window.open('', '_blank');
    if (w) {
        try { w.opener = null; } catch (e) {}          // same as noopener would have done
        try { w.document.write('Opening your documents…'); } catch (e) {}
    }

    if (currentEmpId) {
        try {
            const r = await gsRequest('makeMyDocsLink', { empId: currentEmpId });
            if (r && r.success && r.t) q.push('t=' + encodeURIComponent(r.t));
        } catch (e) { /* the form falls back to its own name search */ }
    }

    const url = DOCS_UPDATE_URL + (q.length ? '?' + q.join('&') : '');
    // If the tab was blocked, behave exactly as the kiosk always has.
    if (w) w.location.href = url; else window.location.href = url;
}

// Tap "No — Check In" on the Day Off screen
function doCheckIn() {
    const host = document.getElementById('stageHost');
    showSingleButton(host, 'Check In', 'btn-check-in', 'bi-play-circle');
}

// Submit a backdated Day Off (calls new backend method)
// ── Log a previous Day Off — persistent modal, available in every state
// (before check-in, checked in, on break, checked out) since it's about
// a PAST date and has nothing to do with today's live punch status. ────
function openBackdatedModal() {
    const today   = new Date();
    const maxBack = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const minBack = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
    const toIsoLocal = d => d.getFullYear() + '-' +
      String(d.getMonth()+1).padStart(2,'0') + '-' +
      String(d.getDate()).padStart(2,'0');

    const dateEl = document.getElementById('backdatedDateModal');
    dateEl.min   = toIsoLocal(minBack);
    dateEl.max   = toIsoLocal(maxBack);
    dateEl.value = toIsoLocal(maxBack);
    document.getElementById('backdatedMsgModal').innerText = '';
    document.getElementById('backdatedModal').style.display = 'flex';
}

function closeBackdatedModal() {
    document.getElementById('backdatedModal').style.display = 'none';
}

async function doBackdatedDayOffModal() {
    const dateIso = document.getElementById('backdatedDateModal').value;
    const msgEl   = document.getElementById('backdatedMsgModal');
    const btn     = document.getElementById('backdatedBtnModal');

    msgEl.style.color = '#555';
    msgEl.innerText   = '';

    if (!dateIso) { msgEl.style.color = '#c00'; msgEl.innerText = 'Select a date.'; return; }

    btn.disabled  = true;
    btn.innerText = 'Submitting…';
    msgEl.innerText = 'Getting location…';

    try {
        const pos    = await getKioskLocation();
        msgEl.innerText = 'Please wait…';
        const result = await markBackdatedDayOff(
            currentEmpId, currentEmpPin, isoToDd(dateIso), pos.lat, pos.lng
        );
        if (result && result.success) {
            msgEl.style.color = '#198754';
            msgEl.innerText   = result.message || 'Day Off recorded.';
            setTimeout(closeBackdatedModal, 1400);
        } else {
            msgEl.style.color = '#c00';
            msgEl.innerText   = (result && result.error) || 'Could not record. Try again.';
        }
    } catch (err) {
        msgEl.style.color = '#c00';
        msgEl.innerText   = 'Network error. Please try again.';
    } finally {
        btn.disabled  = false;
        btn.innerText = 'Submit Day Off';
    }
}

// Stage punch (Check In / Break Out / Break In / Check Out)
async function kioskAction(stage) {
    if (!currentEmpId || _buttonsLocked) return;
    lockButtons(true);

    try {
        const pos    = await getKioskLocation();
        const result = await markKioskAttendance(currentEmpId, currentEmpPin, stage, pos.lat, pos.lng);

        if (result && result.success) {
            // Show geo message if flagged
            if (result.geoFlag && result.geoFlag !== 'OK' &&
                !result.geoFlag.startsWith('NOT GEOFENCED')) {
                alert('⚠ Location: ' + result.geoFlag);
            }
            // Advance state
            const nextState = {
                'Check In'  : 'checked_in',
                'Break Out' : 'on_break',
                'Break In'  : 'break_done',
                'Check Out' : 'done',
                'Day Off'   : 'day_off'
            };
            updateButtons(nextState[stage] || 'done');
        } else {
            alert((result && result.error) || 'Action failed. Try again.');
            lockButtons(false);
            await refreshDashboardState();
        }
    } catch (err) {
        console.error(err);
        alert('Network error. Please try again.');
        lockButtons(false);
    }
}

// ── 4. Logout ─────────────────────────────────────────────────────────
function kioskLogout() {
    currentEmpId  = null;
    currentEmpPin = null;
    _afterCheckIn  = false;
    _buttonsLocked = false;

    document.getElementById('kioskDashboard').style.display = 'none';
    document.getElementById('loginScreen').style.display    = 'block';
    document.getElementById('kioskEmpId').value  = '';
    document.getElementById('kioskPin').value    = '';
    document.getElementById('kioskError').innerText = '';
}

// ── 5. Auto-sync (idle recovery) ─────────────────────────────────────
async function refreshDashboardState() {
    if (!currentEmpId) return;
    try {
        const result = await getDailyKioskStatus(currentEmpId);
        if (result && result.success) updateButtons(result.currentStage || result.currentStatus);
    } catch (e) { /* silent */ }
}

// Enter key on PIN field
document.getElementById('kioskPin').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') kioskLogin();
});

// ── 6. Geolocation ────────────────────────────────────────────────────
function getKioskLocation() {
    return new Promise((resolve) => {
        if (!('geolocation' in navigator)) { resolve({ lat: null, lng: null }); return; }
        let done = false;
        const finish = v => { if (!done) { done = true; resolve(v); } };
        navigator.geolocation.getCurrentPosition(
            p  => finish({ lat: p.coords.latitude, lng: p.coords.longitude }),
            () => finish({ lat: null, lng: null }),
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
        setTimeout(() => finish({ lat: null, lng: null }), 9000);
    });
}

// ── 7. OT Submit ──────────────────────────────────────────────────────
function openOtSubmit() {
    if (!currentEmpId) return;
    document.getElementById('otDate').value   = todayIso();
    document.getElementById('otHours').value  = '';
    document.getElementById('otMsg').innerText = '';
    document.getElementById('otModal').style.display = 'flex';
}
function closeOtSubmit() {
    document.getElementById('otModal').style.display = 'none';
}
async function submitOt() {
    const msgEl = document.getElementById('otMsg');
    const btn   = document.getElementById('otSubmitBtn');
    const iso   = document.getElementById('otDate').value;
    const hours = document.getElementById('otHours').value;

    if (!iso)                         { msgEl.style.color='#c00'; msgEl.innerText='Pick a date.'; return; }
    if (!hours || Number(hours) <= 0) { msgEl.style.color='#c00'; msgEl.innerText='Enter OT hours.'; return; }

    const dd = isoToDd(iso);
    btn.disabled  = true;
    btn.innerText = 'Submitting…';
    msgEl.style.color = '#555';
    msgEl.innerText   = 'Getting location…';

    try {
        const pos    = await getKioskLocation();
        msgEl.innerText = 'Please wait…';
        const result = await submitOtRequest(currentEmpId, currentEmpPin, dd, hours, pos.lat, pos.lng);
        if (result && result.success) {
            msgEl.style.color = '#198754';
            msgEl.innerText   = result.message || 'Submitted — pending HR review.';
            setTimeout(closeOtSubmit, 1800);
        } else {
            msgEl.style.color = '#c00';
            msgEl.innerText   = (result && result.error) || 'Could not submit.';
        }
    } catch (err) {
        msgEl.style.color = '#c00';
        msgEl.innerText   = 'Network error. Try again.';
    } finally {
        btn.disabled  = false;
        btn.innerText = 'Submit';
    }
}
