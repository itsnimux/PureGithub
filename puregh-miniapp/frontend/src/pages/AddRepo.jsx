import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addGen, addManual } from '../api.js';
import { api } from '../api.js';

export default function AddRepo() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [mode, setMode] = useState('manual'); // 'gen' | 'manual'
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const valid = /^[\w.-]+\/[\w.-]+$/.test(fullName.trim());

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fn = mode === 'gen'
        ? () => addGen(fullName.trim())
        : () => addManual(fullName.trim(), caption);
      const d = await fn();
      setResult(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="add">
      <button className="back" onClick={() => navigate('/')}>→ بازگشت به لیست</button>
      <h1>افزودن ریپو به لیست انتظار</h1>
      <p className="lead">آدرس ریپوی گیت‌هاب را بدهید. کپشن را خودتان بنویسید یا با هوش مصنوعی بسازید.</p>

      <div className="panel">
        <label className="field-label">آدرس ریپو (owner/repo)</label>
        <input
          className="input mono"
          dir="ltr"
          placeholder="owner/repository"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>

      <div className="seg">
        <button className={'seg-btn' + (mode === 'manual' ? ' on' : '')} onClick={() => setMode('manual')}>کپشن دستی</button>
        <button className={'seg-btn' + (mode === 'gen' ? ' on' : '')} onClick={() => setMode('gen')}>ساخت با AI</button>
      </div>

      {mode === 'manual' && (
        <div className="panel">
          <label className="field-label">کپشن</label>
          <textarea
            className="ta"
            dir="rtl"
            rows={8}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="متن کپشن را اینجا بنویسید…"
          />
        </div>
      )}

      {error && <div className="notice notice-err">{error}</div>}
      {result && (
        <div className="notice notice-ok">
          ✓ ساخته شد — پست #{result.post_id}
          <button className="btn btn-primary btn-sm" onClick={() => navigate(`/post/${result.post_id}`)}>مشاهده و بازبینی</button>
        </div>
      )}

      <button className="btn btn-primary btn-wide" disabled={!valid || busy} onClick={submit}>
        {busy ? '…' : mode === 'gen' ? 'ساخت کپشن با AI' : 'افزودن به لیست'}
      </button>
    </section>
  );
}