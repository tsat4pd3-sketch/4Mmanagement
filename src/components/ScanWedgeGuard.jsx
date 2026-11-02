import { useEffect } from 'react';
import useIsMobile from '../utils/useIsMobile';
import { toast } from './Toast';
import { createBurstTracker, isNumericField, isTypingField, SCAN_EVENT } from '../utils/scanWedge';
import { parseQrPayload } from '../utils/qrCode';

/* ══ 🔫 ScanWedgeGuard — ด่านกลางของปุ่มสแกนข้างเครื่อง handheld (2026-10-20) ══════════════════════════
   ตัดสินด้วย `utils/scanWedge.js` (pure · มีเทส) · ไม่วาดอะไรบนจอ · **มือถือเท่านั้น** (จอคอมไม่ติดตั้ง = เหมือนเดิม)
   ฟังที่ window **ช่วง capture** ⇒ เห็นปุ่มก่อน React ทุกตัว (React ผูก listener ไว้ที่ root)

   สแกนจบ (ตัวอักษรรัว + Enter) แล้วเคอร์เซอร์อยู่ที่…
   · ช่องตัวเลข (จำนวน/นาที/ยอด) → **คืนค่าเดิมของช่อง + กลืน Enter** + เตือน (เดิม: เลขบาร์โค้ดกลายเป็นยอด)
   · dropdown `<select>` → คืนค่าเดิม (ตัวอักษรที่ยิงเข้า select = กระโดดไปตัวเลือกอื่นเงียบๆ) + กลืน Enter
   · ปุ่ม/ที่ว่าง (ไม่มีช่องรับ) → กลืน Enter (เดิม: Enter ไปกดปุ่มที่โฟกัสค้าง เช่น "บันทึก")
       แล้วยิง `esm:scan` ให้หน้าที่อยากรับ (`e.preventDefault()` = รับแล้ว) · ไม่มีใครรับ = บอกบนจอ ห้ามหายเงียบ
   · ช่องข้อความ → ปล่อยผ่าน (ช่องสแกนปกติ) แต่แปะ `__esmScan` บน event ให้ SearchSelect เลือกแบบตรงเป๊ะ
   Enter ตัวที่ 2 ของ CR+LF ที่ตามมาติดๆ → กลืนเสมอ
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const nativeSet = (el, v) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
    : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
  // React ฟัง input/change จริง — ต้องยิงให้ state ในหน้ากลับเป็นค่าเดิมด้วย ไม่ใช่แค่ตัวเลขบนจอ
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
};

const buzz = (pattern) => { try { navigator.vibrate?.(pattern); } catch { /* บางเครื่องปิดการสั่น */ } };

export default function ScanWedgeGuard() {
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!isMobile) return undefined;
    const tracker = createBurstTracker();

    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) { tracker.feed({ key: '', t: e.timeStamp }); return; }
      const el = document.activeElement;
      const r = tracker.feed({ key: e.key, t: e.timeStamp, target: el, value: el && 'value' in el ? String(el.value ?? '') : '' });

      if (r.kind === 'trail') { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (r.kind !== 'scan') return;

      e.__esmScan = r.raw;
      const tg = r.target;

      if (isNumericField(tg) || tg?.tagName === 'SELECT') {
        e.preventDefault(); e.stopImmediatePropagation();
        nativeSet(tg, r.startValue);
        buzz([80, 60, 80]);
        toast.error(`สแกน "${r.raw}" ลงช่อง${tg.tagName === 'SELECT' ? 'ตัวเลือก' : 'ตัวเลข'}ไม่ได้ — คืนค่าเดิมให้แล้ว · แตะช่องที่ต้องการสแกนก่อน แล้วยิงใหม่`);
        return;
      }
      if (isTypingField(tg)) return;   // ช่องข้อความ = ช่องสแกนปกติ ปล่อยให้หน้าจัดการ

      // ไม่มีช่องรับ — ห้ามให้ Enter ไปกดปุ่มที่โฟกัสค้าง แล้วถามหน้าว่าใครรับรหัสนี้
      e.preventDefault(); e.stopImmediatePropagation();
      const ev = new CustomEvent(SCAN_EVENT, { cancelable: true, detail: { raw: r.raw, parsed: parseQrPayload(r.raw) } });
      const claimed = !window.dispatchEvent(ev);
      if (!claimed) {
        buzz([80, 60, 80]);
        toast.info(`สแกนได้ "${r.raw}" แต่จอนี้ไม่มีช่องรอรับ — แตะช่องที่จะกรอกก่อนแล้วยิงใหม่ หรือกด 📷 สแกน ที่แถบล่าง`);
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isMobile]);

  return null;
}
