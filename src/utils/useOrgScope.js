import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { loadDivisions } from './orgDivisions';
import { loadCostCenters } from './useCostCenters';
import { buildOrgScope } from './orgScope';

/* ══ useOrgScope — โหลดผังองค์กร (org_nodes + org_divisions) แล้วสร้างดัชนีขอบเขต (2026-09-23) ═════
   คู่กับ `<OrgScopePicker>` — ทุกจอที่ "เลือกขอบเขตดูข้อมูล" (KPI · OBEYA · รายงาน) ใช้ตัวนี้
   ห้ามโหลด `org_nodes kind='section'` มาทำ dropdown เองอีก (เห็นแค่ส่วนงาน = ไม่ตรงผัง)

   รับ `lines` จากผู้เรียก (หน้าส่วนใหญ่โหลด production_lines อยู่แล้ว — ไม่ยิงซ้ำ)
   ⚠️ `lines` ต้อง select ให้ครบ `id, name, section, parent_line_name, cost_center, is_active`
      ขาด parent_line_name = ไม่มีกลุ่มไลน์ · ขาด section = ไลน์ไม่มีที่อยู่ในต้นไม้ · ขาด id = ผูกกับ org line node ไม่ได้
   คืน `{ index, ready, failed }` — `ready=false` ระหว่างโหลด (index ตอนนั้นมีแค่ plant + ไลน์ที่ส่งมา ยังใช้กรองได้)
   🔴 `failed` = ข้อความเหตุผล ⇒ **จอต้องเขียนบอก ห้ามปล่อยให้ดูเหมือนผังมีแค่นี้** */
export default function useOrgScope(lines = []) {
  const [nodes, setNodes] = useState(null);       // null = ยังโหลด
  const [divisions, setDivisions] = useState([]);
  const [ccs, setCcs] = useState([]);           // ทะเบียน cost_centers — ใช้แค่ "ชื่อ" ของรหัส (จอ CC โชว์ `รหัส · ชื่อ`)
  /* 🔴 โหลดผังไม่สำเร็จ ≠ "องค์กรไม่มีหน่วยงาน" (2026-10-13)
     เดิม `setNodes(error ? [] : …)` อ่าน error แล้วโยนทิ้ง ⇒ ตัวเลือกขอบเขตเหลือแค่ plant + ไลน์ที่ส่งมา
     และ `ready` เป็น true ด้วย ⇒ จอ OBEYA/KPI สรุปว่า "ผังมีแค่นี้" โดยไม่มีใครบอกว่าคิวรีล้ม
     (ตัวนี้ **ไม่ได้ผ่าน `cachedMaster`** โดยตั้งใจ — ผังแก้ที่ /org-setup แล้วต้องเห็นทันที
      ไม่รอ TTL 4 ชม. ⇒ toast กลางใน main.jsx ก็ไม่ครอบมาถึง ต้องรายงานเอง)
     ⇒ คืน `failed` ให้จอเขียนบอก · กฎความซื่อสัตย์ของจอ (CLAUDE.md §OBEYA) */
  const [failed, setFailed] = useState(null);   // null = ยังไม่รู้ · '' = ปกติ · ข้อความ = ล้ม

  useEffect(() => {
    let alive = true;
    const fail = (what, e) => {
      console.warn('[useOrgScope] โหลด', what, 'ไม่สำเร็จ — ตัวเลือกขอบเขตจะไม่ครบ', e);
      if (alive) setFailed(prev => prev || `โหลด${what}ไม่สำเร็จ`);
    };
    supabase.from('org_nodes')
      .select('id, kind, code, name, parent_id, ref_line_id, cost_center, division, sort_order, is_active, inherit_scope')
      .eq('is_active', true).order('sort_order', { nullsFirst: false })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) fail('ผังองค์กร', error); else setFailed(prev => prev || '');
        setNodes(error ? [] : (data || []));
      });
    loadDivisions().then(d => { if (alive) setDivisions(d || []); }).catch(e => fail('ทะเบียนฝ่าย', e));
    loadCostCenters().then(d => { if (alive) setCcs(d || []); }).catch(e => fail('ทะเบียน Cost Center', e));
    return () => { alive = false; };
  }, []);

  /* ผูก useMemo กับ "ลายเซ็น" ของ lines ไม่ใช่ตัว array — พ่อ setLines(ใบใหม่เนื้อเดิม) ไม่ต้องสร้างต้นไม้ใหม่ (กฎเหล็ก DB ข้อ 9) */
  const lineSig = (lines || []).map(l => `${l.id}|${l.name}|${l.section || ''}|${l.parent_line_name || ''}|${l.cost_center || ''}|${l.is_active === false ? 0 : 1}`).join('~');
  const index = useMemo(
    () => buildOrgScope({ nodes: nodes || [], lines: lines || [], divisions, costCenters: ccs }),
    [nodes, divisions, ccs, lineSig], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return { index, ready: nodes !== null, failed: failed || '' };
}
