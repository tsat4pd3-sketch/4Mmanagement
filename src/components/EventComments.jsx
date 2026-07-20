import { useState, useEffect, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import { fmtDateTime } from '../utils/dateFormat';

/* ── EventComments — คอมเมนต์ + 🔔 mention ใต้เหตุการณ์ (นำร่อง 2026-07-16) ─────────
   ก้าวแรกของการสื่อสารในระบบแทน chat แยก: คุยกันใต้ใบงานจริง ประวัติติดใบ
   ใช้: <EventComments refKind="mtn_order" refId={o.id} contextLabel={`ใบซ่อม ${o.mo_no}`} />
   - ตาราง event_comments อยู่ DR (migration 20260716_event_comments.sql)
   - mention → insert แจ้งเตือนเข้ากระดิ่ง 🔔 ฝั่ง Main (migration 20260716_mention_notify.sql)
   - ทั้งสองส่วน best-effort: migration ยังไม่ apply = แสดงข้อความแจ้ง/ซ่อน mention ไม่พังหน้า */

let mentionCache = null; // รายชื่อ user โหลดครั้งเดียวต่อ session (RPC list_mention_users)
async function loadMentionUsers() {
  if (mentionCache) return mentionCache;
  try {
    const { data, error } = await supabase.rpc('list_mention_users');
    if (error) return []; // ยังไม่ run migration ฝั่ง Main — ปิดความสามารถ mention เงียบๆ
    mentionCache = data || [];
    return mentionCache;
  } catch { return []; }
}

export default function EventComments({ refKind, refId, contextLabel = 'รายการงาน' }) {
  const { fullName } = useContext(UserContext);
  const [items, setItems]     = useState(null); // null = กำลังโหลด
  const [body, setBody]       = useState('');
  const [posting, setPosting] = useState(false);
  const [users, setUsers]     = useState([]);
  const [mentions, setMentions] = useState([]); // [{ id, full_name }]
  const [pickOpen, setPickOpen] = useState(false);
  const [q, setQ]             = useState('');
  const [unavailable, setUnavailable] = useState(false); // ตาราง event_comments ยังไม่ถูกสร้าง

  const load = async () => {
    const { data, error } = await supabaseDR.from('event_comments').select('*')
      .eq('ref_kind', refKind).eq('ref_id', String(refId))
      .order('created_at', { ascending: true }).limit(200);
    if (error) { setUnavailable(true); setItems([]); return; }
    setItems(data || []);
  };
  useEffect(() => { setItems(null); load(); }, [refKind, refId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadMentionUsers().then(setUsers); }, []);

  const post = async () => {
    const text = body.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabaseDR.from('event_comments').insert({
        ref_kind: refKind, ref_id: String(refId),
        author_id: user?.id ?? null,
        author_name: fullName || user?.email || 'ไม่ระบุชื่อ',
        body: text,
        mentions: mentions.map(m => ({ id: m.id, name: m.full_name })),
      });
      if (error) throw error;
      // แจ้งเตือนเข้ากระดิ่ง 🔔 ของคนที่ถูก mention — best-effort ห้ามทำ flow คอมเมนต์พัง
      const targets = mentions.filter(m => m.id && m.id !== user?.id);
      if (targets.length) {
        supabase.from('notifications').insert(targets.map(m => ({
          user_id: m.id, type: 'info',
          title: `💬 ${fullName || 'เพื่อนร่วมงาน'} กล่าวถึงคุณใน ${contextLabel}`,
          body: text.slice(0, 160),
        }))).then(({ error: nErr }) => { if (nErr) console.warn('mention notify:', nErr.message); });
      }
      setBody(''); setMentions([]); setPickOpen(false);
      load();
    } catch (err) {
      toast.error(`ส่งคอมเมนต์ไม่สำเร็จ: ${err?.message || 'ลองใหม่อีกครั้ง'}`);
    }
    setPosting(false);
  };

  const addMention = (u) => {
    setMentions(m => (m.some(x => x.id === u.id) ? m : [...m, u]));
    setQ('');
  };
  const shownUsers = users.filter(u =>
    !mentions.some(m => m.id === u.id) &&
    (!q.trim() || (u.full_name || '').toLowerCase().includes(q.trim().toLowerCase()))
  ).slice(0, 8);

  return (
    <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg)', padding: '10px 12px' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)', marginBottom: 8 }}>
        💬 คอมเมนต์{items ? ` (${items.length})` : ''}
        <span style={{ fontWeight: 500, color: 'var(--muted)', marginLeft: 8, fontSize: 11 }}>คุยกันใต้ใบงาน — ประวัติติดรายการนี้</span>
      </div>

      {unavailable ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 0' }}>
          ⚠️ ระบบคอมเมนต์ยังไม่เปิดใช้ (ยังไม่ run migration <code style={{ fontSize: 11 }}>20260716_event_comments.sql</code>)
        </div>
      ) : (
        <>
          {/* รายการคอมเมนต์ */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto', marginBottom: 8 }}>
            {items == null && <div style={{ fontSize: 12, color: 'var(--muted)' }}>กำลังโหลด...</div>}
            {items != null && items.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีคอมเมนต์ — เริ่มคุยเรื่องรายการนี้ได้เลย</div>}
            {(items || []).map(c => (
              <div key={c.id} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent)' }}>{c.author_name}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDateTime(c.created_at)}</span>
                  {(c.mentions || []).map((m, i) => (
                    <span key={i} style={{ fontSize: 11, fontWeight: 700, color: '#4d9fff', background: 'rgba(77,159,255,0.12)', borderRadius: 20, padding: '1px 8px' }}>🔔 {m.name}</span>
                  ))}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.body}</div>
              </div>
            ))}
          </div>

          {/* ชิปคนที่จะแจ้งเตือน + ปุ่มเลือก */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
            {mentions.map(m => (
              <span key={m.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: '#4d9fff', background: 'rgba(77,159,255,0.12)', border: '1px solid rgba(77,159,255,0.35)', borderRadius: 20, padding: '3px 10px' }}>
                🔔 {m.full_name}
                <button onClick={() => setMentions(x => x.filter(y => y.id !== m.id))}
                  style={{ background: 'none', border: 'none', color: '#4d9fff', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>
              </span>
            ))}
            {users.length > 0 && (
              <div style={{ position: 'relative' }}>
                <button className="tbtn" onClick={() => setPickOpen(o => !o)}
                  style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', background: 'var(--bg2)', border: '1px dashed var(--border2)', borderRadius: 20, padding: '3px 10px', cursor: 'pointer' }}>
                  🔔 แจ้งเตือนถึง... ▾
                </button>
                {pickOpen && (
                  <div style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, zIndex: 50, width: 230, background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 10, boxShadow: 'var(--shadow-lg)', padding: 8 }}>
                    {/* width:'auto' กัน trap input{width:100%}? — อยู่ใน column เต็มกล่อง ใช้ 100% ได้ */}
                    <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 ค้นหาชื่อ..."
                      style={{ fontSize: 12, padding: '6px 9px', marginBottom: 6 }} />
                    <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                      {shownUsers.map(u => (
                        <button key={u.id} onClick={() => addMention(u)}
                          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 8px', borderRadius: 6, color: 'var(--text)', fontSize: 12, fontWeight: 600 }}>
                          {u.full_name}
                        </button>
                      ))}
                      {shownUsers.length === 0 && <div style={{ fontSize: 11, color: 'var(--muted)', padding: '4px 8px' }}>ไม่พบรายชื่อ</div>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ช่องพิมพ์ + ส่ง */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={2}
              placeholder="พิมพ์คอมเมนต์... (Ctrl+Enter เพื่อส่ง)"
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post(); }}
              style={{ flex: 1, fontSize: 13, resize: 'vertical', minHeight: 40, width: 'auto' }} />
            <button className="tbtn" onClick={post} disabled={posting || !body.trim()}
              style={{ padding: '9px 16px', borderRadius: 8, border: 'none', cursor: posting || !body.trim() ? 'default' : 'pointer', background: body.trim() ? 'var(--accent)' : 'var(--border2)', color: body.trim() ? '#08130a' : 'var(--muted)', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
              {posting ? '...' : 'ส่ง'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
