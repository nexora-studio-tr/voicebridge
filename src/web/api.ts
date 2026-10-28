import type { Caption, Language, Preferences, RoomSnapshot } from '../core/contracts.js';
export type { Caption, Language, Preferences };
export interface Session {
  mode: 'demo' | 'operator';
  version: string;
  identity: { id: string; name: string; operator: boolean } | null;
  csrf: string | null;
  discord: { connected: boolean; configured: boolean; error: string | null };
}
export type RoomState = RoomSnapshot;
let csrf: string | null = null;
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
export async function api<T>(
  url: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    ...(signal ? { signal } : {}),
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      typeof result.error === 'string' ? result.error : 'REQUEST_FAILED',
      response.status,
    );
  if (url === '/api/session') csrf = (result as Session).csrf;
  return result as T;
}
export function code(error: unknown) {
  return error instanceof ApiError ? error.code : 'CONNECTION_FAILED';
}
const messages: Record<string, [string, string]> = {
  ROOM_NOT_FOUND: [
    'Bu oda sona erdi. Discord’da yeni bir VoiceBridge odası başlat.',
    'This room has ended. Start a new VoiceBridge room in Discord.',
  ],
  STREAM_INVALID: [
    'Oda akışı doğrulanamadı. Yeniden bağlantı kuruluyor.',
    'The room stream could not be verified. Reconnecting.',
  ],
  DISCORD_GUILD_ACCESS_REQUIRED: [
    'Bot seçili test sunucusuna erişemiyor. Botu bu sunucuya davet et ve sunucu ID’sini kontrol et.',
    'The bot cannot access the selected test server. Invite it there and verify the server ID.',
  ],
  DISCORD_GUILD_PERMISSION_REQUIRED: [
    'Botun test sunucusundaki izinleri yetersiz. Kanalı Görüntüle ve Bağlan izinlerini kontrol et.',
    'The bot lacks permissions in the test server. Check View Channel and Connect.',
  ],
  DISCORD_GUILD_NOT_FOUND: [
    'Seçili test sunucusu bulunamadı. Sunucu ID’sini kontrol et.',
    'The selected test server was not found. Verify the server ID.',
  ],
  DISCORD_SECRET_IS_APPLICATION_ID: [
    'Bu değer uygulama ID’si. Discord Developer Portal → OAuth2 bölümündeki gerçek client secret değerini kullan.',
    'This is the application ID. Use the actual client secret from Discord Developer Portal → OAuth2.',
  ],
  DISCORD_SECRET_IS_BOT_TOKEN: [
    'Bot token ile OAuth client secret farklıdır. OAuth2 bölümündeki client secret değerini gir.',
    'The bot token and OAuth client secret are different. Enter the client secret from OAuth2.',
  ],
  DISCORD_OAUTH_CLIENT_REJECTED: [
    'Discord, kayıtlı OAuth client secret değerini reddetti. Operatör ayarlarında doğru client secret değerini kaydet; bot token farklı bir değerdir.',
    'Discord rejected the saved OAuth client secret. Update it in operator settings; the bot token is a different value.',
  ],
  DISCORD_OAUTH_CODE_REJECTED: [
    'Discord giriş kodunun süresi doldu veya kod kullanıldı. Discord ile giriş yap düğmesinden yeniden başlat.',
    'The Discord sign-in code expired or was used. Start again with Sign in with Discord.',
  ],
  DISCORD_OAUTH_RATE_LIMIT: [
    'Discord girişleri geçici olarak sınırlandırdı. Biraz sonra yeniden dene.',
    'Discord temporarily rate-limited sign-in. Try again later.',
  ],
  DISCORD_OAUTH_UNAVAILABLE: [
    'Discord giriş servisine ulaşılamadı. Yeni bir giriş denemesi başlat.',
    'Discord sign-in is unavailable. Start a new sign-in attempt.',
  ],
  DISCORD_OAUTH_EXCHANGE_FAILED: [
    'Discord giriş isteği reddedildi. Uygulama ayarlarını kontrol et ve yeniden giriş yap.',
    'Discord rejected the sign-in exchange. Check application settings and sign in again.',
  ],
  DISCORD_OAUTH_IDENTITY_FAILED: [
    'Discord kullanıcı kimliğini doğrulayamadı. Girişi yeniden başlat.',
    'Discord identity lookup failed. Start sign-in again.',
  ],
  OAUTH_STATE_REJECTED: [
    'Giriş oturumu geçersiz veya süresi dolmuş. Discord ile giriş yap düğmesinden yeniden başlat.',
    'The sign-in session is invalid or expired. Start again with Sign in with Discord.',
  ],
  CONNECTION_FAILED: [
    'Sunucuya ulaşılamadı. Bağlantıyı kontrol et.',
    'Could not reach the server. Check your connection.',
  ],
  AUTH_REQUIRED: ['Oturum sona erdi. Yeniden giriş yap.', 'Your session expired. Sign in again.'],
  VOICE_MEMBERSHIP_REQUIRED: [
    'Bu Discord ses odasında bulunmalısın.',
    'You must be in this Discord voice room.',
  ],
  BUDGET_EXHAUSTED: [
    'Bulut bütçesi doldu. Ücretsiz yerel moda geçebilirsin.',
    'Cloud budget reached. You can switch to local mode.',
  ],
  CLOUD_DISABLED: [
    'Sunucu sahibi bulut modunu henüz açmadı.',
    'The server owner has not enabled cloud mode.',
  ],
  INFERENCE_FAILED: [
    'Çeviri işlenemedi. Yerel model durumunu kontrol et.',
    'Translation failed. Check the local model status.',
  ],
  WORKER_UNAVAILABLE: [
    'Yerel ses motoru hazır değil. Kurulumu ve model durumunu kontrol et.',
    'The local engine is unavailable. Check setup and model status.',
  ],
  LOCAL_WORKER_UNAVAILABLE: [
    'Yerel ses motoruna ulaşılamadı. Python kurulumunu kontrol et.',
    'The local engine is unavailable. Check the Python installation.',
  ],
  AUDIO_PLAYBACK_FAILED: [
    'Ses oynatılamadı veya süresi doldu. Sonraki konuşma parçası bekleniyor.',
    'Audio could not play or expired. Waiting for the next utterance.',
  ],
  LOCAL_INFERENCE_FAILED: [
    'Yerel model işlemi başarısız. Model bütünlüğünü kontrol et.',
    'Local inference failed. Verify model integrity.',
  ],
  QUEUE_FULL: [
    'İşleme kuyruğu dolu; bu konuşma parçası atlandı.',
    'Processing queue is full; this utterance was skipped.',
  ],
  AUDIO_GAP: [
    'Ses kesintisi algılandı; eksik parça çevrilmedi.',
    'An audio gap was detected; the incomplete segment was skipped.',
  ],
  LINK_EXPIRED: [
    'Kurulum bağlantısı geçersiz veya kullanılmış. Sunucuyu yeniden başlat.',
    'Setup link expired or was used. Restart the server.',
  ],
  CSRF_REJECTED: [
    'Güvenlik oturumu yenilenmeli. Sayfayı yeniden yükle.',
    'Security session needs refreshing. Reload this page.',
  ],
  PRICE_REVIEW_REQUIRED: [
    'Bulut fiyatları gözden geçirilmeli. Sunucu yöneticisine bildir.',
    'Cloud prices need review. Contact the server owner.',
  ],
  PROVIDER_KEY_REJECTED: [
    'Sağlayıcı anahtarı reddedildi. Yöneticine bildir.',
    'Provider key was rejected. Contact your administrator.',
  ],
  PROVIDER_TIMEOUT: [
    'Sağlayıcı zaman aşımına uğradı. Belirsiz maliyet bütçede tutuldu.',
    'Provider timed out. Uncertain cost remains reserved.',
  ],
  ADMIN_REQUIRED: [
    'Bu ayar için Sunucuyu Yönet yetkisi gerekir.',
    'Manage Server permission is required for this setting.',
  ],
  INVALID_INPUT: [
    'Alanları kontrol et; bazı değerler geçersiz.',
    'Check the fields; some values are invalid.',
  ],
  DISCORD_NOT_CONFIGURED: [
    'Önce yerel kurulum panelinden Discord botunu yapılandır.',
    'Configure the Discord bot in the local setup panel first.',
  ],
  CANCELED: [
    'İşlem izin veya tercih değişikliği nedeniyle durduruldu.',
    'Processing stopped after a consent or preference change.',
  ],
};
export function explain(value: string, locale: Language) {
  return (
    messages[value]?.[locale === 'tr' ? 0 : 1] ??
    (locale === 'tr'
      ? `İşlem tamamlanamadı (${value}).`
      : `Could not complete the operation (${value}).`)
  );
}
