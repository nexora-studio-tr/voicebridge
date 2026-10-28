import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setNonce } from 'get-nonce';
import {
  ArrowDown,
  ArrowRight,
  AudioLines,
  Check,
  ChevronRight,
  CircleHelp,
  Headphones,
  Languages,
  LockKeyhole,
  LogOut,
  Play,
  Radio,
  Settings2,
  ShieldCheck,
  SkipForward,
  Square,
  Volume2,
  WifiOff,
} from 'lucide-react';
import {
  api,
  code,
  explain,
  type Caption,
  type Language,
  type RoomState,
  type Session,
} from './api.js';
import { Choice, Modal, Toggle } from './primitives.js';
import { usePlayback } from './audio.js';
import { Settings } from './Settings.js';
import { CaptionTiming } from './CaptionTiming.js';
import './style.css';
import { Launcher } from './Launcher.js';

setNonce(document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.content ?? '');
function App() {
  const [locale, setLocale] = useState<Language>(() =>
      localStorage.getItem('vb-language') === 'en' ? 'en' : 'tr',
    ),
    [session, setSession] = useState<Session | null>(null),
    [room, setRoom] = useState<RoomState | null>(null),
    [captions, setCaptions] = useState<Caption[]>([]),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [online, setOnline] = useState(false),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(false),
    [help, setHelp] = useState(false),
    [demoPlaying, setDemoPlaying] = useState(false);
  const roomId = useRef<string | null>(null),
    end = useRef<HTMLDivElement>(null),
    audio = usePlayback(() => setError('AUDIO_PLAYBACK_FAILED')),
    playback = useRef(audio);
  playback.current = audio;
  const t = (tr: string, en: string) => (locale === 'tr' ? tr : en);
  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem('vb-language', locale);
  }, [locale]);
  async function refresh() {
    const s = await api<Session>('/api/session');
    setSession(s);
    if (!s.identity) return;
    const list = await api<RoomState[]>('/api/rooms');
    const first = list[0];
    if (first) {
      roomId.current = first.id;
      const r = await api<RoomState>(`/api/rooms/${first.id}`);
      setRoom(r);
      setCaptions(r.captions);
    } else {
      roomId.current = null;
      setRoom(null);
      setCaptions([]);
      setStatus('');
    }
  }
  useEffect(() => {
    let active = true;
    async function boot() {
      try {
        const params = new URLSearchParams(location.hash.slice(1)),
          operator = params.get('operator'),
          authError = params.get('auth-error');
        if (operator || authError) history.replaceState(null, '', location.pathname);
        if (operator) {
          await api('/auth/operator', 'POST', { token: operator });
        }
        if (active) await refresh();
        if (operator && active) setSettings(true);
        if (authError && active && /^[A-Z_]{1,80}$/.test(authError)) setError(authError);
      } catch (e) {
        if (active) setError(code(e));
      }
    }
    void boot();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!room?.id) return;
    let active = true;
    const id = room.id,
      events = new EventSource(`/api/rooms/${id}/events`);
    events.onopen = () => {
      setOnline(true);
      setError((current) => (current === 'CONNECTION_FAILED' ? '' : current));
    };
    events.onerror = () => {
      setOnline(false);
      playback.current.reset();
    };
    events.onmessage = (message) => {
      if (!active) return;
      try {
        const event = JSON.parse(message.data);
        if (event.type === 'caption') {
          const c = event.data as Caption;
          setStatus('');
          setCaptions((current) =>
            [...current.filter((x) => x.id !== c.id && x.createdAt > Date.now() - 90_000), c].slice(
              -30,
            ),
          );
          if (c.audioUrl) playback.current.enqueue(c.audioUrl);
        } else if (event.type === 'reset') {
          playback.current.reset();
          setStatus('');
          setCaptions((current) =>
            event.data.speakerId ? current.filter((c) => c.speakerId !== event.data.speakerId) : [],
          );
          if (['membership', 'connection_lost', 'expired', 'stopped'].includes(event.data.reason)) {
            setOnline(false);
            void refresh();
          }
        } else if (event.type === 'error') {
          if (event.data.code !== 'CANCELED') setError(String(event.data.code));
          setStatus('');
        } else if (event.type === 'status') {
          if (event.data.code === 'PROCESSING') setStatus('PROCESSING');
          else if (event.data.code === 'IDLE') setStatus('');
          else setError(String(event.data.code));
        } else if (event.type === 'state')
          void api<RoomState>(`/api/rooms/${id}`)
            .then((r) => active && setRoom(r))
            .catch((e) => active && setError(code(e)));
      } catch {
        setError('STREAM_INVALID');
      }
    };
    const poll = setInterval(() => {
      void api<RoomState>(`/api/rooms/${id}`)
        .then((r) => {
          if (active) {
            setRoom(r);
            setCaptions((current) => current.filter((c) => c.createdAt > Date.now() - 90_000));
          }
        })
        .catch((e) => {
          if (active) {
            setError(code(e));
            setOnline(false);
            playback.current.reset();
          }
        });
    }, 15_000);
    return () => {
      active = false;
      events.close();
      clearInterval(poll);
      setOnline(false);
      playback.current.disarm();
      setStatus('');
    };
  }, [room?.id]);
  useEffect(() => {
    end.current?.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'nearest',
    });
  }, [captions.length]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(code(e));
    } finally {
      setBusy(false);
    }
  }
  async function preferences(p: Partial<RoomState['preferences']>) {
    if (!room) return;
    await act(async () => {
      await api(`/api/rooms/${room.id}/preferences`, 'PUT', { ...room.preferences, ...p });
      playback.current.reset();
      setCaptions([]);
      setRoom(await api(`/api/rooms/${room.id}`));
    });
  }
  const self = room?.participants.find((p) => p.id === session?.identity?.id),
    demo = session?.mode === 'demo';
  async function consent(update: Partial<{ local: boolean; cloud: boolean; language: Language }>) {
    if (!room || !self) return;
    await act(async () => {
      await api(`/api/rooms/${room.id}/consent`, 'PUT', {
        local: self.local,
        cloud: self.cloud,
        language: self.language,
        ...update,
      });
      setRoom(await api(`/api/rooms/${room.id}`));
    });
  }
  const mode = room?.preferences.mode ?? 'local';
  return (
    <div className="studio">
      <a className="skip-link" href="#transcript">
        {t('Konuşmaya geç', 'Skip to conversation')}
      </a>
      <aside className="rail">
        <a className="brand" href="/" aria-label="VoiceBridge">
          <span className="brand-mark">
            <AudioLines size={24} />
          </span>
          <span>
            voicebridge<span className="brand-caption">LISTEN BEYOND LANGUAGE</span>
          </span>
        </a>
        <div className="rail-section">
          <div className="eyebrow">{t('DİNLEME ODASI', 'LISTENING ROOM')}</div>
          <div className="room-label">
            <Radio size={17} />
            <span>{room?.guildName ?? t('Henüz bağlı değil', 'Not connected yet')}</span>
          </div>
          <div className="room-path">
            <ChevronRight size={14} />
            {room?.name ?? t('Discord odanı bekliyor', 'Waiting for your Discord room')}
          </div>
          <span className={`connection ${online ? 'connected' : ''}`}>
            <i />
            {demo
              ? t('Örnek oynatımı', 'Sample playback')
              : online
                ? t('Odaya bağlı', 'Connected to room')
                : t('Bağlantı bekleniyor', 'Waiting for connection')}
          </span>
        </div>
        <div className="rail-section">
          <div className="section-heading">
            <span className="eyebrow">{t('KONUŞMACILAR', 'SPEAKERS')}</span>
            <span className="count">{room?.participants.length ?? 0}</span>
          </div>
          <div className="people">
            {room?.participants.map((p, i) => (
              <div className="person" key={p.id}>
                <span className={`avatar color-${i % 3}`}>{p.name.slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>
                    {p.name}
                    {p.id === session?.identity?.id && (
                      <span className="you"> {t('(sen)', '(you)')}</span>
                    )}
                  </strong>
                  <small>
                    {p.language === 'tr' ? 'Türkçe' : 'English'} ·{' '}
                    {p.local
                      ? t('yerel izinli', 'local consent')
                      : t('izin bekleniyor', 'awaiting consent')}
                  </small>
                </div>
                <span
                  className={`consent-dot ${p.local ? 'yes' : ''}`}
                  title={
                    p.cloud
                      ? t('Bulut izni de var', 'Cloud consent also granted')
                      : p.local
                        ? t('Yerel işleme izni', 'Local processing consent')
                        : t('İşlenmez', 'Not processed')
                  }
                >
                  {p.local ? <Check size={12} /> : <LockKeyhole size={10} />}
                </span>
              </div>
            )) ?? (
              <p className="rail-muted small">
                {t('Onay veren konuşmacılar burada görünür.', 'Consenting speakers appear here.')}
              </p>
            )}
          </div>
        </div>
        <div className="rail-footer">
          <div className="privacy-stamp">
            <ShieldCheck size={17} />
            <span>{t('Ses kaydı diske yazılmaz', 'No raw audio recording')}</span>
          </div>
          <p>
            {t(
              'Yalnızca izinli konuşmalar işlenir. Altyazılar ve sesler en fazla 90 saniye bellekte tutulur.',
              'Only consenting speech is processed. Captions and audio stay in memory for up to 90 seconds.',
            )}
          </p>
          <button className="rail-link" onClick={() => setHelp(true)}>
            <CircleHelp size={16} />
            {t('Nasıl çalışır?', 'How does it work?')}
          </button>
          <div className="rail-meta">
            <span>v{session?.version ?? '0.1.0-alpha.2'}</span>
            <span>SELF-HOSTED</span>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            STUDIO <span>/</span>{' '}
            <span>
              {demo
                ? t('Kaydedilmiş demo', 'Recorded demo')
                : t('Kişisel dinleme', 'Personal listening')}
            </span>
          </div>
          <div className="topbar-actions">
            <button
              className="locale-button"
              onClick={() => setLocale(locale === 'tr' ? 'en' : 'tr')}
              aria-label={
                locale === 'tr' ? 'Switch interface to English' : 'Arayüzü Türkçeye çevir'
              }
            >
              <Languages size={15} />
              {locale === 'tr' ? 'EN' : 'TR'}
            </button>
            {session?.identity && !demo && (
              <>
                <button
                  className="icon-button"
                  title={t('Ayarlar', 'Settings')}
                  aria-label={t('Ayarlar', 'Settings')}
                  onClick={() => setSettings(true)}
                >
                  <Settings2 size={19} />
                </button>
                <button
                  className="icon-button"
                  title={t('Çıkış yap', 'Sign out')}
                  aria-label={t('Çıkış yap', 'Sign out')}
                  onClick={() =>
                    void act(async () => {
                      audio.reset();
                      await api('/auth/logout', 'POST', {});
                      location.reload();
                    })
                  }
                >
                  <LogOut size={17} />
                </button>
              </>
            )}
          </div>
        </header>
        <section className="intro">
          <div>
            <div className="eyebrow accent">
              {t('FARKLI DİLLER. AYNI KONUŞMA.', 'DIFFERENT LANGUAGES. ONE CONVERSATION.')}
            </div>
            <h1>
              {t('Senin dilinde,', 'In your language,')}
              <br />
              <em>{t('aynı odada.', 'in the same room.')}</em>
            </h1>
            <p>
              {t(
                'Discord’daki konuşmayı kendi dilinde oku ve dinle.',
                'Read and listen to the Discord conversation in your own language.',
              )}
            </p>
          </div>
          <div className="studio-symbol" aria-hidden="true">
            <span>tr</span>
            <AudioLines />
            <span>en</span>
            <div className="orbit" />
          </div>
        </section>
        {demo && (
          <div className="demo-note">
            <span className="pill">{t('KAYDEDİLMİŞ ÖRNEK', 'RECORDED SAMPLE')}</span>
            <p>
              {t(
                'Yerel modellerle üretilmiş sentetik konuşmalar. Discord’a veya ücretli API’ye bağlanmaz; çeviri hataları olabilir.',
                'Synthetic speech processed by local models. No Discord or paid API connection; translations may contain errors.',
              )}
            </p>
          </div>
        )}
        {error && (
          <div className="notice error page-notice" role="alert">
            <span>{explain(error, locale)}</span>
            <div className="notice-actions">
              {(error === 'BUDGET_EXHAUSTED' || error === 'CLOUD_DISABLED') && mode === 'cloud' && (
                <button onClick={() => void preferences({ mode: 'local' })}>
                  {t('Yerel moda geç', 'Switch to local')}
                </button>
              )}
              <button aria-label={t('Uyarıyı kapat', 'Dismiss alert')} onClick={() => setError('')}>
                ×
              </button>
            </div>
          </div>
        )}
        <div className="studio-body">
          <section className="conversation" id="transcript" tabIndex={-1}>
            <div className="conversation-heading">
              <div>
                <span className="eyebrow">{t('KONUŞMA AKIŞI', 'CONVERSATION')}</span>
                <h2>{t('Birlikte anlaşalım.', 'A shared understanding.')}</h2>
              </div>
              <span className={`engine-chip ${mode === 'cloud' ? 'cloud' : ''}`}>
                <i />
                {mode === 'local'
                  ? t('Yerel motor', 'Local engine')
                  : t('Bulut motoru', 'Cloud engine')}
              </span>
            </div>
            <div
              className="transcript"
              role="log"
              aria-label={t('Çevrilmiş konuşma', 'Translated conversation')}
              aria-live="polite"
              aria-relevant="additions text"
            >
              {!session?.identity ? (
                <div className="empty-state">
                  <div className="empty-glyph">
                    <Headphones size={32} />
                  </div>
                  <h3>{t('Odanla bağlantı kur.', 'Connect with your room.')}</h3>
                  <p>
                    {t(
                      'Discord hesabınla giriş yap. Botun bulunduğu ses odasına katıldıktan sonra kişisel çevirin burada görünür.',
                      'Sign in with Discord. Join the voice room with the bot to see your personal translations here.',
                    )}
                  </p>
                  <a className="button" href="/auth/discord">
                    {t('Discord ile giriş yap', 'Sign in with Discord')}
                    <ArrowRight size={17} />
                  </a>
                  <p className="small muted">
                    {t(
                      'İlk kurulum için sunucudaki özel operator-link dosyasını aç.',
                      'For initial setup, open the private operator-link file on your server.',
                    )}
                  </p>
                </div>
              ) : !room ? (
                <div className="empty-state">
                  <div className="empty-glyph">
                    <Radio size={32} />
                  </div>
                  <h3>{t('Ses odasını bekliyoruz.', 'Waiting for your voice room.')}</h3>
                  <p>
                    {session.identity.operator
                      ? t(
                          'Ayarları açarak özel botunu yapılandır. Canlı test adımında bağlantıyı başlat.',
                          'Open settings to configure your dedicated bot. Connect at the live testing stage.',
                        )
                      : t(
                          'Discord’da botun bulunduğu odaya gir. Yönetici /voicebridge start ile oturumu başlatabilir.',
                          'Join the room with the bot. An administrator can start a session with /voicebridge start.',
                        )}
                  </p>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void act(refresh)}
                  >
                    {t('Odaları yenile', 'Refresh rooms')}
                  </button>
                </div>
              ) : captions.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-glyph wave-glyph">
                    <AudioLines size={38} />
                  </div>
                  <h3>
                    {demo
                      ? t('İki dil. Bir örnek konuşma.', 'Two languages. One sample conversation.')
                      : t('Konuşmaya alan aç.', 'Make room for conversation.')}
                  </h3>
                  <p>
                    {demo
                      ? t(
                          'Örneği başlat; altyazılar bu alana gelir. Sesli dinlemeyi ayrıca açabilirsin.',
                          'Start the sample to see captions here. You can also enable translated audio.',
                        )
                      : t(
                          'İzin veren biri konuştuğunda, cümle parçaları seçtiğin dile çevrilir.',
                          'When a consenting speaker talks, utterances are translated into your selected language.',
                        )}
                  </p>
                  {demo && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api(`/api/rooms/${room.id}/demo`, 'POST', { play: true });
                          setDemoPlaying(true);
                        })
                      }
                    >
                      <Play size={16} />
                      {t('Örneği başlat', 'Start sample')}
                    </button>
                  )}
                </div>
              ) : (
                captions.map((c) => (
                  <article className="caption" key={c.id}>
                    <div className="caption-meta">
                      <strong>{c.speaker}</strong>
                      <span>
                        {c.sourceLanguage === 'tr' ? 'TR' : 'EN'}
                        <ArrowRight size={10} />
                        {c.language === 'tr' ? 'TR' : 'EN'}
                      </span>
                      <time dateTime={new Date(c.createdAt).toISOString()}>
                        {new Date(c.createdAt).toLocaleTimeString(
                          locale === 'tr' ? 'tr-TR' : 'en-GB',
                          { hour: '2-digit', minute: '2-digit' },
                        )}
                      </time>
                      {!demo && <CaptionTiming caption={c} locale={locale} />}
                      {c.fallback && (
                        <span className="fallback">
                          {t('konuşmacının izniyle yerel', 'local · speaker consent')}
                        </span>
                      )}
                    </div>
                    <p className="translation" dir="auto">
                      {c.text}
                    </p>
                    <p className="original" dir="auto">
                      <span>{t('Orijinal', 'Original')}</span>
                      {c.source}
                    </p>
                  </article>
                ))
              )}
              {status === 'PROCESSING' && (
                <div className="processing" role="status">
                  <span className="processing-dots">•••</span>
                  {t('Konuşma işleniyor', 'Processing speech')}
                </div>
              )}
              <div ref={end} />
            </div>
            <div className="transcript-footer">
              <LockKeyhole size={12} />
              {t(
                'Geçici akış · 90 saniye · dışa aktarım yok',
                'Ephemeral feed · 90 seconds · no export',
              )}
              <ArrowDown size={13} />
            </div>
          </section>
          <aside className="controls">
            <div className="control-title">
              <Headphones size={17} />
              <span>{t('Dinleme tercihin', 'Your listening space')}</span>
            </div>
            <Choice
              id="target-language"
              label={t('Duymak istediğin dil', 'Your listening language')}
              value={room?.preferences.language ?? 'tr'}
              onChange={(v) => void preferences({ language: v as Language })}
              disabled={!room || busy}
              items={[
                { value: 'tr', label: 'Türkçe' },
                { value: 'en', label: 'English' },
              ]}
            />
            <Choice
              id="engine-mode"
              label={t('Çeviri motoru', 'Translation engine')}
              value={mode}
              onChange={(v) => void preferences({ mode: v as 'local' | 'cloud' })}
              disabled={!room || busy}
              items={[
                { value: 'local', label: t('Yerel · API ücreti yok', 'Local · no API fee') },
                {
                  value: 'cloud',
                  label: t('Bulut · sunucu bütçesi', 'Cloud · server budget'),
                  disabled: !room?.cloudAvailable || demo,
                },
              ]}
            />
            <p className="small muted mode-description">
              {mode === 'local'
                ? t(
                    'Modeller kurulumu yapan kişinin cihazında çalışır. Donanım ve çeviri kalitesi sonucu etkiler.',
                    'Models run on the operator’s machine. Hardware and model quality affect the result.',
                  )
                : t(
                    'Konuşma sağlayıcıya gönderilir. Sunucu sahibinin anahtarı ve bütçesi kullanılır.',
                    'Speech is sent to the provider, using the server owner’s key and budget.',
                  )}
            </p>
            <div className="audio-card">
              <div className="audio-card-heading">
                <Volume2 size={18} />
                <span>{t('Sesli çeviri', 'Translated audio')}</span>
                {audio.playing && (
                  <span className="live-wave">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
              <button
                className={`button audio-button ${audio.armed ? 'active' : ''}`}
                disabled={!room || busy}
                onClick={() => {
                  const next = !audio.armed;
                  void audio.toggle();
                  void preferences({ audio: next });
                }}
              >
                {audio.armed ? <Square size={14} /> : <Play size={14} />}{' '}
                {audio.armed
                  ? t('Dinlemeyi durdur', 'Stop listening')
                  : t('Sesli dinlemeyi aç', 'Enable audio')}
              </button>
              <label className="volume-label" htmlFor="volume">
                {t('Ses düzeyi', 'Volume')} <span>{audio.volume}%</span>
              </label>
              <input
                id="volume"
                className="volume"
                type="range"
                min="0"
                max="100"
                value={audio.volume}
                onChange={(e) => audio.changeVolume(Number(e.target.value))}
              />
              <div className="audio-bottom">
                <span>
                  {audio.armed
                    ? t('Ses yalnızca sende çalar.', 'Audio plays only for you.')
                    : t('Başlatmak için bir kez dokun.', 'Tap once to enable playback.')}
                </span>
                <button
                  className="icon-button"
                  disabled={!audio.playing}
                  aria-label={t('Bu sesi atla', 'Skip this audio')}
                  onClick={audio.skip}
                >
                  <SkipForward size={16} />
                </button>
              </div>
              {audio.pending > 0 && (
                <p className="small muted">
                  {audio.pending} {t('ses sırada', 'audio clips queued')}
                </p>
              )}
            </div>
            {demo && room && (
              <button
                className="button secondary demo-replay"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api(`/api/rooms/${room.id}/demo`, 'POST', { play: !demoPlaying });
                    setDemoPlaying(!demoPlaying);
                    if (demoPlaying) {
                      audio.reset();
                      setStatus('');
                    }
                  })
                }
              >
                {demoPlaying ? <Square size={13} /> : <Play size={13} />}{' '}
                {demoPlaying ? t('Örneği durdur', 'Stop sample') : t('Örneği oynat', 'Play sample')}
              </button>
            )}
            {!demo && self && (
              <div className="consent-card">
                <div className="control-title">
                  <ShieldCheck size={16} />
                  {t('Kendi konuşman için izin', 'Your speech consent')}
                </div>
                <Choice
                  id="spoken-language"
                  label={t('Konuştuğun dil', 'Your spoken language')}
                  value={self.language}
                  onChange={(v) => void consent({ language: v as Language })}
                  disabled={busy}
                  items={[
                    { value: 'tr', label: 'Türkçe' },
                    { value: 'en', label: 'English' },
                  ]}
                />
                <p className="small muted">
                  {t(
                    'Bu ayar kendi sesinin tanınmasını belirler; dinleme dilinden bağımsızdır.',
                    'This controls recognition of your own speech, independently of your listening language.',
                  )}
                </p>
                <Toggle
                  id="consent-local"
                  checked={self.local}
                  disabled={busy}
                  onChange={(v) => void consent({ local: v, cloud: v && self.cloud })}
                  label={t('Yerel işleme', 'Local processing')}
                  detail={t(
                    'Yalnızca kendi sesin için onay verirsin.',
                    'Consent applies only to your own speech.',
                  )}
                />
                <Toggle
                  id="consent-cloud"
                  checked={self.cloud}
                  disabled={busy || !self.local}
                  onChange={(v) => void consent({ cloud: v })}
                  label={t('Bulut işleme', 'Cloud processing')}
                  detail={t(
                    'Sesin harici sağlayıcıya iletilebilir.',
                    'Your speech may be sent to an external provider.',
                  )}
                />
              </div>
            )}
            <div className="control-footnote">
              <WifiOff size={14} />
              <p>
                {t(
                  'Orijinal Discord sesini istersen Discord’dan kıs. Web paneli mikrofonunu kullanmaz.',
                  'You can lower original voices in Discord. This panel does not use your microphone.',
                )}
              </p>
            </div>
          </aside>
        </div>
        <footer className="page-footer">
          <span>VOICEBRIDGE</span>
          <span>{t('Açık kaynak. Kendi sunucunda.', 'Open source. On your terms.')}</span>
        </footer>
      </main>
      {session && settings && (
        <Settings
          session={session}
          locale={locale}
          guild={room?.guildId}
          open={settings}
          onClose={() => setSettings(false)}
          onRefresh={() => void act(refresh)}
        />
      )}
      <Modal
        open={help}
        onChange={setHelp}
        title={t('Aynı odada, kendi dilinde.', 'Same room, your own language.')}
        description={t(
          'Konuşma parçaları tanınır, çevrilir ve isteğe bağlı seslendirilir.',
          'Utterances are recognized, translated, and optionally spoken.',
        )}
        closeLabel={t('Kapat', 'Close')}
      >
        <ol className="help-steps">
          <li>
            {t(
              'Yönetici botu odada /voicebridge start ile başlatır.',
              'An administrator starts the bot with /voicebridge start.',
            )}
          </li>
          <li>
            {t(
              'Her konuşmacı kendi yerel/bulut işleme iznini verir. İzin yoksa sesi işlenmez.',
              'Each speaker gives local/cloud consent. Speech without consent is not processed.',
            )}
          </li>
          <li>
            {t(
              'Hedef dilini ve motorunu seç. Sesli dinlemeyi bir kez aç.',
              'Choose your target language and engine. Enable audio once.',
            )}
          </li>
          <li>
            {t(
              'İzin iptal edildiğinde yeni işler, bekleyen sesler ve ilgili altyazılar temizlenir. Önceden dinlenmiş ses geri alınamaz.',
              'Revoking consent clears pending jobs, audio, and captions. Previously heard audio cannot be recalled.',
            )}
          </li>
        </ol>
        <p className="notice">
          {t(
            'Makine çevirisi hata yapabilir. Önemli sayı ve kararları orijinal konuşmacıyla doğrula. Sesler sentetik olarak üretilir.',
            'Machine translation can make mistakes. Confirm important numbers and decisions with the original speaker. Speech is synthesized.',
          )}
        </p>
      </Modal>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  location.pathname === '/install' ? <Launcher /> : <App />,
);
