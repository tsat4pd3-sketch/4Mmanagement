import { draftTimeText } from '../utils/formDraft';

/* 📝 แถบ "มีงานที่กรอกค้างไว้" — กู้คืน / ทิ้ง (2026-10-22 · คู่กับ utils/formDraft.js)
   วาดเฉพาะเมื่อมีร่าง · หน้าที่เรียกเป็นคนตัดสินว่ามือถือเท่านั้น (จอคอมไม่ส่ง draft มา = ไม่วาด) */
export default function DraftRestoreBar({ draft, what = 'ใบนี้', onRestore, onDiscard }) {
  if (!draft) return null;
  return (
    <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '10px 12px', margin: '0 0 12px',
      borderRadius: 10, border: '1.5px solid #f59e0b', background: 'rgba(245,158,11,0.12)' }}>
      <div style={{ flex: '1 1 180px', minWidth: 0, fontSize: 13, color: 'var(--text)', lineHeight: 1.45 }}>
        📝 <b>มีงานที่กรอกค้างไว้ใน{what}</b> (เก็บไว้ในเครื่องนี้ {draftTimeText(draft.at)} น.) — ยังไม่ได้บันทึกเข้าระบบ
      </div>
      <div style={{ display: 'flex', gap: 8, flex: '1 1 180px' }}>
        <button type="button" onClick={onRestore}
          style={{ flex: 1, minHeight: 44, borderRadius: 9, border: 'none', background: '#f59e0b', color: '#000', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
          ↩️ กู้คืน
        </button>
        <button type="button" onClick={onDiscard}
          style={{ flex: 1, minHeight: 44, borderRadius: 9, border: '1px solid var(--border2)', background: 'transparent', color: 'var(--text2)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
          ทิ้งร่าง
        </button>
      </div>
    </div>
  );
}
