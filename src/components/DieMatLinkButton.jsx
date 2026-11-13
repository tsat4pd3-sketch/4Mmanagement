/* 🔗 "ผูก MAT นี้กับชุดแม่พิมพ์" จากจุดที่คนเพิ่งเลือกแม่พิมพ์ (2026-11-08 · คำสั่ง user)
   ทะเบียนชุดแม่พิมพ์ผูก MAT ไว้แค่ 2/92 (วัด 05/11) ⇒ ให้คนที่ยืนอยู่หน้าแม่พิมพ์ผูกได้ทันที
   แล้วทะเบียนจะเต็มเองจากการใช้งานจริง (หลักเดียวกับ DieMatLinkNote ใน ProdLotPlanner · 19/10)

   🔴 คนกด ระบบไม่กดให้ · ผูกได้เฉพาะชุดที่ **ยังไม่มี MAT เลย** (`matSlotFor` === 'mat_no')
      ชุดที่ผูกพาร์ทอื่นไว้ = เขียนเตือน ห้ามเติมช่องที่ 2 ให้เอง (ช่องที่ 2 = งานคู่ ⇒ คนตัดสินที่ทะเบียน)
   🔴 สิทธิ์ = `machines:edit` (เจ้าของทะเบียนแม่พิมพ์) ไม่มีสิทธิ์ = เขียนบอกทางไปทะเบียน ห้ามซ่อนเงียบ
   🔴 compare-and-swap + นับแถว — RLS ปฏิเสธ UPDATE = 0 แถว ไม่มี error */
import { useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { can } from '../utils/permissions';
import { checkWriteRows } from '../utils/dbWrite';
import { dieSetMats, matSlotFor } from '../utils/dieSetMats';

import { tr } from '../utils/i18n';
export default function DieMatLinkButton({ set, mat, role, onDone }) {
  const [busy, setBusy] = useState(false);
  const m = String(mat ?? '').trim();
  if (!set || !m) return null;
  const mats = dieSetMats(set);
  if (mats.includes(m.toUpperCase())) return null;            // ผูกไว้แล้ว
  if (mats.length) return (
    <div style={{ fontSize: 11, color: 'var(--amber)' }}>
      ⚠ ทะเบียนบอกว่าชุด {set.set_code} {tr('ทำ')} {mats.join(' + ')} — ถ้าทำพาร์ทนี้ด้วยจริง แก้ที่ /equipment?tab=die
    </div>
  );
  if (matSlotFor(set, m) !== 'mat_no') return null;
  if (!can('machines', 'edit', role)) return (
    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{tr('ชุด')} {set.set_code} ยังไม่ผูก MAT — ผู้มีสิทธิ์ทะเบียนแม่พิมพ์ผูกได้ที่ /equipment?tab=die</div>
  );

  async function link() {
    if (!window.confirm(`ผูก MAT ${m} เข้ากับชุดแม่พิมพ์ ${set.set_code}?\n\n`
      + 'ทะเบียนแม่พิมพ์จะจำว่าชุดนี้ทำพาร์ทนี้ ⇒ ครั้งต่อไประบบขึ้นแม่พิมพ์ชุดนี้เป็น "ทะเบียนยืนยัน"\n'
      + 'แก้ได้ภายหลังที่ /equipment?tab=die')) return;
    setBusy(true);
    try {
      const q = supabaseDR.from('die_sets').update({ mat_no: m }).eq('id', set.id);
      const cas = set.mat_no == null ? q.is('mat_no', null) : q.eq('mat_no', set.mat_no);
      if (!checkWriteRows(await cas.select('id'), `ผูก MAT กับชุด ${set.set_code}`,
        { zeroMsg: `ช่อง MAT ของชุด ${set.set_code} ถูกกรอกไปแล้ว หรือบัญชีคุณไม่มีสิทธิ์ — โหลดใหม่แล้วดูอีกครั้ง` })) return;
      toast.success(`ผูก ${m} → ${set.set_code} แล้ว`);
      await onDone?.();
    } finally { setBusy(false); }
  }
  return (
    <button type="button" onClick={link} disabled={busy}
      style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--r-md)', cursor: busy ? 'default' : 'pointer',
        background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--accent)' }}>
      {busy ? 'กำลังผูก…' : `🔗 ยืนยัน: ชุด ${set.set_code} ทำ MAT ${m}`}
    </button>
  );
}
