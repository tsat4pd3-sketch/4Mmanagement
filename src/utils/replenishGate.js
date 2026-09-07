/* ═══ 🛡️ ด่านตรวจของลูปสโตร์ (Store ⇄ Production Pull Loop) — เฟส 4: จุดส่งงาน ═════════
   docs/STORE-PULL-LOOP-DESIGN.md §4.5 + §4.6 (user 2026-08-27) · ลงจริง 2026-09-03

   ตอบคำถามเดียว: **"ของที่สโตร์กำลังวาง ตรงกับปลายทางบนใบไหม"** (ขั้น 7 · สแกน QR จุดส่ง)

   ⚠️⚠️ กฎเหล็กที่ถอดจาก §4.6 — ห้ามแก้ให้ "ง่ายขึ้น":
   1. **ไม่รู้ = ห้ามบล็อก** — ไลน์ที่ยังไม่ตั้งจุดส่งเลย ตรวจไม่ได้ → ปล่อยผ่านแบบ `no_point`
      + ต้องขึ้น worklist ให้ไปตั้ง (บล็อกเพราะ *ข้อมูลของเรา* ไม่ครบ = หยุดงานคนอื่นด้วยความผิดของตัวเอง)
   2. **"จุดส่งผิด" = ไม่ตรงกับใบที่กำลังทำ** ไม่ใช่ "พาร์ทนี้ไม่ควรอยู่ไลน์นี้" — เทียบตัวตนจุด
      กับ `line_name` บนใบตรงๆ **ห้าม infer จากพาร์ท** (พาร์ทเดียวป้อนหลายไลน์จริง)
   3. **ข้อความบล็อกต้องบอก "ที่ถูกคืออะไร"** ไม่ใช่แค่ "ผิด" — คนหน้างานถูกบล็อกแล้วต้องรู้ทันทีว่าไปไหนต่อ
   4. **บล็อกแข็งต้องมีทางออกที่ถูกบันทึก** — override ต้องเลือกเหตุผล + เก็บเป็นแถว
      (`line_replenish_scan_blocks`) ⇒ ทางออกกลายเป็นเซ็นเซอร์ ไม่ใช่รูรั่ว
   5. **กฎอยู่ไฟล์นี้ไฟล์เดียว** — ใช้ทั้งโมดัลสแกน (HeijunkaKanban) และเทส · ฝั่ง DB มี trigger
      `fn_wip_replenish_deliver_gate` บังคับ "ครบ 3 ทาง" ซ้ำอีกชั้น (UI อย่างเดียวยิง API ตรงข้ามได้)
      → **ตารางความจริงของ `validateDeliverPayload` ต้องตรงกับ trigger เป๊ะ** (มีเทสล็อก)

   ไฟล์นี้ pure — ห้าม import supabase/react                                                    */

/** ทางที่ใบ "จากไลน์" ถูกมาร์กว่าส่งถึงแล้วได้ — เก็บที่ `wip_replenish_requests.delivered_gate` */
export const DELIVER_GATES = {
  scanned:  { label: 'สแกนจุดส่งแล้ว',           icon: '📍', color: '#22c55e' },
  no_point: { label: 'ไลน์ยังไม่ตั้งจุดส่ง (ตรวจไม่ได้)', icon: '⚪', color: '#f59e0b' },
  override: { label: 'ปลดบล็อกโดยหัวหน้า',         icon: '🔓', color: '#ef4444' },
};

/** เหตุผล override — เป็นหมวดสำหรับสรุปสถิติ ("เดือนนี้ override 40 · 32 ครั้งเพราะป้ายหาย" = worklist)
 *  ⚠️ เพิ่มหมวดที่นี่ที่เดียว · `other` ต้องมีข้อความประกอบเสมอ (ไม่งั้นสถิติเป็น "อื่นๆ" ทั้งก้อน อ่านไม่ออก) */
export const OVERRIDE_REASONS = [
  { key: 'label_missing',   label: 'ป้าย QR จุดส่งหาย/ชำรุด/สแกนไม่ติด' },
  { key: 'point_moved',     label: 'ไลน์ย้ายจุดรับของชั่วคราว (ป้ายยังอยู่ที่เดิม)' },
  { key: 'registry_wrong',  label: 'ทะเบียนจุดส่งไม่ตรงหน้างาน (ต้องไปแก้ทะเบียน)' },
  { key: 'other',           label: 'อื่นๆ (ระบุ)' },
];

const norm = (s) => String(s ?? '').trim();
const lineList = (p) => (Array.isArray(p?.line_names) ? p.line_names.map(norm).filter(Boolean) : []);

/** จุดส่งที่ "ให้บริการ" ไลน์นี้ (active เท่านั้น) — 1 จุดหลายไลน์ได้ (แร็คเดียวป้อน Line 60+61) */
export function pointsForLine(points, lineName) {
  const ln = norm(lineName);
  if (!ln) return [];
  return (points || []).filter(p => p && p.is_active !== false && lineList(p).includes(ln));
}

/** ชื่อจุดสำหรับข้อความ — มีรหัสสั้นก็โชว์คู่ (คนหน้างานจำรหัสบนป้ายได้ง่ายกว่าชื่อยาว) */
export const pointLabel = (p) => {
  if (!p) return '—';
  const code = norm(p.code);
  const name = norm(p.name) || 'จุดส่ง';
  return code ? `${code} · ${name}` : name;
};

/**
 * ด่านขั้น 7 — ตรวจว่าจุดที่สแกน ตรงกับปลายทางบนใบไหม
 * @param {object} args
 * @param {object} args.request  ใบขอเติม (ต้องมี line_name)
 * @param {object|null} args.point  จุดที่ resolve ได้จากการสแกน (null = อ่านป้ายไม่ออก/ไม่ใช่ป้ายจุดส่ง)
 * @param {Array}  args.points   จุดส่งทั้งหมดที่โหลดมา (ไว้หาว่าไลน์นี้ "ควร" ส่งที่ไหน)
 * @param {string} [args.scannedRaw]  ข้อความดิบที่ยิงมา (ใส่ในข้อความ/บันทึกบล็อก)
 * @returns {{ status: 'ok'|'no_point'|'unknown'|'mismatch', gate?: string, point?: object,
 *             expected: string, actual: string, message: string, block: boolean }}
 *   block = true คือ **ห้ามกดส่ง** จนกว่าจะสแกนใหม่หรือ override
 */
export function checkDeliveryPoint({ request, point, points, scannedRaw }) {
  const ln = norm(request?.line_name);
  const serving = pointsForLine(points, ln);
  const expected = serving.map(pointLabel).join(' / ');

  // กฎ 1 — ไม่รู้ = ห้ามบล็อก: ไลน์นี้ยังไม่มีจุดส่งในทะเบียนเลย
  if (serving.length === 0) {
    return {
      status: 'no_point', gate: 'no_point', point: null, expected: '', actual: norm(scannedRaw), block: false,
      message: `ตรวจจุดส่งไม่ได้ — ไลน์ ${ln || '(ไม่ระบุ)'} ยังไม่ตั้งจุดส่งงาน (ตั้งที่ ⚙️ ตั้งค่าผังไลน์ → 🎯 จุดส่งงาน)`,
    };
  }

  if (!point) {
    return {
      status: 'unknown', point: null, expected, actual: norm(scannedRaw), block: true,
      message: `ไม่รู้จักป้ายนี้${scannedRaw ? ` (${norm(scannedRaw)})` : ''} — ใบนี้ต้องส่งที่ ${expected}`,
    };
  }

  // กฎ 2 — เทียบตัวตนจุดกับปลายทางบนใบตรงๆ
  const servesThis = lineList(point).includes(ln) && point.is_active !== false;
  if (!servesThis) {
    const theirs = lineList(point);
    const where = theirs.length ? ` (ของ ${theirs.join(' / ')})` : (point.is_active === false ? ' (ปิดใช้งานแล้ว)' : '');
    return {
      status: 'mismatch', point, expected, actual: pointLabel(point), block: true,
      message: `ใบนี้ส่งไป ${ln} · ป้ายที่สแกนคือ "${pointLabel(point)}"${where} — ต้องส่งที่ ${expected}`,
    };
  }

  return { status: 'ok', gate: 'scanned', point, expected, actual: pointLabel(point), block: false, message: `✓ ตรงจุด — ${pointLabel(point)}` };
}

/**
 * แปลงผลด่านเป็นคอลัมน์ที่จะเขียนลง `wip_replenish_requests` ตอนกด "จัดส่งแล้ว"
 * @param {object} a
 * @param {'scanned'|'no_point'|'override'} a.gate
 * @param {object|null} [a.point]
 * @param {string} [a.reasonKey]   override เท่านั้น (key ใน OVERRIDE_REASONS)
 * @param {string} [a.reasonNote]  บังคับเมื่อ reasonKey = 'other'
 * @param {string} [a.overrideBy]  ชื่อหัวหน้าที่ปลด
 */
export function buildDeliverPayload({ gate, point, reasonKey, reasonNote, overrideBy }) {
  const p = { delivered_gate: gate, delivered_point_id: null, delivered_point_name: null,
              delivered_override_reason: null, delivered_override_by_name: null };
  if (point) { p.delivered_point_id = point.id ?? null; p.delivered_point_name = pointLabel(point); }
  if (gate === 'override') {
    const meta = OVERRIDE_REASONS.find(r => r.key === reasonKey);
    const note = norm(reasonNote);
    p.delivered_override_reason = [meta?.label || reasonKey || '', note].filter(Boolean).join(' — ') || null;
    p.delivered_override_by_name = norm(overrideBy) || null;
  }
  return p;
}

/**
 * ตารางความจริงเดียวกับ trigger `fn_wip_replenish_deliver_gate` (Main) — ห้าม drift:
 *   scanned  → ต้องมี delivered_point_id
 *   no_point → ผ่าน (ไลน์ยังไม่ตั้งจุด)
 *   override → ต้องมี delivered_override_reason
 *   อื่น/ว่าง → ไม่ผ่าน
 * @returns {string|null} ข้อความ error · null = ผ่าน
 */
export function validateDeliverPayload(p) {
  const gate = p?.delivered_gate;
  if (gate === 'no_point') return null;
  if (gate === 'scanned') return p.delivered_point_id ? null : 'สแกนจุดส่งก่อนกดส่ง (ยังไม่มีจุดที่สแกน)';
  if (gate === 'override') return norm(p.delivered_override_reason) ? null : 'ปลดบล็อกต้องระบุเหตุผล';
  return 'ต้องสแกนจุดส่ง หรือให้หัวหน้าปลดบล็อก ก่อนกด "จัดส่งแล้ว"';
}

/** เหตุผล override ครบไหม (ก่อนกดยืนยัน) — `other` ต้องมีข้อความ */
export function overrideReasonOk(reasonKey, reasonNote) {
  if (!OVERRIDE_REASONS.some(r => r.key === reasonKey)) return false;
  if (reasonKey === 'other') return norm(reasonNote).length > 0;
  return true;
}
