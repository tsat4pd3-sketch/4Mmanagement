/* ══ 🗂 TabBody — เนื้อหาแท็บที่ "สลับแบบมีจังหวะ" (2026-11-24 · ของกลาง · รีล CRM Dashboard V10) ═══════
   ห่อเนื้อหาใต้แถบแท็บ: เนื้อหาเก่าจางลง → ใหม่โผล่ขึ้นมา (props จาก `tabSwitch()` ใน utils/motion.js · นิ่งบนจอ TV/reduced-motion)
   · `tab` = คีย์แท็บปัจจุบัน (จาก useTabParam) — เปลี่ยนคีย์ = เล่นจังหวะ · รีเฟรชข้อมูลในแท็บเดิม = ไม่เล่น
   · ใช้คู่ `<Skeleton>` ตอน Suspense/โหลดครั้งแรก ⇒ เห็น "โครง" ก่อนแล้วค่อยเห็นของจริง
   · ⚠️ ไม่เปลี่ยน layout: เป็น div ธรรมดาที่ transform/opacity (Chromium 94 ได้) · `mode="wait"` = ไม่ซ้อน 2 แท็บ (ความสูงไม่กระโดด)
   ใช้: `<TabBody tab={tab}>{body}</TabBody>` */
import { AnimatePresence, motion } from 'framer-motion';
import { tabSwitch } from '../utils/motion';

export default function TabBody({ tab, children, style }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={tab} {...tabSwitch()} style={{ minWidth: 0, ...style }}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
