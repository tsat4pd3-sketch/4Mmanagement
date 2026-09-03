import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { buildFlowGraph, downstreamOf, upstreamOf, lineAvgCtSec, bufferCoverMin } from '../utils/lineFlow';

/* ═══ 🔗 สายการไหลระหว่างไลน์ — แผงใน /linesetup (2026-08-19) ═══
   ตอบ "ไลน์นี้ป้อนงานให้ใคร / รับของมาจากใคร" ซึ่งระบบเดิมไม่เคยเก็บไว้ที่ไหนเลย
   (machine_flow_links = ในไลน์เดียวกัน · part_routings = รายพาร์ท ยังลงไม่ครบ)

   ⚠️ buffer ระหว่างกลางคือหัวใจ — ต้นน้ำหยุด ไม่ได้แปลว่าปลายน้ำหยุดทันที
      ไม่กรอก buffer = ระบบบอกแค่ "เชื่อมกัน" ไม่เดาเวลา (ห้ามเดาเป็น 0) */

const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} ชม. ${Math.round(m % 60)} น.` : `${Math.round(m)} นาที`);

export default function LineFlowPanel({ lineName, lines = [], canEdit = false }) {
  const [links, setLinks] = useState([]);
  const [products, setProducts] = useState([]);
  const [missing, setMissing] = useState(false);   // ตารางยังไม่ apply migration
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(null);          // { dir: 'down'|'up', other, buffer_label, buffer_qty }
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabaseDR.from('line_flow_links').select('*').eq('is_active', true);
    // 42P01 = ยังไม่ apply migration → บอกบนจอ ห้ามเงียบ (กฎ: ห้ามล้มเหลวเงียบ)
    if (error) { setMissing(error.code === '42P01'); setLinks([]); return; }
    setMissing(false);
    setLinks(data || []);
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => {
    if (!open || products.length) return;
    // CT ใช้ประเมิน buffer cover time — ไม่มีก็ยังใช้งานแผงได้ แค่ไม่โชว์ "กันได้กี่นาที"
    supabaseDR.from('dr_products').select('line_name, cycle_time_sec, is_operation')
      .then(({ data }) => setProducts(data || []))
      .catch(() => { /* best-effort */ });
  }, [open, products.length]);

  const graph = useMemo(() => buildFlowGraph(links), [links]);
  const down = useMemo(() => downstreamOf(graph, lineName), [graph, lineName]);
  const up = useMemo(() => upstreamOf(graph, lineName), [graph, lineName]);

  /* ไลน์ที่ "มีลูก" = ระดับแผนก — งานจริงเกิดที่ไลน์ลูกเสมอ
     (กฎเดียวกับหน่วยนับสต๊อก: ของ/งานอยู่ที่ไลน์ย่อยที่สุด ไลน์แม่เป็นแค่การจัดกลุ่ม) */
  const childrenOf = useMemo(() => {
    const m = {};
    (lines || []).forEach(l => { if (l.parent_line_name) (m[l.parent_line_name] ||= []).push(l.name); });
    Object.values(m).forEach(a => a.sort((x, y) => x.localeCompare(y)));
    return m;
  }, [lines]);

  /* ไลน์ที่เลือกได้ — ข้ามแผนก/ข้ามส่วนงานได้ (ของไหลข้ามส่วนงานจริง)
     🔴 เสนอลำดับ ไม่ตัดตัวเลือกทิ้ง (กฎเดียวกับ moveTargets): ไลน์แม่ยังเลือกได้ แต่แยกกลุ่ม + เตือน
        เดิมลิสต์ดิบๆ ไม่บอกอะไรเลย → คนตั้ง "LASER-345 ➡️ LINE APRON ASSY" ซึ่งเป็นชื่อ *แผนก*
        แล้ว cover time คำนวณไม่ได้ตลอดกาล เพราะไลน์แม่ไม่มี product/CT ของตัวเอง (ข้อมูลจริง 03/09: 0 พาร์ท)
     ⚠️ ไลน์ที่ปิดใช้งานถูกกรองออก แต่ค่าที่ "ตั้งไว้แล้ว" ยังแสดงในลิสต์เส้นเสมอ (ไม่หายเงียบ) */
  const { leafOpts, parentOpts } = useMemo(() => {
    const usable = (lines || []).filter(l => l.name !== lineName && l.is_active !== false);
    const byName = (a, b) => a.localeCompare(b);
    return {
      leafOpts: usable.filter(l => !childrenOf[l.name]).map(l => l.name).sort(byName),
      parentOpts: usable.filter(l => childrenOf[l.name]).map(l => l.name).sort(byName),
    };
  }, [lines, lineName, childrenOf]);

  const save = async () => {
    if (!form?.other) { toast.error('เลือกไลน์ปลายทางก่อน'); return; }
    setSaving(true);
    const row = {
      from_line: form.dir === 'down' ? lineName : form.other,
      to_line: form.dir === 'down' ? form.other : lineName,
      buffer_label: form.buffer_label?.trim() || null,
      buffer_qty: form.buffer_qty === '' || form.buffer_qty == null ? null : Number(form.buffer_qty),
      is_active: true,
    };
    const { error } = await supabaseDR.from('line_flow_links').upsert(row, { onConflict: 'from_line,to_line' });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('บันทึกสายการไหลแล้ว');
    setForm(null);
    load();
  };

  const remove = async (l) => {
    if (!window.confirm(`ลบเส้น ${l.from_line} → ${l.to_line}?`)) return;
    const { error } = await supabaseDR.from('line_flow_links').delete().eq('id', l.id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const renderRow = (l, dir) => {
    const other = dir === 'down' ? l.to_line : l.from_line;
    /* ⚠️ cover time คิดจาก CT ของ "ไลน์ปลายน้ำ" เสมอ (ปลายน้ำเป็นคนกินของออกจาก buffer) */
    const consumer = dir === 'down' ? l.to_line : lineName;
    const consumerCt = lineAvgCtSec(products, consumer);
    const cover = bufferCoverMin(l.buffer_qty, consumerCt);
    /* ตั้งไว้ผิดชั้น = ต้องเห็น ไม่ใช่เงียบ — เส้นที่ชี้ไปไลน์แม่ประเมินเวลาไม่ได้เลย */
    const otherKids = childrenOf[other] || [];
    const ctMissing = l.buffer_qty != null && consumerCt == null;
    return (
      <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border2)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          {dir === 'down' ? '➡️' : '⬅️'} {other}
        </span>
        {l.buffer_label && <span style={{ fontSize: 11, color: 'var(--muted)' }}>📦 {l.buffer_label}</span>}
        {l.buffer_qty != null
          ? <span style={{ fontSize: 11, color: 'var(--text2)' }}>buffer {Number(l.buffer_qty).toLocaleString()} ชิ้น</span>
          : <span style={{ fontSize: 11, color: '#f59e0b' }}>⚠ ยังไม่ระบุ buffer</span>}
        {cover != null && (
          <span title="ต้นน้ำหยุดได้ประมาณเท่านี้ก่อนปลายน้ำเริ่มรอของ (คิดจาก CT เฉลี่ยของไลน์ปลายน้ำ)"
            style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>≈ กันได้ {fmtMin(cover)}</span>
        )}
        {ctMissing && (
          <span title={`${consumer} ยังไม่มีสินค้าที่ตั้ง Cycle Time — ประเมิน "กันได้กี่นาที" ไม่ได้`}
            style={{ fontSize: 11, color: '#f59e0b' }}>⚠ ไม่มี CT ของ {consumer} — ประเมินเวลาไม่ได้</span>
        )}
        {otherKids.length > 0 && (
          <span title={`${other} เป็นระดับแผนก (มีไลน์ย่อย ${otherKids.join(', ')}) — งานจริงเกิดที่ไลน์ย่อย ตั้งเส้นที่ไลน์ย่อยแทน`}
            style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>⚠ {other} เป็นแผนก ไม่ใช่ไลน์</span>
        )}
        {canEdit && (
          <button onClick={() => remove(l)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, opacity: 0.6 }}>🗑</button>
        )}
      </div>
    );
  };

  return (
    <>
      <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0 12px' }} />
      <button onClick={() => setOpen(v => !v)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', padding: 0, marginBottom: open ? 10 : 0, cursor: 'pointer' }}>
        <h4 style={{ margin: 0, color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-display)' }}>
          🔗 สายการไหลระหว่างไลน์ <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>· ไลน์นี้ป้อนให้ใคร / รับของจากใคร</span>
        </h4>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{open ? '▲ ซ่อน' : '▼ แสดง'}</span>
      </button>

      {open && (
        <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 10, padding: 14 }}>
          {missing ? (
            <div style={{ fontSize: 12, color: '#f59e0b', lineHeight: 1.6 }}>
              ⚠️ ยังไม่ได้ apply migration <code>20260819_line_flow_links.sql</code> — แจ้ง admin ให้รันก่อน แล้วแผงนี้จะใช้งานได้
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 10 }}>
                ใช้ตอบว่า <b>“หยุดที่ไลน์นี้ กระทบไลน์ไหนบ้าง”</b> — ระบบไม่เดาให้ ต้องตั้งเอง
                · <b>buffer</b> คือจุดพักระหว่างกลาง ยิ่งมีมาก ปลายน้ำยิ่งทนต้นน้ำหยุดได้นาน
                (ไม่กรอก = ระบบบอกแค่ว่าเชื่อมกัน ไม่ประเมินเวลา)
              </div>

              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>➡️ ไลน์นี้ป้อนงานให้ ({down.length})</div>
              {down.length === 0 && <div style={{ fontSize: 11, color: 'var(--muted)', padding: '4px 0' }}>— ยังไม่ได้ตั้ง —</div>}
              {down.map(l => renderRow(l, 'down'))}

              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', margin: '12px 0 2px' }}>⬅️ รับของมาจาก ({up.length})</div>
              {up.length === 0 && <div style={{ fontSize: 11, color: 'var(--muted)', padding: '4px 0' }}>— ยังไม่ได้ตั้ง —</div>}
              {up.map(l => renderRow(l, 'up'))}

              {canEdit && !form && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={() => setForm({ dir: 'down', other: '', buffer_label: '', buffer_qty: '' })}
                    style={btnSt}>➕ ป้อนให้ไลน์…</button>
                  <button onClick={() => setForm({ dir: 'up', other: '', buffer_label: '', buffer_qty: '' })}
                    style={btnSt}>➕ รับของจากไลน์…</button>
                </div>
              )}

              {canEdit && form && (
                <div style={{ marginTop: 12, padding: 10, background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, display: 'grid', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>
                    {form.dir === 'down' ? `${lineName} ➡️ ป้อนให้` : `⬅️ รับของจาก … ➡️ ${lineName}`}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ไลน์
                      <select value={form.other} onChange={e => setForm({ ...form, other: e.target.value })} style={{ marginTop: 3 }}>
                        <option value="">— เลือกไลน์ —</option>
                        {leafOpts.length > 0 && (
                          <optgroup label="⭐ ไลน์ผลิต (งานเกิดที่นี่จริง)">
                            {leafOpts.map(n => <option key={n} value={n}>{n}</option>)}
                          </optgroup>
                        )}
                        {parentOpts.length > 0 && (
                          <optgroup label="⚠️ ระดับแผนก (มีไลน์ย่อย — ปกติไม่ควรเลือก)">
                            {parentOpts.map(n => <option key={n} value={n}>{n}</option>)}
                          </optgroup>
                        )}
                      </select>
                    </label>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ชื่อจุดพัก (ถ้ามี)
                      <input value={form.buffer_label} onChange={e => setForm({ ...form, buffer_label: e.target.value })}
                        placeholder="เช่น ชั้นพัก HDF-Laser" style={{ marginTop: 3 }} />
                    </label>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>buffer (ชิ้น)
                      <input type="number" min="0" value={form.buffer_qty} onChange={e => setForm({ ...form, buffer_qty: e.target.value })}
                        placeholder="ไม่รู้ = เว้นว่าง" style={{ marginTop: 3 }} />
                    </label>
                  </div>
                  {(childrenOf[form.other] || []).length > 0 && (
                    /* เตือน ไม่บล็อก — แต่ต้องบอกผลที่ตามมา + เสนอไลน์ย่อยให้กดได้เลย (ห้ามเป็นทางตัน) */
                    <div style={{ fontSize: 11, color: '#f59e0b', lineHeight: 1.7, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 7, padding: '7px 9px' }}>
                      <b>⚠ {form.other} เป็นระดับแผนก ไม่ใช่ไลน์ผลิต</b> — งานจริงเกิดที่ไลน์ย่อย
                      และไลน์แม่ไม่มีสินค้า/CT ของตัวเอง ⇒ ระบบจะประเมิน <b>“กันได้กี่นาที”</b> ให้เส้นนี้ไม่ได้เลย
                      <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        <span style={{ color: 'var(--muted)' }}>เลือกไลน์ย่อยแทน:</span>
                        {(childrenOf[form.other] || []).map(k => (
                          <button key={k} type="button" onClick={() => setForm({ ...form, other: k })}
                            style={{ ...btnSt, padding: '3px 9px', fontSize: 11 }}>{k}</button>
                        ))}
                      </div>
                      <div style={{ marginTop: 4, color: 'var(--muted)' }}>
                        ป้อนให้หลายไลน์ = บันทึกทีละเส้น (เช่น LASER ➡️ Line 60 แล้วเพิ่ม LASER ➡️ Line 61 อีกเส้น)
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button onClick={() => setForm(null)} style={btnSt}>ยกเลิก</button>
                    <button onClick={save} disabled={saving}
                      style={{ ...btnSt, background: 'var(--accent)', color: '#08130a', border: 'none', fontWeight: 800, opacity: saving ? 0.6 : 1 }}>
                      {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

const btnSt = {
  padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)',
  background: 'var(--bg2)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
};
