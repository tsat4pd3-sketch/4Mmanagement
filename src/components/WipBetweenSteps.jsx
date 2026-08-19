import { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import { can } from '../utils/permissions';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { buildWipChains, computeChainWip, netRequirement } from '../utils/wipChain';

/* ═══ 📦 WIP ระหว่างขั้น (เฟส 1 · 2026-08-18) — แท็บใน /line-stock ═══
   ยอดค้างทุก buffer ของสาย OP คำนวณจากใบผลิตที่บันทึกอยู่แล้ว (Σขั้น − Σปลายทาง)
   หน้างานไม่ต้องคีย์รับ-จ่าย · บัญชีภายในแผนก ไม่เกี่ยว SAP/สต็อกทางการ
   baseline "นับจริง" เก็บที่ wip_adjustments (DR · migration 20260818) — best-effort:
   ยังไม่ apply = แผงทำงานได้ (นับจากใบทั้งหมด) แค่ปุ่มนับจริงบันทึกไม่ได้ + แจ้งบนจอ
   ═══════════════════════════════════════════════════════════════════════════ */

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' };
const chip = (bg, color) => ({ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: bg, color, fontWeight: 700, whiteSpace: 'nowrap' });

export default function WipBetweenSteps() {
  const { role, fullName, lineId, sections } = useContext(UserContext);
  const canAdjust = can('wip', 'adjust', role);
  const [loading, setLoading] = useState(true);
  const [chains, setChains] = useState([]);
  const [orders, setOrders] = useState([]);
  const [baselines, setBaselines] = useState({});
  const [baselineTableMissing, setBaselineTableMissing] = useState(false);
  const [prodLines, setProdLines] = useState([]);
  const [counting, setCounting] = useState(null);   // { bufferKey, label } — modal นับจริง
  const [countQty, setCountQty] = useState('');
  const [countNote, setCountNote] = useState('');
  const [saving, setSaving] = useState(false);
  // ── เฟส 2: net requirement ──
  const [fgStock, setFgStock] = useState({});       // parentMat → qty_on_hand รวมทุกคลัง
  const [pendingOrders, setPendingOrders] = useState({}); // parentMat → Σ order ค้างส่ง (default ของ demand)
  const [demand, setDemand] = useState({});         // parentMat → ค่าที่ user แก้ (string) · undefined = ใช้ default

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: prods, error: pErr }, { data: pm }, { data: lns }] = await Promise.all([
        supabaseDR.from('dr_products')
          .select('mat_no, name, line_name, is_active, is_operation, op_parent_mat, op_seq'),
        supabaseDR.from('parts_master').select('mat_no, part_name').eq('is_active', true),
        supabase.from('production_lines').select('id, name, section, parent_line_name'),
      ]);
      if (pErr) throw pErr;
      setProdLines(lns || []);
      const regNames = {};
      (pm || []).forEach(p => { if (p.mat_no) regNames[p.mat_no] = p.part_name; });
      const ch = buildWipChains(prods || [], regNames);
      setChains(ch);

      // ใบผลิตของทุก mat ในสาย (ขั้น + ปลายทาง) — แบ่งหน้าทีละ 1000 (FG มีเป็นพันใบ)
      const mats = [...new Set(ch.flatMap(c => [c.parentMat, ...c.steps.map(s => s.mat)]))];
      const all = [];
      if (mats.length) {
        for (let fromIdx = 0; ; fromIdx += 1000) {
          const { data, error } = await supabaseDR.from('prod_orders')
            .select('mat_no, status, qty, qty_ok, qty_actual, opened_at, production_sessions!inner(line_name)')
            .in('mat_no', mats).range(fromIdx, fromIdx + 999);
          if (error) throw error;
          (data || []).forEach(o => all.push({ ...o, line_name: o.production_sessions?.line_name }));
          if (!data || data.length < 1000) break;
        }
      }
      setOrders(all);

      // เฟส 2: สต็อก FG คงเหลือ + ออเดอร์ค้างส่งของพาร์ทปลายทาง (default ของช่องความต้องการ)
      const parentMats = ch.map(c => c.parentMat);
      if (parentMats.length) {
        const [{ data: stk }, { data: ords }] = await Promise.all([
          supabaseDR.from('line_stock_summary').select('mat_no, qty_on_hand').in('mat_no', parentMats),
          supabaseDR.from('customer_shipping_orders').select('mat_no, qty').in('mat_no', parentMats).neq('status', 'shipped'),
        ]);
        const fs = {};
        (stk || []).forEach(r => { fs[r.mat_no] = (fs[r.mat_no] || 0) + Number(r.qty_on_hand || 0); });
        setFgStock(fs);
        const po = {};
        (ords || []).forEach(o => { po[o.mat_no] = (po[o.mat_no] || 0) + Number(o.qty || 0); });
        setPendingOrders(po);
      }

      // baseline นับจริงล่าสุดต่อ buffer_key (best-effort — ตารางยังไม่มี = ว่าง + banner)
      const { data: adj, error: aErr } = await supabaseDR.from('wip_adjustments')
        .select('buffer_key, counted_qty, counted_at').order('counted_at', { ascending: false }).limit(500);
      if (aErr) {
        setBaselineTableMissing(true);
        setBaselines({});
      } else {
        setBaselineTableMissing(false);
        const b = {};
        (adj || []).forEach(a => {
          if (!b[a.buffer_key]) b[a.buffer_key] = { qty: Number(a.counted_qty), ts: Date.parse(a.counted_at) };
        });
        setBaselines(b);
      }
    } catch (e) {
      toast.error('โหลดข้อมูล WIP ไม่สำเร็จ: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // scope มาตรฐาน: leader = family ไลน์ตัวเอง · role อื่นตาม sections — สายโผล่ถ้ามี node ใดอยู่ใน scope
  const scopedChains = useMemo(() => {
    const secOf = {}; prodLines.forEach(l => { secOf[l.name] = l.section; });
    const inScope = (lineName) => {
      if (!lineName) return true;
      if (role === 'leader' && lineId) {
        const fam = getLineFamilyNames(prodLines, prodLines.find(l => l.id === lineId)?.name);
        return fam.length ? fam.includes(lineName) : true;
      }
      if (sections?.length) {
        const s = (secOf[lineName] || '').trim().toLowerCase();
        return !s || sections.some(x => (x || '').trim().toLowerCase() === s);
      }
      return true;
    };
    return chains.filter(c => inScope(c.parentLine) || c.steps.some(s => inScope(s.line)));
  }, [chains, prodLines, role, lineId, sections]);

  const saveCount = async () => {
    const qty = Number(countQty);
    if (!(qty >= 0)) { toast.error('กรอกจำนวนที่นับได้จริง (0 ขึ้นไป)'); return; }
    setSaving(true);
    try {
      const { error } = await supabaseDR.from('wip_adjustments').insert({
        buffer_key: counting.bufferKey, counted_qty: qty,
        note: countNote.trim() || null, updated_by_name: fullName || null,
      });
      if (error) throw error;
      toast.success(`บันทึกยอดนับจริง ${counting.label} = ${qty} แล้ว — ระบบนับต่อจากจุดนี้`);
      setCounting(null); setCountQty(''); setCountNote('');
      load();
    } catch (e) {
      toast.error(String(e.message || '').includes('wip_adjustments')
        ? 'ยังไม่ได้ apply migration 20260818_wip_adjustments_dr — แจ้ง admin แล้วค่อยนับจริงได้'
        : 'บันทึกไม่สำเร็จ: ' + (e.message || e));
    } finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังคำนวณ WIP จากใบผลิต…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...card, background: 'rgba(14,165,233,0.06)', borderColor: 'rgba(14,165,233,0.3)', fontSize: 12.5, lineHeight: 1.7 }}>
        <b style={{ color: '#0ea5e9' }}>📦 ยอดค้างระหว่างขั้น (คำนวณอัตโนมัติจากใบผลิต — ไม่ต้องคีย์รับ-จ่าย)</b><br />
        ค้าง = ยอดสะสมที่ผ่านขั้นนั้น − ยอดปลายทางที่ประกอบ/ผลิตแล้ว (ทุกชิ้น 1:1 กับปลายทาง) ·
        เป็นบัญชี<b>ภายในแผนก</b>ไว้ดูจังหวะงาน ไม่เกี่ยว SAP/สต็อกทางการ ·
        ของเสียระหว่างทางทำตัวเลขคลาดได้ → กด <b>📋 นับจริง</b> เพื่อตั้งต้นใหม่เป็นระยะ
        {baselineTableMissing && (
          <div style={{ marginTop: 6, color: '#f59e0b', fontWeight: 700 }}>
            ⚠ ยังไม่ได้ apply migration <code>20260818_wip_adjustments_dr</code> (DR) — ตัวเลขคิดจากใบผลิตทั้งหมดตั้งแต่เริ่มระบบ และปุ่มนับจริงยังบันทึกไม่ได้
          </div>
        )}
      </div>

      {scopedChains.length === 0 && (
        <div style={{ ...card, color: 'var(--muted)', fontSize: 13 }}>
          ยังไม่มีสาย OP ที่ผูกพาร์ทจริง — ไปติ๊ก 🔩 รายการขั้นตอน + เลือก "เป็นขั้นของพาร์ทจริง" ที่ Product Master ก่อน แผงนี้จะขึ้นให้เอง
        </div>
      )}

      {scopedChains.map(chainView => {
        const { parentCum, rows } = computeChainWip(chainView, orders, baselines);
        const pm = chainView.parentMat;
        const demandVal = demand[pm] !== undefined ? demand[pm] : String(pendingOrders[pm] || '');
        const fgOnHand = fgStock[pm] || 0;
        const net = chainView.parentIsProduced && Number(demandVal) > 0
          ? netRequirement(Number(demandVal), fgOnHand, rows) : null;
        return (
          <div key={pm} style={card}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <b style={{ fontSize: 14 }}>🎯 {pm}</b>
              <span style={{ color: 'var(--text2)', fontSize: 12.5 }}>{chainView.parentName || ''}</span>
              {chainView.parentLine && <span style={chip('rgba(61,214,92,0.1)', 'var(--accent)')}>🏭 {chainView.parentLine}</span>}
              {chainView.parentIsProduced
                ? <span style={chip('rgba(61,214,92,0.1)', 'var(--accent)')}>ปลายทางผลิตสะสม {parentCum.toLocaleString()}</span>
                : <span style={chip('rgba(107,114,128,0.1)', 'var(--muted)')} title="parent เป็นพาร์ทซื้อนอก/ยังไม่มีใบผลิต — แสดงเฉพาะยอดสะสมของขั้น">ปลายทางไม่มีใบผลิต</span>}
            </div>
            {/* เฟส 2 — ความต้องการ → ต้องผลิต FG เพิ่มเท่าไหร่ (ทดสต็อก FG ให้) */}
            {chainView.parentIsProduced && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg2)', fontSize: 12.5 }}>
                <label style={{ fontWeight: 700 }}>📥 ความต้องการ (ชิ้น)</label>
                <input type="number" min="0" value={demandVal}
                  onChange={e => setDemand(d => ({ ...d, [pm]: e.target.value }))}
                  placeholder="0" style={{ width: 110, padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontWeight: 700 }} />
                {pendingOrders[pm] > 0 && demand[pm] === undefined && (
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>← ออเดอร์ค้างส่งของเลขนี้ (แก้ทับได้)</span>
                )}
                <span style={{ color: 'var(--muted)' }}>− สต็อก FG {fgOnHand.toLocaleString()}</span>
                {net ? (
                  <span style={chip(net.fgNeed > 0 ? 'rgba(245,158,11,0.12)' : 'rgba(61,214,92,0.12)', net.fgNeed > 0 ? '#f59e0b' : 'var(--accent)')}>
                    {net.fgNeed > 0 ? `→ ต้องผลิต FG อีก ${net.fgNeed.toLocaleString()}` : '→ สต็อก FG พอแล้ว ✓'}
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>กรอกความต้องการ → เห็นเลยว่าแต่ละขั้นต้องทำเพิ่มเท่าไหร่</span>
                )}
              </div>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'left' }}>
                    <th style={{ padding: '4px 8px' }}>ขั้น (OP)</th>
                    <th style={{ padding: '4px 8px' }}>สถานี · สะสม</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right' }}>ผ่านขั้นนี้แล้ว ยังไม่ถึงปลายทาง</th>
                    {net && <th style={{ padding: '4px 8px', textAlign: 'right' }}>ต้องทำเพิ่ม</th>}
                    <th style={{ padding: '4px 8px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.mat} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '7px 8px' }}>
                        <b style={{ fontFamily: 'monospace' }}>{r.mat}</b>
                        {r.seq != null && <span style={{ ...chip('rgba(14,165,233,0.1)', '#0ea5e9'), marginLeft: 6 }}>OP {r.seq}</span>}
                        <div style={{ color: 'var(--muted)', fontSize: 11 }}>{r.name}</div>
                      </td>
                      <td style={{ padding: '7px 8px' }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          {r.stations.map((s, i) => (
                            <span key={s.line} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {i > 0 && <span style={{ color: 'var(--muted)' }}>→</span>}
                              <span style={chip('var(--bg2)', 'var(--text)')}>{s.line} · {s.cum.toLocaleString()}</span>
                            </span>
                          ))}
                          {r.stations.length === 0 && <span style={{ color: 'var(--muted)', fontSize: 11 }}>ยังไม่มีใบผลิต</span>}
                        </div>
                        {r.between.map(b => (
                          <div key={b.from + b.to} style={{ fontSize: 11, marginTop: 3, color: b.qty < 0 ? '#f59e0b' : 'var(--text2)' }}>
                            ↳ ค้างระหว่าง {b.from} → {b.to}: <b>{b.qty.toLocaleString()}</b>
                            {b.qty < 0 && ' ⚠ ติดลบ — ลำดับสถานี/ของเสียยังไม่ถูกปรับ'}
                          </div>
                        ))}
                        {r.stations.length > 1 && (
                          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>เรียงตามยอดสะสม (ต้นทางมาก่อน)</div>
                        )}
                      </td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {chainView.parentIsProduced ? (
                          <b style={{ fontSize: 15, color: r.inFlight < 0 ? '#f59e0b' : r.inFlight > 0 ? 'var(--accent)' : 'var(--muted)' }}>
                            {r.inFlight.toLocaleString()}
                          </b>
                        ) : (
                          <b style={{ fontSize: 15 }}>{r.stepThrough.toLocaleString()} <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>สะสม</span></b>
                        )}
                        {r.inFlight < 0 && chainView.parentIsProduced && (
                          <div style={{ fontSize: 10.5, color: '#f59e0b' }}>⚠ ติดลบ — กดนับจริงเพื่อตั้งต้นใหม่</div>
                        )}
                        {r.baseline && (
                          <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                            นับจริงล่าสุด {r.baseline.qty.toLocaleString()} · {new Date(r.baseline.ts).toLocaleDateString('th-TH')}
                          </div>
                        )}
                      </td>
                      {net && (
                        <td style={{ padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {net.perStep[r.mat] > 0
                            ? <b style={{ fontSize: 15, color: '#f59e0b' }}>{net.perStep[r.mat].toLocaleString()}</b>
                            : <span style={chip('rgba(61,214,92,0.12)', 'var(--accent)')}>พอแล้ว ✓</span>}
                        </td>
                      )}
                      <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                        {canAdjust && (
                          <button onClick={() => { setCounting({ bufferKey: r.mat, label: `${r.mat}` }); setCountQty(''); setCountNote(''); }}
                            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', cursor: 'pointer' }}>
                            📋 นับจริง
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {counting && (
        <div onClick={() => !saving && setCounting(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ ...card, width: 'min(92vw, 420px)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <b>📋 นับจริง — {counting.label}</b>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
              กรอก<b>จำนวนที่นับได้จริงตอนนี้</b> (ของที่ผ่านขั้นนี้แล้วและยังไม่ถึงปลายทาง) — ระบบจะตั้งต้นจากเลขนี้แล้วนับใบผลิตต่อให้เอง
            </div>
            <input type="number" min="0" autoFocus value={countQty} onChange={e => setCountQty(e.target.value)}
              placeholder="จำนวนที่นับได้ (ชิ้น)" style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14 }} />
            <input value={countNote} onChange={e => setCountNote(e.target.value)}
              placeholder="หมายเหตุ (ถ้ามี)" style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button disabled={saving} onClick={() => setCounting(null)}
                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}>ยกเลิก</button>
              <button disabled={saving} onClick={saveCount}
                style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'กำลังบันทึก…' : '💾 บันทึกยอดนับจริง'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
