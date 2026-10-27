import { useState } from 'react';
import { Timer } from 'lucide-react';
import type { Caption, Language } from './api.js';
import { Modal } from './primitives.js';

export function CaptionTiming({ caption, locale }: { caption: Caption; locale: Language }) {
  const [open, setOpen] = useState(false);
  const t = (tr: string, en: string) => (locale === 'tr' ? tr : en);
  const timing = caption.timing;
  if (!timing) return <span>{(caption.latencyMs / 1000).toFixed(1)}s</span>;
  const format = (ms: number) => new Intl.NumberFormat(locale).format(ms) + ' ms';
  return (
    <Modal
      open={open}
      onChange={setOpen}
      title={t('Sunucu işlem süresi', 'Server processing time')}
      description={t(
        'Tam ve geçerli konuşma parçasının sunucu kuyruğuna alınmasından itibaren ölçülür. Ses yakalama, Discord gecikmesi ve tarayıcıda çalma bu ölçüme dahil değil.',
        'Measured after a complete valid segment enters the server queue. Capture, Discord transit and browser playback are not included.',
      )}
      closeLabel={t('Kapat', 'Close')}
      trigger={
        <button
          className="caption-timing-button"
          aria-label={t('Gecikme ayrıntıları', 'Latency details')}
        >
          <Timer size={12} aria-hidden="true" />
          {(caption.latencyMs / 1000).toFixed(1)}s
        </button>
      }
    >
      <dl className="caption-timing-list">
        <div>
          <dt>{t('Kuyrukta bekleme', 'Queue wait')}</dt>
          <dd>{format(timing.queueMs)}</dd>
        </div>
        <div>
          <dt>{t('Ses tanıma', 'Recognition')}</dt>
          <dd>{format(timing.recognitionMs)}</dd>
        </div>
        <div>
          <dt>{t('Çeviri', 'Translation')}</dt>
          <dd>{format(timing.translationMs)}</dd>
        </div>
        <div>
          <dt>{t('Diğer iş ve zamanlama', 'Other work and scheduling')}</dt>
          <dd>{format(timing.captionOverheadMs)}</dd>
        </div>
        <div className="timing-total">
          <dt>{t('Altyazı hazır', 'Caption ready')}</dt>
          <dd>{format(timing.captionMs)}</dd>
        </div>
        {timing.audioMs !== undefined &&
        timing.synthesisMs !== undefined &&
        timing.audioOverheadMs !== undefined ? (
          <>
            <div>
              <dt>{t('Ses üretimi', 'Speech synthesis')}</dt>
              <dd>{format(timing.synthesisMs)}</dd>
            </div>
            <div>
              <dt>{t('Ses hazırlığı', 'Audio preparation')}</dt>
              <dd>{format(timing.audioOverheadMs)}</dd>
            </div>
            <div className="timing-total">
              <dt>{t('Ses hazır · toplam', 'Audio ready · total')}</dt>
              <dd>{format(timing.audioMs)}</dd>
            </div>
          </>
        ) : (
          <div>
            <dt>{t('Ses üretimi', 'Speech synthesis')}</dt>
            <dd>{t('Ölçülmedi', 'Not measured')}</dd>
          </div>
        )}
      </dl>
      <p className="muted small">
        {t(
          'Altyazı, ses üretimi beklenmeden gelir. Ses süresi yalnızca kişisel ses istediğinde ve ses hazır olduğunda gösterilir. Diğer iş, başka dil gruplarının işlem süresini de içerebilir. Bunlar bu parçaya ait ölçümlerdir; kapasite veya genel kalite sonucu değildir.',
          'Captions arrive before synthesis finishes. Audio timing appears only when you requested speech and it is ready. Other work can include earlier language groups. These are this segment’s timings, not a capacity or general quality result.',
        )}
      </p>
    </Modal>
  );
}
