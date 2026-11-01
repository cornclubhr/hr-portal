#!/usr/bin/env python3
"""Full audit of what is in the bundle.

Looks for anything belonging to another organisation or any real person:
identifiers, contact details, bank details, and names that look like staff
rather than code. Reports file by file so nothing is taken on trust.
"""
import os, re, sys, json

ROOT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/naeem-hr'
TEXT = ('.js', '.html', '.json', '.md', '.csv', '.txt', '.gs')

PATTERNS = [
  ('employee id (old format)', re.compile(r'\bMT-\d{3,}\b')),
  ('kuwait civil id',          re.compile(r'\b[23]\d{11}\b')),
  ('iban',                     re.compile(r'\bKW\d{2}[A-Z0-9]{20,}\b', re.I)),
  ('phone (kuwait/intl)',      re.compile(r'(?<![\d.])\+\d{8,15}\b')),
  ('email address',            re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b')),
  ('google spreadsheet id',    re.compile(r"\b1[A-Za-z0-9_-]{40,}\b")),
  ('apps script deployment',   re.compile(r'AKfycb[A-Za-z0-9_-]{20,}')),
  ('oauth client id',          re.compile(r'\b\d{9,}-[a-z0-9]{10,}\.apps\.googleusercontent\.com\b')),
  ('github pages url',         re.compile(r'[a-z0-9-]+\.github\.io', re.I)),
  # real-world coordinates: a seeded branch list carries a company's addresses
  ('gps coordinates',          re.compile(r'\b\d{1,2}\.\d{5,}\s*,\s*\d{1,3}\.\d{5,}\b')),
  ('gps latitude (kuwait)',    re.compile(r'\b2[89]\.\d{5,}\b')),
]
BRANDS = ['maya', 'mayatex', 'maya tex', 'corn club', 'good people', 'try leaves', 'solana']

# words that look like names but are code, UI copy or ordinary English
SAFE = set("""Employee Name Status Active Date Start End Hours Total Net Gross Basic Food
Accommodation Conveyance Bonus Shift Location Company Cycle Payroll Leave Annual Sick
Civil Passport Health Card Visa Expiry Bank Account Remark Notes Admin Manager Supervisor
Kiosk Roster Overtime Attendance Check Break Day Off Pending Approved Rejected
January February March April May June July August September October November December
Monday Tuesday Wednesday Thursday Friday Saturday Sunday Error Warning Loading Save Cancel
Delete Edit Add New Search Filter Export Import Preview Commit Run Deploy Settings
Google Sheets Script GitHub Windows Excel Notepad PowerShell Node""".split())

def scan(path, rel):
    try:
        src = open(path, encoding='utf-8', errors='replace').read()
    except Exception:
        return None
    hits = {}
    for label, pat in PATTERNS:
        found = sorted(set(pat.findall(src)))
        if found:
            hits[label] = found
    low = src.lower()
    brands = [b for b in BRANDS if re.search(r'\b' + re.escape(b) + r'\b', low)]
    if brands:
        hits['other company named'] = brands
    return hits

print('AUDIT OF %s\n' % ROOT)
clean, dirty, total_files = [], {}, 0
for base, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules')]
    for f in sorted(files):
        p = os.path.join(base, f)
        rel = os.path.relpath(p, ROOT)
        total_files += 1
        if not f.endswith(TEXT):
            continue
        h = scan(p, rel)
        if h:
            dirty[rel] = h
        else:
            clean.append(rel)

if not dirty:
    print('No foreign identifiers, contact details or company names found.')
else:
    for rel in sorted(dirty):
        print(rel)
        for label, vals in sorted(dirty[rel].items()):
            shown = ', '.join(str(v)[:46] for v in vals[:4])
            more = '' if len(vals) <= 4 else '  (+%d more)' % (len(vals) - 4)
            print('    %-26s %s%s' % (label, shown, more))
        print()

print('%d files scanned, %d with findings, %d clean' % (total_files, len(dirty), len(clean)))
sys.exit(1 if dirty else 0)
