import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';

export default function ChangePasswordModal({ open, onClose, userEmail }) {
  const [current,  setCurrent]  = useState('');
  const [next,     setNext]     = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [showCur,  setShowCur]  = useState(false);
  const [showNew,  setShowNew]  = useState(false);

  if (!open) return null;

  const reset = () => { setCurrent(''); setNext(''); setConfirm(''); setLoading(false); };
  const handleClose = () => { reset(); onClose(); };

  const validate = () => {
    if (!current) return 'กรุณากรอกรหัสผ่านเดิม';
    if (next.length < 6) return 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร';
    if (next !== confirm) return 'รหัสผ่านใหม่ไม่ตรงกัน';
    if (next === current) return 'รหัสผ่านใหม่ต้องไม่ซ้ำกับเดิม';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validate();
    if (err) { toast.error(err); return; }

    setLoading(true);

    // Step 1: verify current password by re-signing in
    const { error: authErr } = await supabase.auth.signInWithPassword({
      email:    userEmail,
      password: current,
    });
    if (authErr) {
      toast.error('รหัสผ่านเดิมไม่ถูกต้อง');
      setLoading(false);
      return;
    }

    // Step 2: update to new password
    const { error: updErr } = await supabase.auth.updateUser({ password: next });
    if (updErr) {
      toast.error('เปลี่ยนรหัสผ่านไม่สำเร็จ: ' + updErr.message);
      setLoading(false);
      return;
    }

    toast.success('เปลี่ยนรหัสผ่านสำเร็จแล้ว');
    handleClose();
  };

  const match  = confirm.length > 0 && next === confirm;
  const noMatch = confirm.length > 0 && next !== confirm;
  const weak   = next.length > 0 && next.length < 6;

  return (
    <div className="overlay">
      <div
        className="modal"
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(440px, 94vw)' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>🔐</span>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>
                เปลี่ยนรหัสผ่าน
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{userEmail}</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--muted)', cursor: 'pointer', padding: '0 4px' }}
          >✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Current password */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }}>
              รหัสผ่านเดิม
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showCur ? 'text' : 'password'}
                value={current}
                onChange={e => setCurrent(e.target.value)}
                placeholder="กรอกรหัสผ่านปัจจุบัน"
                autoComplete="current-password"
                style={{ paddingRight: 40 }}
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowCur(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 14, color: 'var(--muted)', padding: 0,
                }}
              >{showCur ? '🙈' : '👁'}</button>
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--border)' }} />

          {/* New password */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }}>
              รหัสผ่านใหม่
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showNew ? 'text' : 'password'}
                value={next}
                onChange={e => setNext(e.target.value)}
                placeholder="อย่างน้อย 6 ตัวอักษร"
                autoComplete="new-password"
                style={{
                  paddingRight: 40,
                  borderColor: weak ? '#ef4444' : next.length >= 6 ? 'var(--accent)' : undefined,
                }}
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowNew(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 14, color: 'var(--muted)', padding: 0,
                }}
              >{showNew ? '🙈' : '👁'}</button>
            </div>
            {weak && (
              <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>⚠ ต้องมีอย่างน้อย 6 ตัวอักษร</div>
            )}
          </div>

          {/* Confirm password */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }}>
              ยืนยันรหัสผ่านใหม่
            </label>
            <input
              type={showNew ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
              autoComplete="new-password"
              style={{
                borderColor: match ? 'var(--accent)' : noMatch ? '#ef4444' : undefined,
              }}
              disabled={loading}
            />
            {match   && <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4 }}>✓ รหัสผ่านตรงกัน</div>}
            {noMatch && <div style={{ fontSize: 11, color: '#ef4444',       marginTop: 4 }}>✗ รหัสผ่านไม่ตรงกัน</div>}
          </div>

          {/* Strength bar */}
          {next.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                ความแข็งแกร่ง: {next.length < 6 ? '⚠ อ่อน' : next.length < 10 ? '🟡 พอใช้' : '🟢 แข็งแกร่ง'}
              </div>
              <div style={{ height: 3, borderRadius: 2, background: 'var(--border2)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  width: `${Math.min((next.length / 14) * 100, 100)}%`,
                  background: next.length < 6 ? '#ef4444' : next.length < 10 ? '#f59e0b' : 'var(--accent)',
                  transition: 'width 0.3s, background 0.3s',
                }} />
              </div>
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 8,
                border: '1px solid var(--border2)', background: 'var(--bg3)',
                color: 'var(--text2)', fontWeight: 600, fontSize: 13,
              }}
            >ยกเลิก</button>
            <button
              type="submit"
              disabled={loading || !current || next.length < 6 || next !== confirm}
              style={{
                flex: 2, padding: '10px 0', borderRadius: 8,
                border: 'none',
                background: loading || !current || next.length < 6 || next !== confirm
                  ? 'var(--muted2)' : 'var(--accent)',
                color: '#fff', fontWeight: 700, fontSize: 13,
                transition: 'background 0.2s',
              }}
            >
              {loading ? '⏳ กำลังบันทึก...' : '🔐 เปลี่ยนรหัสผ่าน'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
