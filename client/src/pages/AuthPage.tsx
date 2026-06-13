import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'login') {
        await login(email, password, rememberMe);
      } else {
        await register(email, password, nickname);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || '操作失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col bg-canvas">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">

        {/* Logo mark — Miro yellow */}
        <div className="mb-10 text-center">
          <div className="w-12 h-12 rounded-lg bg-miro-yellow flex items-center justify-center mx-auto mb-5"
               style={{ boxShadow: 'rgba(255,208,47,0.30) 0px 4px 12px' }}>
            <span className="text-lg font-bold text-ink" style={{ fontFamily: "'Geist Mono', monospace" }}>V</span>
          </div>
          <h1 style={{ fontFamily: "'Roobert PRO', 'Inter', sans-serif", fontWeight: 500, letterSpacing: '-0.02em' }}
              className="text-2xl text-ink">
            Vocabulario
          </h1>
          <p className="text-typo-secondary text-sm mt-2">西语词汇视听学习平台</p>
        </div>

        {/* Tabs — pill toggle */}
        <div className="w-full max-w-sm bg-surface rounded-pill p-1 flex mb-8 border border-hairline-soft">
          <button
            onClick={() => setMode('login')}
            className={`flex-1 py-2 text-sm font-medium rounded-pill transition-all duration-200 ${
              mode === 'login'
                ? 'bg-brand text-white'
                : 'text-typo-secondary hover:text-ink'
            }`}
          >
            登录
          </button>
          <button
            onClick={() => setMode('register')}
            className={`flex-1 py-2 text-sm font-medium rounded-pill transition-all duration-200 ${
              mode === 'register'
                ? 'bg-brand text-white'
                : 'text-typo-secondary hover:text-ink'
            }`}
          >
            注册
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
          <div>
            <label
              className="block mb-1.5 text-eyebrow uppercase text-typo-muted"
              style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}
            >
              邮箱
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="请输入邮箱地址"
              className="input-field"
              required
            />
          </div>

          <div>
            <label
              className="block mb-1.5 text-eyebrow uppercase text-typo-muted"
              style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}
            >
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少8位，含字母和数字"
              className="input-field"
              minLength={8}
              required
            />
          </div>

          {mode === 'register' && (
            <div>
              <label
                className="block mb-1.5 text-eyebrow uppercase text-typo-muted"
                style={{ fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}
              >
                昵称 <span className="text-typo-disabled">选填</span>
              </label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="给自己起个名字吧"
                className="input-field"
              />
            </div>
          )}

          {mode === 'login' && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="remember"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-hairline bg-surface accent-brand"
              />
              <label htmlFor="remember" className="text-sm text-typo-secondary">
                记住登录状态
              </label>
            </div>
          )}

          {error && (
            <div className="bg-danger-muted border border-danger/20 text-danger text-sm rounded-input px-4 py-3">
              {error}
            </div>
          )}

          {/* Black-pill primary CTA — Miro style */}
          <button type="submit" disabled={loading} className="btn-primary w-full py-3.5 mt-2">
            {loading ? '请稍候...' : mode === 'login' ? '登录' : '创建账号'}
          </button>
        </form>
      </div>

      <p className="text-center text-xs text-typo-muted pb-8 safe-area-inset-bottom">
        {mode === 'register' ? '注册即代表同意服务条款和隐私政策' : '西语词汇学习平台 © 2026'}
      </p>
    </div>
  );
}
