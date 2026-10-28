import { useEffect, useRef, useState } from 'react';
import { Collapsible } from 'radix-ui';
import { Activity, ChevronDown, Download, LoaderCircle } from 'lucide-react';
import { PerformanceReport } from '../core/performance.js';
import { api, code, explain, type Language } from './api.js';
import { Toggle } from './primitives.js';

export function Performance({ locale }: { locale: Language }) {
  const t = (tr: string, en: string) => (locale === 'tr' ? tr : en);
  const [open, setOpen] = useState(false),
    [live, setLive] = useState(false);
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  const denied = useRef(false);
  useEffect(() => {
    if (!open || denied.current) return;
    const current = ++epoch.current;
    let controller: AbortController | null = null,
      timer: ReturnType<typeof setTimeout> | undefined;
    let terminal = false;
    async function refresh() {
      if (document.hidden || controller || terminal) return;
      const request = new AbortController();
      controller = request;
      setBusy(true);
      try {
        const value = PerformanceReport.parse(
          await api(
            '/api/operator/performance',
            'GET',
            undefined,
            AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
          ),
        );
        if (epoch.current !== current || request.signal.aborted) return;
        setReport(value);
        setError('');
      } catch (e) {
        if (epoch.current !== current || request.signal.aborted) return;
        const reason = code(e);
        setReport(null);
        setError(reason);
        if (['AUTH_REQUIRED', 'OPERATOR_REQUIRED'].includes(reason)) {
          terminal = true;
          denied.current = true;
          setLive(false);
        }
      } finally {
        if (controller === request) controller = null;
        if (epoch.current === current && !request.signal.aborted) {
          setBusy(false);
          if (live && !document.hidden && !terminal) timer = setTimeout(() => void refresh(), 5000);
        }
      }
    }
    function visibility() {
      clearTimeout(timer);
      if (document.hidden) {
        controller?.abort();
        controller = null;
        setBusy(false);
      } else if (live) void refresh();
    }
    document.addEventListener('visibilitychange', visibility);
    void refresh();
    return () => {
      epoch.current++;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [open, live, revision]);
  function download() {
    if (!report || busy) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'voicebridge-performance.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const duration = (value: number | null) =>
    value === null ? '—' : `${value.toLocaleString(locale)} ms`;
  return (
    <Collapsible.Root
      open={open}
      onOpenChange={(v) => {
        denied.current = false;
        setOpen(v);
        if (!v) setLive(false);
      }}
      className="settings-section performance-section"
    >
      <Collapsible.Trigger asChild>
        <button type="button" className="performance-trigger">
          <Activity size={18} aria-hidden="true" />
          <span>{t('Performans', 'Performance')}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <p className="muted small">
          {t(
            'Sunucudaki yükü ve gecikmeyi incele. Bu ekran çeviri başlatmaz; konuşmaları kaydetmez.',
            'Inspect server load and latency. This view does not start translations or record conversations.',
          )}
        </p>
        <div className="button-row">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              denied.current = false;
              setRevision((v) => v + 1);
            }}
          >
            {busy && <LoaderCircle size={15} className="spin" aria-hidden="true" />}
            {t('Ölçümleri yenile', 'Refresh measurements')}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy || !report}
            onClick={download}
          >
            <Download size={15} aria-hidden="true" />
            {t('Performans raporunu indir', 'Download performance report')}
          </button>
        </div>
        <Toggle
          id="performance-live"
          checked={live}
          onChange={(v) => {
            denied.current = false;
            setLive(v);
          }}
          label={t('Canlı izle', 'Watch live')}
          detail={t(
            'Bu bölüm ve sekme açıkken 5 saniyede bir yenilenir.',
            'Refreshes every 5 seconds while this section and tab are visible.',
          )}
        />
        {error && (
          <p className="notice error" role="alert">
            {explain(error, locale)}
          </p>
        )}
        <p className="small muted" role="status">
          {busy
            ? t('Ölçümler alınıyor…', 'Collecting measurements…')
            : report
              ? `${t('Son ölçüm', 'Snapshot')}: ${new Date(report.collectedAt).toLocaleTimeString(locale)}`
              : t('Henüz ölçüm yok.', 'No measurements yet.')}
        </p>
        {report && (
          <div className="performance-report">
            <dl className="performance-load">
              <div>
                <dt>{t('Çalışan iş', 'Running job')}</dt>
                <dd>{report.queue.active} / 1</dd>
              </div>
              <div>
                <dt>{t('Bekleyen iş', 'Waiting jobs')}</dt>
                <dd>
                  {report.queue.waiting} / {report.queue.limit}
                </dd>
              </div>
              <div>
                <dt>{t('Node bellek', 'Node memory')}</dt>
                <dd>{report.nodeMemory.residentMiB} MiB</dd>
              </div>
            </dl>
            <p className="small">
              {report.queue.waiting > 0
                ? t(
                    'İşler sırada. Sesli çeviriyi kapatmak sentez yükünü azaltabilir; ücretli moda otomatik geçilmez.',
                    'Jobs are waiting. Disabling translated speech may reduce synthesis work; paid mode is never selected automatically.',
                  )
                : report.queue.active
                  ? t('Çeviri işleniyor.', 'Translation is processing.')
                  : t(
                      'Şu anda iş yok. Bu durum motorun hazır olduğunu doğrulamaz.',
                      'No job is running. This does not verify that an engine is ready.',
                    )}
            </p>
            <h4>{t('Son 5 dakika', 'Last 5 minutes')}</h4>
            <p className="muted small">
              {t(
                'En fazla 512 sayısal olay. P50 ortanca, P95 örneklerin %95’ini kapsayan süredir. Az örnekle kapasite sonucu çıkarma.',
                'Up to 512 numeric events. P50 is the median; P95 covers 95% of samples. Small samples do not establish capacity.',
              )}
            </p>
            {report.recent.limited && (
              <p className="notice">
                {t(
                  'Örnek sınırına ulaşıldı; yalnızca en yeni olaylar gösteriliyor. Sayılar beş dakikanın tamamını kapsamayabilir.',
                  'The sample limit was reached; only the newest events are shown. Counts may not cover the entire five minutes.',
                )}
              </p>
            )}
            <div className="performance-table-wrap">
              <table className="performance-table">
                <caption>
                  {t(
                    'Sunucu teslim süreleri · kuyruk dahil',
                    'Server delivery times · queue included',
                  )}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('Çıktı', 'Output')}</th>
                    <th scope="col">n</th>
                    <th scope="col">P50</th>
                    <th scope="col">P95</th>
                  </tr>
                </thead>
                <tbody>
                  {report.recent.outputs.flatMap((row) =>
                    (['caption', 'audio'] as const).map((kind) => (
                      <tr key={row.mode + kind}>
                        <th scope="row">
                          {row.mode === 'local' ? t('Yerel', 'Local') : t('Bulut', 'Cloud')} ·{' '}
                          {kind === 'caption' ? t('altyazı', 'caption') : t('ses', 'audio')}
                        </th>
                        <td>{row[kind].count}</td>
                        <td>{duration(row[kind].p50Ms)}</td>
                        <td>{duration(row[kind].p95Ms)}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
            <p className="small">
              {t('Kuyruk bekleme P95', 'Queue wait P95')}:{' '}
              <strong>{duration(report.recent.queueWait.p95Ms)}</strong> · n=
              {report.recent.queueWait.count}
            </p>
            <dl className="performance-outcomes">
              {(['completed', 'failed', 'canceled', 'noOutput'] as const).map((key, i) => (
                <div key={key}>
                  <dt>
                    {
                      [
                        t('Tamamlanan iş', 'Completed jobs'),
                        t('Hatalı iş', 'Failed jobs'),
                        t('İptal edilen iş', 'Canceled jobs'),
                        t('Çıktısız iş', 'Jobs without output'),
                      ][i]
                    }
                  </dt>
                  <dd>{report.recent.jobs[key]}</dd>
                </div>
              ))}
              <div>
                <dt>{t('Kuyruk dolu: reddedilen', 'Queue full: rejected')}</dt>
                <dd>{report.recent.rejected}</dd>
              </div>
            </dl>
            {report.recent.jobs.failed > 0 && (
              <p className="notice">
                {t(
                  'İşlem hatası kaydedildi. Kurulum kontrolüyle çalışan ve modelleri denetle. Bu rapor hata mesajı veya konuşma içermez.',
                  'A processing failure was recorded. Use setup checks to inspect the worker and models. This report contains no error messages or speech.',
                )}
              </p>
            )}
            <p className="muted small">
              {t(
                'Her dil/motor çıktı grubu bir kez sayılır; dinleyici sayısıyla çoğalmaz. Süreler yakalama, ağ ve tarayıcıda çalmayı kapsamaz. Bellek yalnızca Node sürecidir; Python, modeller ve toplam sistem belleği dahil değildir.',
                'Each language/engine output group is counted once, independently of listener count. Timings exclude capture, network and browser playback. Memory covers only the Node process, excluding Python, models and total system memory.',
              )}
            </p>
            <p className="muted small">
              {t(
                'Rapor yalnızca sayısal toplamlar, sürüm, zaman ve işletim sistemi/mimari içerir. Konuşma, anahtar, özel ID veya dosya yolu içermez. İndirdiğin dosyayı inceleyip kendin paylaş; otomatik gönderilmez.',
                'The report contains only numeric aggregates, version, time and OS/architecture. No speech, keys, private IDs or paths. Review and share the downloaded file yourself; it is never uploaded automatically.',
              )}
            </p>
          </div>
        )}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
