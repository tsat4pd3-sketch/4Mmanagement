/**
 * QualityBinLinkModal — ส่งของเสียที่ลงใน Daily Report เข้าถังเหลือง/ถังแดง
 *
 * ที่มา: feedback หัวหน้ากลุ่ม Assy2 2026-08-19
 *   "ถ้าเป็นงานเสียขอผูกกับเอกสารตัวนี้ครับ รวมถึงงานต้องสงสัยด้วยครับ"
 *   ของเสียถูกลงที่ defect_logs อยู่แล้ว → ไม่ต้องคีย์ใบถังใหม่ทั้งใบ
 *
 * การจับคู่ (ตามความหมายของช่องบนใบกระดาษ):
 *   qty_suspect (ต้องสงสัย) → 🟡 ถังเหลือง — รอพิจารณา/ซ่อม
 *   qty_ng      (เสีย)      → 🔴 ถังแดง   — ของเสียยืนยันแล้ว รอทำลายตาม DOA
 *
 * ⚠️ ไม่สร้างใบให้อัตโนมัติตอนบันทึกงานเสีย — "เอาของลงถัง" เป็นการกระทำจริงหน้างาน
 *    ต้องมีคนกดยืนยันเสมอ (หลักเดียวกับ AI intake / PE change request)
 * ⚠️ ลงซ้ำได้ (บางทีทยอยลงถัง) แต่ต้องเตือนว่าเคยลงไปแล้วกี่ชิ้น ห้ามเงียบ
 */
import { useState, useEffect, useMemo } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';

const num = v => (v === '' || v == null ? 0 : (Number(v) || 0));

const BINS = [
  { key: 'yellow', icon: '🟡', name: 'ถังเหลือง', sub: 'ชิ้นงานต้องสงสัย — รอพิจารณา/ซ่อม',
    color: '#f5b942', from: 'qty_suspect', fromLabel: 'สงสัย' },
  { key: 'red', icon: '🔴', name: 'ถังแดง', sub: 'ชิ้นงานเสีย — รอกำจัดทำลายตาม DOA',
    color: '#e05252', from: 'qty_ng', fromLabel: 'NG' },
];

export default function QualityBinLinkModal({ defect, session, actorName, existing, onClose, onSaved }) {
  const matNo = defect?.prod_orders?.mat_no || '';
  const [partNo, setPartNo] = useState('');
  const [saving, setSaving] = useState(false);

  const defectName = defect?.dr_defect_types?.name_th || 'ของเสีย';
  const causeDefault = [defectName, defect?.description].filter(Boolean).join(' — ');

  // ค่าตั้งต้นของแต่ละถัง — ติ๊กให้เฉพาะถังที่มีจำนวนจริง และยังไม่เคยลง
  const [rows, setRows] = useState(() =>
    Object.fromEntries(BINS.map(b => {
      const q = num(defect?.[b.from]);
      return [b.key, {
        on: q > 0 && !num(existing?.[b.key]),
        qty: q ? String(q) : '',
        cause: causeDefault,
      }];
    })));

  // เลขพาร์ทลูกค้า (part_no) ไม่มีใน prod_orders → หาจากทะเบียนสินค้าให้ ไม่ให้ QA ต้องกรอกเอง
  useEffect(() => {
    let dead = false;
    if (!matNo) return;
    supabaseDR.from('dr_products').select('p_no').eq('mat_no', matNo).limit(1)
      .then(({ data }) => { if (!dead && data?.[0]?.p_no) setPartNo(data[0].p_no); });
    return () => { dead = true; };
  }, [matNo]);

  const picked = useMemo(() => BINS.filter(b => rows[b.key].on && num(rows[b.key].qty) > 0), [rows]);

  const set = (k, patch) => setRows(r => ({ ...r, [k]: { ...r[k], ...patch } }));

  const save = async () => {
    if (!picked.length) { toast.error('ยังไม่ได้เลือกถัง หรือจำนวนเป็น 0'); return; }
    setSaving(true);
    const payload = picked.map(b => ({
      bin: b.key,
      work_date: session?.work_date || null,
      line_name: session?.line_name || null,
      mat_no: matNo || null,
      part_name: defect?.prod_orders?.part_name || null,
      part_no: partNo || null,
      qty: num(rows[b.key].qty),
      cause: rows[b.key].cause.trim() || null,
      reported_by: defect?.reported_by_name || actorName || null,
      defect_log_id: defect.id,
    }));
    const { data, error } = await supabaseDR.from('quality_bin_records').insert(payload).select('id');
    setSaving(false);
    if (error) {
      toast.error(error.code === '42703'
        ? 'ยังบันทึกไม่ได้ — ต้อง apply migration 20260819_qbin_link_defect_log ก่อน (แจ้ง admin)'
        : error.code === '42P01'
          ? 'ยังไม่ได้ติดตั้งตารางถังเหลือง/แดง — แจ้ง admin ให้ apply migration 20260819_quality_bin_records'
          : `บันทึกไม่สำเร็จ: ${error.message}`);
      return;
    }
    if (!data?.length) { toast.error('บันทึกไม่สำเร็จ — ไม่มีรายการถูกสร้าง'); return; }
    toast.success(`ลงถังแล้ว ${data.length} รายการ — ไปกรอก QA/ผลซ่อม ต่อที่หน้า QA/QC → ถังเหลือง/ถังแดง`);
    onSaved?.();
    onClose?.();
  };

  const inp = { width: '100%', padding: '6px 9px', borderRadius: 6, fontSize: 13,
                border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--text)' };
  const lbl = { fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 };
  const repaired = num(defect?.qty_repair);

  return (
    <div className="overlay" style={{ zIndex: 2200 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14,
        padding: 20, width: 'min(96vw, 640px)', maxHeight: '90vh', overflowY: 'auto' }}>

        <div style={{ fontSize: 15.5, fontWeight: 800, color: 'var(--text)', marginBottom: 3 }}>
          🗑️ ลงถังเหลือง / ถังแดง
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          {defectName}
          {matNo && <> · <b style={{ fontFamily: 'monospace' }}>{matNo}</b></>}
          {defect?.prod_orders?.part_name && <> · {defect.prod_orders.part_name}</>}
          {' · '}{session?.line_name} · {session?.work_date}
        </div>

        {BINS.map(b => {
          const src = num(defect?.[b.from]);
          const had = num(existing?.[b.key]);
          const r = rows[b.key];
          return (
            <div key={b.key} style={{
              border: `1px solid ${r.on ? b.color : 'var(--border)'}`, borderRadius: 10,
              padding: 12, marginBottom: 10, background: r.on ? 'var(--bg2)' : 'transparent' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                <input type="checkbox" checked={r.on} onChange={e => set(b.key, { on: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: b.color }} />
                <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)' }}>{b.icon} {b.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{b.sub}</span>
              </label>

              {had > 0 && (
                // เคยลงไปแล้ว = เตือนเสมอ ห้ามให้ลงซ้ำโดยไม่รู้ตัว (แต่ไม่บล็อก — ทยอยลงถังได้จริง)
                <div style={{ fontSize: 11.5, color: '#f59e0b', marginTop: 7 }}>
                  ⚠ บันทึกงานเสียรายการนี้เคยลง{b.name}ไปแล้ว {had.toLocaleString('th-TH')} ชิ้น — ติ๊กใหม่ = ลงเพิ่มอีกใบ
                </div>
              )}

              {r.on && (
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, marginTop: 10 }}>
                  <div>
                    <label style={lbl}>จำนวน (ชิ้น)</label>
                    <input type="number" value={r.qty} onChange={e => set(b.key, { qty: e.target.value })} style={inp} />
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3 }}>
                      ลงไว้ {b.fromLabel} {src.toLocaleString('th-TH')} ชิ้น
                    </div>
                  </div>
                  <div>
                    <label style={lbl}>สาเหตุ</label>
                    <input value={r.cause} onChange={e => set(b.key, { cause: e.target.value })} style={inp} />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {repaired > 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
            ℹ️ รายการนี้ลง “ซ่อม {repaired.toLocaleString('th-TH')} ชิ้น” ไว้ด้วย —
            ถ้าของกลุ่มนั้นผ่านถังเหลืองมาแล้ว ให้ไปกรอกผลซ่อม (OK/NG) ที่ใบถังเหลืองใบเดิม
            อย่าสร้างใบใหม่ ไม่งั้นจำนวนจะซ้ำ
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          ผู้แจ้ง = <b>{defect?.reported_by_name || actorName || '—'}</b> ·
          ช่อง QA / ผลการซ่อม / ผู้กำจัดทำลาย กรอกต่อที่หน้า <b>QA/QC → ถังเหลือง/ถังแดง</b>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border2)',
            background: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}>ยกเลิก</button>
          <button onClick={save} disabled={saving || !picked.length} style={{
            padding: '8px 20px', borderRadius: 8, border: 'none',
            background: picked.length ? '#e05252' : 'var(--border2)', color: '#fff',
            fontSize: 13, fontWeight: 700, cursor: saving || !picked.length ? 'default' : 'pointer',
            opacity: saving ? 0.6 : 1 }}>
            {saving ? 'กำลังบันทึก…' : `ลงถัง (${picked.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
