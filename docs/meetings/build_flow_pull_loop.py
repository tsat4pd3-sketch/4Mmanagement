# -*- coding: utf-8 -*-
"""โฟลว์การเรียกงาน ผลิต → สโตร์ (Production Pull Loop) — ประชุม 25/09/2026
ตัวเลขทุกตัวมาจากคิวรีจริง 25/09/2026 (Main ewhdfqwfwofivojtsizn · DR eyhclzkifitbhbljgoav)"""
import tsg_theme as T
from tsg_theme import (PRES_GREEN, rect, text, head, footer, blank, new_pres, title_slide,
                       GREEN_D, GREEN_M, GREEN_TINT, ORANGE, ORANGE_LT, GREY, AMBER, WHITE, GOLD)
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn

BLUE = RGBColor(0x1F,0x4E,0x79)      # สีที่ 3 ("Other") — เลนระบบ
PALE = RGBColor(0xF4,0xF7,0xF2)
p = new_pres()
PAGE = [0]
def pg(s):
    PAGE[0] += 1; footer(s, PAGE[0])

# ── S1 Title ───────────────────────────────────────────────────────────────
title_slide(p,
    "โฟลว์การเรียกงาน  ผลิต ➜ สโตร์",
    "Production Pull Loop — ใครกดอะไร ที่หน้าจอไหน",
    "ประชุมมอบหมายงาน · 25 กันยายน 2569",
    "Thai Summit Autoparts Industry — PD3 / Store / Planning",
    "ข้อมูลทุกตัวเลขในเอกสารนี้วัดจากฐานข้อมูลจริง ณ 25/09/2569")

# ── S2 โฟลว์ 8 ขั้น swimlane ───────────────────────────────────────────────
s = blank(p)
head(s, "โฟลว์การเรียกงาน — 7 ขั้นที่ทำได้วันนี้", "ลูปเริ่มที่ไลน์ผลิต ไม่ใช่ที่สโตร์ · จบเมื่อผลิตกดยืนยันรับของ")

LANES = [("ฝ่ายผลิต", GREEN_D, 1.72), ("ระบบ ESM", BLUE, 3.28), ("สโตร์", ORANGE, 4.84)]
for name, col, y in LANES:
    rect(s, 0.5, y, 1.35, 1.32, fill=col)
    text(s, 0.5, y, 1.35, 1.32, [[(name, {"sz": 12.5, "b": True, "c": WHITE})]],
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    rect(s, 1.85, y, 10.98, 1.32, fill=PALE, line=RGBColor(0xD8,0xE4,0xD0))

# (ขั้น, เลน 0-2, ข้อความ, x, w)
STEPS = [
    (1, 0, "ปิดใบผลิต\nสแกนยืนยันยอด", 2.02, 1.55),
    (2, 1, "หักยอด WIP\nในไลน์อัตโนมัติ", 3.72, 1.55),
    (3, 1, "ถึง min ➜ ขึ้น\nรายการเสนอให้เบิก", 5.42, 1.72),
    (4, 0, "หัวหน้ากลุ่มกด\n“ยืนยันเบิก”", 7.29, 1.62),
    (5, 2, "สแกน MAT + จำนวน\n(ตัดสต็อกสโตร์)", 9.06, 1.82),
    (6, 2, "นำของไปส่ง\nสแกน QR จุดส่ง", 11.03, 1.80),
    (7, 0, "ผลิตกดยืนยันรับ\nครบ / ไม่ครบ", 11.03, 1.80),
]
LY = {0: 1.72, 1: 3.28, 2: 4.84}
for no, lane, label, x, w in STEPS:
    y = LY[lane]
    col = LANES[lane][1]
    rect(s, x, y + 0.17, w, 0.98, fill=WHITE, line=col, lw=1.5, shadow=True)
    rect(s, x + 0.07, y + 0.24, 0.30, 0.30, fill=ORANGE, shape=MSO_SHAPE.OVAL)
    text(s, x + 0.07, y + 0.23, 0.30, 0.30, [[(str(no), {"sz": 10.5, "b": True, "c": WHITE})]],
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    text(s, x + 0.40, y + 0.20, w - 0.47, 0.92,
         [[(ln, {"sz": 10.5, "b": True, "c": GREEN_D})] for ln in label.split("\n")],
         anchor=MSO_ANCHOR.MIDDLE, sa=1)

# ลูกศรเชื่อมขั้น
ARROWS = [(3.57, 2.21, 3.72, 3.77), (5.27, 3.77, 5.42, 3.77), (7.14, 3.77, 7.29, 2.21),
          (8.91, 2.21, 9.06, 5.33), (10.88, 5.33, 11.03, 5.33), (11.93, 5.01, 11.93, 2.87)]
for x1, y1, x2, y2 in ARROWS:
    cx = s.shapes.add_connector(2, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    cx.line.color.rgb = ORANGE; cx.line.width = Pt(1.75)
    # หัวลูกศร — ไม่มีหัว = ดูเป็นเส้นขีด ไม่ใช่โฟลว์
    ln = cx.line._get_or_add_ln()
    he = ln.makeelement(qn('a:headEnd'), {'type': 'none'}); ln.append(he)
    te = ln.makeelement(qn('a:tailEnd'), {'type': 'triangle', 'w': 'med', 'len': 'med'}); ln.append(te)

text(s, 0.5, 6.20, 12.4, 0.32,
     [[("ลูปปิดที่ขั้น 7 ➜ ใบนั้นหายจากคิวสโตร์เอง  ·  วัดเวลาได้ทุกใบ: ", {"sz": 12, "c": GREY}),
       ("ยืนยันเบิก ➜ ผลิตรับของ = lead time", {"sz": 12, "b": True, "c": ORANGE})]])
text(s, 0.5, 6.55, 12.4, 0.30,
     [[("* โฟลว์ที่ตกลงกันไว้ 27/08 มี 8 ขั้น — ขั้น “สแกน lot / id no. ของพาร์ท” ยังไม่มีในระบบ (ทั้งระบบยังไม่เก็บ lot no.) จึงยังไม่วาดไว้", {"sz": 10.5, "i": True, "c": GREY})]])
pg(s)

# ── S3 หน้าจอไหน กดปุ่มไหน ─────────────────────────────────────────────────
s = blank(p)
head(s, "ทำที่หน้าจอไหน กดปุ่มไหน", "ทุกขั้นอยู่ในหน้าที่คนนั้นเปิดอยู่แล้วทั้งกะ — ไม่มีหน้าจอใหม่ให้จำ")

COLS = [("ขั้น", 0.55), ("ใคร", 1.35), ("หน้าจอ", 3.05), ("กดอะไร", 4.30), ("ผลที่เกิด", 3.55)]
ROWS = [
    ("1", "ผลิต", "📋 Daily Report", "สแกนปิดใบผลิต", "ระบบระเบิด BOM หายอดพาร์ทที่ใช้ไป"),
    ("2", "ระบบ", "— อัตโนมัติ —", "ไม่ต้องกด", "หักยอด WIP ในไลน์ตามที่ผลิตไปแล้ว"),
    ("3", "ระบบ", "📋 Daily Report ➜ แผง\n📦 เรียกชิ้นส่วนจากสโตร์", "ไม่ต้องกด", "พาร์ทที่ต่ำกว่า min ขึ้นเป็นรายการ “เสนอให้เบิก”"),
    ("4", "หัวหน้ากลุ่ม", "📋 Daily Report ➜ แผงเดียวกัน", "✅ ยืนยันเบิก\n(หรือ ⏸ พักไว้ก่อน)", "ใบเข้าคิวสโตร์ทันที + แจ้งเตือนสโตร์"),
    ("5", "สโตร์", "🎴 Heijunka ➜ 🔄 คิวเติม WIP", "🔍 เริ่มเตรียม · สแกนพาร์ท", "ตัดสต็อกสโตร์ ➜ โอนเข้าไลน์ (ledger)"),
    ("6", "สโตร์", "🎴 Heijunka ➜ 🔄 คิวเติม WIP", "📍 ถึงไลน์แล้ว · สแกนจุดส่ง", "บันทึกว่าของถึงจุดใช้งานจริง"),
    ("7", "ผลิต", "📋 Daily Report ➜ แผงเดียวกัน", "✔ รับครบ / ⚠ รับไม่ครบ", "ปิดลูป · ใบหายจากคิวสโตร์"),
]
y = 1.78; hh = 0.34
x = 0.5
for (t, w) in COLS:
    rect(s, x, y, w, hh, fill=GREEN_D)
    text(s, x, y, w, hh, [[(t, {"sz": 11.5, "b": True, "c": WHITE})]],
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    x += w
y += hh
for i, r in enumerate(ROWS):
    rh = 0.58 if "\n" in "".join(r) else 0.42
    x = 0.5
    bg = GREEN_TINT if i % 2 == 0 else WHITE
    for j, (t, w) in enumerate(COLS):
        rect(s, x, y, w, rh, fill=bg, line=RGBColor(0xD8,0xE4,0xD0), lw=0.5)
        val = r[j]
        cc = ORANGE if j == 0 else (GREEN_D if j in (1, 3) else GREEN_M)
        text(s, x + 0.04, y, w - 0.08, rh,
             [[(ln, {"sz": 10.5, "b": j in (0, 1, 3), "c": cc})] for ln in val.split("\n")],
             align=PP_ALIGN.CENTER if j == 0 else PP_ALIGN.LEFT, anchor=MSO_ANCHOR.MIDDLE, sa=0)
        x += w
    y += rh
text(s, 0.5, y + 0.12, 12.4, 0.4,
     [[("ขั้น 3 ไม่ขึ้นรายการอะไรเลย = ยังไม่ได้ตั้ง min/max ของไลน์นั้น (ดูสไลด์ถัดไป)", {"sz": 12, "b": True, "c": ORANGE})]])
pg(s)


# ── S4 สถานะวันนี้ ─────────────────────────────────────────────────────────
s = blank(p)
head(s, "วันนี้ลูปนี้เดินถึงไหนแล้ว", "วัดจากฐานข้อมูลจริง 25/09/2569 — โฟลว์ใช้งานได้จริงแล้ว แต่ยังไม่มีใครเริ่มที่ขั้น 4")

STATS = [("19", "ใบขอเติมทั้งหมดในระบบ", GREEN_M),
         ("1", "ใบเดียว ที่ไลน์กดเบิกเอง", ORANGE),
         ("18", "ใบ สโตร์ทำเองจาก forecast", AMBER),
         ("4", "ใบที่เดินครบลูปถึงขั้น 7", GREEN_M)]
x = 0.55
for v, lab, c in STATS:
    rect(s, x, 1.80, 3.02, 1.12, fill=WHITE, line=RGBColor(0xD8,0xE4,0xD0), lw=1, shadow=True)
    text(s, x, 1.86, 3.02, 0.62, [[(v, {"sz": 30, "b": True, "c": c})]], align=PP_ALIGN.CENTER)
    text(s, x + 0.08, 2.46, 2.86, 0.40, [[(lab, {"sz": 11, "c": GREY})]], align=PP_ALIGN.CENTER)
    x += 3.16

def bullet(y, head_t, body, tone=GREEN_D):
    rect(s, 0.55, y, 0.055, 0.60, fill=tone)
    text(s, 0.78, y - 0.03, 12.0, 0.34, [[(head_t, {"sz": 14.5, "b": True, "c": tone})]])
    text(s, 0.78, y + 0.27, 12.0, 0.36, [[(body, {"sz": 12, "c": GREY})]])

bullet(3.22, "✅ โฟลว์ไม่ได้พัง — พิสูจน์แล้วว่าใช้ได้",
       "4 ใบเดินครบ หยิบ ➜ สแกนจุดส่ง ➜ ผลิตกดรับ เมื่อ 07/09 · ระบบบันทึกเวลาทุกหมุดให้ครบ", GREEN_M)
bullet(4.02, "🔴 แต่คนเริ่มลูปผิดฝั่ง — สโตร์เดาความต้องการแทนไลน์",
       "18 จาก 19 ใบ สโตร์สร้างเองจาก forecast · ไลน์กดเบิกเองแค่ 1 ใบเดียวตั้งแต่เปิดใช้", ORANGE)
bullet(4.82, "🟠 14 ใบค้างในคิวสโตร์ · ใบเก่าสุดรอมา 17 วัน (ตั้งแต่ 08/09)",
       "ใบที่ไม่มีคนหยิบต่อ = ไลน์ไม่ได้ของ แล้วก็กลับไปโทร/ไลน์แชทเหมือนเดิม", AMBER)
bullet(5.62, "🔔 ขณะนี้มี 14 พาร์ทต่ำกว่า min อยู่ที่ 4 ไลน์ — ระบบเสนอให้เบิกแล้ว",
       "LINE D 7 พาร์ท · LINE B 4 · LINE A 2 · LASER E50 1 — รอหัวหน้ากลุ่มกด ยืนยันเบิก เท่านั้น", ORANGE)
pg(s)

# ── S5 ตัวขวาง min/max ─────────────────────────────────────────────────────
s = blank(p)
head(s, "ตัวขวางเดียวที่เหลือ — min / max ของไลน์", "กฎของระบบ: ไม่ตั้ง min = ไม่เสนอ = แผงเรียกของว่างเปล่า = กลับไปใช้ไลน์แชท")

rect(s, 0.55, 1.78, 6.05, 0.40, fill=GREEN_D)
text(s, 0.55, 1.78, 6.05, 0.40, [[("✅ ตั้งแล้ว (23/09) — ไลน์ปั๊ม", {"sz": 13, "b": True, "c": WHITE})]],
     align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
rect(s, 6.78, 1.78, 6.05, 0.40, fill=ORANGE)
text(s, 6.78, 1.78, 6.05, 0.40, [[("🔴 ยังไม่ตั้งเลย — ไลน์ประกอบ", {"sz": 13, "b": True, "c": WHITE})]],
     align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

DONE = [("LINE B ( 600 Ton )", "22 พาร์ท"), ("LINE D ( 110&300 Ton )", "18 พาร์ท"),
        ("LINE A ( 800 Ton )", "10 พาร์ท"), ("LINE C ( 200&250 Ton )", "8 พาร์ท"),
        ("LASER E50", "1 พาร์ท"), ("LINE MAIN TSRA-2", "1 พาร์ท")]
TODO = [("LINE ASSY TSRA", "ใช้ 21 พาร์ท"), ("Line 61", "ใช้ 21 พาร์ท"), ("Assy GOR", "ใช้ 19 พาร์ท"),
        ("SUB APRON", "ใช้ 15 พาร์ท"), ("Line 60", "ใช้ 15 พาร์ท"), ("Assy LWR", "ใช้ 14 พาร์ท")]
for items, xx, tone in [(DONE, 0.55, GREEN_M), (TODO, 6.78, ORANGE)]:
    y = 2.24
    for i, (ln, q) in enumerate(items):
        rect(s, xx, y, 6.05, 0.355, fill=GREEN_TINT if i % 2 == 0 else WHITE,
             line=RGBColor(0xD8,0xE4,0xD0), lw=0.5)
        text(s, xx + 0.12, y, 4.2, 0.355, [[(ln, {"sz": 11.5, "b": True, "c": GREEN_D})]], anchor=MSO_ANCHOR.MIDDLE)
        text(s, xx + 4.3, y, 1.6, 0.355, [[(q, {"sz": 11.5, "b": True, "c": tone})]],
             align=PP_ALIGN.RIGHT, anchor=MSO_ANCHOR.MIDDLE)
        y += 0.355

rect(s, 0.55, 4.62, 12.28, 1.05, fill=WHITE, line=ORANGE, lw=1.5)
text(s, 0.78, 4.70, 11.9, 0.36, [[("ตั้งที่ไหน · ใครตั้ง", {"sz": 14, "b": True, "c": ORANGE})]])
text(s, 0.78, 5.04, 11.9, 0.58,
     [[("📋 Daily Report ➜ แผง 📦 เรียกชิ้นส่วนจากสโตร์ ➜ ปุ่ม ", {"sz": 12, "c": GREY}),
       ("⚙️ ตั้งระดับ min/max", {"sz": 12, "b": True, "c": GREEN_D}),
       ("   (ต้องเปิดกะของไลน์นั้นอยู่)", {"sz": 12, "c": GREY})],
      [("ผู้ตั้ง = ", {"sz": 12, "c": GREY}),
       ("หัวหน้ากลุ่ม + หัวหน้าแผนกฝ่ายผลิต", {"sz": 12, "b": True, "c": GREEN_D}),
       ("  — คนที่ยืนหน้าไลน์รู้ว่าพื้นที่วางได้กี่กล่องและกินเร็วแค่ไหน ไม่ใช่ Planning", {"sz": 12, "c": GREY})]])

text(s, 0.55, 5.86, 12.28, 0.5,
     [[("💡 ตั้งแค่พาร์ทที่กินบ่อย 5-10 ตัวแรกของไลน์ก็เริ่มได้ ", {"sz": 12.5, "b": True, "c": GREEN_D}),
       ("— ไม่ต้องรอครบทุกพาร์ท ที่ไม่ตั้งยังเบิกมือได้เหมือนเดิม", {"sz": 12.5, "c": GREY})]])
pg(s)

# ── S6 มอบหมายงาน ──────────────────────────────────────────────────────────
s = blank(p)
head(s, "มอบหมายงาน — เพื่อให้ลูปเดินเองได้", "เรียงตามลำดับที่ต้องทำ · ข้อ 1 ไม่เสร็จ ข้ออื่นไม่มีผล")

AC = [("1", ["หัวหน้ากลุ่มไลน์ประกอบ", "(GOR · LWR · SUB APRON · TSRA · 60/61)"],
       "ตั้ง min/max พาร์ทที่กินบ่อย 5-10 ตัว/ไลน์ — ปลดล็อกขั้น 3 ของโฟลว์", "ภายใน 30/09", ORANGE),
      ("2", ["หัวหน้ากลุ่มทุกไลน์"],
       "เคลียร์ 14 พาร์ทที่ต่ำกว่า min วันนี้ — กด ยืนยันเบิก หรือ พักไว้ก่อน พร้อมเหตุผล", "วันนี้", ORANGE),
      ("3", ["สโตร์"],
       "เคลียร์ใบค้าง 14 ใบในคิวเติม WIP · ใบไหนไม่ต้องส่งแล้วให้ระบุเหตุผล ห้ามปล่อยค้าง", "ภายใน 26/09", AMBER),
      ("4", ["สโตร์ + หัวหน้าไลน์"],
       "หยุดเบิกผ่านไลน์แชท — ของที่เบิกต้องมีใบในระบบทุกครั้ง (ไม่มีใบ = ไม่ส่ง)", "เริ่ม 26/09", GREEN_M),
      ("5", ["ฝ่ายผลิต"],
       "ทุกครั้งที่รับของ กด ✔ รับครบ / ⚠ รับไม่ครบ — ไม่กด = วัด lead time ไม่ได้", "เริ่มทันที", GREEN_M),
      ("6", ["ทีมระบบ"],
       "ติดตั้ง QR จุดส่งงานให้ไลน์ที่ยังไม่มี (ไม่มีจุด = สโตร์ส่งได้แต่ตรวจไม่ได้)", "ภายใน 03/10", BLUE)]
y = 1.80
for no, who, what, when, tone in AC:
    h = 0.72
    rect(s, 0.55, y, 12.28, h, fill=WHITE, line=RGBColor(0xD8,0xE4,0xD0), lw=0.75)
    rect(s, 0.55, y, 0.07, h, fill=tone)
    rect(s, 0.78, y + 0.20, 0.33, 0.33, fill=tone, shape=MSO_SHAPE.OVAL)
    text(s, 0.78, y + 0.19, 0.33, 0.33, [[(no, {"sz": 11.5, "b": True, "c": WHITE})]],
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 1.22, y + 0.02, 3.55, h - 0.04,
         [[(ln, {"sz": 10.5, "b": True, "c": GREEN_D})] for ln in who],
         anchor=MSO_ANCHOR.MIDDLE, sa=0)
    text(s, 4.90, y + 0.02, 6.35, h - 0.04, [[(what, {"sz": 11, "c": GREY})]], anchor=MSO_ANCHOR.MIDDLE)
    rect(s, 11.38, y + 0.19, 1.30, 0.34, fill=tone)
    text(s, 11.38, y + 0.18, 1.30, 0.34, [[(when, {"sz": 10.5, "b": True, "c": WHITE})]],
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    y += h + 0.09
pg(s)

# ── S7 Closing ─────────────────────────────────────────────────────────────
s = blank(p)
rect(s, 0, 0, T.SW, T.SH, fill=GREEN_D)
text(s, 1.0, 2.55, 11.3, 0.9,
     [[("ของทุกชิ้นที่เข้าไลน์ ต้องมีใบในระบบ", {"sz": 34, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER)
text(s, 1.0, 3.55, 11.3, 0.6,
     [[("ไม่มีใบ = วัดไม่ได้ว่าช้าตรงไหน = แก้ไม่ได้", {"sz": 20, "b": True, "c": GOLD})]], align=PP_ALIGN.CENTER)
text(s, 1.0, 4.65, 11.3, 0.5,
     [[("Before We Build Parts, We Build People", {"sz": 16, "b": True, "i": True, "c": PRES_GREEN})]], align=PP_ALIGN.CENTER)

p.save("flow_pull_loop.pptx")
print("saved", PAGE[0] + 1, "slides")
