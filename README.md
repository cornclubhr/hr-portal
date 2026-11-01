# HR system — deployment runbook

A standalone HR system for an organisation that runs
**several companies** and pays on **two cycles a month**.

Nothing in here is shared with any other deployment. There are no spreadsheet
ids, email addresses, endpoints or company names in the code — all of it comes
from configuration you set once.

---

## What is different from the system this came from

| | |
|---|---|
| **Multiple companies** | `Company` is a first-class field. A dropdown in the header scopes every screen. Companies are managed on their own page, not listed in code. |
| **Company and Location are independent** | Several brands share one location, so neither dropdown filters the other. |
| **Two payroll cycles** | Each employee carries a cycle. Each cycle defines its own period window in the `Payroll_Cycles` tab. Payroll runs once per company per cycle. |
| **Two-stage OT approval** | Staff submit → a supervisor approves → the HR manager approves. Only the second approval makes overtime payable. |
| **Server-side authentication** | The web app is open because the kiosk needs it, so a gate in `Auth.js` guards every non-kiosk method. |
| **No WhatsApp punch, no QR terminals** | Removed. Everyone checks in from the kiosk link. |

---

## Setup, in order

### 1. The workbook

Create an empty Google Sheet. **Do not copy an existing one** — a copy brings
the other company's data with it.

### 2. The script

```
mkdir ~/hr-gas && cd ~/hr-gas
clasp login                      # as the account that will own this system
clasp create --type sheets --title "HR Backend"
```

Copy everything from `gas/` into that folder, then:

```
clasp push
```

### 3. First run

In the Sheet: **Extensions → Apps Script**, then run `setupNewDeployment()`.

It creates every tab with the right headers, seeds `Admin_Settings`, and records
the workbook id. It is safe to run again — it only adds what is missing.

### 4. Who can do what

**File → Project Settings → Script Properties**:

| Property | Meaning |
|---|---|
| `ADMIN_EMAILS` | full access. **Until this is set, every non-kiosk method is refused.** |
| `HR_MANAGER_EMAILS` | final OT approval, payroll, company and cycle changes |
| `SUPERVISOR_EMAILS` | first-stage OT approval only |

To limit someone to certain brands, add a row to `Admin_Settings`:

```
COMPANY_SCOPE_someone@example.com = Corn Club, Dark
```

That is a ceiling, not a preference — they cannot widen it by asking for
another company.

### 5. Companies and cycles

Add the companies on the **Companies** page — name, short code, CR number, bank
account.

Then the cycles, on the `Payroll_Cycles` tab. For staff paid on the 12th and the
24th, with each run covering the month up to two days before pay day:

| Cycle | Name | Period Start Day | Period End Day | Pay Day |
|---|---|---|---|---|
| 12 | Paid on the 12th | 11 | 10 | 12 |
| 24 | Paid on the 24th | 23 | 22 | 24 |

A period ending on a day earlier than it starts wraps into the previous month,
which is handled. **Confirm these windows before the first run** — they decide
which days each person is paid for.

### 6. Deploy the web app

**Deploy → New deployment → Web app**
- Execute as: **Me**
- Who has access: **Anyone**

"Anyone" is required for the kiosk link. It is not the security boundary — the
gate in `Auth.js` is. Copy the `/exec` URL.

### 7. The frontend

Put `web/` in a GitHub repository with Pages enabled, then fill in three values
in `config.js`:

```javascript
API_URL: '<the /exec URL from step 6>',
GOOGLE_CLIENT_ID: '<from Google Cloud Console>',
AUTHORIZED_EMAILS: ['...'],
```

The page refuses to pretend it works if any of those are blank.

`AUTHORIZED_EMAILS` decides what the browser **shows**. The server checks the
address again and issues the session, so keep the two lists aligned but never
rely on the browser one.

### 8. Import the roster

1. Open `import/naeem_import_staging.csv` and fill the empty columns —
   see below for which.
2. Paste it into a tab called `_Import_Staging`, headers in row 1.
3. Run `previewImportEmployees()`. It writes nothing and tells you exactly what
   it would do, and what is missing.
4. Fix what it reports, then `commitImportEmployees()`.

### 9. Before going live

Run `checkDeployment()`. It reports, rather than stopping at the first problem:

- configuration that is not set
- missing tabs
- employees with no company or no cycle — **they would be in no payroll run**
- employees in a company that is not on the Companies tab
- employees on a cycle that does not exist

---

## What the import brings, and what it cannot

Reconciled from four workbooks: **1,182 rows across 15 tabs describing 198
people**, the same person on up to five tabs with conflicting values.

**Comes through:** employee id, name, Civil ID, company, location, Civil ID
expiry, passport expiry, health card expiry, visa expiry and status,
nationality, remarks. Document-expiry alerting works on day one.

**Not in the source data at all — payroll cannot run without it:**

| Missing | Why it matters |
|---|---|
| **Basic Salary** | no pay can be calculated |
| **Date of Join** | leave entitlement and end-of-service |
| **IBAN** | no bank transfer file |
| **Payroll Cycle** | the person falls into neither run |
| Food allowance, accommodation | allowances |
| Shift | attendance comparison |
| Mobile | PIN delivery and notifications |

**Known gaps in the source**, all listed by the preview:

- **11 people have no company** — they would be in no payroll run
- **75 have no location**
- **5 have no name** (`HR-EMP-00205` … `00209`, all Corn Club)
- **15 have no Civil ID**
- **267 conflicting values** across the tabs — every one is in
  `import/naeem_conflicts.csv` with the value chosen, where it came from, and
  what the alternatives were. Worth a read before committing.
- **32 rows in Visa Status match nobody.** They look like candidates in the
  recruitment pipeline rather than current staff — confirm before discarding.

---

## Day to day

**Payroll**, once per company per cycle:

1. Pick the company in the header dropdown.
2. Payroll review → choose the cycle and period end.
3. Check the figures, then run.
4. The run writes `Payroll <Company> C<Cycle> <dates>` and the matching
   `Bank <Company> C<Cycle> <dates>`.

Each run records its own company and cycle, so the next run of that cycle picks
up exactly where it left off and never borrows the other cycle's dates.

**Overtime:**

1. Staff submit from the kiosk.
2. The supervisor sees their own companies' claims and passes or rejects them.
3. The HR manager sees what supervisors have passed, and decides.
4. Only then does it reach `OT_Entries`, and so payroll.

Either approver can correct the hours; the correction is recorded with who
changed it and when.

---

## Things worth knowing

**The sensitive columns** — Civil ID, Passport No, IBAN, PIN — are withheld from
API responses unless the caller is an admin or HR manager **and** asks for them.

**`setupNewDeployment()` is safe to re-run.** It adds missing tabs and headers
and never reorders or deletes.

**Timezone is `Asia/Kuwait`.**

**Currency is KWD**, set in `Admin_Settings`.

**Sign-out clears the session token**, so the next person at a shared machine
cannot keep using the last one.

---

## Verifying a change

```
python3 tools/check.py        # syntax, router integrity, no hardcoded values
node tools/test_auth.js       # the gate and company scoping
node tools/test_cycles.js     # period arithmetic
node tools/test_payroll_scope.js
node tools/test_ot.js         # the two-stage chain
node tools/test_session.js    # the frontend fetch wrapper
```

Or all of them: `tools/run_all.sh`
