/* ══════════════════════════════════════════════════════════════════════
   SkillRadarPanel — การ์ดสรุปทักษะรายบุคคล (radar + แถบคะแนนแยกหมวด
   + ปุ่มพิมพ์ใบประเมิน F-PRS-P1-119)

   component กลาง (ย้ายออกจาก Report.jsx 2026-08-06 · เดิมชื่อ OperatorRadarPanel)
   ใช้ร่วมกัน: Skill Matrix (/skills-report) · ฐานข้อมูลพนักงาน (/operator)
   → จุดใหม่ที่อยากโชว์สกิลรายคนให้ reuse ตัวนี้ ห้ามก๊อป modal ใหม่

   props:
     emp             พนักงาน 1 คน — ต้อง select employee_skills(skill_name, score) มาด้วย
     skillDefs       skill_definitions ทั้งหมด
     subItemsByskill { [skill_name]: [{seq,label,wi_ref}] } — ใช้ตอนพิมพ์ (ไม่ส่ง = 1 แถว/สกิล)
     lines           production_lines (id, section) — ใช้เดาแผนกในหัวใบพิมพ์
     onClose         ปิดการ์ด

   เป็น popup แสดงผลอย่างเดียว (ไม่มีช่องกรอก) → ปิดด้วยคลิกนอกกรอบได้ตาม UI-CONVENTIONS §5
   ══════════════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from 'recharts';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import useIsMobile from '../utils/useIsMobile';
import { getLevel, groupSkillsByCategory } from '../utils/skillLevels';
import { docFormSync, loadDocForms } from '../utils/docForms';
import { loadPositions, positionLabel } from '../utils/positions';
import { buildIndividualSkillHtml } from '../lib/individualSkillPrint';
import tsLogoUrl from '../assets/TS logo.png';

/* แปลงรูป/ลายเซ็นเป็น dataURL ก่อนฝังในหน้าพิมพ์ (หน้าต่างใหม่โหลด URL เดิมไม่ทัน) */
async function urlToDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/* ── Radar tooltip ── */
function RadarTooltipContent({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { subject, value } = payload[0].payload;
  const lv = getLevel(value);
  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '7px 12px', fontSize: 12 }}>
      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{subject}</div>
      <div style={{ color: lv.color, fontWeight: 800, fontSize: 15 }}>{value}<span style={{ fontSize: 11, fontWeight: 400, marginLeft: 2 }}>/ 100</span></div>
      <div style={{ fontSize: 11, color: lv.color }}>{lv.label}</div>
    </div>
  );
}

/* ── Radar Panel ── */
export default function SkillRadarPanel({ emp, skillDefs, subItemsByskill = {}, lines = [], onClose }) {
  const narrow = useIsMobile(1023);
  const skillMap = {};
  (emp.employee_skills || []).forEach(s => { skillMap[s.skill_name] = s.score; });
  const [printing, setPrinting] = useState(false);

  const catGroups = groupSkillsByCategory(skillDefs);

  const handlePrintIndividual = async () => {
    setPrinting(true);
    try {
      // โหลดทะเบียนเอกสารก่อนเสมอ — docFormSync/fullCode/sig_blocks อ่านจาก cache ระดับ module
      // component นี้ถูก reuse หลายหน้า (บางหน้าเป็น lazy chunk ที่ไม่ได้เรียก loadDocForms() เอง)
      // ถ้าไม่โหลดที่นี่ ใบที่พิมพ์จากหน้านั้นจะได้ fallback ในโค้ดเสมอ = เลขฟอร์ม/Rev/ช่องลายเซ็น
      // ไม่ตรงกับที่ doc_control ตั้งไว้ที่ /doc-forms (โหลดแล้วครั้งเดียว เรียกซ้ำคืน cache ทันที)
      await Promise.all([loadDocForms(), loadPositions()]);   // master ตำแหน่ง — ใบพิมพ์แปลง key เป็นชื่อ
      // ดึงผู้ประเมิน (หัวหน้าแผนก/leader) + ผู้รับรอง (หัวหน้าส่วน/supervisor หรือ manager) จากไลน์ของพนักงาน
      let assessor = { name: '', pos: 'หัวหน้าแผนก', sig: null };
      let certifier = { name: '', pos: 'หัวหน้าส่วน', sig: null };
      if (emp.line_id) {
        // หา "คนเซ็น" ตามไลน์ ไม่ใช่การเช็คสิทธิ์ — จึงเทียบ role ตรงๆ ได้ (ไม่ขัดกฎห้าม hardcode role array)
        const { data: sgs } = await supabase.from('profiles')
          .select('role, full_name, position, signature_url')
          .eq('line_id', emp.line_id)
          .in('role', ['leader', 'supervisor', 'manager']);
        const ldr = (sgs || []).find(p => p.role === 'leader');
        const sv  = (sgs || []).find(p => p.role === 'supervisor');
        const mgr = (sgs || []).find(p => p.role === 'manager');
        if (ldr) assessor  = { name: ldr.full_name || '', pos: ldr.position || 'หัวหน้าแผนก', sig: ldr.signature_url || null };
        const cert = sv || mgr;
        if (cert) certifier = { name: cert.full_name || '', pos: cert.position || 'หัวหน้าส่วน', sig: cert.signature_url || null };
      }
      const dept = emp.department || (lines.find(l => l.id === emp.line_id)?.section) || emp.section || '-';
      // โลโก้: doc_forms.logo_url ถ้าอัปโหลด · ไม่งั้นไฟล์ทางการ src/assets/TS logo.png → dataURL (pattern เดียวกับ LPA/OJT)
      const [imgUrl, assessorSig, certifierSig, logoData] = await Promise.all([
        emp.image_url ? urlToDataUrl(emp.image_url) : Promise.resolve(null),
        assessor.sig  ? urlToDataUrl(assessor.sig)  : Promise.resolve(null),
        certifier.sig ? urlToDataUrl(certifier.sig) : Promise.resolve(null),
        urlToDataUrl(docFormSync('individual_skill', {}).logo_url || tsLogoUrl),
      ]);
      const html = buildIndividualSkillHtml({
        emp, skillDefs, subItemsByskill, dept,
        assessorName: assessor.name, assessorPos: assessor.pos,
        certifierName: certifier.name, certifierPos: certifier.pos,
        imgUrl, assessorSig, certifierSig, logoUrl: logoData,
      });
      const w = window.open('', '_blank'); w.document.write(html); w.document.close();
    } catch (e) {
      toast.error('พิมพ์ใบประเมินไม่สำเร็จ: ' + (e?.message || e));
    } finally {
      setPrinting(false);
    }
  };

  const radarData = skillDefs
    .map(s => ({ subject: s.label, value: skillMap[s.name] ?? 0, color: s.color || '#4d9fff', fullMark: 100 }))
    .filter(d => d.value > 0);

  const definedScores = skillDefs.map(s => skillMap[s.name]).filter(s => s !== undefined && s > 0);
  const avg = definedScores.length ? Math.round(definedScores.reduce((a, b) => a + b, 0) / definedScores.length) : 0;
  const overall = getLevel(avg);

  /* dynamic gradient based on avg */
  const glowColor = avg >= 80 ? '#22c55e' : avg >= 60 ? '#84cc16' : avg >= 40 ? '#f59e0b' : '#ef4444';

  // จอ landscape (desktop/tablet) → modal ขยายกว้าง 2 คอลัมน์ (UI-CONVENTIONS §5 — ห้ามแคบสูงแล้ว scroll)
  const wide = !narrow;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 2100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: wide ? 'min(96vw, 1040px)' : 'min(460px, 94vw)',
        maxHeight: '92vh',
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg2)',
        border: `1px solid ${glowColor}55`,
        borderRadius: 20,
        boxShadow: `0 0 40px ${glowColor}33, 0 20px 60px rgba(0,0,0,0.8)`,
        overflow: 'hidden',
        animation: 'smSlideUp 0.28s cubic-bezier(0.16,1,0.3,1)',
      }}>
        <style>{`
          @keyframes smSlideUp {
            from { opacity:0; transform:translateY(30px) scale(0.96); }
            to   { opacity:1; transform:translateY(0) scale(1); }
          }
        `}</style>

        {/* Header stripe */}
        <div style={{ height: 4, background: `linear-gradient(90deg, ${glowColor}, transparent)`, flexShrink: 0 }} />

        {/* Profile section (full width) */}
        <div style={{ padding: '20px 24px 12px', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {/* render <img> เฉพาะเมื่อมีรูปจริง — src="" ทำให้เบราว์เซอร์ยิงโหลดหน้าเดิมซ้ำ (React เตือน) */}
            {emp.image_url && (
              <img
                src={emp.image_url}
                alt=""
                onError={e => { e.target.style.display = 'none'; }}
                style={{ width: 72, height: 72, borderRadius: 14, objectFit: 'cover', border: `2px solid ${glowColor}88`, display: 'block' }}
              />
            )}
            {!emp.image_url && (
              <div style={{
                width: 72, height: 72, borderRadius: 14,
                background: `linear-gradient(135deg, ${glowColor}44, ${glowColor}22)`,
                border: `2px solid ${glowColor}88`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 26, fontWeight: 800, color: glowColor,
              }}>
                {(emp.name || '?')[0]}
              </div>
            )}
            {/* Overall ring */}
            <div style={{
              position: 'absolute', bottom: -6, right: -6,
              background: glowColor, color: '#fff',
              borderRadius: 8, padding: '1px 6px', fontSize: 11, fontWeight: 800,
              border: '2px solid var(--bg2)',
            }}>{avg}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, color: 'var(--text)', lineHeight: 1.2 }}>{emp.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{emp.employee_id_code}</div>
            <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {emp.group_name && <span style={{ fontSize: 11, background: 'var(--bg3)', color: 'var(--text2)', borderRadius: 5, padding: '2px 7px', border: '1px solid var(--border2)' }}>{emp.group_name}</span>}
              <span style={{ fontSize: 11, background: `${glowColor}22`, color: glowColor, borderRadius: 5, padding: '2px 7px', border: `1px solid ${glowColor}44`, fontWeight: 700 }}>
                {overall.label}
              </span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', padding: 4, alignSelf: 'flex-start' }}>✕</button>
        </div>

        {/* Body — desktop: 2 คอลัมน์ landscape · mobile: คอลัมน์เดียว · scroll เป็น fallback */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid', gridTemplateColumns: wide ? '1fr 1fr' : '1fr', columnGap: 8, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
        {/* Stat bars row — top 4 non-zero skills */}
        {radarData.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(radarData.length, 4)}, 1fr)`, gap: 6, padding: '0 24px 12px' }}>
          {radarData.slice(0, 4).map(d => {
            const lv = getLevel(d.value);
            return (
              <div key={d.subject} style={{ background: 'var(--bg3)', borderRadius: 8, padding: '8px 10px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.subject}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: lv.color, fontFamily: 'var(--font-display)' }}>{d.value}</div>
                <div style={{ height: 3, background: 'var(--border2)', borderRadius: 2, marginTop: 4 }}>
                  <div style={{ height: '100%', width: `${d.value}%`, background: lv.color, borderRadius: 2, transition: 'width 0.6s ease' }} />
                </div>
              </div>
            );
          })}
        </div>
        )}

        {/* Radar Chart */}
        <div style={{ padding: '0 12px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Skill Radar</div>
          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
              <PolarGrid stroke="var(--border2)" />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fill: 'var(--text2)', fontSize: 11, fontFamily: 'var(--font-body)' }}
              />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar
                dataKey="value"
                stroke={glowColor}
                fill={glowColor}
                fillOpacity={0.25}
                strokeWidth={2}
                dot={{ r: 4, fill: glowColor, strokeWidth: 0 }}
              />
              <Tooltip content={<RadarTooltipContent />} />
            </RadarChart>
          </ResponsiveContainer>
          <button onClick={handlePrintIndividual} disabled={printing} style={{
            width: '100%', marginTop: 6, padding: '9px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 700,
            cursor: printing ? 'default' : 'pointer', background: `${glowColor}18`, color: glowColor,
            border: `1px solid ${glowColor}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            opacity: printing ? 0.6 : 1,
          }}>
            {printing ? 'กำลังเตรียม...' : '🖨️ พิมพ์ใบประเมินทักษะรายบุคคล (F-PRS-P1-119)'}
          </button>
        </div>
        </div>{/* /left column */}

        {/* All skill bars grouped by category (right column on desktop) */}
        <div style={{ padding: '0 24px 20px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {catGroups.map(g => {
            const gSkills = g.skills.map(s => ({ subject: s.label, value: skillMap[s.name] ?? 0 })).filter(d => d.value > 0);
            if (gSkills.length === 0) return null;
            return (
              <div key={g.key}>
                <div style={{ marginBottom: 6, borderBottom: `1px solid ${g.color}33`, paddingBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: g.color, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{g.icon} {g.label}</span>
                  {g.desc && <span style={{ fontSize: 11, color: g.color, opacity: 0.7, marginLeft: 6 }}>{g.desc}</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {gSkills.map(d => {
                    const lv = getLevel(d.value);
                    return (
                      <div key={d.subject} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ fontSize: 11, color: 'var(--text2)', width: 90, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.subject}</div>
                        <div style={{ flex: 1, height: 6, background: 'var(--border2)', borderRadius: 3 }}>
                          <div style={{ height: '100%', width: `${d.value}%`, background: lv.color, borderRadius: 3 }} />
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: lv.color, width: 28, textAlign: 'right' }}>{d.value}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>{/* /right column */}
        </div>{/* /body */}
      </div>
    </div>
  );
}
