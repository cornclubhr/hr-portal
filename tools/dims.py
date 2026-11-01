import sys, openpyxl
from collections import Counter
wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
def col(ws, name):
    hdr=[str(c).strip() if c else '' for c in next(ws.iter_rows(min_row=1,max_row=1,values_only=True))]
    return hdr.index(name) if name in hdr else -1
for sheet,fields in [('All Staff Location Wise',['Company','Location']),('Civil ID Statuses',['Company'])]:
    if sheet not in wb.sheetnames: continue
    ws=wb[sheet]
    idx={f:col(ws,f) for f in fields}
    cnt={f:Counter() for f in fields}
    n=0
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not any(r): continue
        n+=1
        for f,i in idx.items():
            if i>=0 and i<len(r) and r[i]: cnt[f][str(r[i]).strip()]+=1
    print('--- %s  (%d rows) ---'%(sheet,n))
    for f in fields:
        print(' %s: %d distinct'%(f,len(cnt[f])))
        for k,v in cnt[f].most_common(): print('    %-34s %3d'%(k,v))
wb.close()
