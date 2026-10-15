/**
 * QaPointsEditor — "ตั้งค่าจุดตรวจ" ของชิ้นงาน (QA `/qa-setup`)
 *
 * 🧩 ใช้หลักการเดียวกับ PM `/pm?tab=setup` ทุกขั้น (2026-10-15 · คำสั่ง user
 *    *"ต่างกันแค่ อุปกรณ์ vs ชิ้นงาน กับรายละเอียดที่ต้องตรวจ — user เรียนระบบเดียวแล้วทำเป็นทั้งคู่"*)
 *    โมดัลเดียวกัน (`InspectEditorModal`) · ผังรูปซ้าย/การ์ดขวาเดียวกัน (`PinWorkspace`) ·
 *    ตัวปักหมุด+ซูมเดียวกัน (`SpinAnnotator`) · เปลือกการ์ด/ปุ่มวางตำแหน่ง/รูปโคลสอัพเดียวกัน (`PointCardShell`) ·
 *    แถบไปที่จุดเดียวกัน (`PointJumpBar`) · **แก้ทั้งหมดแล้วกดบันทึกครั้งเดียว**
 *    ต่างแค่ช่องสเปคในการ์ด (Variable/Attribute · LSL/Nominal/USL · Rank · Stage · ความถี่)
 *    📄 docs/modules/inspection-point-setup.md
 *
 * ตาราง (MAIN): qa_part_drawings (แผ่นรูป) · qa_inspection_items (จุดตรวจ · pos_x/pos_y เก็บ 0–100)
 * ไฟล์: bucket `qa-drawings` → parts/<part_id>/…  · เขียนได้เฉพาะ qa:manage (RLS)
 */
import { useState, useEffect, useMemo } from 'react';
import imageCompression from 'browser-image-compression';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import SpinAnnotator from './SpinAnnotator';
import InstrumentSelect from './InstrumentSelect';
import PointCardShell from './inspect/PointCardShell';
import PinWorkspace from './inspect/PinWorkspace';
import InspectEditorModal from './inspect/InspectEditorModal';
import useWideModal from './inspect/useWideModal';
import usePointJump from './inspect/usePointJump';
import { QA_STAGES } from '../utils/qaStages';
import { specLabel } from '../utils/qaSpec';
import { uploadOpts } from '../utils/storageUpload';
import { checkWrite, checkWriteRows } from '../utils/dbWrite';
import { QA_RANK, balloonSort, nextBalloonOf } from '../utils/qaPoints';

const BUCKET = 'qa-drawings';
const PIN_DEFAULT = '#4d9fff';
/* ชื่อ view มาตรฐานของแบบ 2D orthographic — ให้ทุกคนตั้งชื่อแผ่นสม่ำเสมอ */
const STANDARD_VIEWS = [
  'Front View', 'Back View', 'Top View', 'Bottom View',
  'Side View (LH)', 'Side View (RH)', 'Isometric', 'Section A-A', 'Section B-B', 'Detail',
];

const pathOfUrl = (url) => {
  const p = url?.split(`/${BUCKET}/`)[1];
  return p ? decodeURIComponent(p.split('?')[0]) : null;
};
const publicUrl = (path) => (path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null);
const isPdfUrl = (u) => /\.pdf($|\?)/i.test(u || '');
let seq = 0;
const newKey = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;

const emptyPoint = (extra = {}) => ({
  _key: newKey(), id: null, balloon_no: '', item_type: 'variable', characteristic: '', spec_text: '',
  nominal: '', usl: '', lsl: '', unit: 'mm', method: '', stage: 'inprocess',
  frequency: '', sample_size: '5', rank: '', remark: '', is_active: true,
  pos_x: null, pos_y: null, _frameKey: null, label_dx: null, label_dy: null,
  image_path: null, _imgFile: null, _imgPreview: null, ...extra,
});

const S = {
  label: { fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.04em', display: 'block', marginBottom: 4 },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 },
  row3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 },
  typeBtn: (active, color) => ({
    flex: 1, padding: '7px 4px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
    border: `1.5px solid ${active ? `${color}80` : 'var(--border)'}`,
    background: active ? `${color}1a` : 'var(--bg2)', color: active ? color : 'var(--muted)',
  }),
};

/* ── การ์ดจุดตรวจของชิ้นงาน — เปลือกเดียวกับ PM · ข้างในเป็นสเปคแบบ QA ── */
function QaPointCard({ p, onChange, onDelete, isPinning, onPinToggle, onUnpin, hasImage, methodHist }) {
  const isVar = p.item_type === 'variable';
  return (
    <PointCardShell label={p.balloon_no || '?'} caption="จุดตรวจชิ้นงาน" pinned={p.pos_x != null}
      isPinning={isPinning} canPin={hasImage} onPinToggle={onPinToggle} onUnpin={onUnpin} onDelete={onDelete}
      inactive={!p.is_active}
      closeup={{ preview: p._imgPreview, onPick: f => onChange({ _imgFile: f }), onClear: () => onChange({ _imgFile: null, _imgPreview: null, image_path: null }) }}>
      <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, marginBottom: 8 }}>
        <input value={p.balloon_no} onChange={e => onChange({ balloon_no: e.target.value })} placeholder="No." aria-label="เลข balloon" title="เลข balloon ตามแบบ เช่น H35, A1, 7" />
        <input value={p.characteristic} onChange={e => onChange({ characteristic: e.target.value })} placeholder="ชื่อจุดตรวจ เช่น ความกว้างร่อง A" />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button type="button" onClick={() => onChange({ item_type: 'variable' })} style={S.typeBtn(isVar, '#4d9fff')}>📏 Variable (ค่าตัวเลข)</button>
        <button type="button" onClick={() => onChange({ item_type: 'attribute' })} style={S.typeBtn(!isVar, '#9b8de8')}>✅ Attribute (OK/NG)</button>
      </div>

      {isVar && (
        <>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 80px', gap: 8, marginBottom: 6 }}>
            <div><label style={{ ...S.label, color: '#e05c4a' }}>LSL</label><input type="number" step="any" value={p.lsl} onChange={e => onChange({ lsl: e.target.value })} placeholder="—" /></div>
            <div><label style={S.label}>Nominal</label><input type="number" step="any" value={p.nominal} onChange={e => onChange({ nominal: e.target.value })} placeholder="—" /></div>
            <div><label style={{ ...S.label, color: '#e05c4a' }}>USL</label><input type="number" step="any" value={p.usl} onChange={e => onChange({ usl: e.target.value })} placeholder="—" /></div>
            <div><label style={S.label}>หน่วย</label><input value={p.unit} onChange={e => onChange({ unit: e.target.value })} placeholder="mm" /></div>
          </div>
          {/* พรีวิวจากค่าชุดเดียวกับที่ตัดสินอัตโนมัติ (utils/qaSpec — ห้ามประกอบข้อความสเปคเอง) */}
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
            จอตรวจจะแสดงสเปคว่า <b style={{ color: 'var(--text)' }}>{specLabel(p)}</b>
            {p.lsl === '' && p.usl === '' && <span style={{ color: '#f59e0b' }}> · ยังไม่ตั้ง LSL/USL — ระบบไม่ตัดสินอัตโนมัติ</span>}
          </div>
        </>
      )}
      <div style={{ marginBottom: 8 }}>
        <label style={S.label}>{isVar ? 'ข้อความตามแบบ (แสดงเมื่อไม่ได้ตั้ง LSL/USL)' : 'เกณฑ์ตัดสิน (Quality standard)'}</label>
        <input value={p.spec_text} onChange={e => onChange({ spec_text: e.target.value })} placeholder={isVar ? 'เช่น "5 ± 1.5"' : 'เช่น ไม่มีครีบ / GO-NOGO ผ่าน'} />
      </div>

      <div className="mgrid" style={S.row2}>
        <div>
          <label style={S.label}>วิธี / เครื่องมือตรวจ</label>
          {/* ทะเบียนเครื่องมือวัด (Main qa_instruments) โหลด+cache ใน <InstrumentSelect> เอง */}
          <InstrumentSelect value={p.method} history={methodHist} onChange={v => onChange({ method: v })} placeholder="Vernier / CF / Visual…" />
        </div>
        <div>
          <label style={S.label}>Rank (◆ M / SC)</label>
          <select value={p.rank} onChange={e => onChange({ rank: e.target.value })}>
            <option value="">— ไม่ระบุ —</option>
            <option value="M">M</option>
            <option value="SC">SC (Significant Characteristic)</option>
          </select>
        </div>
      </div>
      <div className="mgrid" style={S.row3}>
        <div>
          <label style={S.label}>Stage</label>
          <select value={p.stage} onChange={e => onChange({ stage: e.target.value })}>
            {Object.entries(QA_STAGES).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
          </select>
        </div>
        <div><label style={S.label}>ความถี่</label><input value={p.frequency} onChange={e => onChange({ frequency: e.target.value })} placeholder="5 ชิ้น/กะ" /></div>
        <div><label style={S.label}>n</label><input type="number" min="1" value={p.sample_size} onChange={e => onChange({ sample_size: e.target.value })} /></div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={p.remark} onChange={e => onChange({ remark: e.target.value })} placeholder="หมายเหตุ" style={{ flex: 1 }} />
        {p.id && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={!!p.is_active} onChange={e => onChange({ is_active: e.target.checked })} /> ใช้งาน
          </label>
        )}
      </div>
    </PointCardShell>
  );
}

/* ── ตั้งชื่อแผ่น/มุมมอง — เลือก view มาตรฐานหรือพิมพ์เอง ── */
function TitlePicker({ current, used, onPick, onClose }) {
  const [custom, setCustom] = useState(current || '');
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 12, width: 'min(460px, 96vw)', padding: 18, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>🖼 ตั้งชื่อแผ่น/มุมมอง</div>
        <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
          {STANDARD_VIEWS.map(v => {
            const taken = used.includes(v) && v !== current;
            return (
              <button key={v} type="button" disabled={taken} onClick={() => onPick(v)} title={taken ? 'มีแผ่นชื่อนี้อยู่แล้ว' : ''}
                style={{ padding: '8px 10px', borderRadius: 8, fontSize: 12.5, cursor: taken ? 'not-allowed' : 'pointer', opacity: taken ? 0.4 : 1,
                  border: '1px solid var(--border2)', background: v === current ? 'var(--accent-dim)' : 'var(--bg3)', color: 'var(--text)' }}>
                {v}{taken ? ' ✓' : ''}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="หรือพิมพ์ชื่อเอง เช่น Section C-C" style={{ flex: 1 }}
            onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) onPick(custom.trim()); }} />
          <button type="button" disabled={!custom.trim()} onClick={() => onPick(custom.trim())}
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 700, cursor: 'pointer' }}>ตกลง</button>
        </div>
        <div style={{ textAlign: 'right', marginTop: 10 }}>
          <button type="button" onClick={onClose} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer' }}>ข้าม</button>
        </div>
      </div>
    </div>
  );
}

export default function QaPointsEditor({ part, focusItemId, methodHist, onClose, onSaved }) {
  const wide = useWideModal();
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [frames, setFrames] = useState([]);   // [{ _key, id?, title, url?, _file?, _preview, isPdf }]
  const [frameIdx, setFrameIdx] = useState(0);
  const [points, setPoints] = useState([]);
  const [initial, setInitial] = useState({ frameIds: [], frameUrls: {}, itemIds: [], itemImgs: {} });
  const [activePinKey, setActivePinKey] = useState(null);
  const [titleFor, setTitleFor] = useState(null);   // frame _key ที่กำลังตั้งชื่อ
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { bodyRef, stickyRef, flashKey, jumpTo, jumpLater, cardRef, scrollTop } = usePointJump({
    onReveal: (key) => {
      const p = points.find(x => x._key === key);
      if (p?.pos_x == null) return;
      const fi = frames.findIndex(f => f._key === (p._frameKey ?? frames[0]?._key));
      if (fi >= 0 && fi !== frameIdx) setFrameIdx(fi);
    },
  });

  /* ── โหลดของจริงจากฐาน (เปิดโมดัล = ของล่าสุดเสมอ) ── */
  useEffect(() => {
    let alive = true;
    (async () => {
      const [dres, ires] = await Promise.all([
        supabase.from('qa_part_drawings').select('id, title, drawing_url, sort, created_at').eq('part_id', part.id).order('sort').order('created_at'),
        supabase.from('qa_inspection_items').select('*').eq('part_id', part.id),
      ]);
      if (!alive) return;
      if (dres.error || ires.error) { setLoadErr((dres.error || ires.error).message); setLoading(false); return; }
      const fr = (dres.data || []).map(d => ({ _key: d.id, id: d.id, title: d.title, url: d.drawing_url, _preview: d.drawing_url, isPdf: isPdfUrl(d.drawing_url) }));
      const firstKey = fr[0]?._key ?? null;
      const pts = (ires.data || []).sort(balloonSort).map(i => emptyPoint({
        _key: i.id, id: i.id,
        balloon_no: i.balloon_no ?? '', item_type: i.item_type || 'variable', characteristic: i.characteristic || '',
        spec_text: i.spec_text || '', nominal: i.nominal ?? '', usl: i.usl ?? '', lsl: i.lsl ?? '', unit: i.unit || '',
        method: i.method || '', stage: i.stage || 'inprocess', frequency: i.frequency || '',
        sample_size: i.sample_size ?? '', rank: i.rank || '', remark: i.remark || '', is_active: i.is_active !== false,
        pos_x: i.pos_x != null ? Number(i.pos_x) / 100 : null, pos_y: i.pos_y != null ? Number(i.pos_y) / 100 : null,
        // จุดเก่าที่ไม่มี drawing_id = อยู่แผ่นแรก (พฤติกรรมเดิมของหน้า QA)
        _frameKey: i.pos_x != null ? (fr.some(f => f.id === i.drawing_id) ? i.drawing_id : firstKey) : null,
        label_dx: i.label_dx ?? null, label_dy: i.label_dy ?? null,
        image_path: i.image_path || null, _imgPreview: publicUrl(i.image_path),
      }));
      setFrames(fr);
      setPoints(pts);
      setInitial({
        frameIds: fr.map(f => f.id), frameUrls: Object.fromEntries(fr.map(f => [f.id, f.url])),
        itemIds: pts.map(p => p.id), itemImgs: Object.fromEntries(pts.map(p => [p.id, p.image_path])),
      });
      setLoading(false);
      const focus = focusItemId && pts.find(p => p.id === focusItemId);
      if (focus) jumpLater(focus._key);
    })();
    return () => { alive = false; };
  }, [part.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key, patch) => setPoints(prev => prev.map(p => (p._key === key ? { ...p, ...patch } : p)));
  const labels = useMemo(() => Object.fromEntries(points.map(p => [p._key, p.balloon_no || '?'])), [points]);
  const pinnedCount = points.filter(p => p.pos_x != null).length;

  /* ── จุดตรวจ ── */
  const addPoint = () => {
    const p = emptyPoint({ balloon_no: nextBalloonOf(points) });
    setPoints(prev => [...prev, p]);
    jumpLater(p._key);
  };
  const deletePoint = (key) => {
    setPoints(prev => prev.filter(p => p._key !== key));
    if (activePinKey === key) setActivePinKey(null);
  };
  const pickCloseup = async (key, file) => {
    // ขนาดเดียวกับรูปโคลสอัพฝั่ง PM (1280px/0.3MB) — ต้องซูมดูจุดเล็กได้
    try {
      const c = await imageCompression(file, { maxSizeMB: 0.3, maxWidthOrHeight: 1280 });
      update(key, { _imgFile: c, _imgPreview: URL.createObjectURL(c) });
    } catch (e) { toast.error(`ย่อรูปไม่สำเร็จ: ${e?.message || ''}`); }
  };

  /* ── แผ่นรูป/Drawing ── */
  const addFrames = async (files) => {
    setBusy(true);
    const added = [];
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) { toast.error(`${file.name} ใหญ่เกิน 20MB`); continue; }
      let f = file;
      const isPdf = file.type === 'application/pdf';
      // drawing ต้องซูมอ่าน dimension ได้ ⇒ ไม่ครอป · บีบแบบเดียวกับผัง (2560px/2.5MB/q0.9) · PDF ส่งดิบ
      if (!isPdf) {
        try { f = await imageCompression(file, { maxSizeMB: 2.5, maxWidthOrHeight: 2560, initialQuality: 0.9, fileType: 'image/jpeg' }); }
        catch { /* บีบไม่ได้ — ส่งไฟล์เดิมภายใต้ cap 20MB */ }
      }
      added.push({ _key: newKey(), id: null, title: '', _file: f, _preview: URL.createObjectURL(f), isPdf });
    }
    setBusy(false);
    if (!added.length) return;
    setFrames(prev => {
      const n = prev.length;
      return [...prev, ...added.map((a, i) => ({ ...a, title: `Drawing ${n + i + 1}` }))];
    });
    setFrameIdx(frames.length);
    setTitleFor(added[0]._key);
  };
  const removeFrame = (key) => {
    const f = frames.find(x => x._key === key);
    const cnt = points.filter(p => p._frameKey === key && p.pos_x != null).length;
    if (!window.confirm(`เอาแผ่น "${f?.title || ''}" ออก?${cnt ? `\nหมุด ${cnt} จุดบนแผ่นนี้จะถูกถอด (ตัวจุดตรวจไม่หาย)` : ''}\n(มีผลเมื่อกดบันทึก)`)) return;
    setFrames(prev => prev.filter(x => x._key !== key));
    setPoints(prev => prev.map(p => (p._frameKey === key ? { ...p, pos_x: null, pos_y: null, _frameKey: null, label_dx: null, label_dy: null } : p)));
    setFrameIdx(0);
  };
  const replaceFrame = async (key, file) => {
    const isPdf = file.type === 'application/pdf';
    let f = file;
    if (!isPdf) {
      try { f = await imageCompression(file, { maxSizeMB: 2.5, maxWidthOrHeight: 2560, initialQuality: 0.9, fileType: 'image/jpeg' }); } catch { /* ส่งไฟล์เดิม */ }
    }
    setFrames(prev => prev.map(x => (x._key === key ? { ...x, _file: f, _preview: URL.createObjectURL(f), isPdf } : x)));
    if (isPdf) setPoints(prev => prev.map(p => (p._frameKey === key ? { ...p, pos_x: null, pos_y: null, _frameKey: null } : p)));
  };

  /* ── บันทึกทั้งหมดครั้งเดียว ── */
  const upload = async (file, prefix) => {
    const ext = file.type === 'application/pdf' ? 'pdf' : 'jpg';
    const path = `parts/${part.id}/${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { error: e } = await supabase.storage.from(BUCKET).upload(path, file, uploadOpts());
    if (e) throw new Error(`อัปโหลดรูปไม่สำเร็จ: ${e.message}`);
    return path;
  };

  const handleSave = async () => {
    setError('');
    const blank = points.find(p => !p.characteristic.trim());
    if (blank) { jumpTo(blank._key); setError(`ใส่ชื่อจุดตรวจให้ครบ — ยังว่าง ${points.filter(p => !p.characteristic.trim()).length} จุด`); return; }
    const badSpec = points.find(p => p.item_type === 'variable' && p.usl !== '' && p.lsl !== '' && Number(p.usl) <= Number(p.lsl));
    if (badSpec) { jumpTo(badSpec._key); setError(`จุด ${badSpec.balloon_no || '?'}: USL ต้องมากกว่า LSL`); return; }

    setSaving(true);
    let fr = frames, pts = points;
    const stale = [];   // path ไฟล์เก่าที่ต้องเก็บกวาด (ลบหลังแถวในฐานเปลี่ยนสำเร็จแล้วเท่านั้น)
    try {
      // 1) แผ่นรูป — ต้องได้ id ก่อน จุดตรวจถึงผูก drawing_id ได้
      const keyToId = {};
      let sheetsChanged = false;
      fr = [...fr];
      for (let i = 0; i < fr.length; i++) {
        const f = fr[i];
        let url = f.url;
        if (f._file) { url = publicUrl(await upload(f._file, '')); sheetsChanged = true; }
        const row = { title: f.title || `Drawing ${i + 1}`, sort: i, drawing_url: url };
        let id = f.id;
        if (id) {
          if (!checkWriteRows(await supabase.from('qa_part_drawings').update(row).eq('id', id).select('id'), 'บันทึกแผ่นรูป')) throw new Error('บันทึกแผ่นรูปไม่สำเร็จ');
          if (f._file && initial.frameUrls[id] && initial.frameUrls[id] !== url) stale.push(pathOfUrl(initial.frameUrls[id]));
        } else {
          const res = await supabase.from('qa_part_drawings').insert({ part_id: part.id, ...row }).select('id').single();
          if (!checkWrite(res, 'เพิ่มแผ่นรูป')) throw new Error('เพิ่มแผ่นรูปไม่สำเร็จ');
          id = res.data.id;
          sheetsChanged = true;
        }
        fr[i] = { ...f, id, url, _file: null };
        keyToId[f._key] = id;
      }

      // 2) จุดตรวจ
      pts = [...pts];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        let imagePath = p.image_path;
        if (p._imgFile) {
          imagePath = await upload(p._imgFile, 'cp-');
          if (p.id && initial.itemImgs[p.id]) stale.push(initial.itemImgs[p.id]);
        } else if (!imagePath && p.id && initial.itemImgs[p.id]) {
          stale.push(initial.itemImgs[p.id]);   // กด "ลบรูป"
        }
        const pinned = p.pos_x != null && keyToId[p._frameKey ?? fr[0]?._key];
        const isVar = p.item_type === 'variable';
        const payload = {
          part_id: part.id,
          balloon_no: String(p.balloon_no).trim() || String(i + 1),
          item_type: p.item_type, characteristic: p.characteristic.trim(),
          spec_text: p.spec_text.trim() || null,
          nominal: isVar && p.nominal !== '' ? Number(p.nominal) : null,
          usl: isVar && p.usl !== '' ? Number(p.usl) : null,
          lsl: isVar && p.lsl !== '' ? Number(p.lsl) : null,
          unit: isVar ? (String(p.unit).trim() || null) : null,
          method: String(p.method || '').trim() || null, stage: p.stage,
          frequency: p.frequency.trim() || null,
          sample_size: p.sample_size === '' ? null : parseInt(p.sample_size, 10),
          rank: p.rank || null, control_item: !!p.rank,   // M/SC = จุดควบคุมพิเศษ
          remark: p.remark.trim() || null, is_active: !!p.is_active,
          // หมุด: เก็บ 0–100 ตามคอลัมน์เดิมของ QA (จอตรวจ QaCheckSheet อ่านแบบนี้)
          pos_x: pinned ? +(p.pos_x * 100).toFixed(2) : null,
          pos_y: pinned ? +(p.pos_y * 100).toFixed(2) : null,
          drawing_id: pinned ? keyToId[p._frameKey ?? fr[0]?._key] : null,
          label_dx: pinned ? (p.label_dx ?? null) : null, label_dy: pinned ? (p.label_dy ?? null) : null,
          image_path: imagePath || null,
        };
        if (p.id) {
          if (!checkWriteRows(await supabase.from('qa_inspection_items').update(payload).eq('id', p.id).select('id'), `บันทึกจุด ${payload.balloon_no}`)) throw new Error(`บันทึกจุด ${payload.balloon_no} ไม่สำเร็จ`);
          pts[i] = { ...p, image_path: imagePath, _imgFile: null };
        } else {
          const res = await supabase.from('qa_inspection_items').insert(payload).select('id').single();
          if (!checkWrite(res, `เพิ่มจุด ${payload.balloon_no}`)) throw new Error(`เพิ่มจุด ${payload.balloon_no} ไม่สำเร็จ`);
          pts[i] = { ...p, id: res.data.id, image_path: imagePath, _imgFile: null };
        }
      }

      // 3) ลบจุดที่เอาออก (ผลตรวจเก่าอ่านได้จาก snapshot ในแถวผล · item_id = on delete set null)
      const keepItems = new Set(pts.map(p => p.id));
      const delItems = initial.itemIds.filter(id => !keepItems.has(id));
      if (delItems.length) {
        if (!checkWriteRows(await supabase.from('qa_inspection_items').delete().in('id', delItems).select('id'), 'ลบจุดตรวจ', { min: delItems.length })) throw new Error('ลบจุดตรวจไม่ครบ');
        delItems.forEach(id => { if (initial.itemImgs[id]) stale.push(initial.itemImgs[id]); });
      }
      // 4) ลบแผ่นที่เอาออก — หลังจุดตรวจถูกถอดหมุดออกจากแผ่นนั้นแล้ว (ข้อ 2)
      const keepFrames = new Set(fr.map(f => f.id));
      const delFrames = initial.frameIds.filter(id => !keepFrames.has(id));
      if (delFrames.length) {
        if (!checkWriteRows(await supabase.from('qa_part_drawings').delete().in('id', delFrames).select('id'), 'ลบแผ่นรูป', { min: delFrames.length })) throw new Error('ลบแผ่นรูปไม่ครบ');
        delFrames.forEach(id => stale.push(pathOfUrl(initial.frameUrls[id])));
        sheetsChanged = true;
      }
      if (sheetsChanged) {
        checkWrite(await supabase.from('qa_parts').update({ drawing_updated_at: new Date().toISOString() }).eq('id', part.id), 'ประทับเวลาแก้ drawing ');
      }
      // 5) เก็บกวาดไฟล์เก่า — แถวในฐานเลิกอ้างแล้วจริง (นับแถวผ่านด้านบน) · best-effort
      const paths = stale.filter(Boolean);
      if (paths.length) supabase.storage.from(BUCKET).remove(paths).catch(() => {});
      toast.success(`บันทึกแล้ว ✓ ${pts.length} จุด · ${fr.length} แผ่น`);
      onSaved?.();
    } catch (e) {
      setError(`${e.message} — ส่วนที่บันทึกไปแล้วยังอยู่ แก้แล้วกดบันทึกอีกครั้งได้`);
      // ให้ state รู้ id ของแถวที่เพิ่งเกิด — กดบันทึกซ้ำจะ update ไม่ insert ซ้ำ
      setFrames(fr); setPoints(pts);
      setInitial(prev => ({ ...prev, frameIds: [...new Set([...prev.frameIds, ...fr.map(f => f.id).filter(Boolean)])], itemIds: [...new Set([...prev.itemIds, ...pts.map(p => p.id).filter(Boolean)])] }));
    } finally {
      setSaving(false);
    }
  };

  const curFrame = frames[frameIdx];
  const frameCounts = Object.fromEntries(frames.map(f => [f._key, points.filter(p => p.pos_x != null && (p._frameKey ?? frames[0]?._key) === f._key).length]));

  return (
    <InspectEditorModal wide={wide} bodyRef={bodyRef} onClose={onClose} onSave={handleSave} saving={saving}
      title={`ตั้งค่าจุดตรวจ — ${part.part_no || part.part_name || 'ชิ้นงาน'}`} subtitle={[part.part_name, part.customer].filter(Boolean).join(' · ') || 'ชิ้นงาน'}>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด…</div>
      ) : loadErr ? (
        <div style={{ padding: 16, color: 'var(--red)', fontWeight: 700 }}>⚠️ โหลดข้อมูลไม่สำเร็จ ({loadErr}) — ปิดแล้วเปิดใหม่ · ยังไม่ได้แก้อะไร</div>
      ) : (
        <PinWorkspace twoCol={wide} stickyRef={stickyRef}
          boardTitle="Drawing / รูปชิ้นงาน (หลายแผ่น) + จุดตรวจ"
          boardBadge={pinnedCount > 0 ? `📍 ${pinnedCount}/${points.length} จุดวางแล้ว` : null}
          board={(
            <SpinAnnotator subject="part" spinnable={false} acceptPdf
              frames={frames} frameIdx={frameIdx} setFrameIdx={setFrameIdx}
              arming={!!activePinKey && !curFrame?.isPdf} busy={busy}
              frameCounts={frameCounts}
              pins={points
                .filter(p => p.pos_x != null && (p._frameKey ?? frames[0]?._key) === curFrame?._key)
                .map(p => ({ key: p._key, x: p.pos_x, y: p.pos_y, label: p.balloon_no || '?',
                  label_dx: p.label_dx, label_dy: p.label_dy,
                  selected: activePinKey === p._key || flashKey === p._key,
                  color: activePinKey === p._key ? 'var(--accent)' : (QA_RANK[p.rank]?.color || PIN_DEFAULT) }))}
              onPlace={(x, y) => { update(activePinKey, { pos_x: x, pos_y: y, _frameKey: curFrame?._key ?? null }); setActivePinKey(null); }}
              onPinClick={jumpTo}
              onLabelMove={(key, dx, dy) => update(key, { label_dx: dx, label_dy: dy })}
              onAddFrames={addFrames} onRemoveFrame={removeFrame}
              onRenameFrame={key => setTitleFor(key)} onReplaceFrame={replaceFrame}
              pinHasDetail={Object.fromEntries(points.map(p => [p._key, !!(p._imgPreview || p.image_path)]))} />
          )}
          boardFooter={activePinKey && <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0' }}>✦ เลือกแผ่นที่เห็นจุดชัด แล้วแตะวางตำแหน่ง</p>}
          listTitle={`จุดตรวจชิ้นงาน (${points.length})`} onAdd={addPoint}
          jump={{ points: points.map(p => ({ _key: p._key, name: p.characteristic, group_name: '' })), labels, onJump: jumpTo, flashKey, onTop: scrollTop }}>
          {points.map(p => (
            <div key={p._key} ref={cardRef(p._key)} style={{ borderRadius: 8, transition: 'box-shadow .3s',
              boxShadow: flashKey === p._key ? '0 0 0 2px var(--accent), 0 0 14px var(--accent-glow)' : 'none' }}>
              <QaPointCard p={p} methodHist={methodHist}
                onChange={patch => (patch._imgFile ? pickCloseup(p._key, patch._imgFile) : update(p._key, patch))}
                onDelete={() => deletePoint(p._key)}
                isPinning={activePinKey === p._key} hasImage={frames.some(f => !f.isPdf)}
                onPinToggle={() => setActivePinKey(k => (k === p._key ? null : p._key))}
                onUnpin={() => { update(p._key, { pos_x: null, pos_y: null, _frameKey: null, label_dx: null, label_dy: null }); if (activePinKey === p._key) setActivePinKey(null); }} />
            </div>
          ))}
          {points.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13, border: '1px dashed var(--border2)', borderRadius: 8 }}>
              ยังไม่มีจุดตรวจ — กด “+ เพิ่มจุดตรวจ” แล้วกด 🔘 วางตำแหน่ง → แตะบนรูป
            </div>
          )}
        </PinWorkspace>
      )}
      {error && <p style={{ color: 'var(--red)', fontSize: 13, margin: 0 }}>{error}</p>}
      {titleFor && (
        <TitlePicker current={frames.find(f => f._key === titleFor)?.title}
          used={frames.filter(f => f._key !== titleFor).map(f => f.title)}
          onPick={t => { setFrames(prev => prev.map(f => (f._key === titleFor ? { ...f, title: t } : f))); setTitleFor(null); }}
          onClose={() => setTitleFor(null)} />
      )}
    </InspectEditorModal>
  );
}
