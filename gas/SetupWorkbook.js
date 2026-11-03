/**
 * SetupWorkbook.js — first-run setup for a fresh deployment.
 *
 * Builds an EMPTY workbook with the right tabs and headers. It never copies an
 * existing workbook, because a copy carries the other company's data with it.
 *
 * Run setupNewDeployment() once from the script editor, then fill in the
 * Script Properties it tells you about.
 */

/**
 * Tabs and their headers.
 *
 * Only tabs that need a fixed header shape are listed. The rest are created on
 * demand by the module that owns them, which keeps the definition next to the
 * code that reads it.
 */
const SETUP_TABS = {
  [HR_TAB]: [
    'Employee ID', 'Name (English)', 'Name (Arabic)', 'Company', 'Payroll Cycle',
    'Location', 'Designation', 'Shift', 'Status', 'Date of Join',
    'Basic Salary', 'Food Allowance', 'Accommodation', 'Conveyance', 'Bonus',
    'Gross Salary', 'Price Per Hour', 'Price Per Day',
    'Civil ID', 'CID Expiry', 'Passport No', 'Passport Issue', 'Passport Expiry',
    'Health Card Expiry', 'Visa Expiry', 'Visa Status',
    'IBAN', 'Bank Name', 'Email', 'Mobile', 'WhatsApp', 'Nationality', 'PIN', 'Remark'
  ],
  'Companies': ['Name', 'Short Code', 'CR Number', 'Bank Account', 'Status', 'Notes'],
  'Payroll_Cycles': ['Cycle', 'Name', 'Period Start Day', 'Period End Day', 'Pay Day', 'Status', 'Notes'],
  // Header names are what the READERS resolve by: Code.js geofencing looks for
  // 'branch' and 'radius', and rbGetShiftsForLocation_ needs 'Shifts'. Matches
  // setupBranchLocations() in Code.js, plus Shifts.
  'Branch_Locations': ['Branch', 'Latitude', 'Longitude', 'Radius', 'Geofenced', 'Active', 'Shifts'],
  'Admin_Settings': ['Key', 'Value', 'Notes'],
  'Attendance_Daily': ['Employee ID', 'Name', 'Date', 'Location', 'Shift', 'Check In',
                       'Break Out', 'Break In', 'Check Out', 'Presence (hrs)', 'Late In',
                       'Early Out', 'Break Over', 'OT Hours', 'Day Type', 'Source',
                       'Status', 'Flags'],
  'OT_Pending': ['ID', 'Employee ID', 'Name', 'Date', 'Hours', 'Source', 'Status',
                 'Submitted', 'Geo Flag', 'Computed OT',
                 'Supervisor By', 'Supervisor At', 'Supervisor Note',
                 'HR By', 'HR At', 'HR Note'],
  'OT_Entries': ['Date', 'Employee ID', 'Name', 'OT Hours', 'Remark', 'Added By'],
  'Payroll_Control': ['Run Date', 'Period Start', 'Period End', 'Employees',
                      'Total OT Hours', 'Tab Name', 'Status', 'Company', 'Cycle'],
  'Scheduled_Deductions': ['ID', 'Employee ID', 'Name', 'Type', 'Amount', 'Month',
                           'Remark', 'Status', 'Applied In'],
  'Scheduled_Extras': ['ID', 'Employee ID', 'Name', 'Type', 'Amount', 'Month',
                       'Remark', 'Status', 'Applied In'],
  'Leave_Types': ['Name', 'Paid', 'Days Per Year', 'Carry Forward', 'Active', 'Notes'],
  'Leave_Grants': ['ID', 'Employee ID', 'Name', 'Type', 'Start', 'End', 'Days',
                   'Status', 'Approved By', 'Remark'],
  'Leave_Balances': ['Employee ID', 'Name', 'Type', 'Entitled', 'Taken', 'Balance'],
  // Exactly what ensureShiftsTab_() in Shifts.js creates, which is also what
  // acShifts_ and BackfillCheckouts resolve by. 'Hours' matched nothing.
  'Shifts': ['Shift Name', 'Start', 'End', 'Normal Hours', 'Break Minutes', 'Grace Minutes', 'Auto Present', 'Weekly Off', 'Active'],
  'Roster': ['Date', 'Employee ID', 'Name', 'Company', 'Location', 'Shift', 'Remark'],
  'Bank_Other_Payees': ['Name', 'Civil ID', 'IBAN', 'Amount (KD)', 'Location', 'Status', 'Remark'],
  'Doc_Expiry_Log': ['Date', 'Employee ID', 'Name', 'Document', 'Expiry', 'Days Left', 'Notified'],
  'Auth_Sessions': ['Token', 'Email', 'Role', 'Companies', 'Issued', 'Expires']
};

/** Settings seeded into Admin_Settings, with a note explaining each. */
const SETUP_SETTINGS = [
  ['ORG_NAME', '', 'Shown on payslips and vouchers'],
  ['GOOGLE_CLIENT_ID', '', 'OAuth client id from config.js — sign-in is REFUSED until this is set'],
  ['CURRENCY', 'KWD', 'Currency code'],
  ['EMPLOYEE_ID_PREFIX', 'HR-EMP-', 'Prefix for new employee ids'],
  ['EMPLOYEE_ID_DIGITS', '5', 'How many digits after the prefix'],
  ['OT_MAX_HOURS_PER_DAY', '12', 'An approver cannot pass more than this in one day'],
  ['NOTIFY_ENABLED', 'true', 'false silences every system email'],
  ['OT_COMPILER_EMAILS', '', 'Who receives the OT digest; falls back to HR managers']
];

/**
 * Create every tab and header in the CURRENT workbook, seed the settings, and
 * report what still has to be set by hand.
 *
 * Safe to re-run: existing tabs keep their data, and only missing headers are
 * added.
 */
function setupNewDeployment() {
  // Kept so an old instruction still works. The workbook now builds itself
  // when the sheet is opened or the web app is first called, so this is only
  // ever a manual re-check.
  const r = ensureWorkbook_(true);
  if (!r.ok) return { success: false, error: r.error };
  const b = r.built || {};
  const lines = [
    'Tabs created: ' + ((b.created || []).join(', ') || 'none'),
    'Tabs updated: ' + ((b.updated || []).join(', ') || 'none'),
    'Settings seeded: ' + (b.seeded || 0),
    b.ownerSeeded ? 'ADMIN_EMAILS seeded with the deployment owner.' : '',
    '',
    'Nothing was cleared or overwritten.'
  ].filter(Boolean);
  Logger.log(lines.join('\n'));
  return { success: true, created: b.created, updated: b.updated,
           seeded: b.seeded, message: lines.join('\n') };
}

/**
 * Seed the two payroll cycles. Days are arguments, not constants, because a
 * different company pays on different days.
 *
 * @param {Object} params { cycles: [{cycle,name,periodStartDay,periodEndDay,payDay}] }
 */
function setupPayrollCycles(params) {
  params = params || {};
  const list = params.cycles || [];
  if (!list.length) {
    return {
      success: false,
      error: 'Pass the cycles, e.g. { cycles: [' +
             '{cycle:"12", periodStartDay:11, periodEndDay:10, payDay:12}, ' +
             '{cycle:"24", periodStartDay:23, periodEndDay:22, payDay:24}] }'
    };
  }
  const done = [];
  list.forEach(function (c) {
    const r = savePayrollCycle({
      token: params.token, cycle: c.cycle, name: c.name,
      periodStartDay: c.periodStartDay, periodEndDay: c.periodEndDay,
      payDay: c.payDay, status: 'Active', notes: c.notes || ''
    });
    done.push(c.cycle + ': ' + (r.success ? 'ok' : r.error));
  });
  return { success: true, results: done };
}

/**
 * A health check to run before going live. Reports what is missing rather than
 * failing on the first problem.
 */
function checkDeployment() {
  const out = { success: true, ready: true, problems: [], notes: [] };
  function problem(s) { out.problems.push(s); out.ready = false; }

  try {
    const id = cfg_(CFG_KEYS.MAIN_SPREADSHEET_ID, '');
    if (!id) problem('MAIN_SPREADSHEET_ID is not set - run setupNewDeployment()');

    if (!adminEmails_().length) problem('ADMIN_EMAILS is empty - every admin method is refused');
    if (!hrManagerEmails_().length) out.notes.push('HR_MANAGER_EMAILS is empty - only admins can give final OT approval');
    if (!cfgList_('SUPERVISOR_EMAILS').length) out.notes.push('SUPERVISOR_EMAILS is empty - no one can do first-stage OT approval');

    const ss = openMain_();
    Object.keys(SETUP_TABS).forEach(function (t) {
      if (!ss.getSheetByName(t)) problem('Missing tab: ' + t);
    });

    const companies = companiesAll_();
    if (!companies.length) problem('No companies defined - add them on the Companies page');

    const cycles = cyclesAll_();
    if (!cycles.length) problem('No payroll cycles defined - add them on Payroll_Cycles');

    // Anyone without a company or cycle falls out of every payroll run.
    const all = empRows_({ status: 'Active' });
    const noCompany = all.filter(function (e) { return !e.company; });
    const noCycle = all.filter(function (e) { return !e.cycle; });
    if (noCompany.length) {
      problem(noCompany.length + ' active employee(s) have no Company and would be in no payroll run: ' +
              noCompany.slice(0, 5).map(function (e) { return e.id; }).join(', ') +
              (noCompany.length > 5 ? ' …' : ''));
    }
    if (noCycle.length) {
      problem(noCycle.length + ' active employee(s) have no Payroll Cycle: ' +
              noCycle.slice(0, 5).map(function (e) { return e.id; }).join(', ') +
              (noCycle.length > 5 ? ' …' : ''));
    }
    // A company named on an employee but missing from the Companies tab will
    // never appear in the dropdown, so those people become unreachable.
    const known = {};
    companies.forEach(function (c) { known[c.name.toLowerCase()] = 1; });
    const orphan = {};
    all.forEach(function (e) {
      if (e.company && !known[e.company.toLowerCase()]) orphan[e.company] = (orphan[e.company] || 0) + 1;
    });
    Object.keys(orphan).forEach(function (c) {
      problem('Employees are in "' + c + '" but it is not on the Companies tab (' + orphan[c] + ')');
    });

    const cycleKeys = {};
    cycles.forEach(function (c) { cycleKeys[c.cycle.toLowerCase()] = 1; });
    const badCycle = {};
    all.forEach(function (e) {
      if (e.cycle && !cycleKeys[String(e.cycle).toLowerCase()]) badCycle[e.cycle] = (badCycle[e.cycle] || 0) + 1;
    });
    Object.keys(badCycle).forEach(function (c) {
      problem('Employees are on cycle "' + c + '" which is not defined (' + badCycle[c] + ')');
    });

    out.summary = {
      employees: all.length, companies: companies.length, cycles: cycles.length,
      timeZone: Session.getScriptTimeZone()
    };
  } catch (err) {
    out.success = false;
    out.ready = false;
    out.error = err.toString();
  }
  return out;
}
