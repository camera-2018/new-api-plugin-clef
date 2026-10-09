---
changelogVersion: 1
plugin: "clef"
version: "1.0.0"
locale: "en"
translations:
  zh-CN: CHANGELOG.zh-CN.md
---
# Changelog

## [1.0.0]

### Added

- Use Clef and Clef-flash through `/clef/v1/systemone` for choice, probability and score decisions.
- Connect to Cloudflare Workers AI, self-hosted System One servers, or another New API gateway running this plugin.
- Forward embedded images and preserve the order of structured input fields.
- Bill measured input tokens, with an initial reservation of 4096 tokens for self-hosted servers and 65536 for Workers AI or downstream gateways.
- Reject malformed answers, missing usage and unexpected model identities before reporting a successful task.
