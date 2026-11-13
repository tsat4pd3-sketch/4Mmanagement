# -*- coding: utf-8 -*-
"""ตัวสร้างคู่มือ WI ธีม TSG R01 — ใช้ร่วมทุกส่วนงาน
ใช้: python3 wi_build.py <content.py> <โฟลเดอร์ภาพ (มี boxes.json)> <out.pptx>
content.py ต้องมี: TITLE, SUBTITLE, MENU_LINE, HOWTO_MENU, PARTS, SLIDES, FLOW, FLOW_TITLE, FLOW_NOTE,
                   MATRIX_COLS, MATRIX, ROUTINE, FAQ   (ดู README.md)"""
import sys, json, os, math, importlib.util
sys.path.insert(0, "/home/user/4Mmanagement/docs/meetings/roadshow_build")
from tsg_theme import *
from pptx.util import Inches, Pt
from pptx.oxml.ns import qn

spec = importlib.util.spec_from_file_location("content", sys.argv[1]); C = importlib.util.module_from_spec(spec); spec.loader.exec_module(C)
SHOT = sys.argv[2]; OUT = sys.argv[3]
BOX = json.load(open(os.path.join(SHOT, "boxes.json")))
LIGHT = RGBColor(0xF7, 0xF9, 0xF7)
PALETTE = [RGBColor(0x1F, 0x6F, 0xB2), GREEN, AMBER, ORANGE, RGBColor(0x6B, 0x4C, 0x9A), RGBColor(0x00, 0x7C, 0x89)]
PART_COLOR = {k: PALETTE[i % len(PALETTE)] for i, (k, _, _) in enumerate(C.PARTS)}
PHOTOS = ["photo_robots.png", "photo_press2500t.png", "photo_solar.png", "photo_hotpress.png"]
DARK = RGBColor(0x22, 0x22, 0x22)
p = new_pres(); page = [0]
def nextpage(): page[0] += 1; return page[0]
WARN = []

def conn(s, x1, y1, x2, y2, color, w=1.5, arrow=False):
    c = s.shapes.add_connector(1, Inches(x1), Inches(y1), Inches(x2), Inches(y2)); c.line.color.rgb = color; c.line.width = Pt(w)
    if arrow:
        ln = c.line._get_or_add_ln(); ln.append(ln.makeelement(qn('a:tailEnd'), {'type': 'triangle', 'w': 'med', 'len': 'med'}))
def badge(s, x, y, n, d=0.30, fill=ORANGE):
    rect(s, x, y, d, d, fill=fill, line=WHITE, lw=1.25, shape=MSO_SHAPE.OVAL)
    text(s, x, y, d, d, [[(str(n), {"sz": 11, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
def chip(s, x, y, w, h, label, fill, sz=11):
    rect(s, x, y, w, h, fill=fill, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    text(s, x, y, w, h, [[(label, {"sz": sz, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

IX, IY, IW = 0.30, 1.55, 7.75
IH = IW * 1000 / 1600
def page_slide(d):
    s = blank(p); head(s, d["title"])
    r = "📍 " + d["route"]
    text(s, 0.42, 1.0, 11.0, 0.4, [[(r, {"sz": fit_one_line(r, 11.0, 13, 10), "b": True, "c": GREY})]])
    chip(s, 11.55, 0.34, 1.5, 0.36, f"บท {d['part']}", PART_COLOR[d["part"]], sz=12)
    img = os.path.join(SHOT, d["id"] + ".png")
    rect(s, IX - 0.03, IY - 0.03, IW + 0.06, IH + 0.06, fill=BORDER)
    s.shapes.add_picture(img, Inches(IX), Inches(IY), Inches(IW), Inches(IH))
    text(s, IX, IY + IH + 0.04, IW, 0.25, [[("ภาพจากโหมดทดสอบ — ตัวเลข/ชื่อพาร์ทเป็นข้อมูลตัวอย่าง", {"sz": 9, "i": True, "c": GREY})]])
    info = BOX.get(d["id"], {}); boxes = info.get("boxes", [])
    if info.get("crash"): WARN.append(f"CRASH in shot {d['id']}")
    sx, sy = IW / 1600, IH / 1000
    def ok(k): return k < len(boxes) and not boxes[k].get("miss")
    for n, (mi, _) in enumerate(d["steps"], 1):
        for k in ([] if mi is None else (mi if isinstance(mi, list) else [mi])):
            if not ok(k): continue
            b = boxes[k]; bx, by, bw, bh = IX + b["x"] * sx, IY + b["y"] * sy, b["width"] * sx, b["height"] * sy
            rect(s, bx - 0.03, by - 0.03, bw + 0.06, bh + 0.06, line=ORANGE, lw=2.25, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
            badge(s, max(IX, bx - 0.20), max(IY, by - 0.20), n, d=0.28)
    RX, RW = 8.30, 4.78
    rect(s, RX, 1.55, RW, 1.02, fill=LIGHT, line=BORDER)
    text(s, RX + 0.1, 1.60, RW - 0.2, 0.95, [
        [("👤 ใครใช้: ", {"sz": 11, "b": True, "c": GREEN_D}), (d["who"], {"sz": 11, "c": GREY})],
        [("🎯 เพื่อ: ", {"sz": 11, "b": True, "c": GREEN_D}), (d["why"], {"sz": 11, "c": GREY})]], sa=3)
    headline_box(s, RX, 2.67, RW, "ขั้นตอน (เลขตรงกับวงกลมบนภาพ)", h=0.36)
    TW = RW - 0.45; AV = 5.14 - 3.08
    def heights(sz): return [max(1, math.ceil(width_in(t, sz) * 1.08 / TW)) * sz * 1.32 / 72 + 0.08 for _, t in d["steps"]]
    for sz in (12, 11.5, 11, 10.5, 10, 9.5):
        hs = heights(sz)
        if sum(hs) <= AV: break
    if sum(hs) > AV: WARN.append(f"OVERFLOW steps {d['id']} {sum(hs):.2f}/{AV}")
    gap = min(0.12, max(0, (AV - sum(hs)) / len(hs))); y = 3.08
    for n, ((mi, t), h) in enumerate(zip(d["steps"], hs), 1):
        ks = [] if mi is None else (mi if isinstance(mi, list) else [mi])
        badge(s, RX + 0.02, y + 0.01, n, d=0.26, fill=ORANGE if any(ok(k) for k in ks) else GREY)
        text(s, RX + 0.36, y, TW + 0.05, h, [[(t, {"sz": sz, "c": DARK})]]); y += h + gap
    for t, lim in ((d["next"], 0.74), (d.get("warn") or "", 0.76)):
        if t and width_in(t, 11) / (RW - 0.3) * 11 * 1.3 / 72 > lim + 0.05: WARN.append(f"LONG box text {d['id']}: {t[:30]}")
    rect(s, RX, 5.20, RW, 0.78, fill=RGBColor(0xE8, 0xF5, 0xEC), line=GREEN, lw=1)
    text(s, RX + 0.08, 5.22, RW - 0.16, 0.74, [[("➡ ไปต่อ: ", {"sz": 11, "b": True, "c": GREEN}), (d["next"], {"sz": 11, "c": GREEN_D})]], anchor=MSO_ANCHOR.MIDDLE)
    if d.get("warn"):
        rect(s, RX, 6.04, RW, 0.80, fill=RGBColor(0xFD, 0xEF, 0xE9), line=ORANGE, lw=1)
        text(s, RX + 0.08, 6.06, RW - 0.16, 0.76, [[("⚠ ระวัง: ", {"sz": 10.5, "b": True, "c": ORANGE}), (d["warn"], {"sz": 10.5, "c": RGBColor(0x6B, 0x2A, 0x12)})]], anchor=MSO_ANCHOR.MIDDLE)
    footer(s, nextpage())

# ---------------- build ----------------
title_slide(p, C.TITLE, C.SUBTITLE, C.MENU_LINE, "อ้างอิงโปรแกรม ณ " + getattr(C, "AS_OF", "03/11/2026")); nextpage()
# สารบัญ — วาดเอง (agenda_slide ของธีมเว้น 0.92" ตายตัว ⇒ เกิน 6 รายการทับ footer · เจอจริงเล่ม Maintenance 5 บท)
_ag = [("ภาพรวม", "ผังการไหลของงาน · ใครใช้หน้าไหน · วิธีอ่านคู่มือ")] + [(f"บท {k} · {n}", d) for k, n, d in C.PARTS] + [("กิจวัตรรายวัน + ปัญหาที่พบบ่อย", "")]
s = blank(p); head(s, "สารบัญ", "แบ่งบทตามบทบาท — อ่านเฉพาะบทของตัวเองได้")
_step = min(0.92, (6.75 - 1.93) / len(_ag)); yy = 1.93
for i, (t1, t2) in enumerate(_ag):
    text(s, 1.56, yy, 11.0, 0.42, [[(f"{i + 1}.   {t1}", {"sz": 18 if _step >= 0.8 else 16, "b": True, "c": GREEN})]])
    if t2: text(s, 2.05, yy + (0.42 if _step >= 0.8 else 0.36), 10.5, 0.34, [[(t2, {"sz": fit_one_line(t2, 10.5, 13, 10), "c": GREY})]])
    yy += _step
footer(s, nextpage())

s = blank(p); head(s, "วิธีอ่านคู่มือ + เข้าเมนู", C.HOWTO_MENU[0])
items = [("1", "เข้าเมนู", C.HOWTO_MENU[1]),
 ("2", "แท็บ", "แถบปุ่มใต้ชื่อหน้า = แท็บ · ที่อยู่หน้าเว็บจะมี ?tab=… หรือ ?view=… — บุ๊กมาร์ก/ส่งลิงก์ให้เพื่อนเปิดแท็บเดิมได้"),
 ("3", "วงกลมส้ม", "เลขในวงกลมบนภาพ = เลขขั้นตอนทางขวา · วงกลมเทา = ขั้นที่ไม่มีบนภาพ (อยู่ด้านล่าง/หน้าต่างถัดไป)"),
 ("4", "📍 / ➡ / ⚠", "📍 ทางเข้าหน้า · ➡ งานไปต่อที่ไหน · ⚠ เรื่องที่ทำพลาดบ่อย"),
 ("5", "ปุ่มไม่ขึ้น", "ปุ่มบันทึกขึ้นตามสิทธิ์ของบัญชี — ไม่เห็นปุ่ม / ขึ้นแถบ \"ดูอย่างเดียว\" = ขอสิทธิ์จากผู้ดูแลระบบ"),
 ("6", "ภาพตัวอย่าง", "ภาพหน้าจอมาจากโหมดทดสอบ ตัวเลข ชื่อพาร์ท ชื่อไลน์ เป็นข้อมูลตัวอย่าง ไม่ใช่ข้อมูลจริง")]
y = 1.75
for n, h, t in items:
    badge(s, 0.7, y + 0.04, n, d=0.36)
    text(s, 1.2, y, 2.2, 0.45, [[(h, {"sz": 16, "b": True, "c": GREEN})]])
    text(s, 3.4, y + 0.03, 9.4, 0.7, [[(t, {"sz": 14, "c": GREY})]]); y += 0.8
footer(s, nextpage())

# flow swimlane — FLOW = [(lane_name, part_key, [(t1, t2), ...])] · FLOW_LINKS = [((lane,i),(lane,j),label)]
s = blank(p); head(s, C.FLOW_TITLE, "เลขในกล่อง = เลขสไลด์ของบทนั้น")
nl = len(C.FLOW); top, bot = 1.50, 6.30; gapl = 0.15
lh = (bot - top - gapl * (nl - 1)) / nl; pos = {}
for li, lane in enumerate(C.FLOW):
    lname, part, nodes = lane[:3]; chain = lane[3] if len(lane) > 3 else getattr(C, "FLOW_CHAIN", True)
    y0 = top + li * (lh + gapl); col = PART_COLOR.get(part, GREEN)
    rect(s, 0.3, y0, 12.75, lh, fill=LIGHT, line=BORDER); rect(s, 0.3, y0, 1.25, lh, fill=col)
    text(s, 0.3, y0, 1.25, lh, [[(lname, {"sz": 13, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    n = len(nodes); gx = 0.3; avail = 12.95 - 1.75; w = (avail - gx * (n - 1)) / n; nh = min(1.0, lh - 0.3)
    for i, (t1, t2) in enumerate(nodes):
        x = 1.75 + i * (w + gx); yy = y0 + (lh - nh) / 2
        rect(s, x, yy, w, nh, fill=WHITE, line=col, lw=1.75, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        text(s, x + 0.05, yy + 0.04, w - 0.1, nh - 0.08, [[(t1, {"sz": fit_one_line(t1, w - 0.1, 12, 9), "b": True, "c": col})], [(t2, {"sz": 10, "c": GREY})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, sa=1)
        pos[(li, i)] = (x, yy, w, nh, col)
        if chain and i > 0:
            px = pos[(li, i - 1)]; conn(s, px[0] + px[2], yy + nh / 2, x, yy + nh / 2, GREY, arrow=True)
for (a, b, label) in getattr(C, "FLOW_LINKS", []):
    ax, ay, aw, ah, ac = pos[a]; bx, by, bw, bh, _ = pos[b]
    x1 = ax + aw / 2 + (0.25 if a[0] < b[0] else -0.25); x2 = bx + bw / 2 + (0.25 if a[0] < b[0] else -0.25)
    if a[0] < b[0]: y1, y2 = ay + ah, by
    else: y1, y2 = ay, by + bh
    ym = (y1 + y2) / 2
    if abs(x1 - x2) < 0.05: conn(s, x1, y1, x2, y2, ac, arrow=True)
    else: conn(s, x1, y1, x1, ym, ac); conn(s, x1, ym, x2, ym, ac); conn(s, x2, ym, x2, y2, ac, arrow=True)
    if a[0] < b[0]: text(s, x1 + 0.05, y1 + 0.0, 1.8, 0.24, [[(label, {"sz": 10, "b": True, "c": ac})]])
    else: text(s, x1 - 1.85, y1 - 0.25, 1.8, 0.24, [[(label, {"sz": 10, "b": True, "c": ac})]], align=PP_ALIGN.RIGHT)
text(s, 0.3, 6.40, 12.7, 0.45, [[(C.FLOW_NOTE, {"sz": fit_one_line(C.FLOW_NOTE, 12.7, 12, 10), "b": True, "c": ORANGE})]], align=PP_ALIGN.CENTER)
footer(s, nextpage())

# matrix
s = blank(p); head(s, "ใครใช้หน้าไหน", "● = กดบันทึก/ทำงาน   ○ = เปิดดู   (สิทธิ์จริงขึ้นกับการตั้งค่าบัญชีในระบบ)")
cols = ["หน้า", "ที่อยู่"] + C.MATRIX_COLS; nr = len(C.MATRIX) + 1
rh = min(0.42, 5.1 / nr)
tbl = s.shapes.add_table(nr, len(cols), Inches(0.5), Inches(1.65), Inches(12.3), Inches(rh * nr)).table
rest = (12.3 - 6.0) / len(C.MATRIX_COLS)
for i, w in enumerate([3.6, 2.4] + [rest] * len(C.MATRIX_COLS)): tbl.columns[i].width = Inches(w)
def cell(r, c, t, b=False, col=GREY, fill=None, al=PP_ALIGN.CENTER):
    ce = tbl.cell(r, c); ce.text = ""; pa = ce.text_frame.paragraphs[0]; pa.alignment = al
    run = pa.add_run(); run.text = t; run.font.size = Pt(12 if nr <= 12 else 10.5); run.font.bold = b; run.font.name = FONT; run.font.color.rgb = col
    ce.vertical_anchor = MSO_ANCHOR.MIDDLE
    if fill is not None: ce.fill.solid(); ce.fill.fore_color.rgb = fill
for c, t in enumerate(cols): cell(0, c, t, True, WHITE, GREEN_D)
for r, row in enumerate(C.MATRIX, 1):
    for c, t in enumerate(row):
        cell(r, c, t, c == 0, GREEN if t.startswith("●") else GREY, GREEN_TINT if r % 2 == 0 else WHITE, PP_ALIGN.LEFT if c < 2 else PP_ALIGN.CENTER)
footer(s, nextpage())

for i, (k, name, desc) in enumerate(C.PARTS):
    section_divider(p, PHOTOS[i % len(PHOTOS)], [f"บท {k}", name]); nextpage()
    for d in [x for x in C.SLIDES if x["part"] == k]: page_slide(d)

s = blank(p); head(s, "กิจวัตรรายวันตามบทบาท", "ลำดับที่ควรเปิดดูในแต่ละวัน")
nR = len(C.ROUTINE); cw = (12.7 - 0.1 * (nR - 1)) / nR; x = 0.35
for name, part, its in C.ROUTINE:
    col = PART_COLOR.get(part, GREEN)
    rect(s, x, 1.6, cw, 0.45, fill=col)
    text(s, x, 1.6, cw, 0.45, [[(name, {"sz": 15, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    rect(s, x, 2.05, cw, 4.7, fill=LIGHT, line=BORDER)
    text(s, x + 0.1, 2.15, cw - 0.2, 4.5, [[(f"{i}. {t}", {"sz": 14 if nR <= 4 else 12.5, "c": DARK})] for i, t in enumerate(its, 1)], sa=10)
    x += cw + 0.1
footer(s, nextpage())

s = blank(p); head(s, "ปัญหาที่พบบ่อย / สิ่งที่ควรรู้", "ใช้ได้ทุกบทบาท")
y = 1.65; fh = min(0.55, 5.0 / max(1, len(C.FAQ)) - 0.07)
for q, a in C.FAQ:
    rect(s, 0.5, y, 4.6, fh, fill=GREEN_D); text(s, 0.6, y, 4.4, fh, [[(q, {"sz": 12.5, "b": True, "c": WHITE})]], anchor=MSO_ANCHOR.MIDDLE)
    rect(s, 5.1, y, 7.7, fh, fill=LIGHT, line=BORDER); text(s, 5.2, y, 7.5, fh, [[(a, {"sz": 12.5, "c": GREY})]], anchor=MSO_ANCHOR.MIDDLE)
    y += fh + 0.07
footer(s, nextpage())
closing_slide(p, nextpage(), lines=[(C.CLOSING, GREEN), ("สงสัยหรือพบปัญหา แจ้งผ่านปุ่ม Feedback ท้ายเมนูของโปรแกรม", ORANGE)])

for sl in p.slides:   # ไทยอยู่ช่อง complex script — ตั้ง cs/ea = Tahoma ไม่งั้นไปใช้ฟอนต์ธีม
    for r in sl._element.iter(qn('a:rPr')):
        for tag in ('a:ea', 'a:cs'):
            if r.find(qn(tag)) is None:
                e = r.makeelement(qn(tag), {'typeface': FONT}); lat = r.find(qn('a:latin'))
                (lat.addnext(e) if lat is not None else r.append(e))
p.save(OUT)
print("saved", OUT, "slides", len(p.slides))
for w in WARN: print("WARN", w)
