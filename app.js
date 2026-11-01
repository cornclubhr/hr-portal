// ============================================================
// app.js - FINAL COMPLETE FIX
// ============================================================

const app = {
    employeesData: [],
    employeesTable: null,
    filters: { status: '', branch: '' },
    _empFilterPushed: false,
    
    // ============================================================
    // CORE DATA FUNCTIONS
    // ============================================================

    async init() {
        console.log("Initializing App...");
        this.setupSidebarNavigation();

        // Changing the company in the header reloads whatever is on screen.
        // Registered once — init() runs again on re-login, and a duplicate
        // handler would double every request.
        if (!this._companyHookInstalled && window.HRSession) {
            this._companyHookInstalled = true;
            HRSession.onCompanyChange(() => {
                console.log('Company scope changed to:', HRSession.company);
                this.loadAllData();
                // Let any open list screen refresh itself. Each *-ui.js module
                // listens for this rather than being wired in here by name.
                document.dispatchEvent(new CustomEvent('hr:companychange', {
                    detail: { company: HRSession.companyParam }
                }));
            });
        }
        await this.loadAllData();
    },

    async loadAllData() {
        console.log("Fetching data from API...");
        const tbody = document.getElementById('employeesTableBody');
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Loading data...</td></tr>';

        try {
            // ✅ FIXED: Manually appending the URL to bypass proxy issues
            const url = CONFIG.API_URL + '?method=getEmployeesFull&_=' + Date.now();
            
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'Unknown API error');
            
            this.employeesData = result.data;
            console.log(`Received ${this.employeesData.length} employees`);
            
            this.renderEmployees();
            this.updateDashboardStats();
        } catch (error) {
            console.error("Failed to load data:", error);
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Error loading data: ${error.message}</td></tr>`;
        }
    },

    // ---- DATES -----------------------------------------------------
    // The sheet returns real date cells, so JSON gives us an ISO stamp
    // ("2026-12-19T21:00:00.000Z"), which is the day before in UTC for a
    // Kuwait date. Everything the user sees is dd-mm-yyyy; date inputs
    // need yyyy-mm-dd. Both readers below accept either shape plus what
    // the sheet sends, so no screen shows a raw stamp again.
    parseAnyDate(v) {
        if (v == null || v === '') return null;
        if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
        const s = String(v).trim();
        let m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);            // dd-mm-yyyy
        if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
        m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);               // dd/mm/yyyy
        if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
        m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);                // yyyy-mm-dd
        if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {                        // ISO stamp
            const d = new Date(s);
            return isNaN(d.getTime()) ? null : d;                     // local time = Kuwait day
        }
        return null;
    },
    fmtDate(v) {
        const d = this.parseAnyDate(v);
        if (!d) return (v == null ? '' : String(v));                  // leave anything else alone
        const p = (n) => String(n).padStart(2, '0');
        return p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear();
    },
    toInputDate(v) {
        const d = this.parseAnyDate(v);
        if (!d) return '';
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    },

    renderEmployees() {
        const tbody = document.getElementById('employeesTableBody');
        tbody.innerHTML = '';
        if (!this.employeesData || this.employeesData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center">No employees found.</td></tr>';
            return;
        }

        this.employeesData.forEach(emp => {
            const row = `
                <tr>
                    <td>${emp['Employee ID'] || '-'}</td>
                    <td>${emp['Name (English)'] || 'Unknown'}</td>
                    <td>${emp['Name (Arabic)'] || '-'}</td>
                    <td>${emp['Civil ID'] || '-'}</td>
                    <td>${emp['Designation'] || '-'}</td>
                    <td>${emp['Gross Salary'] || 0}</td>
                    <td>${emp['Remaining Vacation'] || 0}</td>
                    <td><span class="status-badge ${(emp.Status || 'active').toLowerCase()}">${emp.Status || 'Active'}</span></td>
                    <td><button class="btn btn-sm btn-outline-primary me-1" onclick="app.viewProfile('${emp['Employee ID'] || ''}')" title="View"><i class="bi bi-eye"></i></button><button class="btn btn-sm btn-outline-secondary" onclick="app.editEmployee('${emp['Employee ID'] || ''}')" title="Edit"><i class="bi bi-pencil"></i></button></td>
                </tr>
            `;
            tbody.innerHTML += row;
        });

        if ($.fn.dataTable) {
            if (this.employeesTable) this.employeesTable.destroy();
            this.employeesTable = $('#employeesTable').DataTable({ pageLength: 10, responsive: true, order: [[0, 'asc']] });
        }
        try { this.setupEmployeeFilters(); } catch (e) { console.warn('Employee filter setup skipped:', e); }
    },

    // ---- EMPLOYEE LIST FILTERS — ERPNext-style filter builder (list-filter.js) ----
    setupEmployeeFilters() {
        try {
            if (window.ListFilter && this.employeesTable && this.employeesData && this.employeesData.length) {
                ListFilter.attachData('employeesTable', {
                    records: this.employeesData,
                    rowKey: 'Employee ID',
                    keyColIdx: 0,
                    exclude: ['Actions']
                });
            }
        } catch (e) { console.warn('Filter setup skipped:', e); }
    },

    updateDashboardStats() {
        const total = this.employeesData.length;
        const active = this.employeesData.filter(e => e.Status === 'Active').length;
        document.getElementById('totalEmployees').innerText = total;
        document.getElementById('activeEmployees').innerText = active;
        document.getElementById('pendingLeaves').innerText = '0';
        document.getElementById('avgRating').innerText = '0.0';
    },

    setupSidebarNavigation() {
        document.querySelectorAll('#sidebar .nav-link').forEach(link => {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active'));
                this.classList.add('active');
                const pageId = this.dataset.page;
                document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
                const targetSection = document.getElementById(`page-${pageId}`);
                if(targetSection) targetSection.classList.add('active');
                document.getElementById('pageTitle').innerText = pageId.charAt(0).toUpperCase() + pageId.slice(1);
                // Reflect the latest sheet data whenever these pages are opened.
                if ((pageId === 'employees' || pageId === 'dashboard') && app.loadAllData) app.loadAllData();
            });
        });
    },

    // ============================================================
    // ✅ REQUESTED CHANGES: VIEW PROFILE (ALL DETAILS)
    // ============================================================

    // ============================================================
    // DEDICATED EMPLOYEE PAGE (replaces the modal for view/edit)
    // ============================================================
    currentEmp: null,
    currentEmpGrants: [],

    viewProfile(employeeId) { this.openEmployeePage(employeeId, 'view'); },
    editEmployee(employeeId) { this.openEmployeePage(employeeId, 'edit'); },

    async openEmployeePage(employeeId, mode) {
        if (!employeeId) return;
        // Ensure location list for the Location dropdown.
        if (!this.LOCATION_NAMES) {
            try {
                const lr = await fetch(this.EXEC_URL + '?method=getLocations&_=' + Date.now(), { cache: 'no-store' });
                const ld = await lr.json();
                this.LOCATION_NAMES = (ld.success && ld.data) ? ld.data.filter(l => l.active).map(l => l.name) : [];
            } catch (e) { this.LOCATION_NAMES = []; }
        }
        // Company and payroll cycle lists for their dropdowns. Both come from
        // their own tabs — never a list written into this file.
        if (!this.COMPANY_NAMES) {
            try {
                const cr = await fetch(this.EXEC_URL + '?method=getCompanies&_=' + Date.now(), { cache: 'no-store' });
                const cd = await cr.json();
                this.COMPANY_NAMES = (cd.success && cd.data) ? cd.data.map(c => c.name) : [];
            } catch (e) { this.COMPANY_NAMES = []; }
        }
        if (!this.CYCLE_OPTIONS) {
            try {
                const yr = await fetch(this.EXEC_URL + '?method=getPayrollCycles&_=' + Date.now(), { cache: 'no-store' });
                const yd = await yr.json();
                this.CYCLE_OPTIONS = (yd.success && yd.data)
                    ? yd.data.map(c => c.cycle) : [];
            } catch (e) { this.CYCLE_OPTIONS = []; }
        }
        if (!this.DESIGNATION_NAMES) {
            try {
                const dr = await fetch(this.EXEC_URL + '?method=getDesignations&_=' + Date.now(), { cache: 'no-store' });
                const dd = await dr.json();
                this.DESIGNATION_NAMES = (dd.success && dd.data) ? dd.data : [];
            } catch (e) { this.DESIGNATION_NAMES = []; }
        }
        document.querySelectorAll('#sidebar .nav-link').forEach(l => l.classList.remove('active'));
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        document.getElementById('page-profile').classList.add('active');
        document.getElementById('pageTitle').innerText = 'Employee';
        document.getElementById('profileContent').innerHTML = '<div class="text-muted p-4">Loading ' + employeeId + '…</div>';
        try {
            const res = await fetch(this.EXEC_URL + '?method=getEmployeeById&employeeId=' + encodeURIComponent(employeeId) + '&_=' + Date.now(), { cache: 'no-store' });
            const d = await res.json();
            if (!d.success) throw new Error(d.error || 'Not found');
            this.currentEmp = d.data || {};
            this.currentEmpGrants = [];
            try {
                const gr = await fetch(this.EXEC_URL + '?method=getLeaveGrants&empId=' + encodeURIComponent(employeeId) + '&_=' + Date.now(), { cache: 'no-store' });
                const gd = await gr.json(); if (gd.success) this.currentEmpGrants = gd.data || [];
            } catch (e) { /* grants optional */ }
            this.renderEmployeePage(mode || 'view');
        } catch (err) { document.getElementById('profileContent').innerHTML = '<div class="alert alert-danger m-3">Could not load ' + employeeId + ': ' + err.message + '</div>'; }
    },

    renderEmployeePage(mode) {
        const r = this.currentEmp || {};
        const g = (k) => (r[k] != null && r[k] !== '' ? r[k] : '');
        const editing = mode === 'edit';
        const id = g('Employee ID');
        const toInputDate = (s) => this.toInputDate(s);

        // field renderer: read-only span or input depending on mode
        const F = (label, key, opts) => {
            opts = opts || {};
            const val = g(key);
            let control;
            if (editing && !opts.readonly) {
                if (opts.type === 'date') control = '<input type="date" id="ep_' + opts.id + '" class="form-control form-control-sm" value="' + toInputDate(val) + '">';
                else if (opts.type === 'select') control = '<select id="ep_' + opts.id + '" class="form-select form-select-sm">' + opts.options.map(o => '<option' + (String(val)===o ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>';
                else control = '<input type="' + (opts.type || 'text') + '" id="ep_' + opts.id + '" class="form-control form-control-sm" value="' + String(val).replace(/"/g,'&quot;') + '">';
            } else {
                const shown = (opts.type === 'date') ? app.fmtDate(val) : val;
                control = '<span class="profile-info-value' + (opts.strong ? ' fw-bold' : '') + '">' + (shown || '<span class="text-muted">—</span>') + '</span>';
            }
            return '<div class="profile-info-item"><span class="profile-info-label">' + label + '</span>' + control + '</div>';
        };
        const link = (label, key) => {
            const v = g(key);
            const ctrl = v ? '<a href="' + v + '" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right"></i> View</a>' : '<span class="text-muted">—</span>';
            return '<div class="profile-info-item"><span class="profile-info-label">' + label + '</span><span class="profile-info-value">' + ctrl + '</span></div>';
        };

        const statusVal = g('Status') || 'Active';
        const grantsHtml = (this.currentEmpGrants && this.currentEmpGrants.length)
            ? '<table class="table table-sm table-striped mb-0"><thead><tr><th>Type</th><th>Start</th><th>End</th><th class="text-end">Days</th><th>Status</th></tr></thead><tbody>' +
              this.currentEmpGrants.map(x => '<tr><td>' + x.type + '</td><td>' + this.fmtDate(x.start) + '</td><td>' + this.fmtDate(x.end) + '</td><td class="text-end">' + x.days + '</td><td>' + x.status + '</td></tr>').join('') + '</tbody></table>'
            : '<div class="text-muted small">No leave grants recorded.</div>';

        const buttons = editing
            ? '<button class="btn btn-success btn-sm" onclick="app.saveEmployeePage()"><i class="bi bi-check2"></i> Save</button> ' +
              '<button class="btn btn-outline-secondary btn-sm" onclick="app.renderEmployeePage(\'view\')">Cancel</button>'
            : '<button class="btn btn-primary btn-sm" onclick="app.renderEmployeePage(\'edit\')"><i class="bi bi-pencil"></i> Edit</button> ' +
              '<button class="btn btn-outline-secondary btn-sm" onclick="app.backToEmployees()"><i class="bi bi-arrow-left"></i> Back to list</button>';

        const html =
            '<div class="profile-header">' +
              '<div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">' +
                '<div><h4 class="mb-0">' + (g('Name (English)') || 'Unknown') + '</h4>' +
                  '<div class="text-muted">' + id + (g('PIN') ? ' · PIN ' + g('PIN') : '') + ' · <span class="status-badge ' + statusVal.toLowerCase().replace(/ /g,'') + '">' + statusVal + '</span></div></div>' +
                '<div>' + buttons + '</div>' +
              '</div>' +
              '<div id="epStatus"></div>' +
              '<div class="row g-4">' +
                '<div class="col-lg-6">' +
                  '<h6 class="text-primary"><i class="bi bi-person"></i> Personal</h6>' +
                  F('Name (English)','Name (English)',{id:'nameEnglish'}) +
                  F('Name (Arabic)','Name (Arabic)',{id:'nameArabic'}) +
                  F('Civil ID','Civil ID',{id:'civilId'}) +
                  // Company and Location are independent — several brands share
                  // one location, so neither dropdown filters the other.
                  F('Company','Company',{id:'company',type:'select',options:(app.COMPANY_NAMES||[])}) +
                  F('Location','Location',{id:'branch',type:'select',options:(app.LOCATION_NAMES||[])}) +
                  F('Payroll Cycle','Payroll Cycle',{id:'payrollCycle',type:'select',options:(app.CYCLE_OPTIONS||[])}) +
                  F('Designation','Designation',{id:'designation',type:'select',options:(app.DESIGNATION_NAMES||[])}) +
                  F('Shift','Shift',{id:'shift'}) +
                  F('Status','Status',{id:'status',type:'select',options:['Active','On Leave','Inactive']}) +
                  '<h6 class="text-primary mt-3"><i class="bi bi-telephone"></i> Contact</h6>' +
                  F('Email','Email',{id:'email',type:'email'}) +
                  F('Mobile','Mobile',{id:'mobile'}) +
                  F('WhatsApp','WhatsApp',{id:'whatsapp'}) +
                  '<h6 class="text-primary mt-3"><i class="bi bi-bank"></i> Bank</h6>' +
                  F('IBAN','IBAN',{id:'iban'}) +
                '</div>' +
                '<div class="col-lg-6">' +
                  '<h6 class="text-primary"><i class="bi bi-file-earmark-text"></i> Documents</h6>' +
                  F('Passport No','Passport No',{id:'passportNo'}) +
                  F('CID Expiry','CID Expiry',{id:'cidExpiry',type:'date'}) +
                  F('Passport Issue','Passport Issue',{id:'passportIssue',type:'date'}) +
                  F('Passport Expiry','Passport Expiry',{id:'passportExpiry',type:'date'}) +
                  F('Health Issue','Health Issue',{id:'healthIssue',type:'date'}) +
                  F('Health Expiry','Health Expiry',{id:'healthExpiry',type:'date'}) +
                  F('Date of Join','Date of Join',{id:'dateOfJoin',type:'date'}) +
                  link('Civil ID Copy','Civil ID Copy') +
                  link('Civil ID Back','Civil ID Back Copy') +
                  link('Passport Page','Passport Entry Page') +
                '</div>' +
              '</div>' +
              '<div class="row g-4 mt-1">' +
                '<div class="col-lg-6">' +
                  '<h6 class="text-success"><i class="bi bi-currency-exchange"></i> Salary</h6>' +
                  F('Basic Salary','Basic Salary',{id:'basic',type:'number'}) +
                  F('Gross Salary','Gross Salary',{readonly:true,strong:true}) +
                  F('Total Payable','Total Payable',{readonly:true,strong:true}) +
                  F('Price Per Hour','Price Per Hour',{readonly:true}) +
                  F('Price Per Day','Price Per Day',{readonly:true}) +
                '</div>' +
                '<div class="col-lg-6">' +
                  '<h6 class="text-success"><i class="bi bi-calendar-check"></i> Leave</h6>' +
                  F('Remaining Vacation','Remaining Vacation',{readonly:true,strong:true}) +
                  F('Vacation Taken','Vacation Taken',{readonly:true}) +
                  F('Sick Days Taken','Sick Days Taken',{readonly:true}) +
                  '<div class="mt-2">' + grantsHtml + '</div>' +
                '</div>' +
              '</div>' +
            '</div>';
        document.getElementById('profileContent').innerHTML = html;
    },

    backToEmployees() {
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        const emp = document.querySelector('[data-page="employees"]');
        if (emp) emp.click();
        else { document.getElementById('page-employees').classList.add('active'); this.loadAllData(); }
    },

    async saveEmployeePage() {
        const r = this.currentEmp || {};
        const eid = r['Employee ID'];
        const v = (id) => { const el = document.getElementById('ep_' + id); return el ? String(el.value || '').trim() : undefined; };
        const toDd = (s) => { s = String(s || '').trim(); const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); return m ? (m[3].padStart(2,'0') + '-' + m[2].padStart(2,'0') + '-' + m[1]) : s; };
        const status = document.getElementById('epStatus');
        const payload = { employeeId: eid };
        const put = (k, val) => { if (val !== undefined) payload[k] = val; };
        put('nameEnglish', v('nameEnglish')); put('nameArabic', v('nameArabic')); put('civilId', v('civilId'));
        put('branch', v('branch')); put('status', v('status')); put('iban', v('iban'));
        put('shift', v('shift'));
        put('designation', v('designation'));
        put('email', v('email')); put('mobile', v('mobile')); put('whatsapp', v('whatsapp'));
        put('passportNo', v('passportNo')); put('basic', v('basic'));
        ['cidExpiry','passportIssue','passportExpiry','healthIssue','healthExpiry','dateOfJoin'].forEach(k => { const val = v(k); if (val !== undefined) payload[k] = toDd(val); });
        try {
            const res = await fetch(this.EXEC_URL + '?method=saveEmployee', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
            const d = await res.json();
            if (!d.success) throw new Error(d.error || 'Save failed');
            status.innerHTML = '<div class="alert alert-success py-1"><i class="bi bi-check-circle"></i> ' + (d.message || 'Saved.') + '</div>';
            await this.openEmployeePage(eid, 'view');
            this.loadAllData();
        } catch (err) { status.innerHTML = '<div class="alert alert-danger py-1">' + err.message + '</div>'; }
    },

    // ============================================================
    // ✅ REQUESTED CHANGES: ADD EMPLOYEE MODAL
    // ============================================================

    // ---- ADD / EDIT EMPLOYEE (auto ID + PIN) ----
    EXEC_URL: CONFIG.API_URL,
    editingEmployeeId: '',

    resetEmployeeForm() {
        this.editingEmployeeId = '';
        const f = document.getElementById('employeeForm');
        if (f) f.reset();
        const title = document.getElementById('employeeModalTitle');
        if (title) title.innerText = 'Add Employee';
    },

    showAddEmployeeModal() {
        this.resetEmployeeForm();
        $('#employeeModal').modal('show');
    },

    async editEmployeeModal_unused(employeeId) {
        if (!employeeId) return;
        try {
            const res = await fetch(this.EXEC_URL + '?method=getEmployeeById&employeeId=' + encodeURIComponent(employeeId) + '&_=' + Date.now(), { cache: 'no-store' });
            const d = await res.json();
            if (!d.success) throw new Error(d.error || 'Not found');
            const r = d.data || {};
            const g = (k) => (r[k] != null ? r[k] : '');
            this.resetEmployeeForm();
            document.getElementById('empNameEnglish').value = g('Name (English)');
            document.getElementById('empNameArabic').value = g('Name (Arabic)');
            document.getElementById('empCivilId').value = g('Civil ID');
            var ibanEl = document.getElementById('empIban'); if (ibanEl) ibanEl.value = g('IBAN');
            document.getElementById('empSalary').value = g('Basic Salary');
            const st = document.getElementById('empStatus'); if (st) st.value = g('Status') || 'Active';
            // Document fields (from Staff Submission sync). Dates: dd-mm-yyyy -> yyyy-mm-dd for date inputs.
            const setV = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v == null ? '' : v); };
            const toInputDate = (s) => app.toInputDate(s);
            setV('empEmail', g('Email'));
            setV('empMobile', g('Mobile'));
            setV('empWhatsapp', g('WhatsApp'));
            setV('empPassport', g('Passport No'));
            setV('empCidExpiry', toInputDate(g('CID Expiry')));
            setV('empPassportIssued', toInputDate(g('Passport Issue')));
            setV('empPassportExpiry', toInputDate(g('Passport Expiry')));
            setV('empHealthIssued', toInputDate(g('Health Issue')));
            setV('empHealthExpiry', toInputDate(g('Health Expiry')));
            setV('empDateOfJoin', toInputDate(g('Date of Join')));
            this.editingEmployeeId = employeeId;
            const title = document.getElementById('employeeModalTitle');
            if (title) title.innerText = 'Edit Employee — ' + employeeId + (r['PIN'] ? '  (PIN ' + r['PIN'] + ')' : '');
            $('#employeeModal').modal('show');
        } catch (err) { alert('Could not load ' + employeeId + ': ' + err.message); }
    },

    async saveEmployee() {
        const nameEng = (document.getElementById('empNameEnglish').value || '').trim();
        const basic = document.getElementById('empSalary').value;
        const eid = this.editingEmployeeId;
        if (!eid && !nameEng) { alert('Name (English) is required.'); return; }
        if (!eid && !basic && !confirm('No Basic Salary entered — this employee cannot be run in payroll until it is set. Save anyway?')) return;

        const gv = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
        const toDdMmYyyy = (s) => { s = String(s || '').trim(); const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); return m ? (m[3].padStart(2,'0') + '-' + m[2].padStart(2,'0') + '-' + m[1]) : s; };
        const payload = {
            nameEnglish: nameEng,
            nameArabic: (document.getElementById('empNameArabic').value || '').trim(),
            civilId: (document.getElementById('empCivilId').value || '').trim(),
            iban: (document.getElementById('empIban') ? document.getElementById('empIban').value : '').trim(),
            basic: basic,
            status: document.getElementById('empStatus') ? document.getElementById('empStatus').value : 'Active',
            email: gv('empEmail'),
            mobile: gv('empMobile'),
            whatsapp: gv('empWhatsapp'),
            passportNo: gv('empPassport'),
            cidExpiry: toDdMmYyyy(gv('empCidExpiry')),
            passportIssue: toDdMmYyyy(gv('empPassportIssued')),
            passportExpiry: toDdMmYyyy(gv('empPassportExpiry')),
            healthIssue: toDdMmYyyy(gv('empHealthIssued')),
            healthExpiry: toDdMmYyyy(gv('empHealthExpiry')),
            dateOfJoin: toDdMmYyyy(gv('empDateOfJoin'))
        };
        if (eid) payload.employeeId = eid;

        try {
            const res = await fetch(this.EXEC_URL + '?method=saveEmployee', {
                method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload)
            });
            const d = await res.json();
            if (!d.success) throw new Error(d.error || 'Save failed');
            if (d.edited) alert(d.message);
            else alert('Employee added.\n\nID: ' + d.employeeId + '\nPIN: ' + d.pin + '\n\n(Note the PIN \u2014 it is auto-generated.)');
            $('#employeeModal').modal('hide');
            this.resetEmployeeForm();
            await this.loadAllData();
        } catch (err) { alert('Save failed: ' + err.message); }
    },

    // ============================================================
    // ✅ REQUESTED CHANGES: 4-STAGE ATTENDANCE MODAL
    // ============================================================

    showAttendanceModal() {
        // Reset fields
        document.getElementById('attendanceEmployeeSelect').innerHTML = '<option value="" disabled selected>Select an employee...</option>';
        document.getElementById('attendanceEmployeeSearch').value = '';
        document.getElementById('attendanceEmployeeName').value = '';
        document.getElementById('attendanceDate').value = '';
        document.getElementById('attendanceStage').value = '';
        
        // Populate dropdown
        if (this.employeesData && this.employeesData.length > 0) {
            this.employeesData.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp['Employee ID'];
                opt.innerText = `${emp['Employee ID']} - ${emp['Name (English)']}`;
                document.getElementById('attendanceEmployeeSelect').appendChild(opt);
            });
        }
        $('#attendanceModal').modal('show'); 
    },

    filterAttendanceEmployeeList() {
        const search = document.getElementById('attendanceEmployeeSearch').value.toLowerCase();
        const options = document.getElementById('attendanceEmployeeSelect').options;
        for(let i=0; i<options.length; i++){
            const txt = options[i].innerText.toLowerCase();
            options[i].style.display = txt.includes(search) ? 'block' : 'none';
        }
    },

    selectAttendanceEmployee() {
        const select = document.getElementById('attendanceEmployeeSelect');
        const empId = select.value;
        const emp = this.employeesData.find(e => e['Employee ID'] === empId);
        document.getElementById('attendanceEmployeeName').value = emp ? emp['Name (English)'] : '';
    },

    setAttendanceStage(stage) {
        document.getElementById('attendanceStage').value = stage;
    },

    submitAttendance() {
        const empId = document.getElementById('attendanceEmployeeSelect').value;
        if(!empId) return alert("Please select an employee.");
        
        const stage = document.getElementById('attendanceStage').value;
        if(!stage) return alert("Please select a stage (Check In, Break Out, etc.).");
        
        const date = document.getElementById('attendanceDate').value;
        if(!date) return alert("Please select a date.");
        
        const emp = this.employeesData.find(e => e['Employee ID'] === empId);
        alert(`Attendance Logged:\nEmployee: ${emp ? emp['Name (English)'] : empId}\nDate: ${date}\nStage: ${stage}`);
        $('#attendanceModal').modal('hide');
    },

    // ============================================================
    // ✅ REQUESTED CHANGES: SEARCHABLE LEAVE + BALANCE
    // ============================================================

    showLeaveRequestModal() {
        document.getElementById('leaveEmployeeSelect').innerHTML = '<option value="" disabled selected>Select an employee...</option>';
        document.getElementById('leaveEmployeeSearch').value = '';
        document.getElementById('leaveEmployeeName').innerText = '-';
        document.getElementById('leaveBalanceDisplay').innerText = '0 days';
        document.getElementById('leaveErrorDisplay').innerText = '';
        document.getElementById('leaveForm').reset();
        
        if (this.employeesData && this.employeesData.length > 0) {
            this.employeesData.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp['Employee ID'];
                opt.innerText = `${emp['Employee ID']} - ${emp['Name (English)']}`;
                document.getElementById('leaveEmployeeSelect').appendChild(opt);
            });
        }
        $('#leaveModal').modal('show'); 
    },

    filterLeaveEmployeeList() {
        const search = document.getElementById('leaveEmployeeSearch').value.toLowerCase();
        const options = document.getElementById('leaveEmployeeSelect').options;
        for(let i=0; i<options.length; i++){
            const txt = options[i].innerText.toLowerCase();
            options[i].style.display = txt.includes(search) ? 'block' : 'none';
        }
    },

    selectLeaveEmployee() {
        const select = document.getElementById('leaveEmployeeSelect');
        const empId = select.value;
        const emp = this.employeesData.find(e => e['Employee ID'] === empId);
        if(emp) {
            document.getElementById('leaveEmployeeName').innerText = emp['Name (English)'];
            document.getElementById('leaveBalanceDisplay').innerText = `${emp['Remaining Vacation'] || 0} days`;
        }
    },

    submitLeaveRequest() {
        const empId = document.getElementById('leaveEmployeeSelect').value;
        if(!empId) return alert("Please search and select an employee from the list.");
        
        const emp = this.employeesData.find(e => e['Employee ID'] === empId);
        const startDate = new Date(document.getElementById('leaveStart').value);
        const endDate = new Date(document.getElementById('leaveEnd').value);
        
        if (!document.getElementById('leaveStart').value || !document.getElementById('leaveEnd').value) {
            return alert("Please fill in start and end dates.");
        }
        if (endDate < startDate) {
            return alert("End date cannot be before start date.");
        }
        
        const timeDiff = endDate.getTime() - startDate.getTime();
        const daysRequested = Math.ceil(timeDiff / (1000 * 3600 * 24)) + 1;
        const remaining = emp['Remaining Vacation'] || 0;

        if (daysRequested > remaining) {
            document.getElementById('leaveErrorDisplay').innerText = `ERROR: You cannot apply for ${daysRequested} days. Only ${remaining} days available.`;
            return;
        }
        
        document.getElementById('leaveErrorDisplay').innerText = '';
        alert(`Leave Approved!\n${emp['Name (English)']} requested ${daysRequested} days.\nRemaining balance will be: ${remaining - daysRequested}`);
        $('#leaveModal').modal('hide');
    },

    // ============================================================
    // PERFORMANCE REVIEW
    // ============================================================

    showReviewModal() { 
        $('#reviewModal').modal('show'); 
    },
    submitReview() { 
        alert("Submit review feature coming soon"); 
    }
};
