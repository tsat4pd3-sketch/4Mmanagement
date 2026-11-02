/* ══════════════════════════════════════════════════════════════════════════════════════
   <MachineRepairHistory machineNo> — ประวัติการซ่อมของเครื่องเดียว (2026-10-19 · MTN REQUEST)
   จอดูข้อมูลจากใบ MO ที่มีอยู่แล้ว · ⬇️ Excel ตามฟอร์มจริง **FM-MTN-005** (20/10 · user ส่งฟอร์มมา)
   ช่องไหนใส่อะไร = utils/machineHistoryForm.js · ตัววาด = lib/mtnMachineHistoryExcel.js · ทะเบียน /doc-forms `mtn_machine_history`

   · ดึงใบผ่าน RPC `mtn_orders_by_machine` — จับคู่เลขเครื่องแบบทนการสะกด (machine_key)
   · ค่าแรง/อะไหล่รายแถว + เลข PR โหลดเป็นก้อน (fetchByIds chunk) · โหลดล้ม = เขียนบนจอ ห้ามโชว์ 0
   · สรุปตัวเลขทั้งหมดอยู่ `summarizeMachineHistory()` ห้ามคิดในไฟล์นี้
   ══════════════════════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { fetchByIds } from '../utils/fetchByIds';
import { summarizeMachineHistory } from '../utils/machineRepairHistory';
import { moStatusMeta } from '../utils/mtnStepPerm';
import { fmtDateTime } from '../utils/dateFormat';
import { machineKey } from '../utils/machineNo';
import { machineHistoryRows } from '../utils/machineHistoryForm';
import { teamKeyOf, deptNameOf } from '../utils/mtnTeams';
import { toast } from './Toast';

const fmtMin = (m) => (m == null ? '—' : m >= 60 ? `${(m / 60).toFixed(1)} ชม.` : `${Math.round(m)} นาที`);
const fmtBaht = (v) => (v == null ? '—' : `${Number(v).toLocaleString('th-TH', { maximumFractionDigits: 0 })} บาท`);

function Card({ t, v, h }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t}</div>
      <div style={{ fontSize: 17, fontWeight: 800 }}>{v}</div>
      {h && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{h}</div>}
    </div>
  );
}

export default function MachineRepairHistory({ machineNo, onClose, onOpenOrder }) {
  const [state, setState] = useState({ loading: true, orders: [], prsBy: {}, laborBy: null, partsBy: null, err: null, subErr: null, machine: null, cut: false });
  const [exporting, setExporting] = useState(false);
  /* 🔴 ตารางยาวห้ามวาดทุกแถวทีเดียว (F14) — เริ่มที่ 30 แถว แล้วกด "แสดงอีก" */
  const [showAll, setShowAll] = useState(false);
  const ROWS_FIRST = 30;

  useEffect(() => {
    let alive = true;
    (async () => {
      /* 🔴 ขอ 501 เพื่อ "รู้ว่าถูกตัดไหม" — เดิมขอ 500 แล้ววาดทุกแถว ⇒ เครื่องที่มีใบเกิน 500
         จะได้สรุป (เวลาซ่อมเฉลี่ย · ค่าใช้จ่ายรวม · ปัญหาที่เจอบ่อย) **ต่ำกว่าจริงโดยไม่มีสัญญาณ**
         (ตัดเงียบ = ผิดกฎความซื่อสัตย์ของจอ · QC audit 20/10) */
      const CAP = 500;
      const { data, error } = await supabaseDR.rpc('mtn_orders_by_machine', { p_machine_no: machineNo, p_limit: CAP + 1 });
      if (!alive) return;
      if (error) { setState(s => ({ ...s, loading: false, err: error.message })); return; }
      // ด่านชั้นสอง: กรองซ้ำด้วย machineKey ตัวเดียวกับ SQL machine_key() — RPC เปลี่ยน/คืนเกิน = ใบเครื่องอื่นห้ามปนเข้าประวัติ
      const k = machineKey(machineNo);
      const all = (data || []).filter(o => machineKey(o.machine_no) === k);
      const cut = all.length > CAP;
      const orders = cut ? all.slice(0, CAP) : all;
      const ids = orders.map(o => o.id);
      const [pr, lb, pt, mc] = await Promise.all([
        fetchByIds(ids, c => supabaseDR.from('mtn_purchase_requests').select('id, order_id, pr_no, status').in('order_id', c)),
        fetchByIds(ids, c => supabaseDR.from('mtn_order_labor').select('id, order_id, rate_per_hour, hours, amount').in('order_id', c)),
        fetchByIds(ids, c => supabaseDR.from('mtn_order_parts').select('id, order_id, part_name, qty, unit, unit_price, amount').in('order_id', c)),
        // หัวฟอร์ม FM-MTN-005: M/C Name · Brand · Location (ไม่เจอ = หัวฟอร์มว่าง ไม่ล้มทั้งใบ)
        supabaseDR.from('machines').select('machine_no, machine_name, brand, line_name, machine_types(label)').eq('machine_no', machineNo).limit(1),
      ]);
      if (!alive) return;
      const group = (rows) => { const m = {}; (rows || []).forEach(r => { (m[r.order_id] || (m[r.order_id] = [])).push(r); }); return m; };
      const subErr = [pr.error && 'เลข PR', lb.error && 'ค่าแรง', pt.error && 'ค่าอะไหล่'].filter(Boolean);
      setState({
        loading: false, orders, err: null,
        prsBy: group(pr.rows),
        // โหลดค่าแรง/อะไหล่ล้ม = null ⇒ ถอยไปใช้ยอดรวมในใบ (labor_cost/parts_cost) แทนการนับเป็น 0
        laborBy: lb.error ? null : group(lb.rows),
        partsBy: pt.error ? null : group(pt.rows),
        subErr: subErr.length ? subErr.join(' · ') : null,
        machine: (mc.data || [])[0] || { machine_no: machineNo },
        cut,                        // ถูกตัดที่เพดาน = สรุปไม่ครบ ต้องเขียนบนจอ
      });
    })();
    return () => { alive = false; };
  }, [machineNo]);

  /* ── 🔧 กรองตามทีมช่าง (2026-10-24 · ทีม MTN แจ้ง) ──────────────────────────────
     *"ตัวประวัติเครื่องจักร มันดึงมาหมดเลยครับพี่ ทั้งปรับคุณภาพ ทั้งซ่อม JiG
       น่าจะต้อง Filter ในส่วนที่เป็น O-MTN มา อย่างเดียวครับผม"*
     ฟอร์มนี้คือ **FM-MTN-005 ของทีม MTN** ⇒ ค่าเริ่มต้น = เฉพาะใบทีม MTN
     🔴 **ห้ามกรองเงียบ** — ต้องเขียนบนจอว่าซ่อนไปกี่ใบ และสลับดูทีมอื่นได้ (กฎความซื่อสัตย์ของจอ)
     ⚠️ กรองที่ชั้นแสดงผล ไม่ใช่ที่คิวรี — ตัวเลือกทีมและตัวนับ "ซ่อนไป" ต้องรู้ของทั้งหมด */
  const [team, setTeam] = useState('maintenance');
  const teamsSeen = useMemo(() => {
    const seen = new Map();
    for (const o of state.orders) {
      const k = teamKeyOf(o.mtn_dept) || '';
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [state.orders]);
  const shown = useMemo(
    () => (team === 'all' ? state.orders : state.orders.filter(o => (teamKeyOf(o.mtn_dept) || '') === team)),
    [state.orders, team]);
  const hidden = state.orders.length - shown.length;

  // ⚠️ `now` จับครั้งเดียวตอนข้อมูลมาถึง (ใบที่ยังอยู่กับ supplier นับเวลาถึงตอนนั้น)
  const sum = useMemo(() => summarizeMachineHistory(shown, {
    prsBy: state.prsBy, laborBy: state.laborBy, partsBy: state.partsBy, now: Date.now(),
  }), [shown, state.prsBy, state.laborBy, state.partsBy]);

  const box = { background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 10, width: 'min(980px, 100%)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', maxHeight: '92vh' };
  const th = { textAlign: 'left', padding: '6px 8px', fontSize: 11.5, color: 'var(--muted)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--card)' };
  const td = { padding: '6px 8px', fontSize: 12, borderBottom: '1px solid var(--border)', verticalAlign: 'top' };

  return (
    /* อ่านอย่างเดียว ไม่มีฟอร์ม — แต่ปิดด้วยปุ่มเท่านั้นตามแนวของหน้าใบ MO (กันเผลอแตะแล้วหลุด) */
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 3100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>📜 ประวัติการซ่อม — <span style={{ fontFamily: 'monospace' }}>{machineNo}</span></div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              นับจากใบแจ้งซ่อม (MO) ของเครื่องนี้ · ⬇️ Excel = ฟอร์ม FM-MTN-005 (ใบตีกลับไม่ลงประวัติ)
              {sum.spellings.length > 1 && <> · ⚠ เลขเครื่องถูกพิมพ์ {sum.spellings.length} แบบ: {sum.spellings.join(' / ')} (รวมให้แล้ว)</>}
            </div>
            {/* 🔧 ตัวเลือกทีมช่าง — ค่าเริ่มต้น "ทีม MTN" เพราะฟอร์มนี้คือ FM-MTN-005 ของทีม MTN
                   🔴 ซ่อนแล้วต้องเขียนบนจอว่าซ่อนไปกี่ใบ + สลับดูได้ ห้ามกรองเงียบ */}
            {state.orders.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>ทีมช่าง:</span>
                <select value={team} onChange={e => setTeam(e.target.value)} aria-label="กรองตามทีมช่าง"
                  style={{ height: 26, fontSize: 11.5, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', padding: '0 6px' }}>
                  <option value="all">ทุกทีม ({state.orders.length} ใบ)</option>
                  {teamsSeen.map(([k, n]) => (
                    <option key={k || '_none'} value={k}>{k ? (deptNameOf(k) || k) : '— ไม่ระบุทีม —'} ({n} ใบ)</option>
                  ))}
                </select>
                {hidden > 0 && (
                  <span style={{ fontSize: 11, color: '#f59e0b' }}>
                    ⚠️ ซ่อนไป <b>{hidden}</b> ใบของทีมอื่น — สรุป/ตาราง/Excel นับเฉพาะที่เห็นอยู่
                  </span>
                )}
                {team !== 'all' && !shown.length && state.orders.length > 0 && (
                  <span style={{ fontSize: 11, color: '#f59e0b' }}>⚠️ เครื่องนี้ไม่มีใบของทีมที่เลือก — ลองเลือก "ทุกทีม"</span>
                )}
              </div>
            )}
          </div>
          <button disabled={state.loading || !!state.err || exporting} onClick={async () => {
            setExporting(true);
            try {
              const { exportMachineHistoryExcel } = await import('../lib/mtnMachineHistoryExcel');
              // ⬇️ Excel ออกตาม "ที่เห็นบนจอ" เสมอ — ไม่งั้นใบพิมพ์กับจอตอบคนละชุด
              const rows = machineHistoryRows(shown, { partsBy: state.partsBy || {}, prsBy: state.prsBy, now: Date.now() });
              const r = await exportMachineHistoryExcel({ machine: state.machine, rows });
              toast.success(`⬇️ FM-MTN-005 · ${r.rows} รายการ · ${r.pages} หน้า`);
              if (state.subErr) toast.info(`⚠ โหลด ${state.subErr} ไม่ครบ — ช่องนั้นในไฟล์อาจไม่ครบ`);
            } catch (e) { toast.error(`Export ไม่สำเร็จ: ${e?.message || e}`); }
            finally { setExporting(false); }
          }} title="ใบบันทึกประวัติการซ่อมและการทำ PM MACHINE (FM-MTN-005) — A4 แนวนอน หน้าละ 15 แถว"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: state.loading || state.err || exporting ? 0.6 : 1 }}>
            {exporting ? 'กำลังสร้าง…' : '⬇️ Excel (FM-MTN-005)'}</button>
          <button onClick={onClose} style={{ background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>✕ ปิด</button>
        </div>
        <div style={{ overflow: 'auto', padding: 14 }}>
          {state.loading && <div style={{ color: 'var(--muted)', fontSize: 13 }}>⏳ กำลังโหลดประวัติ…</div>}
          {state.err && <div style={{ color: '#ef4444', fontSize: 13 }}>⚠ โหลดประวัติไม่สำเร็จ: {state.err}</div>}
          {!state.loading && !state.err && (<>
            {state.subErr && <div style={{ color: '#f59e0b', fontSize: 12, marginBottom: 8 }}>⚠ โหลด {state.subErr} ไม่ครบ — ช่องนั้นอาจไม่ครบ (ค่าใช้จ่ายถอยไปใช้ยอดรวมในใบ)</div>}
            {/* 🔴 ถูกตัดที่เพดาน = ตัวเลขสรุปทุกการ์ดต่ำกว่าจริง ห้ามเงียบ */}
            {state.cut && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8, fontWeight: 700 }}>
              ⚠ เครื่องนี้มีใบแจ้งซ่อมเกิน 500 ใบ — แสดง/สรุปจาก <b>500 ใบล่าสุด</b> เท่านั้น
              (เวลาซ่อมเฉลี่ย · ค่าใช้จ่ายรวม · ปัญหาที่เจอบ่อย ยังไม่ครบทั้งหมด)
            </div>}
            {!sum.total && !sum.rejected && <div style={{ color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีใบแจ้งซ่อมของเครื่องนี้</div>}
            {(sum.total > 0 || sum.rejected > 0) && (<>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 10, alignContent: 'start' }}>
                <Card t="ใบแจ้งซ่อมทั้งหมด" v={`${sum.total} ใบ`} h={`${sum.open ? `ยังเปิด ${sum.open} · ` : ''}Breakdown ${sum.bm}${sum.rejected ? ` · ตีกลับ ${sum.rejected} (ไม่นับ)` : ''}`} />
                <Card t="เวลาซ่อมของช่างเฉลี่ย" v={fmtMin(sum.techMinAvg)} h={sum.techMinN ? `หารจาก ${sum.techMinN} ใบ · หักช่วงอยู่กับ supplier` : 'ยังวัดไม่ได้'} />
                <Card t="ค่าใช้จ่ายรวม" v={fmtBaht(sum.costTotal)} h={sum.costN ? `จาก ${sum.costN} ใบที่ลงเงิน` : 'ยังไม่มีใบไหนลงเงิน'} />
                <Card t="ส่งซ่อมภายนอก" v={`${sum.vendor} ใบ`} h={sum.lastAt ? `แจ้งล่าสุด ${fmtDateTime(sum.lastAt)}` : null} />
              </div>
              <div style={{ fontSize: 12, marginBottom: 10, lineHeight: 1.7 }}>
                <b>ปัญหาที่เจอบ่อย:</b> {sum.topProblems.slice(0, 6).map(p => `${p.k} (${p.n})`).join(' · ')}
                <br /><b>ประเภทงาน:</b> {sum.byType.map(p => `${p.k} (${p.n})`).join(' · ')}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                ⏱ เวลาซ่อมของช่าง ≠ เวลาเครื่องหยุด (downtime ของไลน์อยู่ที่ /mtn-analysis — นับเต็มแม้ส่งภายนอก)
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={th}>แจ้งเมื่อ</th><th style={th}>เลข MO</th><th style={th}>สถานะ</th><th style={th}>ประเภท</th>
                    <th style={th}>ปัญหา / วิธีแก้</th><th style={th}>ช่าง</th><th style={th}>PR</th>
                    <th style={th}>ซ่อมจริง</th><th style={th}>ค่าใช้จ่าย</th>
                  </tr></thead>
                  <tbody>
                    {(showAll ? sum.rows : sum.rows.slice(0, ROWS_FIRST)).map(r => {
                      const st = moStatusMeta(r.o);
                      return (
                        <tr key={r.o.id} style={{ opacity: r.o.status === 'rejected' ? 0.55 : 1 }}>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDateTime(r.at)}</td>
                          <td style={td}>
                            {onOpenOrder
                              ? <button onClick={() => onOpenOrder(r.o)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, padding: 0, textAlign: 'left' }}>{r.o.mo_no || '(ยังไม่ออกเลข)'}</button>
                              : <span style={{ fontFamily: 'monospace' }}>{r.o.mo_no || '—'}</span>}
                          </td>
                          <td style={{ ...td, color: st.color, fontWeight: 700 }}>{st.label}</td>
                          <td style={td}>{r.o.repair_type || '—'}{r.path ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.path.label}</div> : null}</td>
                          <td style={td}>
                            <div>{r.problem}</div>
                            {(r.o.root_cause || r.o.solution) && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{[r.o.root_cause && `สาเหตุ: ${r.o.root_cause}`, r.o.solution && `แก้: ${r.o.solution}`].filter(Boolean).join(' · ')}</div>}
                          </td>
                          <td style={td}>{r.techs.join(', ') || r.o.tech_main || '—'}</td>
                          <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{r.prNos.join(', ') || ''}</td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtMin(r.techMin)}{r.vendor ? ' 📤' : ''}</td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtBaht(r.cost)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {/* 🔴 ตัดแถวที่แสดง = ต้องมีทางกดดูต่อ + บอกว่าเหลืออีกกี่ใบ (ห้ามตัดเงียบ) */}
                {!showAll && sum.rows.length > ROWS_FIRST && (
                  <button onClick={() => setShowAll(true)}
                    style={{ marginTop: 8, background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)',
                      borderRadius: 8, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }}>
                    ▾ แสดงอีก {sum.rows.length - ROWS_FIRST} ใบ (ทั้งหมด {sum.rows.length} ใบ)
                  </button>
                )}
              </div>
            </>)}
          </>)}
        </div>
      </div>
    </div>
  );
}
