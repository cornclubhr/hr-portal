// ============================================================
// roster-view-ui.js — Roster: every location's roster, for HR
// ------------------------------------------------------------
// One line in index.html, after the other *-ui.js files:
//   <script src="roster-view-ui.js"></script>
//
// Supervisors build and publish rosters on roster.html, one location each.
// HR had nowhere to see what they had built. This page shows all of it,
// read-only, on the admin dashboard:
//   • a coverage card per location — how much of the range is published,
//     still draft, or not rostered at all, and who last published it
//   • the grid: every man × every date, with his shift or Day Off
//   • for days already past, what actually happened, and a red mark where
//     the roster and reality disagree (rostered to work → absent; rostered
//     off → worked)
//
// Backend: getRosterOverview (RosterOverview.gs). Changes nothing.
// ============================================================

(function () {
  const EXEC_URL = CONFIG.API_URL;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const pad = n => String(n).padStart(2, '0');
  const isoToDd = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return d + '-' + m + '-' + y; };
  const dateToIso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const ddToDate = dd => { const [d, m, y] = dd.split('-'); return new Date(+y, +m - 1, +d); };

  async function callApi(qs) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(EXEC_URL + '?' + qs + '&_=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const d = await res.json(); if (!d.success) throw new Error(d.error || 'Unknown error'); return d;
      } catch (e) { if (attempt === 1) throw e; await new Promise(r => setTimeout(r, 800)); }
    }
  }

  const CSS = `
  .rsv-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:14px}
  .rsv-toolbar label{font-size:11px;color:var(--hr-muted,#667);display:block;margin-bottom:2px}
  .rsv-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin-bottom:18px}
  .rsv-card{background:var(--hr-card-bg,#fff);border:1px solid var(--hr-card-border,#dde);border-radius:12px;padding:12px 14px;cursor:pointer}
  .rsv-card:hover{border-color:var(--hr-accent,#2aa)}
  .rsv-card h6{margin:0 0 2px;font-size:14px;font-weight:600}
  .rsv-card .sup{font-size:11px;color:var(--hr-muted,#667);margin-bottom:8px;min-height:15px}
  .rsv-bar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:#f1d7d7;margin-bottom:6px}
  .rsv-bar .p{background:var(--hr-accent,#2aa)} .rsv-bar .d{background:#e3b341}
  .rsv-card .nums{font-size:11.5px;display:flex;gap:10px;flex-wrap:wrap}
  .rsv-card .nums b{font-weight:600}
  .rsv-card .last{font-size:11px;color:var(--hr-muted,#667);margin-top:6px}
  .rsv-card.none{border-color:#e6a5a5;background:#fff8f8}
  .rsv-card .alert-line{font-size:11.5px;color:#b02a37;font-weight:600;margin-top:4px}
  .rsv-loc{margin-bottom:22px}
  .rsv-loc h5{font-size:15px;font-weight:600;margin:0 0 8px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
  .rsv-loc h5 small{font-weight:400;color:var(--hr-muted,#667);font-size:12px}
  .rsv-scroll{overflow-x:auto;border:1px solid var(--hr-card-border,#dde);border-radius:10px;background:var(--hr-card-bg,#fff)}
  table.rsv{border-collapse:separate;border-spacing:0;font-size:12px;min-width:100%}
  table.rsv th,table.rsv td{border-bottom:1px solid var(--hr-row-sep,#eee);padding:4px 5px;text-align:center;white-space:nowrap}
  table.rsv th{font-weight:600;font-size:11px;color:var(--hr-muted,#667);background:var(--hr-card-bg,#fff);position:sticky;top:0}
  table.rsv th.today,table.rsv td.today{background:#eef8f8}
  table.rsv th.wk{color:#9a6b00}
  table.rsv .who{position:sticky;left:0;background:var(--hr-card-bg,#fff);text-align:left;z-index:1;min-width:150px;max-width:190px;overflow:hidden;text-overflow:ellipsis}
  table.rsv .who small{display:block;color:var(--hr-muted,#667);font-size:10px}
  .rsv-c{display:inline-block;min-width:54px;padding:3px 4px;border-radius:6px;font-weight:600;font-size:11px;line-height:1.25}
  .rsv-c.w{background:#e3f4f4;color:#12615f}
  .rsv-c.off{background:#eef0f2;color:#556}
  .rsv-c.draft{background:#fff !important;border:1.5px dashed #c99a1e;color:#8a6508;font-style:italic}
  .rsv-c.gap{background:#fdeeee;color:#b02a37;font-weight:400}
  .rsv-c.mis{outline:2px solid #d63344;outline-offset:1px}
  .rsv-c .act{display:block;font-size:9.5px;font-weight:500;color:#667;font-style:normal}
  .rsv-c.mis .act{color:#b02a37;font-weight:700}
  .rsv-c .amd{color:#c26b00}
  .rsv-legend{font-size:11.5px;color:var(--hr-muted,#667);display:flex;gap:12px;flex-wrap:wrap;margin:-4px 0 14px}
  .rsv-legend .rsv-c{min-width:0;padding:1px 6px}
  @media (prefers-color-scheme: dark){ }
  `;

  document.addEventListener('DOMContentLoaded', function () {
    const navList = document.querySelector('#sidebar ul.nav');
    if (!navList || document.querySelector('[data-page="rosterview"]')) return;

    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    // Nav item, right after Shifts — same two-letter style as the rest.
    const li = document.createElement('li');
    li.className = 'nav-item';
    li.innerHTML = '<a class="nav-link" data-page="rosterview" title="Roster">RS</a>';
    const sh = document.querySelector('[data-page="shifts"]');
    if (sh && sh.closest('li')) sh.closest('li').insertAdjacentElement('afterend', li);
    else navList.appendChild(li);
    li.querySelector('.nav-link').addEventListener('click', function (e) {
      e.preventDefault();
      document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active'));
      this.classList.add('active');
      document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
      const pg = document.getElementById('page-rosterview'); if (pg) pg.classList.add('active');
      const t = document.getElementById('pageTitle'); if (t) t.innerText = 'Roster';
      const g = document.getElementById('pageGroup'); if (g) g.innerText = 'Time';
      if (!loaded) load();
    });

    const anchor = document.getElementById('page-dashboard');
    if (!anchor || !anchor.parentElement) return;
    const s = document.createElement('div');
    s.className = 'page-section'; s.id = 'page-rosterview';
    s.innerHTML =
      '<div class="table-container">' +
        '<div class="rsv-toolbar">' +
          '<div><label>From</label><input type="date" id="rsvFrom" class="form-control form-control-sm"></div>' +
          '<div><label>To</label><input type="date" id="rsvTo" class="form-control form-control-sm"></div>' +
          '<div><label>Location</label><select id="rsvLoc" class="form-select form-select-sm" style="min-width:190px"><option value="">All locations</option></select></div>' +
          '<div class="btn-group btn-group-sm">' +
            '<button class="btn btn-outline-secondary" data-w="-1">Last week</button>' +
            '<button class="btn btn-outline-secondary" data-w="0">This week</button>' +
            '<button class="btn btn-outline-secondary" data-w="1">Next week</button>' +
          '</div>' +
          '<button class="btn btn-primary btn-sm" id="rsvGo"><i class="bi bi-arrow-repeat"></i> Show</button>' +
        '</div>' +
        '<div class="rsv-legend">' +
          '<span><span class="rsv-c w">First</span> published</span>' +
          '<span><span class="rsv-c draft">First</span> draft — not published</span>' +
          '<span><span class="rsv-c off">Off</span> day off</span>' +
          '<span><span class="rsv-c gap">—</span> not rostered</span>' +
          '<span><span class="rsv-c w mis">First</span> roster and attendance disagree</span>' +
          '<span>Under each past day: P present · A absent · O day off · L leave</span>' +
        '</div>' +
        '<div id="rsvCards"></div>' +
        '<div id="rsvGrids"><div class="text-muted small">Loading…</div></div>' +
      '</div>';
    anchor.parentElement.appendChild(s);

    s.querySelectorAll('[data-w]').forEach(b => b.addEventListener('click', () => { setWeek(+b.dataset.w); load(); }));
    s.querySelector('#rsvGo').addEventListener('click', load);
    s.querySelector('#rsvLoc').addEventListener('change', render);
    setWeek(0);
  });

  let loaded = false, DATA = null;

  function setWeek(offset) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const sun = new Date(t.getTime() - t.getDay() * 86400000 + offset * 7 * 86400000);
    document.getElementById('rsvFrom').value = dateToIso(sun);
    document.getElementById('rsvTo').value = dateToIso(new Date(sun.getTime() + 6 * 86400000));
  }

  async function load() {
    loaded = true;
    const from = isoToDd(document.getElementById('rsvFrom').value);
    const to = isoToDd(document.getElementById('rsvTo').value);
    document.getElementById('rsvGrids').innerHTML = '<div class="text-muted small">Loading…</div>';
    document.getElementById('rsvCards').innerHTML = '';
    try {
      DATA = await callApi('method=getRosterOverview&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to));
      const sel = document.getElementById('rsvLoc'), keep = sel.value;
      sel.innerHTML = '<option value="">All locations</option>' +
        DATA.locations.map(l => '<option' + (l.location === keep ? ' selected' : '') + '>' + esc(l.location) + '</option>').join('');
      render();
    } catch (e) {
      document.getElementById('rsvGrids').innerHTML = '<div class="alert alert-danger mb-0">' + esc(e.message) + '</div>';
    }
  }

  function render() {
    if (!DATA) return;
    const only = document.getElementById('rsvLoc').value;
    const locs = DATA.locations.filter(l => !only || l.location === only);

    // ── Coverage cards ──
    document.getElementById('rsvCards').innerHTML = '<div class="rsv-cards">' + locs.map(l => {
      const pct = x => l.total ? (100 * x / l.total).toFixed(1) : 0;
      const none = l.filled === 0;
      return '<div class="rsv-card' + (none ? ' none' : '') + '" data-go="' + esc(l.location) + '">' +
        '<h6>' + esc(l.location) + '</h6>' +
        '<div class="sup">' + (l.supervisors.length ? esc(l.supervisors.join(', ')) : 'no supervisor set') + '</div>' +
        '<div class="rsv-bar"><div class="p" style="width:' + pct(l.published) + '%"></div>' +
          '<div class="d" style="width:' + pct(l.draft) + '%"></div></div>' +
        '<div class="nums"><span><b>' + l.published + '</b> published</span>' +
          (l.draft ? '<span style="color:#8a6508"><b>' + l.draft + '</b> draft</span>' : '') +
          '<span style="color:#b02a37"><b>' + l.missing + '</b> not rostered</span></div>' +
        (none ? '<div class="alert-line">Nothing rostered for these dates.</div>' : '') +
        (l.mismatch ? '<div class="alert-line">' + l.mismatch + ' day(s) roster ≠ attendance</div>' : '') +
        '<div class="last">' + (l.lastPublishedBy ? 'Last published by ' + esc(l.lastPublishedBy) + ', ' + esc(l.lastPublishedOn)
                                                  : 'Never published in this range') + ' · ' + l.staffCount + ' staff</div>' +
      '</div>';
    }).join('') + '</div>';
    document.querySelectorAll('.rsv-card[data-go]').forEach(c => c.addEventListener('click', () => {
      const el = document.getElementById('rsv-' + slug(c.dataset.go));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));

    // ── Grids ──
    const head = '<tr><th class="who">Employee</th>' + DATA.dates.map(d => {
      const dt = ddToDate(d), wk = dt.getDay() === 5 || dt.getDay() === 6;
      return '<th class="' + (d === DATA.today ? 'today ' : '') + (wk ? 'wk' : '') + '">' +
        DOW[dt.getDay()] + '<br>' + d.slice(0, 5) + '</th>';
    }).join('') + '</tr>';

    document.getElementById('rsvGrids').innerHTML = locs.map(l => {
      const body = l.rows.map(r => '<tr><td class="who" title="' + esc(r.name + ' · ' + r.id) + '">' + esc(r.name) +
        '<small>' + esc(r.id) + (r.homeLocation && r.homeLocation !== l.location ? ' · from ' + esc(r.homeLocation) : '') + '</small></td>' +
        r.cells.map(c => cell(c, l.location)).join('') + '</tr>').join('');
      return '<div class="rsv-loc" id="rsv-' + slug(l.location) + '">' +
        '<h5>' + esc(l.location) + '<small>' + l.staffCount + ' staff · ' + l.published + ' published · ' +
          l.draft + ' draft · ' + l.missing + ' not rostered</small></h5>' +
        (l.rows.length ? '<div class="rsv-scroll"><table class="rsv"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>'
                       : '<div class="text-muted small">No rosterable staff.</div>') +
      '</div>';
    }).join('') || '<div class="text-muted small">Nothing to show.</div>';
  }

  function cell(c, loc) {
    const td = '<td' + (c.d === DATA.today ? ' class="today"' : '') + '>';
    const act = c.act ? '<span class="act">' + esc(c.act.code) + '</span>' : '';
    if (c.empty) {
      const tip = 'Not rostered' + (c.act ? ' — actual: ' + c.act.text : '');
      return td + '<span class="rsv-c gap" title="' + esc(tip) + '">—' + act + '</span></td>';
    }
    const cls = ['rsv-c', c.status === 'Day Off' ? 'off' : 'w'];
    if (c.state !== 'Published') cls.push('draft');
    if (c.mismatch) cls.push('mis');
    const tip = [
      (c.status === 'Day Off' ? 'Day Off' : c.shift) + ' — ' + (c.state === 'Published' ? 'published' : 'DRAFT, not published'),
      c.by ? 'by ' + c.by + (c.on ? ', ' + c.on : '') : '',
      c.amendedBy ? 'amended by ' + c.amendedBy + (c.amendedOn ? ', ' + c.amendedOn : '') + (c.reason ? ': ' + c.reason : '') : '',
      c.act ? 'actual: ' + c.act.text : '',
    ].filter(Boolean).join('\n');
    return td + '<span class="' + cls.join(' ') + '" title="' + esc(tip) + '">' + esc(c.label) +
      (c.amendedBy ? '<span class="amd">*</span>' : '') + act + '</span></td>';
  }

  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
})();
