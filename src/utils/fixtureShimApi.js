/* ═══════════════════════════════════════════════════════════════════════════
   บันทึกเหตุการณ์ชิม (fixture_shim_events) + อัปเดตสถานะจุด — จุดเดียวของทั้งระบบ   2026-09-08

   ผู้เรียก: แท็บ 🔧 บันทึกชิม (FixtureShimPanel) และ ใบตรวจ PM (PMCheckData — กรอกค่าชิมพร้อมตรวจ)
   ⚠️ เดิม FixtureShimPanel เขียน insert เอง และ **ไม่เคย stamp `last_check_at`/`last_check_shot`**
      → pointDueStatus (แกนวัน/แกน shot) ไม่เคยรีเซ็ตหลังตรวจ = จุดถึงกำหนดค้างตลอดกาล
      ตัวนี้ stamp ให้ทุก event (ทุก event = มีคนไปดูจุดนั้นจริง) — ห้ามกลับไป insert ตรงในหน้า
   กฎเหล็ก 4 ของโมดูล: เก็บ before/after/delta ครบ 3 · ค่ารวมปัจจุบัน = ค่าจาก event ล่าสุด (ไม่บวกสะสม)
   ═══════════════════════════════════════════════════════════════════════════ */
import { supabaseDR } from '../supabaseClient';

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * @param {object} p
 * @param {object} p.point         แถว fixture_points (ต้องมี id · current_shim_mm)
 * @param {number} p.afterMm       ค่ารวมหลังบันทึก (mm) — บังคับ
 * @param {string} p.action        add | remove | check | part_replaced | adjust (ค่าใน SHIM_ACTIONS)
 * @param {string} [p.reason]      wear | … (SHIM_REASONS) · default 'wear'
 * @param {string} [p.note]
 * @param {string} [p.platesText]
 * @param {number} [p.measureBefore] [p.measureAfter]
 * @param {string} [p.byName]
 * @param {number} [p.shotAtEvent] shot สะสม ณ ตอนบันทึก (null = นับไม่ได้ — ห้ามใส่ 0)
 * @param {string} [p.inspectionId] ใบตรวจ PM ที่บันทึกมาด้วยกัน (สอบกลับ) · คอลัมน์ยังไม่ apply = ถอยไปบันทึกโดยไม่ผูก + แจ้ง
 * @returns {Promise<{ok:boolean, afterMm:number, warn:string|null, error?:string}>}
 */
export async function recordShimEvent(p) {
  const point = p?.point;
  const after = num(p?.afterMm);
  if (!point?.id) return { ok: false, afterMm: after, warn: null, error: 'ไม่มีจุดชิม' };
  if (after == null) return { ok: false, afterMm: after, warn: null, error: 'ไม่มีค่าชิม' };
  if (after < 0) return { ok: false, afterMm: after, warn: null, error: 'ค่ารวมติดลบไม่ได้' };
  const before = num(point.current_shim_mm);
  const delta = before != null ? +(after - before).toFixed(3) : null;
  const nowIso = new Date().toISOString();
  const row = {
    point_id: point.id,
    action: p.action || 'check',
    shim_before_mm: before,
    shim_after_mm: after,
    delta_mm: delta,
    plates_text: (p.platesText || '').trim() || null,
    measure_before: num(p.measureBefore),
    measure_after: num(p.measureAfter),
    reason: p.reason || 'wear',
    note: (p.note || '').trim() || null,
    by_name: p.byName || null,
    shot_at_event: num(p.shotAtEvent),
  };
  let warn = null;
  let { error } = await supabaseDR.from('fixture_shim_events')
    .insert(p.inspectionId ? { ...row, inspection_id: p.inspectionId } : row);
  if (error?.code === '42703' && p.inspectionId) {
    // ยังไม่ apply migration 20260908_fixture_points_pin (DR) — บันทึกให้ก่อน แต่ต้องบอก ห้ามเงียบ
    ({ error } = await supabaseDR.from('fixture_shim_events').insert(row));
    if (!error) warn = 'บันทึกชิมแล้ว แต่ยังผูกกับใบตรวจไม่ได้ — ฐาน DR ยังไม่มีคอลัมน์ inspection_id (รัน migration 20260908_fixture_points_pin)';
  }
  if (error) return { ok: false, afterMm: after, warn, error: error.message };

  const patch = { current_shim_mm: after, last_check_at: nowIso, last_check_shot: num(p.shotAtEvent), updated_at: nowIso, updated_by_name: p.byName || null };
  if (row.action === 'part_replaced') { patch.last_replaced_at = nowIso; patch.last_replaced_shot = num(p.shotAtEvent); }
  const { error: pErr } = await supabaseDR.from('fixture_points').update(patch).eq('id', point.id).select('id');
  if (pErr) warn = `บันทึกเหตุการณ์แล้ว แต่อัปเดตค่ารวม/วันตรวจของจุดไม่สำเร็จ: ${pErr.message}`;
  return { ok: true, afterMm: after, warn };
}

/** ปักหมุดจุดชิมบนรูป (x/y 0..1 + เฟรม) — null ทั้งคู่ = ถอนหมุด */
export async function saveShimPointPin(pointId, pin, byName) {
  const patch = pin
    ? { x_pos: pin.x, y_pos: pin.y, image_id: pin.imageId ?? null, updated_at: new Date().toISOString(), updated_by_name: byName || null }
    : { x_pos: null, y_pos: null, image_id: null, updated_at: new Date().toISOString(), updated_by_name: byName || null };
  const { data, error } = await supabaseDR.from('fixture_points').update(patch).eq('id', pointId).select('id');
  if (error) return { ok: false, error: error.code === '42703' ? 'ฐาน DR ยังไม่มีคอลัมน์หมุด (รัน migration 20260908_fixture_points_pin)' : error.message };
  if (!data?.length) return { ok: false, error: 'ไม่มีแถวถูกเขียน (เช็คสิทธิ์)' };
  return { ok: true };
}
