# -*- coding: utf-8 -*-
"""ผังทีมงานโครงการ ECM (ร่าง) — PMO + ทีม IT · ทีม OT · ตัวแทนหน่วยงาน (ธีม TSG R01 · 2026-11-12)
Run:  python3 build_ecm_team.py  →  ../TSAT_ECM_Project_Team_2026-11-12.pptx (1 หน้า)
ใช้ร่วม: build_ecm_evp.py เรียก draw_team() วาดหน้าเดียวกันในเด็ค EVP (ผังมีที่เดียว แก้ที่นี่ที่เดียว)
หลัก: ชื่อคน/สมาชิกที่ยังไม่รู้ = [รอระบุ] · หน้าที่ IT + ตัวแทนหน่วยงาน ยกจากบันทึกเชิญประชุม
"""
import os
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
import tsg_theme as T
from tsg_theme import GREEN, GREEN_D, GREEN_TINT, BORDER, ORANGE, GREY, WHITE

C, MID = PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE
TITLE = "ทีมงานโครงการ ECM (ร่าง)"
SUB = "PMO กำกับ 3 ทีม · ชื่อคนที่ยังไม่ได้ตกลง = [รอระบุ]"
TBD = "[รอระบุ]"

TEAMS = [
    ("ทีม IT", ["หัวหน้าทีม: " + TBD, "สมาชิก: " + TBD],
     ["Infrastructure · Security", "Integration · Technical Architecture", "SSO / บัญชีผู้ใช้ · backup · DR"]),
    ("ทีม OT · Operation Technology", ["หัวหน้าทีม: " + TBD, "สมาชิก: " + TBD],
     ["ข้อมูลเครื่องจักร (PLC · SCADA · เซ็นเซอร์)", "ส่ง raw data เข้าระบบอัตโนมัติ", "เชื่อมต่อ OT ↔ ระบบงาน"]),
]
DEPTS = ["การตลาด (Qnex)", "IEC", "Maintenance", "HR", "Finance & Accounting", "QSM", "ฝ่ายผลิต", "อื่นๆ " + TBD]
NOTE = "ตัวแทนหน่วยงาน: ร่วมกำหนด Business Requirements + ร่วมทดสอบ UAT (ตามบันทึกเชิญ)"


def vline(s, x, y1, y2):
    T.rect(s, x - 0.015, y1, 0.03, y2 - y1, fill=GREEN)


def hline(s, x1, x2, y):
    T.rect(s, x1, y - 0.015, x2 - x1, 0.03, fill=GREEN)


def draw_team(s):
    # รายงานต่อ
    T.text(s, 4.65, 1.5, 4.0, 0.3, [[("รายงานต่อ Steering Committee → EVP", {"sz": 11, "c": GREY})]], align=C)
    # PMO
    T.rect(s, 4.9, 1.82, 3.5, 0.85, fill=WHITE, line=ORANGE, lw=2, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    T.text(s, 4.9, 1.82, 3.5, 0.85, [[("PM / PMO", {"sz": 16, "b": True, "c": ORANGE})],
                                    [("คุณ Dulyatrust", {"sz": 12, "c": GREEN_D})]], align=C, anchor=MID, sa=0)
    # เส้นเชื่อม
    xs = [0.5 + 2.0, 4.7 + 2.0, 8.9 + 2.0]
    vline(s, 6.65, 2.67, 2.95); hline(s, xs[0], xs[2], 2.95)
    for x in xs:
        vline(s, x, 2.95, 3.15)
    # ทีม IT / OT
    for i, (h, who, duty) in enumerate(TEAMS):
        x = 0.5 + i * 4.2
        T.rect(s, x, 3.15, 4.0, 3.05, fill=WHITE, line=BORDER, shape=MSO_SHAPE.ROUNDED_RECTANGLE, shadow=True)
        T.rect(s, x, 3.15, 4.0, 0.5, fill=GREEN_D)
        T.text(s, x, 3.15, 4.0, 0.5, [[(h, {"sz": 14, "b": True, "c": WHITE})]], align=C, anchor=MID)
        T.text(s, x + 0.2, 3.72, 3.6, 0.7, [[(w, {"sz": 12, "b": True, "c": ORANGE})] for w in who], sa=2)
        T.text(s, x + 0.2, 4.45, 3.6, 0.35, [[("หน้าที่", {"sz": 12, "b": True, "c": GREEN_D})]])
        T.text(s, x + 0.2, 4.8, 3.6, 1.35, [[("•  " + d, {"sz": 12, "c": GREY})] for d in duty], sa=4)
    # ตัวแทนหน่วยงาน
    x = 8.9
    T.rect(s, x, 3.15, 3.95, 3.05, fill=WHITE, line=BORDER, shape=MSO_SHAPE.ROUNDED_RECTANGLE, shadow=True)
    T.rect(s, x, 3.15, 3.95, 0.5, fill=GREEN_D)
    T.text(s, x, 3.15, 3.95, 0.5, [[("ตัวแทนหน่วยงาน (Business Users)", {"sz": 13, "b": True, "c": WHITE})]], align=C, anchor=MID)
    for k, d in enumerate(DEPTS):
        cx = x + 0.15 + (k % 2) * 1.85
        cy = 3.75 + (k // 2) * 0.6
        T.rect(s, cx, cy, 1.78, 0.52, fill=GREEN_TINT, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        T.text(s, cx, cy, 1.78, 0.52, [[(d, {"sz": 11, "b": True, "c": GREEN_D})],
                                       [("ตัวแทน: " + TBD, {"sz": 11, "c": ORANGE})]], align=C, anchor=MID, sa=0)
    T.text(s, 0.5, 6.3, 12.35, 0.45, [[(NOTE, {"sz": 13, "b": True, "c": GREEN_D})]], anchor=MID)


NOTES = ("ร่างทีมงานโครงการ PMO อยู่บนสุด ใต้ลงมา 3 ทีม ทีม IT ดูแล Infrastructure ความปลอดภัย การเชื่อมต่อระบบ "
         "และสถาปัตยกรรม ทีม OT ดูแลข้อมูลจากเครื่องจักรให้ไหลเข้าระบบเป็น raw data อัตโนมัติ "
         "ตัวแทนหน่วยงาน 7 หน่วยร่วมกำหนดความต้องการและทดสอบระบบ ชื่อคนทุกช่องยังรอแต่ละหน่วยงานส่งชื่อ")


if __name__ == "__main__":
    HERE = os.path.dirname(os.path.abspath(__file__))
    OUT = os.path.join(HERE, "..", "TSAT_ECM_Project_Team_2026-11-12.pptx")
    p = T.new_pres()
    s = T.blank(p)
    T.head(s, TITLE, SUB)
    T.footer(s, 1)
    draw_team(s)
    s.notes_slide.notes_text_frame.text = NOTES
    p.save(OUT)
    print("saved", OUT)
