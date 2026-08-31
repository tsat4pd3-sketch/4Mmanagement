import { useState, useEffect, useContext, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import { notifyEvent } from '../utils/notifyEvent';

/*
  💬 กล่องรับ feedback จากผู้ใช้หน้างาน (2026-08-14 · คำขอ user)
  เดิม feedback วิ่งผ่าน LINE → ตกหล่น ค้นย้อนไม่ได้ ไม่รู้ว่าเรื่องไหนแก้แล้ว

  ออกแบบให้ "ส่งง่ายที่สุด" เพราะคนหน้างานใส่ถุงมือ/รีบ:
    • พิมพ์ข้อความอย่างเดียวก็ส่งได้ · ประเภทมี default
    • หน้าที่กำลังเปิดอยู่ถูกเก็บให้เอง (page_path) ไม่ต้องอธิบายว่า "อยู่หน้าไหน"
    • ไม่ทำเป็นหน้าแยก + ไม่เพิ่ม permission key ใหม่ (เลี่ยงกับดัก seed enum_range
      ที่ทำให้ role ใหม่เข้าไม่ได้แบบ fail-closed) — กล่องขาเข้าเป็นแท็บในโมดัลนี้
      เห็นเฉพาะ admin/manager ซึ่งตรงกับ RLS ของตาราง
*/

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
  const [msg, setMsg]         = useState('');
  const [saving, setSaving]   = useState(false);
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [notReady, setNotReady] = useState(false);   // ยังไม่ได้ apply migration
  const [onlyOpen, setOnlyOpen] = useState(true);

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

  const send = async () => {
    const body = msg.trim();
    if (!body) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('user_feedback').insert({
      user_id: user?.id, user_name: fullName || user?.email || null, user_role: role || null,
      kind, page_path: location.pathname + (location.search || ''), message: body,
    });
    setSaving(false);
    if (error) {
      console.warn('[feedback] insert', error);
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
      ],
    });
    toast.success('ส่งแล้ว ขอบคุณครับ 🙏 ทีมงานจะตามให้');
    setMsg(''); load();
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
        + ` · ${r.user_name || '—'}${r.user_role ? ` (${r.user_role})` : ''} · หน้า ${r.page_path || '—'}\n   ${r.message.replace(/\n/g, '\n   ')}`;
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

              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.7 }}>
                แนบให้อัตโนมัติ: หน้าที่เปิดอยู่ <code>{location.pathname}</code> · ผู้แจ้ง <b>{fullName || '—'}</b>
                <br />ไม่ต้องพิมพ์ว่าอยู่หน้าไหน · ถ้ามีรูปหน้าจอ ส่งใน LINE ตามหลังได้ (ระบบยังไม่รับไฟล์แนบ)
              </div>

              <button onClick={send} disabled={saving || !msg.trim()}
                style={{ marginTop: 14, width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', cursor: (saving || !msg.trim()) ? 'default' : 'pointer',
                  background: 'var(--accent)', color: '#08130a', fontWeight: 800, fontSize: 14, opacity: (saving || !msg.trim()) ? 0.5 : 1 }}>
                {saving ? 'กำลังส่ง...' : '📨 ส่งให้ทีมงาน'}
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
                      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                        {r.user_name || '—'}{r.user_role ? ` · ${r.user_role}` : ''}{r.page_path ? ` · ${r.page_path}` : ''}
                        {r.handled_by ? ` · ปิดโดย ${r.handled_by}` : ''}
                      </div>
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
    </div>
  );
}
