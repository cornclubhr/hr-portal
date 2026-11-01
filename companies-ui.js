// ============================================================
// companies-ui.js — Companies page: the brands this organisation runs
// ------------------------------------------------------------
// index.html (after locations-ui.js):  <script src="companies-ui.js"></script>
// Backend: getCompanies, saveCompany, deleteCompany.
//
// Company and Location are INDEPENDENT. Several brands share a location —
// one food hall can hold five of them — so this page never filters or nests
// the Location list, and the Location page never filters this one.
//
// Changing a company here changes the header dropdown, which scopes every
// other screen.
// ============================================================

(function () {
  const EXEC_URL = CONFIG.API_URL;
  let COMPANIES = [];

  async function callApi(qs) {
    const res = await fetch(EXEC_URL + '?' + qs + '&_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    if (!d.success) throw new Error(d.error || 'Unknown error');
    return d;
  }
  async function callPost(method, body) {
    const res = await fetch(EXEC_URL + '?method=' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ token: HRSession.token }, body))
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    if (!d.success) throw new Error(d.error || 'Unknown error');
    return d;
  }
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  document.addEventListener('DOMContentLoaded', function () {
    const navList = document.querySelector('#sidebar ul.nav');
    if (navList && !document.querySelector('[data-page="companies"]')) {
      const li = document.createElement('li');
      li.className = 'nav-item';
      li.innerHTML = '<a class="nav-link" data-page="companies"><i class="bi bi-building"></i> Companies</a>';
      const loc = document.querySelector('[data-page="locations"]');
      if (loc && loc.closest('li')) loc.closest('li').insertAdjacentElement('beforebegin', li);
      else navList.appendChild(li);
      li.querySelector('.nav-link').addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        const pg = document.getElementById('page-companies');
        if (pg) pg.classList.add('active');
        document.getElementById('pageTitle').innerText = 'Companies';
        if (app.loadCompanies) app.loadCompanies();
      });
    }

    const anchor = document.getElementById('page-dashboard');
    if (anchor && anchor.parentElement && !document.getElementById('page-companies')) {
      const s = document.createElement('div');
      s.className = 'page-section';
      s.id = 'page-companies';
      s.innerHTML =
        '<div class="table-container">' +
          '<div class="d-flex justify-content-between align-items-center mb-3">' +
            '<h5><i class="bi bi-building"></i> Companies</h5>' +
            '<button class="btn btn-primary btn-sm" onclick="app.openCompany()">' +
              '<i class="bi bi-plus-lg"></i> New Company</button>' +
          '</div>' +
          '<div id="cmpTableWrap" class="table-responsive">' +
            '<div class="text-muted small">Loading…</div></div>' +
          '<div class="text-muted small mt-2">Each company is paid separately. ' +
            'Its <b>CR Number</b> and <b>Bank Account</b> appear on that company\'s ' +
            'bank transfer sheet. Locations are shared across companies and are ' +
            'managed on the Locations page.</div>' +
        '</div>' +
        // editor
        '<div class="modal fade" id="cmpModal" tabindex="-1"><div class="modal-dialog">' +
          '<div class="modal-content"><div class="modal-header">' +
            '<h5 class="modal-title" id="cmpModalTitle">Company</h5>' +
            '<button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
          '<div class="modal-body">' +
            '<input type="hidden" id="cmpOriginalName">' +
            '<div class="mb-2"><label class="form-label">Name</label>' +
              '<input id="cmpName" class="form-control" placeholder="e.g. Corn Club"></div>' +
            '<div class="mb-2"><label class="form-label">Short Code</label>' +
              '<input id="cmpShort" class="form-control" placeholder="used in tab names, e.g. CORN"></div>' +
            '<div class="mb-2"><label class="form-label">CR Number</label>' +
              '<input id="cmpCr" class="form-control"></div>' +
            '<div class="mb-2"><label class="form-label">Bank Account</label>' +
              '<input id="cmpBank" class="form-control"></div>' +
            '<div class="mb-2"><label class="form-label">Status</label>' +
              '<select id="cmpStatus" class="form-select">' +
                '<option value="Active">Active</option>' +
                '<option value="Inactive">Inactive</option></select></div>' +
            '<div class="mb-2"><label class="form-label">Notes</label>' +
              '<textarea id="cmpNotes" class="form-control" rows="2"></textarea></div>' +
            '<div id="cmpMsg" class="small"></div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>' +
            '<button class="btn btn-primary" onclick="app.saveCompany()">Save</button>' +
          '</div></div></div></div>';
      anchor.parentElement.appendChild(s);
    }
  });

  (function attach() {
    if (typeof app === 'undefined') return setTimeout(attach, 50);

    app.loadCompanies = async function () {
      const wrap = document.getElementById('cmpTableWrap');
      if (!wrap) return;
      wrap.innerHTML = '<div class="text-muted small">Loading…</div>';
      try {
        const d = await callApi('method=getCompanies');
        COMPANIES = d.data || [];
        if (!COMPANIES.length) {
          wrap.innerHTML = '<div class="text-muted small">No companies yet. ' +
            'Add the first one to start scoping payroll and reports.</div>';
          return;
        }
        wrap.innerHTML =
          '<table class="table table-sm align-middle"><thead><tr>' +
            '<th>Name</th><th>Short Code</th><th>CR Number</th>' +
            '<th>Bank Account</th><th>Status</th><th></th>' +
          '</tr></thead><tbody>' +
          COMPANIES.map(c =>
            '<tr>' +
              '<td><b>' + esc(c.name) + '</b></td>' +
              '<td>' + esc(c.shortCode) + '</td>' +
              '<td>' + esc(c.crNumber) + '</td>' +
              '<td>' + esc(c.bankAccount) + '</td>' +
              '<td>' + (String(c.status).toLowerCase() === 'inactive'
                ? '<span class="badge bg-secondary">Inactive</span>'
                : '<span class="badge bg-success">Active</span>') + '</td>' +
              '<td class="text-end">' +
                '<button class="btn btn-sm btn-outline-secondary" ' +
                  'onclick="app.openCompany(\'' + esc(c.name).replace(/'/g, "\\'") + '\')">Edit</button> ' +
                '<button class="btn btn-sm btn-outline-danger" ' +
                  'onclick="app.deleteCompany(\'' + esc(c.name).replace(/'/g, "\\'") + '\')">Delete</button>' +
              '</td>' +
            '</tr>').join('') +
          '</tbody></table>';
      } catch (err) {
        wrap.innerHTML = '<div class="text-danger small">' + esc(err.message) + '</div>';
      }
    };

    app.openCompany = function (name) {
      const c = COMPANIES.find(x => x.name === name) || {};
      document.getElementById('cmpModalTitle').innerText = name ? 'Edit Company' : 'New Company';
      document.getElementById('cmpOriginalName').value = c.name || '';
      document.getElementById('cmpName').value = c.name || '';
      document.getElementById('cmpShort').value = c.shortCode || '';
      document.getElementById('cmpCr').value = c.crNumber || '';
      document.getElementById('cmpBank').value = c.bankAccount || '';
      document.getElementById('cmpStatus').value = c.status || 'Active';
      document.getElementById('cmpNotes').value = c.notes || '';
      document.getElementById('cmpMsg').innerHTML = '';
      new bootstrap.Modal(document.getElementById('cmpModal')).show();
    };

    app.saveCompany = async function () {
      const msg = document.getElementById('cmpMsg');
      const name = document.getElementById('cmpName').value.trim();
      if (!name) { msg.innerHTML = '<span class="text-danger">Name is required.</span>'; return; }
      msg.innerHTML = '<span class="text-muted">Saving…</span>';
      try {
        const d = await callPost('saveCompany', {
          name: name,
          originalName: document.getElementById('cmpOriginalName').value,
          shortCode: document.getElementById('cmpShort').value.trim(),
          crNumber: document.getElementById('cmpCr').value.trim(),
          bankAccount: document.getElementById('cmpBank').value.trim(),
          status: document.getElementById('cmpStatus').value,
          notes: document.getElementById('cmpNotes').value.trim()
        });
        msg.innerHTML = '<span class="text-success">' + esc(d.message) + '</span>';
        await app.loadCompanies();
        // the header dropdown is built from this list, so refresh it too
        await HRSession.renderCompanyPicker(document.getElementById('companyPicker'));
        setTimeout(() => {
          const m = bootstrap.Modal.getInstance(document.getElementById('cmpModal'));
          if (m) m.hide();
        }, 700);
      } catch (err) {
        msg.innerHTML = '<span class="text-danger">' + esc(err.message) + '</span>';
      }
    };

    app.deleteCompany = async function (name) {
      if (!confirm('Delete "' + name + '"?\n\nThis is refused while any employee is ' +
                   'still in it. Set it to Inactive instead if you want to keep the history.')) return;
      try {
        const d = await callPost('deleteCompany', { name: name });
        alert(d.message);
        await app.loadCompanies();
        await HRSession.renderCompanyPicker(document.getElementById('companyPicker'));
      } catch (err) {
        alert(err.message);
      }
    };

    // The header dropdown scopes this page too — reload when it changes.
    document.addEventListener('hr:companychange', function () {
      const pg = document.getElementById('page-companies');
      if (pg && pg.classList.contains('active') && app.loadCompanies) app.loadCompanies();
    });
  })();
})();
