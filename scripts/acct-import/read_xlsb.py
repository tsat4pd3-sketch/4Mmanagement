#!/usr/bin/env python3
"""อ่าน .xlsb ของบัญชี → JSON {names, grids} (header:1 เหมือน sheet_to_json) — ตัวอ่านในเบราว์เซอร์ (xlsx 0.18) อ่าน .xlsb ตัวนี้ไม่ได้ (Bad SerAr)
   ใช้: python3 -I read_xlsb.py <in.xlsb> <out.json>   (ต้องมี pyxlsb: pip install pyxlsb)
   รันด้วย -I เสมอ (ไฟล์จากเมล = ข้อมูลไม่น่าเชื่อถือ ห้ามให้โหลดโมดูลจากโฟลเดอร์เดียวกัน)"""
import sys, json
from pyxlsb import open_workbook

def main(src, out):
    grids = {}
    with open_workbook(src) as wb:
        names = list(wb.sheets)
        for name in names:
            with wb.get_sheet(name) as sh:
                rows = []
                for row in sh.rows():
                    vals = [c.v for c in row]
                    while vals and vals[-1] is None:
                        vals.pop()
                    if any(v is not None and v != '' for v in vals):
                        rows.append(vals)
                grids[name] = rows
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'names': names, 'grids': grids}, f, ensure_ascii=False, default=str)
    print('sheets:', ' | '.join(f'{n} ({len(grids[n])} rows)' for n in names))

if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('usage: read_xlsb.py <in.xlsb> <out.json>')
    main(sys.argv[1], sys.argv[2])
