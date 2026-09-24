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
   คืน `{ index, ready }` — `ready=false` ระหว่างโหลด (index ตอนนั้นมีแค่ plant + ไลน์ที่ส่งมา ยังใช้กรองได้) */
export default function useOrgScope(lines = []) {
  const [nodes, setNodes] = useState(null);       // null = ยังโหลด
  const [divisions, setDivisions] = useState([]);
  const [ccs, setCcs] = useState([]);           // ทะเบียน cost_centers — ใช้แค่ "ชื่อ" ของรหัส (จอ CC โชว์ `รหัส · ชื่อ`)

  useEffect(() => {
    let alive = true;
    supabase.from('org_nodes')
      .select('id, kind, code, name, parent_id, ref_line_id, cost_center, division, sort_order, is_active')
      .eq('is_active', true).order('sort_order', { nullsFirst: false })
      .then(({ data, error }) => { if (alive) setNodes(error ? [] : (data || [])); });
    loadDivisions().then(d => { if (alive) setDivisions(d || []); });
    loadCostCenters().then(d => { if (alive) setCcs(d || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  /* ผูก useMemo กับ "ลายเซ็น" ของ lines ไม่ใช่ตัว array — พ่อ setLines(ใบใหม่เนื้อเดิม) ไม่ต้องสร้างต้นไม้ใหม่ (กฎเหล็ก DB ข้อ 9) */
  const lineSig = (lines || []).map(l => `${l.id}|${l.name}|${l.section || ''}|${l.parent_line_name || ''}|${l.cost_center || ''}|${l.is_active === false ? 0 : 1}`).join('~');
  const index = useMemo(
    () => buildOrgScope({ nodes: nodes || [], lines: lines || [], divisions, costCenters: ccs }),
    [nodes, divisions, ccs, lineSig], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return { index, ready: nodes !== null };
}
