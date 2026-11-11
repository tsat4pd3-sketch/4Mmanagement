# -*- coding: utf-8 -*-
"""สไลด์สรุปหน้าเดียว "ESM — Workflow หลัก" (ธีม TSG R01 · 2026-11-11 · ขมวดจากเด็ค build_workflow_video.py)
Run:  python3 build_workflow_onepage.py  →  ../TSAT_ESM_Workflow_OnePage_2026-11-11.pptx
"""
import os
from pptx.util import Inches
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
import tsg_theme as T
from tsg_theme import GREEN, GREEN_D, GREEN_TINT, BORDER, ORANGE, GREY, WHITE

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "TSAT_ESM_Workflow_OnePage_2026-11-11.pptx")
p = T.new_pres()
s = T.blank(p)
T.head(s, "ESM — ระบบบริหารหน้างานโรงงาน (สรุปหน้าเดียว)", "บันทึกครั้งเดียวที่หน้างาน → เห็นผลระหว่างกะ → ใช้ต่อได้ทั้งโรงงาน")

# ── แถว 1: workflow 4 กลุ่ม ──
groups = [
    ("หน้างานทุกกะ", [("เช็คชื่อ + PPE", "รู้คนขาดก่อนเดินเครื่อง"),
                      ("เปิดกะ + สแกนใบงาน", "ยอดผลิต/ของเสียสด · งานคู่ผูกเอง"),
                      ("ตรวจ AM ต้นกะ", "ตรวจเฉพาะเครื่องที่เดินจริง"),
                      ("แจ้งซ่อม MO", "ตามได้ทุกขั้นจนปิดงาน")]),
    ("คุณภาพ", [("ใบตรวจ QA + พิมพ์", "ตามแบบงาน · ลายเซ็นตามรหัสบัตร"),
                ("4M Change", "ขอ → หัวหน้า → QA · มีประวัติครบ")]),
    ("สโตร์ / วางแผน", [("บอร์ดคัมบัง", "แตก BOM จากแผน · เรียกของเข้าไลน์"),
                         ("วางแผนการผลิต", "ยอดลูกค้า vs กำลังผลิต → OT/กะดึก")]),
    ("ดูผล / บริหาร", [("ไทม์ไลน์ทุกไลน์", "ช้ากว่าแผนกี่นาที · ชี้ต้นเหตุ"),
                        ("OBEYA", "KPI รายเดือนตามเกณฑ์ของกลุ่ม")]),
]
x0, y0, cw, gap, ch = 0.45, 1.62, 3.0, 0.15, 2.72
for i, (title, items) in enumerate(groups):
    x = x0 + i * (cw + gap)
    T.rect(s, x, y0, cw, 0.42, fill=GREEN_D)
    T.text(s, x, y0, cw, 0.42, [[(title, {"sz": 15, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    T.rect(s, x, y0 + 0.42, cw, ch - 0.42, fill=GREEN_TINT if i % 2 else WHITE, line=BORDER)
    runs = []
    for h, d in items:
        runs.append([("● " + h, {"sz": 14, "b": True, "c": GREEN})])
        runs.append([("   " + d, {"sz": 12, "c": GREY})])
    T.text(s, x + 0.12, y0 + 0.52, cw - 0.2, ch - 0.6, runs, sa=3)

# ── แถว 2: ข้อมูลไหลต่อกัน ──
y1 = 4.5
T.text(s, 0.45, y1, 2.1, 0.55, [[("ข้อมูลไหลต่อกันเอง", {"sz": 13, "b": True, "c": ORANGE})]], anchor=MSO_ANCHOR.MIDDLE)
chain = ["สแกนใบงาน", "ยอดผลิต · OEE", "สต็อกในไลน์", "ตัดของตาม BOM", "KPI · OBEYA"]
cx, cwid = 2.55, 2.0
for i, t in enumerate(chain):
    sh = s.shapes.add_shape(MSO_SHAPE.CHEVRON if i else MSO_SHAPE.PENTAGON, Inches(cx + i * (cwid + 0.04)), Inches(y1), Inches(cwid + 0.2), Inches(0.55))
    sh.fill.solid(); sh.fill.fore_color.rgb = GREEN if i % 2 == 0 else GREEN_D; sh.line.fill.background()
    T.text(s, cx + i * (cwid + 0.04) + 0.22, y1, cwid - 0.2, 0.55, [[(t, {"sz": 12.5, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

# ── แถว 3: สิ่งที่ได้ + ก้าวต่อไป ──
y2, h2 = 5.25, 1.3
def panel(x, w, title, color, items):
    T.rect(s, x, y2, w, h2, fill=WHITE, line=color, lw=1.5, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    T.text(s, x + 0.15, y2 + 0.07, w - 0.3, 0.36, [[(title, {"sz": 15, "b": True, "c": color})]])
    half = (len(items) + 1) // 2
    for col in range(2):
        T.text(s, x + 0.15 + col * (w - 0.3) / 2, y2 + 0.45, (w - 0.3) / 2, h2 - 0.5,
               [[("✓  " + t, {"sz": 13.5, "c": GREEN})] for t in items[col * half:(col + 1) * half]], sa=4)
panel(0.45, 6.25, "สิ่งที่ได้", GREEN_D,
      ["ไร้กระดาษ — เอกสารหลักอยู่ระบบเดียว", "เห็นสด — ไม่ต้องรอสรุปท้ายกะ",
       "ข้อมูลเชื่อมกัน — ไม่กรอกซ้ำ", "ย้อนตรวจได้ — ชื่อ · เวลา · ลายเซ็น"])
panel(6.85, 6.05, "ก้าวต่อไป", ORANGE,
      ["ย้ายเข้าเซิร์ฟเวอร์บริษัท (กับไอที)", "ขยายไปโรงงานอื่นในกลุ่ม",
       "เชื่อมข้อมูลจากเครื่องจักร", "เซ็นด้วยบัตร · ใช้บนมือถือ"])

T.footer(s, 1)
s.notes_slide.notes_text_frame.text = (
    "สรุปหนึ่งหน้า: ESM คือระบบบริหารหน้างาน บันทึกครั้งเดียวที่หน้างานแล้วใช้ต่อได้ทั้งโรงงาน "
    "แถวบนคืองานหลักสิบงานในสี่กลุ่ม แถวกลางคือข้อมูลที่ไหลต่อกันเองตั้งแต่สแกนใบงานจนถึง KPI "
    "แถวล่างคือสิ่งที่ได้ และก้าวต่อไป")
p.save(OUT)
print("saved", OUT)
