# -*- coding: utf-8 -*-
"""ใบงาน PE — BOM ที่นิยามไว้หลายใบ · สร้างไฟล์ Excel ให้ PE ติ๊กในไฟล์ได้
ข้อมูลทุกบรรทัดวัดจากฐาน Product DB (DR) 2026-10-20 — ห้ามแก้ตัวเลขในสคริปต์โดยไม่วัดใหม่"""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter

F = 'Tahoma'                       # ฟอนต์มาตรฐานเอกสาร TSG + อ่านภาษาไทยได้ทุกเครื่อง
HDR_BG = PatternFill('solid', fgColor='0D3D14')   # เขียวเข้ม TSG R01 (หัวตาราง)
FILL_IN = PatternFill('solid', fgColor='FFF9C4')  # เหลือง = ช่องที่ PE ต้องกรอก
EX_BG   = PatternFill('solid', fgColor='EEEEEE')  # แถวตัวอย่าง
GRP = {'A': 'C62828', 'B': 'EF6C00', 'C': '6A1B9A', 'D': 'B71C1C', 'E': '546E7A'}
thin = Side(style='thin', color='BDBDBD')
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)

COLS = [
    ('ลำดับ', 7), ('กลุ่ม', 9), ('พาร์ท (MAT)', 13), ('ชื่อพาร์ท', 34),
    ('ของที่มีปัญหา', 32), ('ใบที่นิยามไว้ + ค่าที่เขียน', 46),
    ('ปัญหาคืออะไร', 34), ('ทางแก้ที่เสนอ', 30),
    ('ผลตัดสิน (เลือก)', 24), ('แก้เป็นค่าอะไร', 18),
    ('ผู้ตัดสิน', 16), ('วันที่', 12), ('หมายเหตุ', 30),
]
FILL_FROM = 9      # คอลัมน์ I เป็นต้นไป = ช่องที่ PE กรอก

ROWS = [
    # (ลำดับ, กลุ่ม, mat, ชื่อ, ของ, ใบ+ค่า, ปัญหา, ทางแก้)
    ('A1','A','20059851','REINF FRT BMPR-N1WB-17A835-RA ก่อนชุบ',
     '30042571 W520771-S300 NUT WELD M6 HF 10',
     'ใบของตัวเอง = x4 | ใบ FG 10092454 = x4 | ใบ 20059822 = x1',
     '2 ใบว่า 4 ใบเดียวว่า 1 — และ 20059822 คือตัวเดียวกันหลังชุบ',
     'แก้จำนวนในใบที่ผิด'),
    ('A2','A','20059362','L_BRKT RR BMPR CVR-N1WB-17E850R-PIA06',
     '50026143 WSS-M1A367-A36 1.5X93XC (คอยล์ KG)',
     'ใบ 10100286 = x0.027 | ใบ 20059360 = x0.027 | ใบ 20059357 = x1',
     '"1" ไม่ใช่น้ำหนักคอยล์ — น่าจะกรอกจำนวนชิ้นลงช่องน้ำหนัก',
     'แก้ใบ 20059357 เป็น 0.027'),
    ('A3','A','20059370','SUPPORT BRKT RR BMPR CVR MTNG RH/LH',
     '50027723 WSS-M1A367-A36 1.5X176XC (คอยล์ KG)',
     'ใบ 20059369 = x0.079 | ใบ 20059372 = x0.079 | ใบ 20059367 = x1 | ใบ 20059371 = x1',
     'รูปแบบเดียวกับ A2 แต่แบ่งเป็น 2 ค่าย ค่ายละ 2 ใบ',
     'แก้ 2 ใบที่เป็น 1 ให้เป็น 0.079'),
    ('B1','B','20058483','PLT FRT S/M INR REINF RH (MB3BE10564AA)',
     '50027080 WSS-M1A365-A13 1X127XC (คอยล์ KG)',
     'ใบ 10086024 / 10100814 / 10101158 = x0.038 | ใบ 20058498 = x0.076',
     'ต่างกันพอดี 2 เท่า = คนละหน่วย (ต่อ shot vs ต่อชิ้น) ไม่ใช่กรอกผิด',
     'เคาะหน่วยทั้งโรงงาน ห้ามแก้ทีละใบ'),
    ('B2','B','20058693','BRKT RAD SUPT UPR RH (8226)(BL)',
     '50027090 WSS-M1A367-A38 2X423XC (คอยล์ KG)',
     'ใบ 20058488 / 20059953 = x0.498 | ใบ 20058498 = x0.996',
     'ต่างกันพอดี 2 เท่า = คนละหน่วย',
     'เคาะหน่วยทั้งโรงงาน ห้ามแก้ทีละใบ'),
    ('B3','B','20066663','SUPT FRT WHL/HS CTR RR',
     '50027083 WSS-M1A367-A33 1.7X 350XC (คอยล์ KG)',
     'ใบ FG 10100385 / 10106790 = x0.171 | ใบของตัวเอง = x0.341',
     'ทะเบียนเขียน "1:2" ไว้เองในช่อง Part No. · 0.341/2=0.1705 ปัดเป็น 0.171',
     'เคาะหน่วยทั้งโรงงาน ห้ามแก้ทีละใบ'),
    ('C1','C','20058626','REINF FRT FNDR @ BAT MTNG LWR LH',
     'คอยล์ 50027969 vs นัท 30044771 / 30045438 / 30046828',
     'ใบของตัวเอง = คอยล์ | E025 (M6) = นัท M6 x1 | E025 (M8) = นัท M8 x2 | E025 (M10) = นัท M10 x1',
     'เปิดใบ E025 (M6) จะได้แค่นัท ไม่มีคอยล์ (ใบที่กางอยู่ชนะทั้งชุด)',
     'ใส่ของให้ครบทุกใบ หรือจัดโครงใบใหม่'),
    ('C2','C','20066332','BRKT ENG ELETR GRD (MB3BE102D04BC)',
     'BLANK 20065734 vs สตัด 30051209',
     'ใบ 10100335 / 10100401 / 10106791 / 20066622 = 20065734 x1 | ใบ D04 (BOLT M6) = 30051209 x1',
     'ใบ D04 ไม่มี BLANK ⇒ เปิดใบนั้นได้แต่สตัด',
     'ใส่ของให้ครบทุกใบ หรือจัดโครงใบใหม่'),
    ('D1','D','20067545','REINF FLR TNL LWR (MY24)',
     '20067543 / 20067544 / 20070738 / 30046428 / 30046429 (5 ตัว)',
     'ใบ 10102017 เขียนไว้แค่ 50029126 | ใบของพาร์ทเองมี 6 ตัว',
     'ของ 5 ตัวไม่ถูกระเบิดเลย — ความต้องการเป็น 0 ทั้งที่ใช้จริง',
     'เติมของที่ขาดในใบแม่'),
    ('D2','D','20066630','REINF ASY RAD LWR(MB3B-8C306-BA) ก่อนแพ็ก',
     'ของที่ขาด 9 ตัว',
     'ใบ 20070036 เขียนไว้ 3 ตัว | ใบของพาร์ทเองมี 12 ตัว',
     'ของ 9 ตัวไม่ถูกระเบิดเลย',
     'เติมของที่ขาดในใบแม่'),
    ('D3','D','20070036','REINF ASY RAD LWR(RB3B-8C306-BC) ก่อนแพ็ค',
     '20066630',
     'ใบ 10105772 เขียน 12 รายการ | ใบของพาร์ทเองมี 13 (เกิน 20066630)',
     '20066630 ไม่ถูกระเบิดเมื่อเปิดจากใบ FG',
     'เติมของที่ขาดในใบแม่'),
    ('E1','E','20058498','SUPT ASY RAD(MB3B-8A297-CB) ก่อนชุบ',
     '15 รายการ (ตรงกันเป๊ะทุกใบ)',
     'ใบ 10086024 / 10100814 / 10101158 + ใบของตัวเอง = 4 ใบ',
     'ยังไม่ผิด แต่วันหน้าแก้ใบเดียวแล้วอีก 3 ใบค้าง = ขัดกันเงียบ',
     'เลือกว่าจะเก็บใบไหนเป็นตัวจริง'),
    ('E2','E','20059360','BRKASY RR BMPR-N1WB-17E850R-PIA04 ก่อนชุบ',
     '5 รายการ (ตรงกัน)', 'ใบ 10100286 + ใบของตัวเอง',
     'ยังไม่ผิด แต่ต้องแก้ 2 ที่ทุกครั้ง', 'เลือกว่าจะเก็บใบไหนเป็นตัวจริง'),
    ('E3','E','20063131','H BRACE RH (N1WB-E16498-AA)',
     '20063130 (ตรงกัน)', 'ใบ 10087199 + ใบของตัวเอง',
     'ยังไม่ผิด แต่ต้องแก้ 2 ที่ทุกครั้ง', 'เลือกว่าจะเก็บใบไหนเป็นตัวจริง'),
    ('E4','E','20059822','REINF FRT BMPR-N1WB-17A835-RA หลังชุบ',
     '20059851 (ตรงกัน)', 'ใบ 10092454 + ใบของตัวเอง',
     'ยังไม่ผิด แต่ต้องแก้ 2 ที่ทุกครั้ง', 'เลือกว่าจะเก็บใบไหนเป็นตัวจริง'),
    ('E5','E','20058488','BRKT RAD SUPT UPR RH (MB3B8226AA)',
     '20058693 (ตรงกัน)', 'ใบ 20058498 + ใบของตัวเอง',
     'ยังไม่ผิด แต่ต้องแก้ 2 ที่ทุกครั้ง', 'เลือกว่าจะเก็บใบไหนเป็นตัวจริง'),
]

DECISIONS = ['แก้ BOM แล้ว', 'ถูกทั้ง 2 ใบ (ปล่อยไว้)', 'พักไว้ก่อน', 'ต้องถามคนอื่น']

wb = Workbook()
ws = wb.active
ws.title = 'ใบงาน PE'

def put(r, c, v, *, bold=False, size=10, color='000000', wrap=True, fill=None,
        align='left', valign='top', border=True):
    cell = ws.cell(row=r, column=c, value=v)
    cell.font = Font(name=F, size=size, bold=bold, color=color)
    cell.alignment = Alignment(wrap_text=wrap, vertical=valign, horizontal=align)
    if fill: cell.fill = fill
    if border: cell.border = BORDER
    return cell

# ── หัวเรื่อง + คำอธิบาย (legend) ────────────────────────────────────────────
ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(COLS))
put(1, 1, 'ใบงาน PE — BOM ที่นิยามไว้หลายใบ ต้องตัดสิน', bold=True, size=14, border=False)
ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=len(COLS))
put(2, 1, 'วัดจากฐานจริง Product DB (DR) วันที่ 2026-10-20 · bom_items ที่ใช้งานอยู่ 653 แถว · '
          'พาร์ทที่ถูกนิยามลูกไว้ตั้งแต่ 2 ใบ = 40 ตัว (ไม่มีใบ BOM ของตัวเอง 17 · นิยามไว้ตั้งแต่ 3 ใบ 13)',
    size=9, color='555555', border=False)
ws.merge_cells(start_row=3, start_column=1, end_row=3, end_column=len(COLS))
put(3, 1, 'วิธีใช้: กรอกเฉพาะช่องพื้นเหลือง (ผลตัดสิน / แก้เป็นค่าอะไร / ผู้ตัดสิน / วันที่ / หมายเหตุ) · '
          'ช่อง "ผลตัดสิน" เป็น dropdown เลือกได้ · แถวสีเทาคือตัวอย่าง ลบทิ้งได้',
    size=9, color='555555', border=False)
ws.merge_cells(start_row=4, start_column=1, end_row=4, end_column=len(COLS))
put(4, 1, 'ไฟล์นี้เป็นภาพ ณ วันที่วัด — ของจริงอยู่ที่จอ /products แท็บ BOM ซ้ำ เสมอ (แก้ BOM แล้วรายการหายจากจอเอง) · '
          'ระบบไม่แก้ข้อมูลให้เอง ไม่ยุบ ไม่ลบ ไม่แก้จำนวน — PE เป็นคนแก้',
    bold=True, size=9, color='C62828', border=False)
for r in (1, 2, 3, 4):
    ws.row_dimensions[r].height = {1: 22, 2: 26, 3: 26, 4: 26}[r]

HR = 6                                            # แถวหัวตาราง
for i, (name, width) in enumerate(COLS, start=1):
    put(HR, i, name, bold=True, size=10, color='FFFFFF', fill=HDR_BG, align='center', valign='center')
    ws.column_dimensions[get_column_letter(i)].width = width
ws.row_dimensions[HR].height = 30

# ── แถวตัวอย่าง (ของที่กรอกแล้วหน้าตาเป็นยังไง) ───────────────────────────────
ex = ['(ตัวอย่าง)', '-', '20000000', 'ชื่อพาร์ทตัวอย่าง', 'ของที่มีปัญหา',
      'ใบ A = x1 | ใบ B = x2', 'อธิบายว่าต่างกันตรงไหน', 'ทางแก้ที่เสนอ',
      'แก้ BOM แล้ว', '4', 'ชื่อ PE', '2026-10-21', 'แก้ที่ใบ B ให้ตรงกับใบ A']
for i, v in enumerate(ex, start=1):
    put(HR + 1, i, v, size=9, color='888888', fill=EX_BG)
ws.row_dimensions[HR + 1].height = 26

# ── รายการจริง ───────────────────────────────────────────────────────────────
first = HR + 2
for n, row in enumerate(ROWS):
    r = first + n
    for i, v in enumerate(row, start=1):
        bold = (i <= 3)
        color = GRP[row[1]] if i <= 2 else '000000'
        put(r, i, v, bold=bold, size=10, color=color)
    for i in range(FILL_FROM, len(COLS) + 1):
        put(r, i, None, fill=FILL_IN)
    ws.row_dimensions[r].height = 42
last = first + len(ROWS) - 1

dv = DataValidation(type='list', formula1='"%s"' % ','.join(DECISIONS),
                    allow_blank=True, showDropDown=False)
dv.error = 'เลือกจากรายการที่มีให้เท่านั้น'
dv.prompt = 'เลือกผลตัดสิน (ชุดเดียวกับปุ่มบนจอ /products แท็บ BOM ซ้ำ)'
ws.add_data_validation(dv)
dv.add('I%d:I%d' % (first, last))

ws.freeze_panes = 'C%d' % (HR + 1)
ws.auto_filter.ref = 'A%d:M%d' % (HR, last)

# ── ช่องเซ็น ─────────────────────────────────────────────────────────────────
sg = last + 2
put(sg, 1, 'ผู้รับงาน (PE)', bold=True, border=False)
ws.merge_cells(start_row=sg, start_column=2, end_row=sg, end_column=4)
put(sg, 2, None, fill=FILL_IN)
put(sg, 5, 'วันที่', bold=True, border=False)
put(sg, 6, None, fill=FILL_IN)
put(sg + 1, 1, 'ผู้ตรวจทาน', bold=True, border=False)
ws.merge_cells(start_row=sg + 1, start_column=2, end_row=sg + 1, end_column=4)
put(sg + 1, 2, None, fill=FILL_IN)
put(sg + 1, 5, 'วันที่', bold=True, border=False)
put(sg + 1, 6, None, fill=FILL_IN)

# ═══ ชีท 2: สรุปความคืบหน้า (นับจากคอลัมน์ผลตัดสิน — ต้องเป็นสูตร ไม่ใช่เลขตาย) ═══
s2 = wb.create_sheet('สรุป')
s2.column_dimensions['A'].width = 34
s2.column_dimensions['B'].width = 12
s2.column_dimensions['C'].width = 52
put2 = lambda r, c, v, **kw: (lambda cell: (
    cell.__setattr__('font', Font(name=F, size=kw.get('size', 10), bold=kw.get('bold', False),
                                  color=kw.get('color', '000000'))),
    cell.__setattr__('alignment', Alignment(wrap_text=True, vertical='top')), cell)[-1]
)(s2.cell(row=r, column=c, value=v))

put2(1, 1, 'สรุปความคืบหน้า', bold=True, size=13)
put2(2, 1, 'นับสดจากคอลัมน์ "ผลตัดสิน" ในชีทใบงาน PE — กรอกแล้วตัวเลขขยับเอง', size=9, color='555555')
rng = "'ใบงาน PE'!$I$%d:$I$%d" % (first, last)
rows2 = [
    ('รายการทั้งหมด', '=COUNTA(\'ใบงาน PE\'!$C$%d:$C$%d)' % (first, last), 'ทุกกลุ่มรวมกัน'),
    ('ยังไม่ตัดสิน', '=COUNTBLANK(%s)' % rng, 'ช่องผลตัดสินยังว่าง'),
    ('แก้ BOM แล้ว', '=COUNTIF(%s,"แก้ BOM แล้ว")' % rng, 'แก้ในระบบเรียบร้อย'),
    ('ถูกทั้ง 2 ใบ (ปล่อยไว้)', '=COUNTIF(%s,"ถูกทั้ง 2 ใบ (ปล่อยไว้)")' % rng, 'คนละรุ่น/คนละมุมมอง ไม่ต้องแก้'),
    ('พักไว้ก่อน', '=COUNTIF(%s,"พักไว้ก่อน")' % rng, 'รอข้อมูลเพิ่ม'),
    ('ต้องถามคนอื่น', '=COUNTIF(%s,"ต้องถามคนอื่น")' % rng, 'ต้องให้คนอื่นเคาะก่อน'),
]
for n, (k, f, note) in enumerate(rows2):
    r = 4 + n
    put2(r, 1, k, bold=(n == 0))
    put2(r, 2, f, bold=True)
    put2(r, 3, note, size=9, color='555555')

put2(12, 1, 'ความเร่งของแต่ละกลุ่ม', bold=True, size=12)
grp_note = [
    ('A — ตัวเลขผิดแน่', '=COUNTIF(\'ใบงาน PE\'!$B$%d:$B$%d,"A")' % (first, last),
     'รายการตรงกัน ต่างแค่จำนวน และไม่ใช่เรื่องหน่วย — แก้ใบที่ผิด'),
    ('B — ชิ้น vs shot (x2)', '=COUNTIF(\'ใบงาน PE\'!$B$%d:$B$%d,"B")' % (first, last),
     'ไม่ใช่กรอกผิด คนละหน่วยในช่องเดียวกัน — ต้องเคาะหน่วยทั้งโรงงาน ห้ามแก้ทีละใบ'),
    ('C — ใบแยกตามรุ่นอุปกรณ์ยึด', '=COUNTIF(\'ใบงาน PE\'!$B$%d:$B$%d,"C")' % (first, last),
     'เปิดใบไหนได้แค่ของในใบนั้น (คอยล์หาย/BLANK หาย) — จัดโครงใบใหม่'),
    ('D — ใบแม่ขาดของ', '=COUNTIF(\'ใบงาน PE\'!$B$%d:$B$%d,"D")' % (first, last),
     'เร่งที่สุดเชิงยอด: ของที่ขาดไม่ถูกระเบิดเลย ความต้องการเป็น 0 ทั้งที่ใช้จริง'),
    ('E — ตรงกันแต่ยังนิยามหลายใบ', '=COUNTIF(\'ใบงาน PE\'!$B$%d:$B$%d,"E")' % (first, last),
     'ยังไม่ผิดวันนี้ — แต่วันหน้าแก้ใบเดียวแล้วใบอื่นค้าง = ขัดกันเงียบ'),
]
for n, (k, f, note) in enumerate(grp_note):
    r = 13 + n
    put2(r, 1, k, bold=True)
    put2(r, 2, f, bold=True)
    put2(r, 3, note, size=9, color='555555')

# ═══ ชีท 3: ของที่ระบบตรวจแล้วว่าไม่ใช่ปัญหา (กัน PE เสียเวลาไล่) ═══
s3 = wb.create_sheet('ไม่ต้องทำอะไร')
for c, w in zip('ABC', (26, 12, 86)):
    s3.column_dimensions[c].width = w
put3 = lambda r, c, v, **kw: (lambda cell: (
    cell.__setattr__('font', Font(name=F, size=kw.get('size', 10), bold=kw.get('bold', False),
                                  color=kw.get('color', '000000'))),
    cell.__setattr__('alignment', Alignment(wrap_text=True, vertical='top')), cell)[-1]
)(s3.cell(row=r, column=c, value=v))
put3(1, 1, 'ระบบตรวจแล้วว่าไม่ใช่ปัญหา — ไม่ต้องไล่', bold=True, size=13)
put3(2, 1, 'ใส่ไว้เพื่อไม่ให้เสียเวลาไล่ของที่ถูกอยู่แล้ว', size=9, color='555555')
for i, h in enumerate(['เรื่อง', 'จำนวน', 'ทำไมถึงไม่ใช่ปัญหา'], start=1):
    c = put3(4, i, h, bold=True, color='FFFFFF')
    c.fill = HDR_BG
put3(5, 1, 'ลึกกว่ากัน 1 ขั้น (โซ่ตรงกัน)', bold=True)
put3(5, 2, '10 คู่', bold=True)
put3(5, 3, 'ใบ FG บันทึกละเอียดกว่าใบของพาร์ท แต่ของตรงกัน เช่น ใบ FG เขียน 20059852 -> 20059853 '
           'ส่วนใบของ 20059852 เขียน -> 20059854 + 30042570 ซึ่ง 2 ตัวนั้นอยู่ใต้ 20059853 อีกชั้น '
           '(ส่วนใหญ่อยู่ใต้ใบ 10100286 และ 10092454)')
put3(6, 1, 'ใบขั้นงาน (OP)', bold=True)
put3(6, 2, '5 คู่', bold=True)
put3(6, 3, 'ใบขั้นงานตอบ "ขั้นนี้กินอะไร" ใบพาร์ทตอบ "พาร์ทนี้ประกอบจากอะไร" — คนละคำถาม ถูกทั้งคู่')
for r in (5, 6):
    s3.row_dimensions[r].height = 56

out = 'docs/BOM-PE-WORKLIST-2026-10-20.xlsx'
wb.save(out)
print('saved', out, '· รายการ', len(ROWS), 'แถว', first, '-', last)
