// ============================================================
// auth.js - GOOGLE AUTHENTICATION & AUTHORIZATION
// ============================================================

// Initialize Google Sign-In immediately when script loads
function initGoogleAuth() {
    google.accounts.id.initialize({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse
    });
    google.accounts.id.renderButton(
        document.getElementById("googleLoginButton"),
        { theme: "outline", size: "large" }
    );
    google.accounts.id.prompt();
}

// Google Identity Services (GIS) Callback
async function handleCredentialResponse(response) {
    const responsePayload = decodeJwtResponse(response.credential);
    const userEmail = responsePayload.email;

    // Browser-side check: decides what to SHOW, and nothing more. Anyone can
    // edit this list or skip this file entirely. The security boundary is
    // authLogin, which verifies the signed credential with Google and reads the
    // address off the verified token rather than trusting one sent to it.
    const normalizedEmail = userEmail.trim().toLowerCase();
    const isAuthorized = CONFIG.AUTHORIZED_EMAILS
        .map(e => e.trim().toLowerCase())
        .includes(normalizedEmail);

    if (!isAuthorized) {
        alert(`Access Denied.\n"${userEmail}" is not an authorized email for ${CONFIG.APP_NAME}.`);
        handleSignOut();
        return;
    }

    // The server has the final say. Without a session every admin method is
    // refused, so a failure here must stop the sign-in rather than show an
    // app whose every request will fail.
    // The signed credential goes to the server, not the address we decoded
    // above. The decode is only so this page can show a useful message before
    // the round trip; the server does the real verification.
    let session;
    try {
        session = await HRSession.login(response.credential);
    } catch (err) {
        alert('Could not reach the HR server. Check API_URL in config.js.\n\n' + err);
        handleSignOut();
        return;
    }
    if (!session || !session.success) {
        alert('Access Denied by the server.\n\n' +
              ((session && session.error) || 'No session was issued.') +
              '\n\nAsk the administrator to add this address to ADMIN_EMAILS, ' +
              'HR_MANAGER_EMAILS or SUPERVISOR_EMAILS in Script Properties.');
        handleSignOut();
        return;
    }

    // Authorised by both sides: switch from login to the app.
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';

    document.getElementById('userEmail').innerText = userEmail;
    if (responsePayload.picture) {
        document.getElementById('userAvatar').src = responsePayload.picture;
        document.getElementById('userAvatar').style.display = 'inline-block';
        document.getElementById('userAvatarPlaceholder').style.display = 'none';
    } else {
        document.getElementById('userAvatarPlaceholder').innerText = responsePayload.name.charAt(0);
    }

    // Company picker before app.init(), so the first load is already scoped.
    await HRSession.renderCompanyPicker(document.getElementById('companyPicker'));

    app.init();
}

function decodeJwtResponse(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
}

function handleSignOut() {
    // Drop the server session first. Leaving the token behind would let the
    // next person at this machine keep calling the API as the last user.
    try { if (window.HRSession) HRSession.clear(); } catch (e) {}

    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('userAvatar').style.display = 'none';
    document.getElementById('userAvatarPlaceholder').style.display = 'flex';
    document.getElementById('userEmail').innerText = 'Loading...';
    const picker = document.getElementById('companyPicker');
    if (picker) picker.innerHTML = '';
}
