/* 🔌 ศูนย์เชื่อมต่อ — ทะเบียน "ชนิดข้อมูล" ที่ต้นทาง (Node-RED ฯลฯ) ส่งเข้า ESM ได้ (2026-11-11)
   📄 docs/modules/integration-hub.md

   🔴 ที่เดียวที่ประกาศชนิดข้อมูล — จอ /integrations · ตัว gen flow (nodeRedFlow.js) อ่านจากที่นี่
      edge `integration-admin` มีรายชื่อคีย์ซ้ำ (edge import จาก src/ ไม่ได้) ⇒ เพิ่มชนิดใหม่ต้องตามไปแก้ที่นั่นด้วย
   🔴 หลักการ: ต้นทางส่ง "ข้อเท็จจริง" (ค่า/เวลา/จำนวน) · สูตร/การตัดสินอยู่ที่ ESM
      ⇒ ไม่มีชนิด "เลข OEE ของต้นทาง" ในทะเบียนนี้โดยตั้งใจ (docs/SCADA_REALTIME_DESIGN.md §1)
   status: 'live' = ESM รับได้แล้ว · 'planned' = ออกแบบไว้ ยังไม่มีปลายทางรับ (จอต้องบอก ห้ามให้ติ๊กแล้วเงียบ) */

export const INTEGRATION_KINDS = [
  { key: 'energy_readings', label: 'ค่าไฟรายนาที', icon: '⚡', status: 'live', module: 'energy',
    body: 'readings', dest: 'energy_live · energy_readings', home: '/energy?tab=live',
    help: 'kW สูงสุด · เลขมิเตอร์ kWh · V · A ต่อตู้ ทุก 1 นาที' },
  { key: 'energy_events', label: 'เหตุการณ์ไฟฟ้า', icon: '🔔', status: 'live', module: 'energy',
    body: 'events', dest: 'energy_events', home: '/energy?tab=live',
    help: 'เกินลิมิต / ไม่สมดุล ที่ต้นทางตัดสิน · ซ้ำ = ข้าม · เก็บ 30 วัน' },
  { key: 'energy_daily', label: 'ยอดไฟรายวัน', icon: '📅', status: 'live', module: 'energy',
    body: 'daily', dest: 'energy_daily', home: '/energy?tab=live',
    help: 'เติมวันที่ ESM มีข้อมูลไม่ครบ (เฉพาะวันที่ผ่านไปแล้ว)' },
  { key: 'energy_limits', label: 'ลิมิตตู้ไฟ', icon: '🎚️', status: 'live', module: 'energy',
    body: 'limits', dest: 'energy_live_meters', home: '/energy?tab=live',
    help: 'ต้นทางเป็นเจ้าของลิมิต · ESM ตามเองเมื่อค่าเปลี่ยน' },
  { key: 'machine_state', label: 'สถานะเครื่อง (เดิน/หยุด)', icon: '🏭', status: 'planned', module: 'oee',
    body: 'states', dest: '— (ยังไม่มีปลายทาง)', home: null,
    help: 'ช่วงเวลาเดิน/หยุด + เหตุผลที่กดหน้าเครื่อง — ESM คิด %A เอง' },
  { key: 'piece_count', label: 'นับชิ้น', icon: '🔢', status: 'planned', module: 'oee',
    body: 'pieces', dest: '— (ยังไม่มีปลายทาง)', home: null,
    help: 'จำนวนชิ้นต่อนาทีจากเครื่อง — เทียบกับยอดที่คนลง' },
];

export const kindOf = (key) => INTEGRATION_KINDS.find(k => k.key === key) || null;

/** ชนิดที่ไม่รู้จัก ไม่ทิ้งเงียบ — คืนป้าย "ไม่รู้จัก" ให้จอเขียน */
export function kindLabel(key) {
  const k = kindOf(key);
  return k ? `${k.icon} ${k.label}` : `❓ ${key} (ไม่รู้จัก)`;
}

/** สถานะต้นทางจากเวลารับล่าสุด — 'paused' | 'never' | 'online' | 'stale'
 *  ไม่เคยได้รับ ≠ ขาดการติดต่อ · เกณฑ์ขาด = ไม่มีค่าใหม่เกิน `staleMin` นาที (ตัวส่งปกติยิงทุก 1 นาที) */
export const SOURCE_STALE_MIN = 3;
export function sourceStatus(src, nowMs = Date.now(), staleMin = SOURCE_STALE_MIN) {
  if (!src) return 'never';
  if (src.is_paused) return 'paused';
  const t = Date.parse(src.last_ok_at || '');
  if (!Number.isFinite(t)) return src.last_seen_at ? 'stale' : 'never';
  return nowMs - t > staleMin * 60000 ? 'stale' : 'online';
}

/** แถบสุขภาพ 24 ชม. — 1 ช่องต่อชั่วโมง (เก่า→ใหม่) จาก integration_hourly
 *  ชั่วโมงที่ไม่มีแถว = ok 0 (ไม่ได้รับเลย) · ชั่วโมงปัจจุบันเทียบกับนาทีที่ผ่านไปแล้วเท่านั้น
 *  @returns {Array<{hourMs:number, ok:number, fail:number, expect:number, ratio:number|null}>} */
export function healthBars(rows, nowMs = Date.now(), hours = 24, perHour = 60) {
  const H = 3600000;
  const cur = Math.floor(nowMs / H) * H;
  const by = new Map((rows || []).map(r => [Math.floor(Date.parse(r.hour_at) / H) * H, r]));
  const out = [];
  for (let i = hours - 1; i >= 0; i--) {
    const hourMs = cur - i * H;
    const r = by.get(hourMs);
    const expect = i === 0 ? Math.max(1, Math.floor((nowMs - hourMs) / 60000)) : perHour;
    const ok = Number(r?.ok_count) || 0, fail = Number(r?.fail_count) || 0;
    out.push({ hourMs, ok, fail, expect, ratio: Math.min(1, ok / expect) });
  }
  return out;
}
