/* ══ 🔫 scanWedge — แยก "เครื่องสแกนยิง" ออกจาก "คนพิมพ์" (2026-10-20 · audit handheld CipherLab RS38) ══════════
   handheld ที่แจกหน้างานมีหัวสแกนในตัว ตั้งเป็น keyboard-wedge: กดปุ่มข้างเครื่อง = เครื่อง "พิมพ์" รหัสใส่ช่องที่
   เคอร์เซอร์อยู่แล้วต่อ Enter · ระบบไม่เคยรู้ว่าตัวอักษรชุดนั้นมาจากการสแกน ⇒ 3 อาการที่ทำให้ข้อมูลผิดเงียบๆ:
     1. เคอร์เซอร์ค้างอยู่ช่อง "จำนวน" → เลข PROD.NO 8 หลักกลายเป็นยอดผลิต
     2. สแกนเข้าช่องค้นหาพาร์ท → Enter เลือกแถวแรกที่ "มีเลขนี้อยู่ข้างใน" (ไม่ใช่ตัวที่ตรงเป๊ะ)
     3. ไม่มีช่องไหนโฟกัส → รหัสหายเงียบ คนนึกว่าบันทึกแล้ว
   ไฟล์นี้ = ตัวตัดสินกลาง (pure · มีเทส) · ตัวติดตั้งบนจอ = `components/ScanWedgeGuard.jsx` (มือถือเท่านั้น)

   หลักแยก: เครื่องสแกนส่งตัวอักษรห่างกัน ~0–15 ms · คนพิมพ์บนจอสัมผัส/คีย์บอร์ดจริง ≥ 60 ms เสมอ
   (soft keyboard ของ Android ส่ง keydown เป็น 'Unidentified'/229 ไม่ใช่ตัวอักษร ⇒ ไม่ถูกนับเลย)

   🔴 กติกา:
   · ชุดที่นับเป็น "สแกน" = ตัวอักษร ≥ SCAN_MIN_LEN ตัว ห่างกันไม่เกิน SCAN_MAX_GAP_MS แล้วจบด้วย Enter
   · ช่องตัวเลข (`isNumericField`) ห้ามรับผลสแกน — คืนค่าเดิมของช่อง · ช่องที่ตั้งใจรับรหัสเป็นตัวเลข ใส่ `data-scan-ok`
   · Enter ที่ตามมาติดๆ (เครื่องบางรุ่นส่ง CR+LF = Enter 2 ครั้ง) ภายใน TRAIL_ENTER_MS ถูกกลืน ไม่ให้ไปกดปุ่มที่โฟกัสอยู่
   · ไฟล์นี้ไม่ตัดสินว่ารหัสคืออะไร — แค่บอกว่า "นี่คือการสแกน" (ตีความรหัส = `utils/qrCode.js` parseQrPayload)
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export const SCAN_MIN_LEN = 4;
export const SCAN_MAX_GAP_MS = 40;
export const TRAIL_ENTER_MS = 200;
/** event ที่ยิงเมื่อสแกนโดยไม่มีช่องรับ — หน้าที่อยากรับให้ `e.preventDefault()` เพื่อบอกว่ารับแล้ว */
export const SCAN_EVENT = 'esm:scan';
const MODIFIER_KEYS = new Set(['Shift', 'CapsLock']);

/** ช่องนี้เป็น "ช่องตัวเลข" (จำนวน/นาที/ยอด) ที่ห้ามรับผลสแกนไหม */
export function isNumericField(el) {
  if (!el || el.tagName !== 'INPUT') return false;
  if (el.hasAttribute?.('data-scan-ok')) return false;
  const type = String(el.type || '').toLowerCase();
  const mode = String(el.inputMode || el.getAttribute?.('inputmode') || '').toLowerCase();
  return type === 'number' || mode === 'numeric' || mode === 'decimal';
}

/** ช่องที่พิมพ์ได้ (รับตัวอักษรจากเครื่องสแกน) */
export function isTypingField(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled;
  if (el.tagName !== 'INPUT') return false;
  const type = String(el.type || 'text').toLowerCase();
  if (['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image', 'hidden'].includes(type)) return false;
  return !el.readOnly && !el.disabled;
}

/**
 * ตัวนับจังหวะกดปุ่ม — ป้อน keydown ทีละตัว ได้คำตัดสินกลับ
 * @returns {{ feed(ev: {key: string, t: number, target?: any, value?: string}): ({kind:'char'}|{kind:'scan', raw: string, target: any, startValue: string}|{kind:'trail'}|{kind:'enter'}|{kind:'other'}) }}
 *   · `value` = ค่าในช่องตอนกด (ใช้จำค่าก่อนเริ่มสแกน เพื่อคืนค่าเมื่อสแกนลงช่องตัวเลข)
 */
export function createBurstTracker({ minLen = SCAN_MIN_LEN, maxGap = SCAN_MAX_GAP_MS, trailMs = TRAIL_ENTER_MS } = {}) {
  let buf = '';
  let lastT = -Infinity;
  let target = null;
  let startValue = '';
  let lastScanAt = -Infinity;

  const reset = () => { buf = ''; target = null; startValue = ''; };

  return {
    feed({ key, t, target: tg = null, value = '' }) {
      if (key === 'Enter') {
        const gapOk = t - lastT <= maxGap * 2;   // Enter มักตามตัวสุดท้ายห่างกว่าตัวอักษรเล็กน้อย
        if (buf.length >= minLen && gapOk) {
          const out = { kind: 'scan', raw: buf, target, startValue };
          reset(); lastT = t; lastScanAt = t;
          return out;
        }
        reset();
        // Enter ตัวที่ 2 ของ CR+LF (หรือ Tab+Enter) — ตามการสแกนมาติดๆ
        if (t - lastScanAt <= trailMs) { lastScanAt = -Infinity; return { kind: 'trail' }; }
        lastT = t;
        return { kind: 'enter' };
      }
      // 🔴 เครื่องสแกนกด Shift ให้ตัวพิมพ์ใหญ่ทุกตัว (keyboard emulation) ⇒ ปุ่มกำกับห้ามล้างชุดที่สะสม
      if (MODIFIER_KEYS.has(key)) return { kind: 'other' };
      if (typeof key !== 'string' || key.length !== 1) { reset(); lastT = t; return { kind: 'other' }; }
      if (t - lastT > maxGap || tg !== target) { buf = ''; target = tg; startValue = value; }
      buf += key;
      lastT = t;
      return { kind: 'char' };
    },
  };
}

/**
 * Enter นี้คือ "ท้ายการสแกน" ไหม — SearchSelect/ช่องอื่นใช้ตัดสินว่าจะเลือกแบบตรงเป๊ะเท่านั้น
 * (ตัวติดตั้งแปะ `__esmScan` = รหัสที่สแกน ไว้บน native event ก่อน React เห็น)
 */
export function scanOfEvent(e) {
  const ne = e?.nativeEvent || e;
  return (ne && typeof ne.__esmScan === 'string') ? ne.__esmScan : null;
}

/** ปรับรูปเพื่อเทียบรหัสแบบตรงเป๊ะ — ตัดช่องว่าง/ขีด/ตัวพิมพ์ (สอดคล้อง normCode ใน qrCode.js) */
export function normScanCode(s) {
  return String(s ?? '').replace(/[\s\-_]/g, '').toUpperCase();
}

/**
 * หาตัวเลือกที่ "ตรงเป๊ะ" กับรหัสที่สแกน (ไม่ใช่แค่มีรหัสนี้อยู่ข้างใน)
 * @param {Array<{id:any,label?:string,lead?:string,code?:string}>} options
 * @returns {object|null} ตัวที่ตรงตัวเดียว · ไม่เจอ/เจอหลายตัว = null (ให้คนเลือกเอง ห้ามเดา)
 */
export function exactScanMatch(options, raw) {
  const q = normScanCode(raw);
  if (!q) return null;
  const strip = (v) => normScanCode(String(v ?? '').replace(/^MAT\s+/i, ''));
  // ตัวเลือก "นอกทะเบียน" (history) ไม่นับ — ตัวหนึ่งในนั้นคือเงาของคำที่เพิ่งสแกนเอง (พาเรนต์เก็บคำค้นแล้วเติมกลับ)
  const hits = (options || []).filter(o => !o.history && [o.id, o.label, o.lead, o.code].some(v => v != null && v !== '' && strip(v) === q));
  const uniq = [...new Map(hits.map(o => [o.id, o])).values()];
  return uniq.length === 1 ? uniq[0] : null;
}
