import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/* ══ useTabParam — ผูก "แท็บในหน้า" กับ URL (?tab=) ══════════════════════════════════════
   มาตรฐาน web app: สิ่งที่ผู้ใช้เห็นว่า "ตัวเองอยู่ตรงไหน" ต้องอยู่ใน URL
   ⇒ แชร์ลิงก์ตรงแท็บได้ · refresh แล้วอยู่แท็บเดิม · ปุ่ม Back กลับแท็บก่อนหน้า
   (ดู docs/NAVIGATION-REVIEW.md — เดิม 17 หน้ามีแท็บ แต่ deep-link ได้แค่ 3)

   ใช้แทน useState ของแท็บได้ตรงๆ:
     const [tab, setTab] = useTabParam(['list', 'kpi', 'spare'], 'list');

   กติกา:
   • ค่าที่ไม่รู้จักใน URL → ตกกลับแท็บ default (ห้ามจอว่าง)
   • แท็บ default ไม่ใส่ใน URL (ลิงก์สะอาด `/mtn-repair` = แท็บแรก)
   • เปลี่ยนแท็บ = push history (Back กลับแท็บก่อนหน้าได้ตามที่ผู้ใช้คาด)
   • param อื่นใน URL (เช่น ?line=) ถูกรักษาไว้เสมอ

   ⚠️ `setTab(k, { replace: true })` สำหรับการสลับที่ "ระบบสั่งเอง" ไม่ใช่ผู้ใช้กด
      (เช่น บันทึกเสร็จแล้วเด้งกลับหน้ารายการ) — ถ้า push ผู้ใช้กด Back จะย้อนเข้าฟอร์มเปล่า
      ที่เพิ่งบันทึกไปแล้ว ซึ่งไม่มีใครคาดหวัง · ผู้ใช้กดแท็บเอง = push เสมอ (ค่าเริ่มต้น)
   ═════════════════════════════════════════════════════════════════════════════════════════ */
export default function useTabParam(keys, defaultKey, param = 'tab') {
  const [sp, setSp] = useSearchParams();
  const list = Array.isArray(keys) ? keys : [];
  const def = defaultKey !== undefined ? defaultKey : list[0];
  const raw = sp.get(param);
  const hit = list.find(k => String(k) === raw);
  const tab = hit !== undefined ? hit : def;

  const setTab = useCallback((k, opts) => {
    const next = new URLSearchParams(sp);
    if (String(k) === String(def)) next.delete(param);
    else next.set(param, String(k));
    setSp(next, { replace: !!opts?.replace });
  }, [sp, setSp, def, param]);

  return [tab, setTab];
}

/* ══ useMergeParams — setter ที่ "รวม" param ใหม่เข้ากับของเดิมเสมอ ═══════════════════════
   🔴 ที่มา (บั๊กจริง 2026-09-16 · user ส่งคลิปมา): กดแท็บ "ส่วนงาน" ใน ⚙️ ตั้งค่าจุดตรวจ แล้วจอ
      เด้งไปแท็บ "✅ ตรวจอุปกรณ์" เอง — เพราะหน้าลูกเขียน `setSearchParams({ dept: d })`
      ซึ่ง**ล้าง param อื่นทั้งหมดทิ้ง** รวมทั้ง `?tab=setup` ของหน้าแม่ (PmHub)
      ⇒ หน้าแม่หา tab ไม่เจอ เลยตกกลับแท็บแรก · เจอซ้ำ 3 หน้า (PMSetup · PMSchedule · PMCheckData)

   **ห้ามเรียก `setSearchParams({...})` ตรงๆ เมื่อหน้านั้นอยู่ใต้หน้าแม่ที่มีแท็บ** — ใช้ตัวนี้แทน
   (ล้าง param ตั้งใจได้ด้วยการส่งค่า null/'' เช่น `setParams({ equip: null })`)
   ═════════════════════════════════════════════════════════════════════════════════════════ */
export function mergeParams(prev, patch) {
  const next = new URLSearchParams(prev);
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === null || v === undefined || v === '') next.delete(k);
    else next.set(k, String(v));
  }
  return next;
}

export function useMergeParams() {
  const [, setSp] = useSearchParams();
  return useCallback((patch, opts) => setSp(prev => mergeParams(prev, patch), opts), [setSp]);
}
