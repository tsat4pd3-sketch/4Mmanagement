import { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from '../components/Toast';
import { UserContext } from '../App';

/* ─── BOM — Bill of Material ───────────────────────────────────────────────
   แตกพาร์ทย่อย (subcomponent) ของแต่ละ product
   ใช้คู่กับหน้า Heijunka Kanban เพื่อคำนวณความต้องการพาร์ทย่อยตามแผนผลิต */

const card = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: 16,
};
const inputSt = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)',
  fontFamily: 'var(--font-body)', boxSizing: 'border-box',
};
const TH = ({ children, w }) => (
  <th style={{ padding: '8px 10px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', width: w }}>{children}</th>
);
const TD = ({ children, style }) => (
  <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--text)', borderTop: '1px solid var(--border)', ...style }}>{children}</td>
);

const EMPTY_FORM = { mat_no: '', part_name: '', qty_per_unit: 1, uom: 'pcs', supplier: '', note: '' };

export default function BOM() {
  const { role, fullName } = useContext(UserContext);
  const canEdit = ['admin', 'manager', 'supervisor'].includes(role);

  const [products, setProducts]   = useState([]);
  const [selProduct, setSelProduct] = useState(null);
  const [items, setItems]         = useState([]);
  const [counts, setCounts]       = useState({});        // product_id → จำนวนพาร์ทใน BOM
  const [search, setSearch]       = useState('');
  const [loading, setLoading]     = useState(false);
  const [showForm, setShowForm]   = useState(false);
  const [editItem, setEditItem]   = useState(null);      // null = add ใหม่
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);

  /* ── load ── */
  const loadProducts = useCallback(async () => {
    const [{ data: prods }, { data: boms }] = await Promise.all([
      supabaseDR.from('dr_products').select('id, name, code, mat_no, p_no, customer, line_name').eq('is_active', true).order('line_name').order('name'),
      supabaseDR.from('bom_items').select('product_id').eq('is_active', true),
    ]);
    setProducts(prods || []);
    const c = {};
    (boms || []).forEach(b => { c[b.product_id] = (c[b.product_id] || 0) + 1; });
    setCounts(c);
  }, []);

  const loadItems = useCallback(async (productId) => {
    if (!productId) { setItems([]); return; }
    setLoading(true);
    const { data, error } = await supabaseDR.from('bom_items')
      .select('*').eq('product_id', productId).eq('is_active', true).order('mat_no');
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setItems(data || []);
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);
  useEffect(() => { loadItems(selProduct?.id); }, [selProduct, loadItems]);

  /* ── save / delete ── */
  const openAdd  = () => { setEditItem(null); setForm(EMPTY_FORM); setShowForm(true); };
  const openEdit = (it) => { setEditItem(it); setForm({ mat_no: it.mat_no, part_name: it.part_name, qty_per_unit: it.qty_per_unit, uom: it.uom, supplier: it.supplier || '', note: it.note || '' }); setShowForm(true); };

  const handleSave = async () => {
    if (!form.mat_no.trim() || !form.part_name.trim()) { toast.error('กรอก Mat No. และชื่อพาร์ทก่อน'); return; }
    const qty = parseFloat(form.qty_per_unit);
    if (!qty || qty <= 0) { toast.error('จำนวนใช้ต่อชิ้นต้องมากกว่า 0'); return; }
    setSaving(true);
    const payload = {
      mat_no: form.mat_no.trim(), part_name: form.part_name.trim(),
      qty_per_unit: qty, uom: form.uom.trim() || 'pcs',
      supplier: form.supplier.trim() || null, note: form.note.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = editItem
      ? await supabaseDR.from('bom_items').update(payload).eq('id', editItem.id)
      : await supabaseDR.from('bom_items').insert({ ...payload, product_id: selProduct.id, created_by: fullName });
    setSaving(false);
    if (error) {
      toast.error(error.code === '23505' ? `Mat No. ${form.mat_no} มีใน BOM นี้แล้ว` : error.message);
      return;
    }
    toast.success(editItem ? 'แก้ไขพาร์ทแล้ว' : 'เพิ่มพาร์ทใน BOM แล้ว');
    setShowForm(false);
    loadItems(selProduct.id);
    loadProducts();
  };

  const handleDelete = async (it) => {
    if (!window.confirm(`ลบ ${it.mat_no} · ${it.part_name} ออกจาก BOM?`)) return;
    const { error } = await supabaseDR.from('bom_items').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', it.id);
    if (error) { toast.error(error.message); return; }
    toast.success('ลบพาร์ทแล้ว');
    loadItems(selProduct.id);
    loadProducts();
  };

  /* ── filtered products ── */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.mat_no || '').toLowerCase().includes(q) ||
      (p.customer || '').toLowerCase().includes(q) ||
      (p.line_name || '').toLowerCase().includes(q));
  }, [products, search]);

  return (
    <div style={{ padding: 'clamp(12px, 2vw, 24px)', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(18px, 2.5vw, 24px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
          📦 BOM — Bill of Material
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
          แตกพาร์ทย่อย (subcomponent) ของแต่ละ product · ใช้คำนวณความต้องการในหน้า Heijunka Kanban
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) 1fr', gap: 16, alignItems: 'start' }}>
        {/* ── Product list ── */}
        <div style={{ ...card, padding: 12 }}>
          <input
            style={inputSt} placeholder="🔍 ค้นหา product / mat no. / ลูกค้า..."
            value={search} onChange={e => setSearch(e.target.value)}
          />
          <div style={{ marginTop: 10, maxHeight: '70vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(p => {
              const active = selProduct?.id === p.id;
              const n = counts[p.id] || 0;
              return (
                <div key={p.id} onClick={() => setSelProduct(p)} style={{
                  padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                  background: active ? 'rgba(61,214,92,0.1)' : 'var(--bg2)',
                  border: `1px solid ${active ? 'rgba(61,214,92,0.4)' : 'var(--border)'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: active ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 10, flexShrink: 0,
                      background: n > 0 ? 'rgba(61,214,92,0.15)' : 'rgba(255,255,255,0.06)',
                      color: n > 0 ? 'var(--accent)' : 'var(--muted)',
                    }}>{n > 0 ? `${n} พาร์ท` : 'ยังไม่มี BOM'}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    {[p.mat_no, p.line_name, p.customer].filter(Boolean).join(' · ')}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>ไม่พบ product</div>}
          </div>
        </div>

        {/* ── BOM detail ── */}
        <div style={card}>
          {!selProduct ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
              ← เลือก product เพื่อดู / แก้ไข BOM
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>{selProduct.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    {[selProduct.mat_no && `Mat: ${selProduct.mat_no}`, selProduct.p_no && `P/No: ${selProduct.p_no}`, selProduct.line_name, selProduct.customer].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {canEdit && (
                  <button onClick={openAdd} style={{
                    padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: 'var(--accent)', color: '#08130a', fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-body)',
                  }}>+ เพิ่มพาร์ทย่อย</button>
                )}
              </div>

              {loading ? (
                <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>กำลังโหลด...</div>
              ) : items.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13, background: 'var(--bg2)', borderRadius: 8, border: '1px dashed var(--border)' }}>
                  ยังไม่มีพาร์ทย่อยใน BOM นี้{canEdit && ' — กด "+ เพิ่มพาร์ทย่อย" เพื่อเริ่ม'}
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg2)' }}>
                        <TH>Mat No.</TH><TH>ชื่อพาร์ท</TH><TH w={110}>ใช้ / 1 ชิ้น</TH><TH w={70}>หน่วย</TH><TH>Supplier</TH><TH>หมายเหตุ</TH>
                        {canEdit && <TH w={100}> </TH>}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(it => (
                        <tr key={it.id}>
                          <TD style={{ fontWeight: 700, fontFamily: 'monospace' }}>{it.mat_no}</TD>
                          <TD>{it.part_name}</TD>
                          <TD style={{ fontWeight: 800, color: 'var(--accent)' }}>{Number(it.qty_per_unit)}</TD>
                          <TD style={{ color: 'var(--muted)' }}>{it.uom}</TD>
                          <TD style={{ color: 'var(--muted)' }}>{it.supplier || '—'}</TD>
                          <TD style={{ color: 'var(--muted)', fontSize: 12 }}>{it.note || '—'}</TD>
                          {canEdit && (
                            <TD>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => openEdit(it)} title="แก้ไข" style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }}>✏️</button>
                                <button onClick={() => handleDelete(it)} title="ลบ" style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>🗑</button>
                              </div>
                            </TD>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Add / Edit modal ── */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
             onClick={() => setShowForm(false)}>
          <div style={{ ...card, width: 'min(480px, 100%)', padding: 20 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 4, fontFamily: 'var(--font-display)' }}>
              {editItem ? '✏️ แก้ไขพาร์ทย่อย' : '➕ เพิ่มพาร์ทย่อย'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>{selProduct?.name}</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>MAT NO. *</label>
                <input style={inputSt} value={form.mat_no} onChange={e => setForm(f => ({ ...f, mat_no: e.target.value }))} placeholder="เช่น 90119-T0335" disabled={!!editItem} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ชื่อพาร์ท *</label>
                <input style={inputSt} value={form.part_name} onChange={e => setForm(f => ({ ...f, part_name: e.target.value }))} placeholder="เช่น BOLT, FLANGE" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ใช้ต่อ 1 ชิ้นงาน *</label>
                <input style={inputSt} type="number" min="0.001" step="any" value={form.qty_per_unit} onChange={e => setForm(f => ({ ...f, qty_per_unit: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>หน่วย</label>
                <input style={inputSt} value={form.uom} onChange={e => setForm(f => ({ ...f, uom: e.target.value }))} placeholder="pcs" />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>SUPPLIER</label>
                <input style={inputSt} value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>หมายเหตุ</label>
                <input style={inputSt} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-body)' }}>ยกเลิก</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#08130a', cursor: 'pointer', fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-body)' }}>
                {saving ? '...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
