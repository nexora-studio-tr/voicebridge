# VoiceBridge alpha.3 beta

[Türkçe](BETA.tr.md) · [Download](https://github.com/nexora-studio-tr/voicebridge/releases/tag/v0.1.0-alpha.3) · [Send feedback](https://github.com/nexora-studio-tr/voicebridge/issues/new?template=beta_feedback.yml)

We are looking for **5–10 volunteer testers** of a self-hosted Turkish/English Discord translator. This is an invitation, not a claim that a beta cohort has already completed testing. No video is required.

## Pick a test

Start with the operator's **Settings → Run setup checks**. [The setup-check guide](SETUP-CHECKS.md) explains what is automated and what remains manual. You can explicitly download the allowlisted JSON support report, review it, and attach it to your feedback. It never includes speech, credentials, private IDs or file paths and is never uploaded automatically.

| Test | What to check |
| --- | --- |
| Fresh installer | Extract the release into a new folder. Follow [setup](SETUP.md) without copying an existing `.venv`, `node_modules`, runtime database or credentials. Note any unclear step. |
| One speaker | Select your spoken language independently of the listening language. Test Turkish → English and English → Turkish with local processing and personal audio playback. |
| Two people | Use two distinct humans, each with their own panel session and explicit speech consent. Try both directions, then alternate speakers and briefly overlap. Two browser tabs or synthetic voices do not count as two people. |
| Stop and resume | Revoke your own consent, leave the room and reconnect. Check that no new speech is processed while consent is off, and that old audio is unavailable. |

Only the installer needs to host the models and configure a dedicated bot. A remote participant needs the installer's reachable HTTPS panel address; `127.0.0.1` refers to each participant's own computer. See [remote setup](SETUP.md#remote-listeners). This repository does not provide a shared public translation server.

## Short phrases

Use self-authored, non-sensitive speech such as:

- English: “I didn't say delete the backup. Please keep it until Friday.”
- English: “We need fifteen minutes, not fifty.”
- Turkish: “Yarın birlikte çalışabiliriz. Yardımın için teşekkür ederim.”

Compare the **original recognized text** before judging the translation. Approximate subtitle delay, audio delay and rough error counts are useful; precise benchmark claims are not required. If a problem occurs, report the original text and expected meaning with a minimal, non-sensitive example.

## Send feedback

Open the [beta feedback form](https://github.com/nexora-studio-tr/voicebridge/issues/new?template=beta_feedback.yml). Include the version, operating system/browser, test type, number of distinct humans, setup result and important issues. Broad CPU/RAM information is optional. Do not upload recordings, operator links, tokens, database files, private server/user IDs or personal conversations.

The beta uses local mode by default: no translation API fee, with hardware/electricity costs on the host. Cloud is optional, disabled by default and separately funded by the owner. No cloud spending is requested for this beta.

## Current status

Automated source/demo checks and earlier alpha's one-user live recognition observations exist; see [validation](VALIDATION.md). The user explicitly chose to publish the beta invitation while a second human is unavailable. **Independent human installation, two-person live acceptance and a 5–10-person feedback cohort are still pending.** Reports will be recorded only when received. The next improvements will be prioritized from reproducible setup failures, incorrect recognition/meaning and excessive delay.
