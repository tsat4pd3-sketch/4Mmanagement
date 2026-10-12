# โครงไฟล์ของโปรเจค (ผังโฟลเดอร์ + ของกลางที่ทุก session ควรรู้จัก)

> ย้ายมาจาก `CLAUDE.md` §File Structure (2026-09-30 — CLAUDE.md ชนเพดาน 120 KB)
> **ไม่มีบรรทัดไหนถูกตัดออก** ย้ายมาทั้งดุ้น · CLAUDE.md เหลือสรุปสั้น + ชี้มาที่ไฟล์นี้
>
> ⚠️ ผังนี้เป็น snapshot ที่คนเขียนมือ — **ของจริงดูใน `src/` เสมอ** (เคยล้าสมัยมาแล้วทุกครั้ง)
> แก้ผังเมื่อเพิ่ม/ย้ายของกลาง (components/utils/lib) ไม่ต้องอัพเดททุกครั้งที่เพิ่มหน้า

> รายชื่อไฟล์เต็มดูของจริงใน `src/` — ด้านล่างคือ "ไฟล์โครงสร้าง/ของกลาง" ที่ทุก session ควรรู้จัก
> (เลิกลิสต์ pages ทั้งหมดในเอกสาร — เคยลิสต์แล้วล้าสมัยตลอด · pages ปัจจุบัน ~33 ไฟล์ ดูตาราง Pages & Routes ข้างบน)

```
src/
├── App.jsx            # Router + Sidebar + UserContext + NAV_ITEMS (source of truth เมนู/หมวด)
│                      #   exports: UserContext, NAV_ITEMS, NAV_GROUP_ORDER, NAV_GROUP_META,
│                      #            navItemsForGroups, accessSummaryForRole, Sidebar
├── main.jsx           # bootstrap + RootErrorBoundary + vite:preloadError auto-reload (ห้ามถอด)
├── index.css          # theme variables + CSS กลาง (.now-line/.now-chip, .dt-alarm-*, .person-alarm-*, .table-sticky)
├── supabaseClient.js  # 2 clients: supabase (Main) / supabaseDR (DR — anon เสมอ)
├── components/        # ของกลาง: Toast, ImageCropModal, MachineFloorMap, SpinAnnotator,
│                      #   InternalTimeBoard, SignatureModal, TaxonomyManagerModal, ChangePasswordModal,
│                      #   DowntimeSiren (เสียงเตือน downtime — 2026-07-14)
│                      #   ⭐ picker กลาง (2026-09-07 — UI-CONVENTIONS §5.1.2 บังคับ): LineSelect · SearchSelect ·
│                      #   PersonSelect · MachineSelect · ProductSelect · PartSelect · CustomerSelect · SupplierSelect ·
│                      #   CostCenterSelect · StorageLocSelect · InstrumentSelect · SelectOrFree (select + ระบุเอง ช่องเดียว) ·
│                      #   🏷️ MatLabel (เลข MAT + ชื่องาน + Part No. — ที่ที่คนตัดสินใจจากเลข MAT ห้ามวาด mat_no เปล่า · UI §6.21) ·
│                      #   SimpleMasterPanel (แผง CRUD ทะเบียนเล็ก — ต้นแบบ 2026-09-08)
├── utils/             # กฎ/สูตรกลาง — permissions.js (can/canAccessPage), usePerms.js, sectionScope.js,
│                      #   loader ทะเบียนกลางของ picker: useProductionLines · usePeople · useMachines · useProducts ·
│                      #   useCustomers · useSuppliers · useCostCenters · useDiePressLines (ตาราง master 2026-09-08) · useStorageLocations ·
│                      #   useOrgSections (+useOrgTeams) · usePartOptions · useInstruments · useColumnHistory (📜 ค่าที่เคยบันทึก —
│                      #   ทะเบียนไม่มีก็ยังเลือกได้ ห้ามล้าง/บล็อก) · pickerOptions.js + partOptions.js
│                      #   (pure — มีเทส) · fetchAllRows.js (กับดัก 1000 แถว)
│                      #   mergeRows.js (mergeById/uniqueById — ต่อผล "หลายคิวรีของตารางเดียวกัน"
│                      #     ห้าม `[...a, ...b]` ดิบ: แถวที่ถูกแก้ระหว่าง 2 คิวรี = คีย์ซ้ำ · UI §6.27)
│                      #   🇹🇭 ชั้นภาษา: thaiText.js (ตัดคำไทย ICU · คีย์เสียงข้ามสคริปต์ · ทนพิมพ์ผิด) +
│                      #     termStats.js (log-odds) + autoCategory.js (เดาหมวด) + downtimeCategory.js
│                      #   roleMeta.js (ชื่อ/สี role จุดเดียว), useIsMobile.js, markerScale.js, timeFrame.js,
│                      #   downtimeAlarm.js, personAlarm.js, lineHierarchy.js, companyCalendar.js,
│                      #   otPeriods.js, dateFormat.js, useImgBox.js
├── lib/               # logic เฉพาะโดเมน (pmNotify, pmDailyAlarm, pmExportPDF/Excel, changePointChecklist)
└── pages/             # ~35 หน้า — ชื่อไฟล์ตรงกับ route (⚠️ operator.jsx ตัวพิมพ์เล็ก)

supabase/
├── migrations/        # ทุกการเปลี่ยน schema ต้องมีไฟล์ที่นี่ (ดู docs/sql/00_schema_snapshot_*.sql = โครงตารางทั้งหมด)
└── functions/         # 11 ตัว (ซอร์สอยู่ใน repo ครบ) — รายชื่อ/กติการายตัว ดู docs/modules/edge-functions.md
                       #   ที่ต้องรู้ข้าม session: create-user/delete-user/reset-user-password = admin-only
                       #   (กันลบตัวเอง/ลบ admin · validate role กับ enum ผ่าน RPC get_user_roles ห้าม hardcode)
                       #   · หน้า Login แยก "ไม่พบบัญชี" vs "รหัสผิด" ผ่าน RPC login_email_exists
                       #     (anon เรียกได้ — enumeration trade-off ที่ตั้งใจ ดู migration 20260714)

docs/                  # บังคับอ่าน: ENGINEERING-PRINCIPLES.md (ทุกงาน) · UI-CONVENTIONS.md (งาน UI) ·
                       #   PERMISSIONS-DESIGN.md (สิทธิ์/role) · OBEYA-KPI-SOURCES.md (ก่อนแตะ KPI)
                       #   ที่เหลือดูชื่อไฟล์เอาใน docs/ — เปิดเฉพาะที่เกี่ยวกับงานที่ทำ
                       #   📌 **ออกแบบไว้แล้ว ยังไม่ลงมือ — ห้ามหยิบไปทำเองจนกว่า user สั่ง:**
                       #     IATF16949-GAP-REVIEW · IDENTITY-NOTIFY-DESIGN (แกนสิทธิ์อยู่
                       #       PERMISSIONS-DESIGN.md ห้ามแก้ข้ามไฟล์) · FINANCIAL-GAP-ANALYSIS
                       #       (⚠️ ห้ามใส่ราคาขายเป็นคอลัมน์ใน parts_master ฝั่ง DR — anon อ่านได้ทั้งตาราง) ·
                       #     LOCAL-SERVER-MIGRATION-SPEC (มี 8 จุด hardcode URL Supabase ที่ต้องแก้ก่อนย้าย)
                       #   ⚠️ ไฟล์ *-DESIGN.md ที่ "ทำแล้ว" = เหตุผลเบื้องหลัง · ของจริงอยู่ docs/modules/
```

> **📡 SCADA / ข้อมูลเครื่องจักร realtime — ดู `docs/SCADA_REALTIME_DESIGN.md` ก่อนลงมือเสมอ (2026-08-06)**
> ทิศทางที่ตกลงไว้: ให้ SCADA เป็น **"เซ็นเซอร์"** ส่ง raw data (stroke/สถานะเครื่อง/เวลาหยุด) เข้ามา
> แล้ว **ESM เป็นเจ้าของสูตร** — `src/utils/oee.js` ยังเป็น single source of truth เหมือนเดิม
> **ห้ามให้ระบบภายนอกคำนวณ OEE เองแล้วเอาเลขมาโชว์** (มี OEE 2 ชุด = เถียงกันว่าจะเชื่อจอไหน)
> หลักการ: **SCADA = ข้อเท็จจริง · คน = เหตุผล** (เครื่องบอกได้ว่าหยุดตอนไหน บอกไม่ได้ว่าทำไม · และ**ไม่มีทางรู้ NG** → Q ยังต้องมาจากคนเสมอ)
> ⚠️ ข้อที่มองข้ามบ่อย: ปริมาณแถวจะโต **×113 ถึง ×450** จากที่คนกรอกวันนี้ (DR ตอนนี้ 36MB/500MB) · micro-stop ต้องแยกเป็น P ไม่ใช่ A · **1 stroke งานคู่ = 2 ชิ้น** (ต้องมี `pieces_per_stroke` ไม่งั้นยอดหายครึ่ง)

---


---

## ของกลางที่ใช้บ่อย — ตัวอย่างการเรียก (ย้ายมาจาก CLAUDE.md §Patterns 2026-10-06)

> ย้ายมาเพราะเป็น **ตัวอย่างโค้ด** ไม่ใช่กฎ (กฎรับเข้า CLAUDE.md ข้อ 2) — CLAUDE.md เหลือแค่ชื่อของกลาง

### Toast (singleton · `src/components/Toast.jsx`)
```js
import { toast } from '../components/Toast'
toast.success('บันทึกสำเร็จ')
toast.error('เกิดข้อผิดพลาด')
toast.info('กำลังโหลด...')
```

### UserContext (`src/App.jsx`)
```js
const { role, lineId, team, section, sections, fullName } = useContext(UserContext)
// sections = ขอบเขตส่วนงานผลลัพธ์สุดท้าย (array · [] = ไม่จำกัด)
```

### Skill Fit Scoring (`src/utils/` — ใช้ในหน้าจัดคนเข้าสถานี)
```js
computeFit(employee, station)  // % ของทักษะที่ผ่าน min_score
fitColor(score)                // 80+ green | 60-79 amber | 40-59 orange | <40 red
```
