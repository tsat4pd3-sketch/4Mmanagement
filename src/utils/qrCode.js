/**
 * QR / บาร์โค้ดของอุปกรณ์ — ตัวตนกลางของระบบ (2026-08-03)
 *
 * รูปแบบที่พิมพ์ลงป้าย:  ESM:<ชนิด>:<รหัส>
 *   ESM:M:<uuid>     เครื่องจักร (machines.id)
 *   ESM:J:<uuid>     จิ๊ก / แม่พิมพ์ (jigs.id)
 *   ESM:P:<mat_no>   สินค้า/พาร์ท (mat_no — unique ทั้ง dr_products/parts_master/kanban_standards)
 *   ESM:D:<uuid>     จุดส่งงานหน้าไลน์ (line_delivery_points.id — DR · ลูปสโตร์เฟส 4 · 2026-09-03)
 *                    สโตร์ยิงป้ายนี้ตอนวางของถึงไลน์ = หมุดเวลา delivered_at + ด่านตรวจ "ส่งถูกจุดไหม"
 *
 * ทำไมเครื่อง/จิ๊กใช้ uuid ไม่ใช่เลขเครื่อง:
 *   ป้ายติดเครื่องอยู่หน้างานเป็นปี — ถ้าเข้ารหัสด้วย "เลขเครื่อง" แล้ววันหนึ่งเปลี่ยนเลข
 *   ป้ายทุกใบที่พิมพ์ไปแล้วจะชี้ผิดทันที · uuid ไม่เปลี่ยนตลอดอายุแถว ป้ายจึงไม่ต้องพิมพ์ซ้ำ
 *   (บนป้ายยัง **พิมพ์เลขเครื่องตัวใหญ่ให้คนอ่าน** อยู่ — คนอ่านเลข เครื่องอ่าน uuid)
 * ส่วนสินค้าใช้ mat_no เพราะเป็น "ภาษากลาง" ที่ทั้งโรงงาน (รวม SAP) อ้างถึงอยู่แล้ว
 *
 * ตัวอ่านต้องทน 3 กรณีเสมอ (คนหน้างานไม่รู้ว่าป้ายไหนเป็นของระบบไหน):
 *   1. QR ของระบบเรา            → ESM:M:xxx
 *   2. เลขเปล่าจากเครื่องยิงเดิม  → "RB-104" / "10100401"  (บาร์โค้ด 1D ที่มีติดเครื่องอยู่ก่อนแล้ว)
 *   3. QR แบบ URL ของระบบเรา     → https://.../scan?c=ESM:M:xxx  (เผื่ออนาคตอยากให้กล้องมือถือทั่วไปกดเปิดได้)
 */

export const QR_PREFIX = 'ESM';

/** ชนิดของสิ่งที่สแกนได้ — เพิ่มชนิดใหม่ที่นี่ที่เดียว */
export const QR_KINDS = {
  machine: { code: 'M', label: 'เครื่องจักร', icon: '⚙️' },
  jig: { code: 'J', label: 'จิ๊ก/แม่พิมพ์', icon: '🧩' },
  product: { code: 'P', label: 'สินค้า/พาร์ท', icon: '📦' },
  delivery: { code: 'D', label: 'จุดส่งงาน', icon: '🎯' },
};

const CODE_TO_KIND = Object.fromEntries(Object.entries(QR_KINDS).map(([k, v]) => [v.code, k]));

/**
 * สร้างข้อความที่จะเข้ารหัสลง QR
 * @param {'machine'|'jig'|'product'|'delivery'} kind
 * @param {string} id  uuid (machine/jig/delivery) หรือ mat_no (product)
 */
export function buildQrPayload(kind, id) {
  const meta = QR_KINDS[kind];
  if (!meta) throw new Error(`ชนิดไม่รู้จัก: ${kind}`);
  const val = String(id ?? '').trim();
  if (!val) throw new Error('ไม่มีรหัสสำหรับสร้าง QR');
  return `${QR_PREFIX}:${meta.code}:${val}`;
}

/**
 * แกะข้อความที่สแกนมา → { kind, id, raw, typed }
 *   typed = true  หมายถึงอ่านรูปแบบของระบบเราออก (รู้ชนิดแน่นอน)
 *   typed = false หมายถึงเป็นเลขเปล่า — ต้องให้ผู้เรียกเดาชนิดจากบริบทของหน้า
 * คืน null เมื่อว่างเปล่า
 */
export function parseQrPayload(text) {
  let raw = String(text ?? '').trim();
  if (!raw) return null;

  // เครื่องยิงบาร์โค้ดต่อท้ายด้วย Enter/CR — ตัดทิ้งก่อนเสมอ
  raw = raw.replace(/[\r\n]+$/, '').trim();
  if (!raw) return null;

  // กรณี QR เป็น URL: ดึงค่าจาก query ?c= หรือ ?code=
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const c = u.searchParams.get('c') || u.searchParams.get('code');
      if (c) raw = c.trim();
    } catch { /* URL เพี้ยน — ใช้ค่าเดิมต่อ */ }
  }

  const m = raw.match(/^ESM:([A-Z]):(.+)$/i);
  if (m) {
    const kind = CODE_TO_KIND[m[1].toUpperCase()];
    const id = m[2].trim();
    if (kind && id) return { kind, id, raw, typed: true };
  }

  // เลขเปล่า (บาร์โค้ดเดิม/พิมพ์มือ) — ไม่รู้ชนิด ให้หน้าที่เรียกเป็นคนตัดสิน
  return { kind: null, id: raw, raw, typed: false };
}

/** normalize สำหรับเทียบเลขเครื่อง/mat แบบไม่แคร์ขีด-ช่องว่าง-ตัวพิมพ์ (คนพิมพ์มือ RB104 = RB-104) */
export const normCode = (s) => String(s ?? '').trim().toUpperCase().replace(/[\s-]/g, '');

/**
 * หา "เครื่องจักร" จากสิ่งที่สแกนมา
 * @param {object} scan  ผลจาก parseQrPayload
 * @param {Array}  machines  รายการเครื่อง (ต้องมี id, machine_no)
 * @returns {object|null}
 */
export function resolveMachine(scan, machines = []) {
  if (!scan) return null;
  if (scan.kind === 'machine') {
    const byId = machines.find(m => String(m.id) === scan.id);
    if (byId) return byId;
  }
  // ชนิดไม่ตรง/ไม่ระบุ → ลองเทียบเป็นเลขเครื่อง (รองรับบาร์โค้ดเดิมที่ติดเครื่องอยู่)
  if (scan.kind === null || scan.kind === 'machine') {
    const n = normCode(scan.id);
    return machines.find(m => normCode(m.machine_no) === n) || null;
  }
  return null;
}

/** หา "จิ๊ก/แม่พิมพ์" — เทียบ id ก่อน แล้ว jig_no · jig เงาของเครื่องเทียบ machine_id ได้ด้วย */
export function resolveJig(scan, jigs = []) {
  if (!scan) return null;
  if (scan.kind === 'jig') {
    const byId = jigs.find(j => String(j.id) === scan.id);
    if (byId) return byId;
  }
  if (scan.kind === 'machine') {
    // สแกนป้ายเครื่อง แต่หน้านี้ทำงานกับทะเบียน PM → เด้งไปที่แถวเงาของเครื่องนั้น
    const shadow = jigs.find(j => String(j.machine_id) === scan.id);
    if (shadow) return shadow;
  }
  if (scan.kind === null || scan.kind === 'jig') {
    const n = normCode(scan.id);
    return jigs.find(j => normCode(j.jig_no) === n)
        || jigs.find(j => normCode(j.machine_no) === n)
        || null;
  }
  return null;
}

/** หา "สินค้า/พาร์ท" จาก mat_no — เทียบ mat_no ก่อน แล้วค่อยเลขพาร์ทลูกค้า (p_no/part_no) */
export function resolveProduct(scan, products = []) {
  if (!scan) return null;
  if (scan.kind && scan.kind !== 'product') return null;
  const n = normCode(scan.id);
  return products.find(p => normCode(p.mat_no) === n)
      || products.find(p => normCode(p.p_no) === n)
      || products.find(p => normCode(p.part_no) === n)
      || null;
}

/**
 * หา "จุดส่งงาน" (line_delivery_points) จากสิ่งที่สแกนมา
 *   - ป้ายของระบบ ESM:D:<uuid> → เทียบ id
 *   - เลขเปล่า/พิมพ์มือ → เทียบ `code` ของจุด (เผื่อป้ายเลอะแล้วคนพิมพ์รหัสสั้นที่พิมพ์ไว้บนป้ายแทน)
 *   - ป้ายชนิดอื่น (เครื่อง/จิ๊ก/พาร์ท) → null เสมอ — ยิงป้ายเครื่องแทนป้ายจุดส่ง ต้องถูกจับได้ ไม่ใช่เดาให้
 * @param {object} scan   ผลจาก parseQrPayload
 * @param {Array}  points รายการจุดส่ง (ต้องมี id, code)
 */
export function resolveDeliveryPoint(scan, points = []) {
  if (!scan) return null;
  if (scan.kind === 'delivery') {
    return points.find(p => String(p.id) === scan.id) || null;
  }
  if (scan.kind === null) {
    const n = normCode(scan.id);
    if (!n) return null;
    return points.find(p => p.code && normCode(p.code) === n) || null;
  }
  return null;
}
