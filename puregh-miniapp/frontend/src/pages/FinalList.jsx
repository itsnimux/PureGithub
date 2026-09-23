import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getFinalPosts, sendNow, deletePost } from '../api.js';
import { faShort, stripHtml } from '../format.js';

const VERDICT_LABEL = { strong: 'قوی ✅', maybe: 'محتمل 🟡', reject: 'ضعیف ❌' };

export default function FinalList() {
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind: 'send'|'del', post }
  const [notice, setNotice] = useState(null);

  const load = async () => {
    try {
      const d = await getFinalPosts();
      setPosts(d.posts);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  const action = async (kind, post) => {
    setConfirm(null);
    setBusyId(post.id);
    setNotice(null);
    try {
      if (kind === 'send') {
        const r = await sendNow(post.id);
        setNotice({ kind: 'ok', text: `منتشر شد ✅ (message ${r.message_id})` });
      } else {
        await deletePost(post.id);
        setNotice({ kind: 'ok', text: 'حذف شد 🗑' });
      }
    } catch (e) {
      setNotice({ kind: 'err', text: e.message });
    } finally {
      setBusyId(null);
      load();
    }
  };

  if (error) {
    return (
      <div className="state">
        <p className="state-title">خطا</p>
        <p className="state-sub">{error}</p>
      </div>
    );
  }

  if (posts === null) {
    return <div className="state"><p className="state-sub">در حال بارگذاری…</p></div>;
  }

  if (posts.length === 0) {
    return (
      <div className="state empty">
        <div className="empty-orb" />
        <p className="state-title">لیست نهایی خالی است</p>
        <p className="state-sub">پستی که از لیست انتظار تأیید کنید اینجا می‌آید و در زمان مقرر یا همین حالا منتشر می‌شود.</p>
        <Link to="/" className="btn btn-primary">برو به لیست انتظار</Link>
      </div>
    );
  }

  return (
    <section className="queue">
      <div className="queue-head">
        <h1>لیست نهایی</h1>
        <span className="queue-count">{posts.length} پست</span>
      </div>

      {notice && <div className={`notice notice-${notice.kind}`}>{notice.text}</div>}

      <ul className="queue-list">
        {posts.map((p) => (
          <li key={p.id} className="card queue-card">
            <Link to={`/post/${p.id}`} className="queue-card-top">
              <span className="repo-full">{p.full_name}</span>
              <SchedulePill publishAt={p.publish_at} />
            </Link>
            <Link to={`/post/${p.id}`} style={{ display: 'block', textDecoration: 'none' }}>
              <p className="queue-caption">{stripHtml(p.caption)}</p>
            </Link>
            <div className="queue-meta">
              <span className="repo-lang">{p.model ?? '—'}</span>
              <span className="attempt">تلاش {p.attempt ?? 1}</span>
              {p.verdict && <span className="verdict-tag">{VERDICT_LABEL[p.verdict] ?? p.verdict}</span>}
            </div>
            {p.verdict_reason && <p className="verdict-reason">{stripHtml(p.verdict_reason)}</p>}

            <div className="final-actions">
              <button
                className="btn btn-ok"
                disabled={busyId !== null}
                onClick={() => setConfirm({ kind: 'send', post: p })}
              >
                {busyId === p.id ? '…' : '🚀 همین الان بفرست'}
              </button>
              <button
                className="btn btn-danger"
                disabled={busyId !== null}
                onClick={() => setConfirm({ kind: 'del', post: p })}
              >
                🗑 حذف از لیست
              </button>
            </div>
          </li>
        ))}
      </ul>

      {confirm && (
        <div className="modal-overlay" onClick={() => setConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{confirm.kind === 'send' ? 'انتشار همین حالا' : 'حذف از لیست'}</h3>
            <p>
              {confirm.kind === 'send'
                ? `«${confirm.post.full_name}» همین الان در کانال منتشر می‌شود. مطمئنید؟`
                : `«${confirm.post.full_name}» از لیست نهایی حذف می‌شود. ریپو دست‌نخورده می‌ماند. مطمئنید؟`}
            </p>
            <div className="panel-row">
              <button
                className="btn btn-danger"
                disabled={busyId !== null}
                onClick={() => action(confirm.kind, confirm.post)}
              >
                {busyId === confirm.post.id ? '…' : (confirm.kind === 'send' ? 'بله، بفرست' : 'بله، حذف کن')}
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirm(null)}>انصراف</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SchedulePill({ publishAt }) {
  if (!publishAt) {
    return <span className="pill pill-warn">بدون زمان</span>;
  }
  return <span className="pill pill-sched">🗓 {faShort(publishAt)}</span>;
}