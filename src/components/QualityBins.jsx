/**
 * QualityBins — ถังเหลือง (ชิ้นงานต้องสงสัย) / ถังแดง (ชิ้นงานเสีย) · paperless
 * ฝังเป็นแท็บใน /qa · ตาราง `quality_bin_records` (DR)
 *
 * ⚠️ 2 ถังเป็น "สายงานเดียวกัน" ตามหมายเหตุท้ายฟอร์มกระดาษ:
 *    ต้องสงสัย → ซ่อม → OK = กลับเข้ากระบวนการ · NG = ติดแท็กแดง → ลงถังแดง → Scrap Report
 *    ปุ่ม "→ ลงถังแดง" จึงสร้างแถวถังแดงที่ผูก `from_yellow_id` กลับมาที่ใบเหลือง
 *    (ห้ามให้คนคีย์ใหม่มือเปล่า — จะสืบไม่ได้ว่าของในถังแดงมาจากใบไหน)
 *
 * สิทธิ์: reuse `scrap:record` / `scrap:manage` — เป็น workflow ของเสียชุดเดียวกับใบ Scrap Report
 * (ไม่เพิ่ม permission key ใหม่ เลี่ยงกับดัก seed enum_range ที่ทำให้ role ใหม่ fail-closed)
 */
import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { scopedLineNames } from '../utils/sectionScope';
import { printQualityBin } from '../lib/qualityBinPrint';

const BINS = [
  { key: 'yellow', label: '🟡 ถังเหลือง — ชิ้นงานต้องสงสัย', short: 'ถังเหลือง', color: '#f5b942' },
  { key: 'red',    label: '🔴 ถังแดง — ชิ้นงานเสีย',        short: 'ถังแดง',   color: '#e05252' },
];

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const numOrNull = v => (v === '' || v == null ? null : (Number.isFinite(+v) ? +v : null));

const BLANK = {
  work_date: today(), line_name: '', mat_no: '', part_name: '', part_no: '', qty: '',
  cause: '', reported_by: '', qa_by: '',
  repair_date: '', repair_detail: '', repair_by: '', qty_ok: '', qty_ng: '', return_date: '',
  disposed_by: '', disposed_position: '', note: '',
};

const inp = {
  width: '100%', fontSize: 13, padding: '6px 9px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)',
};
const lbl = { fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 };
const th = { padding: '7px 8px', fontSize: 11.5, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' };
const td = { padding: '6px 8px', fontSize: 12.5, color: 'var(--text)', borderTop: '1px solid var(--border)' };

export default function QualityBins() {
  const { role, lineId, sections, fullName } = useContext(UserContext);
  const canRecord = can('scrap', 'record', role);
  const canManage = can('scrap', 'manage', role);

  const [bin, setBin] = useState('yellow');
  const [lines, setLines] = useState([]);
  const [products, setProducts] = useState([]);
  const [rows, setRows] = useState([]);
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [lineFilter, setLineFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);   // row | 'new' | null
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, parent_line_name').order('name')
      .then(({ data }) => setLines(data || []));
    supabaseDR.from('dr_products').select('mat_no, name, p_no, line_name').eq('is_active', true)
      .not('mat_no', 'is', null).order('name').then(({ data }) => setProducts(data || []));
  }, []);

  // scope มาตรฐาน (helper กลาง) — ผลิตเห็นเฉพาะส่วนงานตัวเอง
  const scopeNames = useMemo(
    () => scopedLineNames({ role, lineId, sections: sections || [], lines }),
    [role, lineId, sections, lines],
  );

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabaseDR.from('quality_bin_records').select('*')
      .eq('bin', bin).eq('is_active', true)
      .gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: false }).order('created_at', { ascending: false })
      .limit(500);
    if (scopeNames) q = q.in('line_name', scopeNames);
    const { data, error } = await q;
    setLoading(false);
    if (error) {
      // ยังไม่ apply migration = ต้องบอกให้ชัด ห้ามโชว์เป็น "ไม่มีข้อมูล"
      toast.error(error.code === '42P01'
        ? 'ยังไม่ได้ติดตั้งตารางถังเหลือง/แดง — แจ้ง admin ให้ apply migration 20260819_quality_bin_records'
        : error.message);
      setRows([]);
      return;
    }
    setRows(data || []);
  }, [bin, from, to, scopeNames]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (lineFilter && r.line_name !== lineFilter) return false;
      if (!q) return true;
      return [r.mat_no, r.part_name, r.part_no, r.cause, r.reported_by, r.note]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [rows, search, lineFilter]);

  const lineOpts = useMemo(
    () => (scopeNames || lines.map(l => l.name)).slice().sort(),
    [scopeNames, lines],
  );

  const openNew = () => { setForm({ ...BLANK, reported_by: '' }); setEditing('new'); };
  const openEdit = (r) => {
    setForm(Object.fromEntries(Object.keys(BLANK).map(k => [k, r[k] ?? ''])));
    setEditing(r);
  };

  const save = async () => {
    if (!form.work_date) { toast.error('กรอกวันที่ลงถัง'); return; }
    if (!numOrNull(form.qty)) { toast.error('กรอกจำนวนชิ้นงาน'); return; }
    if (!form.part_name.trim() && !form.mat_no.trim()) { toast.error('ระบุชื่อหรือรหัสชิ้นงาน'); return; }
    setSaving(true);
    const payload = {
      bin,
      work_date: form.work_date,
      line_name: form.line_name || null,
      mat_no: form.mat_no.trim() || null,
      part_name: form.part_name.trim() || null,
      part_no: form.part_no.trim() || null,
      qty: numOrNull(form.qty),
      cause: form.cause.trim() || null,
      reported_by: form.reported_by.trim() || null,
      qa_by: form.qa_by.trim() || null,
      repair_date: form.repair_date || null,
      repair_detail: form.repair_detail.trim() || null,
      repair_by: form.repair_by.trim() || null,
      qty_ok: numOrNull(form.qty_ok),
      qty_ng: numOrNull(form.qty_ng),
      return_date: form.return_date || null,
      disposed_by: form.disposed_by.trim() || null,
      disposed_position: form.disposed_position.trim() || null,
      note: form.note.trim() || null,
    };
    const { error } = editing === 'new'
      ? await supabaseDR.from('quality_bin_records').insert(payload)
      : await supabaseDR.from('quality_bin_records').update(payload).eq('id', editing.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editing === 'new' ? 'บันทึกแล้ว' : 'แก้ไขแล้ว');
    setEditing(null); load();
  };

  const remove = async (r) => {
    if (!window.confirm(`ลบรายการ ${r.part_name || r.mat_no} (${r.qty} ชิ้น) ?`)) return;
    // soft delete — ใบเก่าต้องยังสืบย้อนได้ (บันทึกคุณภาพ ห้ามลบทิ้งจริง)
    const { error } = await supabaseDR.from('quality_bin_records')
      .update({ is_active: false }).eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    toast.success('ลบแล้ว'); load();
  };

  /** ซ่อมแล้ว NG → ย้ายลงถังแดง (ตามหมายเหตุท้ายฟอร์มเหลือง) */
  const toRed = async (r) => {
    const qty = Number(r.qty_ng) || 0;
    if (!qty) { toast.error('ยังไม่ได้กรอกจำนวน NG หลังซ่อม'); return; }
    if (!window.confirm(`ย้าย ${qty} ชิ้นลงถังแดง?\n\n${r.part_name || r.mat_no}\nระบบจะสร้างรายการถังแดงที่ผูกกับใบนี้ให้`)) return;
    const { error } = await supabaseDR.from('quality_bin_records').insert({
      bin: 'red', work_date: today(), line_name: r.line_name,
      mat_no: r.mat_no, part_name: r.part_name, part_no: r.part_no,
      qty, cause: [r.cause, 'ซ่อมแล้ว NG (จากถังเหลือง)'].filter(Boolean).join(' · '),
      reported_by: r.reported_by, qa_by: r.qa_by,
      from_yellow_id: r.id,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('สร้างรายการถังแดงแล้ว — ไปกรอกผู้กำจัดทำลายที่แท็บถังแดง');
  };

  const doPrint = async () => {
    const ok = await printQualityBin({ bin, records: filtered });
    if (!ok) toast.error('เบราว์เซอร์บล็อก popup — อนุญาต popup ของเว็บนี้ก่อน');
  };

  const B = BINS.find(b => b.key === bin);
  const isY = bin === 'yellow';
  const totalQty = filtered.reduce((a, r) => a + (Number(r.qty) || 0), 0);

  return (
    <div>
      {/* ── เลือกถัง ── */}
      <div style={{ display: 'flex', gap: 6, background: 'var(--bg2)', borderRadius: 8, padding: 4, marginBottom: 14, width: 'fit-content', maxWidth: '100%', overflowX: 'auto' }}>
        {BINS.map(b => (
          <button key={b.key} onClick={() => setBin(b.key)}
            style={{ padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
              background: bin === b.key ? b.color : 'transparent',
              color: bin === b.key ? '#1a1206' : 'var(--muted)', fontFamily: 'var(--font-body)' }}>
            {b.label}
          </button>
        ))}
      </div>

      {/* ── แถบควบคุม ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div><label style={lbl}>ตั้งแต่</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...inp, width: 150 }} /></div>
        <div><label style={lbl}>ถึง</label><input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...inp, width: 150 }} /></div>
        <div><label style={lbl}>ไลน์</label>
          <select value={lineFilter} onChange={e => setLineFilter(e.target.value)} style={{ ...inp, width: 180 }}>
            <option value="">ทุกไลน์</option>
            {lineOpts.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 160 }}><label style={lbl}>ค้นหา</label>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ชิ้นงาน / สาเหตุ / ผู้แจ้ง…" style={inp} />
        </div>
        {canRecord && <button onClick={openNew} style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#08130a', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>+ บันทึกรายการ</button>}
        <button onClick={doPrint} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>🖨️ พิมพ์ใบ {B.short}</button>
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>
        {loading ? 'กำลังโหลด…' : `${filtered.length} รายการ · รวม ${totalQty.toLocaleString('th-TH')} ชิ้น`}
        {scopeNames && <span> · 👥 เฉพาะส่วนงานของคุณ ({scopeNames.length} ไลน์)</span>}
      </div>

      {/* ── ตาราง ── */}
      <div style={{ overflowX: 'auto', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isY ? 1150 : 900 }}>
          <thead><tr style={{ background: 'var(--bg2)' }}>
            {(isY
              ? ['วันที่ลงถัง', 'ชิ้นงาน', 'จำนวนรอพิจารณา', 'สาเหตุ', 'ผู้แจ้ง', 'ซ่อมเมื่อ', 'ผู้ซ่อม', 'QA', 'OK', 'NG', 'กลับเข้ากระบวนการ', '']
              : ['วันที่ลงถัง', 'ชิ้นงาน', 'ไลน์', 'จำนวนเสีย', 'สาเหตุ', 'ผู้แจ้ง', 'QA', 'ผู้กำจัดทำลาย', 'ตำแหน่ง', '']
            ).map((h, i) => <th key={i} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {!loading && !filtered.length && (
              <tr><td colSpan={12} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: 28 }}>
                ไม่มีรายการในช่วงที่เลือก
              </td></tr>
            )}
            {filtered.map(r => (
              <tr key={r.id}>
                <td style={td}>{r.work_date}</td>
                <td style={td}>
                  <div style={{ fontWeight: 700 }}>{r.part_name || '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.part_no || r.mat_no || ''}</div>
                  {/* มาจากบันทึกงานเสียใน Daily Report — บอกที่มาไว้ กันคีย์ซ้ำ */}
                  {r.defect_log_id && (
                    <div style={{ fontSize: 10.5, color: '#0ea5e9' }}
                      title="สร้างจากบันทึกงานเสียในหน้า Daily Report — ไม่ได้คีย์ใหม่">
                      📋 จาก Daily Report
                    </div>
                  )}
                </td>
                {!isY && <td style={td}>{r.line_name || '—'}</td>}
                <td style={{ ...td, fontWeight: 700 }}>{Number(r.qty || 0).toLocaleString('th-TH')}</td>
                <td style={td}>{r.cause || '—'}</td>
                <td style={td}>{r.reported_by || '—'}</td>
                {isY && <td style={td}>{r.repair_date || '—'}</td>}
                {isY && <td style={td}>{r.repair_by || '—'}</td>}
                <td style={td}>{r.qa_by || '—'}</td>
                {isY && <td style={{ ...td, color: '#22c55e', fontWeight: 700 }}>{r.qty_ok ?? '—'}</td>}
                {isY && <td style={{ ...td, color: '#ef4444', fontWeight: 700 }}>{r.qty_ng ?? '—'}</td>}
                {isY && <td style={td}>{r.return_date || '—'}</td>}
                {!isY && <td style={td}>{r.disposed_by || '—'}</td>}
                {!isY && <td style={td}>
                  {r.disposed_position || '—'}
                  {r.from_yellow_id && <div style={{ fontSize: 10.5, color: '#f5b942' }}>🟡 มาจากถังเหลือง</div>}
                </td>}
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {canRecord && <button onClick={() => openEdit(r)} title="แก้ไข" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>✏️</button>}
                  {canRecord && isY && (Number(r.qty_ng) || 0) > 0 && (
                    <button onClick={() => toRed(r)} title="ซ่อมแล้ว NG → ลงถังแดง"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>🔴</button>
                  )}
                  {canManage && <button onClick={() => remove(r)} title="ลบ" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>🗑</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── modal บันทึก/แก้ไข ── */}
      {editing && (
        <div onClick={e => e.target === e.currentTarget && setEditing(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, width: 'min(96vw, 720px)', maxHeight: '92vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>
              {editing === 'new' ? 'บันทึกรายการ' : 'แก้ไขรายการ'} — {B.short}
            </h3>
            <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignContent: 'start' }}>
              <div><label style={lbl}>วันที่ลงถัง *</label>
                <input type="date" value={form.work_date} onChange={e => setForm(f => ({ ...f, work_date: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>ไลน์การผลิต</label>
                <select value={form.line_name} onChange={e => setForm(f => ({ ...f, line_name: e.target.value }))} style={inp}>
                  <option value="">— เลือกไลน์ —</option>
                  {lineOpts.map(n => <option key={n} value={n}>{n}</option>)}
                </select></div>
              <div><label style={lbl}>จำนวน (ชิ้น) *</label>
                <input type="number" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} style={inp} /></div>

              <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>ชิ้นงาน (เลือกจาก Product Master หรือพิมพ์เอง)</label>
                <input list="qbin-parts" value={form.mat_no}
                  onChange={e => {
                    const v = e.target.value;
                    const p = products.find(x => x.mat_no === v);
                    setForm(f => ({ ...f, mat_no: v, ...(p ? { part_name: p.name || f.part_name, part_no: p.p_no || f.part_no, line_name: f.line_name || p.line_name || '' } : {}) }));
                  }}
                  placeholder="MAT / รหัสชิ้นงาน" style={inp} />
                <datalist id="qbin-parts">
                  {products.slice(0, 400).map(p => <option key={p.mat_no} value={p.mat_no}>{p.name}</option>)}
                </datalist></div>
              <div><label style={lbl}>ชื่อชิ้นงาน</label>
                <input value={form.part_name} onChange={e => setForm(f => ({ ...f, part_name: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>Part No. (เลขลูกค้า)</label>
                <input value={form.part_no} onChange={e => setForm(f => ({ ...f, part_no: e.target.value }))} style={inp} /></div>

              <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>สาเหตุ</label>
                <input value={form.cause} onChange={e => setForm(f => ({ ...f, cause: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>ผู้แจ้ง (พนักงาน)</label>
                <input value={form.reported_by} onChange={e => setForm(f => ({ ...f, reported_by: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>ผู้ตรวจสอบ (QA)</label>
                <input value={form.qa_by} onChange={e => setForm(f => ({ ...f, qa_by: e.target.value }))} style={inp} /></div>

              {isY ? (<>
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>ผลการซ่อม</div>
                <div><label style={lbl}>วันที่ซ่อมชิ้นงาน</label>
                  <input type="date" value={form.repair_date} onChange={e => setForm(f => ({ ...f, repair_date: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>ผู้ดำเนินการซ่อม</label>
                  <input value={form.repair_by} onChange={e => setForm(f => ({ ...f, repair_by: e.target.value }))} style={inp} /></div>
                <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>รายละเอียดการซ่อมชิ้นงาน</label>
                  <input value={form.repair_detail} onChange={e => setForm(f => ({ ...f, repair_detail: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>ผลซ่อม OK (ชิ้น)</label>
                  <input type="number" value={form.qty_ok} onChange={e => setForm(f => ({ ...f, qty_ok: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>ผลซ่อม NG (ชิ้น)</label>
                  <input type="number" value={form.qty_ng} onChange={e => setForm(f => ({ ...f, qty_ng: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>วันที่นำกลับเข้ากระบวนการ</label>
                  <input type="date" value={form.return_date} onChange={e => setForm(f => ({ ...f, return_date: e.target.value }))} style={inp} /></div>
              </>) : (<>
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>การกำจัดทำลาย (ตาม DOA)</div>
                <div><label style={lbl}>ผู้กำจัดทำลาย</label>
                  <input value={form.disposed_by} onChange={e => setForm(f => ({ ...f, disposed_by: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>ตำแหน่ง</label>
                  <input value={form.disposed_position} onChange={e => setForm(f => ({ ...f, disposed_position: e.target.value }))}
                    placeholder="ระดับหัวหน้ากลุ่ม-วิศวกรขึ้นไป" style={inp} /></div>
              </>)}

              <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>หมายเหตุ</label>
                <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={inp} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => setEditing(null)} style={{ padding: '8px 18px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}>ยกเลิก</button>
              <button onClick={save} disabled={saving} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#08130a', cursor: 'pointer', fontSize: 13, fontWeight: 700, opacity: saving ? 0.6 : 1 }}>
                {saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
