import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { can } from '../utils/permissions';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { fetchByIds } from '../utils/fetchByIds';
import ReadOnlyNote from './ReadOnlyNote';

/**
 * 🔩 คิวสั่งผลิตจากสโตร์ — แผงบนหน้า Daily Report ของ "ไลน์ที่ต้องปั๊มพาร์ทลูก"
 *
 * ที่มา (คำถามหน้างาน 2026-08-25 · "ไลน์ Stamping รับคำสั่งผลิตจากสโตร์ยังไง"):
 *   ระบบออกใบสั่งผลิตพาร์ทลูกให้อยู่แล้ว (`child_lot_requests` จากทริกเกอร์ fn_explode_child_demand
 *   ตอนปิดใบผลิต FG) พร้อมใบเบิกวัตถุดิบ (`raw_withdrawal_requests`)
 *   **แต่คิวนี้โผล่แค่ที่ `/heijunka` ซึ่งอยู่หมวด Logistic - Store** — ไลน์ปั๊มทำงานอยู่หน้า
 *   `/daily-report` ทั้งกะ จึงไม่เคยเห็นว่าสโตร์สั่งอะไรไว้ ⇒ การสื่อสารจริงเกิดนอกระบบ
 *   (ข้อมูลตอน audit 19/08: ใบสั่งผลิตลูกออกไป 54 ใบ · ใบเบิกวัตถุดิบ 3 ใบ)
 *
 * ⚠️ กฎเหล็กของแผงนี้ — ห้ามใส่ปุ่ม "✔ ผลิตเสร็จ"
 *   การปิดล็อตที่ `/heijunka` **เขียนสต็อกจริง** (`line_stock_transactions` type `issue`
 *   เข้าชื่อไลน์ปั๊ม + `consume` วัตถุดิบตามใบเบิก) ขณะที่การสแกนปิดใบบนหน้านี้ก็เขียนสต็อกอยู่แล้ว
 *   ผ่าน `fn_post_confirmed_output` (พาร์ทเบอร์ 2 → คลัง `STORE`)
 *   ⇒ 2 ทางนี้ **ยังไม่รู้จักกัน** (ไม่มีคอลัมน์ผูก `child_lot_requests` ↔ `prod_orders`)
 *      กดทั้งคู่สำหรับของก้อนเดียวกัน = สต็อกโผล่ 2 ที่คนละชื่อ
 *   จึงให้ที่นี่ทำได้แค่ **"▶ รับงาน"** (pending → producing · ไม่แตะสต็อกเลย)
 *   ส่วนการปิดล็อตยังอยู่ที่บอร์ดสโตร์ที่เดียว — และต้องเขียนบอกบนจอว่าทำไม (ห้ามให้ปุ่มหายเงียบ)
 *
 * ⚠️ "ปั๊มไปแล้วเท่าไหร่" เป็น **ตัวช่วยตัดสินใจ ไม่ใช่การผูกใบ**
 *   นับจากใบผลิตจริงของไลน์ในครอบครัว ตั้งแต่ใบสั่งเก่าสุดถูกออก — ระบบไม่สรุปเองว่าล็อตไหนเสร็จ
 *   (ไม่มีข้อมูลว่าใบผลิตใบไหนทำเพื่อล็อตไหน — เดาแล้วปิดล็อตผิดใบย้อนยาก)
 */

const norm = (s) => (s ?? '').toString().trim().toLowerCase();
const fmt  = (n) => (Number(n) || 0).toLocaleString();

const LOT_META = {
  pending:   { label: '🆕 รอผลิต',    color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)' },
  producing: { label: '🔧 กำลังผลิต', color: '#0ea5e9', bg: 'rgba(14,165,233,0.12)', border: 'rgba(14,165,233,0.35)' },
};

export default function StoreLotQueue({ lineName, lines = [], role }) {
  const [lots,    setLots]    = useState([]);
  const [raws,    setRaws]    = useState([]);
  const [made,    setMade]    = useState({});
  const [blocks,  setBlocks]  = useState([]);
  const [err,     setErr]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(null);
  const [open,    setOpen]    = useState(true);

  const canOperate = can('heijunka', 'operate', role);

  // ครอบครัวไลน์ — ⚠️ lines ยังโหลดไม่เสร็จ ห้ามได้ set ว่าง (จะกลายเป็น "ไม่มีคิว" ทั้งที่มี)
  //    ถอยไปใช้ชื่อไลน์ตัวเองแทน = แคบลงแต่ไม่โกหก
  const famSet = useMemo(() => {
    const names = getLineFamilyNames(lines, lineName);
    return new Set((names.length ? names : [lineName]).map(norm).filter(Boolean));
  }, [lines, lineName]);

  const load = useCallback(async () => {
    if (!lineName) return;
    setLoading(true); setErr(null);
    try {
      // 1) คิวใบสั่งที่ยังไม่ปิด — ทั้งระบบมีหลักสิบแถว ดึงมาแล้วกรองครอบครัวไลน์ฝั่ง client
      //    (`source_line` เป็น text snapshot — `.in()` ตรงตัวพลาดง่ายเมื่อชื่อไลน์เคยถูกแก้)
      //    ⚠️ ต้องตัด `cancelled` ด้วย — ใบยกเลิกไม่ใช่งานค้าง (25/08 มี 100 ใบจากบั๊กหน่วย lot_size)
      //    ปล่อยไว้ = ไลน์ปั๊มเห็นคิวปลอมเต็มจอ (บั๊กเดียวกับที่เพิ่งแก้ที่บอร์ดสโตร์)
      const { data: lotRows, error: e1 } = await supabaseDR.from('child_lot_requests')
        .select('*').not('status', 'in', '("done","cancelled")').order('created_at', { ascending: true }).limit(500);
      if (e1) throw e1;
      const mine = (lotRows || []).filter(l => famSet.has(norm(l.source_line)));
      mine.sort((a, b) => {
        const sa = a.seq_no == null ? Infinity : a.seq_no, sb = b.seq_no == null ? Infinity : b.seq_no;
        if (sa !== sb) return sa - sb;
        return new Date(a.created_at) - new Date(b.created_at);
      });
      setLots(mine);

      // 2) สถานะวัตถุดิบของแต่ละล็อต (เหล็กจ่ายมาหรือยัง)
      let rawRows = [];
      if (mine.length) {
        const r = await fetchByIds(mine.map(l => l.id),
          ids => supabaseDR.from('raw_withdrawal_requests').select('*').in('lot_request_id', ids));
        if (r.error) throw new Error(r.error);
        rawRows = r.rows;
      }
      setRaws(rawRows);

      // 3) ยอดที่ไลน์ปั๊มไปแล้ว (ตัวช่วย ไม่ใช่การผูกใบ)
      //    ⚠️ prod_orders ไม่มีคอลัมน์ line_name/work_date — ต้อง embed production_sessions
      const madeMap = {};
      if (mine.length) {
        const mats  = [...new Set(mine.map(l => l.child_mat_no).filter(Boolean))];
        const since = mine.reduce((m, l) => (!m || l.created_at < m ? l.created_at : m), null);
        const { data: po, error: e3 } = await supabaseDR.from('prod_orders')
          .select('mat_no, qty, qty_ok, qty_actual, status, opened_at, production_sessions!inner(line_name)')
          .in('mat_no', mats).gte('opened_at', since).limit(1000);
        if (e3) throw e3;
        for (const o of po || []) {
          if (!famSet.has(norm(o.production_sessions?.line_name))) continue;
          // สูตรบังคับของโปรเจค: ปิดใบแล้ว = ยอดดี · ยังเปิด = ยอดสะสมที่กรอกไว้
          const q = o.status === 'confirmed' ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0);
          madeMap[o.mat_no] = (madeMap[o.mat_no] || 0) + (Number(q) || 0);
        }
      }
      setMade(madeMap);

      // 4) ความต้องการที่ "ออกใบสั่งไม่ได้" เพราะยังไม่ได้ตั้งขนาดล็อต — ห้ามเงียบ
      const { data: bl, error: e4 } = await supabaseDR.from('v_demand_flow_blocks').select('*');
      if (e4) throw e4;
      setBlocks((bl || []).filter(b => famSet.has(norm(b.maker_line))));
    } catch (e) {
      setErr(e?.message || String(e));
    }
    setLoading(false);
  }, [lineName, famSet]);

  useEffect(() => { load(); }, [load]);

  const rawByLot = useMemo(() => {
    const m = {};
    raws.forEach(r => { (m[r.lot_request_id] = m[r.lot_request_id] || []).push(r); });
    return m;
  }, [raws]);

  // ยอดที่สั่งค้างรวมต่อ mat — ใช้เทียบกับที่ปั๊มไปแล้ว
  const orderedByMat = useMemo(() => {
    const m = {};
    lots.forEach(l => { m[l.child_mat_no] = (m[l.child_mat_no] || 0) + (Number(l.lot_qty) || 0); });
    return m;
  }, [lots]);

  const takeLot = async (lot) => {
    setBusy(lot.id);
    try {
      // guard สองชั้น: อัปเดตเฉพาะแถวที่ยัง pending + นับแถวที่เขียนจริง
      // (RLS/แข่งกันสองเครื่อง ปฏิเสธ UPDATE แบบ "สำเร็จ 0 แถว" ไม่ error)
      const { data, error } = await supabaseDR.from('child_lot_requests')
        .update({ status: 'producing' }).eq('id', lot.id).eq('status', 'pending').select('id');
      if (error) throw error;
      if (!data?.length) toast.info('ล็อตนี้ถูกอัปเดตไปแล้วจากอีกเครื่อง');
      else toast.success(`รับงาน ${lot.child_mat_no} แล้ว · สโตร์เห็นว่าไลน์เริ่มทำ`);
      await load();
    } catch (e) { toast.error(e.message || String(e)); }
    setBusy(null);
  };

  // ไลน์นี้ไม่มีหน้าที่ปั๊มพาร์ทลูก (ไม่มีคิว + ไม่มีของค้าง) = ไม่ต้องรกจอ
  if (loading) return null;
  if (!err && !lots.length && !blocks.length) return null;

  const totalPcs = lots.reduce((s, l) => s + (Number(l.lot_qty) || 0), 0);

  return (
    <div style={{ background: 'var(--card)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: open ? 12 : 0 }}>
        <div onClick={() => setOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#c084fc', cursor: 'pointer', userSelect: 'none' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>▶</span>
          🔩 คิวสั่งผลิตจากสโตร์ ({lots.length} ล็อต · {fmt(totalPcs)} ชิ้น)
        </div>
        <button onClick={load} title="โหลดคิวใหม่"
          style={{ background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 7, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          ↻ รีเฟรช
        </button>
      </div>

      {open && (<>
        {err && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 8, padding: '9px 12px', marginBottom: 10, fontSize: 12, lineHeight: 1.6 }}>
            ⚠️ <b>โหลดคิวไม่สำเร็จ — ตัวเลขด้านล่างอาจไม่ครบ</b>
            <div style={{ color: 'var(--text2)', marginTop: 2, fontFamily: 'monospace', fontSize: 11 }}>{err}</div>
          </div>
        )}

        <ReadOnlyNote show={!canOperate && lots.length > 0} role={role} compact
          what="กดรับงานล็อตจากสโตร์" permKey="heijunka:operate" />

        {lots.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lots.map(lot => {
              const st      = LOT_META[lot.status] || LOT_META.pending;
              const rl      = rawByLot[lot.id] || [];
              const rWait   = rl.filter(r => r.status !== 'issued');
              const days    = Math.floor((Date.now() - new Date(lot.created_at).getTime()) / 86400000);
              const madeQty = made[lot.child_mat_no] || 0;
              const ordered = orderedByMat[lot.child_mat_no] || 0;
              const enough  = ordered > 0 && madeQty >= ordered;
              return (
                <div key={lot.id} style={{ padding: '9px 12px', background: 'var(--bg2)', borderRadius: 8, borderLeft: `3px solid ${st.color}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>{lot.child_mat_no}</span>
                    <span style={{ fontSize: 12, color: 'var(--text2)', flex: 1, minWidth: 120 }}>{lot.part_name || '—'}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>{fmt(lot.lot_qty)} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>ชิ้น/ล็อต</span></span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, color: st.color, background: st.bg, border: `1px solid ${st.border}` }}>{st.label}</span>
                    {canOperate && lot.status === 'pending' && (
                      <button onClick={() => takeLot(lot)} disabled={busy === lot.id}
                        style={{ background: 'rgba(14,165,233,0.15)', color: '#0ea5e9', border: '1px solid rgba(14,165,233,0.5)', borderRadius: 7, padding: '5px 13px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>
                        {busy === lot.id ? '...' : '▶ รับงาน'}
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 5, fontSize: 11, color: 'var(--muted)' }}>
                    {/* สถานะวัตถุดิบ — สิ่งแรกที่ไลน์ต้องรู้ก่อนเริ่มปั๊ม */}
                    {rl.length === 0 ? (
                      <span>🪨 ไม่มีใบเบิกวัตถุดิบผูกไว้</span>
                    ) : rWait.length === 0 ? (
                      <span style={{ color: '#22c55e', fontWeight: 700 }}>🪨 เหล็ก/วัตถุดิบ จ่ายครบแล้ว ({rl.length} รายการ)</span>
                    ) : (
                      <span style={{ color: '#f59e0b', fontWeight: 700 }}>🪨 รอสโตร์จ่ายวัตถุดิบ {rWait.length}/{rl.length} รายการ</span>
                    )}
                    <span>· ค้างมา {days} วัน</span>
                    {lot.source_prod_no && <span>· มาจาก FG {lot.source_prod_no}</span>}
                    {/* ⚠️ ตัวช่วยตัดสินใจ ไม่ใช่การผูกใบ — เขียนกำกับให้ชัดเสมอ */}
                    <span>· ปั๊ม {lot.child_mat_no} ไปแล้ว <b style={{ color: 'var(--text2)' }}>{fmt(madeQty)}</b> ชิ้น (นับรวมทุกล็อตที่ค้าง {fmt(ordered)})</span>
                  </div>

                  {enough && (
                    <div style={{ marginTop: 5, fontSize: 11, color: '#22c55e', lineHeight: 1.55 }}>
                      ✅ ยอดที่ปั๊มไปแล้วครบตามที่สโตร์สั่ง — ถ้าล็อตนี้ทำจบจริง ให้ไปกดปิดล็อตที่บอร์ดสโตร์
                      (ระบบไม่ปิดให้เอง เพราะยังไม่รู้ว่าใบผลิตใบไหนทำเพื่อล็อตไหน)
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ความต้องการที่ค้างเพราะยังไม่ตั้งขนาดล็อต — ออกใบสั่งไม่ได้ ห้ามปล่อยเงียบ */}
        {blocks.length > 0 && (
          <div style={{ marginTop: lots.length ? 12 : 0, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b', marginBottom: 4 }}>
              ⚠️ สโตร์ต้องการของจากไลน์นี้ แต่ระบบออกใบสั่งไม่ได้ ({blocks.length} พาร์ท)
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 6 }}>
              ยังไม่ได้ตั้ง <b>ขนาดล็อต (lot size)</b> ของพาร์ทเหล่านี้ ความต้องการจึงสะสมไว้เฉยๆ ไม่กลายเป็นใบสั่ง —
              ตั้งค่าที่ <b>Product Master → 🎴 Kanban Std</b> แล้วใบสั่งจะออกเองรอบถัดไป
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {blocks.slice(0, 8).map(b => (
                <div key={b.mat_no} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11.5 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>{b.mat_no}</span>
                  <span style={{ color: 'var(--text2)', flex: 1, minWidth: 100 }}>{b.part_name || '—'}</span>
                  <span style={{ color: '#f59e0b', fontWeight: 700 }}>ค้าง {fmt(b.pending_qty)} ชิ้น</span>
                  {b.block_reason === 'backlog_capped'
                    ? <span style={{ color: '#f59e0b', fontWeight: 700 }} title="ตั้งขนาดล็อตแล้ว — ยอดเกินเพดานออกใบต่อรอบ จะทยอยออกใบเมื่อปิดใบผลิตครั้งถัดไป">⏳ รอทยอยออกใบ</span>
                    : b.suggested_lot > 0 && <span style={{ color: 'var(--muted)' }}>· เสนอล็อตละ {fmt(b.suggested_lot)}</span>}
                </div>
              ))}
              {blocks.length > 8 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>… อีก {blocks.length - 8} พาร์ท (ดูทั้งหมดที่ 🔗 สายธารความต้องการ)</div>}
            </div>
          </div>
        )}

        {/* ทำไมไม่มีปุ่ม "ผลิตเสร็จ" ที่นี่ — ซ่อนปุ่มได้ ห้ามซ่อนเหตุผล */}
        {lots.length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
            ℹ️ ที่นี่กด <b>รับงาน</b> ได้อย่างเดียว — การ <b>ปิดล็อต</b> ทำที่{' '}
            <Link to="/heijunka" style={{ color: '#c084fc', fontWeight: 700 }}>บอร์ดสโตร์ (Heijunka)</Link>{' '}
            ที่เดียว เพราะการปิดล็อตเขียนสต็อกจริง และหน้านี้ก็เขียนสต็อกอยู่แล้วตอนสแกนปิดใบ
            — กดทั้งสองที่สำหรับของก้อนเดียวกัน สต็อกจะโผล่ซ้ำสองที่
          </div>
        )}
      </>)}
    </div>
  );
}
