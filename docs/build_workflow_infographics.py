#!/usr/bin/env python3
"""ESM — Workflow ต่อส่วนงาน 4 หน้า (A4 แนวนอน) · ธีม Thai Summit Group

รัน:  python3 docs/build_workflow_infographics.py
      → docs/ESM_Workflow_By_Function_TH.html  (4 หน้าในไฟล์เดียว)

4 หน้า:
  1. วงจรการทำงาน — ฝ่ายผลิต
  2. วงจรการทำงาน — ซ่อมบำรุง (ช่าง)
  3. วงจรการทำงาน — Logistic / คลัง / จัดส่ง
  4. ภาพรวม · สอบกลับ · วิเคราะห์  (จุดเด่นของการมีฐานข้อมูลกลาง)

⚠️ กับดักภาษาไทย (แก้ไว้แล้ว ห้ามถอด — เหมือน build_infographic.py)
  1. letter-spacing = 0  → ไม่งั้นสระ/วรรณยุกต์ลอยห่างพยัญชนะ
  2. line-height ≥ 1.45  → ไม่งั้นตัวบน (ไม้โท/ไม้ตรี) โดนตัด
  3. ไทยดูเล็กกว่าอังกฤษที่ pt เท่ากัน → bump ขนาดฟอนต์
  4. ฟอนต์ฝังลง PDF ตอน print → เครื่องปลายทางไม่ต้องมีฟอนต์

⚠️ ตัวเลขทุกตัววัดจากฐานข้อมูลจริง (ดู STATS) — อัปเดตแล้วรันสคริปต์ใหม่
   ห้ามแก้ .html/.pdf/.png ตรงๆ (รันครั้งถัดไปทับหาย)

⚠️ ชื่อฟีเจอร์ต้องตรงกับที่มีจริงในระบบ — ห้ามใส่ของที่ยังไม่ได้ทำ
   (เอกสารนี้เอาไปพรีเซนต์ลูกค้า ใส่ของที่ไม่มี = โดนจับได้ตอนเดโม)
"""
import pathlib, sys
from importlib.machinery import SourceFileLoader

# ⚠️ 2 ฉบับจากเนื้อหาชุดเดียวกัน — ห้ามแยกไฟล์เนื้อหา (แยกแล้วจะ drift แน่นอน)
#    full = เล่มอ้างอิง/แจกหลังพรีเซนต์  ·  lite = แผ่นสำหรับ "พูด" (ตัวใหญ่ ข้อความน้อย)
#    lite ตัดโดย "เอา n ตัวแรกของลิสต์" → เรียงลิสต์ให้ตัวสำคัญอยู่บนเสมอ
LITE = False

HERE = pathlib.Path(__file__).parent
IMG = SourceFileLoader("_a", str(HERE / ".infographic_assets.py")).load_module().IMG

# ── ตัวเลขจริง ณ 2026-08-25 (นับจาก DB ทั้ง 2 project) ────────────────────
S = dict(
    shifts="931", orders="9,458", downtime="5,465", defects="128", oee="79.5",
    four_m="1,104", four_m_open="33", checkins="9,433", employees="202",
    skills="2,286", lpa="239", ojt="3",
    mo="7", spare="69", insp="9", equipment="518", dies="262",
    ship="472", shipped="38", stock_txn="6,604", parts="287", products="109",
    fmea="898", pe_sets="3", forms="38", pages="57", users="71", lines="27",
)

FOOT = "ระบบ ESM ที่ใช้งานจริงตั้งแต่ 18 มิ.ย. 2569 &middot; ตัวเลขวัดจากฐานข้อมูลจริง ณ 25 ส.ค. 2569"
MOTTO = "ก่อนสร้างชิ้นงาน เราสร้างคนก่อน"

# ─────────────────────────────────────────────────────────────────────────
#  เนื้อหา — แก้ที่นี่ที่เดียว
# ─────────────────────────────────────────────────────────────────────────
P1 = dict(
    file="p1", tag="01 / 04",
    title="วงจรการทำงาน &mdash; <span>ฝ่ายผลิต</span>",
    sub="หนึ่งกะ แปดขั้น &middot; ทุกขั้นส่งข้อมูลต่อให้ขั้นถัดไปเอง ไม่ต้องคีย์ซ้ำ",
    hero=[("{shifts}", "กะที่บันทึกแล้ว"), ("{orders}", "ใบผลิต"),
          ("{oee}%", "OEE เฉลี่ย"), ("{employees}", "พนักงาน")],
    photo="photo_robots",
    steps=[
        ("01", "เช็คชื่อ + PPE", "หน้าเช็คชื่อ", [
            "มา / ลา / ขาด &middot; ติ๊ก PPE รายชิ้นตามที่ไลน์นั้นกำหนด",
            "จองรถ OT ล่วงหน้า (วันหยุดเลือก 8 หรือ 10 ชม.)",
            "ยืมพนักงานจากไลน์อื่นมาช่วยเป็นรายกะได้",
            "รู้ยอดคนขาดของทั้งโรงงานก่อนเริ่มงาน"]),
        ("02", "จัดคนลงจุดงาน", "ผังจัดกำลังคน", [
            "ลากคนลงผังไลน์จริง เห็น % ความเหมาะสมกับสกิลของจุดนั้น",
            "<b>PPE ไม่ครบ = ลากลงจุดไม่ได้</b>",
            "ย้ายข้ามจุด/ข้ามไลน์ ระบบเปิดใบ 4M ให้เอง",
            "จุดที่ยังไม่มีคนยืน เห็นเป็นช่องว่างบนผังทันที"]),
        ("03", "ประชุมแถวเช้า", "บอร์ดประชุม", [
            "สรุปเมื่อวานให้ครบอัตโนมัติ &mdash; ไม่ต้องทำสไลด์",
            "ชี้ว่าอะไรทำให้หลุดแผน แล้วกดสร้างงานติดตามได้เลย",
            "งานค้างข้ามวันตามจนปิด &middot; มีโหมดจอ TV",
            "ส่งสรุปเข้ากลุ่ม Telegram ได้ในคลิกเดียว"]),
        ("04", "เปิดกะ + เปิดใบผลิต", "รายงานการผลิต", [
            "สแกนบัตรคัมบัง หรือเปิดเป้าเองเมื่อไม่มีบาร์โค้ด",
            "งานคู่ LH/RH เปิดคู่ให้อัตโนมัติ นับเป็นหนึ่งจังหวะปั๊ม",
            "ยอดค้างจากกะก่อนถูกยกมาให้ ไม่ต้องคีย์ใหม่",
            "ไลน์ที่มีหลายเครื่องขนาน เลือกได้ว่าใบนี้ลงเครื่องไหน"]),
        ("05", "เดินไลน์ &middot; บันทึกสด", "รายงานการผลิต", [
            "กรอกยอดสะสมทุกช่วงพัก &middot; เห็น <b>&ldquo;ตอนนี้ควรได้เท่าไหร่&rdquo;</b>",
            "เครื่องหยุด / ของเสีย บันทึกทันที (สแกน QR ที่ตัวเครื่อง)",
            "OEE คำนวณสดระหว่างกะ ไม่ต้องรอปิดกะ",
            "หยุดตามแผน กับ หยุดเพราะเสีย แยกกัน ไม่ปนใน OEE"]),
        ("06", "ตรวจด้วยตัวเอง", "ศูนย์รวมระบบเช็ค", [
            "AM &mdash; ผลิตตรวจเครื่องเองทุกต้นกะ ค่าวัดมีเกณฑ์ในระบบ",
            "Poka-Yoke &mdash; ยิงชิ้นงานตัวอย่าง NG ทุกวันเพื่อพิสูจน์ว่ายังจับได้",
            "LPA &mdash; ตรวจไล่ชั้น หัวหน้ากลุ่ม / ส่วน / ผจก. / GM",
            "ตรวจไม่ผ่าน เปิดใบแจ้งซ่อมต่อได้ทันที"]),
        ("07", "ปิดกะ &middot; ขออนุมัติ", "รายงานการผลิต", [
            "หัวหน้ากลุ่มขอปิด + เขียนเหตุผลถ้ายอดไม่ถึงเป้า",
            "<b>หัวหน้าส่วนอนุมัติ หรือ ตีกลับ</b> (ตีกลับต้องบอกว่าให้แก้อะไร)",
            "ปิดแล้ว OEE (A &times; P &times; Q) ถูกล็อกไว้ แก้ย้อนหลังไม่ได้",
            "ใบที่ยังไม่ปิด ถูกยกยอดไปกะถัดไปให้เอง"]),
        ("08", "แก้ไข + ปรับปรุง", "4M &middot; Kaizen", [
            "เปลี่ยนคน/เครื่อง/วัตถุดิบ/วิธี ต้องผ่านหัวหน้าส่วน &rarr; QA",
            "เปิดโปรเจคปรับปรุงจากกราฟพาเรโตได้ทันที",
            "วัดผลก่อน&ndash;หลังให้เอง แล้วตีออกมาเป็นเงิน",
            "ทุกใบพิมพ์เป็นเอกสารควบคุมตามฟอร์มบริษัทได้"]),
    ],
    guard_h="สิ่งที่ระบบไม่ยอมให้ผ่าน",
    guard=["PPE ไม่ครบ &rarr; ลงจุดงานไม่ได้",
           "เลือกสาเหตุ &ldquo;อื่นๆ&rdquo; &rarr; ต้องพิมพ์รายละเอียด",
           "ค่าวัดหลุดสเปกแล้วกดผ่าน &rarr; บล็อก พาไปเปิดใบของเสีย",
           "หัวหน้ากลุ่มปิดกะเองไม่ได้ &rarr; ต้องผ่านการอนุมัติ",
           "ตรวจไม่ครบทุกจุด &rarr; ปิดใบตรวจไม่ได้"],
    hand_h="ข้อมูลนี้ไหลต่อไปให้ใคร",
    hand=[("ช่างซ่อมบำรุง", "รายการเครื่องหยุด + ปุ่มเรียกช่าง กลายเป็นใบแจ้งซ่อมได้ทันที"),
          ("คลัง &middot; จัดส่ง", "ปิดใบผลิต &rarr; ของเข้าคลังเอง ไม่ต้องคีย์รับซ้ำ"),
          ("คุณภาพ", "ของเสียรายประเภท + ใบ 4M ที่รอ QA อนุมัติก่อนเดินงาน"),
          ("ผู้บริหาร", "OEE ที่ล็อกแล้วเข้ากราฟแนวโน้ม + เด็ครายเดือนอัตโนมัติ")],
    more_h="ฟีเจอร์อื่นของส่วนงานนี้",
    more=["ตารางกะ A/B/C + สลับกะรายคน", "เมทริกซ์ทักษะ + สะสม EXP จากงานจริง",
          "ใบอบรม OJT + ใบประเมินรายบุคคล", "ทะเบียนพนักงาน + ประวัติทักษะ",
          "แผนการผลิต (ต้องเปิดกี่กะถึงทัน)", "แผนผังสายธารคุณค่า (VSM)",
          "เอกสารวิศวกรรม PFC / PFMEA / Control Plan", "พิมพ์ฟอร์มควบคุม {forms} ฟอร์มจากระบบ",
          "ผังรวมโรงงาน &mdash; ทุกไลน์จอเดียว", "Dashboard ส่วนงาน &mdash; งานที่ต้องทำวันนี้",
          "ใบรายงานปัญหาการผลิต + ถังเหลือง/ถังแดง", "ใบรายงานของเสีย (Scrap Report)",
          "รีโมทคุมจอ TV จากมือถือ", "ประวัติผลิตรายสินค้า + สอบกลับใบผลิต"],
    num_h="ใช้งานจริงแล้ว",
    nums=[("{shifts}", "กะ", 0), ("{orders}", "ใบผลิต", 0), ("{downtime}", "ครั้งที่เครื่องหยุด", 1),
          ("{four_m}", "ใบ 4M", 0), ("{checkins}", "รายการเช็คชื่อ", 0), ("{lpa}", "ครั้งที่ตรวจ LPA", 0)],
    cap="ทุกจุดงานบนไลน์ถูกวางไว้ในระบบ &mdash; รู้ว่าใครยืนตรงไหน กะไหน",
    note=("<b>ตัวเลขพวกนี้ไม่ได้มาจากการนั่งทำรายงานตอนสิ้นเดือน</b> &mdash; "
          "มันเกิดจากงานที่หน้างานทำอยู่แล้วทุกกะ ระบบแค่เก็บไว้ตอนที่มันเกิดขึ้นจริง "
          "จึงย้อนกลับไปดูได้ทุกใบ ทุกกะ ทุกคน"),
)

P2 = dict(
    file="p2", tag="02 / 04",
    title="วงจรการทำงาน &mdash; <span>ซ่อมบำรุง</span>",
    sub="4 ทีมช่างในระบบเดียว &middot; MTN &middot; JIG MTN &middot; DIE MTN &middot; AM (ผลิตตรวจเอง)",
    hero=[("{downtime}", "ครั้งที่เครื่องหยุด"), ("{equipment}", "อุปกรณ์ในทะเบียน"),
          ("{dies}", "แม่พิมพ์"), ("{spare}", "รายการอะไหล่")],
    photo="photo_press2500t",
    steps=[
        ("01", "รู้ว่าเครื่องหยุด", "ผังรวมโรงงาน", [
            "ผลิตบันทึกปุ๊บ ผังรวมเปลี่ยนเป็นแดงทันที",
            "<b>ค้างเกิน 15 นาที ระบบแจ้งเอง</b> ไม่ต้องรอใครโทรตาม",
            "หยุดตามแผนไม่ทำให้แดง &mdash; สัญญาณจริงไม่ถูกกลบ",
            "ผังรวมทั้งโรงงานจอเดียว เห็นทุกไลน์พร้อมกัน"]),
        ("02", "เปิดใบแจ้งซ่อม", "ใบแจ้งซ่อม MO", [
            "เปิดต่อจากรายการเครื่องหยุดได้เลย ไม่ต้องคีย์ซ้ำ",
            "สแกน QR ที่ตัวเครื่อง &rarr; เติมไลน์ / ส่วนงาน / cost center ให้",
            "เลือกทีมที่จะแจ้งถึง &middot; แจ้งผิดทีมส่งกลับได้พร้อมเหตุผล",
            "แนบรูปอาการเสียตั้งแต่ตอนแจ้ง"]),
        ("03", "รับงาน &rarr; ออกเลข MO", "ขั้นที่ 2 ของใบ", [
            "เลขใบงานรันแยกทีม ออกให้อัตโนมัติตอนกดรับงาน",
            "มอบหมายช่างจากฐานพนักงานจริง (ไม่ใช่พิมพ์ชื่อ)",
            "นาฬิกา KPI เริ่มนับ &mdash; เวลาตอบสนอง / เวลาซ่อม",
            "แจ้งเข้ากลุ่ม Telegram ของทีมนั้นโดยตรง"]),
        ("04", "ซ่อม + เบิกอะไหล่", "ขั้นที่ 3 + คลังอะไหล่", [
            "เบิกแล้ว <b>ตัดสต็อกทันที</b> รู้ว่าใครเบิกไปใช้กับใบไหน",
            "ลงค่าแรงซ่อม + ค่าอะไหล่ต่อใบ &rarr; รู้ต้นทุนรายเครื่อง",
            "ถ่ายรูปก่อน&ndash;หลัง แนบไว้ในใบเลย",
            "อะไหล่ต่ำกว่าจุดสั่งซื้อ ระบบเตือนเอง"]),
        ("05", "ตรวจหลังซ่อม + คุณภาพ", "ขั้นที่ 4&ndash;5", [
            "ผู้ตรวจเซ็นบนจอ (ดึงลายเซ็นในโปรไฟล์มาใช้ซ้ำได้)",
            "งานที่กระทบคุณภาพ <b>ต้องผ่าน QA ก่อน</b> ถึงจะไปขั้นถัดไป",
            "ผลตรวจผูกอยู่กับใบ ไม่ต้องเก็บกระดาษแยก",
            "ตรวจไม่ผ่าน ตีกลับไปขั้นซ่อมได้"]),
        ("06", "ส่งมอบ + อนุมัติปิด", "ขั้นที่ 6&ndash;7", [
            "ผู้แจ้งให้คะแนนความพึงพอใจ 5 ด้าน &rarr; เป็น KPI ของทีมช่าง",
            "หัวหน้าอนุมัติปิด แล้วพิมพ์ใบตามฟอร์มของบริษัทได้เลย",
            "สรุปงานค้างทุกเช้า 09:00 เข้ากลุ่มอัตโนมัติ",
            "ใบเก่าค้นย้อนหลังได้ทั้งหมด ไม่ต้องเปิดแฟ้ม"]),
        ("07", "งานตามแผน (PM)", "แผน PM &middot; PM ล่วงหน้า", [
            "ตั้งรอบได้ทั้งตามเวลา และตามยอดผลิต (จำนวน shot)",
            "เห็นวันครบกำหนดล่วงหน้า + <b>บอกว่าต้องผลิตเผื่อกี่ชิ้น</b>",
            "งานยาวข้ามวันหลายทีม ใช้แผนประสานงาน แจ้งฝ่ายผลิตอัตโนมัติ",
            "PM ที่ทำเสร็จ ระบบเลื่อนรอบถัดไปให้เอง"]),
        ("08", "ของและที่เก็บ", "คลัง &middot; ผัง &middot; ทะเบียน", [
            "คลังอะไหล่จัด Rank A/B/C จากการใช้จริง ไม่ต้องนั่งจัดเอง",
            "ผังชั้นวาง &mdash; ค้นชื่อของแล้วรู้ว่าอยู่ช่องไหน",
            "ผังระบบลม/น้ำ &rarr; รู้ว่าตัดไฟตัวนี้กระทบไลน์ไหนบ้าง",
            "สแกน QR ที่เครื่อง เปิดประวัติได้ทันทีหน้างาน"]),
    ],
    guard_h="สิ่งที่ระบบไม่ยอมให้ผ่าน",
    guard=["ใบซ่อมผูกกับรายการเครื่องหยุดจริงเสมอ",
           "ข้ามขั้นตอนไม่ได้ &mdash; ต้องไล่ 7 ขั้นตามลำดับ",
           "ข้อมูลตั้งต้นของทีมไหน ทีมนั้นแก้ (ของกลางเฉพาะหัวหน้า)",
           "แค่เปิดดูจุดตรวจ ไม่ทำให้เครื่องกลายเป็นงานของทีมนั้น",
           "เปลี่ยนชื่อรายการ ระบบถามก่อนว่าให้ใบเก่าตามไปด้วยไหม"],
    hand_h="ข้อมูลนี้ไหลต่อไปให้ใคร",
    hand=[("ฝ่ายผลิต", "วันครบกำหนด PM ล่วงหน้า + ต้องผลิตเผื่อกี่ชิ้นก่อนหยุดเครื่อง"),
          ("ฝ่ายผลิต", "ปิดงานซ่อม &rarr; ปิดรายการเครื่องหยุด &rarr; OEE คิดถูกทันที"),
          ("วิศวกรรม", "อาการที่เสียซ้ำ &rarr; ใช้ทบทวน PFMEA และแผนควบคุม"),
          ("บัญชี &middot; ผู้บริหาร", "ค่าแรง + ค่าอะไหล่ต่อเครื่อง = ต้นทุนซ่อมจริง ไม่ใช่ประมาณ")],
    more_h="ฟีเจอร์อื่นของส่วนงานนี้",
    more=["AM &mdash; ผลิตตรวจเครื่องเองทุกต้นกะ", "Poka-Yoke ตรวจประจำวันด้วยชิ้น master",
          "ผังเครื่องจักรรายไลน์ + โซนงานระบบ", "ทะเบียนแม่พิมพ์ + ผังจัดเก็บ + สถานะ",
          "รูปหลายมุมของเครื่อง + ปักหมุดจุดตรวจ", "พิมพ์ป้าย QR ติดเครื่อง/จิ๊ก",
          "KPI ทีมช่าง + พาเรโตอาการเสีย", "คอมเมนต์ใต้ใบงาน + แจ้งเตือนถึงตัวคน",
          "คลังอะไหล่ + นำเข้าจากไฟล์ Excel เดิม", "ผังชั้นวางอะไหล่ (ค้นแล้วรู้ช่อง)",
          "แผนประสานงาน PM ข้ามวันหลายทีม", "ประเมินความพึงพอใจงานซ่อม 5 ด้าน",
          "ทะเบียนเครื่องมือวัด + เตือนสอบเทียบ", "ประวัติการแก้ข้อมูลตั้งต้น (ใครแก้อะไร)"],
    num_h="ใช้งานจริงแล้ว",
    nums=[("{downtime}", "ครั้งที่เครื่องหยุด", 0), ("{mo}", "ใบซ่อมที่เปิดในระบบ", 1),
          ("{insp}", "ครั้งที่บันทึกผลตรวจ PM", 1), ("{spare}", "รายการอะไหล่", 0),
          ("{equipment}", "อุปกรณ์ในทะเบียน", 0), ("{dies}", "แม่พิมพ์ในทะเบียน", 0)],
    cap="ไลน์เพรส &mdash; ตัวนับจำนวนครั้งปั๊มส่งต่อให้แผน PM โดยตรง",
    note=("<b>ช่องว่างที่ระบบชี้ให้เห็นเอง:</b> เครื่องหยุดถูกบันทึกไว้ {downtime} ครั้ง "
          "แต่เปิดใบซ่อมในระบบเพียง {mo} ใบ &mdash; หน้า Dashboard ซ่อมบำรุงจึงมีแผง "
          "&ldquo;เครื่องที่หยุดซ้ำ &ge;2 ครั้งใน 30 วัน แต่ยังไม่มีใบแจ้งซ่อม&rdquo; รออยู่"),
)

P3 = dict(
    file="p3", tag="03 / 04",
    title="วงจรการทำงาน &mdash; <span>Logistic</span>",
    sub="ตั้งแต่คำสั่งซื้อของลูกค้า จนของขึ้นรถออกจากโรงงาน",
    hero=[("{ship}", "รอบส่งในระบบ"), ("{stock_txn}", "รายการเคลื่อนไหวสต็อก"),
          ("{parts}", "พาร์ทในทะเบียน"), ("{products}", "สินค้าที่ผลิต")],
    photo="photo_hotpress",
    steps=[
        ("01", "รับความต้องการลูกค้า", "Planner &amp; Sales", [
            "อัปไฟล์ EDI 830 (พยากรณ์) / 862 (คำสั่งซื้อ) เข้าระบบได้เลย",
            "เลขพาร์ทลูกค้า &rarr; จับคู่เลข SAP ให้อัตโนมัติ <b>จับไม่ได้จะเตือน ไม่เงียบ</b>",
            "ลูกค้าสั่งด่วนนอกไฟล์ คีย์เพิ่มทีละใบได้",
            "เก็บประวัติย้อนหลัง &mdash; อัปไฟล์ซ้ำไม่ลบของเก่าทิ้ง"]),
        ("02", "คำนวณคัมบัง", "แท็บคำนวณคัมบัง", [
            "คิดจำนวนบัตรจากพยากรณ์ + วันทำงานจริงในปฏิทินบริษัท",
            "แยกคัมบังเบิกถอน กับคัมบังสั่งผลิต ให้ถูกกระบวนการ",
            "บอก % ภาระของแต่ละไลน์ก่อนตกลงรับงาน",
            "จำนวนต่อกล่องดึงจากทะเบียนพาร์ทกลาง ไม่กรอกซ้ำ"]),
        ("03", "วางแผนการผลิต", "แผนการผลิต", [
            "เทียบกับ <b>กำลังผลิตจริงที่วัดจากประวัติ</b> ไม่ใช่ตัวเลขบนกระดาษ",
            "บอกว่าต้องเปิดกี่กะ วันไหนต้อง OT / เปิดกะดึก / ทำวันหยุด",
            "ดูล่วงหน้าได้ทั้งรายวัน 21 วัน และรายเดือน 6 เดือน",
            "เห็นล่วงหน้าว่าวันไหนกำลังผลิตไม่พอ ต้องคุยกับลูกค้า"]),
        ("04", "คลัง + จ่ายเข้าไลน์", "Store", [
            "<b>ปิดใบผลิต &rarr; ของเข้าคลังอัตโนมัติ</b> ไม่ต้องคีย์รับ",
            "จ่ายเข้าไลน์ตาม Min / Max ที่ตั้งไว้ต่อพาร์ท",
            "ปรับยอดด้วยมือต้องผ่านคิวอนุมัติก่อนมีผล",
            "ของหน้าไลน์กับของในสโตร์ แยกบัญชีกันชัดเจน"]),
        ("05", "บอร์ด Heijunka", "บอร์ดคิวงาน", [
            "คิวงานรายไลน์ &middot; รอบจัดส่งของวันนี้ + คำนวณจำนวนเที่ยว",
            "เรียกภาชนะเปล่าด้วยการสแกน QR ที่หน้างาน",
            "งานคู่ LH/RH วางขนานกัน &middot; เห็นคิวข้ามกะ ไม่ใช่แค่กะนี้"]),
        ("06", "ขนส่งในโรงงาน", "มอบหมายขนส่ง", [
            "มอบหมายคนขับ / ยานพาหนะ ให้แต่ละรอบส่ง",
            "วาดเส้นทางบนผังจริง + จัดลำดับจุดจอดให้สั้นที่สุด + จำลองเวลาวิ่ง",
            "ตั้งความจุรถแต่ละคัน &rarr; รู้ว่ารอบนี้ต้องวิ่งกี่เที่ยว"]),
        ("07", "ส่งลูกค้า", "Delivery", [
            "นับถอยหลัง 4 เฟส &mdash; ยืนยัน &rarr; เตรียม &rarr; โหลดขึ้นรถ &rarr; ถึงลูกค้า",
            "<b>หลุดเฟสระบบแจ้งเอง</b> ไม่ต้องมีคนนั่งเฝ้าจอ",
            "กด &ldquo;ส่งแล้ว&rdquo; ตัดสต็อกทันที ตัดไม่ได้ต้องรายงาน ห้ามเงียบ",
            "ค้างส่งจากวันก่อนขึ้นแดงจนกว่าจะเคลียร์"]),
        ("08", "เฝ้าระวัง", "Store Monitor &middot; Rundown", [
            "ต่ำกว่า Min / เกิน Max / รอบส่งเลยเวลา / รับไม่ครบ / ใบสั่งซื้อค้าง",
            "ยอดคงเหลือรายวัน เรียงพาร์ทที่จะขาดเร็วที่สุดขึ้นบน",
            "เทียบยอดผลิตกับความต้องการลูกค้า &rarr; ต้องเร่งหรือชะลอ",
            "เตือนก่อนของจะขาด ไม่ใช่รู้ตอนขาดไปแล้ว"]),
    ],
    guard_h="สิ่งที่ระบบไม่ยอมให้ผ่าน",
    guard=["งานสำเร็จรูปหักออกทางเดียว &mdash; กดส่งลูกค้าเท่านั้น",
           "จับคู่เลขไม่ชัดเจน &rarr; ไม่ตัดสต็อก + บอกว่าต้องไปแก้ที่ไหน",
           "เลขที่ยังไม่ผูก = &ldquo;ยังเช็คไม่ได้&rdquo; ไม่ใช่ &ldquo;ไม่มีของ&rdquo;",
           "ไม่เอาของเลข SAP อื่นมานับแทนกัน (ยอดใน SAP จะเพี้ยน)",
           "อัปไฟล์ EDI ซ้ำ ไม่ลบประวัติของวันที่ผ่านไปแล้ว"],
    hand_h="ข้อมูลนี้ไหลต่อไปให้ใคร",
    hand=[("ฝ่ายผลิต", "ต้องผลิตอะไรก่อน กี่กะถึงทัน &rarr; ลงบอร์ดคิวหน้าไลน์"),
          ("ฝ่ายผลิต", "บัตรคัมบังที่คำนวณแล้ว = ใบสั่งงานที่หน้างานสแกนจริง"),
          ("ช่างซ่อมบำรุง", "ถ้าเครื่องหยุด จะรู้ทันทีว่ากระทบรอบส่งใบไหน ลูกค้ารายไหน"),
          ("ผู้บริหาร", "ส่งทันกี่ % &middot; พาร์ทไหนจะขาดก่อน &middot; ของค้างเท่าไหร่")],
    more_h="ฟีเจอร์อื่นของส่วนงานนี้",
    more=["สต็อกหน้าไลน์ + ใบเบิกวัตถุดิบ", "ศูนย์จัดการภาชนะ + ป้าย QR",
          "ทะเบียนพาร์ทกลาง (ตัวตนสินค้าชุดเดียว)", "โครงสร้างสินค้า (BOM) + งานเปลี่ยนแบบ EC",
          "ตั้งค่าจุดส่ง + เวลานับถอยหลังรายลูกค้า", "WIP ค้างระหว่างขั้น + ต้องทำเพิ่มเท่าไหร่",
          "ผังเส้นทางเดินรถในโรงงาน", "แผนผังสายธารคุณค่า (VSM)",
          "ทะเบียนภาชนะ + ป้าย QR เรียกของ", "ตารางรอบส่งภายในโรงงาน (Teiki-bin)",
          "เฝ้าระวังสต๊อก 5 เคสอัตโนมัติ", "ยอดคงเหลือรายวัน (Rundown)",
          "นำเข้าต้นทุนพาร์ทจากไฟล์ CSV", "ประวัติการเคลื่อนไหวสต็อกย้อนหลังทั้งหมด"],
    num_h="ใช้งานจริงแล้ว",
    nums=[("{ship}", "รอบส่งในระบบ", 0), ("{shipped}", "รอบที่กดยืนยันส่งแล้ว", 1),
          ("{stock_txn}", "รายการเคลื่อนไหวสต็อก", 0), ("{parts}", "พาร์ทในทะเบียน", 0),
          ("{products}", "สินค้าที่ผลิต", 0), ("{lines}", "ไลน์ผลิต", 0)],
    cap="งานขึ้นรูปร้อน &mdash; รอบเวลาผลิตคือตัวกำหนดค่า P ใน OEE",
    note=("<b>ช่องว่างที่ระบบชี้ให้เห็นเอง:</b> มีรอบส่งในระบบ {ship} รอบ แต่กดยืนยัน "
          "&ldquo;ส่งแล้ว&rdquo; เพียง {shipped} รอบ &mdash; ของจริงออกไปแล้วแต่ใบยังไม่ถูกปิด "
          "ทำให้ยอดคงเหลือในระบบสูงกว่าของจริง เป็นงานที่ต้องเคลียร์ให้ครบก่อนสิ้น ต.ค."),
)

# ── หน้า 4 โครงต่างจาก 3 หน้าแรก ───────────────────────────────────────────
P4 = dict(
    file="p4", tag="04 / 04",
    title="ภาพรวม &middot; สอบกลับ &middot; <span>วิเคราะห์</span>",
    sub="สิ่งที่ทำได้เพราะทุกส่วนงานเขียนลงฐานข้อมูลเดียวกัน &mdash; ไม่ใช่ต่างคนต่างเก็บไฟล์",
    hero=[("{pages}", "จอในระบบ"), ("{users}", "ผู้ใช้งาน"),
          ("{fmea}", "บรรทัด PFMEA"), ("{forms}", "ฟอร์มควบคุม")],

    spine_h="สายสอบกลับ &mdash; หยิบของหนึ่งกล่อง แล้วเดินย้อนได้ทั้งเส้น",
    spine=[("ลูกค้าสั่ง", "EDI 862"), ("แผนผลิต", "กี่กะถึงทัน"), ("วัตถุดิบ", "ใบเบิก"),
           ("ใบผลิต", "สแกนคัมบัง"), ("กะ + คน", "ใครยืนจุดไหน"), ("เครื่อง + แม่พิมพ์", "ขาด PM ไหม"),
           ("หยุด / ของเสีย", "สาเหตุที่บันทึกไว้"), ("ใบซ่อม", "แก้อะไรไป"),
           ("เข้าคลัง", "อัตโนมัติ"), ("รอบส่ง", "ออกไปเมื่อไหร่")],
    spine_note=("จุดจบของสายไม่ใช่ที่รถออกจากโรงงาน &mdash; แต่ย้อนต่อไปถึง "
                "<b>เอกสารออกแบบกระบวนการ (PFMEA / Control Plan)</b> เพื่อถามว่า "
                "&ldquo;อาการนี้เคยถูกคาดไว้ตอนออกแบบหรือเปล่า&rdquo;"),

    lvl_h="สี่ระดับที่ข้อมูลชุดเดียวกันตอบได้",
    lvl=[("1", "เห็นย้อนหลัง", "เกิดอะไรขึ้น &mdash; ผลิตเท่าไหร่ หยุดกี่นาที เสียกี่ชิ้น", "ทำได้แล้ว"),
         ("2", "รู้สาเหตุ", "ทำไมถึงเกิด &mdash; จัดกลุ่มหมายเหตุที่พนักงานพิมพ์ + 6 Big Losses", "ทำได้แล้ว"),
         ("3", "รู้ล่วงหน้า", "จะเกิดอีกเมื่อไหร่ &mdash; PM ครบกำหนด &middot; ของจะขาดวันไหน", "บางส่วน"),
         ("4", "บอกว่าต้องทำอะไร", "ควรทำอะไรก่อน &mdash; แก้ตรงไหนคุ้มที่สุดเป็นเงิน", "กำลังต่อ")],

    q_h="คำถามข้ามแผนกที่ตอบได้ เพราะข้อมูลอยู่ที่เดียวกัน",
    q=[("ของกล่องนี้มีปัญหา", "ผลิตกะไหน ใครยืนจุดไหน เครื่องขาด PM อยู่หรือเปล่า"),
       ("เครื่องเสียตอนนี้", "กระทบรอบส่งใบไหน ของลูกค้ารายไหน"),
       ("ของเสียตัวนี้", "เคยถูกคาดไว้ใน PFMEA หรือไม่ &mdash; ถ้าไม่เคย ต้องทบทวนวิธีทำ FMEA"),
       ("มาตรการที่ปิด 8D ไปแล้ว", "ทำให้ของเสียลดลงจริงไหม วัดจากตัวเลขจริง ไม่ใช่ความรู้สึก"),
       ("เวลาที่หายไปเดือนนี้", "คิดเป็นเงินเท่าไหร่ แยกตามค่าแรง / ค่าเสื่อม / โสหุ้ย"),
       ("ไลน์นี้ควรลงทุนเครื่องเพิ่ม", "หรือแค่เปิดกะเพิ่มก็พอ &mdash; ดูจาก OEE / OOE / TEEP")],

    loop_h="ลูปที่ปิดครบแล้ว &mdash; เคลมลูกค้า กลับไปแก้เอกสารออกแบบ",
    loop=[("เคลมลูกค้า", "ลงทะเบียนในระบบ"), ("เปิด 8D", "หาสาเหตุ 3 ขา"),
          ("ระบบชี้บรรทัด", "ใน PFMEA / Control Plan"), ("ออก Revision", "ผูกกลับไปที่ใบเคลม"),
          ("วัดผลจริง", "ของเสียลดจริงไหม")],
    loop_note=("ระบบ <b>เสนอ</b> ว่าควรแก้บรรทัดไหน แต่ <b>คนเป็นผู้ตัดสินและอนุมัติ</b> เสมอ "
               "&mdash; เอกสารควบคุมจะถูกแก้เองอัตโนมัติไม่ได้"),

    std_h="มาตรฐานที่ระบบเดินตาม",
    std=[("IATF 16949", "เชิงกระบวนการ &middot; บันทึกความสามารถบุคลากร &middot; ควบคุมการเปลี่ยนแปลง"),
         ("CQI-15", "บันทึกเหตุการณ์งานเชื่อม พร้อมสายอนุมัติ"),
         ("APQP / PPAP", "PFMEA และแผนควบคุม ผูกกันด้วยเลขกระบวนการเดียวกัน"),
         ("8D", "หาสาเหตุ 3 ขา จากข้อมูลที่เกิดขึ้นจริง ไม่ใช่ความจำ"),
         ("TPM", "AM พนักงานตรวจเองทุกต้นกะ &middot; PM ช่างตามรอบ"),
         ("Lean", "6 ความสูญเสีย &middot; 8 ความสูญเปล่า &middot; VSM &middot; ไคเซ็น")],
    why_h="ทำไมถึงเรียกว่าฐานข้อมูลกลาง",
    why=[("ตัวเลขชุดเดียว", "OEE ที่หัวหน้าไลน์เห็น กับที่ผู้บริหารเห็น มาจากสูตรเดียวกันในโค้ดจุดเดียว"),
         ("ไม่ต้อง export", "ไม่มีการส่งไฟล์ Excel ไปมาให้เวอร์ชันหลุดกัน"),
         ("รู้ว่าใครแก้", "การแก้ข้อมูลตั้งต้นทุกครั้งถูกบันทึกว่าใคร เมื่อไหร่ จากค่าอะไรเป็นอะไร"),
         ("ต่อ SCADA ได้", "ถ้าวันหน้าดึงสัญญาณจากเครื่องตรง สูตรยังอยู่ที่เดิม เครื่องเป็นแค่เซ็นเซอร์")],

    todo_h="ยังต้องเติมให้ครบก่อนสิ้น ต.ค.",
    todo=[("ใบแจ้งซ่อม", "ให้ผ่านระบบทุกใบ &mdash; วันนี้ {mo} ใบ เทียบเครื่องหยุด {downtime} ครั้ง"),
          ("ใบตรวจคุณภาพ &middot; SPC", "ระบบพร้อมแล้ว แต่ยังไม่มีใครเริ่มบันทึก"),
          ("รอบส่งลูกค้า", "กดยืนยันส่งแล้ว {shipped} จาก {ship} รอบ &mdash; ที่เหลือของออกไปแล้วแต่ใบยังค้าง"),
          ("ต้นทุนต่อชิ้น + ค่าแรงรายกลุ่ม", "ยังไม่กรอก จึงตีมูลค่าความสูญเสียเป็นเงินไม่ได้"),
          ("โปรเจคปรับปรุง", "เปิดตามลำดับพาเรโต &mdash; วันนี้มี 1 โปรเจค"),
          ("เอกสาร PFC / PFMEA / CP", "วันนี้ {pe_sets} ชุด &mdash; ขยายให้ครบพาร์ทที่ผลิตจริง")],
    plan_h="แผนงานสู่ความสมบูรณ์",
    plan_sub="100% ภายใน 31 ต.ค. 2569 &mdash; หลังจากนั้นคือรักษาระดับ",
    plan=[("ส.ค.", "ตั้งค่าระบบ + สิทธิ์", "ผังองค์กร &middot; ผู้ใช้ &middot; สิทธิ์ &middot; แจ้งเตือน", "done"),
          ("ส.ค.&ndash;ก.ย.", "ข้อมูลตั้งต้นครบ", "ทุกส่วนงานกรอกครบตามใบตรวจความพร้อม", "now"),
          ("ก.ย.", "ทุกส่วนงานใช้ทุกวัน", "ช่าง &middot; คุณภาพ &middot; คลัง เข้ามาอยู่ในวงจรเดียวกัน", "next"),
          ("ต.ค.", "ครบทุกไลน์", "เลิกกระดาษ &middot; ตัวเลขมาจากที่เดียวกันทั้งโรงงาน", "next"),
          ("31 ต.ค.", "สมบูรณ์ 100%", "พ.ย. เป็นต้นไป &mdash; รักษาระดับ KPI &ge;95% ให้เดินต่อเอง", "goal")],
    num_h="ฐานข้อมูลวันนี้",
    nums=[("{shifts}", "กะ", 0), ("{orders}", "ใบผลิต", 0), ("{downtime}", "ครั้งที่เครื่องหยุด", 0),
          ("{four_m}", "ใบ 4M", 0), ("{checkins}", "เช็คชื่อ", 0), ("{skills}", "คะแนนทักษะ", 0),
          ("{fmea}", "บรรทัด PFMEA", 0), ("{stock_txn}", "รายการสต็อก", 0)],
    foot_note=("<b>ข้อจำกัดที่พูดตรงๆ:</b> ระดับ 1&ndash;2 ใช้ได้จริงแล้ววันนี้ &middot; "
               "ระดับ 3&ndash;4 ยังจำกัดอยู่ที่ &ldquo;บันทึกที่ยังว่าง&rdquo; ไม่ใช่ที่ตัวระบบ &mdash; "
               "เช่น ใบซ่อม {mo} ใบ เทียบกับเครื่องหยุด {downtime} ครั้ง"),
)


def css():
    f = '"Noto Sans Thai","Sarabun",Tahoma,sans-serif'
    # lite ฉายบนจอ/มองจากที่นั่งประชุม → ตัวต้องใหญ่กว่าเล่มอ้างอิงที่ถืออ่านใกล้ๆ
    b = 1.55 if LITE else 0.45                              # ไทยดูเล็กกว่าอังกฤษที่ pt เท่ากัน
    def p(x): return f"{x + b:.2f}pt"
    RH = 34 if LITE else 42
    return f"""
@page{{size:297mm 210mm;margin:0}}
*{{margin:0;padding:0;box-sizing:border-box;letter-spacing:0}}
html,body{{width:297mm;background:#fff}}
body{{font-family:{f};color:#1b2a1e;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
.page{{width:297mm;height:210mm;display:flex;flex-direction:column;overflow:hidden;
 position:relative;page-break-after:always;break-after:page}}
.page:last-child{{page-break-after:auto;break-after:auto}}

/* ── หัวเรื่อง ─────────────────────────────────────────── */
.hd{{flex:0 0 20mm;background:linear-gradient(100deg,#0D3D14 0%,#164D1D 58%,#0D3D14 100%);
 color:#fff;display:flex;align-items:center;padding:0 7mm;gap:5mm;position:relative}}
.hd::after{{content:"";position:absolute;left:0;right:0;bottom:0;height:1.1mm;background:#C0561E}}
.hd .lg{{width:15mm;height:13mm;background:var(--ts) center/contain no-repeat;flex:0 0 15mm}}
.hd .ttl{{font-size:{p(17)};font-weight:700;line-height:1.2}}
.hd .ttl span{{color:#EBD9B0}}
.hd .sub{{font-size:{p(7.4)};color:#CFE0C8;margin-top:1mm;line-height:1.4}}
.hero{{margin-left:auto;display:flex;gap:4.4mm;align-items:center}}
.hero div{{text-align:right}}
.hero b{{display:block;font-size:{p(14)};color:#FD8342;line-height:1}}
.hero span{{display:block;font-size:{p(6.3)};color:#CFE0C8;margin-top:.7mm}}
.tag{{position:absolute;right:7mm;top:2mm;font-size:{p(6)};color:#8FB088;font-weight:700}}

h2{{font-size:{p(9.2)};color:#0D3D14;border-bottom:1.3pt solid #C0561E;
 padding-bottom:.9mm;margin-bottom:1.5mm;line-height:1.35;font-weight:700}}
h2 small{{float:right;font-size:{p(6.3)};color:#C0561E;font-weight:400;padding-top:.8mm}}

/* ── 8 ขั้น (หน้า 1-3) ─────────────────────────────────── */
.bd{{flex:1;display:flex;flex-direction:column;gap:2.6mm;padding:3mm 7mm 0;min-height:0}}
.steps{{flex:0 0 auto;display:grid;grid-template-columns:repeat(4,1fr);
 grid-auto-rows:minmax({RH}mm,auto);gap:2.2mm}}
.st{{border:.4pt solid #D8E4D0;border-top:1.1mm solid #2C5F2D;border-radius:1.2mm;
 padding:2.2mm 2.4mm;display:flex;flex-direction:column;background:#fff;overflow:hidden}}
.st:nth-child(n+7){{border-top-color:#C0561E}}
.st .hh{{display:flex;align-items:baseline;gap:1.6mm;margin-bottom:.4mm}}
.st .no{{font-size:{p(12.6)};font-weight:700;color:#C0561E;line-height:1;flex:0 0 auto}}
.st .tt{{font-size:{p(9.4)};font-weight:700;color:#0D3D14;line-height:1.3}}
.st .scr{{font-size:{p(6.4)};color:#7d8c7f;margin-bottom:1.6mm;line-height:1.3}}
.st ul{{list-style:none;flex:1}}
.st li{{font-size:{p(7.1)};color:#3c4d3f;line-height:1.6;padding-left:2.6mm;
 position:relative;margin-bottom:1.5mm}}
.st li::before{{content:"";position:absolute;left:.4mm;top:2.1mm;width:1.1mm;height:1.1mm;
 border-radius:50%;background:#C0561E}}
.st li b{{color:#0D3D14}}

/* ── แถวล่าง 3 ช่อง ────────────────────────────────────── */
.row3{{flex:1;display:grid;grid-template-columns:78mm 1fr 72mm;gap:4.5mm;min-height:0}}
.hf div{{display:flex;gap:1.8mm;font-size:{p(7)};line-height:1.6;margin-bottom:1.5mm;align-items:baseline}}
.hf b{{flex:0 0 23mm;color:#C0561E;font-size:{p(7)}}}
.hf span{{color:#3c4d3f}}
.gd li{{font-size:{p(7)};color:#3c4d3f;line-height:1.6;padding-left:3.8mm;
 position:relative;margin-bottom:1.5mm;list-style:none}}
.gd li::before{{content:"\\2716";position:absolute;left:0;top:0;color:#C0561E;font-size:{p(5.6)}}}
.mr{{columns:2;column-gap:4mm}}
.mr li{{font-size:{p(7)};color:#3c4d3f;line-height:1.6;padding-left:2.6mm;
 position:relative;margin-bottom:1.5mm;list-style:none;break-inside:avoid}}
.mr li::before{{content:"";position:absolute;left:.4mm;top:1.8mm;width:.9mm;height:.9mm;
 border-radius:50%;background:#2C5F2D}}
.nm{{display:grid;grid-template-columns:1fr 1fr;gap:1.4mm}}
.nm div{{background:#ECF1E9;border-left:1.1mm solid #2C5F2D;border-radius:0 1mm 1mm 0;
 padding:1.5mm 2mm}}
.nm b{{display:block;font-size:{p(11.6)};color:#0D3D14;line-height:1}}
.nm span{{display:block;font-size:{p(6.6)};color:#555;margin-top:.5mm;line-height:1.35}}
.nm div.o{{border-left-color:#C0561E}} .nm div.o b{{color:#C0561E}}
.photo{{position:relative;border-radius:1.4mm;overflow:hidden;margin-top:1.8mm}}
.photo img{{width:100%;height:19mm;object-fit:cover;display:block}}
.photo .cap{{position:absolute;left:0;right:0;bottom:0;
 background:linear-gradient(transparent,rgba(13,61,20,.93));color:#fff;
 font-size:{p(6.6)};padding:4mm 2mm 1.3mm;line-height:1.4}}
.note{{margin-top:2mm;background:#0D3D14;color:#fff;border-radius:1mm;
 padding:2.2mm 2.6mm;font-size:{p(7)};line-height:1.6}}
.note b{{color:#FD8342}}

/* ── หน้า 4 ────────────────────────────────────────────── */
.spine{{display:flex;align-items:stretch;gap:.6mm}}
.sc{{flex:1;background:#fff;border:.4pt solid #D8E4D0;border-top:1mm solid #2C5F2D;
 border-radius:.9mm;padding:1.6mm .6mm;text-align:center;display:flex;
 flex-direction:column;justify-content:center}}
.sc b{{display:block;font-size:{p(6.3)};color:#0D3D14;line-height:1.3}}
.sc span{{display:block;font-size:{p(5.5)};color:#7d8c7f;margin-top:.5mm;line-height:1.25}}
.sar{{align-self:center;color:#C0561E;font-size:7pt;line-height:1}}
.p4{{flex:1;display:grid;grid-template-columns:88mm 1fr 82mm;gap:4mm;min-height:0}}
.lv{{display:flex;gap:1.8mm;margin-bottom:1.6mm;align-items:flex-start}}
.lv .n{{flex:0 0 5.4mm;height:5.4mm;border-radius:50%;background:#2C5F2D;color:#fff;
 font-size:{p(6.6)};font-weight:700;display:flex;align-items:center;justify-content:center;
 margin-top:.3mm}}
.lv:nth-child(4) .n,.lv:nth-child(5) .n{{background:#C0561E}}
.lv b{{display:block;font-size:{p(7)};color:#0D3D14;line-height:1.35}}
.lv span{{display:block;font-size:{p(6)};color:#4a5a4d;line-height:1.5;margin-top:.2mm}}
.lv i{{font-style:normal;font-size:{p(5.4)};color:#fff;background:#2C5F2D;border-radius:.7mm;
 padding:.2mm 1.1mm;margin-left:1.4mm;vertical-align:.3mm}}
.lv:nth-child(4) i,.lv:nth-child(5) i{{background:#C0561E}}
.qq{{margin-bottom:1.5mm;border-bottom:.3pt dotted #cfd8cc;padding-bottom:1.2mm}}
.qq b{{display:block;font-size:{p(6.7)};color:#C0561E;line-height:1.35}}
.qq span{{display:block;font-size:{p(6.2)};color:#3c4d3f;line-height:1.5;margin-top:.2mm}}
.lp{{display:flex;align-items:stretch;gap:.6mm;margin-bottom:1.6mm}}
.lpc{{flex:1;background:#ECF1E9;border-radius:.9mm;padding:1.4mm .6mm;text-align:center}}
.lpc b{{display:block;font-size:{p(6.1)};color:#0D3D14;line-height:1.3}}
.lpc span{{display:block;font-size:{p(5.3)};color:#6d7c6f;margin-top:.4mm;line-height:1.25}}
.wy div{{margin-bottom:1.4mm}}
.wy b{{display:block;font-size:{p(6.8)};color:#0D3D14;line-height:1.35}}
.wy span{{display:block;font-size:{p(6)};color:#4a5a4d;line-height:1.5;margin-top:.2mm}}

.td div{{display:flex;gap:1.8mm;font-size:{p(6.9)};line-height:1.55;margin-bottom:1mm;
 align-items:baseline;border-bottom:.3pt dotted #cfd8cc;padding-bottom:.9mm}}
.td b{{flex:0 0 30mm;color:#C0561E}} .td span{{color:#3c4d3f}}
.pln{{display:flex;gap:1.4mm;align-items:stretch;margin-top:1.4mm}}
.pln .plh{{flex:0 0 30mm;display:flex;flex-direction:column;justify-content:center;
 border-right:1.3pt solid #C0561E;padding-right:2mm}}
.pln .plh b{{font-size:{p(8.4)};color:#0D3D14;line-height:1.3}}
.pln .plh span{{font-size:{p(6.1)};color:#C0561E;line-height:1.4;margin-top:.4mm}}
.pln .pc{{flex:1;border:.4pt solid #D8E4D0;border-top:1.1mm solid #2C5F2D;border-radius:1.1mm;
 padding:1.4mm 2mm;display:flex;flex-direction:column;justify-content:center;background:#fff}}
.pln .pc.done{{background:#ECF1E9}}
.pln .pc.now{{border-top-color:#C0561E;background:#FDF3EC}}
.pln .pc.goal{{flex:1.35;background:#0D3D14;border-color:#0D3D14;border-top-color:#FD8342}}
.pln .mo{{font-size:{p(6.3)};font-weight:700;color:#C0561E;line-height:1.25}}
.pln .pt{{font-size:{p(7.6)};font-weight:700;color:#0D3D14;line-height:1.3;margin-top:.2mm}}
.pln .pd{{font-size:{p(6)};color:#5a6b5d;line-height:1.45;margin-top:.4mm}}
.pln .pc.goal .mo{{color:#FD8342}}
.pln .pc.goal .pt{{color:#fff}} .pln .pc.goal .pd{{color:#CFE0C8}}
.pln .ok{{float:right;font-size:{p(5.8)};color:#2C5F2D;font-weight:700}}

/* ── ท้ายหน้า ──────────────────────────────────────────── */
.ft{{flex:0 0 8.5mm;display:flex;align-items:center;padding:0 7mm;gap:2mm;
 border-top:.5pt solid #D8E4D0;margin-top:2.4mm}}
.ft .lg{{width:6mm;height:5mm;background:var(--tsf) center/contain no-repeat;flex:0 0 6mm}}
.ft .wm{{font-size:{p(7.6)};font-weight:700;color:#0D3D14}}
.ft .mid{{margin-left:auto;font-size:{p(6)};color:#555;text-align:right;line-height:1.45}}
.ft .mid b{{color:#0D3D14}}
"""


def _hd(P):
    fx = lambda s: s.format(**S)
    hero = "".join(f"<div><b>{fx(v)}</b><span>{k}</span></div>" for v, k in P["hero"])
    return f"""  <header class="hd">
    <i class="lg"></i>
    <div><div class="ttl">{P['title']}</div><div class="sub">{P['sub']}</div></div>
    <div class="hero">{hero}</div>
    <div class="tag">{P['tag']}</div>
  </header>"""


def _ft():
    return f"""  <footer class="ft">
    <i class="lg"></i><span class="wm">THAI SUMMIT GROUP</span>
    <span class="mid"><b>{MOTTO}</b><br>{FOOT}</span>
  </footer>"""


def cut(items, n):
    """lite = เอาแค่ n ตัวแรก · full = ครบ"""
    return items[:n] if LITE else items


def _nums(P):
    fx = lambda s: s.format(**S)
    return "".join(f'<div class="{"o" if o else ""}"><b>{fx(v)}</b><span>{k}</span></div>'
                   for v, k, o in P["nums"])


def page_cycle(P):
    """หน้า 1-3 — วงจร 8 ขั้น + แถวล่าง 3 ช่อง"""
    fx = lambda s: s.format(**S)
    steps = "".join(
        f'<div class="st"><div class="hh"><span class="no">{n}</span>'
        f'<span class="tt">{t}</span></div><div class="scr">{scr}</div><ul>'
        + "".join(f"<li>{x}</li>" for x in cut(items, 2)) + "</ul></div>"
        for n, t, scr, items in P["steps"])
    guard = "".join(f"<li>{x}</li>" for x in P["guard"])
    hand = "".join(f"<div><b>{a}</b><span>{b}</span></div>" for a, b in P["hand"])
    more = "".join(f"<li>{fx(x)}</li>" for x in cut(P["more"], 8))
    # รูปอยู่ท้ายคอลัมน์กลาง · note อยู่ท้ายคอลัมน์ขวา → 3 คอลัมน์สูงใกล้กัน
    photo = (f'<div class="photo"><img src="data:image/jpeg;base64,{IMG[P["photo"]]}" alt="">'
             f'<div class="cap">{P["cap"]}</div></div>')
    note = f'<div class="note">{fx(P["note"])}</div>' 
    return f"""<div class="page">
{_hd(P)}
  <div class="bd">
    <div class="steps">{steps}</div>
    <div class="row3">
      <section><h2>{P['guard_h']}</h2><ul class="gd">{guard}</ul>
        <h2 style="margin-top:2.6mm">{P['hand_h']}</h2><div class="hf">{hand}</div></section>
      <section><h2>{P['more_h']}</h2><ul class="mr">{more}</ul>{photo}</section>
      <section><h2>{P['num_h']}</h2><div class="nm">{_nums(P)}</div>{note}</section>
    </div>
  </div>
{_ft()}
</div>"""


def page_overview(P):
    """หน้า 4 — สอบกลับ + วิเคราะห์"""
    fx = lambda s: s.format(**S)
    spine = ""
    for i, (a, b) in enumerate(P["spine"]):
        spine += f'<div class="sc"><b>{a}</b><span>{b}</span></div>'
        if i < len(P["spine"]) - 1:
            spine += '<div class="sar">&#9656;</div>'
    lvl = "".join(f'<div class="lv"><span class="n">{n}</span><div><b>{t}<i>{tag}</i></b>'
                  f'<span>{d}</span></div></div>' for n, t, d, tag in P["lvl"])
    q = "".join(f'<div class="qq"><b>{a}</b><span>{b}</span></div>' for a, b in cut(P["q"], 4))
    loop = ""
    for i, (a, b) in enumerate(P["loop"]):
        loop += f'<div class="lpc"><b>{a}</b><span>{b}</span></div>'
        if i < len(P["loop"]) - 1:
            loop += '<div class="sar">&#9656;</div>'
    why = "".join(f"<div><b>{a}</b><span>{b}</span></div>" for a, b in cut(P["why"], 3))
    std = ("" if LITE else
           f'<h2 style="margin-top:2.6mm">{P["std_h"]}</h2><div class="td">'
           + "".join(f"<div><b>{a}</b><span>{b}</span></div>" for a, b in P["std"]) + "</div>")
    todo = "".join(f"<div><b>{a}</b><span>{fx(b)}</span></div>" for a, b in cut(P["todo"], 4))
    plan = (f'<div class="plh"><b>{P["plan_h"]}</b><span>{P["plan_sub"]}</span></div>') + "".join(
        f'<div class="pc {st}"><div class="mo">{mo}'
        + ('<span class="ok">&#10003;</span>' if st == "done" else "")
        + f'</div><div class="pt">{t}</div><div class="pd">{d}</div></div>'
        for mo, t, d, st in P["plan"])
    return f"""<div class="page">
{_hd(P)}
  <div class="bd">
    <section>
      <h2>{P['spine_h']}</h2>
      <div class="spine">{spine}</div>
      <div class="note">{P['spine_note']}</div>
    </section>
    <div class="p4">
      <section>
        <h2>{P['lvl_h']}</h2>{lvl}
        <h2 style="margin-top:2.4mm">{P['loop_h']}</h2>
        <div class="lp">{loop}</div>
        <div style="font-size:6.9pt;color:#4a5a4d;line-height:1.6">{P['loop_note']}</div>
        {std}
      </section>
      <section><h2>{P['q_h']}</h2>{q}
        <h2 style="margin-top:2.6mm">{P['todo_h']}</h2><div class="td">{todo}</div></section>
      <section>
        <h2>{P['why_h']}</h2><div class="wy">{why}</div>
        <h2 style="margin-top:2.4mm">{P['num_h']}</h2><div class="nm">{_nums(P)}</div>
        <div class="note">{fx(P['foot_note'])}</div>
      </section>
    </div>
    <div class="pln">{plan}</div>
  </div>
{_ft()}
</div>"""


def build():
    pages = "\n".join([page_cycle(P1), page_cycle(P2), page_cycle(P3), page_overview(P4)])
    return f"""<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<title>ESM &mdash; Workflow ต่อส่วนงาน | Thai Summit Group</title>
<style>:root{{--ts:url("data:image/png;base64,{IMG['logo_big']}");
--tsf:url("data:image/png;base64,{IMG['logo_footer']}")}}{css()}</style></head>
<body>
{pages}
</body></html>
"""


if __name__ == "__main__":
    want = sys.argv[1].lower() if len(sys.argv) > 1 else "all"
    for lite, name in [(False, "ESM_Workflow_By_Function_TH"),
                       (True, "ESM_Workflow_By_Function_TH_Lite")]:
        if want not in ("all", "lite" if lite else "full"):
            continue
        LITE = lite
        globals()["LITE"] = lite
        p = HERE / f"{name}.html"
        p.write_text(build(), encoding="utf-8")
        print(f"✓ {p.name}  ({p.stat().st_size/1024:.0f} KB)")
