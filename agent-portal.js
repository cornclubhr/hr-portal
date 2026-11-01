// ============================================================
// agent-portal.js — shared by agent.html and agent-add.html.
// ------------------------------------------------------------
// The portal proves nothing by itself. Every call carries the
// Agency ID and PIN and the server checks them again, so a page
// only ever shows what the backend agrees to return. The
// credentials live in this tab's session storage: closing the
// tab signs the agent out.
// ============================================================

const EXEC_URL = CONFIG.API_URL;
const CRED_KEY = 'hrAgent';

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function getCred() {
  try { const raw = sessionStorage.getItem(CRED_KEY); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}
function setCred(c) { try { sessionStorage.setItem(CRED_KEY, JSON.stringify(c)); } catch (e) {} }
// Clearing the credentials is the same everywhere; what happens next
// is not. The submit page has to go to the sign-in page, but the
// sign-in page IS agent.html — sending it to itself would reload in a
// loop whenever a stored PIN has been revoked. A page that can show
// the sign-in form itself sets window.onSignedOut and stays put.
function signOut() {
  try { sessionStorage.removeItem(CRED_KEY); } catch (e) {}
  if (typeof window.onSignedOut === 'function') { window.onSignedOut(); return; }
  location.href = 'agent.html';
}

// Every endpoint is a POST with a JSON body; text/plain keeps the
// browser from asking Apps Script for a CORS preflight it cannot answer.
async function post(method, body) {
  const r = await fetch(EXEC_URL + '?method=' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('Connection problem (' + r.status + '). Please try again.');
  const d = await r.json();
  if (!d.success) throw new Error(d.error || 'Something went wrong.');
  return d;
}

function say(sel, text, bad) {
  const el = $(sel); if (!el) return;
  el.className = 'msg' + (text ? (bad ? ' bad' : ' good') : '');
  el.textContent = text || '';
}

// Name in the masthead, and a guard for pages that need a signed-in agent.
function fillWho(name, agencyId) {
  const el = $('#whoami'); if (!el) return;
  el.classList.remove('hide');
  el.innerHTML = '<b>' + esc(name || agencyId) + '</b>' + esc(agencyId);
}
function requireCred() {
  const c = getCred();
  if (!c) { location.href = 'agent.html'; return null; }
  return c;
}

// The same nationality list the candidate registration form offers,
// so the two sources spell a nationality the same way.
const NATIONALITIES = [
  'Afghan', 'Albanian', 'Algerian', 'American', 'Andorran', 'Angolan',
  'Antiguan', 'Argentine', 'Armenian', 'Australian', 'Austrian', 'Azerbaijani',
  'Bahamian', 'Bahraini', 'Bangladeshi', 'Barbadian', 'Belarusian', 'Belgian',
  'Belizean', 'Beninese', 'Bhutanese', 'Bolivian', 'Bosnian', 'Botswanan',
  'Brazilian', 'British', 'Bruneian', 'Bulgarian', 'Burkinabé', 'Burmese',
  'Burundian', 'Cambodian', 'Cameroonian', 'Canadian', 'Cape Verdean', 'Central African',
  'Chadian', 'Chilean', 'Chinese', 'Colombian', 'Comoran', 'Congolese',
  'Costa Rican', 'Croatian', 'Cuban', 'Cypriot', 'Czech', 'Danish',
  'Djiboutian', 'Dominican', 'Dutch', 'East Timorese', 'Ecuadorian', 'Egyptian',
  'Emirati', 'Equatorial Guinean', 'Eritrean', 'Estonian', 'Ethiopian', 'Fijian',
  'Filipino', 'Finnish', 'French', 'Gabonese', 'Gambian', 'Georgian',
  'German', 'Ghanaian', 'Greek', 'Grenadian', 'Guatemalan', 'Guinean',
  'Guinea-Bissauan', 'Guyanese', 'Haitian', 'Honduran', 'Hungarian', 'Icelandic',
  'Indian', 'Indonesian', 'Iranian', 'Iraqi', 'Irish', 'Israeli',
  'Italian', 'Ivorian', 'Jamaican', 'Japanese', 'Jordanian', 'Kazakh',
  'Kenyan', 'Kiribati', 'Kosovar', 'Kuwaiti', 'Kyrgyz', 'Lao',
  'Latvian', 'Lebanese', 'Basotho', 'Liberian', 'Libyan', 'Liechtensteiner',
  'Lithuanian', 'Luxembourgish', 'Malagasy', 'Malawian', 'Malaysian', 'Maldivian',
  'Malian', 'Maltese', 'Marshallese', 'Mauritanian', 'Mauritian', 'Mexican',
  'Micronesian', 'Moldovan', 'Monégasque', 'Mongolian', 'Montenegrin', 'Moroccan',
  'Mozambican', 'Namibian', 'Nauruan', 'Nepali', 'New Zealander', 'Nicaraguan',
  'Nigerien', 'Nigerian', 'North Korean', 'North Macedonian', 'Norwegian', 'Omani',
  'Pakistani', 'Palauan', 'Palestinian', 'Panamanian', 'Papua New Guinean', 'Paraguayan',
  'Peruvian', 'Polish', 'Portuguese', 'Qatari', 'Romanian', 'Russian',
  'Rwandan', 'Saint Lucian', 'Salvadoran', 'Samoan', 'San Marinese', 'São Toméan',
  'Saudi', 'Senegalese', 'Serbian', 'Seychellois', 'Sierra Leonean', 'Singaporean',
  'Slovak', 'Slovenian', 'Solomon Islander', 'Somali', 'South African', 'South Korean',
  'South Sudanese', 'Spanish', 'Sri Lankan', 'Sudanese', 'Surinamese', 'Swazi',
  'Swedish', 'Swiss', 'Syrian', 'Taiwanese', 'Tajik', 'Tanzanian',
  'Thai', 'Togolese', 'Tongan', 'Trinidadian', 'Tunisian', 'Turkish',
  'Turkmen', 'Tuvaluan', 'Ugandan', 'Ukrainian', 'Uruguayan', 'Uzbek',
  'Vanuatuan', 'Venezuelan', 'Vietnamese', 'Yemeni', 'Zambian', 'Zimbabwean',
];
function fillNationalities(sel) {
  const dl = $(sel); if (!dl) return;
  dl.innerHTML = NATIONALITIES.map(n => '<option>' + esc(n) + '</option>').join('');
}
