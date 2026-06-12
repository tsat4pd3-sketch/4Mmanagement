import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from '../components/Toast';

/* ─── HEIJUNKA KANBAN — Subcomponent Part Demand ──────────────────────────
   แตกความต้องการพาร์ทย่อยจากแผนผลิตรายวัน (production_sessions + prod_orders)
   ผ่าน BOM (bom_items) → Store เห็นว่าแต่ละไลน์/กะ ต้องใช้พาร์ทอะไร เท่าไหร่
   และคิดเป็นกี่ Kanban (จาก kanban_standards.qty_per_kanban) */

function getWorkDate() {
  const now = new Date();
  const h = now.getHours();
  if (h < 8) now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const card = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: 16,
};
const chip = (bg, color) => ({
  display: 'inline-block', fontSize: 10, fontWeight: 800, padding: '2px 8px',
  borderRadius: 10, background: bg, color, whiteSpace: 'nowrap',
});

const SHIFT_LABEL = { day: '☀️ กะเช้า', night: '🌙 กะดึก' };

export default function HeijunkaKanban() {
  const [workDate, setWorkDate]   = useState(getWorkDate());
  const [shiftFilter, setShiftFilter] = useState('all');     // all | day | night
  const [loading, setLoading]     = useState(false);
  const [sessions, setSessions]   = useState([]);
  const [demands, setDemands]     = useState([]);            // { session_id, product, qty } — demand ระดับ parent
  const [bomMap, setBomMap]       = useState({});            // product_id → [bom_items]
  const [kanbanStd, setKanbanStd] = useState({});            // child mat_no → qty_per_kanban

  /* ── load & explode ── */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 1) sessions ของวันนั้น
      const { data: sess, error: e1 } = await supabaseDR.from('production_sessions')
        .select('id, line_name, shift, status, product_id, dr_products(id, name, mat_no)')
        .eq('work_date', workDate)
        .order('line_name');
      if (e1) throw e1;
      setSessions(sess || []);
      if (!sess?.length) { setDemands([]); setBomMap({}); setLoading(false); return; }
      const sessIds = sess.map(s => s.id);

      // 2) แผนผลิต: prod_orders + kanban_targets ของ sessions เหล่านี้
      const [{ data: orders }, { data: targets }, { data: products }] = await Promise.all([
        supabaseDR.from('prod_orders').select('session_id, mat_no, part_name, qty, status').in('session_id', sessIds),
        supabaseDR.from('kanban_targets').select('session_id, mat_no, part_name, qty_target').in('session_id', sessIds),
        supabaseDR.from('dr_products').select('id, name, mat_no').eq('is_active', true),
      ]);
      const prodByMat = {};
      (products || []).forEach(p => { if (p.mat_no) prodByMat[p.mat_no] = p; });

      // demand ระดับ parent ต่อ session: ใช้ prod_orders ก่อน, session ไหนไม่มี order → fallback kanban_targets
      const sessionsWithOrders = new Set((orders || []).map(o => o.session_id));
      const dem = [];
      (orders || []).forEach(o => {
        if (!o.qty) return;
        dem.push({ session_id: o.session_id, mat_no: o.mat_no, part_name: o.part_name, qty: o.qty, product: prodByMat[o.mat_no] || null });
      });
      (targets || []).forEach(t => {
        if (sessionsWithOrders.has(t.session_id) || !t.qty_target) return;
        dem.push({ session_id: t.session_id, mat_no: t.mat_no, part_name: t.part_name, qty: t.qty_target, product: prodByMat[t.mat_no] || null });
      });
      setDemands(dem);

      // 3) BOM ของ product ที่เกี่ยวข้อง + kanban standards ของพาร์ทย่อย
      const productIds = [...new Set(dem.map(d => d.product?.id).filter(Boolean))];
      if (productIds.length === 0) { setBomMap({}); setLoading(false); return; }
      const { data: boms } = await supabaseDR.from('bom_items')
        .select('*').in('product_id', productIds).eq('is_active', true);
      const bm = {};
      (boms || []).forEach(b => { (bm[b.product_id] = bm[b.product_id] || []).push(b); });
      setBomMap(bm);

      const childMats = [...new Set((boms || []).map(b => b.mat_no))];
      if (childMats.length) {
        const { data: stds } = await supabaseDR.from('kanban_standards')
          .select('mat_no, qty_per_kanban').in('mat_no', childMats).eq('is_active', true);
        const ks = {};
        (stds || []).forEach(s => { ks[s.mat_no] = s.qty_per_kanban; });
        setKanbanStd(ks);
      } else setKanbanStd({});
    } catch (err) {
      toast.error('โหลดข้อมูลไม่สำเร็จ: ' + err.message);
    }
    setLoading(false);
  }, [workDate]);

  useEffect(() => { load(); }, [load]);

  /* ── explode เป็น demand พาร์ทย่อย ── */
  const view = useMemo(() => {
    const sessById = Object.fromEntries(sessions.map(s => [s.id, s]));
    const visibleSessions = sessions.filter(s => shiftFilter === 'all' || s.shift === shiftFilter);
    const visibleIds = new Set(visibleSessions.map(s => s.id));

    // columns = ไลน์·กะ ที่มี demand
    const cols = visibleSessions.map(s => ({ id: s.id, line: s.line_name, shift: s.shift, status: s.status }));

    // rows: child mat_no → { part_name, uom, perCol: {session_id: qty}, total, noBomParents }
    const rows = {};
    const noBom = new Map();   // parent ที่ยังไม่มี BOM → demand รวม
    demands.forEach(d => {
      if (!visibleIds.has(d.session_id)) return;
      const bomItems = d.product ? bomMap[d.product.id] : null;
      if (!bomItems?.length) {
        const key = d.mat_no || d.part_name;
        noBom.set(key, { name: d.part_name || d.mat_no, mat_no: d.mat_no, qty: (noBom.get(key)?.qty || 0) + d.qty });
        return;
      }
      bomItems.forEach(b => {
        const r = rows[b.mat_no] = rows[b.mat_no] || { mat_no: b.mat_no, part_name: b.part_name, uom: b.uom, supplier: b.supplier, perCol: {}, total: 0 };
        const need = d.qty * Number(b.qty_per_unit);
        r.perCol[d.session_id] = (r.perCol[d.session_id] || 0) + need;
        r.total += need;
      });
    });

    const rowList = Object.values(rows).sort((a, b) => a.mat_no.localeCompare(b.mat_no));
    const totalKanban = rowList.reduce((s, r) => {
      const per = kanbanStd[r.mat_no];
      return s + (per ? Math.ceil(r.total / per) : 0);
    }, 0);
    return { cols, rowList, noBom: [...noBom.values()], sessById, totalKanban };
  }, [sessions, demands, bomMap, kanbanStd, shiftFilter]);

  const fmt = (n) => Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  /* ── CSV export ── */
  const exportCSV = () => {
    if (!view.rowList.length) { toast.info('ไม่มีข้อมูลให้ export'); return; }
    const head = ['Mat No.', 'Part Name', 'UOM', 'Supplier', ...view.cols.map(c => `${c.line} (${c.shift})`), 'Total', 'Qty/Kanban', 'Kanban'];
    const lines = view.rowList.map(r => {
      const per = kanbanStd[r.mat_no];
      return [r.mat_no, `"${r.part_name}"`, r.uom, r.supplier || '', ...view.cols.map(c => r.perCol[c.id] || 0), r.total, per || '', per ? Math.ceil(r.total / per) : ''].join(',');
    });
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `heijunka_kanban_${workDate}${shiftFilter !== 'all' ? '_' + shiftFilter : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div style={{ padding: 'clamp(12px, 2vw, 24px)', maxWidth: 1500, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 'clamp(18px, 2.5vw, 24px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
            🎴 Heijunka Kanban — Subcomponent Demand
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            ความต้องการพาร์ทย่อยตามแผนผลิตวันนี้ · แตกจาก BOM ของแต่ละ product
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} style={{
            padding: '8px 10px', borderRadius: 8, fontSize: 13, background: 'var(--bg2)',
            border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--font-body)',
          }} />
          {['all', 'day', 'night'].map(s => (
            <button key={s} onClick={() => setShiftFilter(s)} style={{
              padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)',
              background: shiftFilter === s ? 'var(--accent)' : 'var(--bg2)',
              color: shiftFilter === s ? '#08130a' : 'var(--text2)',
              border: `1px solid ${shiftFilter === s ? 'var(--accent)' : 'var(--border)'}`,
            }}>{s === 'all' ? 'ทุกกะ' : SHIFT_LABEL[s]}</button>
          ))}
          <button onClick={exportCSV} style={{
            padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
            background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--font-body)',
          }}>⬇ CSV</button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'ไลน์ที่มีแผนผลิต', value: view.cols.length, icon: '🏭' },
          { label: 'พาร์ทย่อยที่ต้องใช้', value: view.rowList.length, icon: '🔩' },
          { label: 'รวม Kanban ที่ต้องเตรียม', value: view.totalKanban, icon: '🎴' },
          { label: 'Product ไม่มี BOM', value: view.noBom.length, icon: '⚠️', warn: view.noBom.length > 0 },
        ].map(c => (
          <div key={c.label} style={{ ...card, padding: '12px 16px', borderColor: c.warn ? 'rgba(245,158,11,0.4)' : 'var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{c.icon} {c.label}</div>
            <div style={{ fontSize: 26, fontWeight: 900, fontFamily: 'var(--font-display)', color: c.warn ? '#f59e0b' : 'var(--text)', marginTop: 2 }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* No-BOM warning */}
      {view.noBom.length > 0 && (
        <div style={{ ...card, borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.05)', marginBottom: 16, padding: '12px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b', marginBottom: 6 }}>⚠️ มีแผนผลิตที่ยังแตกพาร์ทย่อยไม่ได้ — product เหล่านี้ยังไม่มี BOM</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {view.noBom.map(p => (
              <span key={p.mat_no || p.name} style={chip('rgba(245,158,11,0.12)', '#f59e0b')}>
                {p.name} · แผน {fmt(p.qty)} ชิ้น
              </span>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>→ ไปเพิ่ม BOM ที่หน้า 📦 BOM ก่อน แล้วข้อมูลจะแตกให้อัตโนมัติ</div>
        </div>
      )}

      {/* Demand board */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>กำลังโหลด...</div>
        ) : view.cols.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ไม่มีกะ/แผนผลิตในวันที่ {workDate}</div>
        ) : view.rowList.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            ยังไม่มี demand พาร์ทย่อย — ตรวจว่าไลน์เปิด order แล้ว และ product มี BOM
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr style={{ background: 'var(--bg2)' }}>
                  <th style={{ padding: '10px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1 }}>พาร์ทย่อย</th>
                  {view.cols.map(c => (
                    <th key={c.id} style={{ padding: '10px 12px', fontSize: 11, fontWeight: 800, color: 'var(--text2)', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {c.line}<br />
                      <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>{SHIFT_LABEL[c.shift] || c.shift}</span>
                    </th>
                  ))}
                  <th style={{ padding: '10px 12px', fontSize: 11, fontWeight: 800, color: 'var(--accent)', textAlign: 'right' }}>รวม</th>
                  <th style={{ padding: '10px 12px', fontSize: 11, fontWeight: 800, color: '#f59e0b', textAlign: 'right' }}>🎴 KANBAN</th>
                </tr>
              </thead>
              <tbody>
                {view.rowList.map(r => {
                  const per = kanbanStd[r.mat_no];
                  return (
                    <tr key={r.mat_no}>
                      <td style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace' }}>{r.mat_no}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.part_name}{r.supplier ? ` · ${r.supplier}` : ''}</div>
                      </td>
                      {view.cols.map(c => (
                        <td key={c.id} style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', textAlign: 'center', fontSize: 13, color: r.perCol[c.id] ? 'var(--text)' : 'var(--muted)', fontWeight: r.perCol[c.id] ? 700 : 400 }}>
                          {r.perCol[c.id] ? fmt(r.perCol[c.id]) : '—'}
                        </td>
                      ))}
                      <td style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', textAlign: 'right', fontSize: 14, fontWeight: 900, color: 'var(--accent)' }}>
                        {fmt(r.total)} <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>{r.uom}</span>
                      </td>
                      <td style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                        {per
                          ? <span style={chip('rgba(245,158,11,0.12)', '#f59e0b')}>{Math.ceil(r.total / per)} ใบ × {per}</span>
                          : <span style={{ fontSize: 10, color: 'var(--muted)' }}>ไม่มี std</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
