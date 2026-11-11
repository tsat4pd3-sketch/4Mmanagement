# -*- coding: utf-8 -*-
"""แม่แบบ TCO 5 ปี + Decision Matrix — โครงการ ECM (Build vs Buy) · 2026-11-11
Run:  python3 build_ecm_tco.py  →  ../TSAT_ECM_TCO_5Y_Template_2026-11-11.xlsx
หลัก: ช่องเหลือง = ให้กรอกจากใบเสนอราคา/ข้อมูลจริง · ห้ามเติมราคาเดา
      ตัวเลขที่ใส่ไว้แล้วมีเฉพาะของ SFM ที่มีที่มา (เด็คต้นทุน 20/10 · deploy.md)
"""
import os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.utils import get_column_letter as L

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "TSAT_ECM_TCO_5Y_Template_2026-11-11.xlsx")

F = "Tahoma"
GREEN_D = "0D3D14"; GREEN = "068734"; ORANGE = "D95323"; TINT = "F2F2F2"; INPUT = "FFF2CC"
thin = Side(style="thin", color="D9D9D9")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
HDR = dict(font=Font(name=F, bold=True, color="FFFFFF"), fill=PatternFill("solid", fgColor=GREEN_D),
           alignment=Alignment(horizontal="center", vertical="center", wrap_text=True))
NUM = '#,##0;[Red]-#,##0;"-"'


def style(c, **kw):
    for k, v in kw.items():
        setattr(c, k, v)
    if not c.font or c.font.name != F:
        c.font = Font(name=F, bold=c.font.bold if c.font else False, color=c.font.color if c.font else None)
    c.border = BOX


def hdr_row(ws, r, vals, c0=1):
    for i, v in enumerate(vals):
        c = ws.cell(r, c0 + i, v)
        style(c, **HDR)


def inp(c, v=None, fmt=NUM):
    if v is not None:
        c.value = v
    c.fill = PatternFill("solid", fgColor=INPUT)
    c.number_format = fmt
    c.font = Font(name=F)
    c.border = BOX


def title(ws, t, sub):
    ws["A1"] = t; ws["A1"].font = Font(name=F, bold=True, size=14, color=GREEN)
    ws["A2"] = sub; ws["A2"].font = Font(name=F, size=10, color="555555")


wb = Workbook()

# ───────────────────────── README ─────────────────────────
ws = wb.active; ws.title = "README"
title(ws, "TCO 5 ปี + Decision Matrix — โครงการ Enterprise Automation & Paperless (ECM)",
      "แม่แบบ ณ 11/11/2569 · จัดทำโดย PMO เพื่อประกอบการพิจารณาของ EVP")
lines = [
    "วิธีใช้",
    "1. ชีท Inputs — กรอกค่ากลาง (ค่าแรง FTE/ปี · อัตรา man-day · จำนวนผู้ใช้ · อัตราคิดลด)",
    "2. ชีท Opt1–Opt5 — 1 ชีทต่อ 1 ทางเลือก/ผู้ให้บริการ กรอกเฉพาะช่องสีเหลืองจากใบเสนอราคาจริง",
    "3. ชีท Summary — สรุปอัตโนมัติ + บอกว่าแต่ละทางเลือกยังขาดข้อมูลกี่ช่อง",
    "4. ชีท Decision Matrix — ตกลงน้ำหนักเกณฑ์ก่อนเห็นราคา แล้วให้คณะกรรมการประเมินให้คะแนน 1–5",
    "",
    "กติกา",
    "• ช่องสีเหลืองที่ยังว่าง = ยังไม่มีข้อมูล ห้ามเติมราคาเดา · ถ้ารายการนั้นไม่มีจริงให้ใส่ 0 (ไม่ใช่ปล่อยว่าง)",
    "• ทุกตัวเลขต้องเขียนที่มาในคอลัมน์ 'ที่มา' (เลขใบเสนอราคา / วันที่ / ผู้ให้ข้อมูล)",
    "• ต้นทุนต้องรวมค่าแรงคนภายในทุกทางเลือก — ไม่งั้น In-house จะดูถูกกว่าความจริง",
    "• เงินที่จ่ายไปแล้ว (sunk cost) ไม่นับใน TCO — แต่บันทึกไว้ในหมายเหตุ",
    "",
    "ผลประโยชน์ทับซ้อน",
    "• PMO เป็นผู้พัฒนาระบบ SFM (หนึ่งในทางเลือก) — ชีท Decision Matrix ให้คณะกรรมการประเมินกรอก ไม่ใช่ PMO",
]
for i, t in enumerate(lines):
    c = ws.cell(4 + i, 1, t)
    c.font = Font(name=F, bold=t in ("วิธีใช้", "กติกา", "ผลประโยชน์ทับซ้อน"), color=GREEN_D if t in ("วิธีใช้", "กติกา", "ผลประโยชน์ทับซ้อน") else "000000")
ws.column_dimensions["A"].width = 110

# ───────────────────────── Inputs ─────────────────────────
wi = wb.create_sheet("Inputs")
title(wi, "ค่ากลาง (ใช้ร่วมทุกทางเลือก)", "ช่องเหลือง = กรอก · ค่าที่ใส่ไว้แล้วมีที่มากำกับ")
hdr_row(wi, 4, ["ตัวแปร", "ค่า", "หน่วย", "ที่มา / หมายเหตุ"])
inputs = [
    ("FTE_COST", "ค่าแรงพนักงาน IT/Dev ภายใน (รวมสวัสดิการ)", None, "บาท/คน/ปี", "[รอ HR] เฉลี่ยตำแหน่งที่จะใช้"),
    ("USER_FTE_COST", "ค่าแรงผู้ใช้ที่มาช่วย BR/UAT", None, "บาท/คน/ปี", "[รอ HR]"),
    ("MD_RATE", "อัตรา man-day vendor (ใช้กับ Change Request)", None, "บาท/man-day", "[รอใบเสนอราคา] ถ้าแต่ละรายต่างกันให้กรอกในชีทรายนั้นแทน"),
    ("USERS", "จำนวนผู้ใช้ที่คาดว่าจะใช้ ECM", None, "คน", "[รอ BR] · SFM วันนี้มี 121 บัญชี (20/10) — คนละขอบเขตกับ ECM"),
    ("DISC", "อัตราคิดลด (สำหรับ NPV)", None, "%", "[รอ F&A] ปล่อยว่าง = ไม่คิด NPV"),
    ("FX", "อัตราแลกเปลี่ยน", 35, "บาท/USD", "ค่าเดียวกับเด็คต้นทุน ESM 20/10 (ตั้งสูงไว้เผื่อ)"),
    ("CONT", "เงินสำรองโครงการ (contingency) ของงบลงทุน", None, "%", "[รอ PMO/F&A ตกลง] ใช้กับทุกทางเลือกเท่ากัน"),
]
NAMES = {}
for i, (key, lab, v, unit, src) in enumerate(inputs):
    r = 5 + i
    wi.cell(r, 1, lab).font = Font(name=F)
    inp(wi.cell(r, 2), v, "0.0%" if unit == "%" else NUM)
    wi.cell(r, 3, unit).font = Font(name=F, color="555555")
    wi.cell(r, 4, src).font = Font(name=F, color="555555")
    for c in range(1, 5):
        wi.cell(r, c).border = BOX
    NAMES[key] = f"Inputs!$B${r}"
for col, w in zip("ABCD", (46, 16, 16, 70)):
    wi.column_dimensions[col].width = w

# ───────────────────────── Option sheets ─────────────────────────
YEARS = ["Y0 ลงทุน", "Y1", "Y2", "Y3", "Y4", "Y5"]
# (label, kind, note) kind: capex = เฉพาะ Y0 · opex = Y1–Y5 · both
CAPEX = [
    ("ค่า License ซื้อขาด (perpetual)", "ถ้าเป็น subscription ใส่ 0 แล้วไปกรอกด้านล่าง"),
    ("ค่า Implement / พัฒนา / ตั้งค่า", "ตาม scope ใน RFP ชุดเดียวกันทุกราย"),
    ("ค่าเชื่อมต่อระบบ (OT · OM · HR · ERP · SSO)", "แยกรายระบบในหมายเหตุ"),
    ("ค่าย้ายข้อมูล (data migration)", ""),
    ("ค่า Hardware / Infra เริ่มต้น", "server · storage · network · license OS/DB"),
    ("ค่าอบรม + change management", ""),
    ("ค่าที่ปรึกษา / PMO ภายนอก", "ถ้ามี"),
]
OPEX = [
    ("ค่า Subscription / License รายปี", "ถ้าคิดต่อผู้ใช้ ให้ใช้ แถวราคาต่อผู้ใช้ ข้างล่างแทน"),
    ("ค่า MA / AMC ของ vendor", "มัก % ของ license/implement — ระบุ % ในหมายเหตุ"),
    ("ค่า Hosting (Cloud / INET / On-prem)", ""),
    ("ค่า Change Request (man-day/ปี)", "กรอกจำนวน man-day — คูณอัตราจาก Inputs ให้อัตโนมัติ"),
    ("ค่า Security (pen test · backup · DR site)", ""),
    ("ค่าเครื่องมือพัฒนา / อื่นๆ", "เช่น เครื่องมือ AI · domain · SSL"),
]

OPTS = [
    ("Opt1", "พัฒนาใหม่เอง (In-house)", "In-house", {}),
    ("Opt2", "ต่อยอดระบบ SFM (ส่วนโรงงาน)", "In-house", {
        # ค่าที่มีที่มาเท่านั้น
        "ค่า Hosting (Cloud / INET / On-prem)": (120000, "INET 120,000 บาท/ปี — ไอทีแจ้ง 20/10 ยังไม่มีใบเสนอราคา · ยังไม่รู้ว่ารวม VAT/backup ไหม"),
        "ค่าเครื่องมือพัฒนา / อื่นๆ": (84000, "Claude Max 200 USD × 12 × 35 — เด็คต้นทุน 20/10"),
    }),
    ("Opt3", "Bendix", "[เลือก]", {}),
    ("Opt4", "OutSystems", "[เลือก]", {}),
    ("Opt5", "VR Intelligence", "[เลือก]", {}),
]
SUMMARY_REFS = {}

for code, name, kind, prefill in OPTS:
    ws = wb.create_sheet(code)
    title(ws, f"{code} · {name}", "ช่องเหลือง = กรอกจากใบเสนอราคา/ข้อมูลจริง · ไม่มีรายการนี้จริง = ใส่ 0")
    ws["A3"] = "ผู้ให้บริการ / ทางเลือก"; inp(ws["B3"], name, "@")
    ws["D3"] = "ประเภทแนวทาง"; inp(ws["E3"], kind, "@")
    ws["G3"] = "เลขใบเสนอราคา / วันที่"; inp(ws["H3"], None, "@")
    for a in ("A3", "D3", "G3"):
        ws[a].font = Font(name=F, bold=True)
    dv = DataValidation(type="list", formula1='"In-house,Outsource,Hybrid,[เลือก]"', allow_blank=True)
    ws.add_data_validation(dv); dv.add("E3")

    hdr_row(ws, 5, ["รายการ"] + YEARS + ["รวม 5 ปี", "ที่มา / หมายเหตุ"])
    r = 6
    ws.cell(r, 1, "ก. งบลงทุน (CAPEX)").font = Font(name=F, bold=True, color=GREEN)
    r += 1
    first_capex = r
    input_cells = []
    for lab, note in CAPEX:
        ws.cell(r, 1, lab).font = Font(name=F)
        inp(ws.cell(r, 2)); input_cells.append(f"B{r}")
        for c in range(3, 8):
            ws.cell(r, c).fill = PatternFill("solid", fgColor=TINT); ws.cell(r, c).border = BOX
        ws.cell(r, 8, f"=SUM(B{r}:G{r})").number_format = NUM
        ws.cell(r, 9, note).font = Font(name=F, color="555555", size=9)
        r += 1
    # contingency
    ws.cell(r, 1, "เงินสำรอง (contingency)").font = Font(name=F, italic=True)
    ws.cell(r, 2, f'=IF({NAMES["CONT"]}="","",SUM(B{first_capex}:B{r-1})*{NAMES["CONT"]})').number_format = NUM
    ws.cell(r, 8, f"=SUM(B{r}:G{r})").number_format = NUM
    ws.cell(r, 9, "คิดจาก % ในชีท Inputs").font = Font(name=F, color="555555", size=9)
    capex_end = r
    r += 2

    ws.cell(r, 1, "ข. ค่าดำเนินงานรายปี (OPEX)").font = Font(name=F, bold=True, color=GREEN)
    r += 1
    opex_rows = []
    for lab, note in OPEX:
        ws.cell(r, 1, lab).font = Font(name=F)
        ws.cell(r, 2).fill = PatternFill("solid", fgColor=TINT); ws.cell(r, 2).border = BOX
        pv = prefill.get(lab)
        if lab.startswith("ค่า Change Request"):
            # ใส่ man-day ในแถวช่วย แล้วคูณอัตรา
            for y in range(3, 8):
                inp(ws.cell(r + 1, y)); input_cells.append(f"{L(y)}{r+1}")
                ws.cell(r, y, f'=IF({L(y)}{r+1}="","",{L(y)}{r+1}*{NAMES["MD_RATE"]})').number_format = NUM
            ws.cell(r + 1, 1, "   └ จำนวน man-day/ปี").font = Font(name=F, color="555555")
            ws.cell(r, 8, f"=SUM(B{r}:G{r})").number_format = NUM
            ws.cell(r, 9, note).font = Font(name=F, color="555555", size=9)
            opex_rows.append(r)
            r += 2
            continue
        for y in range(3, 8):
            inp(ws.cell(r, y), pv[0] if pv else None); input_cells.append(f"{L(y)}{r}")
        ws.cell(r, 8, f"=SUM(B{r}:G{r})").number_format = NUM
        ws.cell(r, 9, pv[1] if pv else note).font = Font(name=F, color=ORANGE if pv else "555555", size=9)
        opex_rows.append(r)
        r += 1
    # per-user subscription
    ws.cell(r, 1, "ค่า Subscription ต่อผู้ใช้ (บาท/คน/ปี)").font = Font(name=F)
    for y in range(3, 8):
        inp(ws.cell(r + 1, y))
        ws.cell(r, y, f'=IF({L(y)}{r+1}="","",{L(y)}{r+1}*{NAMES["USERS"]})').number_format = NUM
    ws.cell(r + 1, 1, "   └ ราคาต่อผู้ใช้/ปี (ถ้าไม่ได้คิดแบบนี้ ใส่ 0)").font = Font(name=F, color="555555")
    ws.cell(r, 8, f"=SUM(B{r}:G{r})").number_format = NUM
    ws.cell(r, 9, "× จำนวนผู้ใช้ใน Inputs").font = Font(name=F, color="555555", size=9)
    input_cells += [f"{L(y)}{r+1}" for y in range(3, 8)]
    opex_rows.append(r)
    r += 3

    ws.cell(r, 1, "ค. คนภายใน (FTE)").font = Font(name=F, bold=True, color=GREEN)
    r += 1
    fte_rows = []
    for lab, key, note in [("ทีม IT / Dev ภายใน", "FTE_COST", "พัฒนา · ดูแลระบบ · integration"),
                           ("ผู้ใช้ที่มาช่วย BR / UAT", "USER_FTE_COST", "คิดเป็น FTE เทียบเท่า")]:
        ws.cell(r, 1, lab + " (บาท)").font = Font(name=F)
        ws.cell(r + 1, 1, "   └ จำนวน FTE").font = Font(name=F, color="555555")
        for y in range(2, 8):
            inp(ws.cell(r + 1, y), fmt="0.0"); input_cells.append(f"{L(y)}{r+1}")
            ws.cell(r, y, f'=IF({L(y)}{r+1}="","",{L(y)}{r+1}*{NAMES[key]})').number_format = NUM
        ws.cell(r, 8, f"=SUM(B{r}:G{r})").number_format = NUM
        ws.cell(r, 9, note).font = Font(name=F, color="555555", size=9)
        fte_rows.append(r)
        r += 2
    r += 1

    # totals
    tot = r
    ws.cell(tot, 1, "รวมต่อปี").font = Font(name=F, bold=True)
    rows_all = list(range(first_capex, capex_end + 1)) + opex_rows + fte_rows
    for y in range(2, 9):
        ws.cell(tot, y, "=" + "+".join(f"N({L(y)}{x})" for x in rows_all)).number_format = NUM
        ws.cell(tot, y).font = Font(name=F, bold=True, color=GREEN_D)
        ws.cell(tot, y).fill = PatternFill("solid", fgColor="E2EFDA")
    ws.cell(tot + 1, 1, "ช่องเหลืองที่ยังว่าง").font = Font(name=F, color=ORANGE, bold=True)
    blanks = "+".join(f'COUNTBLANK({c})' for c in input_cells)
    ws.cell(tot + 1, 2, "=" + blanks).font = Font(name=F, color=ORANGE, bold=True)
    ws.cell(tot + 1, 3, "ช่อง — ยังไม่ใช่ตัวเลขจริงจนกว่าจะเป็น 0").font = Font(name=F, color=ORANGE)
    ws.cell(tot + 2, 1, "NPV 5 ปี").font = Font(name=F, bold=True)
    ws.cell(tot + 2, 2, f'=IF({NAMES["DISC"]}="","ไม่ได้กรอกอัตราคิดลด",B{tot}+NPV({NAMES["DISC"]},C{tot}:G{tot}))').number_format = NUM
    sunk = "เงินที่ใช้ไปแล้ว ~32,000 บาท (พ.ค.–ต.ค. 69) = sunk cost ไม่นับใน TCO" if code == "Opt2" else ""
    ws.cell(tot + 3, 1, sunk).font = Font(name=F, color="555555", size=9)

    for col, w in zip("ABCDEFGHI", (44, 14, 14, 14, 14, 14, 14, 16, 60)):
        ws.column_dimensions[col].width = w
    ws.freeze_panes = "B6"
    SUMMARY_REFS[code] = dict(name=f"{code}!$B$3", kind=f"{code}!$E$3", capex=f"{code}!$B${tot}",
                              total=f"{code}!$H${tot}", blank=f"{code}!$B${tot+1}", npv=f"{code}!$B${tot+2}",
                              years=[f"{code}!${L(y)}${tot}" for y in range(2, 8)])

# ───────────────────────── Summary ─────────────────────────
wsum = wb.create_sheet("Summary", 1)
title(wsum, "สรุป TCO 5 ปี ต่อทางเลือก", "คำนวณจากชีท Opt1–Opt5 · ช่องที่ยังว่าง > 0 = ตัวเลขยังไม่ครบ ห้ามใช้เปรียบเทียบ")
hdr_row(wsum, 4, ["ทางเลือก", "ประเภท"] + YEARS + ["TCO 5 ปี", "NPV", "ช่องที่ยังว่าง", "สถานะข้อมูล"])
for i, (code, *_rest) in enumerate(OPTS):
    r = 5 + i
    s = SUMMARY_REFS[code]
    wsum.cell(r, 1, f"={s['name']}"); wsum.cell(r, 2, f"={s['kind']}")
    for j, ref in enumerate(s["years"]):
        wsum.cell(r, 3 + j, f"={ref}").number_format = NUM
    wsum.cell(r, 9, f"={s['total']}").number_format = NUM
    wsum.cell(r, 10, f"={s['npv']}").number_format = NUM
    wsum.cell(r, 11, f"={s['blank']}")
    wsum.cell(r, 12, f'=IF(K{r}=0,"ครบ","ยังไม่ครบ — ห้ามเทียบ")')
    for c in range(1, 13):
        wsum.cell(r, c).border = BOX
        if not wsum.cell(r, c).font or wsum.cell(r, c).font.name != F:
            wsum.cell(r, c).font = Font(name=F, bold=c in (1, 9))
wsum.conditional_formatting.add("L5:L9", FormulaRule(formula=['K5>0'], font=Font(name=F, color=ORANGE, bold=True)))
wsum.conditional_formatting.add("L5:L9", FormulaRule(formula=['K5=0'], font=Font(name=F, color=GREEN, bold=True)))
wsum.cell(10, 1, "ค่ากลางในชีท Inputs ที่ยังว่าง").font = Font(name=F, color=ORANGE, bold=True)
wsum.cell(10, 11, "=COUNTBLANK(Inputs!B5:B11)").font = Font(name=F, color=ORANGE, bold=True)
wsum.cell(11, 1, "หมายเหตุ: Opt2 ใส่ค่าที่มีที่มาแล้ว 2 รายการ (INET · เครื่องมือ AI) — ค่าแรงทีมยังว่าง ⇒ ตัวเลขตอนนี้ต่ำกว่าจริงแน่นอน").font = Font(name=F, color=ORANGE)
for col, w in zip("ABCDEFGHIJKL", (30, 12, 13, 12, 12, 12, 12, 12, 14, 18, 13, 22)):
    wsum.column_dimensions[col].width = w

# ───────────────────────── Decision Matrix ─────────────────────────
wd = wb.create_sheet("Decision Matrix", 2)
title(wd, "Decision Matrix (ถ่วงน้ำหนัก)",
      "ขั้น 1 ตกลงน้ำหนักก่อนเห็นราคา (รวม 100%) · ขั้น 2 คณะกรรมการประเมินให้คะแนน 1–5 (5 = ดีที่สุดสำหรับบริษัท)")
CRIT = [
    ("ระยะเวลาดำเนินการจนใช้งานได้", "12-18 ด.", "4-8 ด.", "6-12 ด."),
    ("เงินลงทุนเริ่มต้น", "ปานกลาง", "สูง", "ปานกลาง"),
    ("ค่าใช้จ่ายระยะยาว (TCO 5 ปี)", "ต่ำ", "สูง", "ปานกลาง"),
    ("ความยืดหยุ่นในการปรับแต่ง", "สูงมาก", "ปานกลาง", "สูง"),
    ("การควบคุม Source Code / ข้อมูล", "100%", "ต่ำ", "ปานกลาง-สูง"),
    ("การพึ่งพา Vendor (ยิ่งน้อยยิ่งดี)", "ต่ำ", "สูง", "ปานกลาง"),
    ("ความเสี่ยงโครงการ (ยิ่งต่ำยิ่งดี)", "สูง", "ปานกลาง", "ต่ำ-ปานกลาง"),
    ("รองรับ Business Process เฉพาะองค์กร", "สูงมาก", "ปานกลาง", "สูง"),
    ("การเชื่อมต่อ OT / OM", "พัฒนาเอง", "Vendor ทำ", "API + พัฒนาเพิ่ม"),
    ("Security & Compliance", "ออกแบบเอง", "มาตรฐาน Vendor", "Vendor + IT กำกับ"),
    ("ภาระดูแลระบบ / ทรัพยากร IT", "สูง", "ต่ำ", "ปานกลาง"),
    ("ความต่อเนื่องเมื่อคนสำคัญลาออก (key-person risk)", "", "", ""),
    ("ความพร้อม Infra (On-prem / Cloud / Hybrid)", "", "", ""),
    ("KPI/Dashboard คำนวณจาก raw data อัตโนมัติ (ไม่ใช่คนกรอกยอดสรุป)", "", "", ""),
]
opt_names = [o[1] for o in OPTS]
hdr_row(wd, 4, ["เกณฑ์", "น้ำหนัก %"] + opt_names + ["ค่าตั้งต้นในบันทึกเชิญ: In-house", "Outsource", "Hybrid"])
for i, (crit, a, b, c) in enumerate(CRIT):
    r = 5 + i
    wd.cell(r, 1, crit).font = Font(name=F)
    inp(wd.cell(r, 2), None, "0%")
    for j in range(len(OPTS)):
        inp(wd.cell(r, 3 + j), None, "0")
    for j, v in enumerate((a, b, c)):
        cc = wd.cell(r, 3 + len(OPTS) + j, v); cc.font = Font(name=F, color="888888", size=9)
    for col in range(1, 3 + len(OPTS) + 3):
        wd.cell(r, col).border = BOX
last = 4 + len(CRIT)
dvs = DataValidation(type="whole", operator="between", formula1="1", formula2="5", allow_blank=True,
                     error="คะแนน 1–5 เท่านั้น", showErrorMessage=True)
wd.add_data_validation(dvs); dvs.add(f"C5:{L(2+len(OPTS))}{last}")
r = last + 1
wd.cell(r, 1, "รวมน้ำหนัก (ต้อง = 100%)").font = Font(name=F, bold=True)
wd.cell(r, 2, f"=SUM(B5:B{last})").number_format = "0%"
wd.cell(r, 3, f'=IF(ROUND(B{r},4)=1,"ครบ 100%","น้ำหนักยังไม่ครบ 100%")').font = Font(name=F, color=ORANGE, bold=True)
r += 1
wd.cell(r, 1, "คะแนนถ่วงน้ำหนัก (เต็ม 5)").font = Font(name=F, bold=True)
for j in range(len(OPTS)):
    col = L(3 + j)
    wd.cell(r, 3 + j, f'=IF(COUNTBLANK({col}5:{col}{last})>0,"ให้คะแนนไม่ครบ",SUMPRODUCT($B$5:$B${last},{col}5:{col}{last}))').number_format = "0.00"
    wd.cell(r, 3 + j).font = Font(name=F, bold=True, color=GREEN_D)
wd.cell(r + 2, 1, "คอลัมน์สีเทาขวาสุด = ค่าที่บันทึกเชิญประชุมเขียนไว้ เป็นสมมติฐานตั้งต้น ไม่ใช่คะแนน — ให้คณะกรรมการตัดสินจากตัวเลขจริง").font = Font(name=F, color="555555", size=9)
wd.cell(r + 3, 1, "ผู้ให้คะแนน (ชื่อ/หน่วยงาน/วันที่):").font = Font(name=F, bold=True)
inp(wd.cell(r + 3, 2), None, "@")
wd.merge_cells(start_row=r + 3, start_column=2, end_row=r + 3, end_column=6)
for col, w in zip("ABCDEFGHIJ", (44, 11, 15, 15, 15, 15, 15, 16, 14, 14)):
    wd.column_dimensions[col].width = w
wd.row_dimensions[4].height = 42
wd.freeze_panes = "C5"

wb.save(OUT)
print("saved", OUT)
