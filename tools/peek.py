import sys, openpyxl
for p in sys.argv[1:]:
    try:
        wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
    except Exception as e:
        print(p, 'ERR', e); continue
    print('='*70); print(p.split('/')[-1])
    for ws in wb.worksheets:
        rows = ws.max_row; cols = ws.max_column
        hdr = []
        for r in ws.iter_rows(min_row=1, max_row=1, values_only=True):
            hdr = [str(c).strip() if c is not None else '' for c in r]
        print('  sheet %-22s %4s rows x %2s cols' % (ws.title, rows, cols))
        print('    headers:', ' | '.join(h for h in hdr if h))
    wb.close()
