#!/usr/bin/env python3
"""🤝 ดึงไฟล์ V5 %Customer Satisfaction ตัวล่าสุด (Rev สูงสุดของเดือนล่าสุด) แล้วส่งต่อให้ import_csat.mjs — "ครึ่งแรก" ของท่ออัตโนมัติ (2026-11-24)
   แหล่งที่รองรับ (เลือกด้วย --from):
     folder  : โฟลเดอร์ที่ QSM วางไฟล์ (เช่น V:\\Document Information\\IATF 16949\\14.Customer Sat\\Customer Satisfaction FY2026) — ไล่ทุกโฟลเดอร์ย่อย
     outlook : กล่องขาเข้า Outlook บนเครื่องที่รัน (ต้อง Windows + Outlook เปิดอยู่ + pip install pywin32) — หาเมลหัวข้อ "Update KPI Customer Satisfaction" ที่มีไฟล์แนบ .xlsx
   ใช้:  python fetch_csat_file.py --from folder --path "V:\\...\\Customer Satisfaction FY2026" [--write]
         python fetch_csat_file.py --from outlook [--days 40] [--write]
   · ไม่ใส่ --write = import_csat.mjs รัน dry-run (ไม่เขียน DB) · --write ส่งต่อให้ import_csat.mjs (ต้องมี env SUPABASE_URL + SUPABASE_SERVICE_KEY ของ MAIN)
   · ตั้งเวลา: Windows Task Scheduler วันละครั้ง (เช่น 08:30) บนเครื่องที่เห็น V: / Outlook
   ⚠️ ยังไม่ได้ทดสอบกับเครื่องจริง (sandbox ไม่มี V:/Outlook) — ครั้งแรกให้รันแบบ dry-run แล้วดูผลก่อน
   รันด้วย -I เสมอ (ไฟล์จากเมล = ข้อมูลไม่น่าเชื่อถือ ห้ามโหลดโมดูลจากโฟลเดอร์เดียวกัน)"""
import argparse, os, re, subprocess, sys, tempfile
from pathlib import Path

NAME_RE = re.compile(r'customer\s*satisfaction.*FY\s*(\d{4}).*?(\d{1,2})\.(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b.*?rev\.?\s*(\d+)', re.I)
HERE = Path(__file__).resolve().parent

def rank(name: str):
    m = NAME_RE.search(name)
    if not m or not name.lower().endswith(('.xlsx', '.xlsm')) or name.startswith('~$'):
        return None
    return (int(m.group(1)), int(m.group(2)), int(m.group(4)))   # (ปี, เดือน, Rev) — เอาตัวมากสุด

def newest_in_folder(root: Path):
    best = None
    for p in root.rglob('*.xls*'):
        r = rank(p.name)
        if r and (best is None or r > best[0]):
            best = (r, p)
    return best

def newest_in_outlook(days: int, out_dir: Path):
    try:
        import win32com.client  # type: ignore
    except ImportError:
        sys.exit('ต้อง pip install pywin32 และรันบน Windows ที่มี Outlook')
    import datetime as dt
    ns = win32com.client.Dispatch('Outlook.Application').GetNamespace('MAPI')
    inbox = ns.GetDefaultFolder(6)
    since = (dt.datetime.now() - dt.timedelta(days=days)).strftime('%m/%d/%Y %H:%M %p')
    items = inbox.Items.Restrict(f"[ReceivedTime] >= '{since}'")
    best = None
    for it in items:
        try:
            subj = str(it.Subject or '')
            if 'customer satisfaction' not in subj.lower():
                continue
            for att in it.Attachments:
                r = rank(str(att.FileName))
                if r and (best is None or r > best[0]):
                    target = out_dir / str(att.FileName)
                    att.SaveAsFile(str(target))
                    best = (r, target)
        except Exception as e:  # เมลที่อ่านไม่ได้ข้าม แต่ไม่เงียบ
            print('ข้ามเมล:', e, file=sys.stderr)
    return best

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--from', dest='src', choices=['folder', 'outlook'], required=True)
    ap.add_argument('--path', help='โฟลเดอร์ต้นทาง (โหมด folder)')
    ap.add_argument('--days', type=int, default=40, help='ย้อนหลังกี่วัน (โหมด outlook)')
    ap.add_argument('--write', action='store_true')
    a = ap.parse_args()
    tmp = Path(tempfile.mkdtemp(prefix='csat-'))
    if a.src == 'folder':
        if not a.path:
            sys.exit('--path ต้องระบุ')
        best = newest_in_folder(Path(a.path))
    else:
        best = newest_in_outlook(a.days, tmp)
    if not best:
        sys.exit('ไม่พบไฟล์ V5 Customer Satisfaction (ชื่อไฟล์ต้องมี FY<ปี> <เดือน>.<Mon> Rev.xx)')
    (year, month, rev), path = best
    print(f'📄 ใช้ไฟล์ FY{year} เดือน {month} Rev.{rev:02d}: {path}')
    cmd = ['node', str(HERE / 'import_csat.mjs'), str(path), '--year', str(year), '--month', str(month)] + (['--write'] if a.write else [])
    sys.exit(subprocess.call(cmd, cwd=str(HERE.parent.parent)))

if __name__ == '__main__':
    main()
