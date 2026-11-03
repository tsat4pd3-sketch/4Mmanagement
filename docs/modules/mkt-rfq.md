# 💼 RFQ / เสนอราคา — Marketing (Q-neX เฟส 1) · `/rfq` (2026-10-30)

> โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน
> แบบเต็ม/เหตุผล/เฟสถัดไป → `docs/MARKETING-QNEX-DESIGN.md` (ถอดจากเด็ค POC + flowchart + ชุดตัวอย่าง FORD ที่ user ส่ง)
> คำสั่ง user 30/10: *"ESM เป็น Q-neX เลย … เป็น module แยกที่สร้างเมื่อวาน สำหรับ marketing กับ new model"* + *"เริ่มเฟส 1 ตามที่เสนอ"*

## 1. โมดูลนี้คืออะไร / วางตรงไหน

**ต้นน้ำสุด**ของสายธาร `Marketing → New Model (NPI) → โรงงาน` — เฟส 1 ตั้งใจ **ปิดลูปทั้ง 3 ข้อต่อให้ต่อกันก่อน** แล้วค่อยฉลาด (auto-calc · มอบงานแผนก = เฟส 2-3)

| ข้อต่อ | ทำแล้ว (เฟส 1) | ที่ไหน |
|---|---|---|
| ลูกค้า → Marketing | ทะเบียน RFQ + พาร์ท/ชิ้นย่อย + volume (บอกที่มา) + สถานะ | `/rfq` แท็บ 📋 |
| **Marketing → IEC** | **ส่ง CRD = สร้าง/ผูกโปรเจค NPI** (ระบบเสนอชื่อ/พาร์ท คนยืนยัน) | ปุ่ม 📨 · `mkt_rfqs.npi_project_id` |
| **NPI → โรงงาน** | **ได้งาน → ออกใบแจ้งจัดทำ F-MKT-001/002** (เขียนทะเบียนก่อนพิมพ์ · พิมพ์ซ้ำ = ใบเดิม) | ปุ่ม 🖨️ · `mkt_awards.production_order_*` |
| สรุปผล | ได้งาน/ไม่ได้งาน + ยอดขาย/ปี แบบ Model Report | แท็บ 📈 |

- อยู่ใน **edition "ก่อน SOP"** เดียวกับ `/npi` `/nm-board` (`src/appEdition.nm.js`) · เมนูหมวด "คุณภาพ & วิศวกรรม" ต่อจาก `/nm-board`
  (ไม่เปิดหมวด "การตลาด" ใหม่ในเฟสนี้ — เว็บ edition นั้นมีหมวดเดียวอยู่แล้ว · เปิดเมื่อหน้ามาเก็ตติ้งมีหลายหน้า = migration `nav_groups`)
- 🔴 **ตาราง `mkt_*` อยู่ Main เท่านั้น** — มีราคาเป้าหมายลูกค้า/ราคาเสนอ/PO · DR เป็น anon-open (ข้อห้ามเดียวกับ `parts_master`)

## 2. ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `src/pages/Rfq.jsx` | หน้า 2 แท็บ `?tab=list\|report` + `?rfq=<id>` (ใบงาน) · โมดัล RFQ / พาร์ท / CRD→NPI / ผล |
| `src/utils/mktRfq.js` | **กฎกลาง (pure · เทส 7 เคส)** — สถานะ+โทน · `nextRfqNo` · `nextProductionOrderNo` · `annualSales` · `awardSummary` · `npiProjectDraftFromRfq` · `buildProductionOrderSnapshot` · `snapshotDrift` |
| `src/lib/mktProductionOrderDoc.js` | ใบแจ้งจัดทำ — `issueProductionOrder` (เขียน `mkt_awards` ก่อนพิมพ์) · `reprintProductionOrder` (จาก snapshot) · HTML 2 หน้า อ่าน `docFormSync('mkt_production_order'/'mkt_production_parts')` |
| `supabase/migrations/20261030a_marketing_role_enum_main.sql` | enum `marketing` (ท่อน 1 — ต้องรันแยก) |
| `supabase/migrations/20261030b_mkt_rfq_phase1_main.sql` | 3 ตาราง + RLS + audit + catalog/seed สิทธิ์ + doc_forms (ท่อน 2) — **apply แล้ว 30/10 ทั้ง 2 ไฟล์ · ตรวจกลับแล้ว** |

## 3. ตาราง (Main · prefix `mkt_`)

| ตาราง | คืออะไร | จุดสำคัญ |
|---|---|---|
| `mkt_rfqs` | 1 แถว = 1 งานเสนอราคา | `rfq_no` unique (`RFQ-YYYY-###`) · `status` CHECK **ครบทั้ง 13 ค่า** ของ state machine (เฟส 1 จอใช้ `RFQ_STATUS_PHASE1`) · `customer_target_price` 🔒 · `annual_volume` + **`volume_source` บังคับเมื่อมี volume** · `crd_no`/`crd_sent_at` · `npi_project_id → npi_projects` (set null) |
| `mkt_rfq_parts` | พาร์ท + ชิ้นย่อย | `parent_part_id` self-FK (PIA01-03 ชี้แม่) · unique (rfq, part_no) · เลขพาร์ทลูกค้า = **พิมพ์เองได้โดยตั้งใจ** (ของใหม่ ยังไม่มีในทะเบียนไหน) |
| `mkt_awards` | ผลสุดท้าย + ทะเบียนใบแจ้งจัดทำ | `rfq_id` **unique** (1 RFQ = 1 ผล · upsert onConflict rfq_id) · CHECK `lost` ต้องมี `loss_reason` · CHECK ใบแจ้งจัดทำออกได้เฉพาะ `awarded` · `annual_sales` = คำนวณตอนบันทึก (null ถ้าขาด) · `production_order_no` unique + `snapshot` jsonb + `reprint_count` |

RLS: select = authenticated · insert/update/delete = `has_perm('rfq:edit')` (`mkt_awards` = `has_perm('rfq:award')`) · `fn_set_updated_at` + `fn_audit` ทั้ง 3 (ป้ายไทยใน `auditLabels.js`)

## 4. สิทธิ์ + role

| key | ความหมาย | seed |
|---|---|---|
| `page:/rfq` | เข้าหน้า | admin · manager · **marketing** · engineer_nm · engineer (ดู CRD ที่ส่งมา) |
| `rfq:edit` | สร้าง/แก้ RFQ · พาร์ท · ส่ง CRD / ผูก NPI | admin · manager · marketing |
| `rfq:award` | บันทึกผล · ออกใบแจ้งจัดทำ | admin · manager · marketing |

**role `marketing`** (ใหม่ · `roleMeta.js` 💼 · axis unit) — ทำครบ 5 จุดตาม `role-system.md`: enum 2 ไฟล์ · ROLE_META · seed สิทธิ์ · ไม่มี role array hardcode ที่ต้องแก้ · ย้าย role แล้วต้อง F5
· marketing ได้ `page:/npi` + `page:/nm-board` **ดูอย่างเดียว** (ต้องเปิดโปรเจคที่ตัวเองส่ง CRD ไปได้) — ไม่ให้ `npi:edit`
· 🔴 **"เห็นกัน" ตามคำ user = เว็บเดียวกัน** · การเห็นงานกันจริงยังตัดสินที่ `role_permissions` — เปิด/ปิดเพิ่มที่ `/permissions`

## 5. กฎที่ตกผลึก (ห้ามแก้ย้อนโดยไม่ update ไฟล์นี้)

1. **volume ต้องบอกที่มา** — ชุดตัวอย่าง FORD มี 3 ชุดคนละค่า (RFQ 67k · ประมาณการขาย 471k/7 ปี · Model Report 10k) ⇒ ช่อง `volume_source` บังคับเมื่อใส่ volume · จอรายการขึ้น `?` เมื่อไม่มีที่มา · ใบแจ้งจัดทำพิมพ์ที่มาไว้ด้วย
2. **ยอดขาย/ปี = volume × ราคาชิ้น · ขาดตัวใดตัวหนึ่ง = `null` ห้าม 0** (`annualSales` · ปัดสตางค์) · Model Report นับ `unknownSales` แยกและ**เขียนบนจอ** ว่ากี่ใบไม่รวมในยอด
3. **ระบบเสนอ คนตัดสิน** — CRD→NPI: ระบบเสนอชื่อโปรเจค/พาร์ทแม่/SOP จาก RFQ (`npiProjectDraftFromRfq`) คนแก้แล้วกดยืนยัน · สร้างด้วยท่าเดียวกับ `/npi` (`nextProjectCode` + `buildPartRows` จากแม่แบบ) · **ไม่เขียนทับสิ่งที่ IEC ทำไว้ใน NPI** · ผูกโปรเจคที่มีอยู่แล้วก็ได้
4. **ใบแจ้งจัดทำ = บันทึก** (ต้นแบบ `prodProblemDoc.js`) — ออกเลขที่ (`MKT/<running รายปี>/<MM>/<YYYY>` · เลขสูงสุด+1 · ห้าม `count()+1`) → เขียน `mkt_awards` → **แล้วค่อยพิมพ์** · เขียนไม่สำเร็จ/0 แถว = ไม่พิมพ์ (`checkWriteRows` + `.is('production_order_no', null)` กันออกซ้อน) · พิมพ์ซ้ำ = snapshot เสมอ + `reprint_count` · ข้อมูลปัจจุบันต่างจากใบ = `snapshotDrift` เขียนบนจอ
   · เลขฟอร์ม/Rev/ช่องเซ็น/footer อ่านจาก `doc_forms` (`F-MKT-001`/`F-MKT-002` seed form_code จริง · rev/effective ให้ doc_control ตั้ง) **ห้าม hardcode**
   · ⚠️ รูปแบบเลขของจริง `MKT1./366/05/2020` — เราออก `MKT/367/06/2026` (ตีความว่า running รายปี) **ยังต้องให้ Marketing ยืนยัน** (DESIGN §9 ข้อ 6)
5. **เปลี่ยนผลหลังออกใบแจ้งจัดทำไม่ได้** (CHECK ฝั่ง DB + จอบล็อก) — ออกใบผิด = admin แก้ฐาน + บันทึกเหตุ (ใบกระดาษอยู่ในมือโรงงานแล้ว)
6. **ลบ RFQ ที่มีผลตัดสินแล้วไม่ได้** — เปลี่ยนสถานะเป็น `cancelled` แทน (ประวัติ won/lost ต้องอยู่)
7. **สี = `statusColor(tone)`** จาก `statusTone.js` — `RFQ_STATUS[].tone` เป็นคีย์ good/warn/bad/none ไม่ใช่ hex (มีเทส + ด่าน `status-palette-single-source`)
8. **ห้ามเงียบ** — ทะเบียนโหลดไม่ได้ = `WarnBar` · ตัวกรองซ่อน N รายการเขียนบนจอ · `?rfq=` ที่หาไม่เจอ = เขียนบอก · ไม่มีสิทธิ์ = `ReadOnlyNote`
9. **รายการ RFQ = ตาราง `.rec-list`** (UI §6.25 — โตตามการใช้งาน) · แถว "ด่วน" ที่ยังไม่ปิด = `rec-row-alert`

## 6. ยังไม่ทำ (เฟส 2-4 — ดู DESIGN §8 · ห้ามเริ่มจนกว่า user สั่ง)

- มอบงานแผนก (`mkt_rfq_tasks` · IEC/RDPP/R&D/TSAT P.3/Purchasing) + checklist gatekeeper 14 รายการ + access matrix ต่อชนิดเอกสาร + คิวงานของฉัน
- ไฟล์ RFQ (CPL · CAD zip 28 MB · MSOW) — bucket ยังไม่สร้าง · เฟสนี้เก็บเลขอ้างอิงอย่างเดียว
- ต้นทุน ①–⑤ (`mkt_rate_tables` + `mktCost.js` ต้องตรง `TS Cost Breakdown.xlsx` 100% — user ยืนยันแล้วว่าไฟล์นี้คือ Master) · ใบเสนอราคา 2 ชั้นอนุมัติ + REV · ส่งออกฟอร์ม Ford PP-P-F104c
- ใบ CRD เป็นใบพิมพ์ (ตอนนี้เก็บเลขที่/วันส่ง) · การแจ้งเตือนเข้ากระดิ่ง IEC เมื่อ CRD มา
- KPI CSC "bidding processes vs actual" (golden thread RFQ ↔ NPI ↔ พาร์ทจริง)
- หมวดเมนู "การตลาด" แยก · EDITION_LABEL/HOME ของเว็บก่อน SOP (รอชื่อร่วมจาก user)

## 7. วิธีใช้บนตัวอย่าง FORD (ตามชุดเอกสารจริง)

1. `/rfq` → **+ RFQ** → ลูกค้า FORD · รุ่น MY2020 T6 · ปั๊มเหล็ก · volume 67,387 (ที่มา: RFQ) · APW 1,428 · SOP 13/12/2021
2. **+ พาร์ท** `MB3C-2B614-AA` (แม่) แล้ว PIA01/02/03 ชี้แม่ (qty 1/2/2 · WSS-M1A367-A46 1.8 mm · EDP)
3. **📨 ส่ง CRD** → เลข `MKT1/136/2020` → สร้างโปรเจค NPI (แม่แบบ APQP) → IEC ทำต่อที่ `/npi` · สถานะ RFQ = "IEC กำลังประเมิน"
4. ลูกค้าตอบ → **🏁 บันทึกผล** ได้งาน · ราคา 21.61 · volume ที่ใช้คิด 10,000 · PO/TO → ยอดขาย/ปี ออกเอง
5. **🖨️ ออกใบแจ้งจัดทำ** → ได้เลข `MKT/001/10/2026` + พิมพ์ 2 หน้า (F-MKT-001 + F-MKT-002) ส่งฝ่ายโรงงาน · พิมพ์ซ้ำได้ตลอด ใบเดิม

## 8. ประวัติ

- **2026-10-30** — เฟส 1 ครั้งแรก · build 3707/3707 · crashsweep (list/sheet/report × 2 role) พัง 0 · mobilesweep 87 หน้า 0 · migration apply + ตรวจกลับ (3 ตาราง · 12 policy · 6 trigger · 13 แถวสิทธิ์ · 2 doc_forms)
