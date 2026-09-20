import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getPost, approve, rejectPost, deletePost, regen, api } from '../api.js';
import { faDateTime, stripHtml, escapeHtml } from '../format.js';
import ShamsiPicker from '../components/ShamsiPicker.jsx';

export default function PostDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // which action is running
  const [notice, setNotice] = useState(null);

  const [schedVal, setSchedVal] = useState('');
  const [editing, setEditing] = useState(false);
  const [captionDraft, setCaptionDraft] = useState('');
  const [confirmReject, setConfirmReject] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = async () => {
    try {
      const d = await getPost(id);
      setPost(d.post);
      if (d.post.publish_at) setSchedVal(d.post.publish_at);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const run = async (label, fn) => {
    setBusy(label);
    setNotice(null);
    try {
      await fn();
      setNotice({ kind: 'ok', text: 'انجام شد ✓' });
    } catch (e) {
      setNotice({ kind: 'err', text: e.message });
    } finally {
      setBusy(null);
      load();
    }
  };

  const openEdit = () => {
    setCaptionDraft(stripHtml(post.caption));
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setCaptionDraft('');
  };

  const saveCaption = () =>
    run('caption', () => api.post(`/api/posts/${id}/caption`, { caption: escapeHtml(captionDraft) }));

  if (error) return <div className="state"><p className="state-title">خطا</p><p className="state-sub">{error}</p></div>;
  if (!post) return <div className="state"><p className="state-sub">در حال بارگذاری…</p></div>;

  const act = (label) => busy === label;
  const blocked = busy !== null;

  return (
    <section className="review">
      <button className="back" onClick={() => navigate('/')}>→ بازگشت به لیست</button>

      <div className="review-head">
        <h1 className="review-repo">{post.full_name}</h1>
        <StatusLine publishAt={post.publish_at} status={post.status} />
      </div>

      {/* The caption rendered exactly as it will appear on the channel */}
      <div className="channel-card">
        <div className="channel-caption" dangerouslySetInnerHTML={{ __html: post.caption }} />
        <div className="channel-meta">
          {post.publish_at && <span>🕒 {faDateTime(post.publish_at)}</span>}
        </div>
      </div>

      {notice && <div className={`notice notice-${notice.kind}`}>{notice.text}</div>}

      {/* Actions */}
      <div className="actions">
        <button
          className="btn btn-ok"
          disabled={blocked}
          onClick={() => run('approve', () => approve(id))}
        >
          {act('approve') ? '…' : '✓ تایید'}
        </button>
        <button
          className="btn btn-danger"
          disabled={blocked}
          onClick={() => setConfirmReject(true)}
        >
          {act('reject') ? '…' : '✕ رد'}
        </button>
        <button
          className="btn btn-ghost"
          disabled={blocked}
          onClick={() => run('regen', () => regen(id))}
        >
          {act('regen') ? '…' : '🔄 ساخت دوباره کپشن'}
        </button>
        <button
          className="btn btn-ghost"
          disabled={blocked}
          onClick={() => setConfirmDelete(true)}
        >
          {act('delete') ? '…' : '🗑 حذف از لیست'}
        </button>
      </div>

      {/* Edit caption — plain text; HTML is escaped on save */}
      {editing ? (
        <div className="panel">
          <textarea
            className="ta"
            dir="rtl"
            rows={6}
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
          />
          <div className="panel-row">
            <button className="btn btn-primary" disabled={blocked} onClick={saveCaption}>
              {act('caption') ? '…' : 'ذخیره کپشن'}
            </button>
            <button className="btn btn-ghost" onClick={cancelEdit}>انصراف</button>
          </div>
        </div>
      ) : (
        <button className="btn btn-ghost btn-wide" onClick={openEdit}>✍️ ویرایش دستی کپشن</button>
      )}

      {/* Schedule — Shamsi date/time, stored as UTC */}
      <div className="panel">
        <label className="field-label">زمان انتشار — شمسی، به وقت تهران</label>
        <ShamsiPicker value={schedVal} onChange={setSchedVal} />
        <button
          className="btn btn-primary"
          disabled={blocked}
          onClick={() => run('schedule', () => api.post(`/api/posts/${id}/schedule`, { publish_at: schedVal }))}
        >
          {act('schedule') ? '…' : '🗓 ذخیره زمان'}
        </button>
      </div>

      {/* In-app confirm for rejection — window.confirm misbehaves inside Telegram */}
      {confirmReject && (
        <div className="modal-overlay" onClick={() => setConfirmReject(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>رد پست</h3>
            <p>این پست از لیست انتظار حذف و ریپو برای همیشه قفل می‌شود. مطمئنید؟</p>
            <div className="panel-row">
              <button
                className="btn btn-danger"
                disabled={blocked}
                onClick={() => { setConfirmReject(false); run('reject', () => rejectPost(id)); }}
              >
                {act('reject') ? '…' : 'بله، رد کن'}
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmReject(false)}>انصراف</button>
            </div>
          </div>
        </div>
      )}

      {/* In-app confirm for delete-from-list (unlike reject, no permanent lock) */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>حذف از لیست</h3>
            <p>این پست از لیست انتظار حذف می‌شود. ریپو دست‌نخورده می‌ماند و در کشف‌های بعدی ممکن است دوباره بیاید. مطمئنید؟</p>
            <div className="panel-row">
              <button
                className="btn btn-danger"
                disabled={blocked}
                onClick={() => { setConfirmDelete(false); run('delete', () => deletePost(id)); }}
              >
                {act('delete') ? '…' : 'بله، حذف کن'}
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>انصراف</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function StatusLine({ publishAt, status }) {
  const step = status === 'draft' ? (publishAt ? 2 : 1) : 3;
  const label = status === 'draft' ? (publishAt ? 'زمان‌بندی شده' : 'بدون زمان') : status;
  return (
    <div className="statusline">
      <span className={'sdot' + (step >= 1 ? ' on' : '')} />
      <span className={'sdot' + (step >= 2 ? ' on' : '')} />
      <span className={'sdot' + (step >= 3 ? ' on' : '')} />
      <span className="statuslabel">{label}</span>
    </div>
  );
}