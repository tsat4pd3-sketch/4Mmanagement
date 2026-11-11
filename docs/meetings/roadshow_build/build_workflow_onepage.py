# -*- coding: utf-8 -*-
"""สไลด์สรุปหน้าเดียว "ESM — Workflow หลัก" แบบเน้นภาพ (ธีม TSG R01 · 2026-11-11 · คำสั่ง user "เน้นรูปมากกว่าตัวหนังสือ")
Run:  python3 build_workflow_onepage.py  →  ../TSAT_ESM_Workflow_OnePage_2026-11-11.pptx
ภาพ = หน้าจอจริงพร้อมข้อมูลจำลอง (workflow_shots/ · ชุดเดียวกับเด็ค build_workflow_video.py)
"""
import os
from pptx.util import Inches
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
import tsg_theme as T
from tsg_theme import GREEN, GREEN_D, BORDER, ORANGE, GREY, WHITE

HERE = os.path.dirname(os.path.abspath(__file__))
SHOT = os.path.join(HERE, "workflow_shots")
OUT = os.path.join(HERE, "..", "TSAT_ESM_Workflow_OnePage_2026-11-11.pptx")
p = T.new_pres()
s = T.blank(p)
T.head(s, "ESM — บันทึกครั้งเดียวที่หน้างาน ใช้ได้ทั้งโรงงาน")

groups = [
    ("หน้างานทุกกะ", [("daily.jpg", "เปิดกะ + สแกนใบงาน"), ("mo.jpg", "แจ้งซ่อม MO")]),
    ("คุณภาพ", [("qa.jpg", "ใบตรวจ QA"), ("qa_print.jpg", "ใบพิมพ์ + ลายเซ็นผู้ตรวจ")]),
    ("สโตร์ / วางแผน", [("heij.jpg", "บอร์ดคัมบัง"), ("plan.jpg", "วางแผนการผลิต")]),
    ("ดูผล / บริหาร", [("dash.jpg", "ไทม์ไลน์ทุกไลน์"), ("obeya.jpg", "OBEYA · KPI")]),
]
x0, y0, cw, gap = 0.42, 1.12, 3.03, 0.1
ih = cw * 9 / 16          # ภาพ 16:9
cap = 0.34
for i, (title, shots) in enumerate(groups):
    x = x0 + i * (cw + gap)
    T.rect(s, x, y0, cw, 0.42, fill=GREEN_D)
    T.text(s, x, y0, cw, 0.42, [[(title, {"sz": 16, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    y = y0 + 0.5
    for f, label in shots:
        T.rect(s, x - 0.02, y - 0.02, cw + 0.04, ih + cap + 0.04, fill=WHITE, line=BORDER, lw=1)
        T._cover_pic(s, os.path.join(SHOT, f), x, y, cw, ih)
        T.rect(s, x, y + ih, cw, cap, fill=GREEN)
        T.text(s, x, y + ih, cw, cap, [[(label, {"sz": 13, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        y += ih + cap + 0.14

# ── ข้อมูลไหลต่อกันเอง (แถบเดียว) ──
y1 = 6.08
T.text(s, 0.42, y1, 1.9, 0.55, [[("ข้อมูลไหลต่อกันเอง", {"sz": 13, "b": True, "c": ORANGE})]], anchor=MSO_ANCHOR.MIDDLE)
chain = ["สแกนใบงาน", "ยอดผลิต · OEE", "สต็อกในไลน์", "ตัดของตาม BOM", "KPI · OBEYA"]
cx, cwid = 2.35, 2.05
for i, t in enumerate(chain):
    sh = s.shapes.add_shape(MSO_SHAPE.CHEVRON if i else MSO_SHAPE.PENTAGON, Inches(cx + i * (cwid + 0.04)), Inches(y1), Inches(cwid + 0.2), Inches(0.55))
    sh.fill.solid(); sh.fill.fore_color.rgb = GREEN if i % 2 == 0 else GREEN_D; sh.line.fill.background()
    T.text(s, cx + i * (cwid + 0.04) + 0.22, y1, cwid - 0.2, 0.55, [[(t, {"sz": 13, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

T.text(s, 9.3, 6.95, 3.6, 0.3, [[("ภาพจำลองหน้าจอ · ข้อมูลตัวอย่าง", {"sz": 10, "i": True, "c": GREY})]], align=PP_ALIGN.RIGHT)
T.footer(s, 1)
s.notes_slide.notes_text_frame.text = (
    "สรุปหนึ่งหน้า: ESM บันทึกครั้งเดียวที่หน้างานแล้วใช้ต่อได้ทั้งโรงงาน "
    "ภาพบนคือหน้าจอจริงของงานหลักในสี่กลุ่ม — หน้างานทุกกะ คุณภาพ สโตร์และวางแผน และดูผลบริหาร "
    "แถบล่างคือข้อมูลที่ไหลต่อกันเอง ตั้งแต่สแกนใบงานจนถึง KPI ในห้อง OBEYA")
p.save(OUT)
print("saved", OUT)
