/* ══ 🔘 Segmented — ปุ่มเลือก 1 จาก 2–5 ตัวเลือก (2026-09-24 · UI-STANDARD.md §3) ══════════
   หลัก: ตัวเลือก ≤5 ที่ "เท่ากัน" ให้เห็นหมดทีเดียว (Material 3 segmented button) · >5 = dropdown
   เดิมเรื่องเดียวกัน (กะ) ใช้ทั้ง dropdown และปุ่มคนละทรงในหน้าเดียวกัน (/report)
   • "ทั้งหมด/ทุก…" อยู่ **ซ้ายสุดเสมอ**
   • สูงเท่าช่องกรองอื่น (--ctl-h) → วางในแถบกรองแล้วเสมอกัน

   <Segmented value={shift} onChange={setShift} options={SHIFT_OPTIONS} label="กะ" />
   ═══════════════════════════════════════════════════════════════════════════════════ */
export default function Segmented({ value, onChange, options, label, size, style }) {
  return (
    <div className={`seg${size === 'sm' ? ' seg-sm' : ''}`} role="radiogroup" aria-label={label} style={style}>
      {options.map(o => {
        const on = String(o.value ?? '') === String(value ?? '');
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on}
            className={on ? 'on' : ''} disabled={o.disabled} title={o.title}
            onClick={() => !on && onChange && onChange(o.value)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
