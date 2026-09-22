import { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import { notifyEvent } from '../utils/notifyEvent';
import { checkWrite } from '../utils/dbWrite';
import { uploadOpts } from '../utils/storageUpload';
import { compressScreenshotImage } from '../utils/layoutImage';
import { toDecodableImage } from '../utils/heicToJpeg';
import { looksLikeImage, isGifFile } from '../utils/imageFileKind';
import { takeFeedbackPrefill } from '../utils/feedbackPrefill';

/*
  💬 กล่องรับ feedback จากผู้ใช้หน้างาน (2026-08-14 · คำขอ user)
  เดิม feedback วิ่งผ่าน LINE → ตกหล่น ค้นย้อนไม่ได้ ไม่รู้ว่าเรื่องไหนแก้แล้ว

  ออกแบบให้ "ส่งง่ายที่สุด" เพราะคนหน้างานใส่ถุงมือ/รีบ:
    • พิมพ์ข้อความอย่างเดียวก็ส่งได้ · ประเภทมี default
    • หน้าที่กำลังเปิดอยู่ถูกเก็บให้เอง (page_path) ไม่ต้องอธิบายว่า "อยู่หน้าไหน"
    • ไม่ทำเป็นหน้าแยก + ไม่เพิ่ม permission key ใหม่ (เลี่ยงกับดัก seed enum_range
      ที่ทำให้ role ใหม่เข้าไม่ได้แบบ fail-closed) — กล่องขาเข้าเป็นแท็บในโมดัลนี้
      เห็นเฉพาะ admin/manager ซึ่งตรงกับ RLS ของตาราง

  📎 แนบรูปหน้าจอได้ (2026-09-22 · คุณสุรเสนแจ้งมาทาง LINE 22/09)
  เดิมฟอร์มเขียนบอกผู้ใช้เองว่า "ถ้ามีรูปหน้าจอ ส่งใน LINE ตามหลังได้ (ระบบยังไม่รับไฟล์แนบ)"
  ⇒ **ระบบสั่งให้คนเดินออกไปนอกระบบเอง** ซึ่งย้อนแย้งกับเหตุผลที่สร้างกล่องนี้ขึ้นมาแต่แรก
  (คนแจ้งวงกรอบสีบนสกรีนช็อตในมือถือมาเรียบร้อยแล้ว ขาดแค่ที่แนบ)
  🔴 **ตั้งใจไม่ทำเครื่องมือวาดกรอบในแอป** — เขาวงเองในมือถือได้อยู่แล้วและเร็วกว่า
     สิ่งที่ขาดคือ "ช่องแนบ" ไม่ใช่ "โปรแกรมวาด" · อย่าขยายงานเกินที่หน้างานขอ
*/

/* แนบได้ไม่เกิน 4 รูป — จากของจริงที่เขาส่งมาทาง LINE ครั้งละ 1-3 รูป (ก่อน/หลัง + จุดที่ชี้)
   จำกัดไว้เพื่อไม่ให้ egress บาน และเพื่อให้คนเลือกเฉพาะรูปที่สื่อจริงๆ */
const MAX_SHOTS = 4;
const MAX_PICK_MB = 5;          // ขนาด "ก่อนบีบ" ที่ยอมให้เลือก (ตรงกับ file_size_limit ของ bucket)

const KINDS = [
  { key: 'bug',      icon: '🐛', label: 'พบปัญหา/บั๊ก',  color: '#ef4444' },
  { key: 'idea',     icon: '💡', label: 'ข้อเสนอแนะ',    color: '#f59e0b' },
  { key: 'question', icon: '❓', label: 'คำถาม',         color: '#3b82f6' },
];
const STATUS = {
  new:     { label: '🆕 ใหม่',      color: '#ef4444' },
  seen:    { label: '👀 รับทราบ',   color: '#f59e0b' },
  doing:   { label: '🔧 กำลังแก้',  color: '#3b82f6' },
  done:    { label: '✅ แก้แล้ว',   color: '#22c55e' },
  wontfix: { label: '⏸ ยังไม่ทำ',  color: 'var(--muted)' },
};
const fmt = (t) => t ? new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export default function FeedbackModal({ onClose }) {
  const { role, fullName } = useContext(UserContext);
  const location = useLocation();
  const isAdmin = role === 'admin' || role === 'manager';

  const [tab, setTab]         = useState('send');
  const [kind, setKind]       = useState('bug');
  // ข้อความตั้งต้นจากหน้าที่สั่งเปิดกล่องนี้ (เช่นปุ่ม 🐛 ในหน้า 🗄️ โครงสร้างฐานข้อมูล
  // ที่ใส่ชื่อตาราง/PK/FK/หน้ามาให้แล้ว) — อ่านครั้งเดียวตอน mount แล้วล้างทิ้ง
  const [msg, setMsg]         = useState(() => takeFeedbackPrefill() || '');
  const [saving, setSaving]   = useState(false);
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [notReady, setNotReady] = useState(false);   // ยังไม่ได้ apply migration
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [shots, setShots] = useState([]);           // [{ id, file, preview }] — ยังไม่อัป รอกดส่ง
  const [zoom, setZoom]   = useState(null);         // URL รูปที่กดดูเต็มจอ
  const fileRef = useRef(null);

  /* preview เป็น blob: URL — ต้อง revoke ตอนถอดรูป/ปิดโมดัล ไม่งั้น memory ค้าง
     (จอหน้างานเปิดค้างทั้งวัน แนบ-ถอดหลายรอบแล้วไม่คืนหน่วยความจำ)
     ⚠️ **ห้ามใส่ `shots` ใน deps** — cleanup จะวิ่งทุกครั้งที่ลิสต์เปลี่ยน แล้วไป revoke URL ของรูป
        ที่ยัง**โชว์อยู่บนจอ** (แนบใบที่ 2 แล้วใบที่ 1 กลายเป็นรูปเสีย) ⇒ เก็บ ref ไว้ revoke ตอน unmount */
  const shotsRef = useRef(shots);
  useEffect(() => { shotsRef.current = shots; }, [shots]);
  useEffect(() => () => { shotsRef.current.forEach(sh => URL.revokeObjectURL(sh.preview)); }, []);

  const pickShots = async (fileList) => {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const room = MAX_SHOTS - shots.length;
    if (room <= 0) { toast.error(`แนบได้สูงสุด ${MAX_SHOTS} รูป — ถอดรูปเดิมออกก่อน`); return; }
    const take = files.slice(0, room);
    if (files.length > room) toast.info(`รับได้อีก ${room} รูป (สูงสุด ${MAX_SHOTS}) — ที่เหลือไม่ได้แนบ`);

    const add = [];
    for (const f of take) {
      // ⚠️ ปฏิเสธไฟล์ต้องบอกเหตุผล+ทางแก้เสมอ ห้ามเงียบ (คำสั่ง user 2026-09-11)
      if (!looksLikeImage(f)) { toast.error(`"${f.name}" ไม่ใช่ไฟล์รูป — แนบได้เฉพาะ JPG / PNG / WebP (สกรีนช็อตจากมือถือใช้ได้เลย)`); continue; }
      if (isGifFile(f))       { toast.error(`"${f.name}" เป็น GIF — แนบไม่ได้ (บีบไม่ได้ ไฟล์ใหญ่มาก) ให้แคปเป็นภาพนิ่งแทน`); continue; }
      if (f.size > MAX_PICK_MB * 1024 * 1024) { toast.error(`"${f.name}" ใหญ่เกิน ${MAX_PICK_MB} MB — ลองแคปเฉพาะส่วนที่จะชี้`); continue; }
      add.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file: f, preview: URL.createObjectURL(f) });
    }
    if (add.length) setShots(prev => [...prev, ...add]);
  };

  const dropShot = (id) => setShots(prev => {
    const gone = prev.find(sh => sh.id === id);
    if (gone) URL.revokeObjectURL(gone.preview);
    return prev.filter(sh => sh.id !== id);
  });

  /* อัปรูปทั้งชุด — คืน { urls, paths }
     path = <uid>/<ts>-<i>.<ext> · ต้องขึ้นต้นด้วย uid ให้ตรง policy feedback_images_write
     ⚠️ อัป "ตอนกดส่ง" ไม่ใช่ตอนเลือก — เลือกแล้วเปลี่ยนใจปิดหน้าต่าง จะได้ไม่มีไฟล์ขยะค้าง storage */
  const uploadShots = async (uid) => {
    const urls = [], paths = [];
    for (let i = 0; i < shots.length; i++) {
      let f = shots[i].file;
      f = await toDecodableImage(f);                       // HEIC/HEIF จากมือถือ → JPEG ก่อน
      const { blob, ext } = await compressScreenshotImage(f);
      const path = `${uid}/${Date.now()}-${i}.${ext}`;
      const { error } = await supabase.storage.from('feedback-images').upload(path, blob, uploadOpts());
      if (error) throw new Error(`อัปรูปที่ ${i + 1} ไม่สำเร็จ: ${error.message}`);
      paths.push(path);
      urls.push(supabase.storage.from('feedback-images').getPublicUrl(path).data.publicUrl);
    }
    return { urls, paths };
  };

  const load = useCallback(async () => {
    setLoading(true);
    // admin เห็นทั้งหมด · คนทั่วไปเห็นของตัวเอง (RLS คุมอยู่แล้ว ไม่ต้องกรองซ้ำฝั่ง client)
    const { data, error } = await supabase.from('user_feedback')
      .select('*').order('created_at', { ascending: false }).limit(200);
    if (error) { console.warn('[feedback] load', error); setNotReady(true); }
    else setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── ตอบกลับคนแจ้ง (2026-09-22 · คำสั่ง user "ตอบคำถาม user ที่แจ้งเข้ามา") ──
     เดิม `admin_note` ถูกเขียนลง DB ได้ แต่ **ไม่เคยถูกแสดงที่ไหนเลย** ⇒ คนแจ้งส่งเรื่องมาแล้ว
     ไม่มีวันรู้คำตอบ (เห็นแค่สถานะเปลี่ยนสี) — ซึ่งทำให้คนเลิกแจ้ง
     ⚠️ RLS ปฏิเสธ UPDATE = "สำเร็จ 0 แถว ไม่มี error" ⇒ ต้อง .select('id') แล้วนับแถว
        ห้ามขึ้น toast เขียวจาก !error อย่างเดียว (กฎเหล็กเขียน DB ข้อ 2) */
  const [noteDraft, setNoteDraft] = useState({});
  const [savingNote, setSavingNote] = useState('');
  const saveNote = async (row) => {
    const text = (noteDraft[row.id] ?? row.admin_note ?? '').trim();
    if (!text) return;
    setSavingNote(row.id);
    const res = await supabase.from('user_feedback')
      .update({ admin_note: text, handled_by: fullName || null, handled_at: new Date().toISOString(),
                status: row.status === 'new' ? 'seen' : row.status })
      .eq('id', row.id).select('id');
    setSavingNote('');
    if (!checkWrite(res, 'บันทึกคำตอบ')) return;
    if (!res.data?.length) { toast.error('บันทึกคำตอบไม่สำเร็จ — ไม่มีสิทธิ์แก้เรื่องนี้'); return }
    // แจ้งเข้ากระดิ่ง 🔔 ของคนแจ้ง — ไม่งั้นเขาไม่รู้ว่ามีคำตอบแล้ว (best-effort ห้ามทำ flow พัง)
    const { data: { user } } = await supabase.auth.getUser();
    if (row.user_id && row.user_id !== user?.id) {
      supabase.from('notifications').insert({
        user_id: row.user_id, type: 'info',
        title: '💬 ทีมงานตอบเรื่องที่คุณแจ้งแล้ว',
        body: text.slice(0, 160),
      }).then(({ error }) => { if (error) console.warn('feedback reply notify:', error.message); });
    }
    toast.success('ส่งคำตอบให้ผู้แจ้งแล้ว');
    setRows(rs => rs.map(r => r.id === row.id
      ? { ...r, admin_note: text, handled_by: fullName, handled_at: new Date().toISOString(), status: r.status === 'new' ? 'seen' : r.status }
      : r));
    setNoteDraft(d => ({ ...d, [row.id]: undefined }));
  };

  const send = async () => {
    const body = msg.trim();
    if (!body) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();

    // 1) อัปรูปก่อน (ถ้ามี) — ล้มตรงนี้ = ไม่เขียนแถวเลย ผู้ใช้แก้แล้วกดส่งใหม่ได้ ไม่มีของค้างครึ่งทาง
    let urls = [], paths = [];
    if (shots.length) {
      if (!user?.id) { setSaving(false); toast.error('เซสชันหมดอายุ — เข้าสู่ระบบใหม่แล้วส่งอีกครั้ง'); return; }
      try { ({ urls, paths } = await uploadShots(user.id)); }
      catch (e) {
        setSaving(false);
        // เก็บกวาดรูปที่อัปไปแล้วก่อนจะพัง ไม่งั้นเหลือไฟล์กำพร้าใน storage
        await Promise.allSettled(paths.map(pt => supabase.storage.from('feedback-images').remove([pt])));
        toast.error(e.message || 'อัปรูปไม่สำเร็จ');
        return;
      }
    }

    const row = {
      user_id: user?.id, user_name: fullName || user?.email || null, user_role: role || null,
      kind, page_path: location.pathname + (location.search || ''), message: body,
      ...(urls.length ? { images: urls } : null),
    };
    let { error } = await supabase.from('user_feedback').insert(row);
    /* คอลัมน์ `images` ยังไม่ได้ apply migration → ตัดออกแล้วลองใหม่
       (กฎเดิมของโปรเจค: **การแจ้งเรื่องต้องไม่พังเพราะฟีเจอร์เสริม** — อย่างน้อยข้อความต้องถึงมือทีม) */
    if (error && urls.length && /images/i.test(error.message || '')) {
      console.warn('[feedback] ไม่มีคอลัมน์ images — ส่งเฉพาะข้อความ', error);
      ({ error } = await supabase.from('user_feedback').insert({ ...row, images: undefined }));
      if (!error) toast.info('ส่งข้อความแล้ว แต่รูปยังไม่เข้าระบบ (ยังไม่ได้ apply migration images) — แจ้ง admin');
    }
    setSaving(false);
    if (error) {
      console.warn('[feedback] insert', error);
      await Promise.allSettled(paths.map(pt => supabase.storage.from('feedback-images').remove([pt])));
      // ห้ามขึ้นว่าส่งสำเร็จทั้งที่ไม่เข้า — คนหน้างานจะรอคำตอบที่ไม่มีวันมา
      toast.error(error.code === '42P01'
        ? 'ยังเปิดใช้งานกล่อง feedback ไม่ได้ — ยังไม่ได้ apply migration user_feedback (แจ้ง admin)'
        : `ส่งไม่สำเร็จ: ${error.message}`);
      return;
    }
    notifyEvent({
      event: 'user_feedback', type: 'info', ref_table: 'user_feedback',
      actor: fullName || user?.email || null,
      lines: [
        (() => { const k = KINDS.find(x => x.key === kind); return k ? `${k.icon} ${k.label}` : kind; })(),
        `📄 หน้า: ${location.pathname}`,
        `💬 ${body.slice(0, 400)}`,
        // ลิงก์รูปไปด้วย — คนรับแจ้งใน Telegram กดดูได้ทันที ไม่ต้องเปิดแอปก่อนถึงจะรู้ว่าเรื่องอะไร
        ...(urls.length ? [`🖼 แนบ ${urls.length} รูป`, ...urls] : []),
      ],
    });
    toast.success('ส่งแล้ว ขอบคุณครับ 🙏 ทีมงานจะตามให้');
    shots.forEach(sh => URL.revokeObjectURL(sh.preview));
    setMsg(''); setShots([]); load();
  };

  const setStatus = async (row, status) => {
    const { error } = await supabase.from('user_feedback')
      .update({ status, handled_by: fullName || null, handled_at: new Date().toISOString() }).eq('id', row.id);
    if (error) { toast.error(`อัพเดทไม่สำเร็จ: ${error.message}`); return; }
    setRows(rs => rs.map(r => r.id === row.id ? { ...r, status, handled_by: fullName, handled_at: new Date().toISOString() } : r));
  };

  const shown = onlyOpen ? rows.filter(r => !['done', 'wontfix'].includes(r.status)) : rows;
  const openCount = rows.filter(r => !['done', 'wontfix'].includes(r.status)).length;

  /* 📋 คัดลอกเป็นข้อความให้เอาไปวางให้ Claude อ่าน
     ⚠️ จำเป็นเพราะ Claude Code (เซสชันบนเว็บ) **อ่านฐานข้อมูลตรงไม่ได้** — Supabase MCP
     ติด approval ที่กดไม่ได้ในเซสชันแบบนั้น และ network policy บล็อก supabase.co
     → ถ้าไม่มีปุ่มนี้ ลูป "user แจ้ง → สั่ง Claude ไปเช็ค" จะสะดุดตรงขั้นสุดท้าย
     (ถ้ารัน Claude Code แบบ interactive แล้วกดอนุมัติ MCP ได้ ก็อ่านตรงได้ ไม่ต้องใช้ปุ่มนี้) */
  const copyForClaude = async () => {
    const list = shown;
    if (!list.length) { toast.info('ไม่มีเรื่องให้คัดลอก'); return; }
    const byPage = {};
    list.forEach(r => { const k = r.page_path || '(ไม่ระบุหน้า)'; byPage[k] = (byPage[k] || 0) + 1; });
    const head = `feedback จากผู้ใช้ ${list.length} เรื่อง (ดึงเมื่อ ${fmt(new Date().toISOString())})\n`
      + `รวมตามหน้า: ${Object.entries(byPage).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ×${n}`).join(' · ')}\n`;
    const body = list.map((r, i) => {
      const k = KINDS.find(x => x.key === r.kind) || KINDS[0];
      return `\n${i + 1}. [${k.label} · ${(STATUS[r.status] || STATUS.new).label}] ${fmt(r.created_at)}`
        + ` · ${r.user_name || '—'}${r.user_role ? ` (${r.user_role})` : ''} · หน้า ${r.page_path || '—'}\n   ${r.message.replace(/\n/g, '\n   ')}`
        /* ⚠️ Claude เปิด URL รูปเองไม่ได้ (เซสชันเว็บโดน network policy บล็อก) — บอกไว้ให้คน
           ที่เอาข้อความไปวาง รู้ว่าต้องแนบรูปเข้าแชทเองด้วย ไม่งั้นบริบทหายไปเงียบๆ */
        + (r.images?.length ? `\n   📎 มีรูปแนบ ${r.images.length} รูป (เปิดกล่องขาเข้าแล้วลากรูปมาวางในแชทด้วย):\n   ${r.images.join('\n   ')}` : '');
    }).join('\n');
    const text = head + body;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`คัดลอก ${list.length} เรื่องแล้ว — เอาไปวางในแชท Claude ได้เลย`);
    } catch {
      // บาง browser/บริบทบล็อก clipboard API → ถอยไปวิธีเลือกข้อความเอง ห้ามเงียบ
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand?.('copy');
      document.body.removeChild(ta);
      ok ? toast.success(`คัดลอก ${list.length} เรื่องแล้ว`) : toast.error('คัดลอกไม่สำเร็จ — เบราว์เซอร์ไม่อนุญาต');
    }
  };

  const box = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' };
  const tabBtn = (k, label) => (
    <button key={k} onClick={() => setTab(k)} style={{
      fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
      border: `1px solid ${tab === k ? 'var(--accent)' : 'var(--border)'}`,
      background: tab === k ? 'var(--accent-dim)' : 'var(--bg3)', color: tab === k ? 'var(--accent)' : 'var(--text2)',
    }}>{label}</button>
  );

  return (
    <div /* ⚠️ ฟอร์มกรอกข้อมูล — ไม่ปิดจาก backdrop กันเผลอแตะแล้วข้อมูลหาย (UI-CONVENTIONS §5) */  style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 14, width: '100%', maxWidth: 620, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>

        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 800, flex: 1 }}>💬 แจ้งปัญหา / ข้อเสนอแนะ</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '10px 18px 0', display: 'flex', gap: 6 }}>
          {tabBtn('send', '✍️ ส่งเรื่อง')}
          {tabBtn('list', isAdmin ? `📥 กล่องขาเข้า${openCount ? ` (${openCount})` : ''}` : '📄 เรื่องที่ฉันส่ง')}
        </div>

        <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
          {notReady && (
            <div style={{ fontSize: 12, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
              ⚠ ยังใช้งานไม่ได้ — ยังไม่ได้ apply migration <code>20260814_user_feedback.sql</code> (แจ้ง admin)
            </div>
          )}

          {tab === 'send' ? (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                {KINDS.map(k => (
                  <button key={k.key} onClick={() => setKind(k.key)} style={{
                    fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
                    border: `1px solid ${kind === k.key ? k.color : 'var(--border)'}`,
                    background: kind === k.key ? `${k.color}22` : 'var(--bg3)', color: kind === k.key ? k.color : 'var(--text2)',
                  }}>{k.icon} {k.label}</button>
                ))}
              </div>

              <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={6} autoFocus
                placeholder={'เล่าให้ฟังได้เลยครับ เช่น\n• เลเซอร์ลงดาวน์ไทม์ ไม่มีให้เลือกชิ้นงาน\n• ชื่อสินค้า 2 ตัวเหมือนกัน เลือกผิดใบได้\n• อยากให้เพิ่ม...'}
                style={{ width: '100%', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />

              {/* 📎 แนบรูปหน้าจอ — วางไว้ "ติดใต้ช่องพิมพ์" ให้เห็นตอนกำลังเล่าปัญหา
                  ไม่ใช่ท้ายฟอร์ม (บทเรียนจากรูปก่อนซ่อมใน /mtn-repair: ช่องอยู่ล่างสุด คนใส่แค่ 25%) */}
              <div style={{ marginTop: 10 }}>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple
                  /* ⚠️ ต้อง **ก๊อป FileList เป็น array ก่อน** แล้วค่อย `value = ''`
                     `e.target.files` เป็น live list ผูกกับ input — เคลียร์ value ปุ๊บ list ว่างทันที
                     เขียนสลับลำดับ = แนบรูปไม่ติดสักใบ **แบบเงียบ ไม่มี error** (เจอจริงตอนรันเบราว์เซอร์ 22/09)
                     ส่วน `value = ''` เองก็ตัดไม่ได้ — ไม่งั้นเลือก "ไฟล์เดิมซ้ำ" แล้ว change ไม่ยิง */
                  onChange={e => { const fl = [...e.target.files]; e.target.value = ''; pickShots(fl); }}
                  style={{ display: 'none' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={shots.length >= MAX_SHOTS}
                    style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8,
                      border: '1px dashed var(--border2)', background: 'var(--bg3)', color: 'var(--text2)',
                      cursor: shots.length >= MAX_SHOTS ? 'default' : 'pointer', opacity: shots.length >= MAX_SHOTS ? 0.5 : 1 }}>
                    📎 แนบรูปหน้าจอ
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {shots.length ? `${shots.length}/${MAX_SHOTS} รูป` : `วงกรอบ/ชี้จุดมาจากมือถือได้เลย (สูงสุด ${MAX_SHOTS} รูป)`}
                  </span>
                </div>
                {!!shots.length && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {shots.map(sh => (
                      <div key={sh.id} style={{ position: 'relative' }}>
                        <img src={sh.preview} alt="" onClick={() => setZoom(sh.preview)}
                          style={{ width: 92, height: 68, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border2)', cursor: 'zoom-in', display: 'block' }} />
                        <button type="button" onClick={() => dropShot(sh.id)} title="ถอดรูปนี้ออก"
                          style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%',
                            border: '1px solid var(--border2)', background: 'var(--bg)', color: '#ef4444',
                            fontSize: 13, fontWeight: 800, lineHeight: 1, cursor: 'pointer', padding: 0 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.7 }}>
                แนบให้อัตโนมัติ: หน้าที่เปิดอยู่ <code>{location.pathname}</code> · ผู้แจ้ง <b>{fullName || '—'}</b>
                <br />ไม่ต้องพิมพ์ว่าอยู่หน้าไหน · รูปถูกบีบก่อนส่งให้เอง (ตัวหนังสือในรูปยังอ่านออก)
              </div>

              <button onClick={send} disabled={saving || !msg.trim()}
                style={{ marginTop: 14, width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', cursor: (saving || !msg.trim()) ? 'default' : 'pointer',
                  background: 'var(--accent)', color: '#08130a', fontWeight: 800, fontSize: 14, opacity: (saving || !msg.trim()) ? 0.5 : 1 }}>
                {saving ? (shots.length ? `กำลังอัปรูป ${shots.length} รูป...` : 'กำลังส่ง...') : '📨 ส่งให้ทีมงาน'}
              </button>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} style={{ width: 'auto' }} />
                  เฉพาะที่ยังไม่ปิด
                </label>
                <button onClick={copyForClaude} title="คัดลอกเรื่องที่แสดงอยู่เป็นข้อความ แล้วเอาไปวางในแชท Claude ให้ช่วยดู/แก้"
                  style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', cursor: 'pointer' }}>
                  📋 คัดลอกให้ Claude
                </button>
                <button onClick={load} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer' }}>↻ รีเฟรช</button>
              </div>

              {loading ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>กำลังโหลด...</div>
                : !shown.length ? <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: 20 }}>
                    {rows.length ? 'ไม่มีเรื่องที่ยังไม่ปิด 👍' : 'ยังไม่มีเรื่องที่ส่งเข้ามา'}
                  </div>
                : shown.map(r => {
                  const k = KINDS.find(x => x.key === r.kind) || KINDS[0];
                  const st = STATUS[r.status] || STATUS.new;
                  return (
                    <div key={r.id} style={{ ...box, marginBottom: 8 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 11 }}>
                        <span style={{ color: k.color, fontWeight: 700 }}>{k.icon} {k.label}</span>
                        <span style={{ color: st.color, fontWeight: 700 }}>{st.label}</span>
                        <span style={{ color: 'var(--muted)', marginLeft: 'auto' }}>{fmt(r.created_at)}</span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text)', margin: '5px 0', whiteSpace: 'pre-wrap' }}>{r.message}</div>
                      {!!r.images?.length && (
                        <div style={{ display: 'flex', gap: 6, margin: '6px 0', flexWrap: 'wrap' }}>
                          {r.images.map((u, i) => (
                            <img key={i} src={u} alt={`แนบ ${i + 1}`} loading="lazy" onClick={() => setZoom(u)}
                              style={{ width: 96, height: 70, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border2)', cursor: 'zoom-in' }} />
                          ))}
                        </div>
                      )}
                      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                        {r.user_name || '—'}{r.user_role ? ` · ${r.user_role}` : ''}{r.page_path ? ` · ${r.page_path}` : ''}
                        {r.handled_by ? ` · ปิดโดย ${r.handled_by}` : ''}
                      </div>
                      {/* 💬 คำตอบจากทีมงาน — คนแจ้งต้องเห็น ไม่งั้นแจ้งไปก็เหมือนตกน้ำ */}
                      {r.admin_note && (
                        <div style={{ marginTop: 7, padding: '7px 9px', borderRadius: 8,
                          background: 'var(--accent-dim)', borderLeft: '3px solid var(--accent)' }}>
                          <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--accent)', marginBottom: 3 }}>
                            💬 คำตอบจากทีมงาน{r.handled_by ? ` · ${r.handled_by}` : ''}
                          </div>
                          <div style={{ fontSize: 12.5, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{r.admin_note}</div>
                        </div>
                      )}
                      {isAdmin && (
                        <div style={{ marginTop: 7 }}>
                          <textarea rows={2} value={noteDraft[r.id] ?? r.admin_note ?? ''}
                            onChange={e => setNoteDraft(d => ({ ...d, [r.id]: e.target.value }))}
                            placeholder="ตอบผู้แจ้ง (เขาจะเห็นในกล่องนี้ + เด้งกระดิ่งให้)"
                            style={{ width: '100%', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 7,
                              padding: '6px 8px', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }} />
                          <button onClick={() => saveNote(r)} disabled={savingNote === r.id || !(noteDraft[r.id] ?? r.admin_note ?? '').trim()}
                            style={{ marginTop: 4, fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 7, border: 'none',
                              background: 'var(--accent)', color: '#08130a',
                              cursor: savingNote === r.id ? 'default' : 'pointer', opacity: savingNote === r.id ? 0.5 : 1 }}>
                            {savingNote === r.id ? 'กำลังส่ง...' : '📨 ส่งคำตอบให้ผู้แจ้ง'}
                          </button>
                        </div>
                      )}
                      {isAdmin && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                          {Object.entries(STATUS).map(([key, s]) => (
                            <button key={key} onClick={() => setStatus(r, key)} disabled={r.status === key}
                              style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 12, cursor: r.status === key ? 'default' : 'pointer',
                                border: `1px solid ${r.status === key ? s.color : 'var(--border)'}`,
                                background: r.status === key ? `${s.color}22` : 'transparent', color: r.status === key ? s.color : 'var(--text2)' }}>
                              {s.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </>
          )}
        </div>
      </div>

      {/* ดูรูปเต็มจอ — สกรีนช็อตย่อ 96px อ่านไม่ออกแน่นอน ต้องกดขยายได้
          ⚠️ ซ้อนบนโมดัล feedback (zIndex สูงกว่า) · ปิดจาก backdrop ได้ เพราะไม่ใช่ฟอร์มกรอกข้อมูล */}
      {zoom && (
        <div onClick={() => setZoom(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 3100,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, cursor: 'zoom-out' }}>
          <img src={zoom} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6 }} />
        </div>
      )}
    </div>
  );
}
