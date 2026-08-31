/* ══════════════════════════════════════════════════════════════════════════
   <SearchSelect> — ช่องเลือกที่ "ค้นหาได้" สำหรับลิสต์ยาว  (2026-08-24)

   ที่มา (feedback หน้างาน): ช่องเลือกอะไหล่ในขั้นซ่อม MO เป็น <select> ที่ยัด
   ทุกแถวลงไป — อะไหล่หลักพันรายการ เลื่อนหาไม่เจอ และไม่มีช่องค้นหา
   (<select> ของ browser ค้นได้แค่ "พิมพ์ตัวแรกให้ตรง" ซึ่งใช้ไม่ได้กับชื่อไทย/รหัส)

   ⚠️ กฎ: dropdown ที่ลิสต์ยาวเกิน ~30 รายการ ให้ใช้ component นี้แทน <select>
      (อะไหล่ · เครื่องจักร · พนักงาน · สินค้า) — ห้ามปล่อยเป็น <select> ยาวๆ
      ลิสต์สั้น (ประเภท/สถานะ/ทีม) ใช้ <select> ปกติดีกว่า (native picker เร็วกว่าบนมือถือ)

   สิ่งที่ component นี้รับประกัน:
     1. **ค้นได้หลายคีย์** — ชื่อ + คีย์เสริม (`keywords`: รหัส/ชั้นวาง/หมวด) ตัดช่องว่าง-ขีดก่อนเทียบ
     2. **ไม่ตัดของหายเงียบ** — เกิน `maxRows` จะบอกว่าซ่อนไปกี่รายการ
     3. **พิมพ์ชื่อเองได้** (`allowFree`) — ของที่ไม่มีในทะเบียนยังบันทึกได้ พร้อมป้ายบอกว่าไม่ได้อยู่ในทะเบียน
     4. **ลิสต์กางในบรรทัด (in-flow) ไม่ absolute** — อยู่ใน modal ที่ overflow:auto ได้โดยไม่โดน clip

   ⚠️ ปิดลิสต์จากการคลิกนอกกรอบ **ได้** (เป็น picker ไม่ใช่ฟอร์ม — ยังไม่ได้กรอกอะไรหาย)
      คนละเรื่องกับกติกา "modal ฟอร์มห้ามปิดจาก backdrop" (UI-CONVENTIONS §5)

   onChange({ id, text, opt }) — เลือกจากลิสต์ = ครบทั้ง 3 · พิมพ์เอง = id ว่าง, opt null
   ══════════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useRef, useState } from 'react';

/** ตัดช่องว่าง/ขีด/จุด/วงเล็บ + lowercase — คนพิมพ์รหัสอะไหล่ไม่เป๊ะ (M8 D6.6 / m8d66) */
export const normSearch = (s) => String(s ?? '').toLowerCase().replace(/[\s\-_./()]+/g, '');

export default function SearchSelect({
  value = '',            // id ที่เลือกอยู่ ('' = ยังไม่ได้เลือกจากลิสต์)
  text = '',             // ข้อความในช่อง (เมื่อยังไม่ได้เลือก = คำค้น/ชื่อที่พิมพ์เอง)
  options = [],          // [{ id, label, sub, badge, badgeColor, group, keywords }]
  onChange,              // ({ id, text, opt }) => void
  allowFree = false,     // พิมพ์ชื่อที่ไม่มีในลิสต์ได้ไหม
  placeholder = 'ค้นหา…',
  emptyText = 'ไม่พบรายการที่ค้นหา',
  freeHint = '',         // ต่อท้ายข้อความ "ใช้ … เป็นชื่อที่พิมพ์เองได้" (ผลข้างเคียงเฉพาะหน้านั้น)
  maxRows = 60,
  disabled = false,
  inputStyle,
  style,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const listRef = useRef(null);

  const sel = useMemo(() => options.find(o => o.id === value) || null, [options, value]);
  // เลือกแล้ว = ไม่ถือว่ากำลังค้น (ไม่งั้นเปิดลิสต์อีกทีจะเหลือแถวเดียวคือตัวที่เลือก)
  const q = sel ? '' : text;
  const shown = sel ? sel.label : text;

  const matched = useMemo(() => {
    const nq = normSearch(q);
    if (!nq) return options;
    return options.filter(o => normSearch(`${o.label} ${o.keywords || ''}`).includes(nq));
  }, [options, q]);

  const rows = matched.slice(0, maxRows);
  const hidden = matched.length - rows.length;

  useEffect(() => { setActive(0); }, [q, open]);

  // ปิดเมื่อคลิกนอกกรอบ (picker — ไม่ใช่ฟอร์ม จึงปิดจากคลิกนอกได้)
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away); };
  }, [open]);

  const pick = (o) => { onChange?.({ id: o.id, text: o.label, opt: o }); setOpen(false); };
  const clear = () => { onChange?.({ id: '', text: '', opt: null }); setOpen(true); };

  const onKey = (e) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { if (rows[active]) { e.preventDefault(); pick(rows[active]); } }
  };

  // เลื่อนแถวที่เลือกด้วยคีย์บอร์ดให้อยู่ในสายตา
  useEffect(() => {
    const el = listRef.current?.children?.[active];
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const inp = {
    width: '100%', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '8px 30px 8px 10px', color: 'var(--text)', fontSize: 13, ...inputStyle,
  };

  return (
    <div ref={boxRef} style={{ position: 'relative', ...style }}>
      <div style={{ position: 'relative' }}>
        <input
          value={shown}
          disabled={disabled}
          placeholder={placeholder}
          onChange={e => { onChange?.({ id: '', text: e.target.value, opt: null }); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          style={inp}
        />
        {shown
          ? <button type="button" onClick={clear} disabled={disabled} title="ล้าง"
              style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 15, cursor: 'pointer', padding: '2px 6px', lineHeight: 1 }}>✕</button>
          : <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 12, pointerEvents: 'none' }}>🔎</span>}
      </div>

      {/* ⚠️ พิมพ์ชื่อเองแล้วไม่ตรงลิสต์ = ยังบันทึกได้ แต่ต้องบอกให้เห็น ไม่ปล่อยเงียบ */}
      {!open && allowFree && !sel && text.trim() !== '' && (
        <div style={{ fontSize: 10.5, color: 'var(--accent2)', marginTop: 3 }}>✎ ชื่อที่พิมพ์เอง — ไม่ได้อยู่ในทะเบียน</div>
      )}

      {open && (
        <div style={{ marginTop: 4, background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 8, overflow: 'hidden' }}>
          <div ref={listRef} style={{ maxHeight: 244, overflowY: 'auto' }}>
            {rows.map((o, i) => {
              const head = i === 0 || rows[i - 1].group !== o.group;
              return (
                <div key={o.id}>
                  {o.group && head && (
                    <div style={{ padding: '5px 10px 3px', fontSize: 10.5, fontWeight: 800, color: 'var(--muted)', background: 'var(--bg3)' }}>{o.group}</div>
                  )}
                  <div
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={e => { e.preventDefault(); pick(o); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer',
                      background: i === active ? 'var(--bg2)' : 'transparent',
                      borderLeft: `3px solid ${i === active ? 'var(--accent)' : 'transparent'}`,
                    }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</div>
                      {o.sub && <div style={{ fontSize: 10.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.sub}</div>}
                    </div>
                    {o.badge != null && (
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: o.badgeColor || 'var(--text2)' }}>{o.badge}</span>
                    )}
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--muted)' }}>
                {emptyText}
                {allowFree && q.trim() !== '' && <div style={{ marginTop: 3, color: 'var(--accent2)', fontSize: 11.5 }}>ใช้ “{q.trim()}” เป็นชื่อที่พิมพ์เองได้ — กดนอกกรอบเพื่อยืนยัน{freeHint ? ` (${freeHint})` : ''}</div>}
              </div>
            )}
          </div>
          {/* ⚠️ ห้ามตัดของหายเงียบ — บอกเสมอว่าซ่อนไปกี่รายการ */}
          {hidden > 0 && (
            <div style={{ padding: '5px 10px', fontSize: 10.5, color: 'var(--muted)', borderTop: '1px solid var(--border)', background: 'var(--bg3)' }}>
              แสดง {rows.length} จาก {matched.length} — พิมพ์เพิ่มเพื่อค้นให้แคบลง (ซ่อน {hidden})
            </div>
          )}
        </div>
      )}
    </div>
  );
}
