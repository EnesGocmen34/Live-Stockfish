import React, { useState } from 'react';
import {
  Zap,
  Flame,
  Clock,
  Landmark,
  Plus,
  Play,
  User,
  Shield,
  Loader2,
  X,
  Swords,
  Trophy,
  Copy,
  Check,
  Globe
} from 'lucide-react';

const QUICK_PAIR_PRESETS = [
  { label: '1+0', timeMinutes: 1, incSeconds: 0, category: 'bullet', desc: '1 dak' },
  { label: '1+1', timeMinutes: 1, incSeconds: 1, category: 'bullet', desc: '1 dak | 1 s' },
  { label: '1+2', timeMinutes: 1, incSeconds: 2, category: 'bullet', desc: '1 dak | 2 s' },
  { label: '3+0', timeMinutes: 3, incSeconds: 0, category: 'blitz', desc: '3 dak' },
  { label: '3+2', timeMinutes: 3, incSeconds: 2, category: 'blitz', desc: '3 dak | 2 s' },
  { label: '5+3', timeMinutes: 5, incSeconds: 3, category: 'blitz', desc: '5 dak | 3 s' },
  { label: '10+0', timeMinutes: 10, incSeconds: 0, category: 'rapid', desc: '10 dak' },
  { label: '10+5', timeMinutes: 10, incSeconds: 5, category: 'rapid', desc: '10 dak | 5 s' },
  { label: '15+10', timeMinutes: 15, incSeconds: 10, category: 'rapid', desc: '15 dak | 10 s' },
  { label: '30+0', timeMinutes: 30, incSeconds: 0, category: 'classical', desc: '30 dak' },
  { label: '30+20', timeMinutes: 30, incSeconds: 20, category: 'classical', desc: '30 dak | 20 s' },
];

export default function MultiplayerLobby({
  client,
  userProfile,
  lobbyState,
  isConnected,
  waitingQueue,
  myActiveChallenge,
  onQuickPair,
  onCancelPair,
  onCreateChallenge,
  onCancelChallenge,
  onJoinChallenge,
  onJoinByCode,
  onUpdateUsername,
}) {
  const [isRated, setIsRated] = useState(true);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customMinutes, setCustomMinutes] = useState(5);
  const [customInc, setCustomInc] = useState(3);
  const [customColor, setCustomColor] = useState('random');
  const [codeInputValue, setCodeInputValue] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState(userProfile?.username || '');

  const handleCopyCode = (code) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleSaveName = (e) => {
    e.preventDefault();
    if (editNameValue.trim()) {
      onUpdateUsername(editNameValue.trim());
      setIsEditingName(false);
    }
  };

  const getCategoryIcon = (cat) => {
    switch (cat) {
      case 'bullet':
        return <Zap className="w-3.5 h-3.5 text-yellow-400" />;
      case 'blitz':
        return <Flame className="w-3.5 h-3.5 text-orange-400" />;
      case 'rapid':
        return <Clock className="w-3.5 h-3.5 text-green-400" />;
      case 'classical':
        return <Landmark className="w-3.5 h-3.5 text-blue-400" />;
      default:
        return <Clock className="w-3.5 h-3.5 text-neutral-400" />;
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      {/* 1. ÜST PROFİL & BAĞLANTI DURUMU KARTI */}
      <div className="bg-[#262421] border border-[#3c3934] rounded-lg p-4 sm:p-5 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#3c3934]">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[#3692e7]/20 border border-[#3692e7]/50 flex items-center justify-center text-[#3692e7] font-bold text-lg">
              <User className="w-6 h-6" />
            </div>
            <div>
              {isEditingName ? (
                <form onSubmit={handleSaveName} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editNameValue}
                    onChange={(e) => setEditNameValue(e.target.value)}
                    maxLength={20}
                    className="bg-[#1e1c18] border border-[#3692e7] text-white px-2.5 py-1 text-sm rounded outline-none"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="bg-[#629924] hover:bg-[#53821e] text-white px-3 py-1 rounded text-xs font-semibold"
                  >
                    Kaydet
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingName(false)}
                    className="text-[#888] hover:text-white text-xs px-2"
                  >
                    İptal
                  </button>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">
                    {userProfile?.username || 'Misafir Oyuncu'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setEditNameValue(userProfile?.username || '');
                      setIsEditingName(true);
                    }}
                    className="text-xs text-[#3692e7] hover:underline cursor-pointer"
                  >
                    (İsmi Değiştir)
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 text-xs text-[#aaa] mt-0.5">
                <span className="flex items-center gap-1">
                  <Trophy className="w-3 h-3 text-amber-400" /> Toplam Maç:{' '}
                  <strong className="text-white">{userProfile?.stats?.total || 0}</strong>
                </span>
                <span>•</span>
                <span className="text-green-400 font-semibold">{userProfile?.stats?.wins || 0}G</span>
                <span>/</span>
                <span className="text-red-400 font-semibold">{userProfile?.stats?.losses || 0}M</span>
                <span>/</span>
                <span className="text-neutral-400 font-semibold">{userProfile?.stats?.draws || 0}B</span>
              </div>
            </div>
          </div>

          {/* Bağlantı & Sunucu Durumu */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-[#1b1917] px-3 py-1.5 rounded border border-[#3c3934] text-xs">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                }`}
              />
              <span className="text-[#ccc]">
                {isConnected ? 'Canlı Sunucu Bağlı' : 'Bağlantı Bekleniyor...'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 bg-[#1b1917] px-3 py-1.5 rounded border border-[#3c3934] text-xs text-[#aaa]">
              <Globe className="w-3.5 h-3.5 text-[#3692e7]" />
              <span>Çevrimiçi: </span>
              <strong className="text-white">{lobbyState?.onlineCount || 1}</strong>
            </div>
          </div>
        </div>

        {/* ELO PUANLARI KARTLARI (Bullet, Blitz, Rapid, Classical) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <div className="bg-[#1b1917] border border-[#3c3934] rounded-lg p-3 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-[#888] font-semibold flex items-center gap-1 uppercase">
                <Zap className="w-3 h-3 text-yellow-400" /> Kurşun (Bullet)
              </div>
              <div className="text-lg font-bold text-white mt-0.5">
                {userProfile?.ratings?.bullet || 1500}
              </div>
            </div>
            <span className="text-xs text-yellow-400/80 font-mono">&lt; 3 dk</span>
          </div>

          <div className="bg-[#1b1917] border border-[#3c3934] rounded-lg p-3 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-[#888] font-semibold flex items-center gap-1 uppercase">
                <Flame className="w-3 h-3 text-orange-400" /> Yıldırım (Blitz)
              </div>
              <div className="text-lg font-bold text-white mt-0.5">
                {userProfile?.ratings?.blitz || 1500}
              </div>
            </div>
            <span className="text-xs text-orange-400/80 font-mono">3-8 dk</span>
          </div>

          <div className="bg-[#1b1917] border border-[#3c3934] rounded-lg p-3 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-[#888] font-semibold flex items-center gap-1 uppercase">
                <Clock className="w-3 h-3 text-green-400" /> Hızlı (Rapid)
              </div>
              <div className="text-lg font-bold text-white mt-0.5">
                {userProfile?.ratings?.rapid || 1500}
              </div>
            </div>
            <span className="text-xs text-green-400/80 font-mono">10-25 dk</span>
          </div>

          <div className="bg-[#1b1917] border border-[#3c3934] rounded-lg p-3 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-[#888] font-semibold flex items-center gap-1 uppercase">
                <Landmark className="w-3 h-3 text-blue-400" /> Klasik (Classic)
              </div>
              <div className="text-lg font-bold text-white mt-0.5">
                {userProfile?.ratings?.classical || 1500}
              </div>
            </div>
            <span className="text-xs text-blue-400/80 font-mono">25+ dk</span>
          </div>
        </div>
      </div>

      {/* 2. EŞLEŞME BEKLEME AFİŞİ (EĞER SIRADAYSA) */}
      {waitingQueue && (
        <div className="bg-[#1c2938] border-2 border-[#3692e7] rounded-lg p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl animate-fade-in">
          <div className="flex items-center gap-3">
            <Loader2 className="w-6 h-6 text-[#3692e7] animate-spin" />
            <div>
              <div className="font-bold text-white text-sm sm:text-base">
                {waitingQueue.tcKey} Rakip Aranıyor...
              </div>
              <div className="text-xs text-[#9bbbd4]">
                Mod:{' '}
                <strong className={waitingQueue.rated ? 'text-amber-400' : 'text-neutral-400'}>
                  {waitingQueue.rated ? 'Puanlı (Rated Elo)' : 'Puansız (Dostluk)'}
                </strong>{' '}
                • Uygun oyuncu katıldığında maç anında başlayacak
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancelPair}
            className="w-full sm:w-auto bg-[#c33] hover:bg-[#a22] text-white px-4 py-2 rounded text-xs font-bold transition-colors cursor-pointer"
          >
            Aramayı İptal Et
          </button>
        </div>
      )}

      {/* 3. AÇILAN MEYDAN OKUMA AFİŞİ (KULLANICININ OLUŞTURDUĞU ODA) */}
      {myActiveChallenge && (
        <div className="bg-[#242b1f] border-2 border-[#629924] rounded-lg p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#629924]/20 border border-[#629924] flex items-center justify-center text-[#629924]">
              <Swords className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-white text-sm sm:text-base flex items-center gap-2">
                <span>Meydan Okuma Bekleniyor</span>
                <span className="text-xs bg-[#1b1917] px-2 py-0.5 rounded border border-[#3c3934] text-[#bbb]">
                  {myActiveChallenge.timeMinutes}+{myActiveChallenge.incSeconds}
                </span>
              </div>
              <div className="text-xs text-[#a3c988] mt-0.5 flex items-center gap-2">
                <span>Oda Kodu:</span>
                <code className="bg-[#141d11] px-2 py-0.5 rounded font-mono font-bold text-yellow-300 tracking-wider">
                  {myActiveChallenge.code}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopyCode(myActiveChallenge.code)}
                  className="hover:text-white cursor-pointer"
                  title="Kodu Kopyala"
                >
                  {copiedCode ? (
                    <Check className="w-3.5 h-3.5 text-green-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onCancelChallenge(myActiveChallenge.challengeId)}
            className="w-full sm:w-auto bg-[#c33] hover:bg-[#a22] text-white px-4 py-2 rounded text-xs font-bold transition-colors cursor-pointer"
          >
            Meydan Okumayı Kaldır
          </button>
        </div>
      )}

      {/* 4. HIZLI EŞLEŞME TABLOSU (LICHESS STYLE QUICK PAIRING GRID) */}
      <div className="bg-[#262421] border border-[#3c3934] rounded-lg p-4 sm:p-5 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" /> Hızlı Eşleşme (Tek Tıkla Oyna)
            </h3>
            <p className="text-xs text-[#888] mt-0.5">
              İstediğiniz zaman kontrolüne tıklayarak anında havuza katılın
            </p>
          </div>

          {/* Puanlı / Puansız Toggle Switch */}
          <div className="flex items-center gap-2 bg-[#1b1917] p-1 rounded-md border border-[#3c3934] self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setIsRated(true)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold transition-colors ${
                isRated
                  ? 'bg-amber-600 text-white shadow'
                  : 'text-[#888] hover:text-white'
              }`}
            >
              <Shield className="w-3.5 h-3.5" /> Puanlı (Rated)
            </button>
            <button
              type="button"
              onClick={() => setIsRated(false)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold transition-colors ${
                !isRated
                  ? 'bg-[#3692e7] text-white shadow'
                  : 'text-[#888] hover:text-white'
              }`}
            >
              Puansız (Casual)
            </button>
          </div>
        </div>

        {/* 11'li Hızlı Eşleşme Butonları Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
          {QUICK_PAIR_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onQuickPair(preset.label, isRated)}
              className="group bg-[#1e1c18] hover:bg-[#322f2a] border border-[#3c3934] hover:border-[#3692e7] p-3 rounded-lg flex flex-col items-center justify-center gap-1 transition-all duration-150 cursor-pointer text-center"
            >
              <div className="flex items-center gap-1">
                {getCategoryIcon(preset.category)}
                <span className="text-base font-black text-white group-hover:text-[#3692e7]">
                  {preset.label}
                </span>
              </div>
              <span className="text-[11px] text-[#888] font-medium">{preset.desc}</span>
            </button>
          ))}

          {/* Özel Ayarlı Maç Aç Butonu */}
          <button
            type="button"
            onClick={() => setShowCustomModal(true)}
            className="group bg-[#2a261f] hover:bg-[#38332a] border border-[#e68a2e]/40 hover:border-[#e68a2e] p-3 rounded-lg flex flex-col items-center justify-center gap-1 transition-all duration-150 cursor-pointer text-center"
          >
            <div className="flex items-center gap-1">
              <Plus className="w-4 h-4 text-[#e68a2e]" />
              <span className="text-sm font-bold text-white group-hover:text-[#e68a2e]">
                Özel Oyun
              </span>
            </div>
            <span className="text-[11px] text-[#aaa]">Özel Süre & Lobi</span>
          </button>
        </div>
      </div>

      {/* 5. ODA KODUYLA KATIL VE AÇIK LOBİ LİSTESİ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Oda Koduyla Katılma Kutusu */}
        <div className="bg-[#262421] border border-[#3c3934] rounded-lg p-4 sm:p-5 shadow-lg flex flex-col justify-between">
          <div>
            <h4 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
              <Swords className="w-4 h-4 text-[#629924]" /> Arkadaşınla Oyna
            </h4>
            <p className="text-xs text-[#888] mb-3">
              Arkadaşının sana gönderdiği 6 haneli maç kodunu yazarak hemen oyuna bağlan:
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Örn: 8X3K2M"
                value={codeInputValue}
                onChange={(e) => setCodeInputValue(e.target.value.toUpperCase())}
                maxLength={6}
                className="w-full bg-[#1e1c18] border border-[#3c3934] focus:border-[#629924] text-white px-3 py-2 rounded text-center tracking-widest font-mono font-bold text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  if (codeInputValue.trim().length >= 4) {
                    onJoinByCode(codeInputValue.trim());
                  }
                }}
                disabled={codeInputValue.trim().length < 4}
                className="bg-[#629924] hover:bg-[#53821e] disabled:opacity-40 text-white px-4 py-2 rounded font-bold text-xs shrink-0 cursor-pointer transition-colors"
              >
                Katıl
              </button>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#3c3934] text-[11px] text-[#888]">
            Veya yukarıdaki "Özel Oyun" butonuna tıklayarak kendi maç odanızı kurun ve kodu arkadaşınıza gönderin.
          </div>
        </div>

        {/* Aktif Açık Meydan Okumalar / Lobi Tablosu */}
        <div className="md:col-span-2 bg-[#262421] border border-[#3c3934] rounded-lg p-4 sm:p-5 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Globe className="w-4 h-4 text-[#3692e7]" /> Açık Meydan Okumalar
            </h4>
            <span className="text-xs text-[#888]">
              {lobbyState?.openChallenges?.length || 0} açık meydan okuma
            </span>
          </div>

          {lobbyState?.openChallenges?.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#777] border border-dashed border-[#3c3934] rounded">
              Şu anda açık bekleyen meydan okuma yok. Yukarıdaki hızlı butonlardan birine tıklayarak hemen maç başlatabilirsiniz!
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {lobbyState.openChallenges.map((c) => (
                <div
                  key={c.id}
                  className="bg-[#1e1c18] border border-[#3c3934] hover:border-[#3692e7] p-2.5 rounded flex items-center justify-between gap-3 text-xs transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 font-bold text-white">
                      {getCategoryIcon(c.category)}
                      <span>
                        {c.timeMinutes}+{c.incSeconds}
                      </span>
                    </div>
                    <div className="text-[#bbb]">
                      <span className="font-semibold text-white">{c.creatorName}</span>
                      <span className="text-[#888] ml-1">({c.creatorRating})</span>
                    </div>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        c.rated
                          ? 'bg-amber-950/60 text-amber-400 border border-amber-800/40'
                          : 'bg-neutral-800 text-[#999]'
                      }`}
                    >
                      {c.rated ? 'Puanlı' : 'Puansız'}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => onJoinChallenge(c.id)}
                    className="bg-[#3692e7] hover:bg-[#2878c2] text-white px-3 py-1 rounded font-bold cursor-pointer transition-colors"
                  >
                    Maça Gir
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 6. ÖZEL MAÇ OLUŞTURMA MODALI */}
      {showCustomModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-[#262421] border border-[#3c3934] rounded-lg max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#3c3934] pb-3">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#e68a2e]" /> Özel Meydan Okuma Oluştur
              </h3>
              <button
                type="button"
                onClick={() => setShowCustomModal(false)}
                className="text-[#888] hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[#aaa] font-semibold block mb-1">
                  Süre (Dakika): <strong className="text-white">{customMinutes} dk</strong>
                </label>
                <input
                  type="range"
                  min="1"
                  max="60"
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(parseInt(e.target.value, 10))}
                  className="w-full accent-[#3692e7]"
                />
              </div>

              <div>
                <label className="text-[#aaa] font-semibold block mb-1">
                  Hamle Başı Artış (Saniye): <strong className="text-white">{customInc} sn</strong>
                </label>
                <input
                  type="range"
                  min="0"
                  max="30"
                  value={customInc}
                  onChange={(e) => setCustomInc(parseInt(e.target.value, 10))}
                  className="w-full accent-[#3692e7]"
                />
              </div>

              <div>
                <label className="text-[#aaa] font-semibold block mb-1">Renk Seçimi:</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setCustomColor('w')}
                    className={`p-2 rounded border text-center font-bold transition-colors ${
                      customColor === 'w'
                        ? 'bg-neutral-200 text-black border-white'
                        : 'bg-[#1b1917] text-[#aaa] border-[#3c3934]'
                    }`}
                  >
                    ⚪ Beyaz
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomColor('random')}
                    className={`p-2 rounded border text-center font-bold transition-colors ${
                      customColor === 'random'
                        ? 'bg-[#3692e7] text-white border-[#3692e7]'
                        : 'bg-[#1b1917] text-[#aaa] border-[#3c3934]'
                    }`}
                  >
                    🎲 Rastgele
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomColor('b')}
                    className={`p-2 rounded border text-center font-bold transition-colors ${
                      customColor === 'b'
                        ? 'bg-black text-white border-neutral-600'
                        : 'bg-[#1b1917] text-[#aaa] border-[#3c3934]'
                    }`}
                  >
                    ⚫ Siyah
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-[#aaa] font-semibold">Puanlı Maç (Rated):</span>
                <input
                  type="checkbox"
                  checked={isRated}
                  onChange={(e) => setIsRated(e.target.checked)}
                  className="w-4 h-4 accent-[#e68a2e]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#3c3934]">
              <button
                type="button"
                onClick={() => setShowCustomModal(false)}
                className="px-4 py-2 rounded text-xs text-[#888] hover:text-white font-semibold"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => {
                  onCreateChallenge({
                    timeMinutes: customMinutes,
                    incSeconds: customInc,
                    rated: isRated,
                    color: customColor,
                  });
                  setShowCustomModal(false);
                }}
                className="bg-[#629924] hover:bg-[#53821e] text-white px-5 py-2 rounded text-xs font-bold transition-colors cursor-pointer"
              >
                Odayı Aç
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
