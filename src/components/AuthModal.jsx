import React, { useState } from 'react';
import { User, Mail, Lock, X, Loader2, LogIn, UserPlus } from 'lucide-react';

export default function AuthModal({ isOpen, onClose, client, onSuccess }) {
  const [tab, setTab] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const formatted = username.trim().startsWith('@')
      ? username.trim()
      : '@' + username.trim();

    const res = await client.register(formatted, email, password);
    setLoading(false);
    if (res.ok) {
      if (onSuccess) onSuccess(res.user);
      onClose();
    } else {
      setError(res.error || 'Kayıt başarısız oldu.');
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const res = await client.login(username, password);
    setLoading(false);
    if (res.ok) {
      if (onSuccess) onSuccess(res.user);
      onClose();
    } else {
      setError(res.error || 'Giriş yapılamadı.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-[#262421] border border-[#3c3934] rounded-lg max-w-sm w-full p-5 shadow-2xl space-y-4">
        {/* Başlık ve Kapat Butonu */}
        <div className="flex items-center justify-between border-b border-[#3c3934] pb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-[#3692e7]/20 border border-[#3692e7] flex items-center justify-center text-[#3692e7]">
              <User className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-white text-base">
              {tab === 'login' ? 'Giriş Yap' : 'Yeni Hesap Aç'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#888] hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Geçişi: Giriş Yap / Kayıt Ol */}
        <div className="grid grid-cols-2 bg-[#1b1917] p-1 rounded-md border border-[#3c3934] text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setTab('login');
              setError('');
            }}
            className={`py-1.5 rounded transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
              tab === 'login'
                ? 'bg-[#3692e7] text-white shadow'
                : 'text-[#888] hover:text-white'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Giriş Yap</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setTab('register');
              setError('');
            }}
            className={`py-1.5 rounded transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
              tab === 'register'
                ? 'bg-[#629924] text-white shadow'
                : 'text-[#888] hover:text-white'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Kayıt Ol</span>
          </button>
        </div>

        {/* Hata Kutusu */}
        {error && (
          <div className="bg-red-950/60 border border-red-800 text-red-300 px-3 py-2 rounded text-xs">
            {error}
          </div>
        )}

        {/* Giriş Formu */}
        {tab === 'login' ? (
          <form onSubmit={handleLogin} className="space-y-3 text-xs">
            <div>
              <label className="text-[#aaa] font-semibold block mb-1">
                Kullanıcı Adı veya E-posta:
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-2.5 text-[#666]">
                  <User className="w-3.5 h-3.5" />
                </span>
                <input
                  type="text"
                  placeholder="örn: @enes veya enes@mail.com"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="w-full bg-[#1b1917] border border-[#3c3934] focus:border-[#3692e7] text-white pl-8 pr-3 py-2 rounded outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-[#aaa] font-semibold block mb-1">
                Şifre:
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-2.5 text-[#666]">
                  <Lock className="w-3.5 h-3.5" />
                </span>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full bg-[#1b1917] border border-[#3c3934] focus:border-[#3692e7] text-white pl-8 pr-3 py-2 rounded outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded bg-[#3692e7] hover:bg-[#2878c2] text-white font-bold transition-colors cursor-pointer flex items-center justify-center gap-2 mt-2"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Giriş Yap</span>
            </button>
          </form>
        ) : (
          /* Kayıt Ol Formu */
          <form onSubmit={handleRegister} className="space-y-3 text-xs">
            <div>
              <label className="text-[#aaa] font-semibold block mb-1">
                Kullanıcı Adı:
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-2.5 text-yellow-500 font-bold font-mono">
                  @
                </span>
                <input
                  type="text"
                  placeholder="akifg"
                  value={username.replace(/^@/, '')}
                  onChange={(e) =>
                    setUsername(e.target.value.replace(/\s+/g, ''))
                  }
                  maxLength={20}
                  required
                  className="w-full bg-[#1b1917] border border-[#3c3934] focus:border-[#629924] text-white pl-7 pr-3 py-2 rounded outline-none"
                />
              </div>
              <span className="text-[10px] text-[#777] block mt-0.5">
                Kullanıcı adınız otomatik olarak <strong>@{username.replace(/^@/, '') || 'adiniz'}</strong> şeklinde görünecektir.
              </span>
            </div>

            <div>
              <label className="text-[#aaa] font-semibold block mb-1">
                E-posta:
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-2.5 text-[#666]">
                  <Mail className="w-3.5 h-3.5" />
                </span>
                <input
                  type="email"
                  placeholder="ornek@mail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full bg-[#1b1917] border border-[#3c3934] focus:border-[#629924] text-white pl-8 pr-3 py-2 rounded outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-[#aaa] font-semibold block mb-1">
                Şifre:
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-2.5 text-[#666]">
                  <Lock className="w-3.5 h-3.5" />
                </span>
                <input
                  type="password"
                  placeholder="En az 4 karakter"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={4}
                  required
                  className="w-full bg-[#1b1917] border border-[#3c3934] focus:border-[#629924] text-white pl-8 pr-3 py-2 rounded outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded bg-[#629924] hover:bg-[#53821e] text-white font-bold transition-colors cursor-pointer flex items-center justify-center gap-2 mt-2"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Kayıt Ol & Başla</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
