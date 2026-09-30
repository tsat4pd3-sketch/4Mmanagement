/* ══ 📋 คิวงานที่วางแผนไว้ — ฝั่งหน้างานในหน้ากะ (2026-09-30 · คำสั่ง user) ═══════════════
   คู่กับแท็บ "📋 แผนสั่งงาน (ล็อต)" ใน /production-plan ที่ทีมวางแผนใช้ออกแผน
   คำสั่ง user: **"แผนออกใบให้เลย หน้างานแค่กดเริ่ม/ปิด"**
   ⇒ แผงนี้แสดงล็อตของกะนี้ตามลำดับ · กด "▶ เริ่ม" แล้วระบบสร้างใบผลิตให้ (ไม่ต้องกรอกเอง)

   🔴 กติกา:
     · **claim ล็อตก่อนสร้างใบ แล้วใบล้มต้องคืนสถานะ** (กฎเหล็ก db-write ข้อ 6 — ไม่งั้นล็อตค้าง
       สถานะ started โดยไม่มีใบจริง แล้วไม่มีใครกดเริ่มได้อีกเลย)
     · claim แบบ compare-and-swap (`.eq('status','planned')` + นับแถว) — 2 คนกดพร้อมกันต้องได้คนเดียว
     · **ไม่มีแผน = ไม่วาดอะไรเลย** (ไลน์คัมบังไม่ควรเห็นแผงนี้รก)
     · **ห้ามบล็อกการเปิดใบเอง** — แผนเป็นทางลัด ไม่ใช่กรง (หน้างานเจอปัญหาต้องสลับงานได้)
   ══════════════════════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback, useContext } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { canSeeded } from '../utils/permissions';
import { toast } from './Toast';
import MatLabel from './MatLabel';
import { sortBySeq, reconcilePlan, qtyText } from '../utils/planLots';

export default function PlannedLotQueue({ session, orders = [], onStarted }) {
  const { role, fullName } = useContext(UserContext);
  const mayStart = canSeeded('production_plan', 'start', role);
  const [lots, setLots] = useState([]);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async (alive = () => true) => {
    if (!session?.line_name || !session?.work_date) { setLots([]); return; }
    const { data, error } = await supabaseDR.from('production_plan_lots')
      .select('id, seq, mat_no, part_name, qty_plan, machine_no, die_no, status, prod_order_id, note')
      .eq('work_date', session.work_date).eq('line_name', session.line_name).eq('shift', session.shift)
      .neq('status', 'cancelled');
    if (!alive()) return;
    if (error) { toast.error(`โหลดแผนสั่งงานไม่สำเร็จ: ${error.message}`); return; }
    setLots(sortBySeq(data || []));
  }, [session?.line_name, session?.work_date, session?.shift]);
  useEffect(() => { let on = true; load(() => on); return () => { on = false; }; }, [load]);

  const start = async (lot) => {
    if (!mayStart || busy) return;
    setBusy(lot.id);
    /* ① claim ก่อน — compare-and-swap กัน 2 คนกดพร้อมกัน (นับแถวเสมอ:
          RLS/แข่งกันปฏิเสธ UPDATE = "สำเร็จ 0 แถว ไม่มี error" · กฎเหล็ก db-write ข้อ 2) */
    const { data: claimed, error: ce } = await supabaseDR.from('production_plan_lots')
      .update({ status: 'started' }).eq('id', lot.id).eq('status', 'planned').is('prod_order_id', null)
      .select('id');
    if (ce) { setBusy(null); toast.error(`จองล็อตไม่สำเร็จ: ${ce.message}`); return; }
    if (!claimed?.length) { setBusy(null); toast.info('ล็อตนี้ถูกเริ่มไปแล้ว (อาจมีคนอื่นกดพร้อมกัน) — รีเฟรชแล้วลองใหม่'); await load(); return; }

    /* ② สร้างใบผลิตจริง — ใช้ prod_no ที่บอกได้ว่ามาจากแผน (สอบกลับง่ายกว่า MANUAL-xxxx ล้วน) */
    const p2 = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const ymd = String(session.work_date).replace(/-/g, '').slice(2);
    const prodNo = `PLAN-${ymd}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}-${p2(lot.seq)}`;
    const { data: created, error: oe } = await supabaseDR.from('prod_orders').insert({
      session_id: session.id, prod_no: prodNo, mat_no: lot.mat_no,
      part_name: lot.part_name || null,
      qty: lot.qty_plan, qty_target: lot.qty_plan, qty_actual: 0,
      is_manual: true, status: 'open', opened_by: fullName || null,
      ...(lot.machine_no ? { machine_no: lot.machine_no } : {}),
    }).select('id').single();

    if (oe || !created?.id) {
      /* ③ 🔴 ใบล้ม = ต้องคืนสถานะล็อต ไม่งั้นค้าง started โดยไม่มีใบ แล้วกดเริ่มไม่ได้อีก */
      await supabaseDR.from('production_plan_lots')
        .update({ status: 'planned' }).eq('id', lot.id).eq('status', 'started').is('prod_order_id', null);
      setBusy(null);
      toast.error(`เปิดใบผลิตไม่สำเร็จ: ${oe?.message || 'ไม่ทราบสาเหตุ'} — คืนล็อตกลับเป็น "รอคิว" แล้ว`);
      return;
    }
    /* ④ ผูกใบเข้าล็อต */
    const { error: le } = await supabaseDR.from('production_plan_lots')
      .update({ prod_order_id: created.id }).eq('id', lot.id);
    setBusy(null);
    if (le) toast.error(`เปิดใบแล้วแต่ผูกกับแผนไม่สำเร็จ: ${le.message} — แจ้งวางแผนให้ผูกให้`);
    else toast.success(`เริ่มล็อต ${lot.mat_no} · ${lot.qty_plan.toLocaleString()} ชิ้น ✓`);
    await load();
    onStarted?.();
  };

  if (!lots.length) return null;                       // ไม่มีแผน = ไม่วาดอะไรเลย
  const rec = reconcilePlan(lots, orders);
  const waiting = rec.rows.filter(r => !r.started).length;

  return (
    <div style={{ marginBottom: 10, padding: '10px 14px', background: 'rgba(77,159,255,0.07)', border: '1px solid rgba(77,159,255,0.3)', borderRadius: 9 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: '#4d9fff', marginBottom: 6 }}>
        📋 แผนสั่งงานจากทีมวางแผน — {lots.length} ล็อต{waiting > 0 ? ` · รอเริ่ม ${waiting}` : ' · เริ่มครบแล้ว'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {rec.rows.map(r => {
          const l = r.lot;
          return (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', fontSize: 12,
              padding: '4px 8px', background: 'var(--bg2)', borderRadius: 6,
              borderLeft: `3px solid ${r.closed ? '#22c55e' : r.started ? '#4d9fff' : 'var(--border2)'}` }}>
              <b style={{ minWidth: 18, textAlign: 'center', color: 'var(--muted)' }}>{l.seq}</b>
              <MatLabel mat={l.mat_no} name={l.part_name} size={12} />
              <b>{qtyText(l.qty_plan)}</b><span style={{ color: 'var(--muted)', fontSize: 11 }}>ชิ้น</span>
              {l.machine_no && <span style={{ fontSize: 11, color: '#94a3b8' }}>⚙️ {l.machine_no}</span>}
              {l.die_no && <span style={{ fontSize: 11, color: '#94a3b8' }}>🔧 {l.die_no}</span>}
              <span className="spacer" style={{ flex: 1 }} />
              {r.closed ? <span style={{ color: '#22c55e', fontWeight: 700 }}>✓ ปิดแล้ว</span>
                : r.started ? <span style={{ color: '#4d9fff', fontWeight: 700 }}>▶ กำลังทำ{r.donePcs != null ? ` · ${qtyText(r.donePcs)}/${qtyText(l.qty_plan)}` : ''}</span>
                : mayStart && session?.status === 'open'
                  ? <button onClick={() => start(l)} disabled={busy === l.id} style={{ fontSize: 11.5, fontWeight: 800 }}>
                      {busy === l.id ? 'กำลังเปิด…' : '▶ เริ่มล็อตนี้'}
                    </button>
                  : <span style={{ color: 'var(--muted)' }}>รอคิว</span>}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
        กด “เริ่ม” แล้วระบบเปิดใบผลิตให้ตามแผน — เจอปัญหาสลับงานได้ตามปกติ <b>แผนไม่ได้ล็อกหน้างาน</b>
      </div>
    </div>
  );
}
