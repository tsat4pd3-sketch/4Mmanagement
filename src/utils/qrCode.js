/**
 * QR / บาร์โค้ดของอุปกรณ์ — ตัวตนกลางของระบบ (2026-08-03)
 *
 * รูปแบบที่พิมพ์ลงป้าย:  ESM:<ชนิด>:<รหัส>
 *   ESM:M:<uuid>     เครื่องจักร (machines.id)
 *   ESM:J:<uuid>     จิ๊ก / อุปกรณ์ในทะเบียน PM (jigs.id) — ⚠️ แม่พิมพ์ใช้ ESM:M (อยู่ใน machines)
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
  machine: { code: 'M', label: 'เครื่องจักร/แม่พิมพ์', icon: '⚙️' },   // แม่พิมพ์ = แถวใน machines (equipment_kind='die')
  jig: { code: 'J', label: 'จิ๊ก (ทะเบียน PM)', icon: '🧩' },           // jigs = ทะเบียนอุปกรณ์ที่มีแผน PM
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
 * สร้าง "ป้ายแบบลิงก์" — ส่องด้วยกล้องมือถือปกติแล้วเปิดแอปมาที่หน้า /scan ได้เลย  (2026-10-02)
 *
 * ทำไมต้องเป็นลิงก์: ป้ายที่เป็นข้อความ `ESM:M:<uuid>` เฉยๆ กล้องมือถือส่องแล้ว**ไปไหนไม่ได้**
 * ต้องเปิดแอปเอง → หาเมนู → กดสแกนในแอป · ป้ายแบบลิงก์ตัดขั้นตอนนั้นทิ้งทั้งหมด
 *
 * 🔴 ค่าใน `?c=` ยังเป็นรูปแบบเดิมเป๊ะ ⇒ **ป้ายเก่าที่เป็นข้อความเปล่ายังสแกนในแอปได้เหมือนเดิม**
 *    (`parseQrPayload` แกะ URL ออกมาเป็น ESM:… ให้อยู่แล้ว) — ไม่มีป้ายไหนต้องพิมพ์ซ้ำเพราะของใหม่
 * @param {string} origin เช่น `https://esm.example.com` (ปกติส่ง window.location.origin)
 */
export function buildQrUrl(kind, id, origin) {
  const base = String(origin ?? '').replace(/\/+$/, '');
  const payload = buildQrPayload(kind, id);
  if (!base) return payload;          // ไม่รู้โดเมน = ถอยไปป้ายข้อความเดิม ดีกว่าออกลิงก์เสีย
  return `${base}/scan?c=${encodeURIComponent(payload)}`;
}

/** โดเมนนี้พิมพ์ป้ายแบบลิงก์ได้ไหม — localhost/ไอพีวง LAN = ป้ายจะใช้ได้แค่เครื่องที่พิมพ์ */
export function qrOriginUsable(origin) {
  const o = String(origin ?? '');
  if (!/^https?:\/\//i.test(o)) return false;
  return !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/i.test(o);
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

/**
 * 🔨 สแกนป้ายแม่พิมพ์ → แม่พิมพ์ตัวไหน (2026-10-06 · คำสั่ง user "สแกน QR แม่พิมพ์เด้งเข้าผัง")
 * แม่พิมพ์ใช้ตัวตนเดียวกับเครื่องจักร (`machines` · equipment_kind='die') ⇒ ป้าย = `ESM:M:<uuid>` / เลขแม่พิมพ์เปล่า
 * คืน `{ die }` หรือ `{ error }` — **ทุกทางที่หาไม่เจอต้องบอกเหตุ** (ป้ายผิดชนิด · ไม่มีในทะเบียน · ปิดใช้ · นอกขอบเขต)
 * ห้ามคืน null เงียบ: คนยืนหน้าชั้นวางแม่พิมพ์ต้องรู้ว่าทำไมหมุดไม่เด้ง
 * @param {object}   scan    ผลจาก parseQrPayload
 * @param {Array}    dies    แม่พิมพ์ **ทั้งหมด** (ไม่กรองขอบเขต — ไม่งั้นแยก "นอกขอบเขต" กับ "ไม่มี" ไม่ได้)
 * @param {Function} inScope (die) => boolean — ขอบเขตไลน์ที่จอเลือกอยู่
 */
export function findDieByScan(scan, dies = [], inScope = () => true) {
  if (!scan) return { error: 'อ่านรหัสจากป้ายไม่ได้' };
  // ป้ายแม่พิมพ์พิมพ์จากแท็บ ⚙️ เครื่องจักร ของ /qr-labels (machines รวมแม่พิมพ์) — ESM:J = ทะเบียน PM/จิ๊ก คนละตัว
  if (scan.kind === 'jig') {
    return { error: 'ป้ายนี้เป็นป้ายจิ๊ก (ESM:J) — ป้ายแม่พิมพ์ต้องพิมพ์จากหน้าพิมพ์ป้าย QR แท็บ ⚙️ เครื่องจักร / 🔨 แม่พิมพ์' };
  }
  if (scan.kind && scan.kind !== 'machine') {
    return { error: `ป้ายนี้เป็นป้าย${QR_KINDS[scan.kind]?.label || scan.kind} ไม่ใช่ป้ายแม่พิมพ์` };
  }
  const die = resolveMachine(scan, dies);
  if (!die) {
    return { error: scan.typed
      ? 'ไม่พบในทะเบียนแม่พิมพ์ — ป้ายนี้อาจเป็นของเครื่องจักร ไม่ใช่แม่พิมพ์'
      : `ไม่พบแม่พิมพ์เลข "${scan.id}" ในทะเบียน` };
  }
  if (die.is_active === false) return { error: `แม่พิมพ์ ${die.machine_no} ปิดใช้งานแล้ว` };
  if (!inScope(die)) {
    return { error: `แม่พิมพ์ ${die.machine_no} อยู่นอกขอบเขตไลน์ที่เลือกอยู่${die.line_name ? ` (${die.line_name})` : ''} — เปลี่ยนขอบเขตแล้วสแกนใหม่` };
  }
  return { die };
}
