/* ══════════════════════════════════════════════════════════════════════════
   <SelectOrFree> — "เลือกจากลิสต์สั้น + ✏️ ระบุเอง" ช่องเดียว  (2026-09-07 · single-source audit)

   ใช้กับค่าที่มีทะเบียนสั้นๆ (ส่วนงาน/แผนก/ฝ่าย จาก org_nodes · สถานีจาก workstations · ไลน์ปั๊มของ
   แม่พิมพ์) แต่ยังต้องยอมให้ระบุเองในกรณีจริง (จุดเก็บทางกายภาพ "ห้อง CMM" · อุปกรณ์ที่ไม่ประจำสถานี ·
   ตัวย่อลูกค้าในฟอร์มที่นำเข้าจาก Excel) — ตาม UI-CONVENTIONS §5.1.1 "ห้ามมี 2 ช่องคู่กัน":
   เป็น <select> ก่อน · เลือก "✏️ ระบุเอง…" = สลับเป็น input + ปุ่ม ↩ กลับไปเลือก
   · ค่าเดิมที่ไม่อยู่ในลิสต์ = เปิดมาในโหมดระบุเอง (ไม่หายเงียบ)
   · ลิสต์ยาวเกิน ~30 ให้ใช้ SearchSelect/picker กลางแทน (native select ค้นไม่ได้)

   เดิม pattern นี้ถูกเขียนซ้ำ 7 จุด (QualityControl · PEDocs · OjtTraining · MaterialRequests ·
   LayerProcessAudit · PokaYokeCheck · DieRegistry) — รวมเป็นตัวเดียว ห้ามเขียนซ้ำอีก

   options = ['A','B'] หรือ [{ value, label }] · onChange(string)
   ══════════════════════════════════════════════════════════════════════════ */
import { useState } from 'react';

export default function SelectOrFree({
  value = '', onChange, options = [], disabled, readOnly,
  placeholder = '— เลือก —', freeLabel = '✏️ ระบุเอง…', freePlaceholder = 'ระบุเอง',
  allowFree = true, style, selectStyle, inputStyle, compact = false,
}) {
  const [free, setFree] = useState(false);
  const list = [];
  const seen = new Set();
  for (const o of options) {
    const v = typeof o === 'string' ? o : o?.value;
    const s = String(v ?? '').trim(); if (!s || seen.has(s)) continue;
    seen.add(s); list.push({ value: s, label: typeof o === 'string' ? o : (o.label ?? s) });
  }
  const cur = String(value ?? '');
  const custom = allowFree && (free || (cur !== '' && !seen.has(cur)));
  const pad = compact ? '4px 8px' : undefined;
  const fs = compact ? 12 : undefined;
  if (custom) return (
    <div style={{ display: 'flex', gap: 4, ...style }}>
      <input type="text" value={cur} disabled={disabled} readOnly={readOnly} placeholder={freePlaceholder}
        style={{ flex: 1, minWidth: 0, width: 'auto', padding: pad, fontSize: fs, ...inputStyle }}
        onChange={e => { setFree(true); onChange?.(e.target.value); }} />
      {!readOnly && (
        <button type="button" disabled={disabled} title="กลับไปเลือกจากลิสต์"
          onClick={() => { setFree(false); onChange?.(''); }}
          style={{ padding: compact ? '2px 7px' : '2px 8px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}>↩</button>
      )}
    </div>
  );
  return (
    <select value={cur} disabled={disabled || readOnly} style={{ padding: pad, fontSize: fs, ...style, ...selectStyle }}
      onChange={e => { if (e.target.value === '__free__') { setFree(true); onChange?.(''); } else onChange?.(e.target.value); }}>
      <option value="">{placeholder}</option>
      {list.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      {allowFree && <option value="__free__">{freeLabel}</option>}
    </select>
  );
}
