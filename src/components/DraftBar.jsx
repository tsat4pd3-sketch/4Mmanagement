/**
 * DraftBar — แถบ "มีข้อมูลที่กรอกค้างไว้ · กรอกต่อ / เริ่มใหม่" (2026-11-27 · คำสั่ง user)
 *
 * ของกลางของ `utils/useFormDraft.js` — **ห้ามเขียนแถบนี้เองในหน้า** (UI-CONVENTIONS §6.43)
 * วางไว้บนสุดของฟอร์ม/modal ก่อนช่องกรอกช่องแรก
 *
 * 🔴 ปุ่มซ้ายต้องเป็น "กรอกต่อ" (ของที่คนเสียเวลาพิมพ์ไปแล้ว = ทางเลือกหลัก)
 *    ปุ่ม "เริ่มใหม่" ต้องจางกว่า — กดพลาดแล้วของหายถาวร
 */
import { tr } from '../utils/i18n';
import { draftAgeText } from '../utils/useFormDraft';

export default function DraftBar({ draft, onRestore, label = 'ข้อมูลที่กรอกค้างไว้' }) {
  if (!draft?.found) return null;
  const age = draftAgeText(draft.savedAt);
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '8px 11px', marginBottom: 10, borderRadius: 9,
        background: 'var(--amber-dim)', border: '1px solid var(--amber-line)',
        fontSize: 12.5, fontWeight: 600,
      }}
    >
      <span style={{ flex: '1 1 200px', minWidth: 0 }}>
        💾 {tr(label)}{age ? ` · ${tr(age)}` : ''}
      </span>
      <button
        type="button"
        onClick={() => { const d = draft.restore(); if (d) onRestore?.(d); }}
        style={{
          padding: '5px 13px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'var(--accent)', color: 'var(--accent-ink)',
          fontSize: 12, fontWeight: 800, fontFamily: 'inherit',
        }}
      >
        {tr('กรอกต่อ')}
      </button>
      <button
        type="button"
        onClick={() => draft.dismiss()}
        style={{
          padding: '5px 11px', borderRadius: 8, cursor: 'pointer', background: 'transparent',
          color: 'inherit', border: '1px solid currentColor', opacity: 0.6,
          fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
        }}
      >
        {tr('เริ่มใหม่')}
      </button>
    </div>
  );
}
