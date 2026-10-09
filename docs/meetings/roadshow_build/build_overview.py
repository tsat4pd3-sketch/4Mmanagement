# -*- coding: utf-8 -*-
"""ESM Program Overview deck (TSG theme) — 2026-10-09
"แผนกไหนใช้อะไรได้บ้าง · ฟีเจอร์ที่เชื่อมกัน · เน้น realtime / ลดภาระ / ใช้ง่าย / ลดต้นทุน"
Run:  python3 build_overview.py  →  ../TSAT_ESM_Program_Overview_2026-10.pptx
Sources: roadshow-dept-stories-2026-10-06.md (features + hand-offs, cited to docs/modules)
         roadshow-metrics-2026-10-06.md (every number on the slides · measured 06 Oct 2026)
Rule: slide text = English (TSG) · speaker notes = Thai · NO baht figures (not measured — Finance to calculate)
"""
import os
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
import tsg_theme as T
from tsg_theme import GREEN_D, GREEN_M, GREEN_TINT, ORANGE, ORANGE_LT, GREY, AMBER, WHITE, GOLD, RGBColor

PART = RGBColor(0xD8, 0xE4, 0xD0)
BLUE = RGBColor(0x1F, 0x5F, 0x8B)
PURPLE = RGBColor(0x6A, 0x3D, 0x8F)
MEASURED = "Measured from ESM database · 06 Oct 2026"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "TSAT_ESM_Program_Overview_2026-10.pptx")

# 4 pillars — one colour each, reused on every slide so the audience learns the code
PILLARS = [("REALTIME", ORANGE), ("LESS WORK", GREEN_D), ("EASY TO USE", BLUE), ("LOWER COST", PURPLE)]

p = T.new_pres()
page = [1]


def notes(s, th):
    s.notes_slide.notes_text_frame.text = th


def content(title, sub=None):
    s = T.blank(p)
    T.head(s, title, sub)
    page[0] += 1
    T.footer(s, page[0])
    return s


def card(s, x, y, w, h, head, bullets, head_fill=GREEN_D, sz=12.5, bullet="•  "):
    T.rect(s, x, y, w, h, fill=WHITE, line=PART, shape=MSO_SHAPE.ROUNDED_RECTANGLE, shadow=True)
    T.rect(s, x, y, w, 0.46, fill=head_fill)
    T.text(s, x, y, w, 0.46, [[(head, {"sz": 14, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    runs = [[(bullet + b, {"sz": sz, "c": GREEN_M})] for b in bullets]
    T.text(s, x + 0.15, y + 0.58, w - 0.3, h - 0.66, runs, sa=5)


def stat(s, x, y, w, big, label, sub=None, color=ORANGE):
    T.rect(s, x, y, w, 1.6, fill=WHITE, line=PART, shape=MSO_SHAPE.ROUNDED_RECTANGLE, shadow=True)
    T.text(s, x, y + 0.08, w, 0.7, [[(big, {"sz": 28 if len(big) <= 10 else 22, "b": True, "c": color})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    T.text(s, x + 0.1, y + 0.8, w - 0.2, 0.42, [[(label, {"sz": 12, "b": True, "c": GREEN_D})]], align=PP_ALIGN.CENTER)
    if sub:
        T.text(s, x + 0.1, y + 1.2, w - 0.2, 0.35, [[(sub, {"sz": 10.5, "c": GREY})]], align=PP_ALIGN.CENTER)


def pillar_strip(s, items, y=5.45):
    """4 boxes · one per pillar · what THIS department gets from it"""
    w, gap = 2.98, 0.13
    for i, ((name, col), txt) in enumerate(zip(PILLARS, items)):
        x = 0.5 + i * (w + gap)
        T.rect(s, x, y, w, 1.02, fill=WHITE, line=col, lw=1.5, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        T.rect(s, x, y, 0.12, 1.02, fill=col)
        T.text(s, x + 0.22, y + 0.06, w - 0.3, 0.3, [[(name, {"sz": 11, "b": True, "c": col})]])
        T.text(s, x + 0.22, y + 0.34, w - 0.3, 0.66, [[(txt, {"sz": 11, "c": GREEN_M})]])


def dept(title, sub, features, screens, links, pillars, th):
    s = content(title, sub)
    y, h = 1.72, 3.58
    card(s, 0.5, y, 5.35, h, "WHAT YOU CAN DO", features, sz=12)
    card(s, 6.0, y, 3.25, h, "KEY SCREENS", screens, head_fill=GREEN_M, sz=11.5, bullet="▸ ")
    # connected-to card: arrow rows
    x, w = 9.4, 3.43
    T.rect(s, x, y, w, h, fill=WHITE, line=PART, shape=MSO_SHAPE.ROUNDED_RECTANGLE, shadow=True)
    T.rect(s, x, y, w, 0.46, fill=ORANGE)
    T.text(s, x, y, w, 0.46, [[("CONNECTED TO", {"sz": 14, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    for i, (who, what) in enumerate(links):
        yy = y + 0.6 + i * 0.73
        T.rect(s, x + 0.15, yy, 1.05, 0.34, fill=GREEN_TINT, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        T.text(s, x + 0.15, yy, 1.05, 0.34, [[(who, {"sz": 10.5, "b": True, "c": GREEN_D})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        T.text(s, x + 1.27, yy - 0.04, w - 1.4, 0.7, [[(what, {"sz": 10.5, "c": GREEN_M})]])
    pillar_strip(s, pillars)
    notes(s, th)
    return s


def flow_row(s, y, label, steps, color):
    T.text(s, 0.5, y - 0.45, 12, 0.4, [[(label, {"sz": 14, "b": True, "c": color})]])
    n = len(steps)
    w = (12.33 - 0.05 * (n - 1)) / n
    for i, (head, sub) in enumerate(steps):
        x = 0.5 + i * (w + 0.05)
        shp = MSO_SHAPE.PENTAGON if i == 0 else MSO_SHAPE.CHEVRON
        T.rect(s, x, y, w + 0.18, 0.95, fill=color if i % 2 == 0 else GREEN_M, shape=shp)
        T.text(s, x + 0.3, y + 0.05, w - 0.35, 0.85, [[(head, {"sz": 11.5, "b": True, "c": WHITE})], [(sub, {"sz": 9.5, "c": WHITE})]],
               anchor=MSO_ANCHOR.MIDDLE, sa=1)


# ══ 1 Title ═══════════════════════════════════════════════════════════
s = T.title_slide(p, "ESM Program Overview",
                  "One connected system for every department",
                  "Enterprise Shopfloor Management · who uses what · how the work connects",
                  "TSAT · Thai Summit Group · October 2026",
                  "Real-time · Less work · Easy to use · Lower cost")
notes(s, "เปิด: ESM คือระบบเดียวที่ทุกแผนกในโรงงานใช้ร่วมกัน — บันทึกครั้งเดียวที่หน้างาน แล้วทุกคนเห็นข้อมูลชุดเดียวกันทันที\n"
         "วันนี้จะเล่า 3 เรื่อง: แต่ละแผนกใช้อะไรได้บ้าง · งานของแต่ละแผนกเชื่อมกันยังไง · และได้อะไร 4 ข้อ: เห็นสด ลดงาน ใช้ง่าย ลดต้นทุน")

# ══ 2 Agenda ══════════════════════════════════════════════════════════
s = T.blank(p); page[0] += 1
T.text(s, 0.5, 0.28, 8, 0.95, [[("Agenda", {"sz": 34, "b": True, "c": GREEN_D})]], anchor=MSO_ANCHOR.MIDDLE)
s.shapes.add_picture(os.path.join(T.ASSET, "logo_big.png"), Inches(9.2), Inches(1.6), Inches(3.4), Inches(3.6))
for i, (t1, t2) in enumerate([
        ("ESM at a glance", "One login · every department · PC, phone and TV"),
        ("Who uses what", "Departments and their screens on one page"),
        ("How the work connects", "Two end-to-end flows across departments"),
        ("Department by department", "Features, key screens and hand-offs"),
        ("Why it matters", "Real-time · Less work · Easy to use · Lower cost")]):
    yy = 1.45 + i * 1.0
    T.rect(s, 0.7, yy, 0.6, 0.6, fill=ORANGE, shape=MSO_SHAPE.OVAL)
    T.text(s, 0.7, yy, 0.6, 0.6, [[(str(i + 1), {"sz": 20, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    T.text(s, 1.55, yy - 0.05, 7.4, 0.42, [[(t1, {"sz": 18, "b": True, "c": GREEN_D})]])
    T.text(s, 1.55, yy + 0.35, 7.4, 0.38, [[(t2, {"sz": 12, "c": GREY})]])
T.footer(s, page[0])
notes(s, "5 ช่วง ใช้เวลารวม ~15 นาที: ภาพรวม → แผนกไหนใช้อะไร → งานเชื่อมกันยังไง → ลงรายละเอียดทีละแผนก → สรุปประโยชน์ 4 ข้อ")

# ══ 3 At a glance — 4 pillars ═════════════════════════════════════════
s = content("ESM at a glance", "Record once at the line — every department sees the same data, live")
pill = [
    ("REALTIME", ORANGE, ["Live OEE during the shift", "Andon on factory map & TV", "Calls go to the right team's phone", "Escalates by itself if unanswered"]),
    ("LESS WORK", GREEN_D, ["No re-typing paper into Excel", "Official FM- forms printed from data", "OEE, PM due dates, kanban calculated", "System opens follow-up orders"]),
    ("EASY TO USE", BLUE, ["Scan QR on machine / jig / part", "Thai screens, one login for all", "Works on phone, PC and factory TV", "'My queue' shows what waits for me"]),
    ("LOWER COST", PURPLE, ["Built in-house — no per-user licence", "Uses PCs, phones, TVs we already have", "~1,300 paper forms / month now digital", "Less machine waiting time for repair"]),
]
for i, (name, col, bl) in enumerate(pill):
    x = 0.5 + i * 3.11
    T.rect(s, x, 1.75, 2.98, 3.45, fill=WHITE, line=PART, shape=MSO_SHAPE.ROUNDED_RECTANGLE, shadow=True)
    T.rect(s, x, 1.75, 2.98, 0.62, fill=col)
    T.text(s, x, 1.75, 2.98, 0.62, [[(name, {"sz": 17, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    T.text(s, x + 0.18, 2.5, 2.65, 2.6, [[("✓  " + b, {"sz": 12.5, "c": GREEN_M})] for b in bl], sa=9)
for i, (big, lab) in enumerate([("10", "departments on one system"), ("80+", "screens & forms"),
                                 ("71", "people active in last 30 days"), ("1", "login · PC · phone · TV")]):
    x = 0.5 + i * 3.11
    T.rect(s, x, 5.38, 2.98, 0.9, fill=GREEN_TINT, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    T.text(s, x + 0.1, 5.38, 0.95, 0.9, [[(big, {"sz": 24, "b": True, "c": ORANGE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    T.text(s, x + 1.05, 5.38, 1.85, 0.9, [[(lab, {"sz": 12, "b": True, "c": GREEN_D})]], anchor=MSO_ANCHOR.MIDDLE)
T.text(s, 0.5, 6.4, 12.3, 0.35, [[("Active users: " + MEASURED, {"sz": 10, "i": True, "c": GREY})]])
notes(s, "4 เสาหลักของ ESM — สีเดียวกันนี้จะโผล่ท้ายสไลด์ทุกแผนก (ส้ม=เห็นสด · เขียว=ลดงาน · น้ำเงิน=ใช้ง่าย · ม่วง=ลดต้นทุน)\n"
         "ตัวเลขผู้ใช้: บัญชี 100 · ใช้จริงใน 30 วัน 71 คน · ใน 7 วัน 47 คน (วัด 06/10)\n"
         "~1,300 ใบ/เดือน = ใบซ่อม MO 496 + ใบตรวจ PM 88 + รายงานกะ 505 + LPA 222 (ก.ย.)")

# ══ 4 Who uses what — matrix ══════════════════════════════════════════
s = content("Who uses what", "Every department works in the same system — each sees its own screens")
rows = [
    ("Production", "Daily Report · Downtime & NG · Check-in & PPE · LPA · Scrap report · Problem report"),
    ("Maintenance", "Repair orders (MO) · Andon board · PM plans & checks · Spare parts · KPI & QC 7 tools"),
    ("JIG / DIE", "Jig & die registry · Shim record · Die status · Jig inspection · Setup-time rules"),
    ("Quality (QA)", "Inspection sheets · Yellow / red bins · 4M approval · CQI-15 · Test-part requisition"),
    ("Store", "Store board (WIP refill · raw mat · purchase) · Stock receipts · Store monitor · BOM auto-request"),
    ("Logistic", "Customer demand & shipping · EDI from e-mail · FG stock · In-plant transport"),
    ("Planning / Sales", "Production plan · Monitoring boards · Kanban calculation · Customer part matching"),
    ("Engineering (PE)", "Process flow · PFMEA · Control plan · NPI / APQP / PPAP · 4M change"),
    ("HR / Admin", "OJT training (e-sign) · Skills matrix · Workforce insight · Company calendar · OT"),
    ("Management", "OBEYA KPI & SQDCM · Factory map · TV dashboards · Order trace · Action board"),
]
tbl = s.shapes.add_table(len(rows) + 1, 2, Inches(0.5), Inches(1.7), Inches(12.33), Inches(4.9)).table
tbl.columns[0].width = Inches(2.5); tbl.columns[1].width = Inches(9.83)
for c, h in enumerate(["Department", "Main screens / functions"]):
    cell = tbl.cell(0, c); cell.fill.solid(); cell.fill.fore_color.rgb = GREEN_D
    cell.text = h; r = cell.text_frame.paragraphs[0].runs[0]
    r.font.size = Pt(13); r.font.bold = True; r.font.color.rgb = WHITE; r.font.name = T.FONT
for i, (d, f) in enumerate(rows, start=1):
    for c, v in enumerate([d, f]):
        cell = tbl.cell(i, c); cell.fill.solid(); cell.fill.fore_color.rgb = GREEN_TINT if i % 2 == 0 else WHITE
        cell.text = v; cell.margin_top = Inches(0.03); cell.margin_bottom = Inches(0.03)
        r = cell.text_frame.paragraphs[0].runs[0]
        r.font.size = Pt(12 if c == 0 else 11.5); r.font.bold = (c == 0); r.font.name = T.FONT
        r.font.color.rgb = GREEN_D if c == 0 else GREEN_M
notes(s, "ภาพเดียวตอบคำถาม \"แผนกไหนใช้อะไร\" — ทุกแผนกเข้าระบบเดียวกัน ด้วยบัญชีเดียว เมนูที่เห็นขึ้นกับสิทธิ์ของแต่ละคน\n"
         "ถ้าผู้บริหารถามว่าใช้จริงแค่ไหน: MTN/PD3/PD4 ใช้ทุกวัน · PD1/PD2/Store/Logistic/Planning กำลังขยาย · QA/JIG/DIE/PE ระบบพร้อม แต่ยังลงข้อมูลน้อย (ดูสถานะใน roadshow-dept-stories §0)")

# ══ 5 How work connects ═══════════════════════════════════════════════
s = content("How the work connects", "One event at the line moves through every department")
flow_row(s, 2.15, "①  A machine stops", [
    ("Line records stop", "Daily Report · 1 tap"),
    ("Calls the right team", "JIG / DIE / MTN phone"),
    ("Repair order opens", "MO from the downtime"),
    ("Repair → QA check", "Signed on screen"),
    ("OEE updates", "Shift + factory map"),
    ("KPI on OBEYA", "Management sees it"),
], ORANGE)
flow_row(s, 3.9, "②  A customer order arrives", [
    ("EDI e-mail in", "Auto queue · 15 min"),
    ("Plan & monitor", "Shifts / OT needed"),
    ("Line produces", "Scan kanban card"),
    ("Close order", "BOM requests parts"),
    ("Store & FG", "Count, then receive"),
    ("Ship", "Cuts stock · red if short"),
], GREEN_D)
T.rect(s, 0.5, 5.25, 12.33, 1.0, fill=GREEN_TINT, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
T.text(s, 0.7, 5.25, 12.0, 1.0, [[("One order number traces everything:  ", {"sz": 13, "b": True, "c": GREEN_D}),
                                  ("which line, shift, people, machine stops, defects, repairs and the PFMEA line behind it — on one screen (Order Trace).",
                                   {"sz": 12.5, "c": GREEN_M})]], anchor=MSO_ANCHOR.MIDDLE)
notes(s, "2 สายงานที่เห็นภาพชัดที่สุดว่าทุกแผนกต่อกันในระบบเดียว\n"
         "① เครื่องหยุด: ผลิตลง downtime → กดเรียกช่าง เลือกทีม (เด้งเฉพาะทีมนั้น · ไม่รับใน 15 นาทีเตือนเอง) → เปิดใบ MO ต่อจาก downtime → ซ่อม → QA ตรวจ → OEE กะนั้นอัปเดต → ขึ้น KPI บน OBEYA\n"
         "② ลูกค้าสั่งของ: เมล EDI เข้าคิวเอง → วางแผน/Monitoring → ไลน์สแกนคัมบังผลิต → ปิดใบแล้วระบบระเบิด BOM ขอพาร์ทลูกเอง → คลังนับแล้วรับ → ส่งของตัดสต็อกทันที\n"
         "ปิดด้วย /order-trace: เลขใบเดียวกางได้ทั้งเส้น")

# ══ 6 Section divider ═════════════════════════════════════════════════
s = T.section_divider(p, "div_pd3.png", ["Department", "by department"]); page[0] += 1
notes(s, "ต่อไปลงรายละเอียดทีละแผนก — ทุกสไลด์มี 3 ช่องเหมือนกัน: ทำอะไรได้ · จอหลัก · เชื่อมกับใคร และแถบ 4 สีด้านล่าง")

# ══ 7–15 Departments ══════════════════════════════════════════════════
dept("Production", "Record once at the line — the rest of the factory sees it",
     ["Open the shift and scan the kanban card — no order typing",
      "Log stops and defects with reason; live OEE (A × P × Q) during the shift",
      "Call maintenance by team with one button",
      "Daily check-in, PPE and skills fit for each workstation",
      "LPA audits and scrap / problem reports printed as official FM- forms",
      "Shift approval locks the numbers — no editing afterwards"],
     ["Daily Report", "Check-in & PPE", "Layer Process Audit", "Scrap Report", "Problem report & bins", "Factory map / TV"],
     [("MTN", "Calls + repair order opened from the stop"), ("QA", "Suspect parts to yellow / red bins"),
      ("Store", "Closing an order requests child parts"), ("Mgmt", "OEE flows to OBEYA KPI")],
     ["OEE known during the shift, not at month-end", "No hand-written daily report or re-typing",
      "Scan instead of choosing from long lists", "Faster calls = less line waiting"],
     "ผลิตคือต้นทาง: บันทึกครั้งเดียวที่หน้างาน แล้วข้อมูลวิ่งไปทุกแผนก\n"
     "ตัวเลข ก.ย.: รายงานกะในระบบ 505 ใบ · downtime 3,792 รายการ · เช็คชื่อ 3,489 ครั้ง · กะที่ OEE พร้อมตอนปิดกะ 70% → 96% (ก.ค. → ก.ย.)\n"
     "เดโม: /daily-report เปิดกะ → ลง downtime → กดเรียกช่าง")

dept("Maintenance (MTN)", "From a phone call to a tracked repair order",
     ["Calls arrive on the right team's phone and Andon board — with siren",
      "Repair order (MO) opens straight from the machine stop",
      "Repairs start at once; approvals are signed afterwards on screen",
      "PM plans, due dates and check sheets — overdue shows red",
      "Spare parts used per MO; rank A / B / C automatically",
      "Technician KPI, MTTR / MTBF and QC 7 tools built in"],
     ["Repair orders (MO)", "MTN Andon board", "PM forecast & checks", "PM coordination", "Equipment & spares", "MTN analysis / QC7"],
     [("Prod", "Receives calls; told when the line can run"), ("QA", "Checks the repair before closing"),
      ("Store", "Spare-part stock and usage"), ("Plan", "Sees PM days ahead to build buffer")],
     ["Call acknowledged P80: 529 → 30 min", "No paper FM-MTN-006 / FM-JIG-008",
      "Everything on the phone at the machine", "Repair done P80: 7.9 h → 0.9 h"],
     "MTN คือแผนกที่เห็นผลชัดที่สุด\n"
     "วัดจริง ส.ค. → ก.ย.: เรียกช่างถึงรับเรื่อง (P80) 529 → 30 นาที · เครื่องหยุดถึงเปิด MO (ค่ากลาง) 7.7 → 3.2 นาที · เปิด MO ถึงซ่อมเสร็จ (P80) 7.9 → 0.9 ชม.\n"
     "ใบ MO ในระบบ ส.ค. 76 → ก.ย. 496 ใบ · ใบตรวจ PM 6 → 88 · แผน PM 147 แผน เลยกำหนดวันนี้ 1\n"
     "ข้อควรระวัง: ใบค้างรอ QA ยังเยอะ (205 ใบ) — ถ้าถูกถามให้ตอบตรงๆ")

dept("JIG & DIE", "Tooling history in one place instead of separate files",
     ["Registry of jigs and dies with QR labels",
      "Jig inspection points and photos per checkpoint",
      "Fixture shim record — customer requirement for sustainability",
      "Die status: ready / in repair / at the press",
      "Setup-time rules per press (die height, shut height)",
      "JIG / DIE team receives only its own calls"],
     ["Equipment center", "Jig registry & shim", "Die maintenance", "PM setup (jig checks)", "Repair orders (MO)"],
     [("Prod", "Calls JIG / DIE team directly"), ("MTN", "Same MO workflow, own team"),
      ("Plan", "Die setup time used in the plan"), ("QA", "Checks after jig repair")],
     ["Only the right team is alerted", "One registry — no separate Excel files",
      "Scan the tool to open its history", "Fewer wrong-team calls and walking"],
     "JIG/DIE ใช้ระบบเดียวกับ MTN แต่แยกทีม — ปุ่มเรียกช่างต้องเลือกทีม เด้งเฉพาะทีมนั้น (เดิมเรียกทั้ง 13 คนทุกทีม)\n"
     "สถานะจริง: ทะเบียนพร้อม · ใบตรวจจิ๊กและบันทึกชิมยังลงน้อย — พูดเป็น 'ระบบพร้อมใช้' ไม่ใช่ 'ใช้เต็มแล้ว'")

dept("Quality (QA)", "Quality decisions recorded where the parts are",
     ["Inspection sheets piece by piece — out-of-spec cannot be passed",
      "Yellow / red bin tags with age; QA decides scrap / repair / use-as-is",
      "4M change approval with Telegram alert at every step",
      "CQI-15 welding event log",
      "Test-part requisition FM-STO-003 replaces hand-written slips",
      "Suspect parts stay out of %Q until QA decides — numbers stay honest"],
     ["QA inspection", "Quality bins", "4M approval", "CQI-15 event log", "Test-part requisition"],
     [("Prod", "Bins and 4M come from the line"), ("MTN", "QA checks repairs before close"),
      ("Store", "Issues test parts to QA"), ("PE", "Defects link to PFMEA lines")],
     ["Bin age alerts before tags expire", "No re-writing 3 paper forms per problem",
      "Decide on screen at the bin", "Scrap counted once, at the right cost"],
     "QA: ระบบพร้อมครบ แต่การใช้งานยังน้อย (ผลตัดสินถัง = 0 · ใบตรวจล่าสุด ส.ค.)\n"
     "ตอนนำเสนอให้เน้นว่า 'ระบบรองรับอะไร' และยกเป็นเป้าเดือนหน้า — อย่าพูดว่าใช้เต็มแล้ว")

dept("Store", "From LINE chat requests to a tracked queue",
     ["Store board: WIP refill, child parts, raw material, purchase, FG",
      "Closing a production order explodes the BOM and requests parts by itself",
      "Scan the part (wrong part = blocked) and the delivery point QR",
      "Count before receiving; differences need a reason",
      "Manual stock adjustments wait for approval",
      "Store monitor: below min, over max, late rounds, short receipts"],
     ["Heijunka / store board", "Line stock & receipts", "Store monitor", "Flow tower", "Material requests"],
     [("Prod", "Line requests refill; closes orders"), ("Purch.", "Shortage creates purchase requests"),
      ("QA", "Issues test parts with approval"), ("Logist.", "FG receipts feed shipping")],
     ["Late rounds and short stock turn red", "No reading requests from chat groups",
      "Scan-to-pick, scan-to-deliver", "Less excess stock and fewer stock-outs"],
     "สโตร์: เดิมรับคำขอผ่าน LINE กลุ่ม (ทีมสโตร์เล่าเองว่า 'มั่วมาก')\n"
     "ตอนนี้ขาที่ระบบทำเองครบ (ระเบิด BOM ออกใบเอง) · ขาที่ต้องมีคนกด (รับใบ/บันทึกจ่าย) ยังต้องฝึกเพิ่ม\n"
     "รับเข้าคลังหลังปิดใบผลิต ค่ากลางยัง ~73 ชม. — ถ้าถูกถาม ตอบว่าโหมดนับก่อนรับเพิ่งเริ่ม 02/10")

dept("Logistic & Delivery", "Customer orders arrive by themselves; shipping cuts stock",
     ["EDI 830 / 862 attachments pulled from e-mail into a queue",
      "Customer call-off (e-SMART) overrides the plan as final quantity",
      "Shipping countdown in 4 phases; stock enough / short / none in colour",
      "'Shipped' cuts FG stock at once — failure turns red, never silent",
      "FG receipts from the line: count, then receive",
      "In-plant transport: drivers, shortest stop order, simulation"],
     ["Customer demand", "Planner & Sales (EDI)", "FG stock", "Transport", "Rundown stock"],
     [("Sales", "EDI and e-SMART feed demand"), ("Prod", "'No stock — must produce!' alert"),
      ("Store", "FG receipts from closed orders"), ("MTN", "Which shipments a breakdown hits")],
     ["Late shipments show red the day before", "No saving and dragging e-mail files",
      "One screen per shipping round", "Fewer premium freights from surprises"],
     "Logistic: เมล EDI เข้าคิวเองทุก 15 นาที (เดิมต้องเซฟไฟล์แนบแล้วลากเข้าเอง)\n"
     "ตัวเลขส่งตรงเวลา: ส.ค. 91% · ก.ย. 72% · ต.ค. 87% (6 วันแรก) — ผู้นำเสนอต้องเตรียมเหตุผลที่ ก.ย. ตก\n"
     "จุดที่ต้องปิด: ยังใช้บัญชีร่วม — ควรให้แต่ละคนมีบัญชีของตัวเอง")

dept("Planning & Sales", "Plans from real capacity, not from Excel",
     ["Production plan from real output (median of last 60 days)",
      "Tells how many shifts, which days need OT, night shift or holiday work",
      "Monitoring boards replace the 13-sheet daily Excel",
      "Kanban calculation from forecast with the company calendar",
      "Customer part numbers matched to MAT; unmatched ones are flagged",
      "Plan vs actual per part — over and off-plan shown, never hidden"],
     ["Production plan", "Monitoring boards", "Kanban calculation", "Planner & Sales", "Company calendar"],
     [("Sales", "Orders and forecast in"), ("Prod", "Plan = frame; the line confirms"),
      ("Store", "Kanban and lot size"), ("MTN", "PM days shown before planning")],
     ["Plan vs actual updates as the line closes", "No daily 13-sheet Excel",
      "Same screens as the Excel the team knows", "Right shifts and OT — not too many"],
     "Planning: เป้าคือเลิกทำ Excel Monitoring 13 ชีททุกวัน — จอ /monitoring หน้าตาเดียวกับ Excel ที่ทีมใช้\n"
     "สถานะจริง: ระบบพร้อม · การใช้แผนผลิต/คำนวณคัมบังยังน้อย — ยกเป็นเป้าเดือนหน้า")

dept("Engineering (PE) & NPI", "Process documents as one living data set",
     ["Process flow, PFMEA and control plan from one data set (by OP)",
      "Import existing Excel files; export in the original layout",
      "Central PFMEA library — system proposes, engineer decides",
      "Revisions linked to the claim, defect or repair that caused them",
      "NPI: APQP phases, PPAP elements, drawing revisions, tooling plan",
      "4M Method change linked to the engineering change"],
     ["PE documents (PFC / PFMEA / CP)", "PFMEA master", "NPI / APQP", "4M change", "Order trace"],
     [("QA", "Defects and 8D point to PFMEA lines"), ("Prod", "Control plan at the line"),
      ("MTN", "Repairs can trigger a revision"), ("Mgmt", "New-part status per customer")],
     ["Change once — flow, FMEA and CP stay in sync", "No 3 separate Excel files per part",
      "See every revision and why", "Fewer repeat claims via yokoten"],
     "PE: 3 ไฟล์ Excel (PFC/PFMEA/CP) กลายเป็นข้อมูลชุดเดียว มองได้ 3 มุม\n"
     "พาร์ทต้นแบบ P703 (สาย 060/061) ลงข้อมูลเต็มใบแล้ว ใช้เดโมได้\n"
     "สถานะจริง: เอกสารลงล่าสุด ส.ค. · คลัง PFMEA กลางรอ PE ยืนยัน 43 กระบวนการ")

dept("HR & Admin", "People, skills and the calendar every plan depends on",
     ["OJT training FM-HRM-004 with on-screen signatures",
      "Skills matrix and individual evaluation forms printed from data",
      "Daily check-in, OT and holiday transport booking",
      "Company calendar drives OT, kanban, plans, PM and LPA",
      "Workforce insight: daily manpower, station changes, turnover",
      "Monthly KPI packs exported in the HRM form layout"],
     ["OJT training", "Skills matrix / operator", "Workforce insight", "Company calendar", "Manpower board"],
     [("Prod", "Skills fit for each workstation"), ("All", "Calendar errors reach every plan"),
      ("Mgmt", "Manpower and turnover"), ("QSM", "KPI packs in the official form")],
     ["Manpower per line seen today", "No printing and signing paper packs",
      "Sign on the screen", "Less overtime planned by mistake"],
     "HR/ธุรการ: ปฏิทินบริษัทสำคัญมาก — ปฏิทินผิด = คัมบัง/แผนผลิต/PM/LPA ผิดหมดเงียบๆ (เคยเกิดจริง 28–29 ก.ย.)\n"
     "ใบ OJT ในระบบ: ส.ค. 12 · ก.ย. 6 ใบ")

dept("Management & OBEYA", "The whole factory on one wall — and on your phone",
     ["OBEYA KPI board and SQDCM — actual numbers come from the floor",
      "Factory map: every line's Andon colour on one screen",
      "TV dashboards per department, controlled from a phone",
      "Order trace: one number shows the whole history",
      "Action board: off-target → owner → due date",
      "'Program update' shows what changed each week"],
     ["OBEYA", "Factory map", "TV / department dashboards", "Order trace", "Program update"],
     [("All", "Every KPI comes from department records"), ("Prod", "Andon and OEE per line"),
      ("MTN", "Downtime cost and MTTR"), ("Plan", "Plan vs actual per part")],
     ["KPI updated as the floor records", "No printing KPI sheets for the wall",
      "One screen answers 'where are we?'", "Decide on facts, faster"],
     "ผู้บริหาร: บอร์ด OBEYA กระดาษบนผนังย้ายเข้าระบบ — ESM เป็นที่ผลิตตัวเลข Actual ไม่ได้ทำแข่งกับ KPI Online ของกลุ่ม\n"
     "สถานะจริง: Action board ยัง 0 รายการ — ขอให้ผู้บริหารใช้ตั้ง action จริงอย่างน้อย 5 รายการ\n"
     "/group-overview เป็นตัวอย่างจอ (mockup) — ต้องบอกทุกครั้ง")

# ══ 16 Section divider ════════════════════════════════════════════════
s = T.section_divider(p, "div_pd4.png", ["Why it", "matters"]); page[0] += 1
notes(s, "สรุปประโยชน์ 4 ข้อ พร้อมตัวเลขที่วัดได้จริง")

# ══ 17 Realtime ═══════════════════════════════════════════════════════
s = content("Real-time: everyone sees the same moment", "From 'we find out at month-end' to 'we see it during the shift'")
stat(s, 0.5, 1.75, 2.95, "529 → 30 min", "Call → acknowledged", "P80 · Aug → Sep")
stat(s, 3.62, 1.75, 2.95, "7.7 → 3.2 min", "Stop → repair order", "median · Aug → Sep")
stat(s, 6.74, 1.75, 2.95, "7.9 → 0.9 h", "Repair order → done", "P80 · Aug → Sep")
stat(s, 9.86, 1.75, 2.95, "70% → 96%", "Shifts with OEE at close", "Jul → Sep")
card(s, 0.5, 3.55, 6.1, 2.75, "WHAT UPDATES LIVE", [
    "Andon colour of every line — factory map and TV",
    "OEE, output and stops during the shift",
    "Maintenance Andon with siren per team",
    "Shipping rounds: enough / short / late",
], head_fill=ORANGE, sz=12.5)
card(s, 6.73, 3.55, 6.1, 2.75, "HOW PEOPLE ARE TOLD", [
    "Phone push and Telegram to the right team only",
    "Escalates by itself when nobody answers in 15 min",
    "'My queue' — what waits for me, in one place",
    "Morning summary per department",
], head_fill=ORANGE, sz=12.5)
T.text(s, 0.5, 6.4, 12.3, 0.35, [[(MEASURED, {"sz": 10, "i": True, "c": GREY})]])
notes(s, "Realtime: ตัวเลข 4 ตัวบนสุดวัดจากฐานข้อมูลจริง 06/10 (เรียกช่าง 279 ครั้ง · MO 294/456 ใบ · กะ 485 กะ)\n"
         "หลักคิด: ระบบไม่ได้ยิงแจ้งเตือนทุกคน — เด้งเฉพาะคนที่ต้องทำ ไม่งั้นคนจะเลิกดู")

# ══ 18 Less work ══════════════════════════════════════════════════════
s = content("Less work: paper and re-typing removed", "Records per month that used to be paper or Excel")
recs = [("Repair orders (MO)", "FM-MTN-006 / FM-JIG-008", "76", "496"),
        ("PM inspections", "Paper check sheets", "6", "88"),
        ("Downtime records", "Notebook / whiteboard", "3,688", "3,792"),
        ("Shift reports", "Paper daily report", "497", "505"),
        ("LPA audits", "FM-QMR-008", "289", "222"),
        ("Check-in records", "Attendance sheet", "2,897", "3,489")]
tbl = s.shapes.add_table(len(recs) + 1, 4, Inches(0.5), Inches(1.75), Inches(7.3), Inches(3.9)).table
for c, w in enumerate([2.4, 2.6, 1.15, 1.15]):
    tbl.columns[c].width = Inches(w)
for c, h in enumerate(["Record", "Replaces", "Aug", "Sep"]):
    cell = tbl.cell(0, c); cell.fill.solid(); cell.fill.fore_color.rgb = GREEN_D; cell.text = h
    r = cell.text_frame.paragraphs[0].runs[0]; r.font.size = Pt(13); r.font.bold = True; r.font.color.rgb = WHITE; r.font.name = T.FONT
for i, row in enumerate(recs, start=1):
    for c, v in enumerate(row):
        cell = tbl.cell(i, c); cell.fill.solid(); cell.fill.fore_color.rgb = GREEN_TINT if i % 2 == 0 else WHITE; cell.text = v
        para = cell.text_frame.paragraphs[0]
        if c >= 2: para.alignment = PP_ALIGN.RIGHT
        r = para.runs[0]; r.font.size = Pt(12); r.font.name = T.FONT
        r.font.bold = (c == 0 or c == 3); r.font.color.rgb = ORANGE if c == 3 else (GREEN_D if c == 0 else GREEN_M)
card(s, 8.0, 1.75, 4.83, 3.9, "THE SYSTEM DOES IT", [
    "Calculates OEE, MTTR, MTBF, PPM",
    "Works out PM due dates and kanban",
    "Opens follow-up orders (MO, parts, purchase)",
    "Prints official FM- forms with running numbers",
    "Exports monthly KPI packs",
], sz=12.5)
T.rect(s, 0.5, 5.8, 12.33, 0.55, fill=GREEN_TINT, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
T.text(s, 0.7, 5.8, 12.0, 0.55, [[("Record once at the line → no re-typing into Excel, no copying between departments.", {"sz": 13, "b": True, "c": GREEN_D})]], anchor=MSO_ANCHOR.MIDDLE)
notes(s, "ลดงาน: ตารางคือจำนวนบันทึกต่อเดือนที่เมื่อก่อนเป็นกระดาษ/Excel (วัด 06/10)\n"
         "MO 76 → 496 และ PM 6 → 88 คือแผนกที่ย้ายจากกระดาษมาเต็มตัวในเดือนเดียว\n"
         "LPA ก.ย. ลดลง (289 → 222) — ถ้าถูกถาม: เป็นจำนวนการตรวจ ไม่ใช่ปัญหาระบบ\n"
         "ขอให้แต่ละแผนกเติมว่า 'เมื่อก่อนใช้เวลากี่นาทีต่อวัน' ในเด็คโรดโชว์รายแผนก")

# ══ 19 Easy to use ════════════════════════════════════════════════════
s = content("Easy to use: built for the shopfloor", "Designed with the people who use it every day")
tiles = [("Scan, don't search", "QR labels on machines, jigs, parts and delivery points — scan to pick"),
         ("Thai screens, one login", "Same account for every department; menu shows only what you need"),
         ("Phone, PC or factory TV", "Tested on phone width and on the 2023 TV browsers at the lines"),
         ("Control the TV from a phone", "No keyboard needed at the board — pair with a 6-digit code"),
         ("'My queue'", "Everything waiting for me in one list — nothing to search for"),
         ("Mistakes caught early", "Wrong part blocked · time outside the shift warned · AM/PM swap fixed in one tap")]
for i, (h, t) in enumerate(tiles):
    r_, c_ = divmod(i, 3)
    x, y = 0.5 + c_ * 4.15, 1.75 + r_ * 2.3
    T.rect(s, x, y, 4.0, 2.12, fill=WHITE, line=PART, shape=MSO_SHAPE.ROUNDED_RECTANGLE, shadow=True)
    T.rect(s, x, y, 4.0, 0.12, fill=BLUE)
    T.text(s, x + 0.2, y + 0.28, 3.6, 0.5, [[(h, {"sz": 16, "b": True, "c": BLUE})]])
    T.text(s, x + 0.2, y + 0.85, 3.6, 1.2, [[(t, {"sz": 12.5, "c": GREEN_M})]])
notes(s, "ใช้ง่าย: ออกแบบจาก feedback หน้างาน เช่น สแกน QR แทนเลือกจาก dropdown ยาวๆ ตอนใส่ถุงมือ\n"
         "จอ TV หน้างานเป็นเบราว์เซอร์รุ่นเก่า (Chromium 94 บน webOS 2023) — ระบบทดสอบให้ผ่านทุกครั้งก่อนขึ้นใช้งาน\n"
         "ทุกหน้าถูกตรวจอัตโนมัติที่ความกว้างมือถือก่อน deploy")

# ══ 20 Lower cost ═════════════════════════════════════════════════════
s = content("Lower cost: where the savings come from", "Operational effects measured today — baht value to be calculated with Finance")
cost = [("No licence fees", "Built in-house by the plant team — no per-user or per-module licence", "In-house"),
        ("Hardware we already own", "Runs in a web browser on existing PCs, phones and line TVs", "Existing devices"),
        ("Less paper & printing", "Repair, PM, shift and LPA forms now digital", "~1,300 forms / month"),
        ("Less machine waiting", "Repair order → done, P80", "7.9 h → 0.9 h"),
        ("Less admin time", "No re-typing paper into Excel; KPI and forms generated", "Record once"),
        ("Low-cost cloud", "No server room; usage-based cloud with image and data limits", "Pay for use")]
for i, (h, t, big) in enumerate(cost):
    r_, c_ = divmod(i, 3)
    x, y = 0.5 + c_ * 4.15, 1.75 + r_ * 2.2
    T.rect(s, x, y, 4.0, 2.02, fill=WHITE, line=PART, shape=MSO_SHAPE.ROUNDED_RECTANGLE, shadow=True)
    T.rect(s, x, y, 0.12, 2.02, fill=PURPLE)
    T.text(s, x + 0.3, y + 0.15, 3.55, 0.5, [[(big, {"sz": 19 if len(big) <= 14 else 16, "b": True, "c": PURPLE})]])
    T.text(s, x + 0.3, y + 0.72, 3.55, 0.4, [[(h, {"sz": 14, "b": True, "c": GREEN_D})]])
    T.text(s, x + 0.3, y + 1.15, 3.55, 0.85, [[(t, {"sz": 11.5, "c": GREEN_M})]])
T.text(s, 0.5, 6.25, 12.3, 0.5, [[("Figures: " + MEASURED + " · ~1,300 = MO 496 + PM 88 + shift reports 505 + LPA 222 (Sep)", {"sz": 10, "i": True, "c": GREY})]])
notes(s, "ลดต้นทุน — สำคัญ: สไลด์นี้ไม่ใส่ตัวเลขเงินบาท เพราะยังไม่ได้คำนวณร่วมกับฝ่ายบัญชี (ห้ามเดาตัวเลขต่อหน้าผู้บริหาร)\n"
         "พูดได้: ไม่มีค่าไลเซนส์ (ทำเองในโรงงาน) · ใช้อุปกรณ์เดิม · กระดาษ ~1,300 ใบ/เดือนย้ายเข้าระบบ · เครื่องรอซ่อมสั้นลงชัดเจน\n"
         "ถ้าถูกถามตัวเลขเงิน: เสนอว่าจะคำนวณร่วมกับบัญชี เช่น ชั่วโมงเครื่องรอซ่อมที่ลดลง × ต้นทุนต่อชั่วโมงของไลน์")

# ══ 21 Next steps ═════════════════════════════════════════════════════
s = content("Next steps", "Deeper use at TSAT first — then a recipe for other plants")
for i, (h, t) in enumerate([
        ("Every department records daily", "QA bins, JIG / DIE status, PE documents and planning — from 'ready' to 'used'"),
        ("Managers act on the numbers", "Action board in OBEYA: at least 5 real actions per month with owner and date"),
        ("Clear the slow hand-offs", "Repair orders waiting for QA · stock receipts after closing orders"),
        ("Connect machines (later)", "SCADA signals as facts; people still give the reasons and the NG"),
        ("Roll out to other plants", "Same system, own data — start with Production + MTN, then add departments")]):
    yy = 1.7 + i * 0.95
    T.rect(s, 0.5, yy, 0.62, 0.62, fill=ORANGE, shape=MSO_SHAPE.OVAL)
    T.text(s, 0.5, yy, 0.62, 0.62, [[(str(i + 1), {"sz": 18, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    T.rect(s, 1.3, yy - 0.06, 11.53, 0.78, fill=GREEN_TINT, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    T.text(s, 1.5, yy - 0.06, 3.8, 0.78, [[(h, {"sz": 14, "b": True, "c": GREEN_D})]], anchor=MSO_ANCHOR.MIDDLE)
    T.text(s, 5.3, yy - 0.06, 7.4, 0.78, [[(t, {"sz": 12.5, "c": GREEN_M})]], anchor=MSO_ANCHOR.MIDDLE)
notes(s, "ก้าวต่อไป: (1) ทุกแผนกลงข้อมูลทุกวัน (2) ผู้บริหารใช้ตัวเลขตั้ง action จริง (3) แก้จุดส่งต่อที่ยังช้า — MO รอ QA 205 ใบ, รับเข้าคลัง ~73 ชม.\n"
         "(4) ต่อเครื่องจักร SCADA ภายหลัง — เครื่องบอกข้อเท็จจริง คนบอกเหตุผล (5) ขยายไปโรงงานอื่น เริ่มที่ผลิต + ซ่อมบำรุงก่อน\n"
         "สิ่งที่ยังไม่ได้ทำ ห้ามพูดว่าเสร็จ: ต่อ SAP/SCADA · ระบบหลายบริษัทจริง (/group-overview เป็นตัวอย่างจอ)")

# ══ 22 Closing ════════════════════════════════════════════════════════
s = T.blank(p)
T.rect(s, 0, 0, T.SW, T.SH, fill=GREEN_D)
T.text(s, 1.0, 2.35, 11.3, 0.9, [[("Record once. Everyone sees it. Live.", {"sz": 34, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
T.text(s, 1.0, 3.35, 11.3, 0.6, [[("Real-time  ·  Less work  ·  Easy to use  ·  Lower cost", {"sz": 20, "c": GOLD})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
T.text(s, 1.0, 4.4, 11.3, 0.8, [[("Thank you  ·  Q & A", {"sz": 28, "b": True, "c": GOLD})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
notes(s, "ปิด: บันทึกครั้งเดียว ทุกคนเห็น และเห็นทันที — ระบบไม่ได้ทำงานแทนคน แต่ทำให้ทุกแผนกส่งงานต่อกันเร็วขึ้นบนข้อมูลชุดเดียวกัน")

p.save(OUT)
print("saved", os.path.abspath(OUT), "slides:", len(p.slides))
