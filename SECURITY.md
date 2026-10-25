# Security and privacy

Use a dedicated bot/application and private test guild for the alpha. A bounded one-user local Discord/DAVE/OAuth test has been performed; multi-user access scenarios and billable provider behavior remain unvalidated.

- Guild and current voice membership gate room, SSE and WAV access. Administrative settings recheck Manage Server; local operator access is a separate one-use login.
- Session bearers are hashed in SQLite and sent in HttpOnly/SameSite cookies. Mutation requests require exact Origin and CSRF; Host is restricted. TLS cookies are Secure. OAuth state is one-use and bound to an HttpOnly cookie. Access tokens are discarded after identity lookup.
- API and bot secrets are encrypted with AES-256-GCM, never returned in settings responses. The separate master key is local; this does not protect against a compromised host or a backup containing both files. Protect filesystem permissions and keep runtime data out of shared folders.
- Only opted-in speakers enter decoding/inference. Local/cloud permissions are separate. Source epochs and listener generations reject stale results. Revocation clears pending delivery, not already received provider data or previously heard audio.
- Raw speech is not logged or written to disk. Captions and playable media expire at 90 seconds; caches are bounded and periodically swept. JavaScript/Python garbage collection is not guaranteed secure physical memory erasure.
- Local models use pinned files in offline mode. Internal worker is loopback-only with an ephemeral random bearer. No public upload/inference endpoint, arbitrary provider URL, remote model code, eval, selfbot, voice clone or message-content intent.
- No active web subscriber means no new inference. Backlog and output limits bound CPU/memory use. Automatic paid fallback and blind provider retries are disabled.
- Budget reservations are conservative estimates, not provider-side absolute caps. Timeouts/restarts retain uncertain charges. Monitor provider-side limits and revoke leaked keys there.

Do not publish secrets, raw conversations, runtime databases/master keys or operator links in an issue. Private vulnerability reporting is enabled: use **Report a vulnerability** from the repository's [Security advisories](https://github.com/nexora-studio-tr/voicebridge/security/advisories) page. Do not open a public report containing exploit details or user data.

Türkçe: Anahtarları ve çalışma verisini özel tut. Ham konuşma kaydı tutulmaz; 90 saniyelik akış kalıcı arşiv değildir. İzin iptali önceden iletilmiş veriyi geri alamaz. Tek kullanıcılı yerel Discord testi yapıldı; çok kullanıcılı ve ücretli API doğrulaması tamamlanmadı. Güvenlik bildirimlerinde anahtar veya kullanıcı konuşması paylaşma.

The recorded demo uses a distinct session-cookie name so visiting its localhost port does not replace a real user/operator login.
