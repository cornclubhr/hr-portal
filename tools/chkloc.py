from collections import Counter
# what I wrote into the Accounts sheet, read back from it
got = """Ardiya|Jabriya|Central Kitchen Hawally|Driver Location|Driver Location|Ardiya|Central Kitchen Hawally|Head Office|Jabriya|Ardiya|Qurain|Qurain|Ardiya|Qurain|Kaifan|Qurain|Kaifan|Ardiya|Central Kitchen Hawally|Ardiya|Kaifan|Central Kitchen Hawally|Jabriya|Central Kitchen Hawally|Kaifan|Khairan|Ardiya|Jabriya|Qurain|Store Hawally|Jabriya|Driver Location|Kaifan|Central Kitchen Hawally|Head Office|Jabriya|Kaifan|Kaifan|Kaifan|Jabriya|Ardiya|Jabriya|Khairan|Mahboula|Qurain|Qurain|Driver Location|Ardiya|Ardiya|Mahboula|Ardiya|Central Kitchen Hawally|Central Kitchen Hawally|Khairan|Mahboula|Jabriya|Head Office|Khairan|Store Hawally|Store Hawally|Driver Location|Head Office|Head Office|Head Office|Head Office|Head Office|Head Office""".split('|')
# the system's own Payroll by Location 22Sep-21Oct summary, employees only
expect = {'Ardiya':11,'Central Kitchen Hawally':8,'Driver Location':5,'Head Office':9,
          'Jabriya':9,'Kaifan':8,'Khairan':4,'Mahboula':3,'Qurain':7,'Store Hawally':3}
c = Counter(got)
print('rows written:', len(got), ' expected 67')
ok = True
for k in sorted(set(list(expect)+list(c))):
    a, b = c.get(k,0), expect.get(k,0)
    flag = 'OK ' if a==b else 'MISMATCH'
    if a!=b: ok=False
    print('  %-26s sheet %2d   system %2d   %s' % (k,a,b,flag))
print('total', sum(c.values()), 'vs', sum(expect.values()))
print('\nRESULT:', 'every location count matches the system sheet' if ok and len(got)==67 else 'DISCREPANCY')
