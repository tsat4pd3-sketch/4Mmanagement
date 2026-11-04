# 🗂️ E-Workflow — หมวดงานเอกสาร/อนุมัติไร้กระดาษ (2026-11-04 · คำสั่ง user)

ที่มา: user เจอ concept "e-workflow" — อัปโหลด PDF/รูปเอกสาร → OCR กรอกแทนคน → เชื่อมข้อมูลภายนอกผ่าน
Google Sheet / Shared Drive · สั่งให้ "เพิ่ม sidebar หน้า E-workflow … ดึงใบประกาศ ขอค่าเดินทาง ยุบเป็นหมวดเดียว"
· user เลือก **หมวดใหม่บน sidebar** (ไม่ใช่หน้าเดียวหลายแท็บ) และ **OCR ทำเป็น Mockup ก่อน**

## สมาชิกหมวด (`group: 'E-Workflow'` ใน `NAV_ITEMS` · `src/App.jsx`)
| route | หน้า | สถานะ | เอกสาร |
|---|---|---|---|
| `/e-workflow` | `EWorkflowOcrMockup.jsx` — 🧾 อ่านเอกสารอัตโนมัติ OCR | MOCKUP · admin เท่านั้น (ยังไม่ seed) | ไฟล์นี้ |
| `/announcements` | `AnnouncementMockup.jsx` — 📢 ประกาศบริษัท | MOCKUP · seed admin/manager | `announcement-mockup.md` |
| `/overseas-travel` | `OverseasTravelMockup.jsx` — ✈️ เบิกเดินทางต่างประเทศ | MOCKUP · admin เท่านั้น | `overseas-travel-mockup.md` |

- 2 หน้าหลังย้ายมาจากหมวด "ผู้บริหาร & เดโม" — **route / คีย์สิทธิ์ `page:/…` / seed เดิมไม่เปลี่ยน** (ย้ายแค่ `group`)
- ที่ต้องแก้คู่กันเมื่อแตะหมวดนี้: `NAV_GROUP_ORDER` + `NAV_GROUP_META` (`App.jsx`) · `CARD_META` (`DeptHub.jsx`) ·
  กลุ่มใน `/permissions` (`PermissionsManagement.jsx`) · คำแปล `src/i18n/en.js` (มีด่านเทส)

## `/e-workflow` — OCR Mockup
- **ไม่เขียน DB · ไม่เรียก OCR/AI จริง · ไม่ต่อ Google จริง** — state ในหน้า (รีเฟรช = เริ่มใหม่) · ป้าย 🧪 MOCKUP ห้ามถอด
- แท็บ `?tab=`: `read` อัปโหลด & ตรวจ · `list` ทะเบียนเอกสาร · `link` เชื่อมต่อข้อมูล (Google Sheet)
- เอกสารตัวอย่าง 2 ใบ (ใบส่งของ / ใบวางบิล) จงใจมีช่องอ่านไม่ออก + รหัสไม่ตรงทะเบียน ให้เห็นขั้นคนตรวจ
- สถานะช่อง: ✅ ตรงทะเบียน · ⚠️ ไม่เจอในทะเบียน (ยืนยันได้แต่ติดป้าย) · ❓ อ่านไม่ออก (**ยืนยันไม่ได้จนกว่ากรอกครบ**)
- ส่ง Sheet = ส่งเฉพาะใบที่คนยืนยันแล้ว · 1 แถวต่อ 1 บรรทัดสินค้า

### 🔴 หลักที่ระบบจริงต้องคงไว้
- **ผล OCR = ร่าง ห้ามเขียนลงฐาน/ขยับสต็อกเอง** — คนยืนยันก่อนเสมอ (ENGINEERING-PRINCIPLES §2)
- **อ่านไม่ออก = ว่าง ห้ามเติม 0/ค่าเดา** · จอต้องบอกว่าอ่านได้กี่ช่องจากกี่ช่อง
- **เก็บไฟล์ต้นฉบับผูกกับใบ** (ใบที่รับมาแล้ว = บันทึก) · อัปโหลดผ่าน `uploadOpts()` / `acceptImageFile()`

## ถ้าจะทำเป็นระบบจริง (ยังไม่ได้ทำ · รอ user ตัดสิน)
ต้องได้คำตอบก่อน: ชนิดเอกสารตัวแรก + แผนกเจ้าของ · **อนุญาตส่งรูปเอกสารให้ AI ภายนอกไหม** · Sheet ปลายทางเป็นของใคร
- ตารางใหม่ฝั่ง Main (RLS + GRANT + `has_perm()` + audit + migration) · จับคู่กับ `suppliers` / `parts_master` (DR)
- OCR ผ่าน edge function — มีต้นแบบเรียก Anthropic API แล้วที่ `supabase/functions/telegram-webhook/index.ts` (`ANTHROPIC_API_KEY`)
- Google Sheet ผ่าน service account ของบริษัท · ทิศทางเดียว (ESM → Sheet) เว้นแต่ user สั่ง
