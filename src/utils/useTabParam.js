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
