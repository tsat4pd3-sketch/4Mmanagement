/* 📎 FilePick — ปุ่มเลือกไฟล์แนบ + สถานะ "กำลังอัป" · ใช้ร่วมทุกโมดูลที่แนบไฟล์
   เดิมอยู่ใน NpiUi.jsx ตัวเดียว (NpiUi ยัง re-export ให้ของเดิมเรียกเหมือนเดิมได้)
   🔴 ปุ่มต้องกดซ้ำด้วยไฟล์เดิมได้ ⇒ ล้าง `e.target.value` ทุกครั้ง (ไม่ล้าง = เลือกไฟล์เดิมซ้ำแล้วเงียบ)
   ⚠️ ตัวรับไฟล์จริงอยู่ที่ `utils/fileAttach.js` — ปุ่มนี้ไม่ตัดสินชนิด/ขนาดไฟล์เอง */
import { useState } from 'react';
import { ATTACH_ACCEPT } from '../utils/fileAttach';

const DEFAULT_STYLE = {
  padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg2)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
};

export default function FilePick({ onFile, accept = ATTACH_ACCEPT, label = '📎 แนบไฟล์', disabled, baseStyle }) {
  const [busy, setBusy] = useState(false);
  return (
    <label style={{ ...(baseStyle || DEFAULT_STYLE), display: 'inline-block', opacity: disabled || busy ? 0.6 : 1 }}>
      {busy ? '⏳ กำลังอัป…' : label}
      <input type="file" accept={accept} disabled={disabled || busy} style={{ display: 'none' }}
        onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setBusy(true); try { await onFile(f); } finally { setBusy(false); } }} />
    </label>
  );
}
