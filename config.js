/**
 * config.js — the only file that differs between one deployment and another.
 *
 * Fill the three marked values in once, after deploying the Apps Script web
 * app. Nothing else in the frontend needs editing.
 *
 * NOTE ON AUTHORISATION
 * ---------------------
 * AUTHORIZED_EMAILS below controls what the browser shows. It is a convenience,
 * not a security boundary — anyone can read this file. The real check is
 * server-side in Auth.js, which holds the authorised addresses in Script
 * Properties and refuses any non-kiosk method without a valid session.
 * Keep the two lists aligned so the UI does not offer screens the server will
 * refuse, but never rely on this one alone.
 */
const CONFIG = {

    // 1. Paste the /exec URL of your deployed Apps Script web app.
    API_URL: 'https://script.google.com/macros/s/AKfycbxjeXp-wFE0sYQUFli4FfLCBHpbaqVfHrQDhrPb0tZCAmM2Va4B1aiHKfcnO5DUwfG09w/exec',

    // 2. Paste your Google OAuth Client ID (Cloud Console > Credentials).
    GOOGLE_CLIENT_ID: '244721488490-sntkd9mjpprithg8lqekdfqigf8lvfu5.apps.googleusercontent.com',

    // 3. Addresses allowed to open the admin app. Must match ADMIN_EMAILS /
    //    HR_MANAGER_EMAILS in the script's Script Properties. The owner is
    //    pre-filled; add colleagues here and in Script Properties together.
    AUTHORIZED_EMAILS: [
    'cornclubhr@gmail.com',
    'shakeel.viam@gmail.com'
],

    // Optional: the form where staff update their own documents. Leave empty
    // and the kiosk simply does not show the link.
    DOCS_UPDATE_URL: '',

    APP_NAME: 'HR Management System',
    COMPANY_NAME: 'Corn Club Group',

    // Company scope. The header dropdown is built from the Companies tab at
    // runtime; this is only what it starts on before the user chooses.
    // ALL_COMPANIES means "every company this user may see".
    ALL_COMPANIES: '__ALL__',
    DEFAULT_COMPANY: '__ALL__',

    DEFAULTS: {
        EMPLOYEE_STATUS: 'Active',
        LEAVE_STATUS: 'Pending',
        ATTENDANCE_STATUS: 'Present'
    }
};

/**
 * Fail loudly rather than silently calling an empty URL. A half-configured
 * deployment is the single most likely setup mistake.
 */
(function verifyConfig() {
    const missing = [];
    if (!CONFIG.API_URL) missing.push('API_URL');
    if (!CONFIG.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
    if (missing.length) {
        console.error('config.js is incomplete — set: ' + missing.join(', '));
        window.CONFIG_INCOMPLETE = missing;
    }
})();
