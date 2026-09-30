import { useEffect, useRef, useState } from 'react';

/* ══ 📏 useFitHeight — "ของชิ้นนี้เหลือที่สูงเท่าไหร่จนถึงก้นจอ" (2026-09-25) ══════════════
   ⛔ **ห้ามเดา `calc(100vh - Npx)` หรือ `78vh`** — กฎนี้มีอยู่แล้วในโปรเจค (UI §6.8) และ
      เคยพังจริง 3 รอบเพราะหัวเพจสูงไม่คงที่: ยุบแถบแท็บ / ชิปทีมขึ้นบรรทัดใหม่ / แถบเตือนโผล่
      ผู้ใช้เห็นเป็น "สเกลแย่" หรือ "จอเลื่อนได้ทั้งที่ควรจบในหน้าเดียว" ทุกครั้ง
   เดิมโค้ดก้อนนี้ถูกก๊อปไว้ 2 ที่ (`FactoryMiniMap` · `MtnAndonBoard`) — ยกมาเป็นของกลาง 25/09
   ตอนทำบอร์ด OBEYA ไม่ให้เลื่อน (จุดที่ 3 = สัญญาณว่าต้องเลิกก๊อปได้แล้ว)

   ⚠️ ใช้ `rect.top + scrollY` (ตำแหน่งเทียบ **เอกสาร**) ไม่ใช่ `rect.top` เฉยๆ —
      ไม่งั้นพอเลื่อนหน้า กล่องจะโตขึ้นเรื่อยๆ แล้วหน้ายิ่งยาว (ลูปกลายๆ)
   ความสูงของกล่องเองไม่กระทบตำแหน่ง *บน* ของกล่อง (มันอยู่ใต้หัวเพจเสมอ) — แต่ **ระยะใต้กล่อง**
   เคยทำลูปจริงมาแล้ว (30/09) ⇒ ต้องวัดจากเนื้อหาจริงเท่านั้น ดู `contentBelow()` ด้านล่าง

   @param {number} bottomReserve  เว้นที่ก้นจอกี่ px (แถบเปลี่ยนหน้า/ระยะหายใจ)
   @param {number} min            ความสูงต่ำสุด — จอเตี้ยมากก็ยังต้องอ่านออก
   @returns {[React.RefObject, number|null]} [ref ที่ต้องแปะกับกล่อง, ความสูงที่ใช้ได้]
            ยังวัดไม่ได้ = null (ให้ผู้เรียกตัดสินใจเอง ห้ามคืน 0 — 0 = กล่องแบนหายไปเลย)
   ══════════════════════════════════════════════════════════════════════════════════════ */
const SAFETY = 8;

/* ── ระยะ "เนื้อหาจริง" ที่อยู่ใต้กล่อง (px) — pure พอที่จะเทสด้วย DOM ปลอมได้ ───────────────
   🔴 บั๊กที่เคยเกิด (30/09 · user ส่งคลิป "บัคๆ"): เวอร์ชันแรกวัด `parent.bottom - node.bottom`
      ไล่ขึ้นทุกชั้น โดยคิดว่า "พ่อโตตามลูก ระยะใต้กล่องจึงไม่ขึ้นกับความสูงกล่อง" — **เท็จ** เมื่อ
      บรรพบุรุษมีความสูงตายตัว: `<main>{minHeight:100vh}` + `html,body{height:100%}`
      ⇒ กล่องเตี้ยลงเท่าไหร่ ช่องว่างใต้ลูกใน <main> ก็โตขึ้นเท่านั้น → ถูกนับเป็น "ของใต้กล่อง"
      → ที่ว่างที่วัดได้ลดลง = reserve+SAFETY (20px) **ทุกรอบ** → บอร์ด 5×2 หดจนข้อความซ้อน →
      หลุดเป็น 6×1 + แถบหน้า → ต่ำกว่า min → null → auto → วนใหม่ (วัดจริงใน harness: 22 สถานะ/5 วิ
      ทุกขนาดจอ · โซนหน่วง 4px กันไม่อยู่เพราะก้าวละ 20px)
   วิธีที่ถูก: นับเฉพาะ **พี่น้องที่อยู่ถัดจาก node ในแต่ละชั้น** (ขอบล่างสุดของพวกมัน − ขอบล่างกล่อง)
      + padding/border ล่างของบรรพบุรุษ — ค่านี้ไม่ขึ้นกับความสูงกล่อง (ของข้างล่างแค่เลื่อนตาม)
      · ข้ามของที่ไม่กินที่ในผัง (fixed/absolute/display:none) · หยุดที่ `root` (document.body)
   @param {Element} el
   @param {{ getStyle?: (n:Element)=>CSSStyleDeclaration, root?: Element|null }} [opt] — ใส่ใน unit test เท่านั้น */
export function contentBelow(el, opt = {}) {
  const getStyle = opt.getStyle || ((n) => getComputedStyle(n));
  const root = 'root' in opt ? opt.root : (typeof document !== 'undefined' ? document.body : null);
  const boxBottom = el.getBoundingClientRect().bottom;
  let bottom = boxBottom;
  let extra = 0;
  for (let node = el; node && node !== root; node = node.parentElement) {
    const parent = node.parentElement;
    if (!parent) break;
    for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
      const st = getStyle(sib);
      if (st.display === 'none' || st.position === 'fixed' || st.position === 'absolute') continue;
      const r = sib.getBoundingClientRect();
      if (!(r.height > 0)) continue;
      bottom = Math.max(bottom, r.bottom + (parseFloat(st.marginBottom) || 0));
    }
    const ps = getStyle(parent);
    extra += (parseFloat(ps.paddingBottom) || 0) + (parseFloat(ps.borderBottomWidth) || 0);
    if (parent === root) break;
  }
  return Math.max(0, bottom - boxBottom) + extra;
}

export default function useFitHeight(bottomReserve = 12, min = 240) {
  const ref = useRef(null);
  const [h, setH] = useState(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const box = el.getBoundingClientRect();
      /* 🔑 ต้องหักของที่อยู่ **ใต้** กล่องด้วย ไม่ใช่แค่ของที่อยู่เหนือ
         (แถบเปลี่ยนหน้า · หมายเหตุท้ายบอร์ด · padding ล่างของ <Page>)
         วัดจาก top อย่างเดียว = พลาดของข้างล่างเสมอ — เคยเหลือเลื่อนอีก 88px เพราะเหตุนี้ (25/09)
         🔴 วัดจาก **เนื้อหาจริงที่อยู่ถัดจากกล่อง** (พี่น้องถัดไปทุกชั้น + padding ล่างของบรรพบุรุษ)
            ห้ามวัดจาก `parent.bottom - node.bottom` — ดู contentBelow() (บั๊กลูปหด 20px/รอบ 30/09) */
      const below = contentBelow(el);
      const docTop = box.top + window.scrollY;
      /* +SAFETY: margin ที่ยุบรวมกัน (margin collapsing) กับเศษ subpixel ทำให้เตี้ยไปได้ ~2-8px
         ยอมเสียที่ 8px ดีกว่าโผล่ scrollbar — ซึ่งคือสิ่งที่ห้ามทั้งหมดของบอร์ดนี้ */
      const avail = Math.round(window.innerHeight - docTop - below - bottomReserve - SAFETY);
      /* 🔴 ที่ไม่พอจริงๆ (จอมือถือที่หัวเพจสูงกว่าครึ่งจอ) → คืน `null` **ห้ามหนีบเป็นค่าต่ำสุด**
         หนีบแล้วจะได้กล่องที่สูงเกินที่มี = หน้าเลื่อนอยู่ดี แถมเนื้อหาโดน clip หาย
         ผู้เรียกต้องถอยไปใช้ความสูงตามเนื้อหา + ยอมให้เลื่อน (ซื่อสัตย์กว่าบีบจนอ่านไม่ออก) */
      const next = avail >= min ? avail : null;
      /* 🔴 **ต้องมีโซนหน่วง (hysteresis)** — ความสูงกล่อง → จำนวนแผ่นต่อหน้า → จำนวนหน้า →
         แถบเปลี่ยนหน้า → ผังกริด → ที่ว่างที่วัดได้ ⇒ เป็นวงจร ถ้าค่าสั่น ±1-2px จะ render วนไม่จบ
         (วัดจริง 25/09: ปุ่ม ▶ ถูก detach ทุกเฟรมจนคลิกไม่ติด) ⇒ ขยับน้อยกว่า 4px ถือว่าเท่าเดิม */
      setH((cur) => {
        if (cur === next) return cur;
        if (cur !== null && next !== null && Math.abs(next - cur) < 4) return cur;
        return next;
      });
    };
    measure();
    /* วัดซ้ำหลังเฟรมแรกและหลังกราฟ/ฟอนต์วาดเสร็จ — รอบแรกหัวเพจยังไม่ครบ (แถบเตือน/ชิปมาทีหลัง)
       ไม่ใช่ polling: ยิง 2 ครั้งแล้วจบ (RO รับช่วงต่อ) */
    const raf = requestAnimationFrame(measure);
    const settle = setTimeout(measure, 300);
    window.addEventListener('resize', measure);
    /* ⚠️ **ห้ามเฝ้า `document.body`** — `index.css` ตั้ง `html,body{height:100%}` ⇒ กล่องของ body
       สูงเท่าจอตลอด ไม่เคยเปลี่ยนขนาด ⇒ ResizeObserver **ไม่เคยยิงเลย** แล้วค่าที่วัดรอบแรก
       (ตอนยังโหลดข้อมูลไม่เสร็จ หัวเพจยังไม่ครบ) ค้างอยู่อย่างนั้นตลอด
       (วัดจริง 25/09: รอบแรกได้ below=705 จากจอที่ยังโหลดไม่เสร็จ → บอร์ดไม่ยอมคุมความสูงเลย)
       ให้เฝ้า **พ่อของกล่อง** ที่โตตามเนื้อหาจริงแทน (ไล่ขึ้นไป 3 ชั้นพอ ครอบหัวเพจ+แถบเตือน) */
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    for (let n = el.parentElement, i = 0; n && i < 3; n = n.parentElement, i++) ro?.observe(n);
    return () => {
      cancelAnimationFrame(raf); clearTimeout(settle);
      window.removeEventListener('resize', measure); ro?.disconnect();
    };
  }, [bottomReserve, min]);

  return [ref, h];
}
