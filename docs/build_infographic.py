#!/usr/bin/env python3
"""ESM one-page infographic (A4 landscape) — Thai Summit Group theme · EN + TH

รัน:  python3 docs/build_infographic.py          → สร้างทั้ง 2 ภาษา
      python3 docs/build_infographic.py en       → เฉพาะอังกฤษ

กติกาธีม TSG (skill: tsg-presentation-theme)
  · Tahoma · 3 สีหลัก เขียว/ส้ม/กลาง · โลโก้ ST + THAI SUMMIT GROUP ที่ footer
  · เน้น infographic — ตัวหนังสือไม่เกิน ~40% ของพื้นที่
  · ธีมระบุให้เอกสารบริษัทเป็น "อังกฤษ" → ฉบับ EN คือตัวส่งลูกค้า
    ฉบับ TH ทำเพิ่มตามที่ user ขอ (ใช้ภายใน/อธิบายทีมงานไทย)

⚠️ กับดักภาษาไทยที่ต้องระวัง (แก้ไว้แล้วในไฟล์นี้ ห้ามถอด)
  1. `letter-spacing` ทำสระ/วรรณยุกต์ไทยลอยห่างจากพยัญชนะ → ฉบับ TH ตั้งเป็น 0 ทุกจุด
  2. ไทยไม่มีช่องว่างระหว่างคำ + วรรณยุกต์ซ้อนบน-ล่าง → line-height ต้อง ≥1.45 ไม่งั้นตัวบนโดนตัด
  3. ตัวอักษรไทยดู "เล็กกว่า" อังกฤษที่ pt เท่ากัน → ฉบับ TH ขยายฟอนต์เล็กน้อย
  4. ฟอนต์ถูกฝังลง PDF ตอน print → เครื่องปลายทางไม่ต้องมีฟอนต์ก็เห็นเหมือนกัน

⚠️ ทุกตัวเลขบนหน้านี้วัดจากฐานข้อมูลจริง (ดู STATS) — อัปเดตเลขแล้วรันสคริปต์ใหม่
   ห้ามแก้ .html/.pdf/.png ตรงๆ (รันครั้งถัดไปทับหาย)
"""
import pathlib, sys
from importlib.machinery import SourceFileLoader

HERE = pathlib.Path(__file__).parent
IMG = SourceFileLoader("_a", str(HERE / ".infographic_assets.py")).load_module().IMG

# ── ตัวเลขจริง ณ 2026-08-19 (นับจาก DB ทั้ง 2 project) ────────────────────
STATS = dict(
    shifts="822", orders="8,337", downtime="4,740", four_m="1,086",
    checkins="8,885", employees="202", lines="27", equipment="518",
    products="109", oee="79.3", fmea="898", forms="35", pages="57", roles="11",
)

# ─────────────────────────────────────────────────────────────────────────
#  เนื้อหา 2 ภาษา — แก้ข้อความที่นี่ที่เดียว
# ─────────────────────────────────────────────────────────────────────────
EN = dict(
    lang="en", file="ESM_Overview_Infographic_A4",
    title='ESM <span>&mdash;</span> Enterprise Shopfloor Management',
    subtitle="Thai Summit Automotive &middot; TSAT4 &nbsp;|&nbsp; One system from attendance to "
             "shipment &mdash; live since 18 Jun 2026",
    hero=[("{oee}%", "AVERAGE OEE"), ("{shifts}", "SHIFTS RECORDED"),
          ("{orders}", "PRODUCTION ORDERS"), ("{pages}", "SCREENS LIVE")],
    h_what="WHAT IT IS", h_loop="THE DAILY OPERATING LOOP", h_loop_sub="one shift, eight steps",
    h_use="IN USE TODAY", h_use_sub="2 months live", h_built="BUILT ON",
    h_trace="ONE ORDER, FULL TRACEABILITY", h_mods="MODULE MAP",
    h_mods_sub="{pages} screens &middot; 9 areas", h_std="ALIGNED TO", h_out="WHAT IT CHANGES",
    what="One shop-floor system in place of spreadsheets, paper forms and chat groups. Every shift "
         "is opened, run, checked and closed inside it &mdash; so <b>production, quality, "
         "maintenance and logistics read the same numbers at the same moment.</b>",
    photo_cap="Body-in-white welding &mdash; every station mapped in the system",
    ring_top="ONE SYSTEM", ring_mid="ESM",
    ring_sub=["every step feeds the next", "no re-typing, no side files"],
    loop=[("01", "SHIFT START",   ["attendance &middot; PPE", "skill-fit manning"]),
          ("02", "MORNING BRIEF", ["auto summary", "open actions"]),
          ("03", "PRODUCE",       ["kanban scan", "live OEE"]),
          ("04", "DETECT",        ["downtime &middot; defect", "andon &middot; escalate"]),
          ("05", "VERIFY",        ["AM &middot; poka-yoke", "LPA &middot; inspection"]),
          ("06", "CLOSE SHIFT",   ["supervisor approval", "OEE stamped"]),
          ("07", "ANALYSE",       ["OEE&middot;OOE&middot;TEEP", "6 losses &middot; 8 wastes"]),
          ("08", "IMPROVE",       ["kaizen before/after", "cost saving &middot; PFMEA"])],
    nums=[("{employees}", "operators tracked", 0), ("{lines}", "production lines", 0),
          ("{equipment}", "machines &amp; dies", 0), ("{products}", "part numbers", 0),
          ("{downtime}", "stop events logged", 1), ("{four_m}", "4M changes controlled", 1),
          ("{checkins}", "attendance + PPE records", 0), ("{fmea}", "PFMEA failure modes", 1)],
    built=[("Platform", "React 19 &middot; PostgreSQL &middot; realtime sync"),
           ("Devices", "Shop-floor TV &middot; tablet &middot; phone (installable)"),
           ("Alerts", "In-app &middot; push &middot; Telegram by topic"),
           ("Control", "{roles} roles &middot; {forms} forms &middot; full audit log")],
    mods=[("Overview", "&#128202;", ["Live plant map (colour by OEE / downtime / manpower)",
                                     "Department dashboards", "Executive &amp; group roll-up"]),
          ("Production", "&#127981;", ["Attendance &amp; PPE &middot; line manning by skill-fit",
                                       "Daily report &middot; shift close approval",
                                       "Production planning (OT / night / holiday)"]),
          ("Analytics", "&#128200;", ["OEE / OOE / TEEP &middot; true-OEE",
                                      "Root-cause engine (7 automatic findings)",
                                      "Order traceability &middot; Value Stream Map"]),
          ("People", "&#128101;", ["Skill matrix 0-100 &middot; auto EXP", "OJT training records",
                                   "Shift roster A/B/C"]),
          ("Logistics", "&#128230;", ["Store &amp; kanban pull &middot; rundown stock",
                                      "Delivery walk-back schedule",
                                      "Shortage alert &middot; route &amp; transport"]),
          ("Maintenance", "&#128295;", ["Work order 7 steps &middot; response / MTTR KPI",
                                        "AM / PM planning &amp; forecast",
                                        "Spare part rank A/B/C &middot; QR scan"]),
          ("Quality", "&#9989;", ["Inspection check sheet", "SPC / Cp-Cpk &middot; NCR &middot; CAPA-8D",
                                  "Scrap report &middot; CQI-15 log"]),
          ("Engineering", "&#128208;", ["Process flow &middot; PFMEA &middot; Control Plan",
                                        "Excel import / export", "Revision history by root cause"]),
          ("Master data", "&#9881;", ["Parts &middot; BOM &middot; routing",
                                      "Equipment &amp; die registry",
                                      "Document control &middot; role permission matrix"])],
    trace=[("Customer order", "EDI 862 / 830"), ("Production order", "kanban scan"),
           ("Machine &amp; die", "PM status that day"), ("Operator", "skill &middot; PPE &middot; station"),
           ("Material", "lot withdrawal"), ("In-process", "checks &middot; defects"),
           ("Finished goods", "stock ledger"), ("Shipment", "delivery round")],
    tnote="A customer concern is answered by searching one order number: <b>which shift and line, "
          "which machine and die, whether PM was overdue, who was at the station and their skill "
          "level, what 4M changed that day</b> &mdash; then matched back to the failure mode already "
          "listed in the PFMEA.",
    std=[("IATF 16949", "Process approach, competence records, change control"),
         ("CQI-15", "Welding event log with approval routing"),
         ("APQP / PPAP", "PFMEA &amp; Control Plan linked by operation no."),
         ("8D", "3-legged root cause from a real shift"),
         ("TPM", "AM by operators &middot; PM by technicians"),
         ("Lean", "6 big losses &middot; 8 wastes &middot; VSM &middot; kaizen")],
    out=[("Answer in seconds, not days",
          "&#8220;Which shift, which machine, who ran it, was PM overdue, what changed?&#8221; "
          "&mdash; one search on the order number."),
         ("Loss you can act on",
          "Every stop and defect is classified the moment it happens, then ranked by minutes and money."),
         ("Change control that holds",
          "Any Man / Machine / Material / Method change raises a 4M record needing supervisor + QA "
          "approval before it runs. {forms} controlled forms print from the system.")],
    strip=[("photo_press2500t", "2,500-ton press line", "stamping &middot; die shot counter feeds PM"),
           ("photo_robots", "Robot welding cells", "downtime by machine, straight from the floor"),
           ("photo_hotpress", "Hot-press forming", "cycle time drives the OEE performance rate")],
    motto="Before we build parts, we build people.",
    foot="ESM overview &middot; figures measured from the live system on 19 Aug 2026",
)

TH = dict(
    lang="th", file="ESM_Overview_Infographic_A4_TH",
    title='ESM <span>&mdash;</span> ระบบบริหารจัดการหน้างานผลิต',
    subtitle="ไทยซัมมิท ออโตโมทีฟ &middot; TSAT4 &nbsp;|&nbsp; ระบบเดียวตั้งแต่เช็คชื่อจนส่งของ "
             "&mdash; ใช้งานจริงตั้งแต่ 18 มิ.ย. 2569",
    hero=[("{oee}%", "OEE เฉลี่ย"), ("{shifts}", "กะที่บันทึกแล้ว"),
          ("{orders}", "ใบสั่งผลิต"), ("{pages}", "หน้าจอที่ใช้งาน")],
    h_what="ระบบนี้คืออะไร", h_loop="วงจรการทำงานประจำวัน", h_loop_sub="1 กะ 8 ขั้น",
    h_use="ใช้งานจริงแล้ววันนี้", h_use_sub="เปิดใช้มา 2 เดือน", h_built="สร้างบน",
    h_trace="1 ใบสั่งผลิต สอบกลับได้ทั้งสาย", h_mods="แผนที่โมดูล",
    h_mods_sub="{pages} หน้าจอ &middot; 9 หมวด", h_std="สอดคล้องมาตรฐาน", h_out="เปลี่ยนอะไรบ้าง",
    what="ระบบหน้างานระบบเดียว แทนไฟล์ Excel ใบกระดาษ และกลุ่มแชท ทุกกะถูกเปิด เดินงาน ตรวจ "
         "และปิดอยู่ในระบบนี้ &mdash; <b>ผลิต คุณภาพ ซ่อมบำรุง และคลัง จึงอ่านตัวเลขชุดเดียวกัน "
         "ในเวลาเดียวกัน</b>",
    photo_cap="ไลน์เชื่อมประกอบตัวถัง &mdash; ทุกจุดงานถูกวางไว้บนผังในระบบ",
    ring_top="ระบบเดียว", ring_mid="ESM",
    ring_sub=["ทุกขั้นส่งข้อมูลให้ขั้นถัดไป", "ไม่ต้องคีย์ซ้ำ ไม่มีไฟล์แยก"],
    loop=[("01", "เริ่มกะ",        ["เช็คชื่อ &middot; PPE", "จัดคนตามทักษะ"]),
          ("02", "ประชุมเช้า",     ["สรุปเมื่อวานอัตโนมัติ", "งานที่ยังค้าง"]),
          ("03", "ผลิต",           ["สแกนคัมบัง", "ดู OEE สด"]),
          ("04", "จับความผิดปกติ", ["เครื่องหยุด &middot; ของเสีย", "แจ้งเตือน &middot; เรียกช่าง"]),
          ("05", "ตรวจยืนยัน",     ["AM &middot; โพกะโยเกะ", "LPA &middot; ใบตรวจ"]),
          ("06", "ปิดกะ",          ["หัวหน้าส่วนอนุมัติ", "บันทึกค่า OEE"]),
          ("07", "วิเคราะห์",      ["OEE &middot; OOE &middot; TEEP", "6 ความสูญเสีย", "8 ความสูญเปล่า"]),
          ("08", "ปรับปรุง",       ["ไคเซ็นเทียบก่อน-หลัง", "คิดเป็นเงิน &middot; แก้ PFMEA"])],
    nums=[("{employees}", "พนักงานในระบบ", 0), ("{lines}", "ไลน์ผลิต", 0),
          ("{equipment}", "เครื่องจักร &amp; แม่พิมพ์", 0), ("{products}", "รหัสสินค้า", 0),
          ("{downtime}", "รายการเครื่องหยุด", 1), ("{four_m}", "การเปลี่ยนแปลง 4M", 1),
          ("{checkins}", "บันทึกเช็คชื่อ + PPE", 0), ("{fmea}", "หัวข้อ PFMEA", 1)],
    built=[("แพลตฟอร์ม", "React 19 &middot; PostgreSQL &middot; อัปเดตสด"),
           ("อุปกรณ์", "จอ TV หน้าไลน์ &middot; แท็บเล็ต &middot; มือถือ (ติดตั้งเป็นแอปได้)"),
           ("แจ้งเตือน", "ในแอป &middot; เด้งมือถือ &middot; Telegram แยกตามเรื่อง"),
           ("การควบคุม", "{roles} ระดับสิทธิ์ &middot; {forms} ฟอร์มควบคุม &middot; ประวัติการแก้ไขครบ")],
    mods=[("ภาพรวม", "&#128202;", ["ผังโรงงานสด (สีตาม OEE / หยุด / คน)",
                                    "แดชบอร์ดรายส่วนงาน", "ภาพรวมผู้บริหาร &amp; กลุ่มบริษัท"]),
          ("ฝ่ายผลิต", "&#127981;", ["เช็คชื่อ &amp; PPE · จัดคนตามทักษะ",
                                      "รายงานประจำวัน · ขออนุมัติปิดกะ",
                                      "วางแผนผลิต (OT / กะดึก / วันหยุด)"]),
          ("วิเคราะห์", "&#128200;", ["OEE / OOE / TEEP &middot; OEE จริง",
                                       "วิเคราะห์สาเหตุอัตโนมัติ 7 เรื่อง",
                                       "สอบกลับใบสั่งผลิต · ผัง VSM"]),
          ("พนักงาน", "&#128101;", ["ตารางทักษะ 0-100 · สะสมอัตโนมัติ", "บันทึกอบรม OJT",
                                     "ตารางกะ A/B/C"]),
          ("คลัง &amp; จัดส่ง", "&#128230;", ["สโตร์ &amp; ระบบดึงคัมบัง · ยอดคงเหลือ",
                                               "ตารางเตรียมของก่อนถึงรอบส่ง",
                                               "เตือนของขาด · เส้นทาง &amp; ขนส่ง"]),
          ("ซ่อมบำรุง", "&#128295;", ["ใบแจ้งซ่อม 7 ขั้น · KPI เวลาตอบสนอง",
                                        "วางแผน AM / PM ล่วงหน้า",
                                        "จัดชั้นอะไหล่ A/B/C &middot; สแกน QR"]),
          ("คุณภาพ", "&#9989;", ["ใบตรวจชิ้นงาน", "SPC / Cp-Cpk &middot; NCR &middot; CAPA-8D",
                                  "ใบรายงานของเสีย &middot; บันทึก CQI-15"]),
          ("วิศวกรรม", "&#128208;", ["ผังกระบวนการ &middot; PFMEA &middot; แผนควบคุม",
                                      "นำเข้า / ส่งออก Excel", "ประวัติแก้ไขพร้อมต้นเหตุ"]),
          ("ข้อมูลหลัก", "&#9881;", ["พาร์ท &middot; BOM &middot; ลำดับกระบวนการ",
                                      "ทะเบียนเครื่องจักร &amp; แม่พิมพ์",
                                      "ควบคุมเอกสาร · ตารางสิทธิ์ผู้ใช้"])],
    trace=[("ออเดอร์ลูกค้า", "EDI 862 / 830"), ("ใบสั่งผลิต", "สแกนคัมบัง"),
           ("เครื่อง &amp; แม่พิมพ์", "สถานะ PM วันนั้น"), ("พนักงาน", "ทักษะ &middot; PPE &middot; จุดงาน"),
           ("วัตถุดิบ", "ใบเบิกล็อต"), ("ระหว่างผลิต", "ผลตรวจ &middot; ของเสีย"),
           ("สินค้าสำเร็จ", "บัญชีคลัง"), ("การจัดส่ง", "รอบส่ง")],
    tnote="ลูกค้าเคลมมา ค้นด้วยเลขใบสั่งผลิตใบเดียว ก็รู้ทันทีว่า <b>กะไหน ไลน์ไหน เครื่องและแม่พิมพ์ตัวใด "
          "PM ค้างอยู่หรือเปล่า ใครยืนจุดนั้น ทักษะระดับไหน และวันนั้นมีการเปลี่ยนแปลง 4M อะไรบ้าง</b> "
          "&mdash; แล้วโยงกลับไปยังหัวข้อความเสี่ยงที่เคยระบุไว้ใน PFMEA",
    std=[("IATF 16949", "เชิงกระบวนการ · บันทึกความสามารถ · คุมการเปลี่ยนแปลง"),
         ("CQI-15", "บันทึกเหตุการณ์งานเชื่อมพร้อมสายอนุมัติ"),
         ("APQP / PPAP", "PFMEA และแผนควบคุม ผูกด้วยเลขกระบวนการ"),
         ("8D", "หาสาเหตุราก 3 ขา จากกะจริง"),
         ("TPM", "AM พนักงานตรวจเอง &middot; PM ช่างตรวจตามรอบ"),
         ("Lean", "6 ความสูญเสีย &middot; 8 ความสูญเปล่า &middot; VSM &middot; ไคเซ็น")],
    out=[("ตอบได้ในไม่กี่วินาที ไม่ใช่หลายวัน",
          "&#8220;กะไหน เครื่องไหน ใครเดินเครื่อง PM ค้างมั้ย เปลี่ยนอะไรไป&#8221; "
          "&mdash; ค้นครั้งเดียวด้วยเลขใบสั่งผลิต"),
         ("ความสูญเสียที่ลงมือแก้ได้จริง",
          "ทุกการหยุดและของเสียถูกจัดประเภททันทีที่เกิด แล้วเรียงตามนาทีและตามเงิน"),
         ("ควบคุมการเปลี่ยนแปลงได้จริง",
          "เปลี่ยน คน / เครื่อง / วัตถุดิบ / วิธีการ ต้องเปิดใบ 4M ผ่านหัวหน้าส่วนและ QA "
          "ก่อนเดินงาน · {forms} ฟอร์มควบคุมพิมพ์จากระบบได้เลย")],
    strip=[("photo_press2500t", "ไลน์เพรส 2,500 ตัน", "งานปั๊ม &middot; ตัวนับ shot ส่งต่อให้แผน PM"),
           ("photo_robots", "เซลล์หุ่นยนต์เชื่อม", "เครื่องหยุดถูกบันทึกรายเครื่องจากหน้างานจริง"),
           ("photo_hotpress", "งานขึ้นรูปร้อน", "รอบเวลาผลิตเป็นตัวกำหนดค่า P ใน OEE")],
    motto="ก่อนสร้างชิ้นงาน เราสร้างคนก่อน",
    foot="ภาพรวมระบบ ESM &middot; ตัวเลขวัดจากระบบที่ใช้งานจริง ณ 19 ส.ค. 2569",
)


def loop_ring(L, th):
    """วงแหวน 8 ขั้น (SVG ล้วน พิมพ์คมทุก dpi)

    ⚠️ ป้ายกำกับวางนอกวง → viewBox ต้องกว้างกว่าเส้นผ่านศูนย์กลางมาก
       ไม่งั้นข้อความซ้าย-ขวาโดนตัด (เคยพลาดมาแล้ว)
    """
    import math
    W, H = (516.0, 372.0) if th else (482.0, 372.0)   # ไทยป้ายยาวกว่า ต้องเผื่อกว้างขึ้น
    cx, cy = W / 2, H / 2
    r_out, r_in = 118.0, 76.0
    n = len(L["loop"])
    seg, gap = 360.0 / n, 2.6
    ff = '"Noto Sans Thai","Sarabun",Tahoma,sans-serif' if th else "Tahoma,sans-serif"
    ls = "0" if th else "2px"          # ⚠️ letter-spacing ทำวรรณยุกต์ไทยลอย
    parts = []
    for i, (num, title, desc) in enumerate(L["loop"]):
        a0, a1 = -90 + i * seg + gap / 2, -90 + (i + 1) * seg - gap / 2
        rad = math.radians
        x0o, y0o = cx + r_out * math.cos(rad(a0)), cy + r_out * math.sin(rad(a0))
        x1o, y1o = cx + r_out * math.cos(rad(a1)), cy + r_out * math.sin(rad(a1))
        x1i, y1i = cx + r_in * math.cos(rad(a1)), cy + r_in * math.sin(rad(a1))
        x0i, y0i = cx + r_in * math.cos(rad(a0)), cy + r_in * math.sin(rad(a0))
        d = (f"M{x0o:.1f},{y0o:.1f} A{r_out},{r_out} 0 0 1 {x1o:.1f},{y1o:.1f} "
             f"L{x1i:.1f},{y1i:.1f} A{r_in},{r_in} 0 0 0 {x0i:.1f},{y0i:.1f} Z")
        # 07-08 = ผลลัพธ์ที่ย้อนกลับเข้าการผลิต ทำสีส้มให้เห็นว่าเป็นวงปิด
        fill = "#C0561E" if i >= 6 else ("#0D3D14" if i % 2 == 0 else "#2C5F2D")
        am = math.radians(-90 + (i + 0.5) * seg)
        tx, ty = cx + 97 * math.cos(am), cy + 97 * math.sin(am)
        parts.append(f'<path d="{d}" fill="{fill}"/>')
        parts.append(f'<text x="{tx:.1f}" y="{ty:.1f}" class="rn">{num}</text>')

        lx, ly = cx + 130 * math.cos(am), cy + 130 * math.sin(am)
        c = math.cos(am)
        anchor = "start" if c > 0.15 else ("end" if c < -0.15 else "middle")
        lx += 5 if anchor == "start" else (-5 if anchor == "end" else 0)
        step = 12.5 if th else 10.5
        y0 = ly - (0.5 * len(desc) * step) + (2 if anchor == "middle" else 0)
        t = [f'<text x="{lx:.1f}" y="{y0:.1f}" text-anchor="{anchor}" class="rt">{title}</text>']
        for k, ln in enumerate(desc):
            t.append(f'<text x="{lx:.1f}" y="{y0 + 13 + k * step:.1f}" '
                     f'text-anchor="{anchor}" class="rd">{ln}</text>')
        parts.append("".join(t))

    arrow = (f'<path d="M{cx+r_in-9:.0f},{cy-3:.0f} l7,5 -7,5 z" fill="#C0561E" '
             f'transform="rotate(-38 {cx} {cy})"/>')
    sub = "".join(f'<text x="{cx}" y="{cy + 27 + k * 13:.0f}" class="cm">{s}</text>'
                  for k, s in enumerate(L["ring_sub"]))
    return f'''<svg viewBox="0 0 {W:.0f} {H:.0f}" class="ring">
  <defs><style>
    .rn{{font:700 14px {ff};fill:#fff;text-anchor:middle;dominant-baseline:central}}
    .rt{{font:700 {12.5 if th else 11.5}px {ff};fill:#0D3D14}}
    .rd{{font:400 {9.8 if th else 9.2}px {ff};fill:#5a6b5d}}
    .cc{{font:700 30px {ff};fill:#0D3D14;text-anchor:middle}}
    .cs{{font:700 {10.5 if th else 9.5}px {ff};fill:#C0561E;text-anchor:middle;letter-spacing:{ls}}}
    .cm{{font:400 {9.6 if th else 9}px {ff};fill:#5a6b5d;text-anchor:middle}}
  </style></defs>
  {"".join(parts)}
  <circle cx="{cx}" cy="{cy}" r="{r_in-4}" fill="#fff" stroke="#D8E4D0" stroke-width="1.4"/>
  <text x="{cx}" y="{cy-22}" class="cs">{L["ring_top"]}</text>
  <text x="{cx}" y="{cy+8}" class="cc">{L["ring_mid"]}</text>
  {sub}
  {arrow}
</svg>'''


def css(th):
    f = '"Noto Sans Thai","Sarabun",Tahoma,sans-serif' if th else 'Tahoma,"Noto Sans Thai",sans-serif'
    # ⚠️ ไทย: letter-spacing = 0 (สระ/วรรณยุกต์ลอย) · line-height สูงขึ้น (ตัวบน-ล่างโดนตัด)
    ls_h2, ls_hero, lh = ("0", "0", 1.5) if th else ("1.5px", ".3px", 1.35)
    bump = 0.45 if th else 0     # ไทยดูเล็กกว่าอังกฤษที่ pt เท่ากัน
    def p(x): return f"{x + bump:.2f}pt"
    return f"""
@page{{size:297mm 210mm;margin:0}}
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{width:297mm;height:210mm}}
body{{font-family:{f};color:#1b2a1e;background:#fff;
 -webkit-print-color-adjust:exact;print-color-adjust:exact}}
.page{{width:297mm;height:210mm;display:flex;flex-direction:column;overflow:hidden;position:relative}}

.hd{{height:21mm;background:linear-gradient(100deg,#0D3D14 0%,#164D1D 58%,#0D3D14 100%);
 color:#fff;display:flex;align-items:center;padding:0 7mm;gap:5mm;position:relative;flex:0 0 21mm}}
.hd::after{{content:"";position:absolute;left:0;right:0;bottom:0;height:1.1mm;background:#C0561E}}
.hd .lg{{width:16mm;height:14mm;background:var(--ts) center/contain no-repeat;flex:0 0 16mm}}
.hd .ttl{{font-size:{p(18.4)};font-weight:700;letter-spacing:{ls_hero};line-height:1.15}}
.hd .ttl span{{color:#EBD9B0}}
.hd .sub{{font-size:{p(7.7)};color:#CFE0C8;margin-top:1.2mm;line-height:1.35}}
.hero{{margin-left:auto;display:flex;gap:4.6mm;align-items:center}}
.hero div{{text-align:right}}
.hero b{{display:block;font-size:{p(15)};color:#FD8342;line-height:1}}
.hero span{{display:block;font-size:{p(6.5)};color:#CFE0C8;margin-top:.7mm;letter-spacing:{ls_hero}}}

.bd{{flex:0 0 153mm;display:grid;grid-template-columns:60mm 116mm 1fr;gap:4mm;
 padding:3.4mm 7mm 0;min-height:0;overflow:hidden}}
.col{{display:flex;flex-direction:column;gap:3mm;min-height:0}}
h2{{font-size:{p(9)};color:#0D3D14;letter-spacing:{ls_h2};border-bottom:1.4pt solid #C0561E;
 padding-bottom:1mm;margin-bottom:1.6mm;flex:0 0 auto;line-height:1.3}}
h2 small{{float:right;font-size:{p(6.5)};color:#C0561E;letter-spacing:0;font-weight:400;padding-top:.9mm}}

.what{{font-size:{p(7.3)};line-height:{lh + .1};color:#2f4033}}
.what b{{color:#0D3D14}}
.photo{{position:relative;border-radius:1.6mm;overflow:hidden;flex:0 0 auto}}
.photo img{{width:100%;height:21mm;object-fit:cover;display:block}}
.photo .cap{{position:absolute;left:0;right:0;bottom:0;
 background:linear-gradient(transparent,rgba(13,61,20,.93));
 color:#fff;font-size:{p(6.3)};padding:4mm 2mm 1.4mm;line-height:1.35}}
.nums{{display:grid;grid-template-columns:1fr 1fr;gap:1.4mm}}
.nums div{{background:#ECF1E9;border-left:1.1mm solid #2C5F2D;border-radius:0 1mm 1mm 0;padding:1.1mm 1.6mm}}
.nums b{{display:block;font-size:{p(10.2)};color:#0D3D14;line-height:1}}
.nums span{{display:block;font-size:{p(6.1)};color:#555;margin-top:.5mm;line-height:1.3}}
.nums div.o{{border-left-color:#C0561E}} .nums div.o b{{color:#C0561E}}
.stack{{display:flex;flex-direction:column;gap:1.2mm}}
.srow{{display:flex;gap:1.6mm;align-items:baseline;font-size:{p(6.6)};color:#2f4033;
 border-bottom:.3pt dotted #cfd8cc;padding-bottom:.7mm;line-height:{lh}}}
.srow b{{color:#0D3D14;flex:0 0 {17 if th else 15}mm}}

.ringwrap{{flex:1;display:flex;align-items:center;justify-content:center;min-height:0;margin:-2mm -6mm 0}}
.ring{{width:100%;height:100%}}
.trace{{display:flex;align-items:stretch;gap:.7mm;margin-top:.6mm}}
.tc{{flex:1;background:#fff;border:.4pt solid #D8E4D0;border-top:1mm solid #2C5F2D;border-radius:.8mm;
 padding:1.3mm .6mm;text-align:center;display:flex;flex-direction:column;justify-content:center}}
.tc b{{display:block;font-size:{p(6)};color:#0D3D14;line-height:1.25}}
.tc span{{display:block;font-size:{p(5.3)};color:#777;margin-top:.5mm;line-height:1.2}}
.tarr{{align-self:center;color:#C0561E;font-size:7pt;line-height:1}}
.tnote{{margin-top:1.6mm;background:#0D3D14;color:#fff;border-radius:1mm;padding:1.7mm 2.4mm;
 font-size:{p(6.7)};line-height:{lh + .1}}}
.tnote b{{color:#FD8342}}

.mods{{display:grid;grid-template-columns:1fr 1fr;gap:1.3mm}}
.mod{{border:.4pt solid #D8E4D0;border-radius:1mm;padding:1.1mm 1.4mm;background:#fff}}
.mod h3{{font-size:{p(6.9)};color:#0D3D14;display:flex;align-items:center;gap:1.2mm;margin-bottom:.9mm;
 line-height:1.25}}
.mod h3 i{{font-style:normal;font-size:{p(7.3)}}}
.mod ul{{list-style:none}}
.mod.wide{{grid-column:1/-1}} .mod.wide ul{{columns:2;column-gap:3mm}}
.mod li{{font-size:{p(5.7)};color:#4a5a4d;line-height:{lh};padding-left:1.9mm;position:relative;
 margin-bottom:.2mm}}
.mod li::before{{content:"";position:absolute;left:.5mm;top:1.4mm;width:.9mm;height:.9mm;
 border-radius:50%;background:#C0561E}}
.two{{display:grid;grid-template-columns:1fr 1fr;gap:3mm;flex:1;min-height:0}}
.std div{{display:flex;gap:1.4mm;font-size:{p(6)};line-height:{lh};margin-bottom:.85mm;align-items:baseline}}
.std b{{flex:0 0 {17 if th else 15}mm;color:#C0561E;font-size:{p(6.2)}}}
.std span{{color:#4a5a4d}}
.out div{{margin-bottom:1.2mm}}
.out b{{display:block;font-size:{p(6.6)};color:#0D3D14;margin-bottom:.3mm;line-height:1.3}}
.out span{{display:block;font-size:{p(5.8)};color:#4a5a4d;line-height:{lh}}}

.strip{{flex:0 0 19mm;display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:15mm;
 gap:2mm;padding:2mm 7mm 2mm}}
.sp{{position:relative;border-radius:1.2mm;overflow:hidden;height:15mm}}
.sp img{{width:100%;height:100%;object-fit:cover;display:block}}
.sp .ov{{position:absolute;inset:0;
 background:linear-gradient(90deg,rgba(13,61,20,.88) 0%,rgba(13,61,20,.55) 46%,rgba(13,61,20,0) 74%);
 display:flex;flex-direction:column;justify-content:center;padding:0 2.6mm}}
.sp b{{font-size:{p(6.9)};color:#fff;line-height:1.2}}
.sp span{{font-size:{p(5.7)};color:#CFE0C8;margin-top:.5mm;line-height:1.3;max-width:46mm}}

.ft{{height:8.5mm;flex:0 0 8.5mm;display:flex;align-items:center;padding:0 7mm;gap:2mm;
 border-top:.5pt solid #D8E4D0}}
.ft .lg{{width:6mm;height:5mm;background:var(--tsf) center/contain no-repeat;flex:0 0 6mm}}
.ft .wm{{font-size:{p(7.8)};font-weight:700;color:#0D3D14;letter-spacing:{ls_hero}}}
.ft .mid{{margin-left:auto;font-size:{p(6.1)};color:#555;text-align:right;line-height:1.4}}
.ft .mid b{{color:#0D3D14}}
"""


def build(L):
    th = L["lang"] == "th"
    S = STATS
    fx = lambda s: s.format(**S)          # เติมตัวเลขจริงลงข้อความ

    hero = "".join(f"<div><b>{fx(v)}</b><span>{fx(k)}</span></div>" for v, k in L["hero"])
    nums = "".join(f'<div class="{"o" if o else ""}"><b>{fx(v)}</b><span>{fx(k)}</span></div>'
                   for v, k, o in L["nums"])
    stack = "".join(f'<div class="srow"><b>{a}</b><span>{fx(b)}</span></div>' for a, b in L["built"])
    mods = "".join(
        f'<div class="mod{" wide" if i == len(L["mods"]) - 1 else ""}">'
        f'<h3><i>{ic}</i>{name}</h3><ul>' + "".join(f"<li>{x}</li>" for x in items) + "</ul></div>"
        for i, (name, ic, items) in enumerate(L["mods"]))
    trace = ""
    for i, (a, b) in enumerate(L["trace"]):
        trace += f'<div class="tc"><b>{a}</b><span>{b}</span></div>'
        if i < len(L["trace"]) - 1:
            trace += '<div class="tarr">&#9656;</div>'
    std = "".join(f"<div><b>{a}</b><span>{b}</span></div>" for a, b in L["std"])
    out = "".join(f"<div><b>{a}</b><span>{fx(b)}</span></div>" for a, b in L["out"])
    strip = "".join(f'<div class="sp"><img src="data:image/jpeg;base64,{IMG[k]}" alt="">'
                    f'<div class="ov"><b>{t}</b><span>{c}</span></div></div>'
                    for k, t, c in L["strip"])

    return f"""<!doctype html>
<html lang="{L['lang']}"><head><meta charset="utf-8">
<title>ESM &mdash; {L['h_what']} | Thai Summit Group</title>
<style>:root{{--ts:url("data:image/png;base64,{IMG['logo_big']}");
--tsf:url("data:image/png;base64,{IMG['logo_footer']}")}}{css(th)}</style></head>
<body><div class="page">

  <header class="hd">
    <i class="lg"></i>
    <div>
      <div class="ttl">{L['title']}</div>
      <div class="sub">{L['subtitle']}</div>
    </div>
    <div class="hero">{hero}</div>
  </header>

  <div class="bd">
    <section class="col">
      <div><h2>{L['h_what']}</h2><p class="what">{L['what']}</p></div>
      <div class="photo">
        <img src="data:image/jpeg;base64,{IMG['photo_robots']}" alt="">
        <div class="cap">{L['photo_cap']}</div>
      </div>
      <div><h2>{L['h_use']}<small>{L['h_use_sub']}</small></h2><div class="nums">{nums}</div></div>
      <div><h2>{L['h_built']}</h2><div class="stack">{stack}</div></div>
    </section>

    <section class="col">
      <div style="display:flex;flex-direction:column;flex:1;min-height:0">
        <h2>{L['h_loop']}<small>{L['h_loop_sub']}</small></h2>
        <div class="ringwrap">{loop_ring(L, th)}</div>
      </div>
      <div>
        <h2>{L['h_trace']}</h2>
        <div class="trace">{trace}</div>
        <div class="tnote">{L['tnote']}</div>
      </div>
    </section>

    <section class="col">
      <div><h2>{L['h_mods']}<small>{fx(L['h_mods_sub'])}</small></h2><div class="mods">{mods}</div></div>
      <div class="two">
        <div><h2>{L['h_std']}</h2><div class="std">{std}</div></div>
        <div><h2>{L['h_out']}</h2><div class="out">{out}</div></div>
      </div>
    </section>
  </div>

  <div class="strip">{strip}</div>

  <footer class="ft">
    <i class="lg"></i>
    <span class="wm">THAI SUMMIT GROUP</span>
    <span class="mid"><b>{L['motto']}</b><br>{L['foot']}</span>
  </footer>

</div></body></html>
"""


if __name__ == "__main__":
    want = sys.argv[1].lower() if len(sys.argv) > 1 else "all"
    for L in [EN, TH]:
        if want not in ("all", L["lang"]):
            continue
        p = HERE / f"{L['file']}.html"
        p.write_text(build(L), encoding="utf-8")
        print(f"✓ {p.name}  ({p.stat().st_size/1024:.0f} KB)")
