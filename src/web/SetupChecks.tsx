import { useEffect, useRef, useState } from 'react';
import { Activity, CheckCircle2, Download, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { SetupCheck, SetupReason, SetupReport } from '../core/setup.js';
import { api, code, explain, type Language } from './api.js';

const titles: Record<SetupCheck['id'], [string, string]> = {
  node: ['Node.js sürümü', 'Node.js version'],
  worker: ['Yerel çalışan', 'Local worker'],
  models: ['Model dosyaları', 'Model files'],
  integrity: ['Model bütünlüğü', 'Model integrity'],
  discord: ['Discord ayarları', 'Discord settings'],
  connection: ['Bot bağlantısı', 'Bot connection'],
  remote: ['Uzak katılımcılar', 'Remote participants'],
  oauth: ['Discord ile giriş', 'Discord sign-in'],
  live: ['Gerçek ses testi', 'Live voice test'],
};
const descriptions: Record<SetupReason, [string, string]> = {
  'node-supported': [
    'Node.js 24.17+ (24.x) koşulu karşılanıyor.',
    'Node.js meets the 24.17+ (24.x) requirement.',
  ],
  'node-unsupported': [
    'Node.js 24.17 veya daha yeni bir 24.x sürümü kur; uygulamayı yeniden başlat.',
    'Install Node.js 24.17 or a newer 24.x release, then restart the app.',
  ],
  'python-missing': [
    'Projenin Python ortamı bulunamadı. Python 3.12 ile npm run setup çalıştır; uygulamayı yeniden başlat.',
    'The project Python environment was not found. With Python 3.12, run npm run setup, then restart the app.',
  ],
  'worker-stopped': [
    'Yerel çalışan durmuş. Kurulumu kontrol edip uygulamayı yeniden başlat; ardından yeniden denetle.',
    'The local worker has stopped. Check setup, restart the app, then run these checks again.',
  ],
  'worker-unavailable': [
    'Yerel çalışan yanıt vermiyor. Başlangıç tamamlanınca yeniden denetle; sürerse kurulum yönergesini izle.',
    'The local worker is not responding. Check again after startup; if this persists, follow the setup guide.',
  ],
  'worker-responding': [
    'Kimliği doğrulanan yerel durum uç noktası yanıt verdi. Çeviri çalıştırılmadı.',
    'The authenticated local health endpoint responded. No translation was run.',
  ],
  custom: [
    'Özel bir çeviri adaptörü kullanılıyor. Standart Python kurulumu bu adaptörle doğrulanamaz.',
    'A custom inference adapter is in use. It cannot verify the standard Python installation.',
  ],
  'models-present': [
    'Çalışan, beklenen dosyaları buldu. Dosya bütünlüğü ve çeviri kalitesi ayrıca denetlenir.',
    'The worker found the expected files. Integrity and translation quality need separate checks.',
  ],
  'models-missing': [
    'Model dosyaları eksik görünüyor. npm run setup çalıştırıp uygulamayı yeniden başlat.',
    'Model files appear to be missing. Run npm run setup, then restart the app.',
  ],
  'models-unchecked': [
    'Önce yerel çalışan sorununu çöz; sonra model dosyalarını yeniden denetle.',
    'Resolve the local worker issue, then check the model files again.',
  ],
  'integrity-unchecked': [
    'Tam SHA-256 denetimi için npm run models -- --verify-only çalıştır. Bu ekran büyük dosyaları taramaz.',
    'For a full SHA-256 check, run npm run models -- --verify-only. This screen does not scan large files.',
  ],
  'discord-configured': [
    'Gerekli ayarlar kayıtlı. Anahtarların Discord tarafından kabul edildiği bu adımda sınanmadı.',
    'Required settings are saved. This check did not test whether Discord accepts the credentials.',
  ],
  'discord-unconfigured': [
    'Aşağıdaki Discord bölümünde uygulama, bot, OAuth ve izin verilen sunucu ayarlarını tamamla.',
    'Complete the application, bot, OAuth and allowed-server settings in the Discord section below.',
  ],
  'discord-connected': [
    'Bot şu anda Gateway bağlantısını hazır bildiriyor. Oda izinleri ayrıca sınanmalı.',
    'The bot currently reports a ready Gateway connection. Room permissions need a separate test.',
  ],
  'discord-disconnected': [
    'Hazır olduğunda aşağıdaki bağlantı düğmesini kullan. Bu kontrol botu bağlamaz.',
    'When ready, use the connection button below. These checks do not connect the bot.',
  ],
  'https-configured': [
    'Panel adresi HTTPS olarak ayarlı. Başka bir cihazdan erişim ve sertifika ayrıca kontrol edilmeli.',
    'The panel URL is configured for HTTPS. Reachability and certificates still need checking from another device.',
  ],
  'loopback-only': [
    'Panel adresi bu cihazın yerel adresi. Uzak katılımcılar için kurulum rehberindeki HTTPS adımlarını izle.',
    'The panel URL is local to this device. For remote participants, follow the HTTPS steps in the setup guide.',
  ],
  'oauth-unchecked': [
    'Gösterilen OAuth dönüş adresini Developer Portal ile karşılaştır; Discord ile normal giriş yaparak dene.',
    'Compare the displayed OAuth callback with Developer Portal, then test the normal Discord sign-in flow.',
  ],
  'live-unchecked': [
    'İki kişiyle her iki dil yönünü, kişisel sesi, izin iptalini ve odadan ayrılmayı dene. Bu rapor canlı test kanıtı değildir.',
    'With two people, test both directions, personal audio, consent revocation and departure. This report is not live-test evidence.',
  ],
};
const states: Record<SetupCheck['state'], [string, string]> = {
  pass: ['Geçti', 'Passed'],
  blocked: ['İşlem gerekiyor', 'Action needed'],
  manual: ['Elle kontrol', 'Manual check'],
  info: ['Bilgi', 'Info'],
};

export function SetupChecks({
  locale,
  revision,
  disabled,
}: {
  locale: Language;
  revision: unknown;
  disabled: boolean;
}) {
  const index = locale === 'tr' ? 0 : 1;
  const t = (tr: string, en: string) => (index === 0 ? tr : en);
  const [report, setReport] = useState<SetupReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    setReport(null);
    setBusy(false);
    setError('');
    return () => {
      epoch.current++;
    };
  }, [revision, disabled]);
  async function refresh() {
    const current = ++epoch.current;
    setBusy(true);
    setReport(null);
    setError('');
    try {
      const result = await api<SetupReport>('/api/operator/setup-checks');
      if (epoch.current === current) setReport(result);
    } catch (e) {
      if (epoch.current === current) setError(code(e));
    } finally {
      if (epoch.current === current) setBusy(false);
    }
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'voicebridge-setup-report.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section
      className="settings-section"
      aria-busy={busy}
      aria-label={t('Kurulum kontrolü', 'Setup check')}
    >
      <h3>
        <Activity size={18} aria-hidden="true" />
        {t('Kurulum kontrolü', 'Setup check')}
      </h3>
      <p className="muted small">
        {t(
          'Eksikleri ve sonraki adımları gör. Bu kontrol Discord bağlantısı, indirme veya ücretli işlem başlatmaz.',
          'See missing steps and what to do next. These checks do not connect Discord, download models or trigger paid processing.',
        )}
      </p>
      <div className="button-row">
        <button
          type="button"
          className="button secondary"
          disabled={disabled || busy}
          onClick={() => void refresh()}
        >
          {busy && <LoaderCircle size={15} className="spin" aria-hidden="true" />}
          {busy ? t('Kontrol ediliyor…', 'Checking…') : t('Kurulumu denetle', 'Run setup checks')}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={disabled || busy || !report}
          onClick={download}
        >
          <Download size={15} aria-hidden="true" />
          {t('Destek raporunu indir', 'Download support report')}
        </button>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {explain(error, locale)}
        </p>
      )}
      <div aria-live="polite">
        {report && (
          <>
            <p className="small setup-summary">
              {t('Son kontrol', 'Last check')}:{' '}
              {new Date(report.collectedAt).toLocaleTimeString(locale)} ·{' '}
              {report.checks.filter((c) => c.state === 'pass').length} {t('geçti', 'passed')} ·{' '}
              {report.checks.filter((c) => c.state === 'blocked').length}{' '}
              {t('işlem gerekiyor', 'need attention')}
            </p>
            <ul className="setup-check-list">
              {report.checks.map((check) => (
                <li key={check.id}>
                  <strong>{titles[check.id][index]}</strong>
                  <span className="setup-check-state" data-state={check.state}>
                    {check.state === 'pass' ? (
                      <CheckCircle2 size={13} aria-hidden="true" />
                    ) : check.state === 'blocked' ? (
                      <TriangleAlert size={13} aria-hidden="true" />
                    ) : (
                      <Info size={13} aria-hidden="true" />
                    )}
                    {states[check.state][index]}
                  </span>
                  <p className="muted small">{descriptions[check.reason][index]}</p>
                </li>
              ))}
            </ul>
            <p className="muted small">
              {t(
                'Rapor yalnızca sürüm, kontrol zamanı, işletim sistemi/mimari ve sabit kontrol sonuçlarını içerir. Konuşma, anahtar, özel ID veya klasör yolu içermez. Paylaşmadan önce JSON dosyasını incele; dosya otomatik gönderilmez.',
                'The report includes only versions, check time, OS/architecture and fixed check results. It contains no speech, keys, private IDs or file paths. Review the JSON before sharing; it is never sent automatically.',
              )}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
