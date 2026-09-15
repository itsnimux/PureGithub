import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPosts } from '../api.js';
import { faShort, stripHtml } from '../format.js';

export default function WaitingList() {
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    getPosts()
      .then((d) => alive && setPosts(d.posts))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

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
        <p className="state-title">لیست انتظار خالی است</p>
        <p className="state-sub">هنوز پستی برای بازبینی ندارید. از «+ افزودن» یک ریپوی گیت‌هاب معرفی کنید.</p>
        <Link to="/add" className="btn btn-primary">+ افزودن ریپو</Link>
      </div>
    );
  }

  return (
    <section className="queue">
      <div className="queue-head">
        <h1>لیست انتظار</h1>
        <span className="queue-count">{posts.length} پست</span>
      </div>
      <ul className="queue-list">
        {posts.map((p) => (
          <li key={p.id}>
            <Link to={`/post/${p.id}`} className="card queue-card">
              <div className="queue-card-top">
                <span className="repo-full">{p.full_name}</span>
                <SchedulePill publishAt={p.publish_at} />
              </div>
              <p className="queue-caption">{stripHtml(p.caption)}</p>
              <div className="queue-meta">
                <span className="repo-lang">{p.model ?? '—'}</span>
                <span className="attempt">تلاش {p.attempt ?? 1}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SchedulePill({ publishAt }) {
  if (!publishAt) {
    return <span className="pill pill-warn">بدون زمان</span>;
  }
  return <span className="pill pill-sched">🗓 {faShort(publishAt)}</span>;
}