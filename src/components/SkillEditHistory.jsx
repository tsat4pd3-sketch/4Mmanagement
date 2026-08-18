import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';

/**
 * ประวัติการแก้คะแนนทักษะของพนักงาน 1 คน — อ่านจาก `audit_log` (Main)
 *
 * ⚠️ log เฉพาะ "การแก้ด้วยมือ" เท่านั้น (trigger `trg_audit_employee_skills` +
 *    `fn_audit_manual_only` ข้ามการเขียนที่ไม่มี auth.uid() = job อัตโนมัติ)
 *    → daily/weekly skill farm ไม่โผล่ที่นี่ **โดยตั้งใจ** ไม่งั้นแถวโตวันละหลายร้อย
 *      จนกลบสิ่งที่คนอยากเห็นจริง ("ใครไปแก้คะแนน") — ต้องเขียนบอกบนจอด้วย
 *      ไม่งั้นคนอ่านจะเข้าใจว่าคะแนนที่ขยับเองคือไม่มีใครแตะ
 *
 * ⚠️ โหลดไม่สำเร็จ ต้องบอกว่า "โหลดไม่ได้" ห้ามแสดงเป็น "ไม่มีประวัติ"
 *    (ประวัติว่างเปล่ากับอ่านไม่ได้ คนละเรื่อง — อันหลังมีคนต้องไปตาม)
 */
export default function SkillEditHistory({ employeeId, limit = 30 }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true); setErr('');
    // ผ่าน RPC ไม่ใช่ filter jsonb ฝั่ง client — ตรงกับ expression index + RLS ยังบังคับใช้
    // (RPC เป็น SECURITY INVOKER · policy audit_log_read = authenticated เท่านั้น)
    const { data, error } = await supabase
      .rpc('get_skill_edit_history', { p_employee_id: employeeId, p_limit: limit });
    setLoading(false);
    if (error) { setErr(error.message); setRows(null); return; }
    setRows(data || []);
  }, [employeeId, limit]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const fmt = ts => {
    try {
      return new Date(ts).toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return ts; }
  };

  // แปลง 1 แถว audit เป็นข้อความที่คนอ่านรู้เรื่อง
  const describe = r => {
    const d = r.new_data || r.old_data || {};
    const skill = d.skill_name || '(ไม่ระบุสกิล)';
    if (r.action === 'INSERT') return { skill, text: `เพิ่มสกิล · ตั้งคะแนน ${d.score ?? '—'}` };
    if (r.action === 'DELETE') return { skill, text: `ลบสกิลออก (คะแนนเดิม ${d.score ?? '—'})` };
    const parts = [];
    const ch = r.changed_fields || [];
    if (ch.includes('score')) parts.push(`คะแนน ${r.old_data?.score ?? '—'} → ${r.new_data?.score ?? '—'}`);
    if (ch.includes('pending_level')) {
      const p = r.new_data?.pending_level;
      parts.push(p ? `ตั้งรออนุมัติ Lv.${p}` : 'เคลียร์สถานะรออนุมัติ');
    }
    // ฟิลด์อื่นที่ไม่ได้แปลเป็นภาษาคน — แสดงชื่อดิบไว้ ดีกว่าเงียบ
    const rest = ch.filter(k => !['score', 'pending_level', 'last_daily_farm_date'].includes(k));
    if (rest.length) parts.push(rest.join(', '));
    return { skill, text: parts.join(' · ') || 'แก้ไข' };
  };

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border2)', paddingTop: 10 }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          color: 'var(--text2)', fontSize: 12, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 6, width: 'auto',
        }}>
        <span style={{ fontSize: 10 }}>{open ? '▼' : '▶'}</span>
        🕓 ประวัติการแก้คะแนน
      </button>

      {open && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.5 }}>
            แสดงเฉพาะการแก้ด้วยมือในระบบ — การสะสม EXP อัตโนมัติรายวัน/รายสัปดาห์ไม่ถูกบันทึกที่นี่
          </div>

          {loading && <div style={{ fontSize: 12, color: 'var(--muted)' }}>กำลังโหลด…</div>}

          {err && (
            <div style={{ fontSize: 12, color: '#ef4444', background: '#ef444415', border: '1px solid #ef444440', borderRadius: 6, padding: '7px 9px' }}>
              ⚠️ โหลดประวัติไม่สำเร็จ — {err}
              <button type="button" onClick={load}
                style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px', width: 'auto', cursor: 'pointer' }}>ลองใหม่</button>
            </div>
          )}

          {!loading && !err && rows?.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีการแก้คะแนนด้วยมือ</div>
          )}

          {!loading && !err && rows?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 220, overflowY: 'auto' }}>
              {rows.map((r, i) => {
                const { skill, text } = describe(r);
                return (
                  <div key={i} style={{ background: 'var(--bg3)', borderRadius: 6, padding: '6px 9px', fontSize: 12, lineHeight: 1.5 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 700 }}>{skill}</span>
                      <span style={{ color: 'var(--text2)' }}>{text}</span>
                    </div>
                    <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>
                      {fmt(r.changed_at)} · {r.actor || 'ไม่ทราบผู้แก้'}
                    </div>
                  </div>
                );
              })}
              {rows.length === limit && (
                <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: '2px 0' }}>
                  แสดง {limit} รายการล่าสุด (อาจมีเก่ากว่านี้)
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
