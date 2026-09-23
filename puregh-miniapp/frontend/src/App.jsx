import { useState, useEffect, useCallback } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { getPosts, getFinalPosts } from './api.js';

export default function App({ children }) {
  const [count, setCount] = useState(0);
  const [finalCount, setFinalCount] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    try {
      const t = window.Telegram?.WebApp;
      if (t) t.ready();
    } catch {
      // ignore — ready() is a no-op outside the Telegram client
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [w, f] = await Promise.all([getPosts(), getFinalPosts()]);
      setCount(w.posts?.length ?? 0);
      setFinalCount(f.posts?.length ?? 0);
    } catch {
      setCount(0);
      setFinalCount(0);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">P</span>
          <span className="brand-name">Pure GitHub</span>
        </Link>
        <nav className="topnav">
          <NavLink to="/" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            لیست انتظار {count > 0 && <span className="badge">{count}</span>}
          </NavLink>
          <NavLink to="/final" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            لیست نهایی {finalCount > 0 && <span className="badge">{finalCount}</span>}
          </NavLink>
          <NavLink to="/add" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            + افزودن
          </NavLink>
        </nav>
      </header>

      <main className="content">{ready ? children : null}</main>
    </div>
  );
}