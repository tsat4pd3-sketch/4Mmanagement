import { useEffect, useRef, useState } from 'react';

/* ══ 📏 useFitHeight — "ของชิ้นนี้เหลือที่สูงเท่าไหร่จนถึงก้นจอ" (2026-09-25) ══════════════
   ⛔ **ห้ามเดา `calc(100vh - Npx)` หรือ `78vh`** — กฎนี้มีอยู่แล้วในโปรเจค (UI §6.8) และ
      เคยพังจริง 3 รอบเพราะหัวเพจสูงไม่คงที่: ยุบแถบแท็บ / ชิปทีมขึ้นบรรทัดใหม่ / แถบเตือนโผล่
      ผู้ใช้เห็นเป็น "สเกลแย่" หรือ "จอเลื่อนได้ทั้งที่ควรจบในหน้าเดียว" ทุกครั้ง
   เดิมโค้ดก้อนนี้ถูกก๊อปไว้ 2 ที่ (`FactoryMiniMap` · `MtnAndonBoard`) — ยกมาเป็นของกลาง 25/09
   ตอนทำบอร์ด OBEYA ไม่ให้เลื่อน (จุดที่ 3 = สัญญาณว่าต้องเลิกก๊อปได้แล้ว)

   ⚠️ ใช้ `rect.top + scrollY` (ตำแหน่งเทียบ **เอกสาร**) ไม่ใช่ `rect.top` เฉยๆ —
      ไม่งั้นพอเลื่อนหน้า กล่องจะโตขึ้นเรื่อยๆ แล้วหน้ายิ่งยาว (ลูปกลายๆ)
   ไม่เกิดลูปจริง: ความสูงของกล่องเองไม่กระทบตำแหน่ง *บน* ของกล่อง (มันอยู่ใต้หัวเพจเสมอ)

   @param {number} bottomReserve  เว้นที่ก้นจอกี่ px (แถบเปลี่ยนหน้า/ระยะหายใจ)
   @param {number} min            ความสูงต่ำสุด — จอเตี้ยมากก็ยังต้องอ่านออก
   @returns {[React.RefObject, number|null]} [ref ที่ต้องแปะกับกล่อง, ความสูงที่ใช้ได้]
            ยังวัดไม่ได้ = null (ให้ผู้เรียกตัดสินใจเอง ห้ามคืน 0 — 0 = กล่องแบนหายไปเลย)
   ══════════════════════════════════════════════════════════════════════════════════════ */
const SAFETY = 8;

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
         ไล่ขึ้นไปทีละชั้นแล้วบวก "ช่องว่างใต้ตัวเอง" ของแต่ละชั้น
         ⚠️ ไม่เกิดลูป: ระยะใต้กล่องในแต่ละชั้น **ไม่ขึ้นกับความสูงของกล่องนี้** (พ่อโตตามลูกพร้อมกัน) */
      let below = 0;
      for (let node = el; node && node !== document.body;) {
        const parent = node.parentElement;
        if (!parent) break;
        /* ⚠️ หนีบไม่ให้ติดลบ — `html,body{height:100%}` ทำให้ `body.bottom` **เตี้ยกว่า**
           ลูกที่ล้นออกไป ⇒ ได้ค่าลบ (วัดจริงได้ -104) แล้วไปลบล้างของจริงที่อยู่ใต้กล่อง */
        below += Math.max(0, parent.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom);
        node = parent;
      }
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
