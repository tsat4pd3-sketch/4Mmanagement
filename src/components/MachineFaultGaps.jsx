/* ⚠️ แถบ "เครื่องเสียแต่ยังไม่ลง downtime" ในหน้า Daily Report (ทางที่ 2 · user เลือก 13/11)
   📄 docs/modules/integration-hub.md §เครื่องช่วยเติม downtime · กฎตัดสิน = faultGaps() ใน src/utils/machineFacts.js

   - ข้อมูลจากเครื่อง (Node-RED ผ่านศูนย์เชื่อมต่อ) ของจิ๊กที่ **มีใบผลิตในกะนี้** (`prod_orders.machine_no`)
   - เตือนเฉพาะ FAULT ที่นานกว่า FAULT_GAP_MIN นาที และยังไม่มี downtime ทับช่วงนั้น
   - 🔴 ไม่บันทึกเอง — ปุ่ม "ลงจากช่วงนี้" แค่เติมฟอร์ม downtime เดิม (เครื่อง/เวลาเริ่ม/จบ/ประเภทที่จับคู่ไว้) คนเลือกสาเหตุ+กดบันทึกเอง
   - ไม่มีจิ๊กไหนต่อ Node-RED = ไม่วาดอะไรเลย (ไลน์ส่วนใหญ่) · อ่านไม่ได้ = เขียนบอก ห้ามเงียบ
   ⚠️ egress: เลือกคอลัมน์ · กรองเฉพาะ fault + ช่วงกะ · โหลดใหม่ทุก RATE.BOARD และเมื่อรายการ downtime เปลี่ยน */
import { useCallback, useMemo, useRef, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { usePolling } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import { faultGaps, FAULT_GAP_MIN, FAULT_GAP_STATES } from '../utils/machineFacts';
import { machineKey } from '../utils/machineNo';

const H = 3600000;
const hm = (msv) => new Date(msv).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });

/** กรอบกะ ESM ของ session (เช้า 08–20 · ดึก 20–08 วันถัดไป) เป็น epoch ms — เวลาไทยตรงๆ */
function shiftWindow(session) {
  if (!session?.work_date) return null;
  const base = Date.parse(`${session.work_date}T00:00:00+07:00`);
  if (!Number.isFinite(base)) return null;
  const s = base + (session.shift === 'night' ? 20 : 8) * H;
  return [s, s + 12 * H];
}

export default function MachineFaultGaps({ session, orders = [], downtimes = [], machines = [], canEdit, onUse, style }) {
  const [res, setRes] = useState(null);     // null = ยังไม่โหลด · { linked, states, tagMap, reasonMap, err }
  const req = useRef(0);

  /* จิ๊กที่มีใบในกะนี้ → id ในทะเบียน (deps เป็น string กันยิงซ้ำ — กฎ DB ข้อ 9) */
  const idKey = useMemo(() => {
    const ks = new Set(orders.map(o => (o?.machine_no ? machineKey(o.machine_no) : '')).filter(Boolean));
    return machines.filter(m => m?.id && ks.has(machineKey(m.machine_no))).map(m => m.id).sort().join(',');
  }, [orders, machines]);
  const sessKey = session?.id ? `${session.id}|${session.work_date}|${session.shift}` : '';

  const load = useCallback(async () => {
    const id = ++req.current;
    const win = shiftWindow(session);
    const ids = idKey ? idKey.split(',') : [];
    if (!win || !ids.length) { setRes({ linked: false }); return; }
    const tm = await supabaseDR.from('machine_tag_map').select('source_id, tag, machine_id').in('machine_id', ids);
    if (id !== req.current) return;
    if (tm.error) { setRes({ linked: true, err: 'อ่านการผูกเครื่องกับ Node-RED ไม่สำเร็จ' }); return; }
    const maps = tm.data || [];
    if (!maps.length) { setRes({ linked: false }); return; }
    const srcIds = [...new Set(maps.map(m => m.source_id))];
    const [st, rm] = await Promise.all([
      supabaseDR.from('machine_state_events')
        .select('machine_tag, started_at, ended_at, duration_sec, state, reason_code, reason_text')
        .in('source_id', srcIds).in('machine_tag', maps.map(m => m.tag)).in('state', FAULT_GAP_STATES)
        .gte('started_at', new Date(win[0]).toISOString()).lt('started_at', new Date(win[1]).toISOString())
        .order('started_at').limit(1000),
      supabaseDR.from('machine_reason_map').select('reason_kind, reason_code, downtime_type_id').in('source_id', srcIds),
    ]);
    if (id !== req.current) return;
    setRes({
      linked: true, tagMap: maps, states: st.data || [], reasonMap: rm.data || [],
      err: st.error ? 'อ่านข้อมูลจากเครื่องไม่สำเร็จ — รายการด้านล่างอาจไม่ครบ' : null,
      truncated: (st.data || []).length >= 1000,
    });
  }, [sessKey, idKey]); // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(load, RATE.BOARD);

  const gaps = useMemo(() => (res?.linked && res.states ? faultGaps({
    states: res.states, tagMap: res.tagMap, machines, orders, downtimes, reasonMap: res.reasonMap, session,
  }) : []), [res, machines, orders, downtimes, session]);

  if (!res || !res.linked) return null;                       // ไลน์ที่ไม่มีจิ๊กต่อ Node-RED = ไม่วาด
  if (!res.err && !gaps.length) {
    return (
      <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 2px', ...style }}>
        🏭 ข้อมูลจากเครื่อง: ไม่มีเครื่องเสีย (FAULT) นานกว่า {FAULT_GAP_MIN} นาที ที่ยังไม่ลง downtime
      </div>
    );
  }
  return (
    <div style={{ border: '1px solid var(--amber)', borderRadius: 'var(--r-md)', padding: '10px 12px', background: 'var(--card)', display: 'grid', gap: 8, ...style }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
        ⚠️ เครื่องเสียแต่ยังไม่ลง downtime ({gaps.length})
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>
          {' '}· จากเครื่อง (Node-RED) · FAULT นานกว่า {FAULT_GAP_MIN} นาที · กด "ลงจากช่วงนี้" แล้วเลือกสาเหตุเอง ระบบไม่บันทึกให้
        </span>
      </div>
      {res.err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{res.err}</div>}
      {res.truncated && <div style={{ fontSize: 12, color: 'var(--amber)' }}>ช่วงหยุดเกิน 1,000 รายการ — แสดงเฉพาะส่วนแรก</div>}
      {gaps.map(g => (
        <div key={g.key} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
          <b style={{ fontFamily: 'ui-monospace, monospace' }}>{g.machineNo}</b>
          <span>{hm(g.startMs)}–{hm(g.endMs)}</span>
          <span style={{ color: 'var(--red)', fontWeight: 700 }}>{Math.round(g.min)} นาที</span>
          <span style={{ color: 'var(--muted)' }}>
            {g.reasonText ? `เหตุที่กดหน้าเครื่อง: ${g.reasonText}` : 'ไม่ได้กดเหตุผลที่หน้าเครื่อง'}
          </span>
          {canEdit && (
            <button type="button" className="pg-btn" style={{ marginLeft: 'auto' }}
              onClick={() => onUse?.({ machine_no: g.machineNo, start_time: hm(g.startMs), end_time: hm(g.endMs), downtime_type_id: g.suggestTypeId || '' })}>
              ลงจากช่วงนี้
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
