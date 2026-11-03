/**
 * Auth.js — the server-side gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * The web app must stay deployed as ANYONE_ANONYMOUS, because the kiosk link
 * has to work for staff with no Google account. In the system this was derived
 * from that meant every one of ~183 methods was callable by anyone who knew the
 * URL — including ones that return salaries and Civil IDs, and ones that write
 * IBANs. Google Sign-In on the frontend gates the screen, not the endpoint.
 *
 * So the gate lives here:
 *
 *   PUBLIC_METHODS  the handful the kiosk needs, open by design, each one
 *                   authenticating the employee itself by Employee ID + PIN
 *   everything else needs a session token, which is issued only to an address
 *                   in ADMIN_EMAILS / HR_MANAGER_EMAILS / SUPERVISOR_EMAILS
 *
 * A session also carries a COMPANY SCOPE. Employees.js applies it as a ceiling,
 * so a brand manager cannot read another brand by passing a different company.
 */

const AUTH_SESSION_TAB   = 'Auth_Sessions';
const AUTH_SESSION_HOURS = 12;

/**
 * Methods callable without a session.
 *
 * Every one of these authenticates the employee itself (Employee ID + PIN) or
 * returns nothing sensitive. Adding to this list opens a hole — do not add a
 * method here without reading what it returns and what it writes.
 */
const PUBLIC_METHODS = [
  'loginStaffKiosk',       // checks the PIN itself
  'markKioskAttendance',   // checks the PIN itself; also handles backdated Day Off
  'getDailyKioskStatus',   // own status only, no pay data
  'submitOtRequest',       // checks the PIN itself; writes a Pending row only
  'authLogin',             // the login endpoint itself
  'authPing'               // cheap liveness check for the frontend
];

/** Roles, most privileged first. A role implies every role below it. */
const AUTH_ROLES = ['admin', 'hr_manager', 'supervisor'];

/* ----------------------------------------------------------------- sessions */

function authSheet_() {
  const ss = openMain_();
  var sh = ss.getSheetByName(AUTH_SESSION_TAB);
  if (!sh) {
    sh = ss.insertSheet(AUTH_SESSION_TAB);
    sh.appendRow(['Token', 'Email', 'Role', 'Companies', 'Issued', 'Expires']);
    sh.getRange(1, 1, 1, 6).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideSheet();   // not secret, but not something to browse either
  }
  return sh;
}

function authToken_() {
  return Utilities.getUuid().replace(/-/g, '') +
         Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

/** Which role an address has, or '' if none. */
function authRoleFor_(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return '';
  if (adminEmails_().indexOf(e) !== -1) return 'admin';
  if (hrManagerEmails_().indexOf(e) !== -1) return 'hr_manager';
  if (cfgList_('SUPERVISOR_EMAILS').indexOf(e) !== -1) return 'supervisor';
  return '';
}

/**
 * Which companies an address may see.
 *
 * admin and hr_manager see everything. Anyone else is limited by
 * COMPANY_SCOPE_<something>; the mapping lives in the Admin_Settings tab as
 * e.g.  COMPANY_SCOPE_someone@example.com = Corn Club, Dark
 * An empty result means every company.
 */
function authCompaniesFor_(email, role) {
  if (role === 'admin' || role === 'hr_manager') return [];   // [] = unrestricted
  const key = 'COMPANY_SCOPE_' + String(email || '').trim().toLowerCase();
  const list = cfgList_(key);
  return list.length ? list : [];
}

/**
 * Issue a session. The frontend calls this after Google Sign-In with the
 * verified address; the address is checked against config here, server-side.
 */
/**
 * Verify a Google ID token with Google, and return the address it belongs to.
 *
 * The browser gets this credential from Google Identity Services. It is a
 * signed JWT; anyone can mint a STRING, nobody but Google can mint a valid
 * signature. We ask Google, then check that the token was issued for THIS
 * application and that the address on it is verified.
 *
 * Returns { ok:true, email } or { ok:false, code, error }.
 */
function authVerifyGoogleToken_(credential) {
  const clientId = cfg_(CFG_KEYS.GOOGLE_CLIENT_ID, '');
  if (!clientId) {
    // Fail closed. An unset client id must never mean "accept anything".
    return { ok: false, code: 'NO_CLIENT_ID',
             error: 'GOOGLE_CLIENT_ID is not set. Put the OAuth client id from ' +
                    'config.js into Script Properties before anyone can sign in.' };
  }

  let data;
  try {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential),
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      return { ok: false, code: 'BAD_TOKEN', error: 'Google rejected this sign-in.' };
    }
    data = JSON.parse(res.getContentText());
  } catch (err) {
    return { ok: false, code: 'VERIFY_FAILED',
             error: 'Could not verify the sign-in with Google: ' + err };
  }

  // Issued for this application, by Google, to a verified address, not expired.
  if (String(data.aud || '') !== String(clientId)) {
    return { ok: false, code: 'WRONG_AUDIENCE',
             error: 'This sign-in was issued for a different application.' };
  }
  const iss = String(data.iss || '');
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') {
    return { ok: false, code: 'WRONG_ISSUER', error: 'Not issued by Google.' };
  }
  if (data.email_verified !== true && String(data.email_verified) !== 'true') {
    return { ok: false, code: 'EMAIL_UNVERIFIED',
             error: 'This Google account has no verified email address.' };
  }
  const expMs = Number(data.exp || 0) * 1000;
  if (!expMs || expMs < Date.now()) {
    return { ok: false, code: 'EXPIRED', error: 'Sign-in expired. Sign in again.' };
  }
  const email = String(data.email || '').trim().toLowerCase();
  if (!email) return { ok: false, code: 'NO_EMAIL', error: 'No email on the token.' };

  return { ok: true, email: email };
}

/**
 * Exchange a Google sign-in for a session token.
 *
 * WHY THIS TAKES A CREDENTIAL AND NOT AN EMAIL
 * --------------------------------------------
 * It used to take an email and check it against the allowlist. That is not
 * authentication. The web app is deployed ANYONE_ANONYMOUS because the kiosk
 * link needs it, and the authorised addresses are published in config.js in a
 * public repository -- so a single unauthenticated request asking for a token
 * for the owner's address returned admin, with canSeeSensitive true, which
 * opens every civil id, passport number, salary and IBAN in the system.
 *
 * The address now comes from a Google-verified token and never from a
 * parameter the caller controls.
 */
function authLogin(params) {
  try {
    params = params || {};

    const credential = String(params.credential || '').trim();
    if (!credential) {
      return { success: false, code: 'NO_CREDENTIAL',
               error: 'Sign in with Google. This endpoint no longer accepts a bare email address.' };
    }

    const verified = authVerifyGoogleToken_(credential);
    if (!verified.ok) {
      return { success: false, error: verified.error, code: verified.code };
    }
    const email = verified.email;

    const role = authRoleFor_(email);
    if (!role) {
      return { success: false, error: 'This account is not authorised for this system.' };
    }
    const companies = authCompaniesFor_(email, role);
    const token = authToken_();
    const now = new Date();
    const exp = new Date(now.getTime() + AUTH_SESSION_HOURS * 3600 * 1000);

    const sh = authSheet_();
    sh.appendRow([token, email, role, companies.join(','), now, exp]);
    authPurgeExpired_(sh);

    return {
      success: true, token: token, email: email, role: role,
      companies: companies, expires: exp.toISOString(),
      canSeeSensitive: (role === 'admin' || role === 'hr_manager')
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function authPing() {
  return { success: true, time: new Date().toISOString(), org: orgName_() };
}

/** Drop expired rows so the tab does not grow without bound. */
function authPurgeExpired_(sh) {
  try {
    const d = sh.getDataRange().getValues();
    const now = new Date();
    for (var i = d.length - 1; i >= 1; i--) {
      const exp = d[i][5] ? new Date(d[i][5]) : null;
      if (!exp || exp < now) sh.deleteRow(i + 1);
    }
  } catch (err) { /* purging is best effort, never fatal */ }
}

/**
 * Resolve a token to a session, or null.
 */
function authSession_(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  try {
    const d = authSheet_().getDataRange().getValues();
    const now = new Date();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][0]).trim() !== t) continue;
      const exp = d[i][5] ? new Date(d[i][5]) : null;
      if (!exp || exp < now) return null;
      const role = String(d[i][2] || '').trim();
      return {
        email: String(d[i][1] || '').trim(),
        role: role,
        companies: String(d[i][3] || '').split(',')
                    .map(function (s) { return s.trim(); })
                    .filter(function (s) { return s; }),
        canSeeSensitive: (role === 'admin' || role === 'hr_manager')
      };
    }
  } catch (err) { /* fall through to null */ }
  return null;
}

/**
 * The scope object Employees.js consumes. Safe default: no sensitive columns,
 * no company widening.
 */
function authScope_(params) {
  params = params || {};
  // handleRequest resolves the session once and passes it down, so a handler
  // never pays for a second lookup. Fall back to the token for direct calls
  // and for anything invoked from the script editor.
  if (params._session) return params._session;
  const s = authSession_(params.token);
  if (!s) return { email: '', role: '', companies: [], canSeeSensitive: false };
  return s;
}

/** True when the session's role is at or above `min`. */
function authAtLeast_(session, min) {
  if (!session || !session.role) return false;
  const have = AUTH_ROLES.indexOf(session.role);
  const need = AUTH_ROLES.indexOf(min);
  return have !== -1 && need !== -1 && have <= need;
}

/**
 * The gate itself. Called by handleRequest before anything is dispatched.
 *
 * @returns {Object} { ok: true, session } or { ok: false, response }
 */
function authGuard_(method, params) {
  if (PUBLIC_METHODS.indexOf(method) !== -1) {
    return { ok: true, session: null, pub: true };
  }
  // A deployment with no admin addresses configured has not been set up yet.
  // Refuse rather than fail open.
  if (!adminEmails_().length && !hrManagerEmails_().length) {
    return {
      ok: false,
      response: {
        success: false,
        error: 'This deployment is not configured yet. Run setupNewDeployment() ' +
               'and set ADMIN_EMAILS before using the app.'
      }
    };
  }
  const session = authSession_((params || {}).token);
  if (!session) {
    return {
      ok: false,
      response: { success: false, error: 'Not signed in, or the session has expired.',
                  code: 'AUTH_REQUIRED' }
    };
  }
  return { ok: true, session: session };
}

/** Report the gate's configuration. Never reveals tokens. */
function getAuthStatus(params) {
  try {
    const s = authScope_(params || {});
    return {
      success: true,
      signedIn: !!s.role,
      email: s.email, role: s.role,
      companies: s.companies,
      canSeeSensitive: s.canSeeSensitive,
      publicMethods: PUBLIC_METHODS.slice(),
      adminsConfigured: adminEmails_().length,
      hrManagersConfigured: hrManagerEmails_().length
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}
