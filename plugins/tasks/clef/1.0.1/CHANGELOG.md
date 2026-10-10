---
changelogVersion: 1
plugin: "clef"
version: "1.0.1"
locale: "en"
translations:
  zh-CN: CHANGELOG.zh-CN.md
---
# Changelog

## [1.0.1]

### Added

- Synchronous requests start with a zero submission reservation and charge validated actual input tokens after inference returns.
- Remove deployment-specific reservation constants; changing server context no longer requires a custom plugin build.
- Preserve strict completion usage validation: missing or malformed usage fails the request instead of becoming a zero-cost success.
- New API wallet billing supports no deduction before inference. Subscription billing can still reserve the host's minimum quota.
