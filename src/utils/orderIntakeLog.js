/**
 * 📜 ประวัติ "order เข้าระบบทางไหนบ้าง" — รวม 3 ทางเข้าไว้ในไทม์ไลน์เดียว
 *
 * ที่มา (user 2026-09-09): *"สิ่งที่อัพโหลดไป ให้มี log และ tab เข้าไปดูด้วยสิ รวมถึงงาน add order"*
 *
 * ทำไมต้องรวมเป็นไทม์ไลน์เดียว ไม่แยก 3 ลิสต์:
 * คำถามจริงของหน้างานคือ **"ใบนี้/ยอดนี้มาจากไหน ใครทำ เมื่อไหร่"** ซึ่งตอบได้ก็ต่อเมื่อเห็นทั้ง 3 ทาง
 * เรียงเวลาเดียวกัน (อัพ 862 ตอนเช้า → e-SMART ยืนยันตอนบ่าย → คีย์มือแทรกตอนเย็น = เรื่องเดียวกัน)
 *
 * | ทางเข้า | ตาราง | ระดับ |
 * |---|---|---|
 * | 📄 EDI 862/830 | `demand_upload_batches` (DR) | ต่อไฟล์ |
 * | 📥 e-SMART | `customer_pull_batches` (DR) | ต่อไฟล์ |
 * | ➕ คีย์มือ | `customer_shipping_orders` (`source='manual'`) | ต่อใบ |
 *
 * ⚠️ pure function ล้วน ไม่แตะ DB/UI (เทส `__tests__/orderIntakeLog.test.mjs`)
 */

/** ป้าย/สีต่อทางเข้า — สีสื่อความหมายเดียวกับปุ่มบนหัวหน้า Delivery */
export const INTAKE_KINDS = {
  esmart: { label: '📥 e-SMART (ลูกค้ายืนยัน)', short: 'e-SMART', color: '#0ea5e9' },
  manual: { label: '➕ คีย์มือ (order ด่วน)',    short: 'คีย์มือ',  color: '#22c55e' },
  edi:    { label: '📄 EDI (แผนจากลูกค้า)',      short: 'EDI',     color: '#a855f7' },
};

const ts = (v) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
};

/**
 * รวม 3 แหล่งเป็นไทม์ไลน์เดียว เรียงใหม่→เก่า
 *
 * ⚠️ **ห้ามตัดแหล่งไหนทิ้งเงียบเมื่อโหลดไม่สำเร็จ** — ผู้เรียกต้องส่ง `errors` มาแสดงบนจอแยก
 * (ลิสต์ที่ขาดแหล่งไปเงียบๆ = คนอ่านสรุปว่า "ไม่มีใครอัพ" ทั้งที่แค่คิวรีล้ม)
 *
 * @returns {Array<{key,kind,at,ship_to,by,title,detail,stats,ref}>}
 */
export function mergeIntakeLog(src) {
  // ⚠️ default param ครอบแค่ `undefined` — คิวรีที่ล้มคืน `data: null` มาตรงๆ ได้ (เทสล็อกไว้)
  const { pullBatches, ediBatches, manualOrders } = src || {};
  const out = [];

  (pullBatches || []).forEach(b => out.push({
    key: `pull:${b.id}`, kind: 'esmart', at: b.uploaded_at, ship_to: b.ship_to || null,
    by: b.uploaded_by || null,
    title: b.file_name || 'ไฟล์ e-SMART',
    detail: [
      b.window_start && b.window_end ? `ช่วง ${hhmm(b.window_start)}–${hhmm(b.window_end)}` : null,
      b.work_date && b.ship_time ? `→ รอบส่ง ${b.ship_time} (${b.work_date})` : null,
    ].filter(Boolean).join(' '),
    stats: {
      rows: num(b.row_count), fresh: num(b.new_signals),
      updated: num(b.orders_updated), created: num(b.orders_created), skipped: num(b.orders_skipped),
    },
    ref: { batch_id: b.id, work_date: b.work_date, ship_time: b.ship_time },
  }));

  (ediBatches || []).forEach(b => out.push({
    key: `edi:${b.id}`, kind: 'edi', at: b.uploaded_at, ship_to: null,
    by: b.uploaded_by || null,
    title: b.file_name || (b.kind === 'orders' ? 'EDI 862' : 'EDI 830'),
    detail: b.kind === 'orders' ? 'ใบสั่งซื้อ (862)' : 'Forecast (830)',
    stats: { rows: num(b.row_count) },
    ref: { batch_id: b.id, kind: b.kind },
  }));

  (manualOrders || []).forEach(o => out.push({
    key: `ord:${o.id}`, kind: 'manual', at: o.created_at, ship_to: o.customer || null,
    by: o.created_by_name || null,
    title: `${o.mat_no}${o.customer_part_no ? ` · ${o.customer_part_no}` : ''}`,
    detail: [o.part_name, o.due_date ? `ส่ง ${o.due_date}${o.ship_time ? ` ${String(o.ship_time).slice(0, 5)}` : ''}` : null]
      .filter(Boolean).join(' · '),
    stats: { qty: num(o.qty) },
    ref: { order_id: o.id, status: o.status },
  }));

  // เวลาเท่ากัน = เรียงด้วย key ให้ผลนิ่ง (ไม่งั้นลำดับสลับไปมาทุกครั้งที่โหลด)
  return out.sort((a, b) => ts(b.at) - ts(a.at) || String(a.key).localeCompare(String(b.key)));
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const hhmm = (v) => {
  const d = new Date(v);
  return Number.isFinite(d.getTime())
    ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '—';
};

/** สรุปหัวแถบ — นับรายการต่อทางเข้า + ผลรวมของ e-SMART ที่เขียนใบจริง */
export function intakeSummary(entries) {
  const s = { total: 0, esmart: 0, manual: 0, edi: 0, ordersUpdated: 0, ordersCreated: 0, ordersSkipped: 0 };
  (entries || []).forEach(e => {
    s.total++;
    s[e.kind] = (s[e.kind] || 0) + 1;
    if (e.kind === 'esmart') {
      s.ordersUpdated += num(e.stats?.updated);
      s.ordersCreated += num(e.stats?.created);
      s.ordersSkipped += num(e.stats?.skipped);
    }
  });
  return s;
}

/** กรองไทม์ไลน์ — คืนชุดใหม่เสมอ (ไม่แก้ของเดิม) */
export function filterIntake(entries, { kind = 'all', shipTo = '', q = '' } = {}) {
  const key = String(q || '').trim().toLowerCase();
  return (entries || []).filter(e => {
    if (kind !== 'all' && e.kind !== kind) return false;
    // EDI ไม่ได้เก็บ ship-to ต่อไฟล์ (1 ไฟล์ครอบหลายเจ้า) → กรองลูกค้าแล้วต้องไม่ตัดทิ้ง
    if (shipTo && e.ship_to && e.ship_to !== shipTo) return false;
    if (key && !`${e.title} ${e.detail} ${e.by || ''} ${e.ship_to || ''}`.toLowerCase().includes(key)) return false;
    return true;
  });
}
