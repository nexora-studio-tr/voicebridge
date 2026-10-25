# Primary sources — checked 2026-10-25

- [discord.js voice](https://discord.js.org/docs/packages/voice/stable): DAVE/runtime requirements and receive-stability caveat. Receive is not a documented Discord API.
- [Discord voice](https://github.com/discord/discord-api-docs/blob/main/developers/topics/voice-connections.mdx), [OAuth2](https://discord.com/developers/docs/topics/oauth2).
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [pinned base model](https://huggingface.co/Systran/faster-whisper-base/tree/ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66).
- [Argos](https://github.com/argosopentech/argos-translate), [package index](https://github.com/argosopentech/argospm-index). VoiceBridge uses CTranslate2/SentencePiece directly, not the complete Stanza application.
- [Okur source](https://github.com/ahmethakanbesel/okur-tts/tree/0889eda23a3eaeda33f8c0af3af729261907bcab), [weights](https://huggingface.co/ahakan/okur-tts/tree/0c1ae1a9c5e7bcaa46bdff732bc7182c9ae7bd70): Apache code / CC BY 4.0 weights; corpus attribution retained.
- [Piper](https://github.com/OHF-Voice/piper1-gpl), [English LJSpeech](https://huggingface.co/rhasspy/piper-voices/tree/5512791644e2148e4be301d4c7fc2a4bf51a5057/en/en_US/ljspeech/medium).
- [Turkish voice history](https://huggingface.co/rhasspy/piper-voices/tree/main/tr/tr_TR): withdrawn fahrettin/fettah voices and their generated fixtures are excluded here.
- [OpenAI STT](https://developers.openai.com/api/docs/guides/speech-to-text), [Realtime](https://developers.openai.com/api/docs/guides/realtime-conversations), [gpt-transcribe](https://developers.openai.com/api/docs/models/gpt-transcribe), [gpt-realtime-2.1-mini](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini), [pricing](https://developers.openai.com/api/docs/pricing). Live compatibility remains untested.
