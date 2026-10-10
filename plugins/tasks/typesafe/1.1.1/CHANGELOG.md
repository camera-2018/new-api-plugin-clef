---
changelogVersion: 1
plugin: "typesafe"
version: "1.1.1"
locale: "en"
translations:
  zh-CN: CHANGELOG.zh-CN.md
---
# Changelog

## [1.1.1]

### Added

- Community adaptation of QuantumNous TypeSafe 1.1.0, not an official upstream release.
- Keep the native Jev System One protocol and all three question types.
- Reserve zero submission input tokens; wallet charges use validated completion usage only.
- Reject HTML, wrong model identities, malformed answers and missing input usage before marking success.
- Support direct `/v1/systemone` vendors and plugin-enabled `/typesafe/v1/systemone` gateways separately.
- Preserve JSON member order and do not retain synchronous response bodies.
