import { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const navItems = [
  { path: '/', label: '首页', icon: 'home' },
  { path: '/upload', label: '上传', icon: 'upload' },
  { path: '/modules', label: '模块', icon: 'module' },
  { path: '/wordbooks', label: '词本', icon: 'books' },
  { path: '/profile', label: '我的', icon: 'profile' },
];

function NavIcon({ name, active, size }: { name: string; active: boolean; size?: string }) {
  const sz = size || 'w-6 h-6';
  const icons: Record<string, ReactNode> = {
    home: (
      <svg className={sz} fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7m-9 2v8m0 0h6m-6 0v-4m0 0h6v4" />
      </svg>
    ),
    upload: (
      <svg className={sz} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5-5m0 0l5 5m-5-5v12" />
      </svg>
    ),
    create: (
      <svg className={sz} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 11l-2 5 5-2 8.232-8.232a2.5 2.5 0 00-3.536-3.536L9 11z" />
      </svg>
    ),
    module: (
      <svg className={sz} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
    books: (
      <svg className={sz} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
    profile: (
      <svg className={sz} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  };
  return <>{icons[name] || icons.home}</>;
}

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <div className="flex flex-col md:flex-row min-h-dvh bg-canvas">
      {/* Desktop Sidebar — Miro style: white bg, hairline border */}
      <aside className="hidden md:flex flex-col w-52 lg:w-56 h-dvh sticky top-0 border-r border-hairline-soft py-6 px-2 flex-shrink-0 bg-canvas">
        {/* Brand — Miro yellow wordmark style */}
        <div className="mb-8 px-3">
          <h1 className="text-base lg:text-lg font-medium text-ink flex items-center gap-2"
              style={{ fontFamily: "'Roobert PRO', 'Inter', sans-serif" }}>
            <span className="w-7 h-7 rounded-md bg-miro-yellow flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold text-ink" style={{ fontFamily: "'Geist Mono', monospace" }}>V</span>
            </span>
            Vocabulario
          </h1>
        </div>

        {/* Nav items */}
        <nav className="flex-1 flex flex-col gap-0.5">
          {navItems.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-pill transition-all duration-200 text-sm ${
                isActive(item.path)
                  ? 'bg-brand text-white font-medium'
                  : 'text-typo-muted hover:text-ink hover:bg-surface'
              }`}
            >
              <NavIcon name={item.icon} active={isActive(item.path)} size="w-5 h-5" />
              <span style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Bottom spacer */}
        <div className="mt-auto pt-4 border-t border-hairline-soft px-3">
          <span className="text-[10px] text-typo-muted uppercase tracking-wider"
                style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
            v1.0
          </span>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 pb-20 md:pb-0 min-w-0">
        {children}
      </main>

      {/* Mobile Bottom Nav — Miro white bg style */}
      <nav className="bottom-nav md:hidden">
        <div className="max-w-lg mx-auto flex justify-around items-center h-16 px-2">
          {navItems.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center justify-center gap-0.5 w-full h-full rounded-pill transition-all duration-200 ${
                isActive(item.path) ? 'text-ink font-medium' : 'text-typo-muted'
              }`}
            >
              <NavIcon name={item.icon} active={isActive(item.path)} />
              <span className="text-[11px] font-medium" style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
