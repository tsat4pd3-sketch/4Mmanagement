/**
 * ProblemFixModal — ลง "วิธีการแก้ไข" + "ผลการตรวจติดตาม" ของปัญหา 1 รายการ
 *
 * ที่มา: feedback หน้างาน 2026-08-19 (หัวหน้ากลุ่ม Assy2)
 *   "ถ้าเกิน 30 นาที ให้มีไอคอนขึ้นมาให้หัวหน้ากลุ่มลงวิธีแก้ไข และผลตรวจติดตาม"
 *   เดิม 2 ช่องนี้ในใบรายงานปัญหาการผลิตต้องปริ้นออกมาเขียนมือทุกใบ
 *
 * ⚠️ Knowledge management โดยไม่สร้างคลังแยก (คำถาม user 2026-08-19):
 *    "ความรู้" = วิธีแก้ที่เคยลงไว้ในบันทึกจริง — ไม่ตั้งตารางมาตรฐานใหม่
 *    (จะกลายเป็นที่ที่ 4 ต่อจาก mtn_orders.solution / improvements / pe_fmea_items แล้ว drift กัน)
 *    ที่ขาดคือ "ตัวดึงกลับมาใช้" → โมดัลนี้ดึงวิธีแก้ครั้งก่อนของปัญหาชนิดเดียวกันมาให้กดใช้ซ้ำ
 *    เครื่องเดียวกันขึ้นก่อน (ตรงเป้าสุด) แล้วค่อยเครื่องอื่นชนิดเดียวกัน
 */
import { useState, useEffect, useCallback } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';

const TABLE = { downtime: 'downtime_logs', defect: 'defect_logs' };
const TYPE_COL = { downtime: 'downtime_type_id', defect: 'defect_type_id' };

const txt = v => String(v || '').trim();
const dmy = iso => (iso ? new Date(iso).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' }) : '');

export default function ProblemFixModal({ kind, row, title, actorName, onClose, onSaved }) {
  const [fix, setFix]         = useState(row?.fix_action || '');
  const [fixBy, setFixBy]     = useState(row?.fix_by || actorName || '');
  const [res, setRes]         = useState(row?.followup_result || '');
  const [resBy, setResBy]     = useState(row?.followup_by || actorName || '');
  const [saving, setSaving]   = useState(false);
  const [past, setPast]       = useState([]);   // วิธีแก้ที่เคยลงไว้ของปัญหาชนิดเดียวกัน

  const typeId = row?.[TYPE_COL[kind]];

  /* ── ดึงวิธีแก้ครั้งก่อนของปัญหาชนิดเดียวกัน (เครื่องเดียวกันขึ้นก่อน) ── */
  useEffect(() => {
    let dead = false;
    (async () => {
      if (!typeId) return;
      const { data, error } = await supabaseDR.from(TABLE[kind])
        .select('id, fix_action, fix_by, fix_at, machine_no')
        .eq(TYPE_COL[kind], typeId)
        .not('fix_action', 'is', null)
        .neq('id', row.id)
        .order('fix_at', { ascending: false })
        .limit(30);
      if (dead || error || !data) return;
      const seen = new Set();
      const uniq = [];
      for (const r of data) {
        const k = txt(r.fix_action).toLowerCase();
        if (!k || seen.has(k)) continue;      // วิธีแก้เดิมซ้ำๆ ให้ขึ้นครั้งเดียว
        seen.add(k);
        uniq.push(r);
      }
      // เครื่องเดียวกันตรงเป้าสุด → ขึ้นก่อน
      const mine = row?.machine_no;
      uniq.sort((a, b) => (b.machine_no === mine ? 1 : 0) - (a.machine_no === mine ? 1 : 0));
      setPast(uniq.slice(0, 6));
    })();
    return () => { dead = true; };
  }, [kind, typeId, row?.id, row?.machine_no]);

  const save = useCallback(async () => {
    setSaving(true);
    const now = new Date().toISOString();
    const patch = {
      fix_action: txt(fix) || null,
      fix_by: txt(fix) ? (txt(fixBy) || null) : null,
      fix_at: txt(fix) ? (row.fix_at || now) : null,
      followup_result: txt(res) || null,
      followup_by: txt(res) ? (txt(resBy) || null) : null,
      followup_at: txt(res) ? (row.followup_at || now) : null,
    };
    // ⚠️ นับแถวที่เขียนจริง — RLS/แถวหาย จะคืน 200 ไม่มี error (กฎเหล็ก CLAUDE.md)
    const { data, error } = await supabaseDR.from(TABLE[kind])
      .update(patch).eq('id', row.id).select('id');
    setSaving(false);
    if (error) {
      toast.error(error.code === '42703'
        ? 'ยังบันทึกไม่ได้ — ต้อง apply migration 20260819_problem_fix_followup ก่อน (แจ้ง admin)'
        : `บันทึกไม่สำเร็จ: ${error.message}`);
      return;
    }
    if (!data?.length) { toast.error('บันทึกไม่สำเร็จ — ไม่พบรายการนี้แล้ว (อาจถูกลบไป)'); return; }
    toast.success('บันทึกวิธีแก้ไขแล้ว');
    onSaved?.();
    onClose?.();
  }, [kind, row, fix, fixBy, res, resBy, onClose, onSaved]);

  const lbl = { fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 4, display: 'block' };
  const ta  = { width: '100%', minHeight: 76, padding: '8px 10px', borderRadius: 8,
                border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--text)',
                fontSize: 13, fontFamily: 'inherit', resize: 'vertical' };
  const inp = { width: 200, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border2)',
                background: 'var(--bg2)', color: 'var(--text)', fontSize: 12.5 };

  return (
    <div className="overlay" style={{ zIndex: 2200 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14,
        padding: 20, width: 'min(96vw, 620px)', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 15.5, fontWeight: 800, color: 'var(--text)', marginBottom: 3 }}>
          🛠 วิธีแก้ไข &amp; ผลตรวจติดตาม
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>{title}</div>

        {/* ── วิธีแก้ไข ── */}
        <label style={lbl}>วิธีการแก้ไข</label>
        <textarea value={fix} onChange={e => setFix(e.target.value)} style={ta}
          placeholder="แก้ยังไง เปลี่ยนอะไร ปรับค่าอะไร — เขียนให้กะถัดไปอ่านแล้วทำตามได้" />

        {past.length > 0 && (
          <div style={{ marginTop: 8, marginBottom: 4 }}>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 5 }}>
              💡 เคยแก้ปัญหาชนิดนี้มาก่อน — กดเพื่อใช้ข้อความเดิม
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {past.map(p => (
                <button key={p.id} type="button" onClick={() => setFix(p.fix_action)}
                  title={`${p.fix_action}\n${p.machine_no || ''} ${p.fix_by || ''} ${dmy(p.fix_at)}`}
                  style={{
                    maxWidth: 260, textAlign: 'left', fontSize: 11.5, lineHeight: 1.35,
                    padding: '5px 9px', borderRadius: 8, cursor: 'pointer',
                    background: p.machine_no && p.machine_no === row?.machine_no
                      ? 'rgba(34,197,94,0.12)' : 'var(--bg2)',
                    border: `1px solid ${p.machine_no && p.machine_no === row?.machine_no
                      ? 'rgba(34,197,94,0.4)' : 'var(--border2)'}`,
                    color: 'var(--text)',
                  }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.fix_action}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                    {p.machine_no ? `${p.machine_no} · ` : ''}{dmy(p.fix_at)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>ผู้แก้ไข</span>
          <input value={fixBy} onChange={e => setFixBy(e.target.value)} style={inp} placeholder="ชื่อผู้แก้ไข" />
        </div>

        {/* ── ผลตรวจติดตาม ── */}
        <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0 12px' }} />
        <label style={lbl}>ผลการตรวจติดตามการแก้ไข</label>
        <textarea value={res} onChange={e => setRes(e.target.value)} style={ta}
          placeholder="แก้แล้วหายจริงไหม ตามดูแล้วผลเป็นยังไง — ลงทีหลังได้ ไม่ต้องกรอกพร้อมวิธีแก้" />
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>ผู้ตรวจติดตาม</span>
          <input value={resBy} onChange={e => setResBy(e.target.value)} style={inp} placeholder="ชื่อผู้ตรวจติดตาม" />
        </div>

        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 14, lineHeight: 1.5 }}>
          ข้อความนี้จะถูกเติมลงใบรายงานปัญหาการผลิตให้อัตโนมัติ — ไม่ต้องปริ้นมาเขียนมือ
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{
            padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border2)',
            background: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}>ยกเลิก</button>
          <button onClick={save} disabled={saving} style={{
            padding: '8px 20px', borderRadius: 8, border: 'none', background: '#f59e0b',
            color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.6 : 1 }}>{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button>
        </div>
      </div>
    </div>
  );
}
