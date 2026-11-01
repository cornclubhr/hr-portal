// ============================================================
// list-filter.js — ERPNext-style stackable filter bar for DataTables lists
// ------------------------------------------------------------
// Generic, reusable. Attach to any DataTable by table id. Reads the table's
// column headers as fields, infers each column's type from its cell values
// (number / date / text), offers type-appropriate operators, and AND-stacks
// multiple conditions. Filtering is done via a DataTables ext.search hook
// against visible cell text.
//
// Usage (once the DataTable exists):
//   ListFilter.attach('employeesTable', { exclude: ['Actions'] });
//
// index.html:  <script src="list-filter.js"></script>  (after jQuery + DataTables)
// ============================================================

window.ListFilter = (function () {
  const registry = {}; // tableId -> { conditions: [], colTypes: {}, headers: [] }
  let hookPushed = false;

  const OPERATORS = {
    text: [['like', 'contains'], ['=', 'equals'], ['!=', 'not equals'], ['is set', 'is set'], ['is not set', 'is not set']],
    number: [['=', '='], ['!=', '≠'], ['>', '>'], ['<', '<'], ['>=', '≥'], ['<=', '≤'], ['is set', 'is set'], ['is not set', 'is not set']],
    date: [['=', 'on'], ['>', 'after'], ['<', 'before'], ['>=', 'on/after'], ['<=', 'on/before'], ['is set', 'is set'], ['is not set', 'is not set']]
  };

  function parseNum(v) { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; }
  function parseDate(v) {
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/); if (m) return new Date(+m[3], +m[2]-1, +m[1]).getTime();
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return new Date(+m[1], +m[2]-1, +m[3]).getTime();
    const t = Date.parse(s); return isNaN(t) ? null : t;
  }
  function looksDate(v) { return /^\d{1,2}-\d{1,2}-\d{4}$/.test(String(v).trim()) || /^\d{4}-\d{1,2}-\d{1,2}/.test(String(v).trim()); }

  function inferType(table, colIdx) {
    const rows = table.rows({ search: 'none' }).data ? null : null; // avoid API quirks; sample DOM
    const cells = $('#' + table.table().node().id + ' tbody tr td:nth-child(' + (colIdx + 1) + ')').slice(0, 40);
    let nums = 0, dates = 0, nonEmpty = 0;
    cells.each(function () {
      const t = $(this).text().trim(); if (!t) return;
      nonEmpty++;
      if (looksDate(t)) dates++;
      else if (parseNum(t) !== null && /\d/.test(t) && !/[a-zA-Z]{2,}/.test(t)) nums++;
    });
    if (nonEmpty === 0) return 'text';
    if (dates / nonEmpty > 0.6) return 'date';
    if (nums / nonEmpty > 0.6) return 'number';
    return 'text';
  }

  function cellText(rowData, idx) {
    const v = rowData[idx];
    // DataTables may hand back HTML (e.g. Actions/badges) — strip tags.
    return String(v == null ? '' : v).replace(/<[^>]*>/g, '').trim();
  }

  function matchCond(type, cellVal, op, val) {
    const empty = cellVal === '';
    if (op === 'is set') return !empty;
    if (op === 'is not set') return empty;
    if (val === '' && op !== 'is set' && op !== 'is not set') return true; // no value → ignore
    if (type === 'number') {
      const a = parseNum(cellVal), b = parseNum(val);
      if (a === null || b === null) return false;
      switch (op) { case '=': return a === b; case '!=': return a !== b; case '>': return a > b; case '<': return a < b; case '>=': return a >= b; case '<=': return a <= b; }
      return true;
    }
    if (type === 'date') {
      const a = parseDate(cellVal), b = parseDate(val);
      if (a === null || b === null) return false;
      switch (op) { case '=': return a === b; case '>': return a > b; case '<': return a < b; case '>=': return a >= b; case '<=': return a <= b; }
      return true;
    }
    // text
    const c = cellVal.toLowerCase(), v = String(val).toLowerCase();
    switch (op) { case 'like': return c.indexOf(v) !== -1; case '=': return c === v; case '!=': return c !== v; }
    return true;
  }

  function ensureHook() {
    if (hookPushed || !$.fn.dataTable) return;
    $.fn.dataTable.ext.search.push(function (settings, rowData) {
      const reg = registry[settings.nTable.id];
      if (!reg || !reg.conditions.length) return true;
      if (reg.dataMode) {
        const key = String(rowData[reg.keyColIdx] || '').replace(/<[^>]*>/g, '').trim();
        const rec = reg.recByKey[key];
        if (!rec) return true;
        for (const cond of reg.conditions) {
          if (!cond.field) continue;
          const cv = String(rec[cond.field] == null ? '' : rec[cond.field]).trim();
          if (!matchCond(reg.fieldTypes[cond.field] || 'text', cv, cond.op, cond.val)) return false;
        }
        return true;
      }
      for (const cond of reg.conditions) {
        if (cond.col == null) continue;
        const cv = cellText(rowData, cond.col);
        if (!matchCond(reg.colTypes[cond.col] || 'text', cv, cond.op, cond.val)) return false;
      }
      return true;
    });
    hookPushed = true;
  }

  function opsFor(type) { return (OPERATORS[type] || OPERATORS.text).map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join(''); }

  function renderBar(tableId) {
    const reg = registry[tableId];
    const barId = tableId + '_filterBar';
    let bar = document.getElementById(barId);
    if (!bar) {
      bar = document.createElement('div');
      bar.id = barId;
      bar.className = 'mb-3 p-2 border rounded bg-light';
      const table = document.getElementById(tableId);
      const wrapper = document.getElementById(tableId + '_wrapper');
      const container = table.closest('.table-container') || table.parentNode;
      const anchor = (wrapper && wrapper.parentNode === container) ? wrapper : table;
      container.insertBefore(bar, anchor);
    }
    const rowsHtml = reg.conditions.map((c, i) => {
      let type, fieldOpts, curKey;
      if (reg.dataMode) {
        curKey = c.field || '';
        type = c.field ? (reg.fieldTypes[c.field] || 'text') : 'text';
        fieldOpts = reg.fields.map(f => '<option value="' + f + '"' + (c.field === f ? ' selected' : '') + '>' + f + '</option>').join('');
      } else {
        curKey = c.col;
        type = c.col != null ? (reg.colTypes[c.col] || 'text') : 'text';
        fieldOpts = reg.headers.map((h, idx) => (reg._excludedIdx && reg._excludedIdx.indexOf(idx) !== -1) ? '' : '<option value="' + idx + '"' + (String(c.col) === String(idx) ? ' selected' : '') + '>' + h + '</option>').join('');
      }
      const valDisabled = (c.op === 'is set' || c.op === 'is not set') ? ' disabled' : '';
      return '<div class="row g-1 align-items-center mb-1" data-i="' + i + '">' +
        '<div class="col-auto small text-muted" style="width:38px">' + (i === 0 ? 'Where' : 'and') + '</div>' +
        '<div class="col-auto"><select class="form-select form-select-sm lf-field" onchange="ListFilter.onField(\'' + tableId + '\',' + i + ',this.value)"><option value="">field…</option>' + fieldOpts + '</select></div>' +
        '<div class="col-auto"><select class="form-select form-select-sm lf-op" onchange="ListFilter.onOp(\'' + tableId + '\',' + i + ',this.value)">' + opsFor(type) + '</select></div>' +
        '<div class="col-auto"><input class="form-control form-control-sm lf-val" value="' + String(c.val || '').replace(/"/g,'&quot;') + '"' + valDisabled + ' oninput="ListFilter.onVal(\'' + tableId + '\',' + i + ',this.value)" placeholder="value"></div>' +
        '<div class="col-auto"><button class="btn btn-outline-danger btn-sm" onclick="ListFilter.removeCond(\'' + tableId + '\',' + i + ')"><i class="bi bi-x"></i></button></div>' +
        '</div>';
    }).join('');
    bar.innerHTML =
      '<div class="d-flex justify-content-between align-items-center mb-1"><span class="small fw-bold"><i class="bi bi-funnel"></i> Filters</span>' +
        '<div><button class="btn btn-outline-primary btn-sm me-1" onclick="ListFilter.addCond(\'' + tableId + '\')"><i class="bi bi-plus"></i> Add filter</button>' +
        '<button class="btn btn-outline-secondary btn-sm" onclick="ListFilter.clearAll(\'' + tableId + '\')">Clear all</button></div></div>' +
      (rowsHtml || '<div class="small text-muted">No filters — click "Add filter".</div>');
    // set op selects to current values
    reg.conditions.forEach((c, i) => {
      const rowEl = bar.querySelector('[data-i="' + i + '"]');
      if (rowEl) { const opSel = rowEl.querySelector('.lf-op'); if (opSel) opSel.value = c.op; }
    });
  }

  function draw(tableId) { const t = $('#' + tableId).DataTable(); t.draw(); }

  return {
    // Data-backed attach: filter on ALL record fields (not just visible columns).
    attachData: function (tableId, opts) {
      opts = opts || {};
      ensureHook();
      const records = opts.records || [];
      const keyField = opts.rowKey || 'Employee ID';
      const keyColIdx = opts.keyColIdx == null ? 0 : opts.keyColIdx;
      let fields = opts.fields;
      if (!fields) {
        const seen = {};
        records.forEach(r => Object.keys(r).forEach(k => { seen[k] = true; }));
        fields = Object.keys(seen);
      }
      const drop = (opts.exclude || []).map(s => s.toLowerCase());
      fields = fields.filter(f => drop.indexOf(String(f).toLowerCase()) === -1);
      const fieldTypes = {};
      fields.forEach(f => {
        let nums = 0, dates = 0, nonEmpty = 0;
        for (let i = 0; i < records.length && i < 60; i++) {
          const v = records[i][f]; const t = String(v == null ? '' : v).trim();
          if (!t) continue; nonEmpty++;
          if (looksDate(t)) dates++;
          else if (parseNum(t) !== null && /\d/.test(t) && !/[a-zA-Z]{2,}/.test(t)) nums++;
        }
        fieldTypes[f] = nonEmpty === 0 ? 'text' : (dates / nonEmpty > 0.6 ? 'date' : (nums / nonEmpty > 0.6 ? 'number' : 'text'));
      });
      const recByKey = {};
      records.forEach(r => { recByKey[String(r[keyField] || '').trim()] = r; });
      registry[tableId] = {
        conditions: [], dataMode: true, fields: fields, fieldTypes: fieldTypes,
        recByKey: recByKey, keyColIdx: keyColIdx, keyField: keyField, headers: fields, colTypes: {}
      };
      renderBar(tableId);
    },

    attach: function (tableId, opts) {
      opts = opts || {};
      ensureHook();
      const table = $('#' + tableId).DataTable();
      const headers = [];
      $('#' + tableId + ' thead th').each(function () { headers.push($(this).text().trim()); });
      const exclude = (opts.exclude || []).map(s => s.toLowerCase());
      const colTypes = {};
      headers.forEach((h, idx) => { if (exclude.indexOf(h.toLowerCase()) === -1) colTypes[idx] = inferType(table, idx); });
      // Keep only filterable headers (map preserves index)
      const filterableHeaders = headers.map((h, idx) => (exclude.indexOf(h.toLowerCase()) === -1) ? h : null);
      registry[tableId] = { conditions: [], colTypes: colTypes, headers: filterableHeaders.map((h) => h) };
      // Replace nulls (excluded) with '' but keep index alignment by using placeholder that we skip in field list
      registry[tableId].headers = filterableHeaders.map(h => h === null ? '—' : h);
      registry[tableId]._excludedIdx = filterableHeaders.map((h, i) => h === null ? i : -1).filter(i => i >= 0);
      renderBar(tableId);
    },
    addCond: function (tableId) { const r = registry[tableId]; r.conditions.push(r.dataMode ? { field: '', op: 'like', val: '' } : { col: null, op: 'like', val: '' }); renderBar(tableId); },
    removeCond: function (tableId, i) { const r = registry[tableId]; r.conditions.splice(i, 1); renderBar(tableId); draw(tableId); },
    clearAll: function (tableId) { registry[tableId].conditions = []; renderBar(tableId); draw(tableId); },
    onField: function (tableId, i, val) {
      const r = registry[tableId]; const c = r.conditions[i];
      let type;
      if (r.dataMode) { c.field = val || ''; type = c.field ? (r.fieldTypes[c.field] || 'text') : 'text'; }
      else { c.col = val === '' ? null : parseInt(val, 10); type = c.col != null ? (r.colTypes[c.col] || 'text') : 'text'; }
      const ops = (OPERATORS[type] || OPERATORS.text);
      if (!ops.some(o => o[0] === c.op)) c.op = ops[0][0];
      renderBar(tableId); draw(tableId);
    },
    onOp: function (tableId, i, val) { registry[tableId].conditions[i].op = val; renderBar(tableId); draw(tableId); },
    onVal: function (tableId, i, val) { registry[tableId].conditions[i].val = val; draw(tableId); }
  };
})();
