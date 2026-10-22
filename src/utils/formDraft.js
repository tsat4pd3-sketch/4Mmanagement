/* ══ 📝 formDraft — เก็บ "ร่าง" ของฟอร์มยาวไว้ในเครื่อง (2026-10-22 · audit handheld ข้อ 4) ══════════════
   ฟอร์มที่บันทึกทีเดียวตอนท้าย (เช็คชื่อ · LPA · ตรวจ PM · ตรวจนับสต๊อก · ใบ Scrap) หายทั้งใบเมื่อ:
   เน็ตหลุดแล้วรีโหลด · ระบบเตะออกตอนหมดกะ · สแกน/เลือกเครื่องอื่นกลางฟอร์ม · ปิดหน้าต่างพลาด
   ⇒ เก็บร่างลง localStorage ระหว่างกรอก แล้วถามตอนกลับมาเปิดชุดเดิมว่าจะ "กู้คืน" ไหม

   🔴 กติกา:
   · ร่าง = **ของช่วยจำบนเครื่องนี้เท่านั้น** ไม่ใช่ข้อมูลจริง — ห้ามเอาไปนับ/รายงาน · ห้ามเขียน DB เองตอนกู้คืน
     (กู้คืน = เติมกลับเข้าฟอร์ม แล้วคนกดบันทึกเอง)
   · คีย์ต้องผูกกับ "ชุดที่กรอก" ครบทุกแกน (ไลน์/กะ/วันที่/เครื่อง/ผู้ใช้) — คีย์หลวม = ร่างของอีกชุดไปโผล่ผิดที่
   · หมดอายุ `DRAFT_MAX_AGE_MS` (ข้ามกะแล้วร่างเก่าไม่มีความหมาย) · บันทึกสำเร็จ = ล้างร่าง
   · localStorage อาจใช้ไม่ได้ (โหมดส่วนตัว/เต็ม) ⇒ ทุกตัวห้าม throw — ล้ม = แค่ไม่มีร่าง (ฟอร์มยังใช้ได้ปกติ)
   · ตอนนี้เปิดเฉพาะมือถือ (จอคอมไม่วาดแถบกู้คืน — กฎ "จอคอมห้ามเปลี่ยน") ตัวไฟล์นี้ไม่ผูกกับขนาดจอ
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
import { useEffect, useRef } from 'react';

const PREFIX = 'esm_draft_v1:';
export const DRAFT_MAX_AGE_MS = 14 * 60 * 60 * 1000;   // 14 ชม. ≈ เกินกะยาวสุด (กะ+OT) แล้วทิ้ง

const store = () => { try { return window.localStorage; } catch { return null; } };

/** เก็บร่าง — คืน true ถ้าเก็บได้ */
export function saveDraft(key, data, now = Date.now()) {
  const s = store(); if (!s || !key) return false;
  try { s.setItem(PREFIX + key, JSON.stringify({ at: now, data })); return true; } catch { return false; }
}

/** อ่านร่าง — หมดอายุ/อ่านไม่ออก = null (และลบทิ้ง) */
export function loadDraft(key, { now = Date.now(), maxAgeMs = DRAFT_MAX_AGE_MS } = {}) {
  const s = store(); if (!s || !key) return null;
  try {
    const raw = s.getItem(PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v.at !== 'number' || now - v.at > maxAgeMs) { s.removeItem(PREFIX + key); return null; }
    return v;
  } catch { return null; }
}

export function clearDraft(key) {
  const s = store(); if (!s || !key) return;
  try { s.removeItem(PREFIX + key); } catch { /* ไม่มีที่เก็บ = ไม่มีอะไรให้ล้าง */ }
}

/** ล้างร่างที่หมดอายุทั้งเครื่อง (เรียกตอนเปิดแอป) — ร่างค้างไม่ให้กินที่ localStorage */
export function purgeOldDrafts({ now = Date.now(), maxAgeMs = DRAFT_MAX_AGE_MS } = {}) {
  const s = store(); if (!s) return 0;
  let n = 0;
  try {
    const keys = [];
    for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.startsWith(PREFIX)) keys.push(k); }
    for (const k of keys) {
      try { const v = JSON.parse(s.getItem(k)); if (!v || now - v.at > maxAgeMs) { s.removeItem(k); n++; } }
      catch { s.removeItem(k); n++; }
    }
  } catch { /* เครื่องไม่ให้อ่าน = ข้าม */ }
  return n;
}

/** เวลาที่เก็บร่าง แบบสั้นๆ ไว้เขียนบนแถบกู้คืน (HH:MM เวลาไทย) */
export function draftTimeText(at) {
  try { return new Date(at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

/**
 * เก็บร่างอัตโนมัติระหว่างกรอก (หน่วง 600ms หลังพิมพ์ครั้งสุดท้าย · เก็บทันทีตอนแอปถูกพับ/ปิด)
 * @param {string|null} key   null = ไม่เก็บ (ยังโหลดไม่เสร็จ / ไม่ใช่มือถือ)
 * @param {any} data          ของที่จะเก็บ (ต้อง JSON ได้ — ไฟล์รูปให้ตัดออกก่อน)
 * @param {boolean} dirty     มีอะไรที่ยังไม่บันทึกไหม · false = ล้างร่าง (กรอกกลับเป็นเหมือนเดิม/บันทึกแล้ว)
 */
export function useDraftAutosave(key, data, dirty) {
  const latest = useRef({ key, data, dirty });
  latest.current = { key, data, dirty };
  const json = key && dirty ? JSON.stringify(data) : '';

  useEffect(() => {
    if (!key) return undefined;
    if (!dirty) { clearDraft(key); return undefined; }
    const t = setTimeout(() => saveDraft(key, JSON.parse(json)), 600);
    return () => clearTimeout(t);
  }, [key, dirty, json]);

  // แอปถูกพับ (กดปุ่มโฮม/ล็อกจอ) = เก็บเดี๋ยวนี้ ไม่รอหน่วง — Android ฆ่าแท็บพื้นหลังได้ทุกเมื่อ
  useEffect(() => {
    const flush = () => { const c = latest.current; if (c.key && c.dirty) saveDraft(c.key, c.data); };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flush);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', flush); };
  }, []);
}
