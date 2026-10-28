# -*- coding: utf-8 -*-
"""เช็คลิสต์ deploy ESM ให้โรงงานใหม่ (ฐานข้อมูลแยก) — ธีม TSG R01 · ภาษาไทย
Run:  python3 build_new_factory_deploy.py  →  ../ESM_New_Factory_Deploy_Checklist_2026-10-28.pptx
ตัวเลขนับจากรีโปวันที่ 28/10/2026: migration 707 ไฟล์ (ติดป้าย _main/_dr แค่บางส่วน) · edge function 24 ·
storage bucket 15 · URL project ฝังตายในโค้ด 6 จุด (Checkin/DailyReport/MtnRepair/PMCheckData/PMSchedule + DR fallback)
"""
import os
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
import tsg_theme as T
from tsg_theme import GREEN, GREEN_D, GREEN_TINT, BORDER, ORANGE, AMBER, GREY, WHITE

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "ESM_New_Factory_Deploy_Checklist_2026-10-28.pptx")
p = T.new_pres()
page = [1]


def content(title, sub=None):
    s = T.blank(p); page[0] += 1
    T.head(s, title, sub)
    T.footer(s, page[0])
    return s


def box(s, x, y, w, h, head, lines, fill=GREEN_D, sz=13):
    T.rect(s, x, y, w, h, fill=WHITE, line=BORDER, shape=MSO_SHAPE.ROUNDED_RECTANGLE, shadow=True)
    T.rect(s, x, y, w, 0.46, fill=fill)
    T.text(s, x, y, w, 0.46, [[(head, {"sz": T.fit_one_line(head, w - 0.2, 15, 11), "b": True, "c": WHITE})]],
           align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    T.text(s, x + 0.15, y + 0.58, w - 0.3, h - 0.65, [[("☐  " + l, {"sz": sz, "c": GREEN})] for l in lines], sa=6)


def table(s, x, y, widths, rows, sz=12, rh=0.40, head_sz=13):
    """rows[0] = หัวตาราง (พื้นเขียวเข้ม) · แถวสลับ GREEN_TINT"""
    yy = y
    for i, r in enumerate(rows):
        xx = x
        hd = i == 0
        fill = GREEN_D if hd else (GREEN_TINT if i % 2 == 0 else WHITE)
        for j, (cell, w) in enumerate(zip(r, widths)):
            T.rect(s, xx, yy, w, rh, fill=fill, line=BORDER, lw=0.5)
            c = WHITE if hd else (ORANGE if j == 0 else GREEN)
            T.text(s, xx + 0.06, yy, w - 0.12, rh, [[(cell, {"sz": head_sz if hd else sz, "b": hd or j == 0, "c": c})]],
                   anchor=MSO_ANCHOR.MIDDLE)
            xx += w
        yy += rh
    return yy


# ── 1 ปก ──
T.title_slide(p, "เช็คลิสต์ Deploy ESM ให้โรงงานใหม่",
              "ระบบชุดใหม่ · ผู้ใช้ชุดใหม่ · ฐานข้อมูลแยกขาดจาก TSAT",
              "Enterprise Shopfloor Management (ESM)", "Thai Summit Group · 28 ต.ค. 2569")

# ── 2 Agenda ──
T.agenda_slide(p, 2, "หัวข้อ", "ต้องเตรียมอะไร และต้องเตรียมข้อมูลอะไรบ้าง", [
    ("ภาพรวมสิ่งที่ต้องสร้างใหม่", "เว็บ 1 ชุด + Supabase 2 โปรเจค + ตัวแจ้งเตือน"),
    ("เตรียมโครงสร้างพื้นฐาน + บัญชี", "Supabase · Hosting · Domain · GitHub · Telegram"),
    ("เตรียมฐานข้อมูล + โค้ดที่ต้องแก้ก่อน", "schema · RLS · edge function · ค่าที่ฝังไว้ในโค้ด"),
    ("ข้อมูลที่โรงงานใหม่ต้องเตรียม", "ทะเบียนหลัก — เรียงตามลำดับที่ต้องลงก่อน-หลัง"),
    ("ข้อควรระวัง + แผนงาน 5 สัปดาห์", "สิ่งที่ห้ามทำ · ลำดับขึ้นระบบ · ผู้รับผิดชอบ"),
])
page[0] = 2

# ── 3 ภาพรวม ──
s = content("ภาพรวม — ต้องสร้างอะไรใหม่บ้าง", "ต่อ 1 โรงงาน = 1 ชุดเต็ม แยกขาดจากชุด TSAT (ไม่แชร์ข้อมูล ไม่แชร์ผู้ใช้)")
items = [
    ("🌐 เว็บแอป", ["build จาก repo เดียวกัน", "ตั้ง env ชี้ฐานข้อมูลใหม่", "Render หรือ server บริษัท"]),
    ("🗄️ Supabase MAIN", ["ผู้ใช้ / login / สิทธิ์", "พนักงาน · ไลน์ · ผังองค์กร", "4M · CQI-15 · KPI"]),
    ("🏭 Supabase DR", ["ข้อมูลผลิตรายกะ", "เครื่อง · แม่พิมพ์ · พาร์ท", "downtime · ของเสีย · PM"]),
    ("🔔 แจ้งเตือน", ["edge function 24 ตัว", "งานตั้งเวลา (pg_cron)", "Telegram bot (ถ้าใช้)"]),
]
for i, (h, ls) in enumerate(items):
    x = 0.5 + i * 3.12
    T.rect(s, x, 1.8, 2.9, 3.0, fill=WHITE, line=BORDER, shape=MSO_SHAPE.ROUNDED_RECTANGLE, shadow=True)
    T.rect(s, x, 1.8, 2.9, 0.55, fill=GREEN_D)
    T.text(s, x, 1.8, 2.9, 0.55, [[(h, {"sz": 17, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    T.text(s, x + 0.2, 2.5, 2.5, 2.2, [[("•  " + l, {"sz": 14, "c": GREEN})] for l in ls], sa=10)
T.headline_box(s, 0.5, 5.15, 12.3, "ต้องใช้ Supabase 2 โปรเจคเหมือนเดิม — ห้ามยุบเป็นโปรเจคเดียว (ฝั่ง DR เปิด anon ทั้งโปรเจค)")
T.text(s, 0.5, 5.75, 12.3, 1.0, [
    [("ค่าใช้จ่ายอ้างอิงจากชุด TSAT: ", {"sz": 14, "b": True, "c": GREEN}),
     ("Supabase Pro ≈ $37/เดือน (2 โปรเจค Micro) · Render Static Site ฟรี (มีโควตานาที build) · ย้ายเข้า server บริษัทได้", {"sz": 14, "c": GREY})],
])

# ── 4 Infra ──
s = content("① โครงสร้างพื้นฐาน + บัญชีที่ต้องเปิด", "ฝั่ง IT / ผู้ดูแลระบบ — ทำได้ก่อนข้อมูลจากโรงงานมาถึง")
box(s, 0.45, 1.7, 4.0, 4.95, "Supabase", [
    "Organization + บัตรจ่ายเงิน (Pro)",
    "โปรเจค MAIN (region สิงคโปร์)",
    "โปรเจค DR แยกอีกตัว",
    "เก็บ URL + anon key + service key",
    "ตั้งชื่อในจอให้ไม่ชนชุด TSAT",
    "เปิด backup / PITR",
], sz=15)
box(s, 4.67, 1.7, 4.0, 4.95, "Hosting + Domain", [
    "Render Static Site ใหม่ หรือ nginx/IIS",
    "โดเมนย่อย เช่น esm-xxx.<บริษัท>",
    "ใบรับรอง TLS (https)",
    "มือถือ 4G/5G นอกโรงงานต้องเข้าได้",
    "ตั้ง SPA redirect (public/_redirects)",
    "หน้าต่าง deploy นอกเวลากะ",
], sz=15)
box(s, 8.89, 1.7, 4.0, 4.95, "Repo + ช่องทางแจ้งเตือน", [
    "ตัดสินใจ: repo เดียว + config ต่อโรงงาน (แนะนำ) หรือ fork",
    "GitHub Actions deploy ของโรงงานใหม่",
    "Telegram bot + group id (ถ้าใช้)",
    "ANTHROPIC_API_KEY (ฟีเจอร์ AI · ถ้าใช้)",
    "ผู้ดูแลระบบฝั่งโรงงาน 1-2 คน",
], sz=15)

# ── 5 DB ──
s = content("② ฐานข้อมูล — สร้างโครงสร้างให้ตรงกับชุด TSAT", "สร้าง schema เปล่า (ไม่มีข้อมูล) ให้ครบทั้ง 2 โปรเจค")
table(s, 0.45, 1.65, [3.0, 6.2, 3.2], [
    ("รายการ", "รายละเอียด", "หมายเหตุ"),
    ("ตาราง + view + function", "dump โครงสร้างจาก MAIN / DR ปัจจุบัน (schema-only)", "แนะนำแทนการไล่ migration"),
    ("migration 707 ไฟล์", "ติดป้าย _main / _dr แค่ ~280 ไฟล์ — ไล่รันใหม่เสี่ยงลงผิดฝั่ง", "ใช้เป็นประวัติอ้างอิง"),
    ("RLS + has_perm()", "policy ทุกตาราง · ฝั่ง DR ต้องเป็น anon เหมือนเดิม", "ห้ามเปลี่ยนเป็น authenticated"),
    ("role_permissions", "ชุดสิทธิ์ตั้งต้น (seed) — คัดลอกจาก TSAT ได้", "ข้อมูลตั้งค่า ไม่ใช่ข้อมูลผลิต"),
    ("Realtime publication", "ตารางตาม src/utils/realtimeTables.js", "ขาด = จอไม่อัปเดตเงียบ"),
    ("pg_cron", "งานตั้งเวลาใน 16 migration (สแกน PM / downtime / สรุปรายวัน)", "ต้องชี้ URL โปรเจคใหม่"),
    ("Storage 15 bucket", "employee-photos · four-m-images · mtn-images · jig-images · signatures ฯลฯ", "ตั้ง public/private ให้ตรง"),
    ("Auth", "ปิด sign-up เอง · ผู้ใช้สร้างผ่าน /add-user (edge create-user)", "ระบบไม่ส่งอีเมล"),
], sz=11, rh=0.52)

# ── 6 โค้ด ──
s = content("③ โค้ดที่ต้องแก้ก่อน deploy ชุดที่ 2", "ปัจจุบันบางจุดผูกกับ TSAT ตรงๆ — ไม่แก้ = โรงงานใหม่ยิงข้อมูลเข้าฐาน TSAT")
table(s, 0.45, 1.65, [3.4, 5.5, 3.5], [
    ("จุด", "ปัญหา", "ทางแก้"),
    ("URL edge function ฝังตาย", "Checkin · DailyReport · MtnRepair · PMCheckData · PMSchedule เรียก ewhdfq… ตรง", "อ่านจาก VITE_SUPABASE_URL"),
    ("DR fallback", "supabaseClient.js ถอยไป eyhclz… ถ้าไม่ตั้ง env", "ไม่มี env = หยุด ห้ามถอย"),
    ("หน้า /schema", "SchemaMap.jsx ระบุ project id ตายตัว", "อ่านจาก env"),
    ("Edge function 5 ตัว", "pm-plan-reminder · cleanup-orphan-photos · kanban-round-scan ฯลฯ มี id ในโค้ด", "ใช้ DR_URL secret"),
    ("ชื่อ / โลโก้ / ไอคอน", "manifest · thai-summit-logo.svg · ข้อความ ~38 ไฟล์", "รวมเป็นไฟล์ config แบรนด์"),
    ("ทะเบียนเอกสาร /doc-forms", "เลขฟอร์ม · Rev · โลโก้ ของ TSAT", "โรงงานใหม่ลงทะเบียนเอง"),
    ("ค่าเฉพาะ TSAT", "SLoc (P411) · ไลน์ต้นแบบ 060/061 · เด็คธีม", "ไล่ตรวจก่อนขึ้นระบบ"),
], sz=11, rh=0.58)

# ── 7 Env + secrets ──
s = content("④ ค่าตั้งค่า (env) + secrets ที่ต้องเตรียม", "เก็บในที่ปลอดภัย — ห้ามใส่ใน repo / แชท")
table(s, 0.45, 1.65, [4.3, 2.4, 5.7], [
    ("ชื่อ", "ตั้งที่", "ใช้ทำอะไร"),
    ("VITE_SUPABASE_URL / _ANON_KEY", "Hosting", "เว็บต่อ MAIN (login + ข้อมูลคน)"),
    ("VITE_SUPABASE_DR_URL / _DR_KEY", "Hosting", "เว็บต่อ DR (ข้อมูลผลิต)"),
    ("SUPABASE_URL / SERVICE_ROLE_KEY", "Edge (อัตโนมัติ)", "edge function เขียนข้ามสิทธิ์"),
    ("DR_URL / DR_ANON_KEY", "Edge secrets", "edge function ฝั่ง MAIN อ่าน DR"),
    ("CRON_SECRET / INGEST_SECRET / CLEANUP_TOKEN", "Edge secrets", "กันคนนอกยิงงานตั้งเวลา / นำเข้า"),
    ("TELEGRAM_BOT_TOKEN / CHAT_ID / WEBHOOK_SECRET", "Edge secrets", "แจ้งเตือน Telegram (ไม่บังคับ)"),
    ("ANTHROPIC_API_KEY / AI_INTAKE_CHAT_IDS", "Edge secrets", "ฟีเจอร์ AI รับงาน (ไม่บังคับ)"),
], sz=12, rh=0.52)
T.text(s, 0.45, 6.0, 12.4, 0.5, [[("ใหม่ทั้งหมด — ห้ามใช้ key ของชุด TSAT ซ้ำ (หลุด 1 ชุดต้องไม่ลามไปอีกชุด)", {"sz": 14, "b": True, "c": ORANGE})]])

# ── 8 Divider ──
T.section_divider(p, "divider_r01.jpg",
                  ["ข้อมูลที่โรงงานใหม่", "ต้องเตรียม"])
page[0] += 1

# ── 9 Master data ชั้น 1 ──
s = content("⑤ ข้อมูลตั้งต้น — ต้องมีก่อนเปิดใช้วันแรก", "เรียงตามลำดับการลง (ตัวบนเป็นฐานของตัวล่าง) · ส่งเป็น Excel ตามแม่แบบ")
table(s, 0.45, 1.65, [0.55, 3.0, 5.4, 3.45], [
    ("#", "ข้อมูล", "ต้องมีอะไรบ้าง", "เจ้าของข้อมูล"),
    ("1", "ผังองค์กร + Cost Center", "ฝ่าย → ส่วน → แผนก → ทีม · รหัส CC · ลำดับการแสดง", "HR / บัญชี"),
    ("2", "ไลน์ผลิต / หน่วยสนับสนุน", "ชื่อไลน์ · ไลน์แม่-ลูก · ชนิดไลน์ · production/support · คน std กะเช้า/ดึก", "ฝ่ายผลิต"),
    ("3", "จุดงาน (workstation)", "จุดยืนในแต่ละไลน์ · จำนวนคนต่อจุด", "ฝ่ายผลิต"),
    ("4", "พนักงาน", "รหัส · ชื่อ · ตำแหน่ง · สังกัด · ไลน์ · ทีม A/B/C · รูปถ่าย", "HR"),
    ("5", "ผู้ใช้ระบบ + สิทธิ์", "ใครใช้ระบบ · role · ส่วนงานที่ดูแล · CC ที่รับผิดชอบ", "หัวหน้าแต่ละฝ่าย"),
    ("6", "ปฏิทิน + กะ + เวลาพัก", "วันทำงาน/หยุด/OT ทั้งปี · เวลากะ · เวลาพักต่อไลน์", "HR / ฝ่ายผลิต"),
    ("7", "เครื่องจักร", "เลขเครื่อง (รูปแบบเดียว) · ไลน์ · ชนิดสินทรัพย์ · shut height (ปั๊ม)", "ซ่อมบำรุง"),
    ("8", "สินค้า / พาร์ท", "MAT no · P/N · ชื่อ · ลูกค้า · CT ต่อ shot · คู่ RH/LH · ไลน์ที่ผลิต", "PE / วางแผน"),
], sz=12, rh=0.56)

# ── 10 Master data ชั้น 2 ──
s = content("⑥ ข้อมูลที่เติมตามมา — เปิดโมดูลไหน เตรียมชุดนั้น", "ไม่ต้องครบวันแรก · เริ่มจากไลน์นำร่อง 1-2 ไลน์ให้ linkage ครบก่อนขยาย")
table(s, 0.45, 1.65, [3.3, 5.6, 3.5], [
    ("โมดูล", "ข้อมูลที่ต้องเตรียม", "เจ้าของข้อมูล"),
    ("BOM + Process", "โครง BOM หลายชั้น · OP / PFC · ชนิดกระบวนการ", "PE"),
    ("ลูกค้า / Supplier", "ทะเบียนลูกค้า · supplier · จุดส่ง · Kanban/Packing", "Logistic / วางแผน"),
    ("แม่พิมพ์ / จิ๊ก / อะไหล่", "ทะเบียน die · jig · spare part · ตำแหน่งชั้นวาง", "DIE / JIG / สโตร์"),
    ("ซ่อมบำรุง + PM", "ทีมช่าง · หมวดอาการเสีย · แผน PM · รายการตรวจ AM", "ซ่อมบำรุง"),
    ("คุณภาพ", "หมวดของเสีย · ใบตรวจ QA · PFMEA / Control Plan", "QA / PE"),
    ("KPI / OBEYA", "รายการ KPI ต่อหน่วยงาน · เป้า A / P / Q · ยอดขาย / COGS", "ผู้บริหาร / บัญชี"),
    ("ความปลอดภัย / PPE", "รายการ PPE ต่อจุดงาน · หัวข้อ BBS", "Safety"),
    ("ทะเบียนเอกสาร", "เลขฟอร์ม · Rev · โลโก้ ของทุกใบที่พิมพ์ / export", "Document Control"),
], sz=12, rh=0.52)

# ── 11 กติกาข้อมูล ──
s = content("⑦ กติกาการเตรียมข้อมูล — ป้องกันข้อมูลเพี้ยนตั้งแต่ต้น", "ทุกข้อเคยเกิดจริงที่ TSAT")
box(s, 0.45, 1.7, 6.1, 4.95, "รูปแบบข้อมูล", [
    "เลขเครื่องเขียนแบบเดียว (SW10 ไม่ใช่ SW-10 ปนกัน)",
    "ชื่อไลน์ / ทีม / ส่วนงาน ไม่ซ้ำ ไม่มีช่องว่างเกิน",
    "CT เป็นวินาทีต่อ 1 จังหวะ (shot) ไม่ใช่ต่อชิ้น",
    "งานคู่ RH/LH ต้องระบุคู่ ไม่งั้นนับเวลาซ้ำ 2 เท่า",
    "ช่องที่ไม่รู้ให้ว่าง ห้ามใส่ 0 หรือ “อื่นๆ”",
], sz=16)
box(s, 6.77, 1.7, 6.1, 4.95, "ความถูกต้อง + ความเป็นส่วนตัว", [
    "ห้ามคัดลอกข้อมูลผลิต / พนักงานจาก TSAT",
    "คัดลอกได้เฉพาะชุดตั้งค่า: สิทธิ์ · หมวดหมู่กลาง",
    "ข้อมูลพนักงาน / รูปถ่าย ผ่าน PDPA ของโรงงานนั้น",
    "มีผู้ยืนยันข้อมูลแต่ละชุด (ลงชื่อ + วันที่)",
    "ลงข้อมูลชุดเล็กก่อน ตรวจบนจอ แล้วค่อยลงทั้งหมด",
], fill=ORANGE, sz=16)

# ── 12 ข้อควรระวัง ──
s = content("ข้อควรระวัง — สิ่งที่ห้ามทำ", "ผลกระทบสูงถ้าพลาด")
table(s, 0.45, 1.65, [4.6, 7.8], [
    ("ห้าม", "เพราะ"),
    ("ใช้ฐานข้อมูลร่วมกับ TSAT", "ไม่มีด่านแยกโรงงานในระดับแถว — ข้อมูลปนกันทันที"),
    ("ยุบ MAIN + DR เป็นโปรเจคเดียว", "DR เปิด anon ทั้งโปรเจค = ข้อมูลคนหลุดออกอินเทอร์เน็ต"),
    ("deploy ก่อนแก้ URL ที่ฝังในโค้ด", "แจ้งเตือนของโรงงานใหม่จะวิ่งเข้าระบบ TSAT"),
    ("เปลี่ยน RLS ฝั่ง DR เป็น authenticated", "เว็บต่อ DR ด้วย anon เสมอ = พังทั้งระบบ"),
    ("fork แล้วปล่อยแยกทางยาว", "บั๊กที่แก้ที่ TSAT ไม่ไหลไปอีกโรงงาน — ใช้ repo เดียว + config"),
    ("deploy ในเวลาทำงาน 08:00–17:30", "แท็บที่เปิดค้างพังพร้อมกันทุกเครื่อง"),
], sz=13, rh=0.62)

# ── 13 แผน ──
s = content("แผนขึ้นระบบ 5 สัปดาห์ (ข้อเสนอ)", "เริ่มจากไลน์นำร่อง แล้วขยายทีละกลุ่ม")
steps = [
    ("W1", "โครงสร้าง", ["เปิด Supabase 2 โปรเจค", "Hosting + domain + TLS", "แก้ URL ฝังในโค้ด"]),
    ("W2", "ฐานข้อมูล", ["schema + RLS + bucket", "edge function + secrets", "pg_cron + realtime"]),
    ("W3", "ข้อมูลหลัก", ["ผังองค์กร · ไลน์ · คน", "ผู้ใช้ + สิทธิ์", "ปฏิทิน · เครื่อง · พาร์ท"]),
    ("W4", "นำร่อง", ["1-2 ไลน์ ใช้จริง", "เช็คชื่อ · รายงานผลิต", "เก็บ feedback แก้"]),
    ("W5", "ขยาย", ["ไลน์ที่เหลือ", "เปิดโมดูล PM / QA / KPI", "ส่งมอบผู้ดูแล"]),
]
for i, (wk, h, ls) in enumerate(steps):
    x = 0.45 + i * 2.5
    T.rect(s, x, 1.75, 2.3, 0.7, fill=ORANGE if i == 3 else GREEN_D, shape=MSO_SHAPE.CHEVRON if i else MSO_SHAPE.PENTAGON)
    T.text(s, x, 1.75, 2.3, 0.7, [[(f"{wk}  {h}", {"sz": 15, "b": True, "c": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    T.rect(s, x, 2.6, 2.3, 2.6, fill=WHITE, line=BORDER, shape=MSO_SHAPE.ROUNDED_RECTANGLE, shadow=True)
    T.text(s, x + 0.12, 2.75, 2.1, 2.4, [[("•  " + l, {"sz": 13, "c": GREEN})] for l in ls], sa=10)
T.headline_box(s, 0.45, 5.55, 12.4, "ข้อมูลจากโรงงาน (ข้อ ⑤) คือคอขวด — ส่งแม่แบบ Excel ให้ตั้งแต่ W1")

# ── 14 ปิด ──
T.closing_slide(p, page[0] + 1)

p.save(OUT)
print("saved", os.path.relpath(OUT))
