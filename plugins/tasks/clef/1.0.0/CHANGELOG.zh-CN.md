---
changelogVersion: 1
plugin: "clef"
version: "1.0.0"
locale: "zh-CN"
---
# Changelog

## [1.0.0]

### Added

- 通过 `/clef/v1/systemone` 调用 Clef 和 Clef-flash，完成选项选择、概率判断和评分。
- 支持连接 Cloudflare Workers AI、自部署 System One 服务，以及安装了同一插件的 New API 网关。
- 转发内嵌图片，并保留结构化输入的字段顺序。
- 按实际输入 token 结算；自部署服务先预扣 4096 tokens，Workers AI 和下游网关先预扣 65536 tokens。
- 在报告任务成功前，检查答案格式、实际用量和返回的模型身份。
