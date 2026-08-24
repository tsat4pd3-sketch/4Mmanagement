import { useState, useEffect, useCallback, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import PageHeader from '../components/PageHeader';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { usePolling } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import { loadDivisions, divisionsSync, divisionMeta } from '../utils/orgDivisions';

/* ══ 🔗 Flow Control Tower — สายธารของ "ความต้องการ" ตั้งแต่ลูกค้าถึงวัตถุดิบ ═══════════
   ตอบคำถามเดียว: **ความต้องการของลูกค้าไหลย้อนกลับไปถึงต้นน้ำครบหรือยัง ตันตรงไหน**

   หลักการ (ห้ามแหก):
   • **อ่านอย่างเดียว** — ยกเว้นปุ่มเดียวคือ "ตั้ง lot" ที่แก้จุดตันโดยตรง (ให้คนกดยืนยันเอง)
   • **ห้ามเดาสถานะ** — 3 สถานะแยกกันคนละความหมาย ห้ามยุบ:
       ✅ ไหลจริง   = มีรายการเคลื่อนไหวในช่วงที่ดู
       🔴 ตัน       = มีความต้องการค้างอยู่ แต่ไม่มีอะไรไหลออก  ← ต้องแก้
       ⚪ ยังไม่ใช้ = ไม่มีทั้งความต้องการและการเคลื่อนไหว = แผนกยังไม่เริ่มใช้ (ไม่ใช่ bug)
     โปรเจคนี้เป็น prototype ที่ทยอยขยายผลรายแผนก — เหมา "ไม่มีข้อมูล" เป็น "พัง" คือการอ่านผิด
   • **จัดกลุ่มตามฝ่ายจริง** — ชื่อฝ่ายอ่านจาก `org_nodes` (kind='division') **ห้าม hardcode**
   • ⚠️ **การสั่งซื้อวัตถุดิบ/พาร์ทที่ใช้ผลิต เป็นงานของ Planning (ฝ่าย Logistic & Sales)**
     ไม่ใช่ 'ส่วนจัดซื้อ' ในผัง — ส่วนจัดซื้อ (ฝ่ายสนับสนุนกลาง) ทำแค่หา supplier + ซื้อของใช้ทั่วไป
     (user ยืนยัน 2026-08-19) → คิวใบสั่งซื้อวัตถุดิบจึง **อยู่ในขอบเขต** และมีเจ้าภาพคือ Planning
   • เปิดหลายจอพร้อมกันได้ — realtime บน prod_orders/sessions ทำให้ทุกจอขยับพร้อมกันตอนเดโม
   ═════════════════════════════════════════════════════════════════════════════════════════ */

/* ── ฝ่าย: **ชื่อ/ไอคอน/สี มาจากผังองค์กร (ตาราง `org_divisions` + ป้าย `org_nodes.division`)** ──
   ห้าม hardcode ชื่อฝ่ายในไฟล์นี้ — อ้างด้วย `code` แล้วดึงชื่อผ่าน `src/utils/orgDivisions.js`
   ⚠️ ผังไม่มี "ฝ่าย" เป็น node โดยตั้งใจ (ดูคำเตือนใน orgDivisions.js) — เป็นป้ายที่ node ระดับบนสุด
   แก้ชื่อ/สีฝ่ายที่ `/org-setup` แล้วหน้านี้ตามทันที */

const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
function getWorkDate() {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* สถานะข้อต่อ — ห้ามยุบ 3 อย่างนี้เป็นอย่างเดียว (ดูหัวไฟล์) */
const ST = {
  flow:  { dot: '#22c55e', label: 'ไหลจริง',   bg: 'rgba(34,197,94,0.10)' },
  block: { dot: '#ef4444', label: 'ตัน',       bg: 'rgba(239,68,68,0.10)' },
  idle:  { dot: '#64748b', label: 'ยังไม่ใช้', bg: 'rgba(100,116,139,0.10)' },
  human: { dot: '#f59e0b', label: 'ส่งต่อด้วยคน', bg: 'rgba(245,158,11,0.10)' },
};

export default function FlowTower() {
  const { role, sections } = useContext(UserContext);
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [divs, setDivs] = useState([]);   // เก็บไว้ trigger re-render หลัง cache ฝ่ายโหลดเสร็จ
  const canFix = can('products', 'edit', role);
  const workDate = getWorkDate();

  const load = useCallback(async () => {
    try {
      // ห้าม toISOString (UTC) — ใช้วันที่เครื่อง (local) แบบเดียวกับ getWorkDate ในไฟล์นี้
  const sinceD = new Date(); sinceD.setDate(sinceD.getDate() - 7);
  const since = `${sinceD.getFullYear()}-${String(sinceD.getMonth() + 1).padStart(2, '0')}-${String(sinceD.getDate()).padStart(2, '0')}`;
      const [stock, ordersOpen, prodToday, childLots, rawReq, purch, blocks, wipPts, wipReq, fcast] = await Promise.all([
        supabaseDR.from('line_stock_summary').select('line_name, mat_no, qty_on_hand'),
        supabaseDR.from('customer_shipping_orders').select('qty, status').neq('status', 'shipped'),
        supabaseDR.from('production_sessions').select('id, line_name, status').eq('work_date', workDate),
        supabaseDR.from('child_lot_requests').select('status, lot_qty, source_line'),
        supabaseDR.from('raw_withdrawal_requests').select('id, status'),
        supabaseDR.from('purchase_requests').select('status, qty'),
        supabaseDR.from('v_demand_flow_blocks').select('*').order('pending_qty', { ascending: false }),
        supabase.from('wip_buffer_points').select('id'),
        supabase.from('wip_replenish_requests').select('id, status'),
        supabaseDR.from('customer_forecasts').select('qty').gte('period_month', since),
      ]);
      // ⚠️ view/ตารางไหนโหลดไม่ได้ ต้องบอก ห้ามโชว์ 0 (0 = "มี 0 รายการ" คนละเรื่องกับ "อ่านไม่ได้")
      const bad = [['สต๊อก', stock], ['ออเดอร์', ordersOpen], ['ใบผลิต', prodToday],
                   ['ใบสั่งผลิตลูก', childLots], ['จุดที่ตัน', blocks]].filter(([, r]) => r.error);
      setErr(bad.length ? `โหลดไม่ได้: ${bad.map(([n]) => n).join(', ')}` : '');

      const S = stock.data || [];
      const byPrefix = (p) => S.filter(r => String(r.mat_no || '').startsWith(p));
      const sum = (rows) => rows.reduce((a, r) => a + (Number(r.qty_on_hand) || 0), 0);
      const orders = ordersOpen.data || [];
      const lots = childLots.data || [];
      const lotBy = (st) => lots.filter(l => l.status === st);

      // ยอดผลิตวันนี้ (ใบที่ปิดแล้ว + ยอดสะสมของใบที่ยังเปิด) — สูตรบังคับของระบบ
      const sids = (prodToday.data || []).map(s => s.id);
      let po = [];
      if (sids.length) {
        const r = await supabaseDR.from('prod_orders')
          .select('status, qty, qty_ok, qty_actual').in('session_id', sids).order('id');
        po = r.data || [];
      }
      const producedToday = po.reduce((a, o) =>
        a + (o.status === 'confirmed' ? Number(o.qty_ok ?? o.qty ?? 0) : Number(o.qty_actual ?? 0)), 0);

      setD({
        fgStock: sum(byPrefix('1')), fgParts: byPrefix('1').length,
        subStock: sum(byPrefix('2')), subParts: byPrefix('2').length,
        rawStock: sum(byPrefix('3')) + sum(byPrefix('5')),
        rawParts: byPrefix('3').length + byPrefix('5').length,
        orderCnt: orders.length, orderQty: orders.reduce((a, o) => a + (Number(o.qty) || 0), 0),
        fcastQty: (fcast.data || []).reduce((a, f) => a + (Number(f.qty) || 0), 0),
        sessOpen: (prodToday.data || []).filter(s => s.status === 'open').length,
        sessAll: (prodToday.data || []).length,
        producedToday, orderRows: po.length,
        lotPending: lotBy('pending').length, lotDoing: lotBy('producing').length, lotDone: lotBy('done').length,
        lotRouted: lots.filter(l => (l.source_line || '').trim()).length, lotAll: lots.length,
        rawPending: (rawReq.data || []).filter(r => r.status !== 'done').length, rawAll: (rawReq.data || []).length,
        purchPending: (purch.data || []).filter(p => p.status === 'pending').length,
        wipPts: (wipPts.data || []).length, wipReq: (wipReq.data || []).length,
        blocks: blocks.data || [],
        blockQty: (blocks.data || []).reduce((a, b) => a + (Number(b.pending_qty) || 0), 0),
      });
    } catch (e) { setErr(String(e.message || e)); }
  }, [workDate]);

  useEffect(() => { loadDivisions().then(setDivs); }, []);
  useEffect(() => { load(); }, [load]);
  usePolling(load, RATE.ANALYTIC);
  // เปิดหลายจอพร้อมกัน → จอทุกใบขยับพร้อมกันตอนมีคนปิดใบผลิตอีกจอหนึ่ง
  useEffect(() => {
    const ch = supabaseDR.channel('flow-tower')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prod_orders' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_sessions' }, load)
      .subscribe();
    return () => { supabaseDR.removeChannel(ch); };
  }, [load]);

  const setLot = async (row) => {
    const v = Number(row.suggested_lot);
    if (!(v > 0)) { toast.error('ยังไม่มีค่าบรรจุต่อกล่องให้ใช้เป็นค่าเริ่มต้น — ตั้งเองที่ Product Master'); return; }
    if (!window.confirm(`ตั้งขนาดล็อตของ ${row.mat_no} = ${fmt(v)} ชิ้น (1 กล่อง)?\n\nความต้องการที่ค้างอยู่ ${fmt(row.pending_qty)} ชิ้น จะถูกแปลงเป็นใบสั่งในรอบผลิตถัดไป`)) return;
    setBusy(row.mat_no);
    const { data, error } = await supabaseDR.from('kanban_standards')
      .update({ lot_size: v }).eq('mat_no', row.mat_no).eq('is_active', true).select('mat_no');
    setBusy('');
    if (error) { toast.error(error.message); return; }
    // ⚠️ RLS/เงื่อนไขไม่ตรง = สำเร็จ 0 แถว ไม่ error — ต้องนับแถวก่อนบอกว่าสำเร็จ
    if (!data?.length) { toast.error('ไม่มีแถวถูกแก้ — ตรวจว่าพาร์ทนี้ยังเปิดใช้งานอยู่'); return; }
    toast.success(`ตั้งล็อต ${row.mat_no} = ${fmt(v)} ชิ้นแล้ว`);
    load();
  };

  /* ── สถานี: 1 ใบ = 1 ช่วงของสายธาร ── */
  const S = d || {};
  const stations = [
    { key: 'sales', divCode: 'logistic', icon: '🛒', name: 'ลูกค้า / Sales',
      lines: [[`${fmt(S.orderCnt)} รอบ`, 'ออเดอร์ค้างส่ง'], [fmt(S.orderQty), 'ชิ้นที่ต้องส่ง']],
      to: '/customer-demand', st: S.orderCnt > 0 ? 'flow' : 'idle' },
    { key: 'fgwh', divCode: 'logistic', icon: '🏬', name: 'คลัง FG',
      lines: [[fmt(S.fgStock), 'ชิ้นคงเหลือ'], [`${fmt(S.fgParts)} พาร์ท`, 'ในคลัง']],
      to: '/line-stock', st: S.fgStock > 0 ? 'flow' : 'idle' },
    { key: 'prod', divCode: 'production', icon: '🏭', name: 'ผลิต FG',
      lines: [[fmt(S.producedToday), 'ชิ้นวันนี้'], [`${fmt(S.sessAll)} กะ`, `เปิดอยู่ ${fmt(S.sessOpen)}`]],
      to: '/daily-report', st: S.producedToday > 0 ? 'flow' : 'idle' },
    { key: 'wip', divCode: 'production', icon: '🔄', name: 'WIP หน้าไลน์',
      lines: [[`${fmt(S.wipPts)} จุด`, 'buffer ที่ตั้งไว้'], [`${fmt(S.wipReq)} ใบ`, 'ใบเติมของ']],
      to: '/linesetup', st: S.wipReq > 0 ? 'flow' : 'idle' },
    { key: 'store', divCode: 'logistic', icon: '📦', name: 'สโตร์พาร์ทย่อย',
      lines: [[fmt(S.subStock), 'ชิ้นคงเหลือ'], [`${fmt(S.subParts)} พาร์ท`, 'ในสโตร์']],
      to: '/line-stock', st: S.subStock > 0 ? 'flow' : 'idle' },
    { key: 'press', divCode: 'production', icon: '🔨', name: 'ผลิตพาร์ทย่อย (ปั๊ม)',
      lines: [[`${fmt(S.lotPending)} ใบ`, 'รอผลิต'], [`${fmt(S.lotDoing)} ใบ`, 'กำลังผลิต']],
      to: '/heijunka', st: (S.lotPending + S.lotDoing) > 0 ? 'flow' : 'idle' },
    { key: 'raw', divCode: 'logistic', icon: '🗄️', name: 'สโตร์วัตถุดิบ / พาร์ทซื้อ',
      lines: [[fmt(S.rawStock), 'ชิ้นคงเหลือ'], [`${fmt(S.rawPending)} ใบ`, 'ใบเบิกค้าง']],
      to: '/line-stock', st: S.rawStock > 0 ? 'flow' : 'idle' },
    // ⚠️ สั่งซื้อ "วัตถุดิบ/พาร์ทที่ใช้ผลิต" = งานของ Planning (ฝ่าย Logistic & Sales)
    //    ไม่ใช่ส่วนจัดซื้อในผัง (ซึ่งดูแค่หา supplier + ของใช้ทั่วไป) — user ยืนยัน 2026-08-19
    { key: 'buy', divCode: 'logistic', icon: '🧾', name: 'สั่งซื้อวัตถุดิบ (Planning)',
      lines: [[`${fmt(S.purchPending)} ใบ`, 'ใบสั่งซื้อรอดำเนินการ'], [`${fmt(S.blocks?.length)} พาร์ท`, 'ยังออกใบไม่ได้']],
      to: '/heijunka', st: S.purchPending > 0 ? 'block' : (S.blocks?.length ? 'block' : 'idle'),
      note: 'ระบบคำนวณและออกใบให้อัตโนมัติจากการระเบิด BOM — Planning เป็นผู้ดำเนินการต่อ' },
  ];

  /* ── ข้อต่อระหว่างสถานี ── */
  const links = [
    { from: 'sales', label: 'ออเดอร์ลูกค้า', st: S.orderCnt > 0 ? 'flow' : 'idle' },
    { from: 'fgwh', label: 'สั่งผลิตเติม', st: 'human', hint: 'สแกนบัตรคัมบัง' },
    { from: 'prod', label: 'ของเข้าคลัง (อัตโนมัติ)', st: 'flow' },
    { from: 'wip', label: 'เบิกเข้าไลน์', st: S.wipReq > 0 ? 'flow' : 'idle' },
    { from: 'store', label: 'ระเบิด BOM (อัตโนมัติ)', st: 'flow' },
    { from: 'press', label: 'ใบสั่งผลิตลูก', st: S.lotAll > 0 ? 'flow' : 'idle' },
    { from: 'raw', label: 'ใบสั่งซื้อวัตถุดิบ', st: S.purchPending > 0 ? 'block' : 'idle' },
  ];

  // ฝ่ายของแต่ละสถานี — ชื่อ/สี/ไอคอนจากผังองค์กร · ไม่รู้จัก code = บอกตรงๆ ห้ามเดาชื่อ
  const divOf = (code) => {
    const m = divisionMeta(code);
    return { code, color: m?.color || '#64748b', name: m?.label || null, icon: m?.icon || '' };
  };
  const usedDivs = [...new Set(stations.map(st2 => st2.divCode))].map(divOf).filter(x => x.name);

  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12 };

  return (
    <div style={{ padding: '0 4px 40px' }}>
      <PageHeader
        title="สายธารความต้องการ (Flow Control Tower)" icon="🔗"
        sub={`ความต้องการของลูกค้าไหลย้อนไปถึงวัตถุดิบครบหรือยัง · ข้อมูลสด ${workDate}`}
        actions={<button onClick={load} style={{ ...card, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>↻ รีเฟรช</button>}
      />

      {err && (
        <div style={{ ...card, borderColor: 'rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.08)', padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#ef4444', fontWeight: 700 }}>
          ⚠️ {err}
        </div>
      )}

      {/* แถบฝ่าย — ชื่อ/cost center มาจากผังองค์กรจริง (แก้ที่ /org-setup แล้วหน้านี้ตามทันที) */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        {/* ⚠️ ยังโหลดไม่เสร็จ ≠ ยังไม่ได้ตั้ง — ห้ามขึ้นคำเตือนหลอกระหว่างรอ */}
        {divs.length === 0 ? (
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>กำลังอ่านผังองค์กร…</span>
        ) : usedDivs.length === 0 ? (
          <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>
            ⚠️ ฝ่ายที่หน้านี้อ้างถึงยังไม่มีในผังองค์กร — ตั้งที่ /org-setup แล้วชื่อฝ่ายจะขึ้นเอง
          </span>
        ) : usedDivs.map(dv => (
          <span key={dv.code} style={{ fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 20, color: dv.color, background: `${dv.color}18`, border: `1px solid ${dv.color}55` }}>
            {dv.icon} {dv.name}
          </span>
        ))}
        <button onClick={() => navigate('/org-setup')} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>
          จัดการผังองค์กร
        </button>
      </div>

      {/* ── สายธาร ── */}
      <div style={{ overflowX: 'auto', paddingBottom: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, minWidth: 1180 }}>
          {stations.map((s, i) => {
            const dv = divOf(s.divCode); const st = ST[s.st] || ST.idle;
            const lk = links[i];
            return (
              <div key={s.key} style={{ display: 'flex', alignItems: 'stretch' }}>
                <div
                  onClick={() => s.to && navigate(s.to)}
                  title={s.note || (s.to ? `เปิดหน้า ${s.to}` : '')}
                  style={{
                    ...card, width: 158, padding: '10px 12px', borderTop: `3px solid ${dv.color}`,
                    cursor: s.to ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', gap: 4,
                    opacity: 1,
                  }}>
                  <div style={{ fontSize: 20, lineHeight: 1 }}>{s.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', lineHeight: 1.25, minHeight: 30 }}>{s.name}</div>
                  {s.lines.map(([a, b], j) => (
                    <div key={j}>
                      <div style={{ fontSize: j === 0 ? 17 : 12, fontWeight: j === 0 ? 900 : 700, color: j === 0 ? 'var(--text)' : 'var(--text2)', fontFamily: 'var(--font-display)' }}>{a}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{b}</div>
                    </div>
                  ))}
                  <div style={{ marginTop: 'auto', paddingTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: st.dot }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: st.dot }}>{st.label}</span>
                  </div>
                </div>
                {lk && i < stations.length - 1 && (
                  <div style={{ width: 96, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                    <div style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.2, marginBottom: 3 }}>{lk.label}</div>
                    <div style={{ width: '100%', height: 2, background: ST[lk.st].dot, opacity: 0.75, position: 'relative' }}>
                      <span style={{ position: 'absolute', right: -1, top: -4, color: ST[lk.st].dot, fontSize: 11, lineHeight: 1 }}>▶</span>
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 800, color: ST[lk.st].dot, marginTop: 3 }}>{ST[lk.st].label}</div>
                    {lk.hint && <div style={{ fontSize: 8, color: 'var(--muted)' }}>{lk.hint}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── จุดที่ตัน ── */}
      <div style={{ ...card, padding: '14px 16px', marginBottom: 16, borderColor: (S.blocks?.length ? 'rgba(239,68,68,0.45)' : 'var(--border)') }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
            🚧 จุดที่ความต้องการค้าง ไม่กลายเป็นใบสั่ง
          </div>
          <div style={{ fontSize: 12, color: S.blocks?.length ? '#ef4444' : '#22c55e', fontWeight: 800 }}>
            {S.blocks?.length ? `${fmt(S.blocks.length)} พาร์ท · ${fmt(S.blockQty)} ชิ้น` : 'ไม่มีจุดตัน'}
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
          ระบบระเบิด BOM แล้วสะสมความต้องการไว้ แต่**ยังออกใบสั่งไม่ได้เพราะไม่ได้ตั้ง "ขนาดล็อต"** (จะสั่งครั้งละกี่ชิ้น)
          — เป็นการตัดสินใจของคน ระบบจึงไม่ตั้งให้เอง · ค่าที่เสนอ = 1 กล่องตามบรรจุจริง กดยืนยันแล้วแก้ทีหลังได้
        </div>
        {!d ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>กำลังโหลด…</div>
          : S.blocks.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>ทุกพาร์ทตั้งขนาดล็อตครบแล้ว</div>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ background: 'var(--bg2)' }}>
                    {['MAT', 'ชื่อพาร์ท', 'ค้างสะสม', 'ปลายทาง', 'ค่าที่เสนอ', ''].map((h, i) => (
                      <th key={h} style={{ padding: '7px 12px', fontSize: 10, fontWeight: 800, color: 'var(--muted)', textAlign: i === 2 || i === 4 ? 'right' : 'left', whiteSpace: 'nowrap', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {S.blocks.slice(0, 12).map(b => (
                      <tr key={b.mat_no} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '7px 12px', fontWeight: 800, color: 'var(--accent)' }}>{b.mat_no}</td>
                        <td style={{ padding: '7px 12px', color: 'var(--text2)' }}>{b.part_name || '—'}</td>
                        <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 800, color: '#ef4444' }}>{fmt(b.pending_qty)}</td>
                        <td style={{ padding: '7px 12px', fontSize: 11, color: 'var(--muted)' }}>
                          {b.demand_kind === 'purchase' ? '🚛 สั่งซื้อ' : `🔨 ผลิตเอง${b.maker_line ? ` · ${b.maker_line}` : ''}`}
                        </td>
                        <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 700 }}>{b.suggested_lot ? fmt(b.suggested_lot) : '—'}</td>
                        <td style={{ padding: '7px 12px' }}>
                          {canFix && b.suggested_lot > 0 && (
                            <button onClick={() => setLot(b)} disabled={busy === b.mat_no}
                              style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(34,197,94,0.5)', background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontWeight: 800, fontSize: 11, cursor: busy ? 'wait' : 'pointer', fontFamily: 'var(--font-body)' }}>
                              {busy === b.mat_no ? '…' : '✓ ตั้งล็อต'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {S.blocks.length > 12 && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>…และอีก {S.blocks.length - 12} พาร์ท</div>}
                {!canFix && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>ดูอย่างเดียว — การตั้งขนาดล็อตต้องมีสิทธิ์แก้ข้อมูลสินค้า</div>}
              </div>
            )}
      </div>

      {/* ── ตารางข้อต่อ: ใช้เล่าตอนนำเสนอ ── */}
      <div style={{ ...card, padding: '14px 16px' }}>
        <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 10, fontFamily: 'var(--font-display)' }}>🔍 ข้อต่อของสายข้อมูล — ใครส่งให้ใคร ด้วยกลไกอะไร</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: 'var(--bg2)' }}>
              {['ช่วง', 'กลไก', 'สถานะ', 'หลักฐานจากข้อมูลจริง'].map(h => (
                <th key={h} style={{ padding: '7px 12px', fontSize: 10, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {[
                ['Sales → คลัง FG', 'ออเดอร์ EDI 862 + forecast 830', S.orderCnt > 0 ? 'flow' : 'idle', `ออเดอร์ค้างส่ง ${fmt(S.orderCnt)} รอบ · ${fmt(S.orderQty)} ชิ้น`],
                ['คลัง FG → ผลิต FG', 'สแกนบัตรคัมบังเปิดใบผลิต (คนเป็นคนตัดสิน)', 'human', 'ระบบยังไม่แปลงออเดอร์เป็นคำสั่งผลิตอัตโนมัติ'],
                ['ผลิต FG → คลัง FG', 'ปิดใบผลิต → เข้าคลังอัตโนมัติ (trigger)', 'flow', `วันนี้ผลิต ${fmt(S.producedToday)} ชิ้น จาก ${fmt(S.orderRows)} ใบ`],
                ['ผลิต FG → สโตร์ย่อย', 'ระเบิด BOM + หักมินิสโตร์ (trigger)', 'flow', `สโตร์ย่อยคงเหลือ ${fmt(S.subStock)} ชิ้น`],
                ['สโตร์ย่อย → ไลน์ปั๊ม', 'ใบสั่งผลิตลูกตามขนาดล็อต', S.lotAll > 0 ? 'flow' : 'idle', `${fmt(S.lotAll)} ใบ · รู้ไลน์ปลายทางแล้ว ${fmt(S.lotRouted)} ใบ`],
                ['ไลน์ปั๊ม → สโตร์วัตถุดิบ', 'ใบเบิกวัตถุดิบตามสูตรของพาร์ทลูก', S.rawAll > 0 ? 'flow' : 'idle', `ใบเบิก ${fmt(S.rawAll)} ใบ · ค้าง ${fmt(S.rawPending)}`],
                ['→ สั่งซื้อวัตถุดิบ (Planning)', 'ระเบิด BOM → ออกใบสั่งซื้ออัตโนมัติ', S.purchPending > 0 ? 'block' : 'idle', `ออกใบให้แล้ว ${fmt(S.purchPending)} ใบรอดำเนินการ · อีก ${fmt(S.blocks?.length)} พาร์ทออกใบไม่ได้เพราะยังไม่ตั้งขนาดล็อต`],
                ['WIP หน้าไลน์', 'ใบเติมของจากจุด buffer', S.wipReq > 0 ? 'flow' : 'idle', `ตั้งจุดไว้ ${fmt(S.wipPts)} จุด · ใบเติม ${fmt(S.wipReq)} ใบ (ยังไม่เริ่มใช้)`],
              ].map(([seg, mech, st, ev]) => (
                <tr key={seg} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 800, whiteSpace: 'nowrap' }}>{seg}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--text2)' }}>{mech}</td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: ST[st].dot, background: ST[st].bg, padding: '3px 9px', borderRadius: 20 }}>● {ST[st].label}</span>
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--muted)', fontSize: 11 }}>{ev}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
          <b>⚪ ยังไม่ใช้</b> = แผนกนั้นยังไม่เริ่มทดลองใช้ (โปรเจคทยอยขยายผลรายแผนก) — <b>ไม่ใช่ระบบพัง</b> ·
          <b style={{ color: '#ef4444' }}> 🔴 ตัน</b> = มีความต้องการค้างจริงแต่ไม่ไหลออก ต้องแก้ ·
          <b style={{ color: '#f59e0b' }}> 🟠 ส่งต่อด้วยคน</b> = ยังไม่มีเส้นข้อมูลอัตโนมัติ ใช้คนตัดสินใจแทน
        </div>
      </div>
    </div>
  );
}
