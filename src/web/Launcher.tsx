import { useEffect, useState } from 'react';
import {
  AudioLines,
  ArrowRight,
  Check,
  Download,
  HardDrive,
  Pause,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react';
import { Choice, Modal, Toggle } from './primitives.js';
import type { LauncherStatus, InstallPhase } from '../launcher/contracts.js';
import './launcher.css';

export function Launcher() {
  const [locale, setLocale] = useState(localStorage.getItem('vb-language') === 'en' ? 'en' : 'tr');
  const [status, setStatus] = useState<LauncherStatus | null>(null),
    [error, setError] = useState('');
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [quit, setQuit] = useState(false),
    [closed, setClosed] = useState(false);
  const t = (tr: string, en: string) => (locale === 'tr' ? tr : en);
  const phases: InstallPhase[] = ['package', 'python', 'environment', 'dependencies', 'models'];
  const names: Record<InstallPhase, string> = {
    package: t('Paket bütünlüğü', 'Package integrity'),
    python: t('Python çalışma ortamı', 'Python runtime'),
    environment: t('Özel Python ortamı', 'Private Python environment'),
    dependencies: t('Ses işleme bileşenleri', 'Speech dependencies'),
    models: t('Yerel dil modelleri', 'Local language models'),
  };
  const reasons: Record<string, string> = {
    AUTH_REQUIRED: t(
      'Bu pencereyi VoiceBridge.exe ile yeniden aç.',
      'Reopen this window with VoiceBridge.exe.',
    ),
    DISK_SPACE: t(
      'Yeterli boş alan yok. İlk kurulum için en az 6 GB boş alan gerekiyor.',
      'Not enough space. The first setup needs at least 6 GB free.',
    ),
    PACKAGE_INTEGRITY: t(
      'Paket dosyaları doğrulanamadı. Yayındaki kontrol toplamıyla paketi doğrulayıp yeniden ayıkla.',
      'Package verification failed. Verify the published checksum and extract the package again.',
    ),
    DOWNLOAD_INTEGRITY: t(
      'İndirilen dosyanın kontrol toplamı uyuşmuyor. Yeniden denemede güvenilir kaynaktan indirilecek.',
      'The download checksum did not match. Retry to download it from the pinned source.',
    ),
    INSTALL_PYTHON: t(
      'Python indirilemedi veya açılamadı. Bağlantını ve klasöre yazma iznini kontrol et; sonra devam et.',
      'Python could not be downloaded or extracted. Check connectivity and folder write access, then resume.',
    ),
    INSTALL_ENVIRONMENT: t(
      'Python ortamı hazırlanamadı. Paket klasörünü taşımadıktan ve yazılabilir olduğundan emin olduktan sonra yeniden dene.',
      'The Python environment could not be prepared. Keep the package in its original, writable folder and retry.',
    ),
    INSTALL_DEPENDENCIES: t(
      'Ses bileşenleri kurulamadı. İnternet bağlantını kontrol et ve kuruluma devam et.',
      'Speech dependencies could not be installed. Check your connection and resume setup.',
    ),
    INSTALL_MODELS: t(
      'Dil modelleri tamamlanamadı. Doğrulanmış dosyalar korunur; devam ettiğinde eksikler indirilir.',
      'Language models could not be completed. Verified files are kept; resume to download what is missing.',
    ),
    INSTALL_PACKAGE: t(
      'Paket okunamadı. ZIP dosyasını özel ve yazılabilir bir klasöre tamamen ayıkla.',
      'The package could not be read. Fully extract the ZIP into a private, writable folder.',
    ),
    PORT_IN_USE: t(
      'Panel veya ses motoru bağlantı noktası kullanımda. Çalışan VoiceBridge örneğini kendi penceresinden durdur.',
      'The panel or worker port is occupied. Stop the existing VoiceBridge from its own window.',
    ),
    START_FAILED: t(
      'VoiceBridge başlatılamadı. Kurulumu yeniden kontrol et.',
      'VoiceBridge could not start. Check the setup again.',
    ),
    INVALID_OPTIONS: t(
      'Gelişmiş bağlantı ayarları geçersiz. Kurulum rehberindeki options.json örneğini kontrol et.',
      'Advanced connection settings are invalid. Check the options.json example in the setup guide.',
    ),
  };
  async function request(route: string, body: unknown = {}) {
    const response = await fetch('/api/' + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vb-launcher': '1' },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) throw Error(data.error || 'REQUEST_FAILED');
    return data;
  }
  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem('vb-language', locale);
  }, [locale]);
  useEffect(() => {
    if (closed) return;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch('/api/status');
        if (!response.ok) throw Error('AUTH_REQUIRED');
        const value = (await response.json()) as LauncherStatus;
        if (active) {
          setStatus(value);
          setError('');
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'REQUEST_FAILED');
      }
      if (active) timer = setTimeout(() => void refresh(), 1000);
    }
    async function boot() {
      try {
        const token = new URLSearchParams(location.hash.slice(1)).get('setup');
        if (token) {
          history.replaceState(null, '', location.pathname);
          await request('bootstrap', { token });
        }
        if (active) await refresh();
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'REQUEST_FAILED');
      }
    }
    void boot();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [closed]);
  async function act(route: string, body: unknown = {}) {
    setBusy(true);
    setError('');
    try {
      await request(route, body);
      if (route === 'quit') {
        setClosed(true);
        setQuit(false);
      } else {
        const response = await fetch('/api/status');
        setStatus((await response.json()) as LauncherStatus);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'REQUEST_FAILED');
    } finally {
      setBusy(false);
    }
  }
  const state = status?.state || 'idle',
    step = phases.indexOf(status?.phase || 'package');
  const working = state === 'installing' || state === 'starting';
  const fault = error || status?.error;
  return (
    <div className="launcher">
      <header className="launcher-header">
        <a href="/install" className="launcher-brand">
          <AudioLines aria-hidden="true" />
          <span>
            voicebridge<small>LISTEN BEYOND LANGUAGE</small>
          </span>
        </a>
        <Choice
          id="launcher-language"
          label={t('Arayüz dili', 'Interface language')}
          value={locale}
          onChange={setLocale}
          items={[
            { value: 'tr', label: 'Türkçe' },
            { value: 'en', label: 'English' },
          ]}
        />
      </header>
      <main className="launcher-grid">
        <section className="launcher-intro">
          <p className="eyebrow">WINDOWS · {status?.version || 'alpha.7'}</p>
          <h1>
            {t('Konuşmadan önce,', 'Before the conversation,')}
            <br />
            <em>{t('küçük bir hazırlık.', 'a little preparation.')}</em>
          </h1>
          <p>
            {t(
              'Kendi cihazında çalışan Türkçe ve İngilizce altyazı ile kişisel sesli çeviri. Önce yerel motoru hazırlayalım.',
              'Turkish and English captions, with personal translated speech on your own hardware. First, prepare the local engine.',
            )}
          </p>
          <div className="launcher-facts">
            <p>
              <ShieldCheck aria-hidden="true" />
              {t(
                'Ayrı çalışma ortamı. Sistem Python’u değişmez.',
                'A private runtime. Your system Python stays as it is.',
              )}
            </p>
            <p>
              <HardDrive aria-hidden="true" />
              {t(
                'Yaklaşık 3 GB kurulum; ilk hazırlık için 6 GB boş alan.',
                'About 3 GB installed; allow 6 GB free for initial setup.',
              )}
            </p>
          </div>
          <p className="small muted">
            {t(
              'Yerel modda çeviri API ücreti yoktur. Donanım ve internet gerekir. Discord ayarlarını sonraki adımda sen tamamlayacaksın.',
              'Local mode has no translation API fee. Hardware and internet are required. You will configure Discord in the next step.',
            )}
          </p>
          <a
            className="launcher-doc-link"
            href="https://github.com/nexora-studio-tr/voicebridge/blob/main/docs/WINDOWS.md"
            target="_blank"
            rel="noreferrer"
          >
            {t('Kurulum ve lisans bilgileri', 'Setup and license details')} <ArrowRight size={14} />
          </a>
        </section>
        <section className="launcher-card" aria-label={t('Kurulum', 'Setup')}>
          <div className="launcher-card-heading">
            <span className="eyebrow">{t('YEREL MOTOR', 'LOCAL ENGINE')}</span>
            <span className="launcher-step">{t('HAZIRLIK', 'SETUP')}</span>
          </div>
          <h2>
            {closed
              ? t('Görüşmek üzere.', 'See you soon.')
              : state === 'running'
                ? t('Panelin hazır.', 'Your panel is ready.')
                : state === 'ready'
                  ? t('Konuşmaya hazırsın.', 'Ready for conversation.')
                  : t('Her şey, kendi cihazında.', 'Everything, on your hardware.')}
          </h2>
          {status?.simulation && (
            <p className="launcher-simulation">
              {t(
                'Sentetik arayüz testi; gerçek kurulum yapılmıyor.',
                'Synthetic interface test; no real installation is running.',
              )}
            </p>
          )}
          {!closed && (
            <ol className="launcher-phases">
              {phases.map((phase, index) => (
                <li
                  key={phase}
                  className={
                    state === 'ready' || state === 'running' || index < step
                      ? 'complete '
                      : index === step && working
                        ? 'active '
                        : ''
                  }
                >
                  <span className="launcher-phase-icon">
                    {state === 'ready' || state === 'running' || index < step ? (
                      <Check size={15} />
                    ) : (
                      String(index + 1).padStart(2, '0')
                    )}
                  </span>
                  <span>{names[phase]}</span>
                  {phase === status?.phase && state === 'installing' && (
                    <span className="launcher-current">{t('Hazırlanıyor', 'Preparing')}</span>
                  )}
                </li>
              ))}
            </ol>
          )}
          {state === 'installing' && status?.total && (
            <div className="launcher-transfer" aria-live="polite">
              <p>{status.file}</p>
              <progress value={status.bytes || 0} max={status.total} />
              <small>
                {Math.floor((100 * (status.bytes || 0)) / status.total)}% ·{' '}
                {(Number(status.bytes || 0) / 1024 ** 2).toFixed(1)} /{' '}
                {(status.total / 1024 ** 2).toFixed(1)} MB
              </small>
            </div>
          )}
          {fault && (
            <div role="alert" className="launcher-error">
              <strong>{t('Burada durduk.', 'Setup paused here.')}</strong>
              <p>
                {reasons[fault] ||
                  t(
                    'İşlem tamamlanamadı. Biraz sonra yeniden dene veya kurulum rehberini aç.',
                    'The operation could not finish. Retry shortly or open the setup guide.',
                  )}
              </p>
            </div>
          )}
          {closed ? (
            <p role="status">
              {t(
                'Yerel servisler kapatıldı. Bu sekmeyi kapatabilirsin.',
                'Local services have closed. You can close this tab.',
              )}
            </p>
          ) : (
            <>
              {!working && state !== 'ready' && state !== 'running' && (
                <Toggle
                  id="launcher-consent"
                  checked={consent}
                  onChange={setConsent}
                  label={t(
                    'Kurulum dosyalarını indirmeyi kabul ediyorum',
                    'I agree to download the setup files',
                  )}
                  detail={t(
                    'Python, ses bileşenleri ve lisansları belirtilen yerel modeller indirilir.',
                    'Downloads Python, speech components and the separately licensed local models.',
                  )}
                />
              )}
              <div className="launcher-actions">
                {state === 'running' && status?.operatorUrl ? (
                  <a className="button" href={status.operatorUrl} target="_blank" rel="noreferrer">
                    {t('Discord ayarlarını aç', 'Open Discord settings')} <ArrowRight size={16} />
                  </a>
                ) : state === 'ready' ? (
                  <button className="button" disabled={busy} onClick={() => void act('launch')}>
                    {t('VoiceBridge’i başlat', 'Start VoiceBridge')} <ArrowRight size={16} />
                  </button>
                ) : working ? (
                  <button
                    className="button secondary"
                    disabled={busy || state === 'starting'}
                    onClick={() => void act('pause')}
                  >
                    <Pause size={15} />
                    {state === 'starting' ? t('Başlatılıyor', 'Starting') : t('Duraklat', 'Pause')}
                  </button>
                ) : (
                  <button
                    className="button"
                    disabled={!consent || busy || !status}
                    onClick={() => void act('install', { consent: true })}
                  >
                    <Download size={16} />
                    {state === 'idle'
                      ? t('Kurulumu hazırla', 'Prepare setup')
                      : t('Kontrol et ve devam et', 'Check and resume')}
                  </button>
                )}
                {state === 'running' && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void act('stop')}
                  >
                    <Square size={14} />
                    {t('Durdur', 'Stop')}
                  </button>
                )}
              </div>
              <p className="launcher-footnote" role="status">
                {state === 'paused'
                  ? t(
                      'İndirme durdu. Doğrulanmış dosyalar ve kısmi indirmeler saklandı.',
                      'Download paused. Verified files and partial downloads were kept.',
                    )
                  : state === 'ready' || state === 'running'
                    ? t(
                        'Discord bağlantısı ve konuşmacı izinleri panelden yönetilir.',
                        'Discord connection and speaker consent are managed in the panel.',
                      )
                    : t(
                        'Yarım kalan kurulumda doğrulanmış dosyalar yeniden indirilmez.',
                        'Resuming setup does not download verified files again.',
                      )}
              </p>
            </>
          )}
        </section>
      </main>
      {!closed && (
        <footer className="launcher-footer">
          <span>VOICEBRIDGE · SELF-HOSTED</span>
          <Modal
            open={quit}
            onChange={setQuit}
            title={t('Yerel servisleri kapat', 'Close local services')}
            description={t(
              'Devam eden hazırlık durur. Bu başlatıcının açtığı VoiceBridge ve ses motoru kapanır; dosyaların saklanır.',
              'Preparation pauses. VoiceBridge and its worker started by this launcher close; your files are kept.',
            )}
            closeLabel={t('Vazgeç', 'Cancel')}
            trigger={
              <button className="text-button">
                <X size={14} />
                {t('Başlatıcıyı kapat', 'Close launcher')}
              </button>
            }
          >
            <button className="button" disabled={busy} onClick={() => void act('quit')}>
              {t('Kapat', 'Close')}
            </button>
          </Modal>
        </footer>
      )}
    </div>
  );
}
