# Setup and operation

1. Install Node.js 24.17+ / 24.x and Python 3.12. Run `npm ci --ignore-scripts`, `npm run setup`, `npm start` in the project.
2. If Python discovery fails, set `VOICEBRIDGE_BASE_PYTHON` to Python 3.12 before setup. `VOICEBRIDGE_PYTHON` overrides the inference interpreter.
3. Open `.voicebridge/operator-link`. Restarting replaces the one-use link; sessions last at most 12 hours, with one idle hour.
4. Create a dedicated application in the [Discord portal](https://discord.com/developers/applications). Register the exact OAuth2 callback displayed by setup (`http://127.0.0.1:4347/auth/callback` locally). Enter app ID, bot token, client secret and allowed guild IDs through setup. Privileged member/message-content intents and Administrator permission are not required.
5. Use the setup invite link: `bot applications.commands`, View Channel and Connect. Ensure the channel grants those permissions.
6. **Final live step:** explicitly connect, join a normal voice channel, run `/voicebridge start`, sign into the panel with Discord and enable your own consent. The operator session is for configuration, not a voice identity: sign out or use another profile for Discord login.

Never put secrets in issue reports, screenshots, commands or chat. Use the authorized settings form.

## Remote listeners

Copy `.env.example` to `.env`. Set an HTTPS public **origin** (no trailing slash/path) and keep the app behind your TLS reverse proxy:

```dotenv
PORT=4347
PUBLIC_URL=https://voice.example.org
LISTEN_HOST=127.0.0.1
VOICEBRIDGE_WORKER_PORT=4351
```

Preserve public Host, disable buffering for `/api/rooms/*/events`, keep streaming connections open, and never expose the Python worker port. Set Discord's callback to that origin plus `/auth/callback`. Other computers cannot use your loopback URL. Domain/hosting/TLS are operator responsibilities, not a bundled free live service.

## Cloud

An operator or Manage Server member configures a key and reviews current price estimates. Set all four caps positive before enabling cloud. Verify model access first; real provider compatibility remains untested. Price review expires after 90 days; time boundaries use UTC. Shared operations are charged once to the first requesting listener in the group, not duplicated per listener.

Changing/removing a key invalidates listener generations. Removing disables cloud. If the host is compromised, revoke at the provider too. Unknown reservations cannot safely be refunded automatically. App limits are estimates, not provider invoices.

## Maintenance

For incorrect English captions, set **Your spoken language → English** independently of the listening/translation language. Build the updated source with `npm run build` and restart the application; its Python worker is restarted with it. Improved English decoding/pauses use the existing free local model, with potentially longer end-of-utterance latency. Incorrect original recognition propagates into translation. Human accents and microphones still require a live check; see the synthetic regression's scope in [validation](VALIDATION.md).

- Missing models: `npm run models`. Integrity: `npm run models -- --verify-only`. Retain pinned archives for offline reconstruction.
- Ports: app 4347, demo 4348, worker 4351. Set PORT, PUBLIC_URL and worker port consistently if changed. Demo uses its own `.env.demo` and data directory.
- No captions: check panel connection, speaker consent, spoken language and model status. Silent/short, overfull or detected incomplete segments are skipped.
- No speech: enable audio by clicking once and check volume. Queued speech is bounded; old clips may be skipped.
- Bot cannot join: check View Channel/Connect and command-user Manage Server; Stage channels are excluded.
- Slow CPU: warm up, reduce overlapping speakers/target languages. No capacity SLA.
- Stop with Ctrl+C. Bot reconnect requires the explicit connect action after restart. Do not delete a live process lock.
- Back up database/master key together privately while stopped. Keep runtime data out of shared/synced folders and source packages. Without the key encrypted settings cannot be recovered.

## Final live acceptance

Use a dedicated private guild with at least two human participants. Verify DAVE, speaker identity, two languages, separate local/cloud consent, revoke mid-utterance, channel moves, server-deafen, role changes, disconnect, OAuth rejection and stale audio. Only then test a **separately approved small paid budget**, including exhaustion and timeout. Record observed outcomes; synthetic fixtures do not satisfy this gate.

## OAuth input mistakes

The numeric application ID, bot token and OAuth client secret are different values. Retrieve the secret in Developer Portal → OAuth2; if it must be regenerated, the operator performs that credential change. Enter it only in the local client-secret field. Blank secret/token inputs preserve saved values; replacing only the OAuth secret does not require reconnecting the bot. The configured callback must match the displayed URL exactly. A rejected secret or expired code now returns an actionable panel message rather than exposing the callback query in a raw error page.
