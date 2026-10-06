/* ══ 📡 ทะเบียนตารางที่โค้ด subscribe realtime — จุดเดียวทั้งระบบ (2026-10-06) ═══════════
 *
 * 🔴 ปัญหาที่ทะเบียนนี้มีไว้แก้ — **subscribe ตารางที่ไม่อยู่ใน publication = เงียบสนิท**
 *    ไม่มี error · ไม่มี warning · `subscribe()` คืน `SUBSCRIBED` ปกติ · แค่ไม่มี event วิ่งมาเลย
 *    ⇒ จอยังรีเฟรชอยู่ (เพราะมี poll กันเหนียว) แต่ช้าได้ถึง **hard floor 2 ชั่วโมง**
 *    และ `makeIdleGate` ที่คอยข้ามรอบ poll ก็ไม่เคยถูก touch ⇒ ยิ่งช้า
 *
 * 📉 เกิดซ้ำมาแล้ว 3 รอบ เพราะไม่มีด่าน:
 *    · 2026-08-19 — `mtn_orders` ตกหล่น (`20260819_realtime_mtn_orders.sql`)
 *    · 2026-09-15 — ไล่เทียบ "โค้ด subscribe อะไร" vs "publication มีอะไร" แล้ว **ไม่ตรงกันเลย**
 *      (`20260915_realtime_publication_main.sql` · `..._dr.sql` · ดู docs/POLLING-AUDIT-2026-09-15.md)
 *    · 2026-10-06 — ขาดอีก 4: `monitor_cells`/`monitor_board_parts` (DR · จอ /monitoring)
 *      · `daily_production_logs`/`four_m_logs` (Main · แถบหน้าแรก ซึ่งเขียนคอมเมนต์กลัวอาการนี้ไว้เองแล้ว)
 *    ต้นเหตุร่วม: เอกสารเก็บลิสต์เป็น**มือ** ("ตอนนี้ครบ 5") แล้วล้าสมัย — คนถัดไปเชื่อลิสต์นั้น
 *
 * ✅ กติกาใหม่: **เพิ่มชื่อตารางลง `tables:` / `table:` ที่ไหนก็ตาม ต้องมาเติมที่นี่ด้วย**
 *    (มีด่าน `realtime-table-registered` ใน regressionGuards — ไม่เติม = build ล่ม)
 *    แล้วด่านจะบังคับให้คุณตอบ 1 คำถาม: **ตารางนี้อยู่ project ไหน และเขียน migration แล้วยัง**
 *
 * 🧾 SQL ตรวจของจริง (รันทีละ project ใน Supabase SQL Editor):
 *      select tablename from pg_publication_tables
 *      where pubname = 'supabase_realtime' and schemaname = 'public' order by 1;
 *    ⚠️ ต้องรัน **ทั้ง 2 project** — ตารางชื่อเดียวกันมีได้ทั้ง 2 ฝั่ง (เช่น `notifications`
 *       มีทั้ง Main และ DR แต่โค้ด subscribe เฉพาะฝั่ง Main)
 */

/** `ชื่อตาราง` → project ที่โค้ด subscribe จริง (`'main'` = MAIN · `'dr'` = Product DB) */
export const REALTIME_TABLES = {
  /* ── DR — ชื่อในจอ Supabase "Product DB" · eyhclzkifitbhbljgoav ── */
  child_lot_requests:      'dr',
  defect_logs:             'dr',
  downtime_logs:           'dr',
  inspections:             'dr',
  line_stock_transactions: 'dr',
  monitor_board_parts:     'dr',
  monitor_cells:           'dr',
  mtn_orders:              'dr',
  prod_orders:             'dr',
  production_sessions:     'dr',
  rack_requests:           'dr',
  stock_receipts:          'dr',

  /* ── Main — ชื่อในจอ Supabase "MAIN" · ewhdfqwfwofivojtsizn ── */
  daily_production_logs:   'main',
  four_m_logs:             'main',
  line_helpers:            'main',   // เพิ่ม 06/10 — ด่านนี้จับได้ตอน merge ว่าตกหล่น publication (รอบที่ 4 ของบั๊กคลาสนี้)
  meeting_action_items:    'main',
  notifications:           'main',
  qa_fme_obligations:      'main',
  role_permissions:        'main',
};

/** ตรวจแล้วกับ DB จริงเมื่อ — อยู่ใน publication ครบทั้ง 18 ตารางทั้ง 2 ฝั่ง */
export const REALTIME_VERIFIED_AT = '2026-10-06';
