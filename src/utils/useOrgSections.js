import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';

/* ══ useOrgSections / useOrgDepts — ตัวเลือก "ส่วนงาน"/"แผนก" ยึด org_nodes เสมอ ══════════════
   (ย้ายออกมาจาก Report.jsx เป็น shared util — 2026-09 เมื่อหน้าที่สองต้องใช้ตัวเดียวกัน)

   ⚠️ กฎเหล็ก (CLAUDE.md — "ตัวเลือกส่วนงาน (section picker) ทุกหน้าต้องยึด org_nodes"):
   ห้ามเดา section list จาก production_lines.section — ลิสต์/ลำดับต้องตรงผังองค์กร
   แล้วค่อย fallback ไปเดาจาก production_lines เมื่อผังยังว่าง (backward-compat)
   · กรองด้วย scope (`inSectionScope`) ทับเสมอที่ฝั่งเรียกใช้ ไม่ใช่หน้าที่ hook นี้
   ═════════════════════════════════════════════════════════════════════════════════════════ */

/** ลิสต์ "ส่วนงาน" ทั้งผัง (org_nodes kind='section', active) — เรียงตามชื่อ */
export function useOrgSections() {
  const [orgSections, setOrgSections] = useState([]);
  useEffect(() => {
    supabase.from('org_nodes').select('code, name').eq('kind', 'section').eq('is_active', true).order('name')
      .then(({ data }) => setOrgSections((data || []).map(n => n.code || n.name).sort()));
  }, []);
  return orgSections;
}

// แผนกตามลำดับชั้นองค์กร — คืนฟังก์ชัน deptsOf(section): กรองแผนกด้วย parent_id ของ section (cascade)
// ไม่คืน list แบนรวมทุก section (dropdown แผนกจะเลือกข้าม section ได้ + ชื่อซ้ำ — บั๊กที่แก้ไปแล้ว 2026-07-21)
export function useOrgDepts() {
  const [tree, setTree] = useState({ secs: [], depts: [] });
  useEffect(() => {
    Promise.all([
      supabase.from('org_nodes').select('id, code, name').eq('kind', 'section').eq('is_active', true),
      supabase.from('org_nodes').select('code, name, parent_id').eq('kind', 'department').eq('is_active', true).order('name'),
    ]).then(([s1, s2]) => setTree({ secs: s1.data || [], depts: s2.data || [] }));
  }, []);
  return useMemo(() => {
    const nameOf = (n) => n.code || n.name;
    const all = [...new Set(tree.depts.map(nameOf))].sort();
    return (sectionCode) => {
      if (!sectionCode) return all;
      const sec = tree.secs.find(n => nameOf(n) === sectionCode);
      if (!sec) return all;
      return [...new Set(tree.depts.filter(d => d.parent_id === sec.id).map(nameOf))].sort();
    };
  }, [tree]);
}
