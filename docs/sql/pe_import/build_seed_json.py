# -*- coding: utf-8 -*-
"""ประกอบ pe_extract.json → docs/sql/pe_seed_p703_full.json (โครงพร้อม insert)"""
import json, re, uuid

d = json.load(open('pe_extract.json'))
RH_SET = 'ae093964-1500-4c73-b1e9-2b8ae34ae424'
LH_SET = 'be093964-1500-4c73-b1e9-2b8ae34ae061'   # fixed uuid (hex ล้วน) — idempotent guard

PART_RE = re.compile(r'^(W\d{6}\S*|MB3B-\S+|[A-Z]{2}\d{3}\S*-\S+)$')
GENERIC = {'INCOMING INSP.','INCOMING  INSP.','STORAGE','FINAL INSPECTION','INSPECTION','WELD INSPECTION','WARE HOUSE','WAREHOUSE','DELIVERY'}

def base_of(key):
    m = re.match(r'^(\d+)', key)
    return m.group(1) if m else None

def ranged(key):
    m = re.match(r'^(\d+)-(\d+)$', key)
    if m and int(m.group(2)) - int(m.group(1)) >= 20:   # '240-280' ใช่ · '120-2' ไม่ใช่
        return int(m.group(1)), int(m.group(2))
    return None

# ---- fmea func fix: nearest-label ทำแล้วใน extract? ยัง — ใช้ func ที่มีแล้ว backfill ว่างจาก record ถัดไป
def backfill_funcs(recs):
    for i, r in enumerate(recs):
        if not r['func'] or r['func'] in ('Item','Function'):
            nxt = next((x['func'] for x in recs[i:] if x['func'] and x['func'] not in ('Item','Function')), '')
            r['func'] = nxt
    return recs

KEYWORD_OP = [('RIVET','RIVET'), ('WELD','WELD INSPECTION'), ('FINAL','FINAL INSPECTION'),
              ('WAREHOUSE','WARE HOUSE'), ('WARE','WARE HOUSE'), ('DELIVERY','DELIVERY')]

def build_part(part, set_id, existing_ops=None):
    cnp, fmea = d[part]['cnp'], d[part]['fmea']
    # ---- 1) op list จาก CNP
    ops = {}   # base → {name, kind, machine, childs, remark, subs:[]}
    range_names = {}  # base(str) → ชื่อจาก ranged sheet (เช่น 340 → WELD INSPECTION)
    for key, recs in cnp.items():
        rng = ranged(key)
        for r in recs:
            b = base_of(r['sub_op']) or (base_of(key) if not rng else None)
            if not b: continue
            o = ops.setdefault(b, {'names': [], 'machines': set(), 'childs': set()})
            nm = (r['sub_name'] or '').split('\n')[0].strip()
            if nm and nm not in o['names']: o['names'].append(nm)
            for ln in (r['sub_name'] or '').split('\n')[1:]:
                if PART_RE.match(ln.strip()): o['childs'].add(ln.strip())
            if r['machine'].strip(): o['machines'].add(r['machine'].strip())
    # childs จาก FMEA labels
    for key, recs in fmea.items():
        b = base_of(key)
        if key == 'REWORK Assy' or ranged(key): continue
        for r in recs:
            for tok in (r['func'] or '').split():
                if PART_RE.match(tok) and b in ops: ops[b]['childs'].add(tok)
    # ---- name/kind
    op_rows = []
    for b in sorted(ops, key=lambda x: int(x)):
        o = ops[b]
        names = [n for n in o['names'] if n]
        setn = set(names)
        child = sorted(o['childs'])
        mach_txt = ' / '.join(sorted(o['machines']))
        if setn and setn <= {'INCOMING INSP.','INCOMING  INSP.','STORAGE'}:
            name, kind = 'INCOMING INSP. + STORAGE', 'incoming_insp'
        elif any('HYDROFORM' in n for n in names):
            name, kind = 'HYDROFORM FAMILY' + (f" ({child[0]})" if child else ''), 'process'
        elif any('PROGRESSIVE' in n for n in names):
            name, kind = 'PROGRESSIVE STAMPING' + (f" ({child[0]})" if child else ''), 'process'
        elif any(n.startswith('FORM') or 'PIERCE' in n or 'BLANK' in n for n in names):
            name, kind = 'STAMPING' + (f" ({child[0]})" if child else ''), 'process'
        else:
            main = next((n for n in names if n not in GENERIC), names[0] if names else f'OP {b}')
            name = main
            kind = ('inspection' if 'INSPECTION' in main else
                    'warehouse' if 'WARE' in main else
                    'delivery' if 'DELIVERY' in main else 'process')
        sub_flow = ' → '.join(names) if len(names) > 1 else ''
        remark = ' · '.join(x for x in [sub_flow, mach_txt] if x) or None
        op_rows.append(dict(op_no=b, seq=int(b), name=name, kind=kind, machine_no=None,
                            child_parts='\n'.join(child) or None, remark=remark))
        range_names[b] = name
    # ---- 2) FMEA items → route ไป op
    weld_insp_op = next((r['op_no'] for r in op_rows if 'WELD INSPECTION' in r['name']), None)
    fmea_items, skipped = [], []
    for key in sorted(fmea, key=lambda k: (0 if base_of(k) else 1, int(base_of(k) or 999), k)):
        recs = backfill_funcs(fmea[key])
        rng = ranged(key)
        if key == 'REWORK Assy':
            for r in recs: r['_op'] = weld_insp_op
        elif rng:
            lastop = str(rng[0])
            in_range = [o for o in op_rows if rng[0] <= int(o['op_no']) <= rng[1]]
            for r in recs:
                f = (r['func'] or '').upper()
                hit = None
                for kw, nm in KEYWORD_OP:
                    if kw in f:
                        hit = next((o['op_no'] for o in in_range if nm in (o['name'] or '').upper() or
                                    (kw == 'RIVET' and 'RIVET' in (o['name'] or '').upper())), None)
                        if hit: break
                lastop = hit or lastop
                r['_op'] = lastop
        else:
            b = base_of(key)
            for r in recs: r['_op'] = b
        for r in recs:
            if r['_op'] and any(o['op_no'] == r['_op'] for o in op_rows) or (existing_ops and r['_op'] in existing_ops):
                fmea_items.append(r)
            else:
                skipped.append((key, r['_op'], r['failure_mode'][:30]))
    # seq ต่อ op
    seqc = {}
    for r in fmea_items:
        seqc[r['_op']] = seqc.get(r['_op'], 0) + 1
        r['_seq'] = seqc[r['_op']]
    # ---- 3) CP items
    cp_items = []
    for key in sorted(cnp, key=lambda k: (int(base_of(k) or 999), k)):
        for r in cnp[key]:
            b = base_of(r['sub_op']) or base_of(key)
            r['_op'] = b
            cp_items.append(r)
    seqc = {}
    for r in cp_items:
        seqc[r['_op']] = seqc.get(r['_op'], 0) + 1
        r['_seq'] = seqc[r['_op']]
    print(f"{part}: ops {len(op_rows)} · fmea {len(fmea_items)} (skip {len(skipped)}: {skipped[:5]}) · cp {len(cp_items)}")
    return op_rows, fmea_items, cp_items

rh_ops, rh_f, rh_c = build_part('RH', RH_SET, existing_ops={str(n) for n in range(10, 290, 10)})
lh_ops, lh_f, lh_c = build_part('LH', LH_SET)

def pack_f(r):
    return dict(op=r['_op'], seq=r['_seq'], fn=r['func'] or None, req=r['requirement'] or None,
                fm=r['failure_mode'], eff=r['effects'] or None, s=r['severity'], cls=r['classification'] or None,
                cse=r['causes'] or None, prv=r['prevention'] or None, o=r['occurrence'],
                dc=r['detection_ctrl'] or None, dt=r['detection'], ra=r['recommended_action'] or None,
                rsp=r['responsibility'] or None, at=r['action_taken'] or None,
                ns=r['new_s'], no=r['new_o'], nd=r['new_d'])
def pack_c(r):
    sub = (r['sub_op'] + ' · ' + r['sub_name'].split('\n')[0]).strip(' ·') if (r['sub_op'] or r['sub_name']) else None
    return dict(op=r['_op'], seq=r['_seq'], sub=sub or None, cn=r['char_no'],
                pc=r['product_char'] or None, prc=r['process_char'] or None, cls=r['special'] or None,
                per=r['person'] or None, spec=r['spec'] or None, m=r['method'] or None,
                ss=r['sample'] or None, fq=r['freq'] or None, cm=r['control'] or None, rp=r['reaction'] or None)
def pack_rev(rows, dt):
    seen, out = set(), []
    for r in rows:
        k = (r['date'], r['content'][:60])
        if k in seen: continue
        seen.add(k)
        out.append(dict(t=dt, d=r['date'], sfx=r['suffix'] or None, ecn=r['ecn'] or None,
                        c=r['content'], i=r['issued'] or None, ck=r['checked'] or None, ap=r['approved'] or None))
    return out

# LH PFC cover ยังไม่ได้ parse ใน extract — parse ตรงนี้
import openpyxl
import extract as ex
pw_lh = openpyxl.load_workbook('pfc_lh.xlsx', data_only=True)
pw_rh = openpyxl.load_workbook('pfc_rh.xlsx', data_only=True)
lh_pfc_rev = ex.parse_cover(pw_lh['061'])
rh_pfc_rev = ex.parse_cover(pw_rh['060'], date_col='B', sfx='C', ecn='D', content='E', iss='H', chk='I', app='J')
print('pfc covers: RH', len(rh_pfc_rev), '· LH', len(lh_pfc_rev))

out = {'sets': [
  dict(id=RH_SET, mode='fill',      # ชุดเดิม: ลบ items/revisions เดิมแล้วเติมเต็ม
       ops=rh_ops, fmea=[pack_f(r) for r in rh_f], cp=[pack_c(r) for r in rh_c],
       revs=pack_rev(d['RH']['covers']['fmea'],'fmea') + pack_rev(d['RH']['covers']['cp'],'cp') + pack_rev(rh_pfc_rev,'pfc')),
  dict(id=LH_SET, mode='create',
       part_no='MB3B-16E061-CH', part_name='REINF ASY FRT FNDR INR BDY LH', model='P703', customer='FORD',
       line_name='Line 61', doc_pfc='PFC-P703-02', doc_fmea='FMEA-P703-02', doc_cp='CNP-P703-02',
       ops=lh_ops, fmea=[pack_f(r) for r in lh_f], cp=[pack_c(r) for r in lh_c],
       revs=pack_rev(d['LH']['covers']['fmea'],'fmea') + pack_rev(d['LH']['covers']['cp'],'cp') + pack_rev(lh_pfc_rev,'pfc')),
]}
p = '/home/user/4Mmanagement/docs/sql/pe_seed_p703_full.json'
json.dump(out, open(p,'w'), ensure_ascii=False, separators=(',',':'))
import os; print('written', p, os.path.getsize(p)//1024, 'KB')
for s in out['sets']:
    print(s['id'][:8], 'ops', len(s['ops']), 'fmea', len(s['fmea']), 'cp', len(s['cp']), 'revs', len(s['revs']))
