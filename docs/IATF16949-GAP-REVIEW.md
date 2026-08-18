# IATF 16949 Gap Review — ความสอดคล้องของ ESM กับมาตรฐานควบคุมการผลิตชิ้นส่วนยานยนต์

> **สถานะ: 📌 บันทึกไว้ก่อน — user สั่ง "จำไว้ก่อน ยังไม่ทำ" (2026-08-14)**
> ห้าม session ใดหยิบไปลงมือเองจนกว่า user จะสั่ง — เอกสารนี้คือผลรีวิว + ลำดับงานที่**เสนอ**ไว้เท่านั้น
> รีวิวจากโค้ด/ฐานข้อมูลจริง ณ 2026-08-14 (หลัง seed PE Core Tools เต็ม 2 พาร์ท P703)

**ขอบเขต:** IATF รับรอง "ระบบบริหารคุณภาพทั้งองค์กร" (คน+กระบวนการ+บันทึก) — ซอฟต์แวร์เป็นเครื่องมือสนับสนุน
รีวิวนี้ตอบว่า ESM รองรับข้อกำหนดไหนแล้ว/ยังขาดไหน · ส่วนที่ทำบนกระดาษ/ระบบอื่นนอก ESM มองไม่เห็น

## สรุปรายหมวด

| หมวด | สถานะ | ที่มีในระบบ / ที่ขาด |
|---|---|---|
| **Core Tools: FMEA / PFC / Control Plan** | ✅ ครบ (2026-08-13) | `/pe-docs` — ข้อมูลจริง 2 พาร์ท (RH+LH P703) + revision ผูกต้นเหตุเคลม |
| **Core Tools: SPC** | 🟡 มีแต่ข้อมูล 0 | X̄-R + Cp/Cpk/Pp/Ppk ตาม AIAG ใน `/qa` — `qa_measurements` ยังว่าง |
| **Core Tools: MSA** | 🔴 **ไม่มี** | ทะเบียนเครื่องมือวัดมีแค่กำหนดสอบเทียบ — ไม่มี GR&R / Bias / Linearity |
| **Core Tools: APQP** | 🔴 ไม่มี | มี "ผลลัพธ์" ของ APQP (PFC/FMEA/CP) แต่ไม่มีตัวติดตามเฟส/timing plan พาร์ทใหม่ |
| **Core Tools: PPAP** | 🔴 ไม่มี | ไม่มีทะเบียน PSW / สถานะ submission / ระดับ PPAP ต่อพาร์ท |
| 7.1.5 เครื่องมือวัด | 🟡 | สอบเทียบ+เตือนครบกำหนด ✅ · MSA ❌ · คุมแล็บภายนอก ISO 17025 ❌ |
| 7.2 ความสามารถบุคลากร | ✅ แข็งแรง | Skill matrix + level-up approval + OJT FM-HRM-004 + ใบประเมิน F-PRS-P1-119 |
| 7.5 ควบคุมเอกสาร | ✅ แข็งแรง | `/doc-forms` 24 ฟอร์ม (Rev/Effective/specimen) · ⚠️ ไม่มีนโยบาย retention/ทำลายบันทึก |
| 8.3 ออกแบบกระบวนการ + Special Char. | ✅/🟡 | CC/SC ใน FMEA+CP แล้ว — ยังไม่มีตัวเช็คความสอดคล้อง CC/SC ข้าม 3 เอกสาร |
| **8.4 ควบคุม Supplier** | 🔴 **ช่องว่างใหญ่สุด** | ไม่มีโมดูลเลย: ASL / supplier PPM / ผลตรวจรับเข้าผูก supplier / supplier audit (`parts_master` มีแค่ชื่อ) |
| 8.5.1 Control Plan → หน้างาน | ✅ | ใบตรวจ QA + LPA + AM ทุกต้นกะ + Poka-yoke verification + TPM/PM + die registry (8.5.1.5-.6 ครบ) |
| 8.5.2 Traceability | ✅/🟡 | `/order-trace` ลึก — gap ที่บันทึกแล้ว: lot supplier ตอนรับเข้า + attribution รายกล่องขาออก |
| 8.5.6 ควบคุมการเปลี่ยนแปลง | ✅/🟡 | 4M workflow แข็งแรง · ECN มีแต่เลขอ้างใน revision ยังไม่มี workflow อนุมัติ ECN |
| 8.6 ปล่อยผลิตภัณฑ์ | 🟡/🔴 | ใบตรวจมีระบบแต่ข้อมูล 0 · **Layout inspection + functional test ประจำปี (8.6.2) ไม่มีตัวติดตาม** |
| 8.7 Nonconforming | ✅🟡 | NCR (containment→disposition) + Scrap FM-PD2-002 + 8D — NCR = 0 แถว · concession ลูกค้า ❌ |
| **9.2 Internal audit 3 ชนิด** | 🟡/🔴 | Process audit = LPA ✅ · **System audit ❌ · Product audit ❌** · ทะเบียนคุณสมบัติ auditor ❌ |
| 9.3 Management review | 🟡 | Morning meeting + เด็ค Monthly Review — ยังไม่ครบ input บังคับ 9.3.2.1 (CoPQ, customer scorecard, ผลทดสอบ contingency ฯลฯ) |
| 10.2 Corrective action | ✅/🟡 | 8D + Improvements (วัดผลก่อน/หลังอัตโนมัติ) — **ลูป defect จริง → FMEA ยังไม่เชื่อม** (= เฟสถัดไปของ PE ที่วางไว้) |
| **6.1.2.3 Contingency plans** | 🔴 ไม่มี | IATF บังคับแผนฉุกเฉิน (ไฟดับ/เครื่องหลัก/คนขาด/supplier ล่ม) + ทดสอบประจำปี — Supply Route บนผังช่วยแค่มองเห็นผลกระทบ |
| 9.1.2 Customer satisfaction | 🔴 | คะแนนพึงพอใจมีเฉพาะงานซ่อมภายใน — **ไม่มีทะเบียนคำร้องเรียน/เคลมลูกค้า** ทั้งที่ประวัติ revision ชี้ว่าเคลมคือตัวขับเคลื่อนหลัก (30+ รายการใน cover จริง) |

## ประเด็นเน้น

1. **ช่องว่างอันตรายสุดไม่ใช่ฟีเจอร์ — คือ "บันทึกว่าง"**: SPC/NCR/ใบตรวจ QA/CAPA มีระบบครบแต่ข้อมูล 0 (MO 7 ใบ vs downtime 3,900 แถว) — ในสายตา auditor "มีระบบแต่ไม่ใช้" หนักกว่า "ไม่มีระบบ" เพราะแปลว่า QMS บนกระดาษกับหน้างานไม่ตรงกัน
2. **เคลมลูกค้า = จุดคุ้มสุดที่จะทำต่อ**: ข้อมูล revision ที่ seed พิสูจน์ว่ากระบวนการจริงคือ เคลม → แก้ FMEA → ออก rev อยู่แล้ว แค่ยังไม่มีทะเบียนเคลมในระบบ — ทำตัวเดียวปิด 9.1.2 + 10.2 + ลูป FMEA พร้อมกัน

## ลำดับงานที่เสนอ (ยังไม่ทำ — รอ user สั่ง)

1. **Adoption ก่อนสร้างใหม่** — ดัน NCR/ใบตรวจ QA/SPC ให้มีข้อมูลจริง (ระบบพร้อมแล้ว)
2. **ทะเบียนเคลมลูกค้า** ผูก 8D + FMEA
3. **MSA (GR&R)** — Core Tool เดียวที่ขาดทั้งดุ้น ต่อยอดทะเบียนเครื่องมือวัดเดิม
4. **Supplier quality (8.4)** — โมดูลใหญ่สุดที่หายไป
5. **Internal audit ครบ 3 ชนิด** (system + product ต่อยอดโครง LPA) + **Contingency plans (6.1.2.3)**
6. APQP/PPAP tracker · ECN workflow · Layout inspection schedule · record retention
