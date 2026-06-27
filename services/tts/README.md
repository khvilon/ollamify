# Ollamify legacy TTS service (Silero)

This directory contains the older Silero-based TTS service.
It is not the default TTS path in the current Docker stack.

Current production/local TTS uses:

- service: `services/tts-realtime`
- container: `tts-realtime`
- model: `k2-fsa/OmniVoice`
- gateway route: `/api/tts/*` -> `zeus` -> `tts-realtime:8006`

Keep this service only for legacy experiments or rollback testing.
