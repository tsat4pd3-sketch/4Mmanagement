/* ✅ ความครบของข้อมูลสินค้า 1 ตัว — "งานใหม่มาแล้วยังขาดอะไร" (2026-09-22 · คำสั่ง user)
   โจทย์: ลำดับงานจริงคือ Parts Master → BOM → Products → Routing → Packaging → Kanban
   แต่ไม่มีใครจำได้ว่าพาร์ทไหนทำถึงขั้นไหนแล้ว (วัดจริง 21/09: 106 สินค้า · ไม่มี BOM 8 ·
   ไม่มี routing 101 · ไม่มี packaging 106 · ไม่มี CT 51) ⇒ จอต้องบอกเอง ไม่ใช่ให้คนไล่เปิดทีละแท็บ

   🔴 กฎ (คำสั่ง user 22/09): **Routing / Packaging = "อนาคตต้องบังคับ"**
   ⇒ ตอนนี้ขึ้นเป็น **"รอ" (เหลือง) ไม่ใช่ "ขาด" (แดง)** — เตือน ห้ามบล็อก
   (ระหว่างนี้ user กำลังไล่ลงข้อมูล · ทำเป็นบังคับทันที = ทั้งฐานแดงหมด = คนเลิกอ่าน)
   วันที่จะบังคับจริง เปลี่ยนแค่ `future: true` → ลบออก ที่ไฟล์นี้จุดเดียว

   ห้ามใส่กฎ "ครบ/ไม่ครบ" ซ้ำในหน้า — ทุกจอที่ตอบเรื่องนี้ต้องเรียกไฟล์นี้ */

/** ขั้นที่นับ · order = ลำดับเดียวกับแท็บใน /products */
export const READINESS_STEPS = [
  { key: 'bom',       icon: '📦', label: 'BOM',       future: false },
  { key: 'ct',        icon: '⏱',  label: 'CT',        future: false },
  { key: 'routing',   icon: '🔀', label: 'Routing',   future: true  },
  { key: 'packaging', icon: '🧳', label: 'Packaging', future: true  },
  { key: 'kanban',    icon: '🎴', label: 'Kanban',    future: false },
];

/** สินค้าที่ส่งลูกค้า (MAT ขึ้นต้น 1) เท่านั้นที่ต้องมี packaging/kanban ส่งออก
    — child part (2) / ขั้นตอน (OP) ไม่มีกล่องส่งลูกค้า ถ้าไปบังคับ = เตือนที่ไม่มีวันหาย */
const isFg = (mat) => /^1/.test(String(mat || '').trim());

/**
 * @param {object} item  แถว dr_products (ใช้ mat_no · cycle_time_sec · is_operation)
 * @param {object} facts { bom:number, routing:boolean, packaging:boolean, kanban:number }
 * @returns {{steps:Array, missing:string[], missingRequired:string[], done:number, total:number, ok:boolean}}
 *          steps[].status = 'ok' | 'miss' (ยังขาด · บังคับแล้ว) | 'wait' (ยังขาด · อนาคตบังคับ) | 'na'
 */
export function productReadiness(item, facts = {}) {
  const op = !!item?.is_operation;
  const fg = isFg(item?.mat_no);
  const have = {
    bom:       (facts.bom || 0) > 0,
    ct:        Number(item?.cycle_time_sec) > 0,
    routing:   !!facts.routing,
    packaging: !!facts.packaging,
    kanban:    (facts.kanban || 0) > 0,
  };
  // ขั้นที่ "ไม่เกี่ยวกับของชิ้นนี้" → na (ไม่นับทั้งเศษและส่วน)
  const na = {
    bom:       false,
    ct:        false,
    routing:   false,
    packaging: op || !fg,
    kanban:    op,
  };

  const steps = READINESS_STEPS.map(s => ({
    ...s,
    status: na[s.key] ? 'na' : have[s.key] ? 'ok' : (s.future ? 'wait' : 'miss'),
  }));
  const counted = steps.filter(s => s.status !== 'na');
  return {
    steps,
    missing:         steps.filter(s => s.status === 'miss' || s.status === 'wait').map(s => s.key),
    missingRequired: steps.filter(s => s.status === 'miss').map(s => s.key),
    done:  counted.filter(s => s.status === 'ok').length,
    total: counted.length,
    ok:    counted.every(s => s.status === 'ok'),
  };
}

/** สีของชิปต่อสถานะ — ใช้ร่วมกันทุกจอ ห้ามตั้งสีเองในหน้า (UI-CONVENTIONS: เขียว=ครบ เหลือง=รอ แดง=ขาด) */
export const READINESS_COLOR = {
  ok:   { fg: 'var(--accent)', bg: 'rgba(61,214,92,0.10)',   mark: '✓' },
  miss: { fg: '#ef4444',       bg: 'rgba(239,68,68,0.10)',   mark: '✗' },
  wait: { fg: '#f59e0b',       bg: 'rgba(245,158,11,0.10)',  mark: '…' },
  na:   { fg: 'var(--muted)',  bg: 'rgba(107,114,128,0.08)', mark: '—' },
};
