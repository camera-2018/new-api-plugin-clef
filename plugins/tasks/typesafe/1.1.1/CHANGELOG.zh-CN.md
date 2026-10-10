---
changelogVersion: 1
plugin: "typesafe"
version: "1.1.1"
locale: "zh-CN"
translations:
  en: CHANGELOG.md
---
# 更新记录

## [1.1.1]

### Added

- 基于 QuantumNous TypeSafe 1.1.0 的社区适配，不是官方上游发布。
- 保留 Jev System One 原生协议及 choice、noul、score 三种题型。
- 提交时预留输入 token 为零；钱包仅按成功响应的实际输入用量结算。
- 成功前校验模型身份、问题与概率分布、实际用量，拒绝 HTML 和不完整响应。
- 区分直连厂商 `/v1/systemone` 与插件网关 `/typesafe/v1/systemone`。
- 保持 JSON 成员顺序，不保留同步响应正文。
