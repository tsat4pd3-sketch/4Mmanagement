/**
 * 🎭 โหมดจำลองมุมมอง role (admin เท่านั้น · 2026-08-19)
 * admin เลือก role (+ scope ประกอบ: ไลน์/ทีมของ leader · sections · แอดมินหน่วยงาน)
 * แล้วดูระบบ "เหมือนที่ user คนนั้นเห็น" — เมนู/ปุ่ม/ขอบเขตข้อมูลฝั่งจอ ตาม role ที่จำลอง
 *
 * ⚠️ ขอบเขตของโหมด (ต้องเข้าใจก่อนใช้):
 *   - จำลองเฉพาะฝั่งจอ (UI gating ผ่าน can()/canAccessPage() + scope ใน query ของแต่ละหน้า)
 *   - RLS ฝั่ง DB ยังเป็นบัญชี admin จริง — การกดบันทึกใดๆ สำเร็จด้วยสิทธิ์จริงเสมอ
 *     → ใช้เพื่อ "ตรวจการมองเห็น" ไม่ใช่สนามทดลองกดบันทึก
 *   - เก็บใน sessionStorage = ต่อแท็บ (เปิดแท็บใหม่ยังเป็น admin ปกติ · refresh คงโหมด)
 */
import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { ROLE_OPTIONS, roleLabel } from '../utils/roleMeta';
import { toHierarchicalOptions } from '../utils/lineHierarchy';
import { loadPmTeams, pmTeamsSync } from '../utils/pmTeams';
import { SIDES, normalizeSides } from '../utils/logisticSide';

export default function ViewAsModal({ current, onClose, onApply }) {
  const [role, setRole] = useState(current?.role || 'leader');
  const [deptAdmin, setDeptAdmin] = useState(!!current?.deptAdmin);
  const [lineId, setLineId] = useState(current?.lineId ? String(current.lineId) : '');
  const [team, setTeam] = useState(current?.team || '');
  const [sections, setSections] = useState(current?.sections || []);
  const [mtnTeams, setMtnTeams] = useState(current?.mtnTeams || []);
  const [sides, setSides] = useState(normalizeSides(current?.sides));   // ฝั่งงาน Logistic (ชั้น 3 · 2026-09-04)
  const [lines, setLines] = useState([]);
  const [orgSections, setOrgSections] = useState([]);
  const [teamRows, setTeamRows] = useState(pmTeamsSync());

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, parent_line_name')
      .order('section').order('name')
      .then(({ data }) => setLines(data || []));
    supabase.from('org_nodes').select('code, name').eq('kind', 'section').eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setOrgSections((data || []).map(n => n.code || n.name)));
    loadPmTeams().then(rows => setTeamRows(rows || []));
  }, []);

  // role ที่จำลองได้ = base role ทั้งหมดยกเว้น admin (จำลอง admin = ไม่มีอะไรเปลี่ยน)
  const roleOpts = ROLE_OPTIONS.filter(r => r.value !== 'admin');
  const isLeader = role === 'leader';
  const toggleSection = (s) =>
    setSections(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const toggleMtnTeam = (k) =>
    setMtnTeams(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]);
  const toggleSide = (k) =>
    setSides(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]);

  const apply = () => {
    onApply({
      role,
      deptAdmin: role === 'display' ? false : deptAdmin,
      lineId: isLeader && lineId ? Number(lineId) : null,
      team: isLeader ? (team || null) : null,
      sections: isLeader ? [] : sections,
      // ⚠️ ต้องส่งไปด้วย ไม่งั้นโหมดจำลอง = ทีมช่างว่างเสมอ → ทดสอบสิทธิ์ที่ผูกกับทีมไม่ได้เลย
      //    (เช่น mtn_repair:service_own_team ที่ต้อง "ทีมของคน = ทีมของใบ" ถึงจะผ่าน)
      mtnTeams: role === 'display' ? [] : mtnTeams,
      // ฝั่งงาน Logistic — ไม่ติ๊ก = ไม่จำกัด (เหมือนบัญชีที่ยังไม่ถูกตั้งฝั่ง) · ติ๊กแล้วเมนูหมวด Logistic ฝั่งอื่นหาย
      sides: role === 'display' ? [] : sides,
    });
  };

  return (
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--card)', border: '1.5px solid #a855f7', borderRadius: 14, padding: '20px 24px', maxWidth: 480, width: '100%', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)' }}>🎭 จำลองมุมมอง role</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', padding: 4 }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 12 }}>
          ดูระบบเหมือนที่ user role นั้นเห็น (เมนู/ปุ่ม/ขอบเขตข้อมูล) — เฉพาะแท็บนี้ · ออกได้จากป้าย 🎭 ล่างจอ
        </div>
        <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 14, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', fontSize: 11.5, color: 'var(--amber)', lineHeight: 1.55 }}>
          ⚠️ จำลองเฉพาะ "การมองเห็น" ฝั่งจอ — ถ้ากดบันทึก ระบบยังบันทึกด้วยสิทธิ์จริงของบัญชี admin
          (ฝั่งฐานข้อมูลไม่ได้ถูกจำลอง) จึงควรใช้ดูอย่างเดียว
        </div>

        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 10 }}>
          Role ที่ต้องการจำลอง
          <select value={role} onChange={e => { setRole(e.target.value); setSections([]); setLineId(''); setTeam(''); }} style={{ marginTop: 4 }}>
            {roleOpts.map(r => <option key={r.value} value={r.value}>{r.icon} {r.label}</option>)}
          </select>
        </label>

        {role !== 'display' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: '#eab308', marginBottom: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={deptAdmin} onChange={e => setDeptAdmin(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: '#eab308' }} />
            🛡️ เป็นแอดมินหน่วยงานด้วย (ได้ action เพิ่มตามคอลัมน์ในหน้าจัดการสิทธิ์)
          </label>
        )}

        {isLeader ? (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', flex: 2, minWidth: 200 }}>
              ไลน์ของหัวหน้ากลุ่ม (scope = ทั้งครอบครัวไลน์)
              <select value={lineId} onChange={e => setLineId(e.target.value)} style={{ marginTop: 4 }}>
                <option value="">— ยังไม่กำหนดไลน์ —</option>
                {toHierarchicalOptions(lines).map(({ line: l, depth }) => (
                  <option key={l.id} value={l.id}>{`${'  '.repeat(depth)}${depth ? '↳ ' : ''}${l.name}`}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', flex: 1, minWidth: 90 }}>
              ทีม
              <select value={team} onChange={e => setTeam(e.target.value)} style={{ marginTop: 4 }}>
                <option value="">—</option>
                {['A', 'B', 'C'].map(t => <option key={t} value={t}>Team {t}</option>)}
              </select>
            </label>
          </div>
        ) : role !== 'display' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>
              จำกัดขอบเขตส่วนงาน (ไม่ติ๊ก = ไม่จำกัด — เห็นทั้งโรงงานตามกติกา role)
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {orgSections.map(s => (
                <button key={s} onClick={() => toggleSection(s)}
                  style={{
                    padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    border: sections.includes(s) ? '2px solid var(--accent)' : '1px solid var(--border2)',
                    background: sections.includes(s) ? 'var(--accent-dim)' : 'var(--bg3)',
                    color: sections.includes(s) ? 'var(--accent)' : 'var(--text2)',
                  }}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {/* 🔧 ทีมช่างซ่อม (profiles.mtn_teams) — จำเป็นกับสิทธิ์ที่ผูกกับ "ทีมของตัวเอง"
            เช่นใบซ่อมขั้น 2-4 ของทีมตัวเอง · ไม่ติ๊ก = เหมือน user ที่ยังไม่ถูกตั้งทีม */}
        {role !== 'display' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>
              🔧 ทีมช่างซ่อมที่สังกัด (ไม่ติ๊ก = ไม่ได้ถูกตั้งทีม — ใบซ่อมขั้น 2-4 จะทำไม่ได้)
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(teamRows || []).map(t => (
                <button key={t.key} onClick={() => toggleMtnTeam(t.key)}
                  style={{
                    padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    border: mtnTeams.includes(t.key) ? '2px solid var(--accent)' : '1px solid var(--border2)',
                    background: mtnTeams.includes(t.key) ? 'var(--accent-dim)' : 'var(--bg3)',
                    color: mtnTeams.includes(t.key) ? 'var(--accent)' : 'var(--text2)',
                  }}>{t.icon ? `${t.icon} ` : ''}{t.dept_name || t.label || t.key}</button>
              ))}
            </div>
          </div>
        )}

        {/* 📥📤🧭 ฝั่งงาน Logistic (profiles.logistic_sides) — ด่านชั้น 2 ของ canAccessPage สำหรับหน้าในหมวด Logistic
            ไม่ติ๊ก = ไม่จำกัด · ติ๊กแล้วเห็นเฉพาะหมวดของฝั่งนั้น (หน้าที่คาบ 2 ฝั่ง เช่น เฝ้าระวังสต๊อก ผ่านทั้งคู่) */}
        {role !== 'display' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>
              📦 ฝั่งงาน Logistic (ไม่ติ๊ก = ไม่จำกัด — เห็นหมวด Logistic ครบทุกฝั่งตามกติกา role)
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {SIDES.map(s => (
                <button key={s.key} onClick={() => toggleSide(s.key)} title={`${s.owner} — ${s.desc}`}
                  style={{
                    padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    border: sides.includes(s.key) ? `2px solid ${s.color}` : '1px solid var(--border2)',
                    background: sides.includes(s.key) ? `${s.color}22` : 'var(--bg3)',
                    color: sides.includes(s.key) ? s.color : 'var(--text2)',
                  }}>{s.icon} {s.label}</button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            ยกเลิก
          </button>
          <button onClick={apply}
            style={{ flex: 1.4, padding: '10px 0', borderRadius: 8, border: 'none', background: '#a855f7', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
            🎭 เริ่มจำลองเป็น {roleLabel(role)}
          </button>
        </div>
      </div>
    </div>
  );
}
