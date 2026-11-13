/* ══ ⋯ OverflowMenu — "คำสั่งอื่นๆ" ของหน้า/การ์ด (2026-11-04 · คำสั่ง user "ปุ่มเยอะ · pattern ไม่เหมือนกัน") ══
   กติกา UI-CONVENTIONS §6.35: แถวคำสั่งระดับหน้า/การ์ดมี **ปุ่มตายตัว ≤ 2** ที่เหลือเข้าเมนูนี้
   · ปุ่มไม่ย้ายตามความถี่ (user 04/11: "เอาปุ่มตายตัวดีกว่า กลัวขยายผลและจะงง")
   · รายการที่ไม่มีสิทธิ์/ไม่เข้าเงื่อนไข = ส่ง `hidden: true` หรือกรองออกก่อน — เมนูว่าง = ไม่วาดปุ่มเลย
   · เพดาน Chromium 94: ไม่ใช้ :has()/color-mix · เงาผ่าน token `--shadow-md` (ของที่ลอยจริง · UI §6.20)

   ใช้:
     <OverflowMenu items={[
       { key: 'manpower', icon: '🔄', label: 'จัดกำลังคน', onClick, title },
       { key: 'void', label: 'ทำกะเปล่าเป็นโมฆะ', onClick, danger: true, hidden: !canVoid },
     ]} />
   `badge` = ตัวเลข/ข้อความสั้นท้ายรายการ (งานค้างในใบ) · `disabled` + `title` = กดไม่ได้พร้อมเหตุผล · `drop="up"` = กางขึ้น (ปุ่มอยู่แถบล่าง) */
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

import { tr } from '../utils/i18n';
export default function OverflowMenu({ items = [], label = 'เพิ่มเติม', size = 34, align = 'right', drop = 'down', style }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const list = items.filter(it => it && !it.hidden);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!list.length) return null;

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex', ...style }}>
      <button type="button" className="pg-btn pg-btn-icon" aria-haspopup="menu" aria-expanded={open}
        title={label} aria-label={label} onClick={() => setOpen(o => !o)}
        style={{ width: size, height: size }}>
        <span aria-hidden="true" style={{ display: 'inline-flex', gap: 3 }}>
          <i className="pg-dot" /><i className="pg-dot" /><i className="pg-dot" />
        </span>
      </button>
      {open && (
        /* `drop="up"` = เมนูกางขึ้น — ใช้เมื่อปุ่มอยู่แถบล่างของโมดัล/จอ (กางลงจะโดนขอบตัด · เจอจริง MO 05/11) */
        <div role="menu" className="pg-menu" style={{ [align === 'left' ? 'left' : 'right']: 0, ...(drop === 'up' ? { top: 'auto', bottom: 'calc(100% + 6px)' } : {}) }}>
          {list.map(it => (
            <button key={it.key || it.label} type="button" role="menuitem" className={`pg-menu-item${it.danger ? ' danger' : ''}`}
              disabled={it.disabled} title={it.title}
              onClick={() => { if (it.disabled) return; setOpen(false); it.onClick?.(); }}>
              {it.icon && <span className="pg-menu-ico" aria-hidden="true"><Icon glyph={it.icon} size={15} /></span>}
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>{tr(it.label)}</span>
              {it.badge != null && it.badge !== '' && <span className="pg-menu-badge">{it.badge}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
