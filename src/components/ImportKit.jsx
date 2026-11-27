/* ══ 📥 ImportKit — ปุ่ม/หัวหน้าต่าง/คำเตือนไฟล์ผิดช่อง ของ "นำเข้าไฟล์ข้อมูล" (2026-11-24 · คำสั่ง user) ══════
   ทะเบียน + กติกา → `src/utils/importRegistry.js` · UI-CONVENTIONS §6.44
   - <ImportButton k onClick />       ปุ่ม `📥 นำเข้า <ชื่อไฟล์>` ↔ `📥 Import <file name>` คำเดียวกันทุกหน้า
   - <ImportInfo k sample? />          หัวหน้าต่าง: ไฟล์ที่รับ · ได้มาจาก · ต้องมีคอลัมน์ · ไฟล์ตัวอย่าง (ถ้ามี)
   - <WrongFileNote k here />          "ไฟล์นี้คือ X — ต้องนำเข้าที่ Y · ไม่ได้บันทึกอะไร" + ลิงก์ไปหน้านั้น
   - wrongFileText(k, here)            ข้อความเดียวกันแบบสตริง (จุดที่ไม่มีแผงให้วาง ใช้กับ toast)
   ⚠️ ไม่ยิง DB · ไม่เปลี่ยนขั้นตอนหลังเลือกไฟล์ของแต่ละหน้า */
import { Link } from 'react-router-dom';
import { IMPORTS, importLabel } from '../utils/importRegistry';
import { tr } from '../utils/i18n';

const BTN = {
  fontSize: 13, fontWeight: 700, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const TONE = {
  primary: { background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' },
  quiet: { background: 'var(--bg3-surf)', color: 'var(--text)', border: '1px solid var(--border2)' },
};

/** ปุ่มนำเข้า — `tone='quiet'` ใช้เฉพาะเมื่อมีปุ่มนำเข้าหลักอีกตัวอยู่ข้างกัน */
export function ImportButton({ k, onClick, disabled, busy, tone = 'primary', title, style }) {
  const d = IMPORTS[k];
  return (
    <button type="button" className="pg-btn" onClick={onClick} disabled={disabled || busy}
      title={title || (d ? `${tr('ไฟล์ที่รับ')}: ${tr(d.file)}` : undefined)}
      style={{ ...BTN, ...(TONE[tone] || TONE.primary), ...(disabled || busy ? { opacity: 0.6, cursor: 'wait' } : null), ...style }}>
      {busy ? '⏳' : '📥'} {tr(importLabel(k))}
    </button>
  );
}

/** หัวหน้าต่างนำเข้า — 4 ข้อเท็จจริงก่อนเลือกไฟล์ · `sample` = { label, onClick } เมื่อมีไฟล์ตัวอย่างจริง */
export function ImportInfo({ k, sample, compact }) {
  const d = IMPORTS[k];
  if (!d) return null;
  const facts = [['ไฟล์ที่รับ', tr(d.file)], ['ได้มาจาก', tr(d.from)], ['ต้องมีคอลัมน์', tr(d.cols)]];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: compact ? 'minmax(0,1fr)' : 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: 8, alignContent: 'start' }}>
      {facts.map(([lb, v]) => (
        <div key={lb} style={{ background: 'var(--bg2-surf)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '8px 12px', minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>{tr(lb)}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflowWrap: 'anywhere' }}>{tr(v)}</div>
        </div>
      ))}
      {sample && (
        <div style={{ background: 'var(--bg2-surf)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>{tr('ไฟล์ตัวอย่าง')}</div>
          <button type="button" onClick={sample.onClick}
            style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            ⬇️ {tr(sample.label || 'ดาวน์โหลดไฟล์ตัวอย่าง')}
          </button>
        </div>
      )}
    </div>
  );
}

/** ข้อความแบบสตริง (toast) — `k` = ไฟล์ที่ตรวจเจอ · `here` = จุดที่กำลังนำเข้า */
export function wrongFileText(k, here) {
  const d = IMPORTS[k], h = IMPORTS[here];
  if (!d) return '';
  return `⚠ ${tr('ไฟล์นี้คือ')} ${tr(d.name)}${h ? ` — ${tr('ไม่ใช่')} ${tr(h.name)}` : ''} · `
    + `${tr('ต้องนำเข้าที่')} ${tr(d.where)} · ${tr('ไม่ได้บันทึกอะไร')}`;
}

/** แผงเตือนไฟล์ผิดช่อง + ลิงก์ไปหน้าที่ถูก (`onGo` = ปิดหน้าต่างก่อนไป ถ้ามี) */
export function WrongFileNote({ k, here, onGo }) {
  const d = IMPORTS[k], h = IMPORTS[here];
  if (!d) return null;
  return (
    <div role="alert" style={{ border: '1px solid var(--red)', borderLeft: '6px solid var(--red)', background: 'var(--red-dim)',
      borderRadius: 10, padding: '10px 14px', display: 'grid', gap: 6, fontSize: 13 }}>
      <b style={{ color: 'var(--red)' }}>⚠ {tr('ไฟล์นี้คือ')} {tr(d.name)}{h ? ` — ${tr('ไม่ใช่')} ${tr(h.name)}` : ''}</b>
      <span style={{ color: 'var(--text)' }}>
        {tr('ต้องนำเข้าที่')} <b>{tr(d.where)}</b> · {tr('ไม่ได้บันทึกอะไร')}
      </span>
      <Link to={d.to} onClick={onGo}
        style={{ width: 'max-content', fontWeight: 700, color: 'var(--accent)', textDecoration: 'none' }}>
        {tr('ไปหน้า')} {tr(importLabel(k))} →
      </Link>
    </div>
  );
}
