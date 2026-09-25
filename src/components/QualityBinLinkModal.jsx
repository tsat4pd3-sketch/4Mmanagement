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
 *
 * 🔴 2026-09-25 (feedback Sup Assy2 — "ลงข้อมูลซ้ำซ้อน" + "หาที่ดูไม่เจอ"):
 *    เดิมโมดัลนี้ลงได้แค่ จำนวน+สาเหตุ แล้วขึ้นข้อความว่า "ไปกรอก QA/ผู้กำจัดทำลาย ต่อที่หน้า QA/QC"
 *    ⇒ คนหน้างานต้องเปิดอีกหน้า หาใบของตัวเองในตาราง แล้วกรอกต่อ — ซึ่งไม่มีใครทำ
 *      (วัดจริง 25/09: ถังแดง 24 แถว มี disposed_by แค่ 0 แถว)
 *    ⇒ ย้ายช่องที่ "รู้ตั้งแต่ตอนลงถัง" มาไว้ที่นี่ให้จบในจอเดียว + ปุ่มลิงก์ไปดูใบที่สร้าง
 *    ⚠️ ช่องที่ยังไม่รู้ตอนลงถังจริงๆ (ผลการซ่อม OK/NG · วันนำกลับเข้ากระบวนการ · ผลพิจารณา QA)
 *       **ไม่ยกมา** — บังคับกรอกสิ่งที่ยังไม่เกิด = ได้ข้อมูลมั่ว แย่กว่าช่องว่าง
 */
import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import PersonSelect from './PersonSelect';
import useColumnHistory from '../utils/useColumnHistory';
import { positionLabel } from '../utils/positions';
import { TAG_MAX_DAYS } from '../utils/qualityBin';

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
  const [created, setCreated] = useState(null);   // สรุปใบที่เพิ่งสร้าง — ไม่ปิดเงียบ ต้องบอกว่าไปดูที่ไหน

  /* ช่องคนที่ "รู้ตั้งแต่ตอนลงถัง" — ยกมาไว้ที่นี่ให้จบในจอเดียว (ไม่ต้องไปกรอกต่ออีกหน้า)
     📜 history = ค่าที่เคยบันทึกในตารางเดียวกัน — คนที่ยังไม่อยู่ในทะเบียนยังเลือกซ้ำได้ (กฎ picker กลาง) */
  const [reportedBy, setReportedBy] = useState(defect?.reported_by_name || actorName || '');
  const [qaBy, setQaBy] = useState('');
  const [disposedBy, setDisposedBy] = useState('');
  const [disposedPos, setDisposedPos] = useState('');
  const reportedHist = useColumnHistory(supabaseDR, 'quality_bin_records', 'reported_by');
  const qaByHist = useColumnHistory(supabaseDR, 'quality_bin_records', 'qa_by');
  const disposedHist = useColumnHistory(supabaseDR, 'quality_bin_records', 'disposed_by');

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
      reported_by: reportedBy.trim() || null,
      qa_by: qaBy.trim() || null,
      // ผู้กำจัดทำลาย = ของถังแดงเท่านั้น (ถังเหลืองยังไม่ตัดสินว่าจะทำลาย — WI §5.4 QA เป็นคนชี้)
      ...(b.key === 'red' ? {
        disposed_by: disposedBy.trim() || null,
        disposed_position: disposedPos.trim() || null,
      } : {}),
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
    toast.success(`ลงถังแล้ว ${data.length} รายการ`);
    onSaved?.();
    // ไม่ปิดทันที — บอกว่าสร้างใบอะไรไว้ และกดไปดู/กรอกต่อได้ที่ไหน (เดิมปิดเงียบ คนเลยหาใบไม่เจอ)
    setCreated(picked.map(b => ({ key: b.key, icon: b.icon, name: b.name, qty: num(rows[b.key].qty) })));
  };

  const inp = { width: '100%', padding: '6px 9px', borderRadius: 6, fontSize: 13,
                border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--text)' };
  const lbl = { fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 };
  const repaired = num(defect?.qty_repair);

  return (
    <div className="overlay" style={{ zIndex: 2200 }} /* ไม่ปิดจาก backdrop — UI-CONVENTIONS §5: เผลอแตะพื้นหลังแล้วข้อมูลหายทั้งฟอร์ม (ปิดด้วยปุ่มยกเลิก/✕ เท่านั้น) */>
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

        {!created && BINS.map(b => {
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

        {!created && repaired > 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
            ℹ️ รายการนี้ลง “ซ่อม {repaired.toLocaleString('th-TH')} ชิ้น” ไว้ด้วย —
            ถ้าของกลุ่มนั้นผ่านถังเหลืองมาแล้ว ให้ไปกรอกผลซ่อม (OK/NG) ที่ใบถังเหลืองใบเดิม
            อย่าสร้างใบใหม่ ไม่งั้นจำนวนจะซ้ำ
          </div>
        )}

        {/* ── คนที่เกี่ยวข้อง — กรอกจบที่นี่ ไม่ต้องไปเปิดอีกหน้า ──
            เลือกคนแล้ว "ตำแหน่ง" เติมจากทะเบียน positions ให้เอง (แก้เองได้)
            ผู้กำจัดทำลายโผล่เฉพาะเมื่อติ๊กถังแดง — ถังเหลืองยังไม่ตัดสินว่าจะทำลาย (WI §5.4 QA เป็นคนชี้) */}
        {!created && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, alignContent: 'start' }}>
              <div>
                <label style={lbl}>ผู้แจ้ง</label>
                <PersonSelect value={reportedBy} source="both" history={reportedHist} inputStyle={inp}
                  onChange={({ name }) => setReportedBy(name)} />
              </div>
              <div>
                <label style={lbl}>ผู้ตรวจสอบ (QA)</label>
                <PersonSelect value={qaBy} source="both" roles={['qa']} history={qaByHist} inputStyle={inp}
                  placeholder="ยังไม่รู้ = เว้นว่าง" onChange={({ name }) => setQaBy(name)} />
              </div>
              {picked.some(b => b.key === 'red') && (<>
                <div>
                  <label style={lbl}>ผู้กำจัดทำลาย</label>
                  <PersonSelect value={disposedBy} source="both" history={disposedHist} inputStyle={inp}
                    placeholder="ระดับหัวหน้ากลุ่มขึ้นไป"
                    onChange={({ name, position, opt }) => {
                      setDisposedBy(name);
                      if (opt && position) setDisposedPos(positionLabel(position) || position);
                    }} />
                </div>
                <div>
                  <label style={lbl}>ตำแหน่ง</label>
                  <input value={disposedPos} onChange={e => setDisposedPos(e.target.value)}
                    placeholder="เติมให้อัตโนมัติเมื่อเลือกจากทะเบียน" style={inp} />
                </div>
              </>)}
            </div>
            {/* ⏱️ อายุแท็กตาม WI-PD3-087 §5.6 — บอกตั้งแต่ตอนลงถัง ว่ามีเวลาเท่าไหร่ก่อนของค้าง */}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, lineHeight: 1.5 }}>
              ⏱️ อายุแท็กตาม WI: 🟡 เหลือง <b>{TAG_MAX_DAYS.yellow} วัน</b> · 🔴 แดง <b>{TAG_MAX_DAYS.red} วัน</b> นับจากวันที่ลงถัง —
              เกินแล้วจะขึ้นเตือนที่หน้า QA/QC → ถังเหลือง/ถังแดง
            </div>
          </div>
        )}

        {/* ✅ สร้างใบแล้ว — บอกว่าไปดู/กรอกต่อที่ไหน แทนการปิดหน้าต่างเงียบ (เดิมคนหาใบของตัวเองไม่เจอ) */}
        {created && (
          <div style={{ border: '1px solid rgba(34,197,94,0.45)', background: 'rgba(34,197,94,0.1)',
            borderRadius: 10, padding: 14, fontSize: 12.5, color: 'var(--text)', lineHeight: 1.7 }}>
            <b style={{ color: '#22c55e', fontSize: 13.5 }}>✅ ลงถังเรียบร้อย</b>
            {created.map(c => (
              <div key={c.key}>{c.icon} {c.name} — {c.qty.toLocaleString('th-TH')} ชิ้น</div>
            ))}
            <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 11.5 }}>
              ช่องที่ยังไม่รู้ตอนนี้ (ผลพิจารณา QA · ผลการซ่อม OK/NG · วันนำกลับเข้ากระบวนการ)
              กรอกทีหลังได้ที่หน้าถังเหลือง/ถังแดง
            </div>
            <Link to="/qa?tab=bins" onClick={onClose}
              style={{ display: 'inline-block', marginTop: 10, padding: '7px 14px', borderRadius: 8,
                background: '#22c55e', color: '#06230f', fontWeight: 800, fontSize: 12.5, textDecoration: 'none' }}>
              🗑️ ไปดูใบในถัง →
            </Link>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border2)',
            background: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}>
            {created ? 'ปิด' : 'ยกเลิก'}</button>
          {!created && (
            <button onClick={save} disabled={saving || !picked.length} style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: picked.length ? '#e05252' : 'var(--border2)', color: '#fff',
              fontSize: 13, fontWeight: 700, cursor: saving || !picked.length ? 'default' : 'pointer',
              opacity: saving ? 0.6 : 1 }}>
              {saving ? 'กำลังบันทึก…' : `ลงถัง (${picked.length})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
