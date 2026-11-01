#!/usr/bin/env python3
"""Verification harness for the Naeem build. Run after every change.

Checks, in order:
  1. every .js parses (node --check)
  2. every router case calls a function that actually exists
  3. every defined API-looking function is reachable from the router
  4. no hardcoded spreadsheet IDs, emails or secrets survive
  5. the kiosk path is intact
"""
import os, re, subprocess, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/naeem-hr'
GAS, WEB = os.path.join(ROOT, 'gas'), os.path.join(ROOT, 'web')
fail = []
def bad(section, msg):
    fail.append((section, msg))

js = sorted(f for f in os.listdir(GAS) if f.endswith('.js'))

# ---------- 1. syntax ----------
for f in js:
    p = os.path.join(GAS, f)
    r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
    if r.returncode != 0:
        bad('syntax', '%s: %s' % (f, r.stderr.strip().splitlines()[-1] if r.stderr else '?'))

# ---------- collect definitions ----------
defined = {}
for f in js:
    src = open(os.path.join(GAS, f), encoding='utf-8', errors='replace').read()
    for m in re.finditer(r'^\s*function\s+([A-Za-z0-9_$]+)\s*\(', src, re.M):
        defined.setdefault(m.group(1), []).append(f)
    for m in re.finditer(r'^\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*function\s*\(', src, re.M):
        defined.setdefault(m.group(1), []).append(f)

dupes = {k: v for k, v in defined.items() if len(v) > 1}
for k, v in sorted(dupes.items()):
    bad('duplicate function', '%s defined in %s' % (k, ', '.join(v)))

# ---------- 2/3. router ----------
def strip_comments(src):
    # block comments, then line comments - so words inside prose never look like calls
    src = re.sub(r'/\*.*?\*/', ' ', src, flags=re.S)
    src = re.sub(r'(?m)//.*$', '', src)
    return src

code = strip_comments(open(os.path.join(GAS, 'Code.js'), encoding='utf-8', errors='replace').read())
rt = code[code.find('function handleRequest'):]
rt = rt[:rt.find('\n}\n')] if '\n}\n' in rt else rt
cases = re.findall(r"case\s+'([A-Za-z0-9_]+)'\s*:", rt)
calls = {}
for blk in re.finditer(r"case\s+'([A-Za-z0-9_]+)'\s*:(.*?)(?=case\s+'|default\s*:|$)", rt, re.S):
    name, body = blk.group(1), blk.group(2)
    body = strip_comments(body)
    fn = re.findall(r'(?<![.\w$])([A-Za-z0-9_$]+)\s*\(', body)
    calls[name] = [x for x in fn if x not in
                   ('JSON', 'String', 'Number', 'ContentService', 'createTextOutput',
                    'setMimeType', 'stringify', 'parse', 'cgBody_', 'if', 'for', 'switch',
                    'return', 'catch', 'Object', 'keys', 'forEach', 'Array', 'isArray')]

for name, fns in calls.items():
    for fn in fns:
        if fn not in defined and fn != name:
            bad('router -> missing fn', "case '%s' calls %s() which is not defined" % (name, fn))
    if name not in defined and not any(f in defined for f in fns):
        bad('router -> missing fn', "case '%s' has no backing function" % name)

# ---------- 4. hardcoding ----------
for f in js:
    src = open(os.path.join(GAS, f), encoding='utf-8', errors='replace').read()
    for m in re.finditer(r"'(1[A-Za-z0-9_-]{40,})'", src):
        bad('hardcoded id', '%s: %s...' % (f, m.group(1)[:18]))
    for m in re.finditer(r"['\"]([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})['\"]", src):
        # The deployment owner is allowed in exactly one place: the named
        # constant in AutoSetup.js that seeds ADMIN_EMAILS on first run.
        # Anywhere else an address is a leak.
        line = src[:m.start()].rsplit('\n', 1)[-1]
        if f == 'AutoSetup.js' and 'DEPLOYMENT_OWNER_EMAIL' in line:
            continue
        bad('hardcoded email', '%s: %s' % (f, m.group(1)))
    for m in re.finditer(r"(SHARED_SECRET|API_KEY|PASSWORD)\s*=\s*['\"]([^'\"]+)['\"]", src):
        bad('hardcoded secret', '%s: %s' % (f, m.group(1)))

if os.path.isdir(WEB):
    for f in sorted(os.listdir(WEB)):
        if not f.endswith(('.js', '.html')):
            continue
        src = open(os.path.join(WEB, f), encoding='utf-8', errors='replace').read()
        for m in re.finditer(r"['\"]([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})['\"]", src):
            # config.js is the one file that names this deployment's people.
            if f == 'config.js':
                continue
            bad('hardcoded email (web)', '%s: %s' % (f, m.group(1)))

# ---------- 4b. no other organisation's data or branding ----------
# This is what was missed the first time: staff names and ids from the system
# this was derived from, sitting in one-off repair scripts, plus that company's
# name on the employee tab. Branding and personal data are different failures;
# both are checked here.
BRANDS = ['maya', 'maya tex', 'mayatex']
# The old employee-id format, in every shape it actually appeared in:
#   MT-00042   a real id
#   MT-XXXXX   a placeholder in a comment
#   MT-#####   a placeholder in a comment
#   MT-ID      a UI placeholder ("Type name, MT-ID or Civil ID")
#   MT-\d+     a hardcoded prefix inside a REGEX — the dangerous one, because
#              it silently matches nothing once ids are numbered differently
# The first version of this check only looked for the first shape, so the
# other four shipped. Prefixes belong in EMPLOYEE_ID_PREFIX, never in code.
ID_PAT = re.compile(r"\bMT-(?:\d{2,}|[Xx#]{2,}|\\d|ID\b)")
for root, label in ((GAS, 'gas'), (WEB, 'web')):
    if not os.path.isdir(root):
        continue
    for f in sorted(os.listdir(root)):
        # .css and .txt were not scanned before, which is how a stylesheet
        # header carrying the other company's name got through.
        if not f.endswith(('.js', '.html', '.json', '.md', '.css', '.txt')):
            continue
        src = open(os.path.join(root, f), encoding='utf-8', errors='replace').read()
        low = src.lower()
        for b in BRANDS:
            if re.search(r'\b' + re.escape(b) + r'\b', low):
                bad('foreign branding', '%s/%s mentions "%s"' % (label, f, b))
                break
        hits = ID_PAT.findall(src)
        if hits:
            bad('foreign employee ids', '%s/%s has %d (e.g. %s)' % (label, f, len(hits), hits[0]))

# ---------- 4c. no getActiveSpreadsheet outside the resolver ----------
# This deployment is STANDALONE: the script is not bound to the sheet, so
# SpreadsheetApp.getActiveSpreadsheet() returns null and every caller breaks --
# including KioskBackend. Only Config.js (which resolves the id) and
# AutoSetup.js (which caches it on first run) may call it; everything else goes
# through openMain_(). This shipped broken once, in 34 places.
ALLOWED_ACTIVE = {'Config.js', 'AutoSetup.js'}
for f in sorted(os.listdir(GAS)) if os.path.isdir(GAS) else []:
    if not f.endswith('.js') or f in ALLOWED_ACTIVE:
        continue
    for i, line in enumerate(open(os.path.join(GAS, f), encoding='utf-8',
                                  errors='replace').read().split('\n'), 1):
        if 'getActiveSpreadsheet()' in line and not line.lstrip().startswith(('//', '*')):
            bad('getActiveSpreadsheet outside resolver',
                'gas/%s:%d -- use openMain_()' % (f, i))

# ---------- 5. kiosk intact ----------
# the four methods the kiosk puts on the wire, plus the backdated-day-off
# handler which the frontend reaches through markKioskAttendance with a date
KIOSK_WIRE = ['loginStaffKiosk', 'markKioskAttendance', 'getDailyKioskStatus', 'submitOtRequest']
for k in KIOSK_WIRE:
    if k not in defined:
        bad('kiosk', '%s is no longer defined' % k)
    if k not in cases:
        bad('kiosk', '%s has no router case' % k)
if 'markBackdatedDayOff' not in defined:
    bad('kiosk', 'markBackdatedDayOff is no longer defined')

# ---------- report ----------
print('files: %d js in gas, %d in web' % (len(js), len(os.listdir(WEB)) if os.path.isdir(WEB) else 0))
print('functions defined: %d   router cases: %d' % (len(defined), len(cases)))
if not fail:
    print('\nALL CHECKS PASS')
    sys.exit(0)
groups = {}
for s, m in fail:
    groups.setdefault(s, []).append(m)
print()
for s in sorted(groups):
    print('%s  (%d)' % (s.upper(), len(groups[s])))
    for m in groups[s][:25]:
        print('   ', m)
    if len(groups[s]) > 25:
        print('    ... %d more' % (len(groups[s]) - 25))
print('\n%d PROBLEMS' % len(fail))
sys.exit(1)
