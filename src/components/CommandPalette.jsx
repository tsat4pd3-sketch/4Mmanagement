import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NAV_ITEMS } from '../App';
import { canAccessPage } from '../utils/permissions';
import { topPaths } from '../utils/navRecent';

/* ══ ⌘K / Ctrl+K — ค้นหาเมนู 51 รายการใน 2 วินาที ═══════════════════════════════════════
   เมนูมี 8 หมวด 51 รายการ ของใหม่หายาก ต้องจำว่าอยู่หมวดไหน (ดู NAVIGATION-REVIEW §2.5)
   → พิมพ์คำเดียวแล้วเจอ ไม่ต้องไล่กางทีละหมวด

   • รายการมาจาก NAV_ITEMS ชุดเดียวกับ sidebar + กรองสิทธิ์ด้วย canAccessPage
     (เมนูใหม่โผล่ที่นี่เองโดยไม่ต้องแก้ไฟล์นี้ — ห้ามพิมพ์รายชื่อหน้าซ้ำ)
   • ค้นแบบ subsequence: "ซซบร" เจอ "ซ่อมบำรุง" · "mtn" เจอ /mtn-repair
   • ยังไม่พิมพ์อะไร = โชว์ "ใช้บ่อย" ของเครื่องนี้ (navRecent)
   ═════════════════════════════════════════════════════════════════════════════════════════ */

/** ตัวอักษรใน q เรียงตามลำดับอยู่ใน text ไหม (พิมพ์ย่อ/พิมพ์ตกก็ยังเจอ) */
function subseq(text, q) {
  let i = 0;
  for (const c of text) if (c === q[i] && ++i === q.length) return true;
  return i === q.length;
}

function scoreItem(item, q) {
  const label = item.label.toLowerCase();
  const group = item.group.toLowerCase();
  const path = item.to.toLowerCase();
  if (label.startsWith(q)) return 100;
  if (label.includes(q)) return 80;
  if (path.includes(q)) return 60;
  if (group.includes(q)) return 40;
  if (subseq(label, q)) return 20;
  if (subseq(group + ' ' + label, q)) return 10;
  return 0;
}

export default function CommandPalette({ open, onClose, role }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const allowed = useMemo(
    () => NAV_ITEMS.filter(i => canAccessPage(i.to, role)),
    [role],
  );

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) {
      // ยังไม่พิมพ์ = ใช้บ่อยก่อน แล้วต่อด้วยเมนูตามลำดับปกติ
      const top = topPaths(5).map(p => allowed.find(i => i.to === p)).filter(Boolean);
      const rest = allowed.filter(i => !top.includes(i));
      return [...top.map(i => ({ ...i, recent: true })), ...rest].slice(0, 40);
    }
    return allowed
      .map(i => ({ i, s: scoreItem(i, query) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i.label.localeCompare(b.i.label))
      .slice(0, 40)
      .map(x => x.i);
  }, [q, allowed]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    if (!open) { setQ(''); setSel(0); return; }
    // autofocus ต้องรอ modal ขึ้นจอก่อน
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // เลื่อนรายการที่เลือกให้อยู่ในสายตาเสมอ (ใช้คีย์บอร์ดล้วนได้)
  useEffect(() => {
    listRef.current?.querySelector('[data-sel="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel, results]);

  if (!open) return null;

  const go = (item) => { if (!item) return; onClose(); navigate(item.to); };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 3200,          // เหนือ modal (2000-3200) ตาม UI §7
        background: 'rgba(4,6,10,0.62)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: 'clamp(40px,10vh,120px) 14px 20px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(620px, 100%)', maxHeight: '70vh', display: 'flex', flexDirection: 'column',
          background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 12,
          boxShadow: '0 24px 70px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>🔎</span>
          <input
            ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="ค้นหาเมนู… (พิมพ์ชื่อหน้า/หมวด เช่น ซ่อม, oee, สต๊อก)"
            style={{
              flex: 1, width: 'auto', background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text)', fontSize: 15, fontFamily: 'var(--font-body)', padding: 0,
            }}
          />
          <kbd style={kbd}>Esc</kbd>
        </div>

        <div ref={listRef} style={{ overflowY: 'auto', padding: 6 }}>
          {results.length === 0 ? (
            <div style={{ padding: '26px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              ไม่พบเมนูที่ตรงกับ “{q}”
              <div style={{ marginTop: 6, fontSize: 12 }}>เมนูที่ไม่มีสิทธิ์เข้าจะไม่แสดงที่นี่</div>
            </div>
          ) : results.map((item, idx) => {
            const on = idx === sel;
            return (
              <button
                key={item.to} data-sel={on ? '1' : '0'}
                onMouseEnter={() => setSel(idx)} onClick={() => go(item)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  padding: '9px 10px', borderRadius: 8, cursor: 'pointer',
                  border: '1px solid ' + (on ? 'var(--accent)' : 'transparent'),
                  background: on ? 'var(--accent-dim)' : 'transparent',
                  color: 'var(--text)', fontFamily: 'var(--font-body)',
                }}
              >
                <span style={{ fontSize: 17, flexShrink: 0 }}>{item.icon}</span>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 14, fontWeight: 700 }}>
                  {item.label}
                </span>
                {item.recent && <span style={{ fontSize: 11, color: 'var(--accent)', flexShrink: 0 }}>⭐ ใช้บ่อย</span>}
                <span style={{ fontSize: 11.5, color: 'var(--muted)', flexShrink: 0, maxWidth: '38%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.group}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 12, padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 11.5, color: 'var(--muted)', flexWrap: 'wrap' }}>
          <span><kbd style={kbd}>↑</kbd><kbd style={kbd}>↓</kbd> เลือก</span>
          <span><kbd style={kbd}>Enter</kbd> เปิด</span>
          <span style={{ marginLeft: 'auto' }}>เปิดด้วย <kbd style={kbd}>Ctrl</kbd>+<kbd style={kbd}>K</kbd></span>
        </div>
      </div>
    </div>
  );
}

const kbd = {
  fontSize: 10.5, fontFamily: 'var(--font-body)', padding: '2px 5px', borderRadius: 4,
  background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)', margin: '0 1px',
};
