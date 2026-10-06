# 🏬 บอร์ดสโตร์ (`/heijunka` → UnifiedStoreBoard) — ใครทำอะไร ตอนไหน ส่งให้ใคร (audit 2026-10-05)

user: *"recheck work flow ทุก tab ให้ที ใครทำอะไร ตอนไหน กับใคร ใครส่งใครรับ หมวดนี้หลักๆ คือสโตร์ใช้
และดูเรื่องรูปแบบด้วย เห็นมั้ยว่ามีบาง tab ไม่เหมือน tab อื่น"*

สิทธิ์ปุ่มบนบอร์ด = `can('heijunka','operate')` ทุกแท็บ · ข้อมูลโหลดจาก `loadPull` (ไม่มี realtime — โหลดตอนเปิด + หลังกดปุ่ม)

| แท็บ | ขั้น → ขั้นถัดไป | ใครกด (ปุ่ม) | ส่งจาก → ถึง | เขียนอะไร |
|---|---|---|---|---|
| 🔄 คิวเติม WIP (`wip_replenish_requests` · **Main**) | เรียกแล้ว → กำลังเตรียม | สโตร์ "🔍 เริ่มเตรียม · สแกนพาร์ท" | ไลน์/แผนเรียก → สโตร์หยิบ | CAS สถานะ + ledger DR สโตร์ −qty / ไลน์ +qty |
| | กำลังเตรียม → เติมแล้ว | สโตร์ "📍 ถึงไลน์แล้ว · สแกนจุดส่ง" | สโตร์ → ไลน์ | CAS + `delivered_gate` |
| | เติมแล้ว → รับแล้ว | ไลน์ (Daily Report · `wip_request:receive`) | — | ปิดลูป |
| 🔧 Store Child (`child_lot_requests` · trigger `fn_explode_child_demand`) | รอปล่อยเข้าไลน์ → อยู่ที่ไลน์ผลิต | สโตร์ "📤 ปล่อยเข้าไลน์" **หรือ** ไลน์ "▶ รับงาน" (StoreLotQueue) | สโตร์ → ไลน์ child | CAS สถานะ |
| | อยู่ที่ไลน์ผลิต → เข้าสโตร์แล้ว | สโตร์ "📥 รับของเข้าสโตร์" | ไลน์ → สโตร์ | CAS → ledger issue + consume ใบเบิกวัตถุดิบที่ยัง pending (ล้ม = คืนสถานะ) |
| 🛒 จัดซื้อ (วิว `v_purchase_open_summary` = กลุ่มพาร์ท×สถานะ) | 🆕 รอสั่งซื้อ → 🚚 รอของเข้า | "🛒 สั่งซื้อแล้ว" (เจ้าของตามเอกสาร = วางแผน/จัดซื้อ) | ระบบ (ของไม่พอแผน) → จัดซื้อ | CAS `purchase_requests.status/ordered_*` |
| | 🚚 รอของเข้า → ✅ รับเข้าแล้ว | สโตร์ "✅ รับเข้าสโตร์" / "รวม N ใบ" (PurchaseBulkModal) | ซัพพลายเออร์ → สโตร์ | CAS + ledger (`buildReceiptRows`) |
| 🟫 Store Raw Mat (`raw_withdrawal_requests`) | รอจ่าย → จ่ายแล้ว | สโตร์ "จ่ายวัตถุดิบ" | สโตร์ → ไลน์ child | สถานะอย่างเดียว (CAS + นับแถว) |
| 📦 ภาชนะ/แร็ค | เรียก → เตรียม → ส่ง → รับ | **อ่านอย่างเดียวที่นี่** · ตัวจริง `/rack-center` (`rack_center:operate`) | — | `rack_requests` / `packaging_withdrawal_requests` |
| 🚚 Store FG (รอบส่ง · ซ่อนเมื่อไม่มีรอบ) | ยังไม่ยืนยัน → ยืนยันส่ง → รับครบ | สโตร์ "✅ ยืนยันส่งแล้ว" · "✔️ รับครบ" | สโตร์ → ไลน์ | `kanban_deliveries` + ledger issue |
| 📥 รอรับเข้า (`/line-stock` · `stock_receipts`) | รอรับ/ค้าง → รับแล้ว | คลัง "✅ นับแล้วตรง · รับ N" / "✏️ ยอดไม่ตรง" (`line_stock:issue`) | ไลน์ปิดใบผลิต → คลัง | RPC `stock_receipt_confirm` (ธุรกรรมเดียว) |

## รูปแบบ (05/10)
- แท็บที่มี ≥2 สถานะเปิดใช้ `<StatusZones>` + การ์ด `PartCard` ครบแล้ว: WIP · Child · **จัดซื้อ (ทำ 05/10)** · Raw · รอรับเข้า
- ตั้งใจคงกริดเรียบ: Store FG (สถานะคิดจากเวลา ไม่ใช่คอลัมน์) · แร็ค/ภาชนะ (อ่านอย่างเดียว)
- แท็บจัดซื้อมีบรรทัด "👁 ซ่อนอยู่" แบบเดียวกับแท็บอื่นแล้ว (นับเป็นกลุ่มพาร์ท = หน่วยเดียวกับการ์ด)
- โหลดคิวไม่ได้ ⇒ toast บอกคิวที่ล้ม + **คงข้อมูลรอบก่อน** (เดิมกลืน error แล้วขึ้น "ยังไม่มีรายการ" = จอโกหก)

## ช่องโหว่ที่พบ ยังไม่แก้ (ต้องให้ user เคาะ — กระทบสต็อก/ความเป็นเจ้าของ)
> ตรวจซ้ำกับ main 06/10: **ข้อ 5 แก้แล้ว** (QC 05/10 `deductStockForPick` ตัดซ้ำก่อน "ถึงไลน์แล้ว" · กันซ้ำด้วย note เลขใบ) ·
> **ข้อ 7 แก้ครบ 06/10** ·
> ข้อที่เหลือยังเปิดอยู่
1. ✅ **แก้แล้ว 06/10 (user สั่ง)** — ~~วัตถุดิบไม่ถูกตัดถ้าสโตร์กด "จ่ายวัตถุดิบ" ก่อนปิดล็อต~~
   ตอนนี้ **ใบเบิก 1 ใบ = ตัดสต็อกครั้งเดียว ที่จุดแรกที่ถึง**: `issueRaw` claim pending→issued แล้วเขียน `consume`
   ที่ `source_line` ของล็อตทันที (ล้ม = คืน pending) · ปิดล็อต (`advanceLot` → done) **claim ใบ pending ก่อน** แล้วตัดเฉพาะ
   แถวที่ claim ได้ (ledger ล้ม = คืนทั้งใบเบิกและล็อต) · ล็อตของซื้อ (ไม่มี `source_line`) ไม่ตัดทั้ง 2 ทาง · ด่าน regressionGuards
   · ⚠️ **ข้อมูลเก่า (แก้คำสรุปเดิม 06/10)** — ใบเบิก issued ของล็อตที่ปิดแล้ว 291 ใบ **ไม่มีแถว consume คู่ 30 ใบ**
     (สร้าง 20/08–30/09 · LINE C 200&250T / LINE D 110&300T) · ล็อตที่ยังไม่ปิดไม่มีใบ issued ⇒ ไม่มีใบที่**จะ**พลาดอีก
     ผลคิวรีด้านล่าง (user รัน 06/10): **ทั้ง 30 ใบ = จ่ายก่อนปิดล็อต (บั๊กข้อนี้)** · ทางอื่น (ledger ล้มก่อน 03/09) = 0
   · ✅ **backfill แล้ว 06/10 (user รันเองที่ SQL Editor)** — ลง `consume` ย้อนหลัง **30 แถว / 76,721.6** (LINE C 6 MAT · LINE D 3 MAT)
     · `work_date` = วันเดียวกับแถว "รับ child" ของล็อต (ปิดล็อตลงด้วย `lot.work_date` ไม่ใช่วันกด ⇒ บางแถวเป็น 07/07, 03/08)
       ⇒ ยอดคงเหลือ 9 รายการลดตั้งแต่วันนั้น · หมายเหตุ `auto: ใช้ผลิต <child> (ล็อต · ย้อนหลัง 06/10 ใบเบิก <id 8 ตัว>)` (กันลงซ้ำด้วยหมายเหตุนี้)
     · เช็ค: `select count(*), sum(qty) from line_stock_transactions where type='consume' and note like 'auto: ใช้ผลิต % (ล็อต · ย้อนหลัง 06/10 ใบเบิก %'` = 30 / 76721.6
     · ย้อน: `delete from line_stock_transactions where type='consume' and note like 'auto: ใช้ผลิต % (ล็อต · ย้อนหลัง 06/10 ใบเบิก %'`
     · ⚠️ หลัง backfill คิวรีแยกต้นเหตุด้านล่าง**ยังขึ้น 30 ใบ** (จับคู่หมายเหตุ `(ล็อต)` ตรงตัว) — นับแถวย้อนหลังด้วยคิวรีเช็คข้างบนแทน
   · ❌ ตัวเลข "แถวรับ child เข้าสโตร์มีแค่ 3" ที่เคยเขียน **ผิด** — หมายเหตุ ledger เปลี่ยนคำเมื่อ 02/10 (`fdd933fe`)
     จาก `auto: ผลิตเสร็จ เติมสต็อก Store Child (ล็อต N)` เป็น `auto: รับ child เข้าสโตร์ (ล็อต N)` ⇒ **คิวรีหาแถวของล็อตต้องนับทั้ง 2 แบบ**
     · ทางเดียวที่ตั้งล็อตเป็น `done` = `advanceLot` ใน `HeijunkaKanban.jsx` (ไม่มีฟังก์ชัน DB/migration ไหนตั้ง) ·
     ก่อน 03/09 (`0c918315`) ledger ล้มแล้ว**ล็อตค้าง done เงียบๆ** (ไม่คืนสถานะ) = อีกทางที่ทำให้ไม่มีแถวคู่
   · คิวรีแยกต้นเหตุ (DR "Product DB" `eyhclzkifitbhbljgoav` · อ่านอย่างเดียว) — ล็อตมีแถวรับ child แต่ใบเบิกไม่มี consume
     = ใบถูก "จ่ายวัตถุดิบ" ก่อนปิดล็อต (บั๊กข้อนี้) · ล็อตไม่มีแถวรับ child เลย = ledger ล้มก่อน 03/09 หรือไม่มี `source_line` ตอนปิด
     ```sql
     with r as (
       select r.id, r.raw_mat_no, r.qty, r.created_at, l.id lot_id, l.child_mat_no, l.source_line, l.lot_qty,
         row_number() over (partition by l.source_line, r.raw_mat_no, r.qty, l.child_mat_no order by r.id) rn
       from raw_withdrawal_requests r join child_lot_requests l on l.id = r.lot_request_id
       where r.status = 'issued' and l.status = 'done'),
     t as (
       select line_name, mat_no, qty, note,
         row_number() over (partition by line_name, mat_no, qty, note order by id) rn
       from line_stock_transactions where type = 'consume' and note like 'auto: ใช้ผลิต %(ล็อต%')
     select case when exists (select 1 from line_stock_transactions x
                  where x.type = 'issue' and x.line_name = r.source_line and x.mat_no = r.child_mat_no
                    and (x.note like 'auto: รับ child เข้าสโตร์%' or x.note like 'auto: ผลิตเสร็จ เติมสต็อก Store Child%'))
                 then 'จ่ายก่อนปิดล็อต (บั๊กข้อ 1)' else 'ล็อตไม่มีแถวรับ child (ledger ล้ม/ไม่มี source_line)' end cause,
            count(*) raws, sum(r.qty) qty
     from r left join t on t.line_name = r.source_line and t.mat_no = r.raw_mat_no and t.qty = r.qty
       and t.note = 'auto: ใช้ผลิต ' || r.child_mat_no || ' (ล็อต)' and t.rn = r.rn
     where t.mat_no is null group by 1;
     ```
2. **ขั้น "ปล่อยเข้าไลน์" มีเจ้าของ 2 คน** (สโตร์บนบอร์ด + ไลน์ใน StoreLotQueue) — CAS กันชนแล้ว แต่ความรับผิดชอบไม่ชัด
3. ✅ **แก้แล้ว 06/10 (user เคาะ "ให้เหลือทางปิดล็อตที่บอร์ดสโตร์")** — ~~Child ลงสต็อกซ้ำทาง~~
   เดิม: ปิดล็อตลง `issue` ที่ `source_line` **และ** ไลน์ปั๊มปิดใบผลิต 2xx → `fn_post_confirmed_output` → ใบรอรับ `stock_receipts`
   เข้า `STORE` (กฎ `stock_inflow_rules` prefix `2` · mode `confirm`) ⇒ ของก้อนเดียวโผล่ 2 ที่
   · ตอนนี้ trigger **ข้าม MAT ที่มีใบ `child_lot_requests` (ไม่นับ cancelled)** — migration `20261006d_child_lot_single_stock_path_dr.sql`
     (apply แล้ว · เทียบนิยามก่อน/หลังด้วย md5 = ต่างแค่บล็อกนี้) · MAT อื่นทุกตัวทำงานเหมือนเดิม
   · ตอนแก้: พาร์ทล็อต 23 MAT · **7 MAT เคยได้ยอดจากทางที่ 2** · ใบรอรับค้าง (pending) ของพาร์ทล็อต = **0** (ไม่มีอะไรต้องล้างในคิว)
   · ⚠️ **ข้อมูลเก่ายังไม่แตะ (รอ user เคาะ)** — หลังล้างยอดตั้งต้น 01/10 ทางที่ 2 ลงเข้า `STORE` ไปแล้ว:
     `issue` อัตโนมัติ 66 แถว / 5,838 (01–02/10) + ใบรอรับที่ STORE กดรับแล้ว 54 ใบ / 5,718 (02–05/10)
     ⇒ ยอด STORE ของ 7 MAT นี้มีของจากทางที่ 2 ปนอยู่ (บางตัวมี `consume` ออกไปแล้ว — กลับรายการตรงๆ อาจติดลบ)
   · ย้อน: รันนิยามเดิมจาก `20261002_stock_receipts_confirm_dr.sql`
4. ✅ **แก้แล้ว 06/10 (user สั่ง)** — ~~รับของซื้อแบบรวมหลายใบ ไม่ย้อนเมื่อ ledger ล้ม~~ (`PurchaseBulkModal`)
   `revertClaimed()` คืนใบที่ขยับไปแล้วกลับสถานะเดิม (ล้างเฉพาะ `*_by/*_at` ของขั้นนั้น · CAS `.eq('status', next)` · นับแถวจริง)
   ใน 2 จุด: **บันทึกรับเข้าคลังล้ม** และ **เลื่อนสถานะก้อนหลัง (ก้อนละ 120) ล้ม** ทั้งที่ก้อนแรกขยับไปแล้ว ·
   คืนไม่ครบ = toast แดงบอกจำนวน + "แจ้ง admin" · ล้มแล้วโหลดใบ/บอร์ดใหม่ · ด่าน regressionGuards
5. **WIP ตัดสต็อกตอนหยิบล้ม = ใบค้าง preparing ไม่มีทางตัดซ้ำ**
6. **ขั้น "สั่งซื้อแล้ว" ไม่มีจอของเจ้าของ** (ไม่มีเลข PO · คิวงานของฉันนับใบ cancelled รวมด้วย)
7. ✅ **แก้ครบ 06/10** — ~~เพดาน 200/400 แถว เรียงใหม่→เก่า ⇒ ใบค้างเก่าหลุดจากคิวและตัวเลขบนแท็บ~~
   ใบ child/ใบเบิกวัตถุดิบ (QC 05/10) + **rack/บรรจุภัณฑ์ ทั้ง `/heijunka` และ `/rack-center`** (06/10) โหลด "ใบค้างครบทุกใบ + ประวัติล่าสุด N"
   ผ่าน **`openPlusHistory()` ของกลางใน `src/utils/fetchByIds.js`** (ย้ายจาก HeijunkaKanban · รับคอลัมน์เวลา — `rack_requests` ไม่มี `created_at` ใช้ `requested_at`)
   · ใบค้าง rack = ไม่ใช่ `received/cancelled` · บรรจุภัณฑ์ = ไม่ใช่ `issued/cancelled` (status NOT NULL ทั้งคู่) ·
   `/rack-center` เดิมกลืน error แล้วบอร์ดว่าง ⇒ ตอนนี้ toast + คงข้อมูลรอบก่อน · เทส `openPlusHistory.test.mjs` + ด่าน regressionGuards
8. ✅ **แก้แล้ว 06/10 (user สั่ง)** — ~~ฝั่งไลน์ (`LinePartCallPanel`) ยกเลิก/รับใบ WIP ได้จากทุกสถานะ ไม่นับแถว~~
   ปุ่มบนจอถูกอยู่แล้ว (ยกเลิกโชว์แค่ใบ `hold` · รับโชว์แค่ใบ `delivered`) แต่คำสั่ง DB ไม่ล็อก ⇒ จอค้างยกเลิกใบที่สโตร์หยิบ/ตัดสต็อกแล้วได้
   และกดรับชุบใบ `cancelled` ได้ · ตอนนี้ CAS `.eq('status','hold'|'delivered')` + `.select('id')` นับแถว · 0 แถว = toast แดง + โหลดใหม่ · ด่าน regressionGuards
