/**
 * useFormDraft — เก็บ "ร่าง" ที่คนกรอกค้างไว้ในเครื่อง ให้กรอกต่อได้ถ้าหน้าหลุด (2026-11-27 · คำสั่ง user)
 *
 * ด่านชั้นแรกคือ `utils/pendingInput.js` (กันการรีโหลดจาก version guard ตอนกำลังกรอก)
 * ตัวนี้เป็น **ชั้นที่สอง** — รับเคสที่กันไม่ได้: เบราว์เซอร์ปิดเอง · ไฟดับ · เครื่องค้าง ·
 * กดปิดแท็บ/ย้อนกลับพลาด · แท็บถูกระบบปฏิบัติการคืนหน่วยความจำบนมือถือ
 *
 * ── วิธีใช้ (ฟอร์มที่เก็บ state เป็นออบเจ็กต์ก้อนเดียว) ───────────────────────────
 *   const draft = useFormDraft('mtn-new-order', f, { skip: !!fillOrderId });
 *   ...
 *   {draft.found && <DraftBar draft={draft} onRestore={(d) => setF(p => ({ ...p, ...d }))} />}
 *   ...หลังบันทึกสำเร็จ: draft.clear()
 *
 * 🔴 กฎที่ยึดตามโปรเจค (CLAUDE.md §Patterns · browser storage):
 *   · ทุก read/write ห่อ try/catch — โหมดส่วนตัว/ปิด site data = accessor โยน error ได้
 *   · หน้าต้องทำงานได้ปกติถ้า storage ใช้ไม่ได้ (ทุกตัวที่คืนมาจะกลายเป็น no-op)
 *   · เก็บต่อ "เครื่องของคนนั้น" เท่านั้น — ไม่ใช่ที่เก็บข้อมูลจริง **ห้ามใช้แทนการบันทึกลง DB**
 *   · มีวันหมดอายุ (`ttlMs`) — ร่างเก่าข้ามกะไม่ควรเด้งมาถามอีก
 *   · 🔴 **ห้ามเก็บไฟล์/รูป/ลายเซ็น** — ใหญ่เกิน quota และเป็นของที่กู้กลับไม่ได้จริง
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const PREFIX = 'esm_draft:';
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;   // 12 ชม. — ข้ามกะแล้วถือว่าทิ้ง
const SAVE_DEBOUNCE_MS = 800;
/* เพดานขนาดร่าง — กัน quota ของ localStorage (ปกติ ~5 MB ทั้ง origin) เต็มเพราะฟอร์มเดียว */
const MAX_BYTES = 64 * 1024;

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const drop = (k) => { try { localStorage.removeItem(k); } catch { /* ใช้ไม่ได้ = ไม่มีอะไรต้องลบ */ } };

/** ค่าที่ "ยังไม่ได้กรอกอะไร" — ว่าง/null/false/อาร์เรย์ว่าง ไม่ถือว่าเป็นร่าง */
const isBlank = (v) => v == null || v === '' || v === false
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/** ตัดช่องว่างทิ้งก่อนเก็บ — ร่างที่มีแต่ค่า default ไม่ควรถูกเก็บหรือเด้งมาถาม */
export function draftPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'function' || v instanceof Blob || v instanceof File) continue;  // ไฟล์กู้ไม่ได้ ไม่เก็บ
    if (isBlank(v)) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * @param {string} key   คีย์ของฟอร์ม (ตั้งให้คงที่ · เติมท้ายด้วย id ได้ถ้าเป็นฟอร์มราย record)
 * @param {object} value state ปัจจุบันของฟอร์ม (ออบเจ็กต์ก้อนเดียว)
 * @param {{ skip?: boolean, ttlMs?: number, ignore?: string[] }} [opt]
 *        `skip` = ไม่ต้องเก็บร่างรอบนี้ (เช่นโหมดแก้ใบเดิม) · `ignore` = ช่องที่ไม่ต้องเก็บ
 * @returns {{ found: object|null, savedAt: number|null, restore: () => object|null,
 *            dismiss: () => void, clear: () => void, available: boolean }}
 */
export function useFormDraft(key, value, opt = {}) {
  const { skip = false, ttlMs = DEFAULT_TTL_MS, ignore } = opt;
  const storeKey = key ? PREFIX + key : '';
  const ignoreKey = Array.isArray(ignore) ? ignore.join(',') : '';

  /* ร่างที่เจอตอนเปิดฟอร์ม — อ่านครั้งเดียว ไม่ให้เด้งกลับมาอีกหลังคนกดทิ้ง */
  const [found, setFound] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const liveRef = useRef(value);
  liveRef.current = value;
  /* เคยเก็บอะไรลงไปแล้วหรือยัง — กันการ "ล้าง" คีย์ที่ไม่ใช่ของเรา */
  const wroteRef = useRef(false);

  /* storage ใช้ได้ไหม — ลองเขียนจริงผ่าน helper ที่ห่อ try/catch ไว้แล้ว
     (โหมดส่วนตัว/ปิด site data = `setItem` โยน error ⇒ `write()` คืน false) */
  const available = useMemo(() => {
    const t = PREFIX + '__t';
    const ok = write(t, '1');
    drop(t);
    return ok;
  }, []);

  /* อ่านร่างเดิมตอน mount (ครั้งเดียวต่อคีย์) */
  useEffect(() => {
    if (!storeKey || skip) return;
    const raw = read(storeKey);
    if (!raw) return;
    let obj = null;
    try { obj = JSON.parse(raw); } catch { drop(storeKey); return; }   // ของเสีย = ทิ้ง ไม่ต้องรบกวนคน
    const at = Number(obj?.at) || 0;
    if (!at || Date.now() - at > ttlMs) { drop(storeKey); return; }    // หมดอายุ = ทิ้งเงียบๆ
    const data = draftPayload(obj?.data);
    if (!data) { drop(storeKey); return; }
    setFound(data);
    setSavedAt(at);
  }, [storeKey, skip, ttlMs]);

  /* เก็บร่างแบบหน่วงเวลา — พิมพ์รัวๆ ไม่เขียน localStorage ทุกตัวอักษร */
  useEffect(() => {
    if (!storeKey || skip || !available) return;
    const t = setTimeout(() => {
      let data = draftPayload(liveRef.current);
      if (data && ignoreKey) for (const k of ignoreKey.split(',')) delete data[k];
      if (data && !Object.keys(data).length) data = null;
      if (!data) {
        /* ฟอร์มกลับมาว่าง = ไม่มีร่างให้เก็บ · ล้างเฉพาะคีย์ที่เราเคยเขียนเอง */
        if (wroteRef.current) { drop(storeKey); wroteRef.current = false; }
        return;
      }
      const body = JSON.stringify({ at: Date.now(), data });
      if (body.length > MAX_BYTES) return;   // ใหญ่เกิน = ไม่เก็บ (ห้ามทำให้ quota เต็ม)
      if (write(storeKey, body)) wroteRef.current = true;
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [storeKey, skip, available, ignoreKey, value]);

  /* กดกู้คืน — คืนค่าให้หน้าเอาไปใส่ setState เอง (hook ไม่รู้จักโครง state ของแต่ละฟอร์ม) */
  const restore = useCallback(() => {
    const d = found;
    setFound(null);
    return d;
  }, [found]);

  /** กดทิ้งร่าง — ลบของในเครื่องด้วย (คนตัดสินใจแล้วว่าไม่เอา) */
  const dismiss = useCallback(() => { setFound(null); drop(storeKey); }, [storeKey]);

  /** 🔴 เรียกหลังบันทึกลง DB สำเร็จแล้วเท่านั้น — ข้อมูลอยู่ที่ปลายทางแล้ว ร่างไม่จำเป็นอีก */
  const clear = useCallback(() => { setFound(null); wroteRef.current = false; drop(storeKey); }, [storeKey]);

  return { found, savedAt, restore, dismiss, clear, available };
}

/** ข้อความบอกอายุร่าง — "เมื่อ 5 นาทีที่แล้ว" (ไม่พึ่ง timezone เครื่อง เพราะเทียบส่วนต่าง) */
export function draftAgeText(savedAt, now = Date.now()) {
  const at = Number(savedAt);
  if (!(at > 0)) return '';          // 🔴 ไม่รู้เวลา = ไม่บอกอายุ ห้ามเดาว่า "เมื่อสักครู่"
  const ms = now - at;
  if (!(ms >= 0)) return '';         // เวลาในอนาคต (นาฬิกาเครื่องเพี้ยน) = ไม่บอก
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'เมื่อสักครู่';
  if (min < 60) return `เมื่อ ${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  return `เมื่อ ${hr} ชั่วโมง${min % 60 ? ` ${min % 60} นาที` : ''}ที่แล้ว`;
}
