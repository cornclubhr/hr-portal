// ============================================================
// locations-ui.js — Locations page: manage branches + geofencing flag
// ------------------------------------------------------------
// index.html (after shifts-ui.js):  <script src="locations-ui.js"></script>
// Backend: getLocations, saveLocation, deleteLocation.
// Drives the geofence (Geofenced=Yes rows) and location dropdowns.
// ============================================================

(function () {
  const EXEC_URL = CONFIG.API_URL;
  let LOCS = [];

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
    if (navList && !document.querySelector('[data-page="locations"]')) {
      const li = document.createElement('li'); li.className = 'nav-item';
      li.innerHTML = '<a class="nav-link" data-page="locations"><i class="bi bi-geo-alt"></i> Locations</a>';
      const sh = document.querySelector('[data-page="shifts"]') || document.querySelector('[data-page="attendance"]');
      if (sh && sh.closest('li')) sh.closest('li').insertAdjacentElement('afterend', li);
      else navList.appendChild(li);
      li.querySelector('.nav-link').addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        const pg = document.getElementById('page-locations'); if (pg) pg.classList.add('active');
        document.getElementById('pageTitle').innerText = 'Locations';
        if (app.loadLocations) app.loadLocations();
      });
    }
    const anchor = document.getElementById('page-dashboard');
    if (anchor && anchor.parentElement && !document.getElementById('page-locations')) {
      const s = document.createElement('div'); s.className = 'page-section'; s.id = 'page-locations';
      s.innerHTML =
        '<div class="table-container">' +
          '<div class="d-flex justify-content-between align-items-center mb-3"><h5><i class="bi bi-geo-alt"></i> Locations</h5>' +
            '<button class="btn btn-primary btn-sm" onclick="app.openLocation()"><i class="bi bi-plus-lg"></i> New Location</button></div>' +
          '<div id="locTableWrap" class="table-responsive"><div class="text-muted small">Loading…</div></div>' +
          '<div class="text-muted small mt-2">Tick <b>Geofenced</b> for locations where the kiosk should check GPS (needs lat/long/radius). Leave it off for office locations like Head Office.</div>' +
        '</div>';
      anchor.parentElement.appendChild(s);
    }
  });

  (function attach() {
    if (typeof app === 'undefined') return setTimeout(attach, 50);

    app.loadLocations = async function () {
      const wrap = document.getElementById('locTableWrap');
      wrap.innerHTML = '<div class="text-muted small">Loading…</div>';
      try {
        const d = await callApi('method=getLocations'); LOCS = d.data || [];
        const body = LOCS.map(l =>
          '<tr' + (l.active ? '' : ' class="table-secondary"') + '><td><b>' + l.name + '</b></td>' +
          '<td>' + (l.geofenced ? '<span class="badge bg-info text-dark">Geofenced</span>' : '<span class="text-muted">—</span>') + '</td>' +
          '<td class="text-end">' + (l.latitude !== '' ? l.latitude : '') + '</td>' +
          '<td class="text-end">' + (l.longitude !== '' ? l.longitude : '') + '</td>' +
          '<td class="text-end">' + (l.radius !== '' ? l.radius : '') + '</td>' +
          '<td>' + (l.active ? '<span class="badge bg-success">Yes</span>' : '<span class="badge bg-secondary">No</span>') + '</td>' +
          '<td class="text-end"><button class="btn btn-outline-info btn-sm me-1" onclick="app.editLocationShifts(\'' + l.name.replace(/'/g,"\\'") + '\')" title="Shifts at this location"><i class="bi bi-clock"></i></button>' +
            '<button class="btn btn-outline-primary btn-sm me-1" onclick="app.editSupervisors(\'' + l.name.replace(/'/g,"\\'") + '\')" title="Supervisors"><i class="bi bi-person-badge"></i></button>' +
            '<button class="btn btn-outline-secondary btn-sm me-1" onclick="app.openLocation(\'' + l.name.replace(/'/g,"\\'") + '\')"><i class="bi bi-pencil"></i></button>' +
            '<button class="btn btn-outline-danger btn-sm" onclick="app.retireLocation(\'' + l.name.replace(/'/g,"\\'") + '\')"><i class="bi bi-archive"></i></button></td></tr>').join('');
        wrap.innerHTML = '<table class="table table-sm table-striped align-middle"><thead><tr>' +
          '<th>Location</th><th>Geofence</th><th class="text-end">Latitude</th><th class="text-end">Longitude</th><th class="text-end">Radius</th><th>Active</th><th></th>' +
          '</tr></thead><tbody>' + body + '</tbody></table>';
      } catch (err) { wrap.innerHTML = '<div class="alert alert-danger mb-0">' + err.message + '</div>'; }
    };

    app.openLocation = function (name) {
      const l = name ? LOCS.find(x => x.name === name) : null;
      const v = (k, d) => l ? (l[k] === '' ? '' : l[k]) : d;
      const html =
        '<div class="modal fade" id="locModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content">' +
          '<div class="modal-header"><h5 class="modal-title">' + (l ? 'Edit' : 'New') + ' Location</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>' +
          '<div class="modal-body"><div class="row g-3">' +
            '<div class="col-12"><label class="form-label small mb-1">Location name</label><input id="locName" class="form-control form-control-sm" value="' + (l ? l.name : '') + '"' + (l ? ' readonly' : '') + '></div>' +
            '<div class="col-12"><div class="form-check"><input type="checkbox" class="form-check-input" id="locGeo"' + (v('geofenced',false) ? ' checked' : '') + ' onchange="app.locGeoToggle()"><label class="form-check-label" for="locGeo"><b>Geofenced</b> — kiosk checks GPS at this location</label></div></div>' +
            '<div class="col-4" id="locLatWrap"><label class="form-label small mb-1">Latitude</label><input id="locLat" class="form-control form-control-sm" value="' + v('latitude','') + '"></div>' +
            '<div class="col-4" id="locLngWrap"><label class="form-label small mb-1">Longitude</label><input id="locLng" class="form-control form-control-sm" value="' + v('longitude','') + '"></div>' +
            '<div class="col-4" id="locRadWrap"><label class="form-label small mb-1">Radius (m)</label><input id="locRad" type="number" class="form-control form-control-sm" value="' + (v('radius','') || 50) + '"></div>' +
            '<div class="col-12"><div class="form-check"><input type="checkbox" class="form-check-input" id="locActive"' + (v('active',true) ? ' checked' : '') + '><label class="form-check-label" for="locActive">Active</label></div></div>' +
          '</div><div id="locStatus" class="mt-2"></div></div>' +
          '<div class="modal-footer"><button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancel</button>' +
            '<button class="btn btn-primary btn-sm" onclick="app.saveLocation()"><i class="bi bi-check2"></i> Save</button></div>' +
        '</div></div></div>';
      const old = document.getElementById('locModal'); if (old) old.remove();
      document.body.insertAdjacentHTML('beforeend', html);
      new bootstrap.Modal(document.getElementById('locModal')).show();
      app.locGeoToggle();
    };

    app.locGeoToggle = function () {
      const on = document.getElementById('locGeo').checked;
      ['locLatWrap', 'locLngWrap', 'locRadWrap'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; });
    };

    app.saveLocation = async function () {
      const status = document.getElementById('locStatus');
      const geofenced = document.getElementById('locGeo').checked;
      const payload = {
        name: document.getElementById('locName').value.trim(),
        geofenced: geofenced ? 'Yes' : 'No',
        latitude: geofenced ? document.getElementById('locLat').value.trim() : '',
        longitude: geofenced ? document.getElementById('locLng').value.trim() : '',
        radius: geofenced ? document.getElementById('locRad').value : '',
        active: document.getElementById('locActive').checked ? 'Yes' : 'No'
      };
      if (!payload.name) { status.innerHTML = '<div class="alert alert-warning mb-0 py-1">Name required.</div>'; return; }
      try {
        const d = await callPost('saveLocation', payload);
        status.innerHTML = '<div class="alert alert-success mb-0 py-1">' + d.message + '</div>';
        setTimeout(() => { const m = bootstrap.Modal.getInstance(document.getElementById('locModal')); if (m) m.hide(); app.loadLocations(); }, 1000);
      } catch (err) { status.innerHTML = '<div class="alert alert-danger mb-0 py-1">' + err.message + '</div>'; }
    };

    app.editLocationShifts = async function (location) {
      let allShifts = [], current = [];
      try { const sr = await callApi('method=getShifts'); allShifts = (sr.data || []).filter(s => s.active).map(s => s.name); } catch (e) {}
      try { const lr = await callApi('method=getLocations'); const row = (lr.data || []).find(x => x.name === location); current = row && row.shifts ? row.shifts : []; } catch (e) {}
      const opts = allShifts.map(s => '<option value="' + s + '"' + (current.indexOf(s) !== -1 ? ' selected' : '') + '>' + s + '</option>').join('');
      const html =
        '<div class="modal fade" id="locShModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content">' +
          '<div class="modal-header"><h5 class="modal-title">Shifts at ' + location + '</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>' +
          '<div class="modal-body">' +
            '<label class="form-label small mb-1">Select shift(s) for this location (Ctrl/Cmd-click for multiple)</label>' +
            '<select id="locShSelect" class="form-select" multiple size="8">' + opts + '</select>' +
            '<div class="text-muted small mt-2">Staff checking in here get the location shift whose start time is closest to their check-in.</div>' +
            '<div id="locShStatus" class="mt-2"></div>' +
          '</div>' +
          '<div class="modal-footer"><button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancel</button>' +
            '<button class="btn btn-primary btn-sm" onclick="app.saveLocationShifts(\'' + location.replace(/'/g,"\\'") + '\')"><i class="bi bi-check2"></i> Save</button></div>' +
        '</div></div></div>';
      const old = document.getElementById('locShModal'); if (old) old.remove();
      document.body.insertAdjacentHTML('beforeend', html);
      new bootstrap.Modal(document.getElementById('locShModal')).show();
    };

    app.saveLocationShifts = async function (location) {
      const sel = document.getElementById('locShSelect');
      const names = Array.from(sel.selectedOptions).map(o => o.value);
      const status = document.getElementById('locShStatus');
      try {
        const d = await callPost('saveLocationShifts', { location: location, shifts: names.join(',') });
        status.innerHTML = '<div class="alert alert-success mb-0 py-1">' + d.message + '</div>';
        setTimeout(() => { const m = bootstrap.Modal.getInstance(document.getElementById('locShModal')); if (m) m.hide(); }, 1000);
      } catch (err) { status.innerHTML = '<div class="alert alert-danger mb-0 py-1">' + err.message + '</div>'; }
    };

    app.editSupervisors = async function (location) {
      let emps = [], current = [];
      try { const er = await callApi('method=getManualAttnEmployees'); emps = er.employees || []; } catch (e) {}
      try {
        const sr = await callApi('method=getLocationSupervisors');
        const row = (sr.data || []).find(x => String(x.location).trim().toLowerCase() === String(location).trim().toLowerCase());
        current = row ? row.supervisors.map(s => String(s.id).trim()) : [];
      } catch (e) {}
      const curSet = {}; current.forEach(id => curSet[id] = true);
      const checks = emps.map(e =>
        '<div class="form-check"><input class="form-check-input sup-chk" type="checkbox" value="' + e.id + '" id="sup_' + e.id + '"' + (curSet[e.id] ? ' checked' : '') + '>' +
        '<label class="form-check-label" for="sup_' + e.id + '">' + e.name + ' (' + e.id + ')</label></div>').join('');
      const html =
        '<div class="modal fade" id="supModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content">' +
          '<div class="modal-header"><h5 class="modal-title">Supervisors — ' + location + '</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>' +
          '<div class="modal-body">' +
            '<div class="d-flex justify-content-between align-items-center mb-2"><span class="small text-muted">Tick everyone who supervises this location. You can select multiple.</span>' +
              '<input type="text" id="supFilter" class="form-control form-control-sm" style="width:150px" placeholder="filter…" oninput="app.filterSupChecks()"></div>' +
            '<div id="supList" style="max-height:320px;overflow:auto;border:1px solid #eee;border-radius:6px;padding:8px">' + checks + '</div>' +
            '<div id="supStatus" class="mt-2"></div>' +
          '</div>' +
          '<div class="modal-footer"><button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancel</button>' +
            '<button class="btn btn-primary btn-sm" onclick="app.saveSupervisors(\'' + location.replace(/'/g,"\\'") + '\')"><i class="bi bi-check2"></i> Save</button></div>' +
        '</div></div></div>';
      const old = document.getElementById('supModal'); if (old) old.remove();
      document.body.insertAdjacentHTML('beforeend', html);
      new bootstrap.Modal(document.getElementById('supModal')).show();
    };

    app.filterSupChecks = function () {
      const q = (document.getElementById('supFilter').value || '').toLowerCase();
      document.querySelectorAll('#supList .form-check').forEach(fc => {
        const t = fc.innerText.toLowerCase();
        fc.style.display = t.indexOf(q) !== -1 ? '' : 'none';
      });
    };

    app.saveSupervisors = async function (location) {
      const ids = Array.from(document.querySelectorAll('#supList .sup-chk:checked')).map(c => c.value);
      const status = document.getElementById('supStatus');
      try {
        const d = await callPost('saveLocationSupervisors', { location: location, supervisorIds: ids.join(',') });
        status.innerHTML = '<div class="alert alert-success mb-0 py-1">' + d.message + ' (' + ids.length + ' supervisor' + (ids.length === 1 ? '' : 's') + ')</div>';
        setTimeout(() => { const m = bootstrap.Modal.getInstance(document.getElementById('supModal')); if (m) m.hide(); }, 1000);
      } catch (err) { status.innerHTML = '<div class="alert alert-danger mb-0 py-1">' + err.message + '</div>'; }
    };

    app.retireLocation = async function (name) {
      if (!confirm('Retire location "' + name + '"?')) return;
      try { await callApi('method=deleteLocation&name=' + encodeURIComponent(name)); app.loadLocations(); }
      catch (err) { alert(err.message); }
    };
  })();
})();
