/* ══════════════════════════════════════════════════════════════════════════
   🗺️ <FactoryMiniMap> — ผังโรงงานแบบ "อ่านอย่างเดียว" เอาไปแปะในจออื่นได้

   ⚠️ **ไม่ใช่ผังรวมโรงงานตัวที่ 2** — อ่าน `factory_map` + `factory_line_regions`
      ชุดเดียวกับ `/factory-map` เป๊ะๆ (แก้ผัง/ตีกรอบยังทำที่ `/layout-setup` ที่เดียว)
      กฎ CLAUDE.md ห้าม "สร้างผังรวมโรงงานอันใหม่" = ห้ามมีข้อมูลกรอบชุดที่ 2
      ไม่ได้ห้ามเอาข้อมูลชุดเดิมไปวาดในจออื่น

   ใช้ที่: จอห้องช่าง (`/dept-dashboard?dept=maintenance&view=andon`)
   ต่างจาก `/factory-map`: ไม่มี metric tabs · ไม่มี hover card · ไม่มีโหมดแก้ผัง
                          วาดเฉพาะสีสถานะ + ป้ายเฉพาะไลน์ที่ผิดปกติ (จอ TV ต้องอ่านเร็ว)

   stateOf(lineName) → { color, blink, label } | null   (null = ไม่มีข้อมูล → เทาจาง)
   ══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { cachedMaster } from '../utils/masterCache';

const ptsStr = (pts) => (pts || []).map(p => `${p[0]},${p[1]}`).join(' ');
/* จุดยึดป้าย = กึ่งกลางแนวนอน + ขอบบนของ polygon (สูตรเดียวกับ /factory-map) */
const anchorOf = (pts) => (pts?.length
  ? [(Math.min(...pts.map(p => p[0])) + Math.max(...pts.map(p => p[0]))) / 2, Math.min(...pts.map(p => p[1]))]
  : [50, 50]);

// สี "ไม่ได้เปิดกะ" = CAT.idle ของ /factory-map (ห้ามใช้สีอื่น — จอเดียวกันต้องอ่านสีเหมือนกัน)
const DIM = { color: '#6b7280', blink: false, label: null };

export default function FactoryMiniMap({ stateOf, onPick, bottomReserve = 28 }) {
  const [map, setMap] = useState(null);      // { image_url }
  const [regions, setRegions] = useState([]);
  const [err, setErr] = useState(null);
  /* aspect ratio จริงของรูป (naturalWidth/Height) — ใช้คุมความสูงผ่าน maxWidth (ดูคอมเมนต์ตอน render)
     ⚠️ อ่านผ่าน ref ด้วย ไม่พึ่ง onLoad อย่างเดียว: รูปผังถูก cache ไว้แล้ว (จอ TV เปิดค้างทั้งวัน
     refresh บ่อย) บางจังหวะ browser โหลดเสร็จก่อน React ผูก handler → onLoad ไม่ยิง → ar ค้าง null
     → maxWidth หายไป เหลือแต่ clamp ความสูง = **รูปโดนตัด** ซึ่งคืออาการ "สเกลแย่" ที่หน้างานเห็น */
  const [ar, setAr] = useState(null);
  const imgRef = useRef(null);
  const readAr = useCallback(() => {
    const t = imgRef.current;
    if (t?.naturalWidth > 0 && t?.naturalHeight > 0) setAr(t.naturalWidth / t.naturalHeight);
  }, []);

  /* ⛔ ความสูงที่ผังมีให้ใช้ = **วัดจริง** ห้ามเดา `calc(100vh - Npx)` (กฎ UI §6.8)
     เดาแล้วพังทุกครั้งที่ header เปลี่ยน — ซึ่งเกิดจริง 3 รอบ (ยุบแถบแท็บ / ชิปทีมขึ้นบรรทัดใหม่ /
     แถบเตือนโผล่) แล้วผู้ใช้เห็นเป็น "สเกลแย่" ทุกครั้ง
     ⚠️ ใช้ `rect.top + scrollY` (ตำแหน่งเทียบ *เอกสาร*) ไม่ใช่ `rect.top` เฉยๆ —
        ไม่งั้นพอเลื่อนหน้า ผังจะโตขึ้นเรื่อยๆ แล้วหน้ายิ่งยาว
     ไม่เกิดลูป: ความสูงของผังเองไม่กระทบตำแหน่งบนของผัง (ผังอยู่ใต้ header เสมอ) */
  const wrapRef = useRef(null);
  const [availH, setAvailH] = useState(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const docTop = el.getBoundingClientRect().top + window.scrollY;
      setAvailH(Math.max(220, Math.round(window.innerHeight - docTop - bottomReserve)));
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(document.body);   // header สูงเปลี่ยนได้เอง (ชิปขึ้นบรรทัดใหม่ / แถบเตือนโผล่)
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
    // ⚠️ ต้องมี map?.image_url ใน deps — ก่อนโหลดผังเสร็จ wrapper ยังไม่ mount (ref เป็น null)
    //    ถ้าไม่ใส่ effect จะวิ่งรอบเดียวตอน mount แล้วไม่มีวันได้วัดเลย
  }, [bottomReserve, map?.image_url]);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        // master เปลี่ยนนานๆ ครั้ง → cache ตามกฎ egress (ห้าม poll รูปผัง/กรอบซ้ำๆ)
        const [m, r] = await Promise.all([
          cachedMaster('factory_map', async () => {
            const { data, error } = await supabase.from('factory_map').select('id, image_url')
              .order('updated_at', { ascending: false }).limit(1).maybeSingle();
            if (error) throw error;
            return data;
          }),
          cachedMaster('factory_line_regions', async () => {
            const { data, error } = await supabase.from('factory_line_regions').select('id, line_name, points');
            if (error) throw error;
            return data || [];
          }),
        ]);
        if (dead) return;
        setMap(m); setRegions(r || []);
      } catch (e) { if (!dead) setErr(e?.message || 'โหลดผังไม่สำเร็จ'); }
    })();
    return () => { dead = true; };
  }, []);

  // รูปที่อยู่ใน cache อาจ complete ไปแล้วตั้งแต่ก่อน React ผูก onLoad → อ่าน naturalWidth เองอีกทาง
  useEffect(() => { readAr(); }, [map?.image_url, readAr]);

  /* ป้ายชื่อวาดเฉพาะไลน์ที่ "ผิดปกติ" — จอ TV ต้องกวาดตาเจอจุดที่ต้องไปทันที
     (ถ้าวาดครบทุกไลน์จะทับกันเอง ซึ่ง /factory-map มีอัลกอริทึมกันทับของตัวเอง — ที่นี่ไม่ต้อง) */
  const marks = useMemo(() => regions
    .map(r => ({ r, st: stateOf?.(r.line_name) }))
    .filter(x => x.st?.label)
    .map(x => ({ ...x, at: anchorOf(x.r.points) })), [regions, stateOf]);

  if (err) return <div style={box}>⚠ โหลดผังโรงงานไม่สำเร็จ — {err}</div>;
  if (!map?.image_url) {
    return <div style={box}>ยังไม่มีรูปผังโรงงาน — ให้ผู้ดูแลอัปโหลดที่ ตั้งค่าผัง/Floorplan ก่อน</div>;
  }

  return (
    /* ⚠️ สเกล = "กติกาเดียวกับ /factory-map": img width:100% height:auto (aspect จริง width-driven)
       ห้ามกลับไปใช้ maxHeight + overflow:hidden บนกรอบ — นั่นคือการ "ตัดรูป" ไม่ใช่ย่อ
       (user ทัก 2026-08-26 "สเกลภาพแย่มาก ทำไมใช้คนละสเกลกับผังรวมโรงงาน")
       ความสูงคุมด้วย maxWidth = availH × aspect (contain) — overlay inset:0 ยังตรงรูปเป๊ะ
       เพราะ wrapper กว้างเท่ารูปเสมอ (ถ้าไปคุมที่ img ตรงๆ รูปจะแคบกว่า wrapper แล้วกรอบเลื่อน) */
    <div ref={wrapRef} style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{
        position: 'relative', width: '100%', borderRadius: 10, overflow: 'hidden',
        border: '1px solid var(--border)', background: '#0a0a0f',
        maxWidth: ar && availH ? availH * ar : undefined,
        /* กันภาพสูงพรวดก่อน onLoad (ยังไม่รู้ aspect) — ตั้งให้ **ใหญ่กว่าสูตรความกว้าง 10px**
           เหมือน /factory-map (สูตร 210px vs clamp 200px) → สูตรความกว้างชนะเสมอ ไม่มีทาง crop */
        maxHeight: availH ? availH + 10 : undefined,
      }}>
        <img ref={imgRef} src={map.image_url} alt="ผังโรงงาน" onLoad={readAr}
          style={{ display: 'block', width: '100%', height: 'auto', userSelect: 'none' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(6,8,14,0.14)', pointerEvents: 'none' }} />

        {/* ⚠️ preserveAspectRatio=none + vector-effect: non-scaling-stroke — พิกัดเป็น % ของรูปจริง
            (สูตรเดียวกับ /factory-map · เปลี่ยนแล้วกรอบจะเลื่อนไม่ตรงผัง) */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {regions.map(r => {
            const st = stateOf?.(r.line_name) || DIM;
            return (
              <polygon key={r.id} points={ptsStr(r.points)}
                className={st.blink ? 'region-alarm' : undefined}
                /* ค่าเดียวกับ /factory-map เป๊ะ: ปกติ = fill 2b / stroke 1.75 · ไลน์ที่มีปัญหาใช้ค่า
                   "ไฮไลต์" ของผังรวม (55 / 3.5) — ต่างกันได้แค่ "เน้น" ห้ามต่างกันที่สเกล/สี */
                fill={st.blink ? undefined : `${st.color}${st.label ? '55' : '2b'}`}
                stroke={st.blink ? undefined : st.color}
                strokeWidth={st.label ? '3.5' : '1.75'} vectorEffect="non-scaling-stroke" strokeLinejoin="round"
                style={{ pointerEvents: onPick ? 'auto' : 'none', cursor: onPick ? 'pointer' : 'default' }}
                onClick={onPick ? () => onPick(r.line_name) : undefined} />
            );
          })}
        </svg>

        {/* ป้าย = HTML (ไม่โดน viewBox ยืดผิดสัดส่วน — กฎเดียวกับ marker บนผังไลน์) */}
        {marks.map(({ r, st, at }) => (
          <div key={`lb-${r.id}`}
            onClick={onPick ? () => onPick(r.line_name) : undefined}
            className={st.blink ? 'dt-alarm-blink' : undefined}
            style={{
              position: 'absolute', left: `${at[0]}%`, top: `${at[1]}%`, transform: 'translate(-50%, -108%)',
              background: 'rgba(9,11,18,0.92)', border: `2px solid ${st.color}`, borderRadius: 8,
              padding: '3px 9px', whiteSpace: 'nowrap', pointerEvents: onPick ? 'auto' : 'none',
              cursor: onPick ? 'pointer' : 'default', maxWidth: '46%', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: '#fff' }}>{r.line_name}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: st.color, marginLeft: 7 }}>{st.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const box = {
  padding: 34, textAlign: 'center', color: 'var(--muted)', fontSize: 13,
  background: 'var(--card)', border: '1px dashed var(--border2)', borderRadius: 12,
};
