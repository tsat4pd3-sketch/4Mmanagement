/*
  MonthlyReviewExport — modal เลือกเดือน + ส่วนงาน→กลุ่ม→ไลน์ (hierarchy) → generate .pptx
  ใช้จากปุ่ม 📽️ ใน /oee-analytics (สิทธิ์ oee:export_review)
  ตัวหนัก (pptxgenjs + builder) lazy-load ตอนกด generate เท่านั้น

  hierarchy picker (2026-08-24 · คำสั่ง user "เลือก by line ไม่ได้ ควรเลือกได้ตาม hierarchy"):
    ติ๊กได้ 3 ระดับ ส่วนงาน → กลุ่มไลน์ (parent_line_name) → ไลน์ leaf
    ติ๊กตัวแม่ = ติ๊ก/ถอนลูกทั้งหมด (§5.3 cascade) · ติ๊กลูกบางตัว = ตัวแม่ขึ้น indeterminate
    สัญญาเดิมกับ builder ไม่เปลี่ยน: ส่ง sections = [{code, lines:[leaf ที่ติ๊ก]}]

  ธีม R01: โลโก้ default = src/assets/tsg/ts-logo-r01.png (doc_forms.logo_url override ได้)
  รูปประกอบ (แถบท้ายปก + divider) โหลดเป็น dataURL ที่นี่แล้วส่งเข้า builder
  — builder ห้าม import รูปเอง (เหตุผลใน monthlyReviewPptx.js)
*/
import { useState, useEffect, useMemo, useContext, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { inSectionScope } from '../utils/sectionScope';
import { toast } from './Toast';
import { docFormSync, loadDocForms } from '../utils/docForms';
import tsLogoR01 from '../assets/tsg/ts-logo-r01.png';
import titleA from '../assets/tsg/title-a.jpg';
import titleB from '../assets/tsg/title-b.jpg';
import titleC from '../assets/tsg/title-c.jpg';
import titleD from '../assets/tsg/title-d.jpg';
import dividerImg from '../assets/tsg/divider.jpg';

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

/* checkbox ที่โชว์สถานะ "เลือกบางส่วน" ได้ (indeterminate ตั้งผ่าน DOM เท่านั้น) */
function TriBox({ state, onChange }) { // state: 'all' | 'some' | 'none'
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = state === 'some'; }, [state]);
  return <input ref={ref} type="checkbox" checked={state === 'all'} onChange={onChange} />;
}

export default function MonthlyReviewExport({ onClose }) {
  const { fullName, position, sections: scopeSecs } = useContext(UserContext);
  const [monthKey, setMonthKey] = useState(prevMonthKey());
  // tree: [{ code, groups: [{ name, lines: [leafName...] }] }]
  const [tree, setTree] = useState([]);
  const [selLines, setSelLines] = useState(() => new Set()); // leaf ที่ติ๊ก
  const [openSecs, setOpenSecs] = useState({});              // section → กางอยู่ไหม
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
      let secs = (nodes || []).map(n => n.code);
      if (!secs.length) secs = [...new Set(lineArr.map(l => l.section).filter(Boolean))].sort();
      const scoped = secs.filter(c => !scopeSecs?.length || inSectionScope(scopeSecs, c));
      const out = scoped.map(code => {
        const leaves = lineArr.filter(l => l.section === code && !parentNames.has(l.name));
        // จัดกลุ่มตามไลน์แม่ (ไลน์เดี่ยวไม่มีแม่ = กลุ่มของตัวเอง)
        const byGroup = {};
        leaves.forEach(l => {
          const g = l.parent_line_name || l.name;
          (byGroup[g] = byGroup[g] || []).push(l.name);
        });
        const groups = Object.keys(byGroup).sort().map(g => ({ name: g, lines: byGroup[g].sort() }));
        return { code, groups };
      }).filter(s => s.groups.length);
      setTree(out);
      setSelLines(new Set(out.flatMap(s => s.groups.flatMap(g => g.lines)))); // default = ทุกไลน์ใน scope
    })();
  }, [scopeSecs]);

  const linesOfSec = (s) => s.groups.flatMap(g => g.lines);
  const stateOf = (lines) => {
    const n = lines.filter(l => selLines.has(l)).length;
    return n === 0 ? 'none' : n === lines.length ? 'all' : 'some';
  };
  const toggleLines = (lines) => setSelLines(prev => {
    const next = new Set(prev);
    const allIn = lines.every(l => next.has(l));
    lines.forEach(l => { if (allIn) next.delete(l); else next.add(l); });
    return next;
  });

  const selSections = useMemo(() =>
    tree.map(s => ({
      code: s.code,
      lines: linesOfSec(s).filter(l => selLines.has(l)),
      // ชื่อไลน์แม่ (กลุ่ม) ที่มี leaf ถูกติ๊ก — builder ใช้จับข้อมูลเสริมที่อ้างชื่อไลน์แม่
      // (LPA/เครื่อง PM/MO/4M มักผูกกับไลน์แม่ ไม่ใช่ไลน์ลูกที่เปิดกะ) · optional ไม่กระทบสัญญาเดิม
      groups: s.groups.filter(g => g.lines.some(l => selLines.has(l))).map(g => g.name),
    })).filter(s => s.lines.length),
  [tree, selLines]);
  const totalSel = useMemo(() => selSections.reduce((a, s) => a + s.lines.length, 0), [selSections]);

  const handleGenerate = async () => {
    if (!selSections.length) { toast.error('เลือกอย่างน้อย 1 ไลน์'); return; }
    setBusy(true);
    try {
      const { buildMonthlyReviewData, generateMonthlyReviewPptx } = await import('../lib/monthlyReviewPptx');
      toast.info('กำลังรวบรวมข้อมูล…');
      const data = await buildMonthlyReviewData({ monthKey, sections: selSections });
      // โหลดข้อมูลบางส่วนไม่สำเร็จ = บอกดังๆ แล้วให้ผู้ใช้ตัดสินใจ (ห้ามปล่อยเด็คตัวเลขต่ำกว่าจริงออกไปเงียบๆ)
      if (data.dataWarn) toast.error('⚠ โหลด downtime/ของเสีย/ใบงานไม่ครบ — ตัวเลข DT/PPM ในเด็คอาจต่ำกว่าจริง ลองใหม่อีกครั้ง');
      const df = docFormSync('monthly_review', {});
      const [logoDataUrl, ...photoUrls] = await Promise.all([
        urlToDataUrl(df.logo_url || tsLogoR01),
        urlToDataUrl(titleA), urlToDataUrl(titleB), urlToDataUrl(titleC), urlToDataUrl(titleD),
        urlToDataUrl(dividerImg),
      ]);
      const [pA, pB, pC, pD, pDiv] = photoUrls;
      toast.info('กำลังสร้างไฟล์ PowerPoint…');
      const fname = await generateMonthlyReviewPptx(data, {
        logoDataUrl,
        photos: {
          strip: [pA, pB, pC, pD].filter(Boolean),
          dividers: [pDiv, pA, pB, pC].filter(Boolean), // สลับรูปต่อส่วนงาน
        },
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
  const rowSt = { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 };
  return (
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(96vw, 640px)', maxHeight: '92vh', overflowY: 'auto' }}>
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
            <div style={lb}>ขอบเขตรายงาน — ติ๊กได้ตั้งแต่ทั้งส่วนงาน จนถึงรายไลน์ (เลือกแล้ว {totalSel} ไลน์)</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {tree.map(s => {
                const secLines = linesOfSec(s);
                const st = stateOf(secLines);
                const open = openSecs[s.code] ?? false;
                return (
                  <div key={s.code} style={{ border: `1px solid ${st !== 'none' ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ ...rowSt, fontWeight: 800, color: st !== 'none' ? 'var(--accent)' : 'var(--text2)' }}>
                        <TriBox state={st} onChange={() => toggleLines(secLines)} />
                        {s.code}
                        <span style={{ fontWeight: 400, color: 'var(--muted)' }}>
                          ({secLines.filter(l => selLines.has(l)).length}/{secLines.length} ไลน์)
                        </span>
                      </label>
                      <button onClick={() => setOpenSecs(p => ({ ...p, [s.code]: !open }))}
                        style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, padding: '2px 6px' }}>
                        {open ? '▾ ย่อ' : '▸ เจาะรายไลน์'}
                      </button>
                    </div>
                    {open && (
                      <div style={{ marginTop: 8, display: 'grid', gap: 6, paddingLeft: 8 }}>
                        {s.groups.map(g => (
                          <div key={g.name}>
                            {(g.lines.length > 1 || g.name !== g.lines[0]) && (
                              <label style={{ ...rowSt, fontWeight: 700, fontSize: 12.5, color: 'var(--text2)' }}>
                                <TriBox state={stateOf(g.lines)} onChange={() => toggleLines(g.lines)} />
                                {g.name}
                              </label>
                            )}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingLeft: g.lines.length > 1 ? 20 : 0, marginTop: 4 }}>
                              {g.lines.map(l => (
                                <label key={l} style={{ ...rowSt, fontSize: 12, padding: '3px 9px', borderRadius: 7, border: `1px solid ${selLines.has(l) ? 'var(--accent)' : 'var(--border)'}`, color: selLines.has(l) ? 'var(--accent)' : 'var(--muted)' }}>
                                  <input type="checkbox" checked={selLines.has(l)} onChange={() => toggleLines([l])} />
                                  {l}
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {!tree.length && <span style={{ fontSize: 12, color: 'var(--muted)' }}>กำลังโหลด…</span>}
            </div>
          </div>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><div style={lb}>ผู้นำเสนอ</div><input type="text" value={presenter} onChange={e => setPresenter(e.target.value)} style={{ width: '100%' }} /></div>
            <div><div style={lb}>ตำแหน่ง</div><input type="text" value={presPosition} onChange={e => setPresPosition(e.target.value)} style={{ width: '100%' }} /></div>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
            สร้างเด็ค PowerPoint ตาม template TSG <b>Revision 01</b> (พื้นขาว · เขียว-ส้มชุดใหม่ · โลโก้ใหม่)
            จากข้อมูลกะที่ปิดแล้วของเดือนที่เลือก — Executive Summary → กราฟ OEE รายไลน์ →
            รายส่วน/ไลน์ → Top Downtime + <b>วิธีแก้ไข/ผลติดตามที่หัวหน้างานลงในระบบ</b> + ใบซ่อม MO →
            Top Defects → Focus เดือนถัดไป · ไฟล์เปิดแก้/เติม story ต่อใน PowerPoint ได้ก่อนขึ้นประชุม
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
