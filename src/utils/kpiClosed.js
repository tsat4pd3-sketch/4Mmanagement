/* ── 🗄️ KPI ที่ "ปิดใช้งาน" (soft delete · is_active=false) — หาแถวเดิมเพื่อ "เปิดคืน" แทนการเพิ่มซ้ำ (2026-10-07)
   feedback หน้างาน 07/10: "ผมเผลอปิดหัวข้อ KPI ไป จะนำกลับมายังไง add ใหม่ไม่ได้"
   · ปิดใช้งาน = แถวยังอยู่ (ค่าที่กรอกไว้ยังอยู่) แต่ **ยังครองคีย์ unique** ของ kpi_definitions
     (migration 20260916: (year, scope_kind, scope_value, catalog_id) และ (…, source))
     ⇒ เพิ่มตัวเดิมใหม่ = 23505 แล้วจอเดิมบอกว่า "ถูกตั้งไว้แล้ว — แก้ที่แถวเดิม" ทั้งที่แถวเดิมมองไม่เห็น = ทางตัน
   · ทางออก = เปิดคืนแถวเดิม (is_active=true) — ค่ารายเดือน/แผน/หมายเหตุที่ผูก id เดิมกลับมาครบ ไม่ต้องกรอกใหม่
   กติกาจับคู่อยู่ที่นี่ที่เดียว (pure · มีเทส) — จอเรียก `findClosedTwin()` ตอนเจอ 23505 หรือก่อน insert */

const same = (a, b) => String(a ?? '') === String(b ?? '');
const normName = (s) => String(s ?? '').toLowerCase().replace(/[\s\-_./()]+/g, '');
const kindOf = (d) => (d?.scope_kind && d.scope_kind !== 'plant' ? d.scope_kind : 'plant');
const valueOf = (d) => (kindOf(d) === 'plant' ? '' : String(d?.scope_value ?? ''));

/**
 * หาแถวที่ปิดใช้งานอยู่ ซึ่ง "คือตัวเดียวกัน" กับแถวที่กำลังจะเพิ่ม — ในปี+ขอบเขตเดียวกันเท่านั้น
 * ลำดับความแน่ใจ: catalog_id ตรง → source (auto:*) ตรง → std_item_id ตรง → ชื่อเทียบแบบ normalize
 * (ขอบเขตต้องตรงเป๊ะ — นิยามของแผนกแม่ที่ปิดไว้ ไม่ใช่ "ตัวเดียวกัน" กับที่กำลังเพิ่มให้ลูก)
 * @param closed  แถว kpi_definitions ที่ is_active=false (โหลดมาแล้ว)
 * @param payload แถวที่กำลังจะ insert ({ year, scope_kind, scope_value, catalog_id?, source?, std_item_id?, name? })
 * @returns แถวเดิม หรือ null
 */
export function findClosedTwin(closed = [], payload = {}) {
  if (!payload || !Array.isArray(closed) || !closed.length) return null;
  const pool = closed.filter(d => d && d.is_active === false && same(d.year, payload.year)
    && kindOf(d) === kindOf(payload) && valueOf(d) === valueOf(payload));
  if (!pool.length) return null;
  const byCat = payload.catalog_id ? pool.find(d => same(d.catalog_id, payload.catalog_id)) : null;
  if (byCat) return byCat;
  const src = payload.source && payload.source !== 'manual' ? payload.source : null;
  const bySrc = src ? pool.find(d => same(d.source, src)) : null;
  if (bySrc) return bySrc;
  const byStd = payload.std_item_id ? pool.find(d => same(d.std_item_id, payload.std_item_id)) : null;
  if (byStd) return byStd;
  const nm = normName(payload.name);
  if (!nm) return null;
  // ชื่อเทียบได้ทั้ง 2 ทาง — ชื่อที่พิมพ์ในแถว และชื่อในทะเบียน (แถวเก่าอาจพิมพ์ชื่อไว้ก่อนผูกทะเบียน)
  return pool.find(d => normName(d.name) === nm || normName(d.kpi_catalog?.name) === nm) || null;
}

/** ข้อความถาม "เปิดคืนแทนไหม" — ใช้ร่วมทุกจุด (จอ ⚙️ · โมดัล 📘) ให้พูดเหมือนกัน */
export function restoreQuestion(twin, yearBE) {
  const nm = twin?.kpi_catalog?.name || twin?.name || 'KPI นี้';
  return `"${nm}" เคยถูกปิดใช้งานไว้ในปี ${yearBE} ขอบเขตนี้ — เปิดคืนแถวเดิมแทนการเพิ่มใหม่?\n`
    + 'ค่ารายเดือน/แผน/หมายเหตุที่เคยกรอกไว้จะกลับมาด้วย (ไม่ต้องกรอกใหม่)';
}
