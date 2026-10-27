import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, LoaderCircle, Plug, Unplug, ShieldCheck } from 'lucide-react';
import { api, code, explain, type Language, type Session } from './api.js';
import { Modal, Toggle } from './primitives.js';
import { SetupChecks } from './SetupChecks.js';
interface OperatorInfo {
  discord: { applicationId: string; guilds: string[]; hasToken: boolean; hasSecret: boolean };
  redirectUri: string;
  status: { connected: boolean; configured: boolean };
}
interface BudgetInfo {
  daily: number;
  monthly: number;
  uncertain: number;
  policy: { enabled: boolean; daily: number; monthly: number; room: number; user: number };
  provider: {
    hasKey: boolean;
    voice: string;
    prices: {
      asrPerMinute: number;
      inputPerMillion: number;
      outputPerMillion: number;
      ttsPerMillion: number;
      verifiedAt: string;
    };
  } | null;
}
export function Settings({
  session,
  locale,
  guild,
  open,
  onClose,
  onRefresh,
}: {
  session: Session;
  locale: Language;
  guild?: string;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const t = (tr: string, en: string) => (locale === 'tr' ? tr : en);
  const [info, setInfo] = useState<OperatorInfo | null>(null),
    [budget, setBudget] = useState<BudgetInfo | null>(null),
    [selected, setSelected] = useState(guild ?? ''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    if (session.identity?.operator)
      void api<OperatorInfo>('/api/operator')
        .then((v) => {
          if (active) {
            setInfo(v);
            setSelected((current) => current || v.discord.guilds[0] || '');
          }
        })
        .catch((e) => active && setError(code(e)));
    return () => {
      active = false;
    };
  }, [open, session.identity?.operator]);
  useEffect(() => {
    if (!open || !/^\d{17,20}$/.test(selected)) {
      setBudget(null);
      return;
    }
    let active = true;
    void api<BudgetInfo>(`/api/guilds/${selected}/budget`)
      .then((v) => {
        if (active) setBudget(v);
      })
      .catch((e) => {
        if (active) {
          setBudget(null);
          setError(code(e));
        }
      });
    return () => {
      active = false;
    };
  }, [open, selected]);
  async function run(fn: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(message ?? t('Ayar kaydedildi.', 'Settings saved.'));
      onRefresh();
      if (session.identity?.operator) setInfo(await api('/api/operator'));
      if (/^\d{17,20}$/.test(selected)) setBudget(await api(`/api/guilds/${selected}/budget`));
    } catch (e) {
      setError(code(e));
    } finally {
      setBusy(false);
    }
  }
  function saveDiscord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    void run(async () => {
      const applicationId = String(data.get('applicationId') ?? '').trim(),
        guilds = String(data.get('guilds') ?? '').trim(),
        token = String(data.get('token') ?? '').trim(),
        clientSecret = String(data.get('clientSecret') ?? '').trim();
      await api('/api/operator/discord', 'PUT', {
        ...(applicationId ? { applicationId } : {}),
        ...(guilds ? { guilds: guilds.split(/[\s,]+/).filter(Boolean) } : {}),
        ...(token ? { token } : {}),
        ...(clientSecret ? { clientSecret } : {}),
      });
      form.reset();
    });
  }
  function saveBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() =>
      api(`/api/guilds/${selected}/budget`, 'PUT', {
        enabled: data.get('enabled') === 'on',
        ...Object.fromEntries(
          ['daily', 'monthly', 'room', 'user'].map((key) => [
            key,
            Math.round(Number(data.get(key)) * 1_000_000),
          ]),
        ),
      }),
    );
  }
  function saveProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!review) return;
    const form = event.currentTarget,
      data = new FormData(form);
    void run(async () => {
      await api(`/api/guilds/${selected}/provider`, 'PUT', {
        kind: 'openai',
        key: String(data.get('key')).trim(),
        recognition: 'gpt-transcribe',
        translation: 'gpt-realtime-2.1-mini',
        speech: 'gpt-realtime-2.1-mini',
        voice: 'marin',
        prices: {
          asrPerMinute: Math.round(Number(data.get('asr')) * 1_000_000),
          inputPerMillion: Math.round(Number(data.get('input')) * 1_000_000),
          outputPerMillion: Math.round(Number(data.get('output')) * 1_000_000),
          ttsPerMillion: Math.round(Number(data.get('speech')) * 1_000_000),
          verifiedAt: new Date().toISOString(),
        },
      });
      form.reset();
      setReview(false);
    });
  }
  return (
    <Modal
      open={open}
      onChange={(v) => !v && onClose()}
      title={t('Kontrol odası', 'Control room')}
      description={t(
        'Anahtarlar sunucuda şifrelenir; kaydetmek canlı bağlantı başlatmaz.',
        'Keys are encrypted on the server. Saving does not start a live connection.',
      )}
      closeLabel={t('Kapat', 'Close')}
    >
      {error && (
        <div className="notice error" role="alert">
          {explain(error, locale)}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {session.identity?.operator && (
        <SetupChecks locale={locale} revision={info} disabled={busy || !info} />
      )}
      {session.identity?.operator && (
        <section className="settings-section">
          <h3>
            <Plug size={18} />
            {t('Discord bağlantısı', 'Discord connection')}
          </h3>
          {info && (
            <>
              <p className="muted small">
                {t(
                  'Yalnızca VoiceBridge’e özel bot kullan. Ticari bot token’ını girme.',
                  'Use a dedicated VoiceBridge bot. Keep your commercial bot separate.',
                )}
              </p>
              <form onSubmit={saveDiscord} className="form-grid" autoComplete="off">
                <label>
                  {t('Uygulama ID', 'Application ID')}
                  <input
                    name="applicationId"
                    defaultValue={info.discord.applicationId}
                    pattern="[0-9]{17,20}"
                    required
                    disabled={info.status.connected}
                  />
                </label>
                <label>
                  {t('Test sunucusu ID’leri', 'Test server IDs')}
                  <input
                    name="guilds"
                    defaultValue={info.discord.guilds.join(', ')}
                    required
                    disabled={info.status.connected}
                  />
                </label>
                <label>
                  Bot token
                  <input
                    name="token"
                    type="password"
                    minLength={20}
                    maxLength={300}
                    required={!info.discord.hasToken}
                    autoComplete="new-password"
                    disabled={info.status.connected}
                    placeholder={
                      info.discord.hasToken
                        ? t('Kayıtlı · değiştirmek için yeniden gir', 'Saved · re-enter to replace')
                        : ''
                    }
                  />
                </label>
                <label>
                  OAuth client secret
                  <input
                    name="clientSecret"
                    type="password"
                    minLength={15}
                    maxLength={300}
                    required={!info.discord.hasSecret}
                    autoComplete="new-password"
                    disabled={busy}
                    placeholder={
                      info.discord.hasSecret
                        ? t('Kayıtlı · değiştirmek için yeniden gir', 'Saved · re-enter to replace')
                        : ''
                    }
                  />
                </label>
                <button className="button secondary" disabled={busy}>
                  {info.status.connected
                    ? t('OAuth anahtarını kaydet', 'Save OAuth secret')
                    : t('Discord ayarlarını kaydet', 'Save Discord settings')}
                </button>
              </form>
              <p className="small muted">
                {t(
                  'OAuth client secret; uygulama ID’sinden ve bot token’dan farklıdır. Discord Developer Portal → OAuth2 bölümünden alınır.',
                  'The OAuth client secret differs from the application ID and bot token. Find it under Discord Developer Portal → OAuth2.',
                )}
              </p>
              <p className="small muted">OAuth redirect URI</p>
              <code className="code-block">{info.redirectUri}</code>
              {info.discord.applicationId && (
                <a
                  className="text-link small"
                  href={`https://discord.com/oauth2/authorize?client_id=${info.discord.applicationId}&scope=bot%20applications.commands&permissions=1049600`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('Botu seçtiğin sunucuya davet et', 'Invite bot to your server')}{' '}
                  <ExternalLink size={13} />
                </a>
              )}
              <div className="button-row">
                <button
                  className="button"
                  type="button"
                  disabled={busy || !info.status.configured}
                  onClick={() =>
                    void run(() =>
                      api(
                        info.status.connected
                          ? '/api/operator/disconnect'
                          : '/api/operator/connect',
                        'POST',
                        {},
                      ),
                    )
                  }
                >
                  {busy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : info.status.connected ? (
                    <Unplug size={16} />
                  ) : (
                    <Plug size={16} />
                  )}{' '}
                  {info.status.connected
                    ? t('Bağlantıyı kes', 'Disconnect')
                    : t('Discord’a bağlan (canlı)', 'Connect to Discord (live)')}
                </button>
              </div>
              <p className="muted small">
                {t(
                  'Bağlandıktan sonra Discord’da ses odasına gir ve /voicebridge start kullan. Konuşmacılar web panelinden ayrı ayrı onay verir.',
                  'After connecting, join a Discord voice room and use /voicebridge start. Each speaker gives consent in the web panel.',
                )}
              </p>
            </>
          )}
        </section>
      )}
      <section className="settings-section">
        <h3>
          <ShieldCheck size={18} />
          {t('Sunucu bütçesi ve sağlayıcı', 'Server budget & provider')}
        </h3>
        {session.identity?.operator ? (
          <label>
            {t('Sunucu ID', 'Server ID')}
            <input
              value={selected}
              onChange={(e) => {
                const v = e.target.value;
                if (/^\d{0,20}$/.test(v)) setSelected(v);
              }}
              inputMode="numeric"
            />
          </label>
        ) : (
          <p className="muted small">
            {t(
              'Bu alan Sunucuyu Yönet yetkisi gerektirir.',
              'Manage Server permission is required.',
            )}
          </p>
        )}
        {budget && (
          <>
            <div className="budget-summary">
              <span>
                {t('Bugün', 'Today')} <strong>${(budget.daily / 1e6).toFixed(4)}</strong>
              </span>
              <span>
                {t('Bu ay', 'This month')} <strong>${(budget.monthly / 1e6).toFixed(4)}</strong>
              </span>
            </div>
            <p className="small muted">
              {t(
                'Bunlar ihtiyatlı maliyet tahminleridir; sağlayıcı faturası değildir. Kullanıcı limiti günlüktür, oda limiti oturum boyuncadır. Bütün zaman sınırları UTC’dir.',
                'These are conservative estimates, not provider invoices. User limits are daily; room limits cover the session. Time boundaries use UTC.',
              )}
            </p>
            {budget.uncertain > 0 && (
              <p className="notice">
                {t(
                  'Belirsiz işlemler için ayrılan tutar hâlâ bütçeye dahildir.',
                  'Reservations for uncertain requests remain included in the budget.',
                )}
              </p>
            )}
            <form key={JSON.stringify(budget.policy)} onSubmit={saveBudget} className="form-grid">
              <label className="checkbox-label wide">
                <input name="enabled" type="checkbox" defaultChecked={budget.policy.enabled} />
                {t('Bulut işlemeye izin ver', 'Allow cloud processing')}
              </label>
              {(['daily', 'monthly', 'room', 'user'] as const).map((key, i) => (
                <label key={key}>
                  {
                    [
                      t('Günlük ($)', 'Daily ($)'),
                      t('Aylık ($)', 'Monthly ($)'),
                      t('Oda / oturum ($)', 'Room / session ($)'),
                      t('Kullanıcı / gün ($)', 'User / day ($)'),
                    ][i]
                  }
                  <input
                    type="number"
                    name={key}
                    min="0"
                    max={key === 'monthly' ? 10000 : 1000}
                    step="0.000001"
                    required
                    defaultValue={budget.policy[key] / 1e6}
                  />
                </label>
              ))}
              <button className="button secondary" disabled={busy}>
                {t('Bütçeyi kaydet', 'Save budget')}
              </button>
            </form>
            <h4>
              {t('Bulut anahtarı', 'Cloud key')}{' '}
              {budget.provider && (
                <span className="pill">{t('Şifreli kayıt var', 'Encrypted key saved')}</span>
              )}
            </h4>
            <p className="small muted">
              gpt-transcribe · gpt-realtime-2.1-mini · marin.{' '}
              {t(
                'Yeni anahtar kaydetmek dinleyicileri yerel moda döndürür.',
                'Saving a new key resets listeners to local mode.',
              )}
            </p>
            {budget.provider && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void run(() => api(`/api/guilds/${selected}/provider`, 'DELETE', {}))
                }
              >
                {t('Anahtarı kaldır ve bulutu kapat', 'Remove key and disable cloud')}
              </button>
            )}
            <form onSubmit={saveProvider} autoComplete="off" className="form-grid">
              <label className="wide">
                OpenAI API key
                <input
                  type="password"
                  name="key"
                  minLength={15}
                  maxLength={500}
                  required
                  autoComplete="new-password"
                />
              </label>
              {[
                ['asr', t('ASR / dakika ($)', 'ASR / minute ($)'), 0.0045],
                ['input', t('Metin girdi / 1M token ($)', 'Text input / 1M tokens ($)'), 0.6],
                ['output', t('Metin çıktı / 1M token ($)', 'Text output / 1M tokens ($)'), 2.4],
                ['speech', t('Ses çıktı / 1M token ($)', 'Audio output / 1M tokens ($)'), 20],
              ].map(([name, label, value]) => (
                <label key={String(name)}>
                  {label}
                  <input
                    name={String(name)}
                    type="number"
                    min="0.000001"
                    step="0.000001"
                    max="1000"
                    required
                    defaultValue={Number(value)}
                  />
                </label>
              ))}
              <div className="wide">
                <a
                  className="text-link small"
                  href="https://developers.openai.com/api/docs/pricing"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('Sağlayıcı fiyatlarını kontrol et', 'Review provider prices')}{' '}
                  <ExternalLink size={13} />
                </a>
                <Toggle
                  id="price-review"
                  label={t('Fiyatları kontrol ettim', 'I reviewed the prices')}
                  detail={t(
                    'Bu onay 90 gün sonra yenilenmelidir.',
                    'This review must be renewed after 90 days.',
                  )}
                  checked={review}
                  onChange={setReview}
                />
              </div>
              <button className="button secondary" disabled={busy || !review}>
                {t('Anahtarı şifreleyerek kaydet', 'Save encrypted key')}
              </button>
            </form>
          </>
        )}
      </section>
    </Modal>
  );
}
