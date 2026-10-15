import { Children, Fragment, isValidElement, useLayoutEffect, useRef, useState } from 'react';
import SearchInput from './SearchInput';
import Segmented from './Segmented';

/* ══ 🔎 MobileFilterFold — พับแถบตัวกรองบนมือถือ (2026-10-15 · docs/MOBILE-UX-STANDARD.md §2 ข้อ 3) ══════════════
   ปัญหาที่เจอบน handheld 360×640: แถบกรอง (ช่วงเวลา + dropdown 5 ตัว + กะ + ค้นหา) กินจอแรกทั้งจอ
   ⇒ ปุ่มหลัก ("➕ แจ้งซ่อมใหม่" /mtn-repair) ตกไปจอที่ 2 · คนหน้างานเปิดมาเพื่อ "ทำงาน" ไม่ใช่ "กรอง"
   หลัก (NN/g progressive disclosure): โชว์ "สรุปว่ากรองอะไรอยู่" 1 บรรทัด แตะแล้วค่อยกาง

   กติกา:
   1. **ใช้เฉพาะมือถือ** — ตัวเรียก (FilterBar / TimeRangeBar / PageHeader) ต้อง render แบบเดิมเป๊ะเมื่อไม่ใช่มือถือ
   2. ของหลัง `<span className="spacer" />` (จำนวนรายการ / ปุ่มหลัก) + `<button>` ตรงๆ ในแถบ = `tail` → **โชว์เสมอ** ไม่พับ
   3. `<SearchInput>` + `<Segmented>` **โชว์เสมอ** (ซ่อนช่องค้นหา = คนไม่รู้ว่าค้นได้ · Segmented = มุมมอง) — แยกด้วย `splitFilterChildren()`
   4. ตัวที่พับ **ซ่อนด้วย display:none ไม่ unmount** ⇒ ค่าที่เลือกไว้/สถานะภายในไม่หาย
   5. ป้ายค่าที่ตั้งไว้ (เช่น "🔵 ยังไม่ปิด +1") อ่านจากหน้าจอจริง (select ที่ไม่ใช่ตัวเลือกแรก = "ทั้งหมด" · ช่องข้อความที่มีค่า ·
      Segmented ที่ไม่ได้เลือกตัวแรก) — คนต้องรู้ว่ามีตัวกรองค้างอยู่ ไม่งั้นงงว่า "ทำไมรายการหาย"
   ════════════════════════════════════════════════════════════════════════════════════════════ */

const isSpacer = (c) => isValidElement(c) && typeof c.props?.className === 'string' && /(^|\s)spacer(\s|$)/.test(c.props.className);

/** แยก children เป็น { fold: ตัวที่พับได้, search: ช่องค้นหา (โชว์เสมอ), tail: ของหลัง spacer (โชว์เสมอ) } */
export function splitFilterChildren(children) {
  // คลี่ <>…</> ออก (หน้าส่ง `filters={<>…</>}` เป็นก้อนเดียวบ่อย) — ไม่คลี่ = นับเป็นตัวกรองตัวเดียว ไม่ถูกพับ
  const flat = (list) => Children.toArray(list).flatMap(c => (isValidElement(c) && c.type === Fragment ? flat(c.props.children) : [c]));
  const arr = flat(children);
  const at = arr.findIndex(isSpacer);
  const head = at < 0 ? arr : arr.slice(0, at);
  const tail = at < 0 ? [] : arr.slice(at + 1);
  /* โชว์เสมอ: ช่องค้นหา + <Segmented> (2–5 ตัวเลือกสั้นๆ ที่มักเป็น "มุมมอง" เช่น 🟡 ถังเหลือง / 🔴 ถังแดง · กะ —
     พับทิ้ง = คนไม่รู้ว่ากำลังดูถังไหน · วัดจริง /qa ถังเหลือง-แดง 15/10) */
  const search = head.filter(c => isValidElement(c) && (c.type === SearchInput || c.type === Segmented));
  /* ปุ่ม <button> ตรงๆ ในแถบ = "คำสั่ง" (โหลด/บันทึก/เพิ่ม) ไม่ใช่ตัวกรอง ⇒ ไม่พับ (บางหน้าไม่ได้ใส่ spacer คั่น
     แล้ววางปุ่มหลักปนกับตัวกรอง — พับทิ้ง = ปุ่มหลักหายจากจอ ซึ่งคือปัญหาที่ทำตัวนี้มาแก้) */
  const isCmd = c => isValidElement(c) && c.type === 'button';
  const fold = head.filter(c => !(isValidElement(c) && (c.type === SearchInput || c.type === Segmented)) && !isCmd(c));
  return { fold, search, tail: [...head.filter(isCmd), ...tail] };
}

/** ตัวกรองที่ตั้งไว้ (ไม่ใช่ค่า "ทั้งหมด") → ป้ายสั้นๆ ของค่าที่เลือก เช่น ['🔵 ยังไม่ปิด'] */
function activeLabels(root) {
  if (!root) return [];
  const out = [];
  root.querySelectorAll('select').forEach(s => { if (s.selectedIndex > 0) out.push((s.options[s.selectedIndex]?.text || '').trim()); });
  root.querySelectorAll('input[type=text], input[type=search], input:not([type])').forEach(i => { if (i.value) out.push(`"${i.value}"`); });
  root.querySelectorAll('.seg').forEach(g => { const on = g.querySelector('button.on'); if (on && on !== g.firstElementChild) out.push(on.textContent.trim()); });
  return out.filter(Boolean);
}

export default function MobileFilterFold({ summary, search, tail, children }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef(null);
  const [active, setActive] = useState([]);
  // อ่านใหม่ทุก render (ตัวกรองเป็น controlled ⇒ แม่ re-render ทุกครั้งที่ค่าเปลี่ยน) · set เฉพาะตอนค่าเปลี่ยน
  useLayoutEffect(() => {
    const a = activeLabels(bodyRef.current);
    if (a.join('|') !== active.join('|')) setActive(a);
  });

  return (
    <>
      <div className="mfold-head">
        {search}
        <button type="button" className="mfold-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <span className="mfold-ico" aria-hidden="true">🔎</span>
          <span className="mfold-txt">
            <b>ตัวกรอง</b>{summary ? <span className="mfold-sum"> · {summary}</span> : null}
          </span>
          {/* บอก "ค่าที่ตั้งไว้" ไม่ใช่แค่จำนวน — คนต้องรู้ว่าทำไมรายการหาย (เช่น 🔵 ยังไม่ปิด) */}
          {active.length > 0 && <span className="mfold-n" title={active.join(' · ')}>{active[0]}{active.length > 1 ? ` +${active.length - 1}` : ''}</span>}
          <span className="mfold-car" aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
        {tail?.length ? <span className="mfold-tail">{tail}</span> : null}
      </div>
      <div ref={bodyRef} className="mfold-body" style={{ display: open ? 'contents' : 'none' }}>
        {children}
      </div>
    </>
  );
}
