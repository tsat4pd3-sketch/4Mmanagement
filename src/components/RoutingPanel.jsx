/**
 * RoutingPanel — ลำดับกระบวนการของพาร์ท (master `part_routings`)
 * ฝังเป็นแท็บ 🔀 Routing ใน Product Master (pattern เดียวกับ BOM: ซ้าย=พาร์ท ขวา=รายการ)
 *
 * ทำไมอยู่ที่ Product Master: routing คือ "มุมการผลิต" ของสินค้า — ที่เดียวกับ CT/ไลน์/BOM
 * (กฎ CLAUDE.md: parts_master = ตัวตน · dr_products = มุมการผลิต)
 *
 * ⚠️ ค่าว่าง = ให้ระบบไปหาจากข้อมูลจริง (CT จาก Product Master · %OEE/C-O จากกะที่ปิดแล้ว
 *    · LOT จาก Kanban Std · คนจาก Standard Manpower) — กรอกเฉพาะตอนค่าจริงไม่ตรง
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from '../components/Toast';
import { activeProcessTypes } from '../utils/processTypes';
import { nextSeq } from '../utils/routing';
import useIsMobile from '../utils/useIsMobile';

const BLANK = {
  step_name: '', line_name: '', machine_no: '', process_type: '',
  ct_sec: '', setup_sec: '', lot_size: '', operators: '',
  is_outsourced: false, vendor_name: '', wip_label: '', wip_qty: '', note: '',
};
const numOrNull = v => (v === '' || v == null ? null : (Number.isFinite(+v) ? +v : null));

const inp = {
  width: '100%', fontSize: 13, padding: '6px 9px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)',
};
const lbl = { fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 };

export default function RoutingPanel({ canEdit, lines = [] }) {
  const isMobile = useIsMobile();
  const [products, setProducts] = useState([]);
  const [counts, setCounts] = useState({});
  const [sel, setSel] = useState(null);
  const [steps, setSteps] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);        // row | 'new' | null
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    const [{ data: prods }, { data: rt }] = await Promise.all([
      supabaseDR.from('dr_products').select('id, mat_no, name, p_no, line_name, cycle_time_sec')
        .eq('is_active', true).not('mat_no', 'is', null).order('line_name').order('name'),
      supabaseDR.from('part_routings').select('mat_no').eq('is_active', true),
    ]);
    setProducts(prods || []);
    const c = {};
    (rt || []).forEach(r => { c[r.mat_no] = (c[r.mat_no] || 0) + 1; });
    setCounts(c);
  }, []);

  const loadSteps = useCallback(async (matNo) => {
    if (!matNo) { setSteps([]); return; }
    setLoading(true);
    const { data, error } = await supabaseDR.from('part_routings')
      .select('*').eq('mat_no', matNo).eq('is_active', true).order('seq');
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setSteps(data || []);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadSteps(sel?.mat_no); }, [sel, loadSteps]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(p => [p.mat_no, p.name, p.p_no].some(v => String(v || '').toLowerCase().includes(q)));
  }, [products, search]);

  const byLine = useMemo(() => {
    const g = {};
    filtered.forEach(p => { (g[p.line_name || '— ไม่ระบุไลน์'] ||= []).push(p); });
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const openNew = () => {
    setForm({ ...BLANK, line_name: sel?.line_name || '', step_name: sel?.line_name || '' });
    setEditing('new');
  };
  const openEdit = (r) => {
    setForm({
      step_name: r.step_name || '', line_name: r.line_name || '', machine_no: r.machine_no || '',
      process_type: r.process_type || '', ct_sec: r.ct_sec ?? '', setup_sec: r.setup_sec ?? '',
      lot_size: r.lot_size ?? '', operators: r.operators ?? '', is_outsourced: !!r.is_outsourced,
      vendor_name: r.vendor_name || '', wip_label: r.wip_label || '', wip_qty: r.wip_qty ?? '', note: r.note || '',
    });
    setEditing(r);
  };

  const save = async () => {
    if (!form.step_name.trim()) { toast.error('กรอกชื่อกระบวนการ'); return; }
    if (!form.is_outsourced && !form.line_name) { toast.error('เลือกไลน์ที่ทำ (หรือติ๊กว่าเป็นงานจ้างนอก)'); return; }
    if (form.is_outsourced && !form.vendor_name.trim()) { toast.error('งานจ้างนอกต้องระบุผู้รับจ้าง'); return; }
    setSaving(true);
    const payload = {
      mat_no: sel.mat_no,
      step_name: form.step_name.trim(),
      line_name: form.is_outsourced ? null : (form.line_name || null),
      machine_no: form.machine_no.trim() || null,
      process_type: form.process_type || null,
      ct_sec: numOrNull(form.ct_sec), setup_sec: numOrNull(form.setup_sec),
      lot_size: numOrNull(form.lot_size), operators: numOrNull(form.operators),
      is_outsourced: !!form.is_outsourced,
      vendor_name: form.is_outsourced ? form.vendor_name.trim() : null,
      wip_label: form.wip_label.trim() || null, wip_qty: numOrNull(form.wip_qty),
      note: form.note.trim() || null,
    };
    const { error } = editing === 'new'
      ? await supabaseDR.from('part_routings').insert({ ...payload, seq: nextSeq(steps) })
      : await supabaseDR.from('part_routings').update(payload).eq('id', editing.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editing === 'new' ? 'เพิ่มขั้นแล้ว' : 'บันทึกแล้ว');
    setEditing(null);
    loadSteps(sel.mat_no); loadAll();
  };

  /** สลับลำดับกับแถวข้างเคียง — เขียน seq ชั่วคราวติดลบ กันชน unique(mat_no, seq) */
  const move = async (idx, dir) => {
    const a = steps[idx], b = steps[idx + dir];
    if (!a || !b) return;
    const { error } = await supabaseDR.from('part_routings').update({ seq: -a.seq }).eq('id', a.id);
    if (error) { toast.error(error.message); return; }
    await supabaseDR.from('part_routings').update({ seq: a.seq }).eq('id', b.id);
    await supabaseDR.from('part_routings').update({ seq: b.seq }).eq('id', a.id);
    loadSteps(sel.mat_no);
  };

  const remove = async (r) => {
    if (!window.confirm(`ลบขั้น "${r.step_name}" ?`)) return;
    const { error } = await supabaseDR.from('part_routings').delete().eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    // เรียงลำดับที่เหลือให้ต่อเนื่อง 1..n
    const rest = steps.filter(s => s.id !== r.id).sort((x, y) => x.seq - y.seq);
    for (let i = 0; i < rest.length; i++) {
      if (rest[i].seq !== i + 1) await supabaseDR.from('part_routings').update({ seq: i + 1 }).eq('id', rest[i].id);
    }
    toast.success('ลบแล้ว');
    loadSteps(sel.mat_no); loadAll();
  };

  /** ตั้งต้นจากข้อมูลที่มี — 1 ขั้นจากไลน์ใน Product Master (ไม่ใช่การเดา) */
  const seedFromProduct = async () => {
    if (!sel?.line_name) { toast.error('สินค้านี้ยังไม่ได้ผูกไลน์ใน Product Master'); return; }
    const { error } = await supabaseDR.from('part_routings').insert({
      mat_no: sel.mat_no, seq: 1, step_name: sel.line_name, line_name: sel.line_name,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('สร้างขั้นตั้งต้นแล้ว — แก้ชื่อ/เพิ่มขั้นต่อได้เลย');
    loadSteps(sel.mat_no); loadAll();
  };

  const lineNames = useMemo(() => [...new Set(lines.map(l => l.name).filter(Boolean))].sort(), [lines]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(260px, 340px) 1fr', gap: 16, alignItems: 'start' }}>
      {/* ── ซ้าย: เลือกพาร์ท ── */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 12 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหา MAT / ชื่อ / P/N…" style={{ ...inp, marginBottom: 10 }} />
        <div style={{ maxHeight: isMobile ? 260 : 560, overflowY: 'auto' }}>
          {byLine.map(([ln, ps]) => (
            <div key={ln}>
              <div style={{ position: 'sticky', top: 0, background: 'var(--bg2)', padding: '4px 8px', fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>{ln}</div>
              {ps.map(p => (
                <div key={p.id} onClick={() => setSel(p)}
                  style={{
                    padding: '6px 8px', cursor: 'pointer', fontSize: 12.5, borderRadius: 5,
                    display: 'flex', justifyContent: 'space-between', gap: 8,
                    background: sel?.id === p.id ? 'var(--accent)' : 'transparent',
                    color: sel?.id === p.id ? '#08130a' : 'var(--text)',
                  }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.mat_no} · {p.name}</span>
                  <span style={{ fontSize: 11, opacity: 0.8, flexShrink: 0 }}>{counts[p.mat_no] ? `${counts[p.mat_no]} ขั้น` : '—'}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── ขวา: ขั้นตอน ── */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 14 }}>
        {!sel && <div style={{ color: 'var(--muted)', fontSize: 13, padding: 28, textAlign: 'center' }}>เลือกพาร์ททางซ้ายเพื่อกำหนดลำดับกระบวนการ</div>}
        {sel && <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{sel.mat_no} · {sel.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>ไลน์ใน Product Master: {sel.line_name || '—'} · CT {sel.cycle_time_sec ?? '—'} sec</div>
            </div>
            {canEdit && <div style={{ display: 'flex', gap: 8 }}>
              {!steps.length && sel.line_name && (
                <button onClick={seedFromProduct} style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}>
                  ⚡ สร้างขั้นตั้งต้นจากไลน์
                </button>
              )}
              <button onClick={openNew} style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#08130a', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>+ เพิ่มขั้น</button>
            </div>}
          </div>

          {loading && <div style={{ color: 'var(--muted)', fontSize: 13 }}>กำลังโหลด…</div>}
          {!loading && !steps.length && (
            <div style={{ padding: 22, textAlign: 'center', color: 'var(--muted)', fontSize: 13, background: 'var(--bg2)', borderRadius: 8 }}>
              ยังไม่ได้กำหนดลำดับกระบวนการ<br />
              <span style={{ fontSize: 12 }}>VSM จะใช้ไลน์เดียวจาก Product Master ไปก่อน แล้วขึ้นเตือนว่ายังไม่ลง routing</span>
            </div>
          )}

          {!!steps.length && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead><tr style={{ background: 'var(--bg2)' }}>
                  {['#', 'กระบวนการ', 'ไลน์ / ผู้รับจ้าง', 'C/T', 'C/O', 'LOT', 'คน', 'จุดพักหลังขั้นนี้', ''].map((h, i) =>
                    <th key={i} style={{ padding: '7px 8px', fontSize: 11.5, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {steps.map((r, i) => (
                    <tr key={r.id}>
                      <td style={{ padding: '7px 8px', fontSize: 12, color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>{r.seq}</td>
                      <td style={{ padding: '7px 8px', fontSize: 12.5, fontWeight: 700, color: 'var(--text)', borderTop: '1px solid var(--border)' }}>
                        {r.step_name}
                        {r.machine_no && <span style={{ fontWeight: 400, color: 'var(--muted)' }}> · {r.machine_no}</span>}
                      </td>
                      <td style={{ padding: '7px 8px', fontSize: 12, color: 'var(--text)', borderTop: '1px solid var(--border)' }}>
                        {r.is_outsourced
                          ? <span style={{ color: '#a78bfa' }}>🏭 จ้างนอก · {r.vendor_name}</span>
                          : (r.line_name || '—')}
                      </td>
                      {[r.ct_sec, r.setup_sec, r.lot_size, r.operators].map((v, k) => (
                        <td key={k} style={{ padding: '7px 8px', fontSize: 12, color: v == null ? 'var(--muted)' : 'var(--text)', borderTop: '1px solid var(--border)' }}>
                          {v == null ? 'auto' : v}
                        </td>
                      ))}
                      <td style={{ padding: '7px 8px', fontSize: 12, color: 'var(--text)', borderTop: '1px solid var(--border)' }}>
                        {r.wip_label ? `${r.wip_label}${r.wip_qty != null ? ` · ${Number(r.wip_qty).toLocaleString('th-TH')} pcs` : ''}` : '—'}
                      </td>
                      <td style={{ padding: '5px 8px', borderTop: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                        {canEdit && <>
                          <button onClick={() => move(i, -1)} disabled={i === 0} title="เลื่อนขึ้น"
                            style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.3 : 1, fontSize: 13 }}>▲</button>
                          <button onClick={() => move(i, 1)} disabled={i === steps.length - 1} title="เลื่อนลง"
                            style={{ background: 'none', border: 'none', cursor: i === steps.length - 1 ? 'default' : 'pointer', opacity: i === steps.length - 1 ? 0.3 : 1, fontSize: 13 }}>▼</button>
                          <button onClick={() => openEdit(r)} title="แก้ไข" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>✏️</button>
                          <button onClick={() => remove(r)} title="ลบ" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>🗑</button>
                        </>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>
                <b>auto</b> = ปล่อยว่างให้ระบบไปหาจากข้อมูลจริง (C/T จาก Product Master · C/O จาก downtime ที่จัดหมวด
                “ปรับตั้ง/เปลี่ยนรุ่น” · LOT จาก Kanban Std · คนจาก Standard Manpower) —
                กรอกตัวเลขเฉพาะตอนค่าจริงไม่ตรงกับที่ต้องการให้แสดงในใบ VSM
              </div>
            </div>
          )}
        </>}
      </div>

      {/* ── modal เพิ่ม/แก้ขั้น ── */}
      {editing && (
        <div onClick={e => e.target === e.currentTarget && setEditing(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, width: 'min(96vw, 620px)', maxHeight: '92vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>
              {editing === 'new' ? 'เพิ่มขั้นกระบวนการ' : 'แก้ไขขั้นกระบวนการ'}
            </h3>
            <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignContent: 'start' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>ชื่อกระบวนการ (ที่จะโชว์ในกล่อง VSM) *</label>
                <input value={form.step_name} onChange={e => setForm(f => ({ ...f, step_name: e.target.value }))}
                  placeholder="เช่น STAMPING PRESS 300 TON" style={inp} />
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" id="rt-out" checked={form.is_outsourced}
                  onChange={e => setForm(f => ({ ...f, is_outsourced: e.target.checked }))} style={{ width: 'auto' }} />
                <label htmlFor="rt-out" style={{ fontSize: 12.5, color: 'var(--text)', cursor: 'pointer' }}>🏭 เป็นงานจ้างนอก (ส่งออกไปทำข้างนอก เช่น พ่นสี)</label>
              </div>
              {form.is_outsourced ? (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={lbl}>ผู้รับจ้าง *</label>
                  <input value={form.vendor_name} onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))} placeholder="เช่น JAROONRAT" style={inp} />
                </div>
              ) : (<>
                <div>
                  <label style={lbl}>ไลน์ที่ทำ *</label>
                  <select value={form.line_name} onChange={e => setForm(f => ({ ...f, line_name: e.target.value }))} style={inp}>
                    <option value="">— เลือกไลน์ —</option>
                    {lineNames.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>หมายเลขเครื่อง (ถ้ามี)</label>
                  <input value={form.machine_no} onChange={e => setForm(f => ({ ...f, machine_no: e.target.value }))} style={inp} />
                </div>
              </>)}
              <div>
                <label style={lbl}>กระบวนการ</label>
                <select value={form.process_type} onChange={e => setForm(f => ({ ...f, process_type: e.target.value }))} style={inp}>
                  <option value="">— ไม่ระบุ —</option>
                  {activeProcessTypes().map(p => <option key={p.key} value={p.key}>{p.icon || ''} {p.label}</option>)}
                </select>
              </div>
              {[
                ['ct_sec', 'C/T (วินาที)', 'ว่าง = ใช้ CT ของสินค้า'],
                ['setup_sec', 'C/O ปรับตั้ง (วินาที)', 'ว่าง = คำนวณจาก downtime จริง'],
                ['lot_size', 'ขนาดล็อต (ชิ้น)', 'ว่าง = ใช้ Kanban Std'],
                ['operators', 'จำนวนคน', 'ว่าง = ใช้ Standard Manpower'],
              ].map(([k, l, ph]) => (
                <div key={k}>
                  <label style={lbl}>{l}</label>
                  <input type="number" value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} placeholder={ph} style={inp} />
                </div>
              ))}
              <div>
                <label style={lbl}>ชื่อจุดพักหลังขั้นนี้</label>
                <input value={form.wip_label} onChange={e => setForm(f => ({ ...f, wip_label: e.target.value }))} placeholder="เช่น Store Blank" style={inp} />
              </div>
              <div>
                <label style={lbl}>คงคลังที่จุดพัก (ชิ้น)</label>
                <input type="number" value={form.wip_qty} onChange={e => setForm(f => ({ ...f, wip_qty: e.target.value }))} placeholder="ระบบไม่เก็บ WIP — กรอกเอง" style={inp} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>หมายเหตุ</label>
                <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={inp} />
              </div>
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
