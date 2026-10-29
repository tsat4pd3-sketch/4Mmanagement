# ✈️ เบิกเงินเดินทางต่างประเทศ — MOCKUP workflow (`/overseas-travel` · 2026-10-29)

ที่มา: ผัง "Overseas Business Travel Process (Workflow)" ที่ user ส่งมา (swimlane: ผู้เดินทาง · ผู้อนุมัติ ·
HR/Compliance · Travel/Admin · Finance/Accounting/ECM + คำอธิบาย 7 ข้อ)

**ไฟล์:** `src/pages/OverseasTravelMockup.jsx` · เมนูหมวด "ผู้บริหาร & เดโม"

## สิ่งที่หน้านี้เป็น / ไม่เป็น
- **ตัวอย่างหน้าจอเท่านั้น — ไม่เขียน DB ใดๆ** ใบคำขออยู่ใน state ของหน้า (รีเฟรช = เริ่มใหม่) · ป้าย 🧪 MOCKUP ที่หัวเพจห้ามถอด
- แท็บ (`?tab=`): `overview` ภาพรวมทุกใบ + ประวัติ · `traveler` · `approver` · `hr` · `admin` · `finance` — **ตัวเลขบนแท็บ = จำนวนใบที่รอฝ่ายนั้น** (`waitsOf()`)
- **แถบ 7 ขั้น** = คอลัมน์คำอธิบายของผัง: ขอเดินทาง → อนุมัติ → HR/Compliance → เตรียมเดินทาง → เดินทาง → ยื่นเบิก → Finance ปิดงาน (`phaseOf()`)
- อนุมัติเรียงลำดับ Line Manager → Department Head → Executive · **ส่งกลับแก้ไขต้องมีเหตุผล** · ผู้เดินทางแก้แล้วส่งใหม่ = เริ่มอนุมัติใหม่ทั้งสาย
- **Finance ตรวจงบได้ตั้งแต่ยื่นคำขอ** (ขนานกับการอนุมัติ ตามลูกศรในผัง) · Advance (ถ้าขอ) อนุมัติ → โอน ก่อนเดินทาง
- Admin: Passport → ตัดสิน Visa (ต้องใช้ = รอผู้เดินทางส่งเอกสาร แล้ว Admin ยื่น) → Flight quotation → ตั๋ว → โรงแรม → ประกัน → eSIM
- **Ready to Travel Check** กดได้เมื่อ งาน Admin ครบ + งบผ่าน + Advance โอนแล้ว (ถ้าขอ) — ยังไม่ครบ **เขียนเหตุผลบนจอ** (`readyBlockers()`)
- หลังกลับ: Expense Claim (รายการ + มี/ไม่มีใบเสร็จ) + Business Trip Report ต้องยื่นทั้งคู่ → Finance ตรวจ → Final Approval → ลงบัญชี → ECM ปิดงาน
- ยอดหักล้าง = ค่าใช้จ่าย + เบี้ยเลี้ยง − Advance ที่โอน · **อัตราเบี้ยเลี้ยง 3,000 บาท/วัน เป็นตัวอย่าง** (`PER_DIEM_SAMPLE`) วันเดินทางผิด = "คำนวณไม่ได้" ไม่เดา
- ใช้ `JSON` clone แทน `structuredClone` (จอ TV Chromium 94 ไม่มี)
- สิทธิ์: มีแถว `page:/overseas-travel` ใน `/permissions` แต่ **ยังไม่ seed** ⇒ admin เท่านั้น

## ถ้าจะทำเป็นระบบจริง (ยังไม่ได้ทำ · รอ user สั่ง)
ตารางคำขอ/รายการเบิกฝั่ง Main + RLS `has_perm()` + audit · ผู้อนุมัติจริงมาจากผังองค์กร · อัตราเบี้ยเลี้ยงต่อประเทศเป็นทะเบียน ·
แนบไฟล์ใบเสร็จ (`ImageCropModal`/`uploadOpts`) · แจ้งเตือนในแอป (`notification_rules`) · เอกสารพิมพ์ต้อง register `/doc-forms`
