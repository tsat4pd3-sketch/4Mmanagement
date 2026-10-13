# -*- coding: utf-8 -*-
"""สไลด์ประชุมเตรียมความพร้อม ESM Roadshow — 12 ต.ค. 2569 15:00 (ธีม TSG R01 · ภาษาไทย)
Run:  python3 build_prep_meeting.py  →  ../TSAT_ESM_Roadshow_Prep_2026-10-12.pptx
เนื้อหาชุดเดียวกับหน้าสรุปประชุม (artifact "Roadshow Prep Brief")
ตัวเลข: roadshow-metrics-2026-10-06.md · ข้อควรระวัง/จอเดโม: roadshow-dept-stories-2026-10-06.md
"""
import os
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
import tsg_theme as T
from tsg_theme import GREEN, GREEN_D, GREEN_TINT, BORDER, ORANGE, AMBER, GREY, WHITE

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "TSAT_ESM_Roadshow_Prep_2026-10-12.pptx")
p = T.new_pres()
page = [0]


def notes(s, th):
    s.notes_slide.notes_text_frame.text = th


def content(title, sub=None):
    s = T.blank(p); page[0] += 1
    T.head(s, title, sub)
    T.footer(s, page[0])
    return s


def box(s, x, y, w, h, head, lines, fill=GREEN_D, sz=14):
    T.rect(s, x, y, w, h, fill=WHITE, line=BORDER, shape=MSO_SHAPE.ROUNDED_RECTANGLE, shadow=True)
    T.rect(s, x, y, w, 0.5, fill=fill)
    T.text(s, x, y, w, 0.5, [[(head, {"sz": 16, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    T.text(s, x + 0.2, y + 0.65, w - 0.4, h - 0.75, [[("•  " + l, {"sz": sz, "c": GREEN})] for l in lines], sa=8)


# ── 1 ปก ──
s = T.title_slide(p, "ประชุมเตรียมความพร้อม ESM Roadshow",
                  "ทุกส่วนงานนำเสนอ workflow งานของตัวเอง",
                  "12 ตุลาคม 2569 · 15:00–16:00",
                  "TSAT · Thai Summit Group",
                  decl_label="คำประกาศคุณภาพของฉัน")
page[0] += 1
notes(s, "เปิดประชุม: Roadshow ปลายเดือนนี้ GM ทุกโรงในกลุ่มจะมาดู แต่ละส่วนงานต้องเล่า workflow งานของตัวเองบน ESM ส่วนงานละ 3 นาที วันนี้จะตกลงกันว่าใครเล่าอะไร เปิดจอไหน และส่งงานเมื่อไหร่")

# ── 2 วาระ ──
page[0] += 1
s = T.agenda_slide(p, page[0], "ประชุมเตรียมความพร้อม ESM Roadshow", "วาระ 60 นาที", [
    ("15:00  เป้า roadshow และไทม์ไลน์ถึงวันงาน", "ใครมาชม · วันไหน · ต้องพร้อมอะไรเมื่อไหร่"),
    ("15:05  โครงนำเสนอ 3 นาที + ตัวอย่าง 1 ส่วนงาน", "ซ่อมบำรุงเป็นตัวอย่าง เพราะตัวเลขชัดที่สุด"),
    ("15:15  ไล่ทีละส่วนงาน (10 ส่วนงาน)", "ยืนยัน workflow ที่จะเล่า · จอเดโม · ส่งต่อใคร · ตัวเลข"),
    ("15:45  กติกาการพูด", "ตัวเลขต้องมาจากระบบ · จอที่ห้ามเปิด · ไม่พูดตัวเลขเงินบาท"),
    ("15:55  มอบหมายงาน", "ผู้นำเสนอ · วันส่งร่าง · วันซ้อม · เรื่องที่ต้องตัดสิน"),
])
notes(s, "คุมเวลาให้ได้ ช่วงไล่ทีละส่วนงานให้แต่ละส่วนงานพูดไม่เกิน 3 นาที")

# ── 3 เป้าวันนี้ ──
s = content("สิ่งที่ต้องได้ก่อนเลิกประชุม", "3 ข้อ · ออกจากห้องแล้วทุกส่วนงานต้องรู้ว่าทำอะไรต่อ")
for i, (h, d) in enumerate([
        ("ทุกส่วนงานรู้ว่าต้องเล่าอะไร", "workflow ไหน · เปิดจอไหน · ใช้ตัวเลขไหน\nตามตารางรายส่วนงาน"),
        ("ใช้โครงเดียวกัน 3 นาที", "5 ช่วงเท่ากันทุกส่วนงาน\nผู้บริหารเทียบกันได้"),
        ("ได้ชื่อผู้นำเสนอ + วันส่งงาน", "ทุกส่วนงานมีเจ้าของ\nรู้วันซ้อม 19–22 ต.ค.")]):
    x = 0.5 + i * 4.15
    T.rect(s, x, 1.85, 4.0, 3.2, fill=WHITE, line=BORDER, shape=MSO_SHAPE.ROUNDED_RECTANGLE, shadow=True)
    T.rect(s, x, 1.85, 0.14, 3.2, fill=GREEN)
    T.text(s, x + 0.35, 2.05, 3.5, 0.6, [[(str(i + 1), {"sz": 36, "b": True, "c": ORANGE})]])
    T.text(s, x + 0.35, 2.85, 3.5, 0.9, [[(h, {"sz": 19, "b": True, "c": GREEN_D})]])
    T.text(s, x + 0.35, 3.85, 3.5, 1.1, [[(ln, {"sz": 14, "c": GREEN})] for ln in d.split("\n")], sa=4)
T.rect(s, 0.5, 5.35, 12.33, 1.0, fill=GREEN_TINT, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
T.text(s, 0.75, 5.35, 11.9, 1.0, [[("ผู้ชม: ", {"sz": 15, "b": True, "c": GREEN_D}),
                                   ("GM ทุกโรงงานในกลุ่ม TSG  ·  ", {"sz": 15, "c": GREEN}),
                                   ("วันงาน: ", {"sz": 15, "b": True, "c": GREEN_D}),
                                   ("สัปดาห์ 26–30 ต.ค. (วันจริงยังไม่ล็อก)", {"sz": 15, "c": GREEN})]], anchor=MSO_ANCHOR.MIDDLE)
notes(s, "ย้ำว่าวันนี้ไม่ได้ซ้อม แค่ตกลงว่าใครเล่าอะไร ซ้อมจริงคือ 19–22 ต.ค.")

# ── 4 ไทม์ไลน์ ──
s = content("ไทม์ไลน์ถึงวันงาน", "เหลือ 2 สัปดาห์ทำงาน ก่อน freeze โปรแกรม")
steps = [("12 ต.ค.", "วันนี้", "kickoff มอบหมายผู้นำเสนอ", True),
         ("16 ต.ค.", "(เสนอ)", "ส่งร่าง workflow + กรอก\n\"ก่อน ESM ใช้กี่นาที/วัน\"", False),
         ("19–22 ต.ค.", "ซ้อม", "รายส่วนงาน 3 นาที\nบนจอและเน็ตจริง (23 หยุด)", False),
         ("26 ต.ค.", "Freeze", "แก้ได้เฉพาะจอเดโมที่พัง", False),
         ("26–30 ต.ค.", "Roadshow", "เช้าวันงานวัดตัวเลขใหม่", False)]
w = 12.33 / 5
for i, (d, tag, desc, now) in enumerate(steps):
    x = 0.5 + i * w
    T.rect(s, x, 2.0, w + 0.12, 1.1, fill=ORANGE if now else (GREEN if i % 2 == 0 else GREEN_D),
           shape=MSO_SHAPE.PENTAGON if i == 0 else MSO_SHAPE.CHEVRON)
    T.text(s, x + 0.35, 2.0, w - 0.45, 1.1, [[(d, {"sz": 18, "b": True, "c": WHITE})], [(tag, {"sz": 13, "c": WHITE})]],
           anchor=MSO_ANCHOR.MIDDLE, sa=0)
    T.text(s, x + 0.1, 3.35, w - 0.2, 1.4, [[(ln, {"sz": 14, "c": GREEN})] for ln in desc.split("\n")], align=PP_ALIGN.CENTER, sa=2)
T.rect(s, 0.5, 5.0, 12.33, 1.2, fill=WHITE, line=ORANGE, lw=1.5, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
T.text(s, 0.75, 5.0, 11.9, 1.2, [[("ตั้งแต่ 26 ต.ค. ไม่เพิ่มฟีเจอร์ใหม่ ", {"sz": 15, "b": True, "c": ORANGE}),
                                  ("— ถ้าจออะไรยังไม่พร้อม ให้แจ้งก่อน 22 ต.ค. หลังจากนั้นแก้ได้เฉพาะจอที่พังระหว่างเดโม", {"sz": 14, "c": GREEN})]],
       anchor=MSO_ANCHOR.MIDDLE)
notes(s, "วันส่งร่าง 16 ต.ค. เป็นวันที่เสนอ ตกลงกันในห้องได้")

# ── 5 โครง 3 นาที ──
s = content("โครงนำเสนอ 3 นาที", "ใช้เหมือนกันทุกส่วนงาน")
frame = [("0:00–0:30", "งานของเรา", "หน้าที่ส่วนงาน\nรับงานจากใคร\nส่งต่อให้ใคร", False),
         ("0:30–1:00", "เมื่อก่อน", "กระดาษ / Excel / LINE\nใช้เวลากี่นาทีต่อวัน", False),
         ("1:00–2:00", "Workflow บน ESM", "เปิดจอจริง 1 จอ\nเดินให้ดูตั้งแต่ต้น\nจนส่งต่อแผนกอื่น", True),
         ("2:00–2:30", "ตัวเลขที่ดีขึ้น", "1–2 ตัว จากระบบ\nพร้อมวันที่วัด", False),
         ("2:30–3:00", "ยังขาดอะไร", "บอกตรงๆ\n+ เป้าเดือนหน้า", False)]
cw = 12.33 / 5
for i, (t_, h, d, demo) in enumerate(frame):
    x = 0.5 + i * cw
    T.rect(s, x + 0.05, 1.8, cw - 0.1, 4.4, fill=WHITE, line=ORANGE if demo else BORDER, lw=2 if demo else 0.75,
           shape=MSO_SHAPE.ROUNDED_RECTANGLE, shadow=True)
    T.rect(s, x + 0.25, 2.0, 1.6, 0.42, fill=ORANGE if demo else GREEN_D, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    T.text(s, x + 0.25, 2.0, 1.6, 0.42, [[(t_, {"sz": 13, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    T.text(s, x + 0.25, 2.65, cw - 0.5, 0.9, [[(h, {"sz": 16, "b": True, "c": ORANGE if demo else GREEN_D})]])
    T.text(s, x + 0.25, 3.6, cw - 0.5, 2.4, [[(ln, {"sz": 14, "c": GREEN})] for ln in d.split("\n")], sa=5)
notes(s, "ช่วงเดโม (กรอบส้ม) ใช้เวลาครึ่งหนึ่ง ต้องเปิดจอจริงไม่ใช่รูปบนสไลด์ · เลือก workflow ที่ส่งต่อแผนกอื่นได้ชัดที่สุด")

# ── 6 ตัวอย่าง: ซ่อมบำรุง ──
s = content("ตัวอย่าง: ซ่อมบำรุงเล่าตามโครง", "ส่วนงานอื่นทำแบบเดียวกันนี้")
ex = [("งานของเรา", "ซ่อมเครื่องเมื่อไลน์หยุด · รับเรียกจากผลิต · ส่ง QA ตรวจหลังซ่อม"),
      ("เมื่อก่อน", "ไลน์ต้องเดินหรือโทรตามช่าง · ใบแจ้งซ่อมกระดาษ FM-MTN-006 / FM-JIG-008"),
      ("Workflow บน ESM", "ไลน์กดเรียกช่างเลือกทีม → เด้งมือถือทีมนั้น → เปิดใบ MO ต่อจากเครื่องหยุด → ซ่อม → QA ตรวจ → ปิดใบ"),
      ("ตัวเลข", "เรียกช่างถึงรับเรื่อง P80: 529 → 30 นาที · ซ่อมเสร็จ P80: 7.9 → 0.9 ชม. (ส.ค. → ก.ย.)"),
      ("ยังขาด", "ใบ MO ค้างรอ QA ตรวจ 205 ใบ · เป้าเดือนหน้า: เคลียร์คิวรอ QA")]
for i, (h, d) in enumerate(ex):
    y = 1.8 + i * 0.92
    T.rect(s, 0.5, y, 2.6, 0.78, fill=ORANGE if i == 2 else GREEN_D, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    T.text(s, 0.5, y, 2.6, 0.78, [[(h, {"sz": 16, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    T.rect(s, 3.25, y, 9.58, 0.78, fill=GREEN_TINT, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    T.text(s, 3.45, y, 9.2, 0.78, [[(d, {"sz": 15, "c": GREEN})]], anchor=MSO_ANCHOR.MIDDLE)
T.text(s, 0.5, 6.42, 12.3, 0.35, [[("ตัวเลขวัดจากฐานข้อมูล ESM · 6 ต.ค. 2569", {"sz": 11, "i": True, "c": GREY})]])
notes(s, "เปิดจอ /mtn-repair ให้เห็นใบ MO ที่ต่อจาก downtime จริง · ถ้าถูกถามเรื่องคิวรอ QA ให้ตอบตรงๆ ว่ากำลังเคลียร์")

# ── 7–8 ตารางรายส่วนงาน ──
DEPTS = [
    ("ฝ่ายผลิต", "ใช้ทุกวัน", "เปิดกะ → สแกนคัมบัง → ลงเครื่องหยุด/ของเสีย → เรียกช่าง → ปิดกะ OEE ล็อก", "/daily-report",
     "รายงานกะ 505/เดือน · กะมี OEE ตอนปิด 70→96%", "PD1/PD2 ลงไม่ทุกวัน เลือกไลน์ที่ลงครบมาเดโม"),
    ("ซ่อมบำรุง", "ใช้ทุกวัน", "รับเรียก → เปิด MO ต่อจากเครื่องหยุด → ซ่อม → QA ตรวจ → ปิดใบ", "/mtn-repair · Andon ช่าง",
     "รับเรื่อง 529→30 นาที · ซ่อมเสร็จ 7.9→0.9 ชม.", "MO รอ QA 205 ใบ ตอบตรงๆ ถ้าถูกถาม"),
    ("JIG / DIE", "ข้อมูลน้อย", "เรียกช่างแยกทีม → เด้งเฉพาะทีมที่ถูกเรียก → MO ของทีม", "/mtn-repair กรองทีม JIG",
     "เดิมเรียกทั้ง 13 คน ตอนนี้เด้งเฉพาะทีม", "ผังแม่พิมพ์เปิดได้เมื่อวางหมุดแล้ว · ห้ามเปิดจอชิม"),
    ("QA", "ข้อมูลน้อย", "ถังเหลือง/แดงจากไลน์ → QA ตัดสิน → ใบรายงานของเสีย", "/qa แท็บถัง",
     "— (ตัดสินถังยัง 0)", "ตัดสินถังแดง 33 ใบให้เสร็จก่อนซ้อม"),
    ("สโตร์", "กำลังขยาย", "ไลน์ขอเติม → หยิบ สแกนชิ้น + QR จุดส่ง → ไลน์ยืนยันรับ", "/heijunka คิวเติม WIP",
     "เดิมรับคำขอผ่าน LINE กลุ่ม", "รับเข้าคลังยังช้า ~73 ชม. · ห้ามพูดว่ามีสแกน lot"),
    ("Logistic", "กำลังขยาย", "เมล EDI เข้าคิวเอง → นำเข้า → นับถอยหลังรอบส่ง → ส่ง ตัดสต็อก", "/planner-sales 📬 → /customer-demand",
     "ส่งตรงเวลา ส.ค. 91% · ต.ค. 87%", "ก.ย. ตก 72% เตรียมเหตุผล · เลิกบัญชีร่วม"),
    ("วางแผน / ขาย", "ข้อมูลน้อย", "บอร์ด Monitoring แทน Excel 13 ชีท · แผนผลิตบอกกะ/OT", "/monitoring",
     "Excel 13 ชีททำมือ → บอร์ดในระบบ", "แผนผลิต/คัมบังยังไม่มีคนใช้"),
    ("PE", "ข้อมูลน้อย", "PFC · PFMEA · Control Plan ข้อมูลชุดเดียว แก้ที่เดียวตรงกัน", "/pe-docs ชุด P703 สาย 060",
     "3 ไฟล์ Excel ต่อพาร์ท → ชุดเดียว", "เอกสารลงล่าสุด ส.ค."),
    ("HR / ธุรการ", "กำลังขยาย", "ใบอบรม OJT เซ็นบนจอ → พิมพ์ FM-HRM-004 · ปฏิทินบริษัท", "/ojt-training",
     "ใบ OJT ส.ค. 12 · ก.ย. 6", "เช็คว่ามีใบเซ็นครบจริงก่อนเปิด"),
    ("ผู้บริหาร", "กำลังขยาย", "ผังโรงงาน → TV → OBEYA KPI/SQDCM → สอบกลับใบผลิต", "เส้นทางเดโมที่ล็อกไว้",
     "ผู้ใช้จริง 71 คนใน 30 วัน", "Action board ยัง 0 ตั้งจริง ≥5 รายการ"),
]
STATUS_C = {"ใช้ทุกวัน": GREEN, "กำลังขยาย": AMBER, "ข้อมูลน้อย": ORANGE}


def dept_table(rows, part):
    s = content(f"ส่วนงานละ workflow เดียว ({part}/2)", "เลือก workflow ที่ส่งต่อแผนกอื่นได้ชัดที่สุด")
    cols = [("ส่วนงาน", 1.9), ("Workflow ที่จะเล่า", 3.55), ("จอเดโม", 2.0), ("ตัวเลขที่ใช้ได้", 2.5), ("ต้องระวัง", 2.38)]
    x0, y = 0.5, 1.72
    xs = [x0]
    for _, cw_ in cols:
        xs.append(xs[-1] + cw_)
    for j, (h, cw_) in enumerate(cols):
        T.rect(s, xs[j], y, cw_, 0.44, fill=GREEN_D)
        T.text(s, xs[j] + 0.08, y, cw_ - 0.16, 0.44, [[(h, {"sz": 13, "b": True, "c": WHITE})]], anchor=MSO_ANCHOR.MIDDLE)
    y += 0.44
    rh = 0.9
    for i, (name, st, wf, scr, num, warn) in enumerate(rows):
        fill = GREEN_TINT if i % 2 else WHITE
        T.rect(s, x0, y, 12.33, rh, fill=fill, line=BORDER, lw=0.5)
        T.text(s, xs[0] + 0.08, y + 0.06, cols[0][1] - 0.16, 0.4, [[(name, {"sz": 14, "b": True, "c": GREEN_D})]])
        T.rect(s, xs[0] + 0.1, y + 0.5, 1.35, 0.3, fill=STATUS_C[st], shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        T.text(s, xs[0] + 0.1, y + 0.5, 1.35, 0.3, [[(st, {"sz": 10.5, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        for j, (v, sz, c, b) in enumerate([(wf, 12, GREEN, False), (scr, 12, GREEN_D, True), (num, 12, GREEN, False), (warn, 12, ORANGE, True)], start=1):
            T.text(s, xs[j] + 0.08, y + 0.04, cols[j][1] - 0.16, rh - 0.08, [[(v, {"sz": sz, "b": b, "c": c})]], anchor=MSO_ANCHOR.MIDDLE)
        y += rh
    notes(s, "ให้แต่ละส่วนงานยืนยัน workflow และจอเดโมของตัวเอง ถ้าจะเปลี่ยน บอกในห้องเลย · สถานะ: เขียว = ใช้ทุกวัน · เหลือง = กำลังขยาย · ส้ม = ระบบพร้อมแต่ข้อมูลยังน้อย (พูดว่า 'ระบบรองรับ')")
    return s


dept_table(DEPTS[:5], 1)
dept_table(DEPTS[5:], 2)

# ── 9 กติกา ──
s = content("กติกาการพูด", "ผู้บริหารจะถามต่อทุกตัวเลข — พูดเฉพาะที่ระบบยืนยันได้")
box(s, 0.5, 1.8, 6.05, 4.5, "ต้องทำ", [
    "ตัวเลขทุกตัวมาจากระบบ และบอกวันที่วัด",
    "ระบบพร้อมแต่ยังใช้น้อย ให้พูดว่า \"ระบบรองรับ\"",
    "เปิดจอจริง ไม่ใช้รูปหน้าจอแทน",
    "ล็อกอินด้วยบัญชีของตัวเอง",
    "เด็คใช้ธีม TSG Revision 01 เท่านั้น",
], fill=GREEN, sz=15)
box(s, 6.78, 1.8, 6.05, 4.5, "ห้ามทำ", [
    "พูดว่า \"ใช้เต็มแล้ว\" ถ้ายังไม่ได้ใช้ทุกวัน",
    "พูดตัวเลขเงินบาท (รอฝ่ายบัญชีคำนวณ)",
    "พูดว่าต่อ SAP / SCADA แล้ว (เป็นแผนถัดไป)",
    "เปิดจอ /improvements · 8D · NCR/CAPA · บันทึกชิม · /adoption-outlook",
    "ใช้บัญชีร่วมของแผนก",
], fill=ORANGE, sz=15)
notes(s, "จอที่ห้ามเปิดเป็นจอที่ยังไม่มีข้อมูลจริง เปิดแล้วจะเห็นว่าว่าง · /group-overview เปิดได้แต่ต้องบอกว่าเป็นตัวอย่างจอ")

# ── 10 ส่งงาน + ตัดสิน ──
s = content("มอบหมายงาน", "ทุกส่วนงานส่งภายใน 16 ต.ค. · และ 3 เรื่องที่ต้องตัดสินวันนี้")
box(s, 0.5, 1.8, 6.05, 4.5, "แต่ละส่วนงานส่ง", [
    "ชื่อผู้นำเสนอ 1 คน + ตัวสำรอง 1 คน",
    "เวลาที่ใช้ก่อน ESM (นาที/วัน) + ใบกระดาษที่เลิกใช้",
    "ลำดับคลิกจอเดโม ลองบนเครื่องและเน็ตที่ห้องจริง",
    "คำถามที่คาดว่าจะโดนถาม 2 ข้อ + คำตอบ",
], fill=GREEN_D, sz=15)
box(s, 6.78, 1.8, 6.05, 4.5, "ต้องตัดสินวันนี้", [
    "วันและสถานที่ roadshow จริง + จอที่ใช้ (TV / โปรเจคเตอร์ · มีเน็ตไหม)",
    "ลำดับนำเสนอ 10 ส่วนงาน + พิธีกรเดินเรื่อง",
    "วันซ้อมของแต่ละส่วนงาน (19–22 ต.ค.) + คนคุมเครื่อง",
], fill=ORANGE, sz=15)
notes(s, "ปิดประชุมด้วยการทวนชื่อผู้นำเสนอทุกส่วนงาน และวันที่จะส่งงาน")

# ── 11 ปิด ──
page[0] += 1
T.closing_slide(p, page[0], "Before We Build Parts, We Build People", [
    ("แต่ละส่วนงาน 3 นาที · เล่า workflow ของตัวเอง · เปิดจอจริง", ORANGE),
    ("ขอบคุณ", GREEN)])

p.save(OUT)
print("saved", os.path.abspath(OUT), "slides:", len(p.slides))
