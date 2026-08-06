import { useState, useRef, useEffect } from 'react';

/* ── EmojiPicker — ช่องเลือกไอคอน emoji จากชุดธีมโรงงาน (ใช้ซ้ำทุกที่ที่มีช่อง icon) ─────
   props: value, onChange(emoji), style (ของ input), placeholder
   - ยังพิมพ์เองได้ + ปุ่มเปิด grid เลือกจากชุด curated (เครื่องจักร/กระบวนการ/สถานะ/สี)
   - theme-aware (CSS var ล้วน) · ปิดเมื่อคลิกนอกกรอบ
*/
const EMOJI_GROUPS = [
  { label: 'เครื่องจักร / กระบวนการ', items: ['⚙️', '🔧', '🛠️', '🏭', '🔩', '🪛', '🔨', '⚡', '🔥', '💧', '💨', '🌀', '🖥️', '🤖', '🦾', '🔬', '🧪', '🧰', '⛓️', '🪝'] },
  { label: 'งาน / สถานะ', items: ['✅', '🛡️', '📋', '📊', '📦', '🚚', '🏷️', '🔗', '📌', '🎯', '🚨', '⏱️', '🕒', '🔔', '💡', '📍', '🧯', '♻️', '🔒', '🧲'] },
  { label: 'จุด / สี', items: ['🟢', '🟡', '🔴', '🔵', '🟣', '🟠', '⚫', '⚪', '🟤', '⭐', '❤️', '🔆'] },
];

export default function EmojiPicker({ value, onChange, style, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const cell = { width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: 'pointer', borderRadius: 7, border: '1px solid transparent', background: 'transparent', lineHeight: 1 };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder || 'เช่น ⚙️'} maxLength={6}
          style={{ ...style, flex: 1, minWidth: 0 }} />
        <button type="button" onClick={() => setOpen(o => !o)} title="เลือกไอคอน"
          style={{ flexShrink: 0, width: 42, borderRadius: 8, border: `1px solid ${open ? 'var(--accent)' : 'var(--border2)'}`, background: open ? 'var(--accent-dim)' : 'var(--bg3)', color: 'var(--text)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>
          {value || '😀'}
        </button>
      </div>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 4000, width: 'min(90vw, 316px)', maxHeight: 300, overflowY: 'auto',
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 12px 34px rgba(0,0,0,0.5)', padding: 10 }}>
          {EMOJI_GROUPS.map(g => (
            <div key={g.label} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', margin: '2px 2px 4px' }}>{g.label}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                {g.items.map(em => {
                  const on = value === em;
                  return (
                    <button key={em} type="button" onClick={() => { onChange(em); setOpen(false); }}
                      onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'var(--bg3)'; }}
                      onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent'; }}
                      style={{ ...cell, ...(on ? { background: 'var(--accent-dim)', border: '1px solid var(--accent)' } : {}) }}>{em}</button>
                  );
                })}
              </div>
            </div>
          ))}
          {value && (
            <button type="button" onClick={() => { onChange(''); setOpen(false); }}
              style={{ width: '100%', marginTop: 4, padding: '6px 0', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✕ ล้างไอคอน</button>
          )}
        </div>
      )}
    </div>
  );
}
