/* ═══ 🛡️ ด่านตรวจของลูปสโตร์ (Store ⇄ Production Pull Loop) — เฟส 4: จุดส่งงาน ═════════
   docs/STORE-PULL-LOOP-DESIGN.md §4.5 + §4.6 (user 2026-08-27) · ลงจริง 2026-09-03

   ตอบ 2 คำถาม: **"ของที่หยิบ ตรงกับใบไหม"** (ขั้น 5 · สแกนพาร์ท + จำนวน · 2026-09-07 user: "เตรียมก็ต้อง scan verify")
              และ **"ของที่สโตร์กำลังวาง ตรงกับปลายทางบนใบไหม"** (ขั้น 7 · สแกน QR จุดส่ง)

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

/** จุดส่งที่ใช้ได้กับ "ใบ" นี้ — ตรงไลน์ก่อน · ไม่มีจุดของไลน์แต่ใบมี SLoc → จุดในพื้นที่เดียวกัน (ชั้นบัญชี SAP 2026-09-08)
 *  ⚠️ checkDeliveryPoint กับ DeliverScanModal ต้องใช้ตัวนี้ตัวเดียวกัน — ไม่งั้นโมดัลบอก "ไม่มีจุด" ทั้งที่ด่านมีจุดให้เทียบ */
export function pointsForRequest(points, request) {
  const byLine = pointsForLine(points, request?.line_name);
  if (byLine.length) return byLine;
  const reqSloc = norm(request?.storage_location).toUpperCase();
  if (!reqSloc) return [];
  return (points || []).filter(p => p && p.is_active !== false && norm(p.storage_location).toUpperCase() === reqSloc);
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
  /* ชั้น SLoc (2026-09-08): SAP คุมที่ "พื้นที่" (P411 = ทั้ง Apron Assy) → pptx "Verified location: Location Transfer = area request"
     · ใบกับป้ายมี storage_location ทั้งคู่ → เทียบพื้นที่ก่อน: คนละพื้นที่ = บล็อก · พื้นที่เดียวกัน = ผ่าน (ไลน์ย่อยเป็นข้อมูลประกอบ)
     · ไม่มีข้อมูล SLoc ฝั่งใดฝั่งหนึ่ง = ใช้กฎไลน์เดิม */
  const reqSloc = norm(request?.storage_location).toUpperCase();
  const ptSloc  = norm(point?.storage_location).toUpperCase();
  const serving = pointsForRequest(points, request);
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
  if (reqSloc && ptSloc && point.is_active !== false) {
    if (reqSloc !== ptSloc) {
      return {
        status: 'mismatch', point, expected, actual: pointLabel(point), block: true,
        message: `ใบนี้ไปพื้นที่ ${reqSloc} (${ln}) · ป้ายที่สแกนอยู่พื้นที่ ${ptSloc} ("${pointLabel(point)}") — ต้องส่งที่ ${expected || reqSloc}`,
      };
    }
    if (!servesThis) {
      const theirs = lineList(point);
      return { status: 'ok', gate: 'scanned', point, expected, actual: pointLabel(point), block: false, slocOnly: true,
        message: `✓ พื้นที่ ${reqSloc} ตรงใบ — จุด "${pointLabel(point)}" ผูกกับ ${theirs.join(' / ') || 'ไม่ระบุไลน์'} (ใบขอส่ง ${ln})` };
    }
  }
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

/* ═══ ขั้น 5 — สแกนพาร์ท + จำนวน ตอนกด "เริ่มเตรียม" (user 2026-09-07) ═══════════════════════
   §4.6: ด่านแรกอยู่ขั้น 5 ไม่ใช่ขั้น 7 — ผิดที่ชั้นวาง = แก้ 10 วินาที · ผิดตอนถึงไลน์ = เดินกลับทั้งเที่ยว
   · พาร์ท: ยิงป้าย ESM:P:<mat> หรือบาร์โค้ด 1D บนบัตร/กล่อง → ต้องเป็น mat_no บนใบ · ไม่ตรง = 🔴 บล็อก
   · จำนวน: เกิน = 🔴 บล็อก (ไม่มีเหตุผลที่ถูกต้อง + WIP บวม) · ขาด = 🟡 เตือน + บังคับยืนยัน (กล่องสุดท้ายไม่เต็มเป็นเรื่องปกติ
     และขั้น 8 รองรับ "ได้ไม่ครบ" อยู่แล้ว) · ห้ามบล็อกเพราะข้อมูลเราไม่ครบ
   ⚠️ บัตร TAG CARD ของจริงยังไม่ยืนยันว่าบาร์โค้ดเส้นไหนคือ MAT.NO. (§7 ข้อ 1) → เลขเปล่าที่ "ขึ้นต้นด้วย mat_no"
     (มี check digit/running ต่อท้าย) ถือว่าตรงแบบ `loose` ไปก่อน — บันทึกดิบไว้เสมอ พอรู้รูปแบบจริงค่อยล็อกให้เป๊ะ */

export const PICK_GATES = {
  scanned:  { label: 'สแกนพาร์ทแล้ว',      icon: '🔍', color: '#22c55e' },
  override: { label: 'ปลดบล็อกโดยหัวหน้า', icon: '🔓', color: '#ef4444' },
};

const normMat = (s) => String(s ?? '').trim().toUpperCase().replace(/[\s-]/g, '');

/**
 * ด่านพาร์ท (ขั้น 5)
 * @param {object} a.request  ใบ (mat_no)
 * @param {object|null} a.scan  ผล parseQrPayload (kind 'product' | null | อื่น)
 * @returns {{ status:'ok'|'mismatch'|'unknown', block:boolean, loose?:boolean, message:string, expected:string, actual:string }}
 */
export function checkPickPart({ request, scan }) {
  const want = normMat(request?.mat_no);
  const raw = norm(scan?.raw);
  const expected = norm(request?.mat_no);
  if (!scan || !norm(scan.id)) {
    return { status: 'unknown', block: true, expected, actual: raw, message: `อ่านป้ายไม่ออก — ใบนี้ต้องการพาร์ท ${expected}` };
  }
  // ป้ายชนิดอื่น (เครื่อง/จิ๊ก/จุดส่ง) = หยิบผิดอย่างแน่นอน ไม่เดา
  if (scan.kind && scan.kind !== 'product') {
    return { status: 'mismatch', block: true, expected, actual: raw, message: `ป้ายที่ยิงไม่ใช่ป้ายพาร์ท (${raw}) — ใบนี้ต้องการ ${expected}` };
  }
  const got = normMat(scan.id);
  if (got === want) return { status: 'ok', block: false, expected, actual: norm(scan.id), message: `✓ ตรงพาร์ท — ${expected}` };
  // บาร์โค้ด 1D บนบัตรอาจมี check digit/running ต่อท้าย mat_no — ยอมแบบ loose จนกว่าจะรู้รูปแบบจริง (§7 ข้อ 1)
  if (scan.kind === null && want.length >= 6 && got.startsWith(want)) {
    return { status: 'ok', block: false, loose: true, expected, actual: norm(scan.id), message: `✓ ตรงพาร์ท — ${expected} (อ่านจากบาร์โค้ด ${norm(scan.id)})` };
  }
  return { status: 'mismatch', block: true, expected, actual: norm(scan.id),
    message: `ใบนี้ต้องการ ${expected} · ที่ยิงมาคือ ${norm(scan.id)} — หยิบผิดพาร์ท วางคืนแล้วหยิบ ${expected}` };
}

/**
 * ด่านจำนวน (ขั้น 5) — เกิน = บล็อก · ขาด = เตือน (ต้องยืนยัน) · เท่ากัน = ผ่าน
 * @returns {{ status:'ok'|'over'|'under'|'invalid', block:boolean, needConfirm:boolean, message:string, diff:number }}
 */
export function checkPickQty({ request, qty }) {
  const want = Number(request?.request_qty) || 0;
  const q = Number(qty);
  if (!(q > 0)) return { status: 'invalid', block: true, needConfirm: false, diff: 0, message: 'ใส่จำนวนที่หยิบ (ต้องมากกว่า 0)' };
  const diff = q - want;
  if (diff > 0) return { status: 'over', block: true, needConfirm: false, diff, message: `หยิบเกินใบ ${diff.toLocaleString()} ชิ้น (ใบขอ ${want.toLocaleString()}) — ส่งเกินทำ WIP บวม ลดให้เท่าใบ` };
  if (diff < 0) return { status: 'under', block: false, needConfirm: true, diff, message: `หยิบได้ ${q.toLocaleString()} / ${want.toLocaleString()} — ขาด ${(-diff).toLocaleString()} ชิ้น (ยืนยันว่าส่งไม่ครบ ไลน์จะเห็นตอนรับของ)` };
  return { status: 'ok', block: false, needConfirm: false, diff: 0, message: `✓ ครบ ${want.toLocaleString()} ชิ้น` };
}

/** คอลัมน์ที่เขียนลงใบตอน pending → preparing */
export function buildPickPayload({ gate, qty, scanRaw, reasonKey, reasonNote, overrideBy }) {
  const p = { picked_gate: gate, picked_qty: Number(qty) > 0 ? Number(qty) : null, picked_scan_raw: norm(scanRaw) || null,
              picked_override_reason: null, picked_override_by_name: null };
  if (gate === 'override') {
    const meta = OVERRIDE_REASONS.find(r => r.key === reasonKey);
    const note = norm(reasonNote);
    p.picked_override_reason = [meta?.label || reasonKey || '', note].filter(Boolean).join(' — ') || null;
    p.picked_override_by_name = norm(overrideBy) || null;
  }
  return p;
}

/** ตารางความจริงเดียวกับ trigger `fn_wip_replenish_pick_gate` (Main) — ห้าม drift */
export function validatePickPayload(p) {
  const gate = p?.picked_gate;
  if (!(Number(p?.picked_qty) > 0)) return 'ใส่จำนวนที่หยิบก่อน';
  if (gate === 'scanned') return norm(p.picked_scan_raw) ? null : 'สแกนพาร์ทก่อนเริ่มเตรียม';
  if (gate === 'override') return norm(p.picked_override_reason) ? null : 'ปลดบล็อกต้องระบุเหตุผล';
  return 'ต้องสแกนพาร์ท หรือให้หัวหน้าปลดบล็อก ก่อนกด "เริ่มเตรียม"';
}
