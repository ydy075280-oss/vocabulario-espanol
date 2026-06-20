import { useRegisterSW } from 'virtual:pwa-register/react';
import { useEffect, useRef } from 'react';

export default function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      // 每 30 分钟检查一次更新
      r && setInterval(() => r.update(), 30 * 60 * 1000);
    },
    onRegisterError(error) {
      console.info('SW registration (non-critical, may fail in dev):', error);
    },
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (needRefresh) {
      // 4 秒后自动更新
      timerRef.current = setTimeout(() => {
        handleUpdate();
      }, 4000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [needRefresh]);

  const handleUpdate = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    updateServiceWorker(true);
  };

  const handleClose = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setNeedRefresh(false);
  };

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-4 left-0 right-0 z-50 px-4 pointer-events-none">
      <div className="mx-auto max-w-sm rounded-xl bg-white shadow-2xl border border-miro/20 pointer-events-auto animate-slide-up overflow-hidden">
        <div className="flex items-center gap-3 p-4">
          {/* 图标 */}
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-miro/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-miro animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </div>

          {/* 文字 */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink">发现新版本</p>
            <p className="text-xs text-ink/50 mt-0.5">即将自动更新…</p>
          </div>

          {/* 按钮 */}
          <div className="flex-shrink-0 flex items-center gap-2">
            <button
              onClick={handleUpdate}
              className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-miro text-white hover:brightness-95 active:scale-95 transition-all"
            >
              立即更新
            </button>
            <button
              onClick={handleClose}
              className="w-6 h-6 flex items-center justify-center rounded-full text-ink/30 hover:text-ink/60 hover:bg-gray-100 transition-colors"
              aria-label="关闭"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* 倒计时进度条 */}
        <div className="h-0.5 bg-miro/10">
          <div className="h-full bg-miro animate-shrink-4s" style={{ animation: 'shrinkBar 4s linear forwards' }} />
        </div>
      </div>
    </div>
  );
}
