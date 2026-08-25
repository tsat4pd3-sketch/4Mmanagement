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
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { cachedMaster } from '../utils/masterCache';

const ptsStr = (pts) => (pts || []).map(p => `${p[0]},${p[1]}`).join(' ');
/* จุดยึดป้าย = กึ่งกลางแนวนอน + ขอบบนของ polygon (สูตรเดียวกับ /factory-map) */
const anchorOf = (pts) => (pts?.length
  ? [(Math.min(...pts.map(p => p[0])) + Math.max(...pts.map(p => p[0]))) / 2, Math.min(...pts.map(p => p[1]))]
  : [50, 50]);

const DIM = { color: '#4b5563', blink: false, label: null };

export default function FactoryMiniMap({ stateOf, onPick, maxHeight = 'calc(100vh - 320px)', minHeight }) {
  const [map, setMap] = useState(null);      // { image_url }
  const [regions, setRegions] = useState([]);
  const [err, setErr] = useState(null);

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
    <div style={{
      position: 'relative', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)',
      background: '#0a0a0f', maxHeight, minHeight, display: 'flex', justifyContent: 'center',
    }}>
      <div style={{ position: 'relative', width: '100%' }}>
        <img src={map.image_url} alt="ผังโรงงาน" style={{ display: 'block', width: '100%', height: 'auto', userSelect: 'none' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(6,8,14,0.30)', pointerEvents: 'none' }} />

        {/* ⚠️ preserveAspectRatio=none + vector-effect: non-scaling-stroke — พิกัดเป็น % ของรูปจริง
            (สูตรเดียวกับ /factory-map · เปลี่ยนแล้วกรอบจะเลื่อนไม่ตรงผัง) */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {regions.map(r => {
            const st = stateOf?.(r.line_name) || DIM;
            return (
              <polygon key={r.id} points={ptsStr(r.points)}
                className={st.blink ? 'region-alarm' : undefined}
                fill={st.blink ? undefined : `${st.color}${st.label ? '4d' : '1f'}`}
                stroke={st.blink ? undefined : st.color}
                strokeWidth={st.label ? '3' : '1.4'} vectorEffect="non-scaling-stroke" strokeLinejoin="round"
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
