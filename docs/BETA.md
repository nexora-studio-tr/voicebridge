# VoiceBridge alpha.7 beta

[Türkçe](BETA.tr.md) · [Download alpha.7](https://github.com/nexora-studio-tr/voicebridge/releases/tag/v0.1.0-alpha.7) · [Evidence ledger](BETA-STATUS.md) · [Feedback form](https://github.com/nexora-studio-tr/voicebridge/issues/new?template=beta_feedback.yml)

The first milestone is **two independent fresh installations with reviewed reports**. You can help before a second person joins. Two-person live voice acceptance is a separate gate; the broader invitation remains open to 5–10 volunteers. No completed cohort is claimed. No video or paid API use is requested.

## Choose a path

| Your situation                               | Start here                                                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| I want to see the interface and hear samples | [Recorded demo](../README.md#recorded-demo): Node.js 24.17+ / 24.x, no Python or bot. This does not count as a full installation or human voice test. |
| I will run the bot and local models          | [Host a fresh installation](#host-a-fresh-installation) on your computer or server.                                                                   |
| Someone else is hosting                      | [Join as a guest](#join-as-a-guest); no model installation or operator credentials.                                                                   |

## Host a fresh installation

**Windows x64:** use the [portable launcher](WINDOWS.md) from the matching release. It includes Node and prepares private Python/dependencies/models after your download consent. Configure Discord through **Open Discord settings**, then continue at step 3 below. Report the launcher version and setup result; do not install system runtimes just for this package. Use a new private folder, not an existing source installation.

**Source installation (including Linux):** follow steps 1–2, then the same acceptance checks.

1. Download and verify the source ZIP and SHA-256 from the [alpha.7 release](https://github.com/nexora-studio-tr/voicebridge/releases/tag/v0.1.0-alpha.7). Extract into a new folder. Do not copy an existing `.venv`, `node_modules`, runtime database or credentials. Install Node.js **24.17+ / 24.x** and Python **3.12**; allow approximately **3 GB** disk space.
2. Follow [setup](SETUP.md): `npm ci --ignore-scripts`, `npm run setup`, `npm start`. Setup downloads separately licensed local models; Discord still needs internet. Open the one-use `.voicebridge/operator-link` on that computer and configure a dedicated Discord bot. Do not put keys in a terminal command or issue.
3. Run **Settings → Run setup checks**. Note any blocked or unclear step. [The check guide](SETUP-CHECKS.md) separates automatic checks from manual OAuth, model-integrity and live acceptance. A blocked installation report is useful too.
4. When ready for voice, explicitly connect the bot. Join a normal voice channel, run `/voicebridge start`, then sign into the panel with Discord. The operator session configures the app; use another browser profile or sign out for Discord listening. Select spoken **English**, listening **Türkçe**, local processing and your own local consent. Enable personal audio. Test a short phrase, then reverse the languages.
5. Turn your consent off, speak briefly and confirm no new output arrives; leave the room and check that old audio access is no longer valid. Submit the [feedback form](https://github.com/nexora-studio-tr/voicebridge/issues/new?template=beta_feedback.yml), identifying fresh installation separately from any voice tests completed.

For the installation milestone, report the version, OS/browser, Node/Python versions, setup result and any unclear step. A successful full host setup and accessible operator panel may qualify after review even when live voice is deferred; this establishes installation evidence only. Optionally download the allowlisted support report, **review it before attaching**, and opt in if you want the public report linked in the ledger. Nothing is uploaded automatically.

## Join as a guest

Ask the host for the reachable panel address and join the bot's Discord voice room. Sign in with your own Discord account, choose your spoken and listening languages, enable your own **local** processing consent and click to enable personal audio. You do not need Python, models, a bot token or the host's operator link.

A remote guest needs the host's **HTTPS** panel. `127.0.0.1` always refers to the device opening it; sharing that URL will not connect another computer. The host follows [remote setup](SETUP.md#remote-listeners). VoiceBridge does not provide a shared public translation service.

## Check meaning and consent

Use a short, self-authored, non-sensitive phrase. Examples:

- “I didn't say delete the backup. Please keep it until Friday.”
- “We need fifteen minutes, not fifty.”
- “Yarın birlikte çalışabiliriz. Yardımın için teşekkür ederim.”

Compare the **original recognized text** first, then the translated meaning. Report those separately. For delay, inspect [Latency details](CAPTION-TIMING.md) beside a caption; rough listening delay is useful too. Server timings exclude capture, Discord transport and browser playback, and one sample does not establish capacity.

With two distinct humans, use separate panel sessions and each person's own consent. Try both directions, alternating speech, brief overlap, private playback and consent cancellation. Two tabs or synthetic voices do not qualify as two people.

## Feedback and limits

Use the [beta form](https://github.com/nexora-studio-tr/voicebridge/issues/new?template=beta_feedback.yml) for a result or blocker; the speech field is optional for setup-only reports. Omit recordings, private conversations, credentials, operator links, databases, private IDs and personal paths. No video is necessary.

Local mode has no translation API fee; the host provides hardware/electricity. Cloud is optional, owner-funded and disabled by default; no cloud spending is needed here. Automatic source/demo checks and earlier one-user observations are documented in [validation](VALIDATION.md). Independent installations, multi-user quality and the live two-person gate are tracked separately in the [ledger](BETA-STATUS.md). Reports count only after review, with the tester's permission to link them.
