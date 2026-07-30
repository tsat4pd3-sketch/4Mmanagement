/*
  MonthlyReviewExport — modal เลือกเดือน + ส่วนงาน → generate Monthly Performance Review (.pptx)
  ใช้จากปุ่ม 📽️ ใน /oee-analytics (สิทธิ์ oee:export_review)
  ตัวหนัก (pptxgenjs + builder) lazy-load ตอนกด generate เท่านั้น
*/
import { useState, useEffect, useMemo, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { inSectionScope } from '../utils/sectionScope';
import { toast } from './Toast';
import { docFormSync, loadDocForms } from '../utils/docForms';
import tsLogoUrl from '../assets/TS logo.png';

async function urlToDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
  } catch { return null; }
}

const prevMonthKey = () => {
  const d = new Date();
  d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function MonthlyReviewExport({ onClose }) {
  const { fullName, position, sections: scopeSecs } = useContext(UserContext);
  const [monthKey, setMonthKey] = useState(prevMonthKey());
  const [orgSections, setOrgSections] = useState([]); // [{code, lines:[leafName...]}]
  const [selected, setSelected] = useState([]);       // section codes ที่ติ๊ก
  const [busy, setBusy] = useState(false);
  const [presenter, setPresenter] = useState(fullName || '');
  const [presPosition, setPresPosition] = useState(position || '');

  useEffect(() => {
    (async () => {
      loadDocForms();
      // section จากผังองค์กร (กฎ: section picker ยึด org_nodes) + fallback production_lines
      const [{ data: nodes }, { data: lines }] = await Promise.all([
        supabase.from('org_nodes').select('code, kind, sort_order').eq('kind', 'section').order('sort_order'),
        supabase.from('production_lines').select('name, section, parent_line_name'),
      ]);
      const lineArr = lines || [];
      const parentNames = new Set(lineArr.map(l => l.parent_line_name).filter(Boolean));
      const leavesOf = (sec) => lineArr.filter(l => l.section === sec && !parentNames.has(l.name)).map(l => l.name);
      let secs = (nodes || []).map(n => n.code);
      if (!secs.length) secs = [...new Set(lineArr.map(l => l.section).filter(Boolean))].sort();
      const scoped = secs.filter(c => !scopeSecs?.length || inSectionScope(scopeSecs, c));
      const out = scoped.map(code => ({ code, lines: leavesOf(code) })).filter(s => s.lines.length);
      setOrgSections(out);
      setSelected(out.map(s => s.code)); // default = ทุก section ใน scope
    })();
  }, [scopeSecs]);

  const toggle = (code) => setSelected(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  const selSections = useMemo(() => orgSections.filter(s => selected.includes(s.code)), [orgSections, selected]);

  const handleGenerate = async () => {
    if (!selSections.length) { toast.error('เลือกอย่างน้อย 1 ส่วนงาน'); return; }
    setBusy(true);
    try {
      const { buildMonthlyReviewData, generateMonthlyReviewPptx } = await import('../lib/monthlyReviewPptx');
      toast.info('กำลังรวบรวมข้อมูล…');
      const data = await buildMonthlyReviewData({ monthKey, sections: selSections });
      const df = docFormSync('monthly_review', {});
      const logoDataUrl = await urlToDataUrl(df.logo_url || tsLogoUrl);
      toast.info('กำลังสร้างไฟล์ PowerPoint…');
      const fname = await generateMonthlyReviewPptx(data, {
        logoDataUrl,
        presenter,
        position: presPosition,
        orgLine: 'Thai Summit Automotive Plant4',
        docForm: df,
      });
      toast.success(`ดาวน์โหลดแล้ว: ${fname}`);
      onClose?.();
    } catch (e) {
      toast.error(e.message || 'สร้างรายงานไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  const lb = { fontSize: 12, color: 'var(--muted)', marginBottom: 4, fontWeight: 700 };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(96vw, 560px)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>📽️ Monthly Performance Review (.pptx)</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={lb}>เดือนรายงาน</div>
            <input type="month" value={monthKey} onChange={e => setMonthKey(e.target.value)} style={{ width: 180 }} />
          </div>
          <div>
            <div style={lb}>ส่วนงานที่รวมในรายงาน (เรียงตามผังองค์กร)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {orgSections.map(s => (
                <label key={s.code} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: `1px solid ${selected.includes(s.code) ? 'var(--accent)' : 'var(--border)'}`, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: selected.includes(s.code) ? 'var(--accent)' : 'var(--text2)' }}>
                  <input type="checkbox" checked={selected.includes(s.code)} onChange={() => toggle(s.code)} />
                  {s.code} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>({s.lines.length} ไลน์)</span>
                </label>
              ))}
              {!orgSections.length && <span style={{ fontSize: 12, color: 'var(--muted)' }}>กำลังโหลด…</span>}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><div style={lb}>ผู้นำเสนอ</div><input type="text" value={presenter} onChange={e => setPresenter(e.target.value)} style={{ width: '100%' }} /></div>
            <div><div style={lb}>ตำแหน่ง</div><input type="text" value={presPosition} onChange={e => setPresPosition(e.target.value)} style={{ width: '100%' }} /></div>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
            สร้างเด็ค PowerPoint ตาม template TSG จากข้อมูลกะที่ปิดแล้วของเดือนที่เลือก
            (Executive Summary → OEE/A/P/Q รายส่วน/ไลน์ → Top Downtime + การแก้ไขจากใบซ่อม MO → Focus เดือนถัดไป)
            — ไฟล์เปิดแก้/เติม story ต่อใน PowerPoint ได้ก่อนขึ้นประชุม
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onClose} disabled={busy} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text2)', cursor: 'pointer', fontWeight: 700 }}>ยกเลิก</button>
            <button onClick={handleGenerate} disabled={busy} style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 800, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>
              {busy ? '⏳ กำลังสร้าง…' : '📽️ สร้างไฟล์ .pptx'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
