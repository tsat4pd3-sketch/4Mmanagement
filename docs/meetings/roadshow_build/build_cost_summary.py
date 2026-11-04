# -*- coding: utf-8 -*-
"""สรุปต้นทุน ESM — ใช้ไปแล้ว + เทียบก่อน/หลังย้ายไป INET (ธีม TSG R01 · ภาษาไทย · 2026-10-20)
Run:  python3 build_cost_summary.py  →  ../TSAT_ESM_Cost_Summary_2026-10-20.pptx
ตัวเลข: Supabase ใบแจ้งหนี้ 11/10 = 36.70 USD (docs/EGRESS-AUDIT-2026-09-17.md §17) · Render เพดาน 5 USD (docs/modules/deploy.md)
        Claude: Pro 2 เดือน (พ.ค.–มิ.ย.) + Max 20x 4 เดือน (ก.ค.–ต.ค.) — user แจ้ง 20/10 · INET 120,000 บาท/ปี — ไอทีแจ้ง 20/10
        เรท 35 บาท/USD (วางแผนแบบเผื่อ) · ไม่รวมค่าแรง (คำสั่ง user)
"""
import os
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
import tsg_theme as T
from tsg_theme import GREEN, GREEN_D, GREEN_TINT, BORDER, ORANGE, AMBER, GREY, WHITE

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "TSAT_ESM_Cost_Summary_2026-10-20.pptx")
p = T.new_pres()
page = [0]


def notes(s, th):
    s.notes_slide.notes_text_frame.text = th


def content(title, sub=None):
    s = T.blank(p); page[0] += 1
    T.head(s, title, sub)
    T.footer(s, page[0])
    return s


def tile(s, x, y, w, h, big, label, c=GREEN):
    T.rect(s, x, y, w, h, fill=WHITE, line=BORDER, shape=MSO_SHAPE.ROUNDED_RECTANGLE, shadow=True)
    T.rect(s, x, y, 0.12, h, fill=c)
    T.text(s, x + 0.3, y + 0.12, w - 0.45, h * 0.55, [[(big, {"sz": 30, "b": True, "c": c})]], anchor=MSO_ANCHOR.MIDDLE)
    T.text(s, x + 0.3, y + h * 0.6, w - 0.45, h * 0.36, [[(label, {"sz": 13, "c": GREY})]], anchor=MSO_ANCHOR.TOP)


def fmt(n):
    return f"{n:,.0f}"


# ── 1 ปก ──
s = T.title_slide(p, "สรุปต้นทุนระบบ ESM",
                  "ใช้ไปแล้วเท่าไหร่ · ก่อนและหลังย้ายไปเซิร์ฟเวอร์ INET",
                  "20 ตุลาคม 2569",
                  "TSAT · Thai Summit Group",
                  decl_label="คำประกาศคุณภาพของฉัน")
page[0] += 1
notes(s, "สรุปต้นทุน 2 เรื่อง: (1) พัฒนามาแล้ว 5 เดือนใช้เงินไปเท่าไหร่ (2) ถ้าย้ายระบบขึ้นเซิร์ฟเวอร์ INET ค่าใช้จ่ายต่อปีเปลี่ยนไปอย่างไร ตัวเลขทั้งหมดไม่รวมค่าแรง")

# ── 2 ใช้ไปแล้ว ──
s = content("ต้นทุนที่ใช้ไปแล้ว", "13 พ.ค. – 20 ต.ค. 2569 (ประมาณ 5 เดือน) · ไม่รวมค่าแรง")
tile(s, 0.5, 1.6, 3.95, 1.45, "~32,000 บาท", "รวมทั้งหมดตั้งแต่เริ่ม", ORANGE)
tile(s, 4.68, 1.6, 3.95, 1.45, "83 หน้าจอ", "ใช้งานจริงทุกวัน")
tile(s, 8.86, 1.6, 3.95, 1.45, "121 บัญชี", "ผู้ใช้ในระบบ")
rows = [("Claude Max 20x (เครื่องมือเขียนโปรแกรม)", "4 เดือน ก.ค.–ต.ค. × 200 USD", 28000),
        ("Claude Pro", "2 เดือน พ.ค.–มิ.ย. × 20 USD", 1400),
        ("Supabase (ฐานข้อมูลบนคลาวด์)", "ฟรีถึง 10 ก.ย. · Pro 2 รอบบิล", 2600),
        ("Render (หน้าเว็บ)", "ฟรี · เพดานเดือน ต.ค. 5 USD", 175),
        ("GitHub · Telegram · Push · ฮาร์ดแวร์", "ฟรี / ใช้ของที่มีอยู่", 0)]
y0 = 3.3
T.rect(s, 0.5, y0, 12.31, 0.45, fill=GREEN_D)
for x, w, t, al in [(0.65, 5.0, "รายการ", PP_ALIGN.LEFT), (5.7, 4.6, "วิธีคิด", PP_ALIGN.LEFT), (10.3, 2.35, "บาท", PP_ALIGN.RIGHT)]:
    T.text(s, x, y0, w, 0.45, [[(t, {"sz": 14, "b": True, "c": WHITE})]], align=al, anchor=MSO_ANCHOR.MIDDLE)
for i, (a, b, v) in enumerate(rows):
    y = y0 + 0.45 + i * 0.42
    if i % 2:
        T.rect(s, 0.5, y, 12.31, 0.42, fill=GREEN_TINT)
    T.text(s, 0.65, y, 5.0, 0.42, [[(a, {"sz": 13, "b": True, "c": GREEN_D})]], anchor=MSO_ANCHOR.MIDDLE)
    T.text(s, 5.7, y, 4.6, 0.42, [[(b, {"sz": 12, "c": GREY})]], anchor=MSO_ANCHOR.MIDDLE)
    T.text(s, 10.3, y, 2.35, 0.42, [[(("~" if v in (2600, 175) else "") + fmt(v), {"sz": 13, "b": True, "c": GREEN_D})]], align=PP_ALIGN.RIGHT, anchor=MSO_ANCHOR.MIDDLE)
y = y0 + 0.45 + len(rows) * 0.42
T.rect(s, 0.5, y, 12.31, 0.02, fill=GREEN)
T.text(s, 0.65, y + 0.05, 8, 0.45, [[("รวม  ·  Claude 92%  ·  คลาวด์ + หน้าเว็บ 8%", {"sz": 14, "b": True, "c": GREEN_D})]], anchor=MSO_ANCHOR.MIDDLE)
T.text(s, 10.3, y + 0.05, 2.35, 0.45, [[("~32,000", {"sz": 15, "b": True, "c": ORANGE})]], align=PP_ALIGN.RIGHT, anchor=MSO_ANCHOR.MIDDLE)
notes(s, "พัฒนามา 5 เดือน ค่าเครื่องมือและค่าเช่าระบบรวมประมาณ 32,000 บาท ส่วนใหญ่เป็นค่า Claude ที่ใช้เขียนโปรแกรม ค่าระบบจริงเดือนละประมาณ 1,300 บาท ย้ำว่าไม่รวมเวลาของคนในทีม เรทแลกเปลี่ยนใช้ 35 บาทต่อดอลลาร์ (ตั้งสูงไว้เผื่อ) ค่า Supabase รอบ ก.ย. เป็นค่าประมาณ รอบ ต.ค. ใบแจ้งหนี้จริง 36.70 USD")

# ── 3 ก่อน / หลัง ──
s = content("ค่าใช้จ่ายต่อปี: ก่อน vs หลังย้ายไป INET", "ไม่รวมค่าแรง · Claude ยังจ่ายเท่าเดิมทั้ง 2 แบบ")
SCALE = 7.6 / 210000
bars = [("ตอนนี้", "Supabase + Render บนคลาวด์", 18000, 84000),
        ("หลังย้าย", "เซิร์ฟเวอร์ INET", 120000, 84000)]
for i, (lab, sub, sysv, cl) in enumerate(bars):
    y = 1.85 + i * 1.75
    T.text(s, 0.5, y, 2.4, 0.5, [[(lab, {"sz": 20, "b": True, "c": GREEN_D if i == 0 else ORANGE})]], anchor=MSO_ANCHOR.MIDDLE)
    T.text(s, 0.5, y + 0.5, 2.4, 0.5, [[(sub, {"sz": 12, "c": GREY})]])
    x = 3.0
    w1 = sysv * SCALE; w2 = cl * SCALE
    T.rect(s, x, y + 0.05, w1, 0.9, fill=(GREEN if i == 0 else ORANGE))
    if w1 > 1.3:
        T.text(s, x, y + 0.05, w1, 0.9, [[("ค่าระบบ " + fmt(sysv), {"sz": 14, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    T.rect(s, x + w1, y + 0.05, w2, 0.9, fill=BORDER)
    T.text(s, x + w1, y + 0.05, w2, 0.9, [[("Claude " + fmt(cl), {"sz": 14, "b": True, "c": GREEN_D})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    T.text(s, x + w1 + w2 + 0.15, y + 0.05, 2.2, 0.9, [[(fmt(sysv + cl), {"sz": 22, "b": True, "c": GREEN_D if i == 0 else ORANGE})], [("บาท/ปี", {"sz": 12, "c": GREY})]], anchor=MSO_ANCHOR.MIDDLE, sa=0)
    if w1 <= 1.3:
        T.text(s, x - 0.05, y + 0.97, 3.5, 0.35, [[("ค่าระบบ " + fmt(sysv), {"sz": 12, "b": True, "c": GREEN})]])
heads = [("", 2.9), ("ตอนนี้", 2.6), ("หลังย้าย", 2.6), ("ส่วนต่าง", 2.6)]
ty = 5.45
T.rect(s, 0.5, ty, 10.7, 0.4, fill=GREEN_D)
xs = [0.5]
for _, w in heads[:-1]:
    xs.append(xs[-1] + w)
for (h, w), x in zip(heads, xs):
    T.text(s, x + 0.1, ty, w - 0.2, 0.4, [[(h, {"sz": 13, "b": True, "c": WHITE})]], align=PP_ALIGN.RIGHT if h else PP_ALIGN.LEFT, anchor=MSO_ANCHOR.MIDDLE)
for j, (lab, a, b) in enumerate([("ค่าระบบ / เดือน", 1500, 10000), ("รวม Claude / เดือน", 8500, 17000)]):
    y = ty + 0.4 + j * 0.42
    if j % 2:
        T.rect(s, 0.5, y, 10.7, 0.42, fill=GREEN_TINT)
    vals = [lab, "~" + fmt(a), fmt(b), "+" + fmt(b - a)]
    for k, (v, x) in enumerate(zip(vals, xs)):
        w = heads[k][1]
        T.text(s, x + 0.1, y, w - 0.2, 0.42, [[(v, {"sz": 13, "b": k in (0, 3), "c": ORANGE if k == 3 else GREEN_D})]],
               align=PP_ALIGN.LEFT if k == 0 else PP_ALIGN.RIGHT, anchor=MSO_ANCHOR.MIDDLE)
notes(s, "แท่งบน: ตอนนี้ค่าระบบประมาณ 18,000 บาทต่อปี บวก Claude 84,000 รวมราว 102,000 บาทต่อปี  แท่งล่าง: หลังย้าย INET 120,000 บาทต่อปี บวก Claude 84,000 รวม 204,000 บาทต่อปี  ค่าระบบเพิ่มประมาณ 8,500 บาทต่อเดือน หรือราว 100,000 บาทต่อปี ราคา INET ไอทีแจ้งมา ยังต้องยืนยันว่ารวม VAT และ backup หรือยัง")

# ── 4 ได้อะไร + ต่อโรงงาน ──
s = content("เงินที่เพิ่มได้อะไรกลับมา", "และต้นทุนต่อโรงงานลดลงเมื่อใช้ร่วมกันหลายโรงงาน")
gains = [("ไม่โดนล็อกเพราะเกินโควตา", "11 ก.ย. ระบบเคยถูกล็อกทั้งโรงงาน\nเพราะแพ็กเกจคลาวด์มีเพดาน"),
         ("เครื่องแรงพอรองรับการขยาย", "8 vCPU · 32 GB · ดิสก์ 500 GB\nรองรับหลายโรงงาน + SCADA ในอนาคต"),
         ("ข้อมูลอยู่ในไทย ไอทีคุมเอง", "data center INET ในประเทศ\nมี firewall + รายชื่อ IP ที่อนุญาต")]
for i, (h, d) in enumerate(gains):
    y = 1.65 + i * 1.5
    T.rect(s, 0.5, y, 6.3, 1.32, fill=WHITE, line=BORDER, shape=MSO_SHAPE.ROUNDED_RECTANGLE, shadow=True)
    T.rect(s, 0.5, y, 0.12, 1.32, fill=GREEN)
    T.text(s, 0.85, y + 0.1, 5.8, 0.45, [[(h, {"sz": 16, "b": True, "c": GREEN_D})]])
    T.text(s, 0.85, y + 0.55, 5.8, 0.75, [[(ln, {"sz": 13, "c": GREY})] for ln in d.split("\n")], sa=2)
T.text(s, 7.2, 1.6, 5.6, 0.45, [[("ค่า INET ต่อโรงงาน (ถ้าเครื่องเดียวรองรับพอ)", {"sz": 15, "b": True, "c": GREEN_D})]])
per = [(1, 120000), (2, 60000), (3, 40000), (5, 24000)]
mx = 120000
for i, (n, v) in enumerate(per):
    y = 2.2 + i * 0.95
    T.text(s, 7.2, y, 1.4, 0.7, [[(f"{n} โรงงาน", {"sz": 14, "b": True, "c": GREEN_D})]], anchor=MSO_ANCHOR.MIDDLE)
    w = 3.0 * v / mx
    T.rect(s, 8.6, y + 0.12, w, 0.46, fill=(ORANGE if n == 1 else GREEN))
    T.text(s, 8.6 + w + 0.1, y, 1.9, 0.7, [[(fmt(v), {"sz": 15, "b": True, "c": GREEN_D}), (" /ปี", {"sz": 11, "c": GREY})]], anchor=MSO_ANCHOR.MIDDLE)
T.text(s, 7.2, 6.05, 5.6, 0.7, [[("ถ้าต้องขยายเป็น 3 เครื่อง (ล่ม 1 ยังวิ่ง) ราคาจะเปลี่ยน — รอใบเสนอราคา", {"sz": 12, "c": ORANGE})]])
notes(s, "เงินที่เพิ่มแลกกับ 3 เรื่อง: ไม่โดนล็อกเพราะเกินโควตาเหมือน 11 ก.ย. เครื่องแรงพอสำหรับการขยาย และข้อมูลอยู่ในไทยภายใต้การดูแลของไอที  ด้านขวา: ถ้าโรงงานอื่นในกลุ่มมาใช้เครื่องเดียวกัน ค่า INET ต่อโรงงานลดลงตามจำนวน 5 โรงงานเหลือ 24,000 บาทต่อปี  แต่ถ้าหลายโรงงานควรมี 3 เครื่อง ราคาจะต่างจากนี้")

# ── 5 ยืนยันก่อนตัดสินใจ ──
s = content("ต้องยืนยันก่อนตัดสินใจ", "ราคา 120,000 บาท/ปี รวมอะไรบ้าง · และสมมติฐานของตัวเลขในเด็คนี้")
qs = ["รวม VAT แล้วหรือยัง", "backup / snapshot รายวัน รวมในราคาไหม",
      "Firewall · IP สาธารณะ · bandwidth รวมไหม", "ใครดูแล Kubernetes/Rancher — INET หรือไอทีเรา",
      "SLA: ระบบเปิดกี่ % · ล่มแล้วกู้ภายในกี่ชั่วโมง", "ราคาแบบ 3 เครื่อง · สัญญากี่ปี ย้ายออกได้ไหม"]
T.rect(s, 0.5, 1.6, 7.2, 4.95, fill=WHITE, line=BORDER, shape=MSO_SHAPE.ROUNDED_RECTANGLE, shadow=True)
T.text(s, 0.75, 1.7, 6.8, 0.45, [[("ถามไอที / INET", {"sz": 17, "b": True, "c": GREEN_D})]])
for i, q in enumerate(qs):
    y = 2.25 + i * 0.7
    T.rect(s, 0.75, y + 0.07, 0.42, 0.42, fill=GREEN, shape=MSO_SHAPE.OVAL)
    T.text(s, 0.75, y + 0.07, 0.42, 0.42, [[(str(i + 1), {"sz": 14, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    T.text(s, 1.35, y, 6.2, 0.56, [[(q, {"sz": 14, "c": GREEN_D})]], anchor=MSO_ANCHOR.MIDDLE)
T.rect(s, 7.95, 1.6, 4.9, 4.95, fill=GREEN_TINT, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
T.text(s, 8.2, 1.7, 4.45, 4.8, [[("สมมติฐานของตัวเลข", {"sz": 17, "b": True, "c": ORANGE})]] + [
    [("•  " + t, {"sz": 13, "c": GREEN_D})] for t in
    ["ไม่รวมค่าแรงของทีม และเวลาคนหน้างานที่ช่วยทดสอบ",
     "เรท 35 บาท/USD (ตั้งสูงไว้เผื่อ)",
     "Supabase รอบ ก.ย. เป็นค่าประมาณ · รอบ ต.ค. ใบแจ้งหนี้จริง 36.70 USD",
     "ราคา INET ตามที่ไอทีแจ้ง 20 ต.ค. ยังไม่เห็นใบเสนอราคา",
     "หลังย้าย ค่า Supabase + Render หายไปทั้งหมด"]], sa=8)
notes(s, "ปิดด้วยคำถาม 6 ข้อที่ต้องได้คำตอบก่อนเซ็น และบอกสมมติฐานของตัวเลขให้ครบ โดยเฉพาะข้อแรกของสมมติฐาน: ตัวเลขทั้งหมดไม่รวมค่าแรง")

p.save(OUT)
print("saved", OUT, len(p.slides), "slides")
