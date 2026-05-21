import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from '../components/Toast';

export default function SignatureModal({ open, onClose, currentSignatureUrl, onSaved }) {
  const [tab, setTab] = useState('draw'); // 'draw' | 'upload'
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadPreview, setUploadPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setUploadFile(null);
      setUploadPreview(null);
      setTab('draw');
    }
  }, [open]);

  // Init canvas white background when tab=draw and modal opens
  useEffect(() => {
    if (!open || tab !== 'draw') return;
    setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }, 50);
  }, [open, tab]);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = useCallback((e) => {
    e.preventDefault();
    drawing.current = true;
    const canvas = canvasRef.current;
    const pos = getPos(e, canvas);
    lastPos.current = pos;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 1, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
  }, []);

  const draw = useCallback((e) => {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPos.current = pos;
  }, []);

  const endDraw = useCallback((e) => {
    e?.preventDefault();
    drawing.current = false;
  }, []);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadFile(file);
    const reader = new FileReader();
    reader.onload = () => setUploadPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('ไม่พบข้อมูลผู้ใช้'); setSaving(false); return; }

      const ts = Date.now();
      let filePath, fileBlob, contentType;

      if (tab === 'draw') {
        const canvas = canvasRef.current;
        fileBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        filePath = `${user.id}/${ts}.png`;
        contentType = 'image/png';
      } else {
        if (!uploadFile) { toast.error('กรุณาเลือกไฟล์'); setSaving(false); return; }
        const ext = uploadFile.name.split('.').pop();
        filePath = `${user.id}/${ts}.${ext}`;
        fileBlob = uploadFile;
        contentType = uploadFile.type;
      }

      const { error: upErr } = await supabase.storage
        .from('signatures')
        .upload(filePath, fileBlob, { contentType, upsert: true });
      if (upErr) { toast.error('อัปโหลดไม่สำเร็จ: ' + upErr.message); setSaving(false); return; }

      const { data: { publicUrl } } = supabase.storage.from('signatures').getPublicUrl(filePath);

      const { error: dbErr } = await supabase
        .from('profiles')
        .update({ signature_url: publicUrl })
        .eq('id', user.id);
      if (dbErr) { toast.error('บันทึกไม่สำเร็จ: ' + dbErr.message); setSaving(false); return; }

      toast.success('บันทึกลายเซ็นเรียบร้อย');
      onSaved(publicUrl);
      onClose();
    } catch (err) {
      toast.error('เกิดข้อผิดพลาด: ' + err.message);
    }
    setSaving(false);
  };

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: 'min(480px, 100%)',
        background: 'var(--card)',
        borderRadius: 16,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>✍️ จัดการลายเซ็น</div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--muted)', fontSize: 18, lineHeight: 1, padding: '2px 6px',
          }}>✕</button>
        </div>

        <div style={{ padding: '16px 20px 20px' }}>
          {/* Current signature preview */}
          {currentSignatureUrl && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>ลายเซ็นปัจจุบัน</div>
              <div style={{
                border: '1px solid var(--border)', borderRadius: 8,
                padding: 8, background: 'var(--bg2)', textAlign: 'center',
              }}>
                <img src={currentSignatureUrl} alt="signature" style={{ maxHeight: 60, maxWidth: '100%', objectFit: 'contain' }} />
              </div>
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 14, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
            {[
              { key: 'draw', label: '✏️ วาดลายเซ็น' },
              { key: 'upload', label: '📁 อัปโหลดรูป' },
            ].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: tab === t.key ? 700 : 400,
                background: tab === t.key ? 'var(--accent)' : 'var(--bg2)',
                color: tab === t.key ? '#fff' : 'var(--text2)',
                transition: 'all 0.15s',
              }}>{t.label}</button>
            ))}
          </div>

          {/* Draw tab */}
          {tab === 'draw' && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>วาดลายเซ็นในกรอบด้านล่าง</div>
              <div style={{ border: '2px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: '#fff', cursor: 'crosshair' }}>
                <canvas
                  ref={canvasRef}
                  width={440}
                  height={160}
                  style={{ display: 'block', width: '100%', touchAction: 'none' }}
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                  onTouchStart={startDraw}
                  onTouchMove={draw}
                  onTouchEnd={endDraw}
                />
              </div>
              <button onClick={clearCanvas} style={{
                marginTop: 8, padding: '6px 14px', fontSize: 12, borderRadius: 6,
                background: 'var(--bg3)', border: '1px solid var(--border2)',
                color: 'var(--text2)', cursor: 'pointer',
              }}>🗑️ ล้าง</button>
            </div>
          )}

          {/* Upload tab */}
          {tab === 'upload' && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>เลือกไฟล์รูปภาพลายเซ็น</div>
              <input type="file" accept="image/*" onChange={handleFileChange} style={{ fontSize: 13 }} />
              {uploadPreview && (
                <div style={{
                  marginTop: 12, border: '1px solid var(--border)', borderRadius: 8,
                  padding: 10, background: 'var(--bg2)', textAlign: 'center',
                }}>
                  <img src={uploadPreview} alt="preview" style={{ maxHeight: 120, maxWidth: '100%', objectFit: 'contain' }} />
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={handleSave} disabled={saving} style={{
              flex: 2, padding: '10px 0', background: 'var(--accent)', color: '#fff',
              border: 'none', borderRadius: 8, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1, fontSize: 13,
            }}>
              {saving ? 'กำลังบันทึก...' : '💾 บันทึกลายเซ็น'}
            </button>
            <button onClick={onClose} style={{
              flex: 1, padding: '10px 0', background: 'var(--bg3)',
              border: '1px solid var(--border2)', borderRadius: 8,
              color: 'var(--text2)', cursor: 'pointer', fontSize: 13,
            }}>ยกเลิก</button>
          </div>
        </div>
      </div>
    </div>
  );
}
