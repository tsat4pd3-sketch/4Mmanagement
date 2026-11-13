/* ═══ 📋 งานที่ไลน์เปิดอยู่ — ของที่สโตร์ต้องเตรียมล่วงหน้า (แท็บใน /heijunka บอร์ดสโตร์ · 2026-11-04 · คำสั่ง user)

   ไลน์เปิดใบผลิต (`prod_orders.status='open'`) ⇒ สโตร์เห็นทันทีว่าต้องเตรียมชิ้นส่วนอะไร กี่ชิ้น ส่งไลน์ไหน
   (เดิมระบบรู้ตอนปิดใบเท่านั้น = ผลิตจบแล้ว) · กฎคำนวณ = `src/utils/openOrderDemand.js` ห้ามคิดเองในไฟล์นี้
   🔴 อ่านอย่างเดียว — ไม่ออกใบเบิก/ใบขอซื้อ (ตอนปิดใบ trigger `fn_explode_child_demand` ยังทำเหมือนเดิม) */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { supabaseDR } from '../supabaseClient';
import { loadProductsMaster } from '../utils/useProducts';
import { fetchAllPages, fetchByIds } from '../utils/fetchByIds';
import { SESSION_STATUSES_LIVE } from '../utils/sessionStatus';
import { openOrderDemand } from '../utils/openOrderDemand';
import { normSearch } from '../utils/thaiText';
import MatLabel from './MatLabel';

import { tr } from '../utils/i18n';
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-sm)' };
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const STORE_LOC = 'STORE';

export default function OpenOrderDemandPanel({ q = '' }) {
  const [data, setData] = useState(null);
  const [storeQty, setStoreQty] = useState(new Map());
  const [loadErr, setLoadErr] = useState([]);
  const [busy, setBusy] = useState(true);
  const reqRef = useRef(0);   // กันผลรอบเก่าทับรอบใหม่ (กดรีเฟรชซ้อน / ปิดแท็บระหว่างโหลด)

  const load = useCallback(async () => {
    const my = ++reqRef.current;
    setBusy(true);
    const errs = [];
    const [ordRes, prods] = await Promise.all([
      fetchAllPages(() => supabaseDR.from('prod_orders')
        .select('id, mat_no, qty, prod_no, opened_at, production_sessions!inner(line_name, status)')
        .eq('status', 'open').in('production_sessions.status', SESSION_STATUSES_LIVE)),
      loadProductsMaster().catch(() => null),
    ]);
    if (ordRes.error || ordRes.truncated) errs.push('ใบผลิตที่เปิดอยู่');
    if (!prods) errs.push('ทะเบียนสินค้า');
    const orders = (ordRes.rows || []).map(o => ({ ...o, line_name: o.production_sessions?.line_name || '' }));
    const products = prods || [];
    const fgMats = new Set(orders.map(o => String(o.mat_no || '').trim()));
    const fgIds = products.filter(p => fgMats.has(String(p.mat_no || '').trim()) && p.is_active !== false).map(p => p.id);
    const bomRes = fgIds.length
      ? await fetchByIds(fgIds, ids => supabaseDR.from('bom_items')
          .select('id, product_id, mat_no, part_name, qty_per_unit, uom, is_active').in('product_id', ids).eq('is_active', true))
      : { rows: [] };
    if (bomRes.error || bomRes.truncated) errs.push('BOM');
    const childMats = [...new Set((bomRes.rows || []).map(b => String(b.mat_no || '').trim()).filter(Boolean))];
    const stkRes = childMats.length
      ? await fetchByIds(childMats, ms => supabaseDR.from('line_stock_summary')
          .select('line_name, mat_no, qty_on_hand').in('mat_no', ms), { orderBy: 'mat_no' })
      : { rows: [] };
    if (stkRes.error || stkRes.truncated) errs.push('ยอดสต็อก');
    if (my !== reqRef.current) return;
    const stock = new Map();
    for (const s of stkRes.rows || []) stock.set(`${s.line_name}\u0001${s.mat_no}`, Number(s.qty_on_hand));
    const sq = new Map();
    for (const s of stkRes.rows || []) if (s.line_name === STORE_LOC) sq.set(s.mat_no, Number(s.qty_on_hand));
    setStoreQty(sq);
    setData(openOrderDemand({
      orders, products, bom: bomRes.rows || [],
      stockAt: (l, m) => (stock.has(`${l}\u0001${m}`) ? stock.get(`${l}\u0001${m}`) : null),
    }));
    setLoadErr(errs);
    setBusy(false);
  }, []);

  useEffect(() => { load(); return () => { reqRef.current += 1; }; }, [load]);

  const groups = useMemo(() => {
    if (!data) return [];
    const needle = normSearch(q);
    const m = new Map();
    for (const r of data.rows) {
      if (needle && !normSearch(`${r.line_name} ${r.part_name} ${r.mat_no} ${r.orders.map(o => `${o.prod_no} ${o.fg_mat}`).join(' ')}`).includes(needle)) continue;
      if (!m.has(r.line_name)) m.set(r.line_name, []);
      m.get(r.line_name).push(r);
    }
    return [...m.entries()];
  }, [data, q]);
  const shown = groups.reduce((a, [, rs]) => a + rs.length, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...card, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.65, flex: '1 1 420px' }}>
          📋 <b style={{ color: 'var(--text)' }}>{tr('ไลน์เปิดใบผลิตแล้ว → ชิ้นส่วนที่ต้องเตรียมส่ง')}</b> (คิดจาก BOM ชั้นแรกของใบ · ยอดใบ × จำนวนต่อชิ้น)
          <br />“ต้องส่งเพิ่ม” = ความต้องการ − ยอดคงเหลือหน้าไลน์ · <b>{tr('จอนี้แจ้งล่วงหน้าอย่างเดียว')}</b> ไม่ออกใบเบิก/ใบขอซื้อ —
          ตอนไลน์ปิดใบ ระบบตัดสต็อกและออกใบตามเดิม
        </div>
        <button onClick={load} disabled={busy} style={{ padding: '7px 14px', borderRadius: 'var(--r-md)', cursor: busy ? 'wait' : 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)', background: 'var(--bg2)', color: 'var(--text2)', border: '1px solid var(--border)' }}>
          {busy ? tr('⏳ กำลังโหลด…') : tr('🔄 รีเฟรช')}
        </button>
      </div>

      {loadErr.length > 0 && (
        <div style={{ ...card, padding: '10px 14px', borderColor: 'var(--red)', color: 'var(--red)', fontSize: 12, fontWeight: 700 }}>
          ⚠ โหลดไม่ครบ: {loadErr.join(' · ')} — ตัวเลขข้างล่างอาจไม่ครบ (กดรีเฟรช)
        </div>
      )}
      {data && (data.noProduct.length > 0 || data.noBom.length > 0 || data.opOrders > 0) && (
        <div style={{ fontSize: 11.5, color: 'var(--amber)', lineHeight: 1.7 }}>
          {data.noBom.length > 0 && <div>{tr('⚠️ ใบที่เปิดอยู่แต่')}<b>{tr('ไม่มี BOM')}</b> {data.noBom.length} {tr('พาร์ท — สโตร์ไม่รู้ว่าต้องเตรียมอะไร:')} {data.noBom.join(', ')}</div>}
          {data.noProduct.length > 0 && <div>{tr('⚠️ ใบที่ MAT')} <b>{tr('ไม่อยู่ในทะเบียนสินค้า')}</b> {data.noProduct.length} {tr('พาร์ท:')} {data.noProduct.join(', ')}</div>}
          {data.opOrders > 0 && <div style={{ color: 'var(--muted)' }}>{tr('ไม่นับใบชั้น OP')} {data.opOrders} {tr('ใบ (ไม่ระเบิด BOM เหมือนตอนปิดใบ)')}</div>}
        </div>
      )}

      {busy && !data ? (
        <div style={{ ...card, padding: '30px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{tr('กำลังรวบรวม…')}</div>
      ) : !data ? null : data.rows.length === 0 ? (
        <div style={{ ...card, padding: '30px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{tr('ตอนนี้ไม่มีใบผลิตที่เปิดอยู่ที่ต้องใช้ชิ้นส่วน')}</div>
      ) : shown === 0 ? (
        <div style={{ ...card, padding: '30px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{tr('ไม่มีรายการที่ตรงกับคำค้น “')}{q}{tr('” (ซ่อน')} {data.rows.length} รายการ)</div>
      ) : (<>
        {shown < data.rows.length && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tr('ซ่อนอยู่ · ไม่ตรงคำค้น')} {data.rows.length - shown} {tr('รายการ')}</div>}
        {groups.map(([line, rs]) => (
          <div key={line} style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', fontWeight: 800, fontSize: 14 }}>
              {line || '(ไม่ระบุไลน์)'} <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)' }}>· {rs.length} {tr('ชิ้นส่วน')}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {[['ชิ้นส่วน', 'left'], ['ต้องใช้', 'right'], ['หน้าไลน์มี', 'right'], ['ต้องส่งเพิ่ม', 'right'], ['STORE มี', 'right'], ['จากใบผลิต', 'left']].map(([h, al]) => (
                      <th key={h} style={{ padding: '8px 14px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: al, whiteSpace: 'nowrap' }}>{tr(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rs.map(r => {
                    const st = storeQty.has(r.mat_no) ? storeQty.get(r.mat_no) : null;
                    const lack = r.shortAtLine ?? r.need;
                    const storeShort = st != null && lack > 0 && st < lack;
                    const td = { padding: '9px 14px', borderTop: '1px solid var(--border)', fontSize: 13, textAlign: 'right', whiteSpace: 'nowrap' };
                    return (
                      <tr key={r.mat_no}>
                        <td style={{ ...td, textAlign: 'left', maxWidth: 340, whiteSpace: 'normal' }}>
                          <MatLabel mat={r.mat_no} name={r.part_name} size={13} />
                          {r.uomConflict && <div style={{ fontSize: 11, color: 'var(--red)' }}>{tr('⚠ หน่วยใน BOM ไม่ตรงกัน — ตัวเลขรวมอาจผิด')}</div>}
                        </td>
                        <td style={td}>{fmt(r.need)} <span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.uom}</span></td>
                        <td style={td}>{r.atLine == null ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>{tr('ไม่มียอด')}</span> : fmt(r.atLine)}</td>
                        <td style={{ ...td, fontWeight: 800, color: lack > 0 ? 'var(--amber)' : 'var(--green)' }}>
                          {lack > 0 ? fmt(lack) : '✅ พอ'}
                          {r.shortAtLine == null && <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>{tr('(ไม่รู้ยอดหน้าไลน์ — แสดงเต็มจำนวน)')}</div>}
                        </td>
                        <td style={{ ...td, color: storeShort ? 'var(--red)' : 'var(--text)', fontWeight: storeShort ? 800 : 400 }}>
                          {st == null ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>{tr('ไม่มียอด')}</span> : fmt(st)}
                          {storeShort && <div style={{ fontSize: 11 }}>{tr('ไม่พอส่ง')}</div>}
                        </td>
                        <td style={{ ...td, textAlign: 'left', fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'normal' }}>
                          {r.orders.map(o => `${o.prod_no || '—'} (${o.fg_mat} × ${fmt(o.qty)})`).join(' · ')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </>)}
    </div>
  );
}
