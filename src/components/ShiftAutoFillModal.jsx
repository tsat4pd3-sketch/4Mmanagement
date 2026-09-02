import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { mondayOf, addDays, detectRotation, projectWeeks } from '../utils/shiftRotation';

/**
 * เติมตารางกะล่วงหน้าจาก "รอบสลับที่หัวหน้าตั้งไว้จริง"
 *
 * ที่มา (คำขอ user 2026-08-28): "ปกติสลับกันทุก 2 สัปดาห์อยู่แล้ว พอจะ seed ล่วงหน้าได้มั้ย
 *   จากข้อมูลที่ user ลงไว้ ถ้าไม่มีเปลี่ยนแปลงจะได้มีอะไรให้ fallback"
 *
 * ⚠️ กฎเหล็ก:
 *   1. **ระบบเสนอ คนกดยืนยัน** — ต้องเห็น preview ทุกสัปดาห์ก่อนเขียนเสมอ ห้าม seed เงียบ
 *      (ตารางกะมีผลกับ เช็คชื่อ / OEE / ค่าแรง OT — เดาผิดแล้วแก้ย้อนยาก)
 *   2. **ห้ามทับสัปดาห์ที่มีข้อมูลอยู่แล้ว** — ของที่คนตั้งเองชนะเสมอ
 *   3. **ไลน์ที่ตรวจ pattern ไม่ได้ ต้องโชว์พร้อมเหตุผล ห้ามข้ามเงียบ**
 *   4. แถวที่ระบบเติมติด `note = 'auto-rotate'` — แยกออกจากที่คนตั้งเองได้ตลอดไป
 */

export const AUTO_NOTE = 'auto-rotate';
const WEEK_CHOICES = [4, 8, 12, 26];
const HISTORY_WEEKS = 26;

export default function ShiftAutoFillModal({ weekStart, lines = [], deptRows = [], canEdit, onClose, onDone }) {
  const [weeks, setWeeks] = useState(8);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [hist, setHist] = useState(null);   // { byLine: Map, byDept: Map, manual: Map }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setErr('');
      const { data, error } = await supabase.from('shift_schedules')
        .select('work_date, line_id, dept_name, day_team, is_manual')
        .gte('work_date', addDays(weekStart, -7 * HISTORY_WEEKS))
        .lte('work_date', addDays(weekStart, 7 * 52))
        .order('work_date');
      if (!alive) return;
      // โหลดไม่ได้ = บอกตรงๆ ห้ามโชว์เป็น "ไม่มีประวัติ" (คนละเรื่องกัน)
      if (error) { setErr(error.message); setLoading(false); return; }
      const byLine = new Map(), byDept = new Map(), manual = new Map();
      (data || []).forEach(r => {
        const key = r.dept_name ? `d:${r.dept_name}` : (r.line_id != null ? `l:${r.line_id}` : null);
        if (!key) return;
        const bag = r.dept_name ? byDept : byLine;
        const id = r.dept_name || String(r.line_id);
        if (!bag.has(id)) bag.set(id, new Map());
        const mon = mondayOf(r.work_date);
        const slot = bag.get(id);
        // แถวของวันจันทร์เองคือค่าอ้างอิงของสัปดาห์ (ตรงกับที่หน้านี้อ่านอยู่แล้ว)
        if (!slot.has(mon) || r.work_date === mon) slot.set(mon, r.day_team);
        if (r.work_date === mon) manual.set(key, !!r.is_manual);
      });
      setHist({ byLine, byDept, manual });
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [weekStart]);

  /* ── วางแผน: ต่อ pattern ต่อไลน์/ต่อหน่วยงาน ── */
  const plan = useCallback(() => {
    if (!hist) return { ready: [], blocked: [], rowCount: 0, skipped: 0 };
    const ready = [], blocked = [];
    let rowCount = 0, skipped = 0;

    const one = (key, label, kind, id, weeksMap, rotIn, inheritFrom) => {
      const list = [...(weeksMap || new Map()).entries()].map(([monday, team]) => ({ monday, team }));
      const rot = rotIn || detectRotation(list);
      if (!rot.ok) { blocked.push({ key, label, kind, reason: rot.reason, seen: list.length }); return; }
      const { weeks: proj, skipped: sk } = projectWeeks({
        rotation: rot, fromMonday: weekStart, count: weeks,
        existingMondays: [...(weeksMap || new Map()).keys()],
      });
      skipped += sk;
      if (!proj.length) { blocked.push({ key, label, kind, reason: 'ตั้งครบทุกสัปดาห์ในช่วงนี้แล้ว', seen: list.length, done: true }); return; }
      rowCount += proj.length * 7;
      ready.push({ key, label, kind, id, rot, weeks: proj, inheritFrom });
    };

    if (canEdit) {
      /* ไลน์ลูกที่ "ตามไลน์แม่" (is_manual = false) มักมีประวัติน้อยเกินจะตรวจรอบเอง
       * — ต้องใช้รอบของไลน์แม่ ไม่งั้นแม่ถูกเติมแต่ลูกยังว่าง แล้วคนของไลน์ลูกก็ยังหายจากจอ
       *   (resolveAssignedShift อ่าน line_id ตรงตัว ไม่ไล่ขึ้นไปหาแม่) */
      const byName = new Map(lines.map(l => [l.name, l]));
      const ownRot = new Map(lines.map(l =>
        [String(l.id), detectRotation([...(hist.byLine.get(String(l.id)) || new Map()).entries()].map(([monday, team]) => ({ monday, team })))]));
      const resolve = (l, depth = 0) => {
        const own = ownRot.get(String(l.id));
        if (own?.ok || depth > 6) return { rot: own, from: null };
        if (hist.manual.get(`l:${l.id}`)) return { rot: own, from: null };   // ตั้งกะเอง ไม่ตามแม่
        const p = l.parent_line_name ? byName.get(l.parent_line_name) : null;
        if (!p) return { rot: own, from: null };
        const up = resolve(p, depth + 1);
        return up.rot?.ok ? { rot: up.rot, from: p.name } : { rot: own, from: null };
      };
      lines.forEach(l => {
        const { rot, from } = resolve(l);
        one(`l:${l.id}`, l.name, 'line', l.id, hist.byLine.get(String(l.id)), rot, from);
      });
    }
    deptRows.forEach(d => one(`d:${d.name}`, d.name, 'dept', d.name, hist.byDept.get(d.name)));
    return { ready, blocked, rowCount, skipped };
  }, [hist, lines, deptRows, weeks, weekStart, canEdit]);

  const { ready, blocked, rowCount, skipped } = plan();

  const apply = async () => {
    if (!ready.length) return;
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const userId = u?.user?.id;
    const lineRows = [], deptRowsToSave = [];
    ready.forEach(r => r.weeks.forEach(w => {
      for (let i = 0; i < 7; i++) {
        const work_date = addDays(w.monday, i);
        if (r.kind === 'line') {
          lineRows.push({
            work_date, line_id: r.id, day_team: w.team,
            is_manual: !!hist.manual.get(r.key), note: AUTO_NOTE, created_by: userId,
          });
        } else {
          deptRowsToSave.push({
            work_date, line_id: null, dept_name: r.id, day_team: w.team,
            note: AUTO_NOTE, created_by: userId,
          });
        }
      }
    }));

    let failed = false;
    // แบ่งก้อนกัน payload ใหญ่เกิน (26 สัปดาห์ × 7 วัน × หลายสิบไลน์)
    const chunk = async (rows, onConflict) => {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from('shift_schedules')
          .upsert(rows.slice(i, i + 500), { onConflict });
        if (error) {
          failed = true;
          toast.error(error.code === '42703'
            ? 'ยังเติมกะไม่ได้ — ยังไม่ได้ apply migration ของคอลัมน์ที่ใช้ (แจ้ง admin)'
            : 'เติมกะไม่สำเร็จ: ' + error.message);
          return;
        }
      }
    };
    if (lineRows.length) await chunk(lineRows, 'work_date,line_id');
    if (!failed && deptRowsToSave.length) await chunk(deptRowsToSave, 'work_date,dept_name');
    setSaving(false);
    if (!failed) {
      toast.success(`เติมตารางกะแล้ว ${ready.length} รายการ · ${weeks} สัปดาห์`);
      onDone?.();
    }
  };

  const th = { padding: '6px 8px', textAlign: 'left', fontSize: 11.5, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' };
  const td = { padding: '5px 8px', fontSize: 12, borderTop: '1px solid var(--border)' };
  const chip = t => (
    <span style={{
      display: 'inline-block', minWidth: 20, textAlign: 'center', padding: '1px 6px', borderRadius: 5,
      fontSize: 11, fontWeight: 800,
      background: t === 'A' ? 'rgba(245,158,11,0.16)' : 'rgba(77,159,255,0.16)',
      color: t === 'A' ? '#f59e0b' : '#4d9fff',
    }}>{t}</span>
  );

  return (
    <div className="overlay" style={{ zIndex: 2300 }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg3)', border: '2px solid rgba(77,159,255,0.5)', borderRadius: 14,
        padding: 22, width: 'min(96vw,860px)', maxHeight: '92vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, color: '#4d9fff' }}>🔁 เติมตารางกะล่วงหน้า</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.7 }}>
          ระบบดูรอบสลับที่ตั้งไว้จริงย้อนหลัง แล้วต่อไปข้างหน้าให้ — <b style={{ color: 'var(--text)' }}>เริ่มจากสัปดาห์ที่เปิดอยู่ ({weekStart})</b>
          {' '}· <b style={{ color: 'var(--text)' }}>ไม่ทับสัปดาห์ที่ตั้งไว้แล้ว</b> · เป็นค่าตั้งต้นให้ระบบมีอะไรใช้ ถ้าจริงๆ สลับต่างไป แก้ทับได้ตลอด
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>เติมไปข้างหน้า</span>
          {WEEK_CHOICES.map(w => (
            <button key={w} onClick={() => setWeeks(w)} style={{
              padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${weeks === w ? '#4d9fff' : 'var(--border2)'}`,
              background: weeks === w ? 'rgba(77,159,255,0.15)' : 'transparent',
              color: weeks === w ? '#4d9fff' : 'var(--text2)',
            }}>{w} สัปดาห์</button>
          ))}
        </div>

        {loading && <div style={{ fontSize: 13, color: 'var(--muted)', padding: '16px 0' }}>กำลังอ่านประวัติตารางกะ...</div>}

        {err && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', fontSize: 12.5, color: '#ef4444' }}>
            ⚠️ อ่านประวัติตารางกะไม่ได้ — {err} · ยังเติมกะไม่ได้ ลองใหม่อีกครั้ง
          </div>
        )}

        {!loading && !err && (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <Stat label="ต่อรอบให้ได้" value={`${ready.length} รายการ`} color="#22c55e" />
              <Stat label="ตรวจรอบไม่ได้" value={`${blocked.filter(b => !b.done).length} รายการ`} color={blocked.filter(b => !b.done).length ? '#f59e0b' : 'var(--muted)'} />
              <Stat label="สัปดาห์ที่ข้าม (ตั้งไว้แล้ว)" value={`${skipped}`} color="var(--muted)" />
              <Stat label="แถวที่จะเขียน" value={`${rowCount}`} color="#4d9fff" />
            </div>

            {ready.length > 0 && (
              <div className="table-sticky" style={{ overflowX: 'auto', marginBottom: 14, border: '1px solid var(--border)', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: 'var(--bg2)' }}>
                    <th style={th}>ไลน์ / หน่วยงาน</th>
                    <th style={th}>รอบที่ตรวจพบ</th>
                    {ready[0].weeks.slice(0, 8).map(w => (
                      <th key={w.monday} style={{ ...th, textAlign: 'center' }}>{w.monday.slice(5)}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {ready.map(r => (
                      <tr key={r.key}>
                        <td style={{ ...td, fontWeight: 600 }}>
                          {r.kind === 'dept' ? '🏢 ' : ''}{r.label}
                        </td>
                        <td style={{ ...td, color: 'var(--muted)', fontSize: 11.5, whiteSpace: 'nowrap' }}>
                          สลับทุก {r.rot.periodWeeks} สัปดาห์ · จาก {r.rot.weeksSeen} สัปดาห์ที่ตั้งไว้
                          {r.inheritFrom && <span style={{ color: '#4d9fff' }}> · ↳ ตามไลน์แม่ {r.inheritFrom}</span>}
                        </td>
                        {r.weeks.slice(0, 8).map(w => (
                          <td key={w.monday} style={{ ...td, textAlign: 'center' }}>{chip(w.team)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {ready.some(r => r.weeks.length > 8) && (
                  <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--muted)' }}>
                    แสดง 8 สัปดาห์แรก — ที่เหลือต่อรอบเดิมไปจนครบ {weeks} สัปดาห์
                  </div>
                )}
              </div>
            )}

            {/* ตรวจ pattern ไม่ได้ = ต้องเห็น ห้ามข้ามเงียบ */}
            {blocked.filter(b => !b.done).length > 0 && (
              <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)' }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#f59e0b', marginBottom: 6 }}>
                  ⚠️ ต่อรอบให้ไม่ได้ {blocked.filter(b => !b.done).length} รายการ — ต้องตั้งเองในตาราง
                </div>
                <div style={{ display: 'grid', gap: 3 }}>
                  {blocked.filter(b => !b.done).map(b => (
                    <div key={b.key} style={{ fontSize: 11.5, color: 'var(--text2)' }}>
                      <b style={{ color: 'var(--text)' }}>{b.kind === 'dept' ? '🏢 ' : ''}{b.label}</b> — {b.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {ready.length === 0 && blocked.every(b => b.done) && blocked.length > 0 && (
              <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', fontSize: 12.5, color: '#22c55e' }}>
                ✅ ตั้งกะครบทุกสัปดาห์ในช่วงนี้แล้ว ไม่มีอะไรต้องเติม
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border2)', background: 'transparent', color: 'var(--text2)', fontSize: 13, cursor: 'pointer' }}>
            ปิด
          </button>
          <button onClick={apply} disabled={saving || loading || !ready.length}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', background: '#4d9fff', color: '#fff',
              fontSize: 13, fontWeight: 700, cursor: (saving || !ready.length) ? 'not-allowed' : 'pointer',
              opacity: (saving || loading || !ready.length) ? 0.5 : 1,
            }}>
            {saving ? 'กำลังเติม...' : `✓ เติม ${rowCount} แถว`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}
