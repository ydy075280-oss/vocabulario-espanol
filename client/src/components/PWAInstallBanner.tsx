import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // 检测 iOS
    const isIOSDevice =
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    // 已在独立模式下运行，不需要提示
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    // 监听 beforeinstallprompt (Android Chrome)
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // 延迟 3 秒显示
      setTimeout(() => setShowBanner(true), 3000);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // iOS 设备：延迟 5 秒显示引导
    if (isIOSDevice) {
      setTimeout(() => setShowBanner(true), 5000);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    }
    setShowBanner(false);
    setDismissed(true);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    setDismissed(true);
  };

  if (!showBanner || dismissed) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4">
      <div className="mx-auto max-w-lg rounded-2xl bg-white p-4 shadow-2xl border border-miro/30 animate-slide-up">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <div className="w-10 h-10 rounded-xl bg-miro/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-miro" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="4" />
                <path d="M12 8v8M8 12h8" />
              </svg>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-ink">
              {isIOS ? '添加到主屏幕' : '安装应用'}
            </h3>
            <p className="text-xs text-ink/60 mt-0.5">
              {isIOS
                ? '点击分享按钮，选择「添加到主屏幕」即可像 App 一样使用'
                : '快速安装到桌面，获得更流畅的学习体验'}
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleInstall}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-miro text-white hover:brightness-95 active:scale-95 transition-all"
              >
                {isIOS ? '知道了' : '安装'}
              </button>
              <button
                onClick={handleDismiss}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-ink/40 hover:bg-gray-100 transition-colors"
              >
                稍后
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
