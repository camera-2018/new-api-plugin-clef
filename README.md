# Clef for New API

把 Cloudflare 的 **Clef / Clef-flash 决策模型**接入 New API，统一鉴权、渠道管理和用量计费。

它不是聊天插件：输入一段内容和几个问题，返回选项、概率或评分，不生成长篇文字。

```text
你的程序 → New API /clef/v1/systemone → Workers AI 或自部署 Clef
```

这是社区插件，不是 Cloudflare 或 New API 官方出品。

## 能做什么

- `choice`：从几个选项中选一个，例如把工单分给售后还是技术支持。
- `noul`：返回“是”的概率，例如这条消息是否需要人工处理。
- `score`：按你提供的等级评分，例如紧急程度 0～3。
- 同一请求可以一起问这些问题；支持 JSON 状态和内嵌图片。
- 使用 New API 的令牌和定价，不需要把上游密钥发给调用方。

## 安装

需要支持 Task Plugin API v1、`json-order@1` 和同步任务结算的 New API。已在 **v1.0.0-rc.42** 验证；更旧版本请先检查插件能力。

在 New API 的任务插件管理中上传：

**[下载 plugin.js](https://raw.githubusercontent.com/camera-2018/new-api-plugin-clef/main/plugins/tasks/clef/1.0.0/plugin.js)**

启用后，新建“任务插件”渠道（类型 61），绑定 **Cloudflare Clef**。模型填写 `clef`、`clef-flash` 中上游实际提供的模型，不要为了凑列表把没部署的模型也加上。

如果你的版本支持第三方插件源，也可以添加本仓库的索引：

```text
https://raw.githubusercontent.com/camera-2018/new-api-plugin-clef/main/index.json
```

索引由脚本生成，包含源文件 SHA256；安装时仍由 New API 校验插件。

## 渠道怎么填

### Cloudflare Workers AI

```text
Base URL: https://api.cloudflare.com/client/v4/accounts/你的32位AccountID/ai
密钥:     有 Workers AI 调用权限的 Cloudflare API Token
模型:     clef,clef-flash
```

插件按模型名请求 `/ai/run/@cf/cloudflare/clef` 或 `/ai/run/@cf/cloudflare/clef-flash`，并解开 Cloudflare 的 `result` 响应外层。Base URL 也可以以 `/ai/run` 结尾。

### 自部署，例如 llama.cpp

```text
Base URL: http://你的模型服务器:8080
密钥:     模型服务的 API key
模型:     clef-flash
```

上游必须真正实现 `/v1/systemone`，仅有 `/v1/chat/completions` 不够。Base URL 可以包含 `/v1` 或完整 `/v1/systemone`。

建议把模型服务的 alias 设为 `clef` 或 `clef-flash`。插件会核对返回的模型身份，防止请求大模型、实际却跑了 Flash。渠道映射到 `Cloudflare/clef`、`Cloudflare/clef-flash` 或 `@cf/cloudflare/…` 时，会使用对应的短名称调用 System One。

### 上游也是 New API

上游也要安装这个插件。使用“New API”渠道（类型 60），绑定 `clef` 扩展插件，填写上游网关地址和令牌。插件会调用上游的 `/clef/v1/systemone`。

## 调用示例

这里的 key 是 **New API 令牌**，不是 Cloudflare Token。

```bash
export NEW_API_URL='https://你的-new-api'
export NEW_API_KEY='你的-new-api-令牌'

curl "$NEW_API_URL/clef/v1/systemone" \
  -H "Authorization: Bearer $NEW_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "clef-flash",
    "state": "我的订单被重复扣款了，请帮我退款。",
    "questions": {
      "team": {
        "type": "choice",
        "instructions": "应该由哪个部门处理？",
        "criteria": {"billing": "扣款与退款", "technical": "软件与登录问题"}
      },
      "needs_reply": {
        "type": "noul",
        "instructions": "这条消息需要回复吗？"
      },
      "urgency": {
        "type": "score",
        "instructions": "这件事有多紧急？",
        "criteria": ["无需处理", "可以等等", "今天处理", "立即处理"]
      }
    }
  }'
```

结果在 `answers` 里：`team.choice` 是选项，`needs_reply.noul` 是 0～1 的概率，`urgency.score` 是这个例子中 0～3 的加权评分。

`usage.input_tokens` 是实际计费用量。`output_tokens: 0` 对这种决策模型是正常的，不表示调用失败。

## 图片与限制

请求顶层可以加 `images`：

```json
{"images": ["data:image/png;base64,这里放图片的Base64"]}
```

也接受 `{"content_type":"image/png","base64":"…"}`。支持 PNG、JPEG、WebP，最多 4 张，单张解码后不超过 4 MiB，总计不超过 8 MiB；实际格式、像素数和请求大小还受 New API 与上游限制。图片原样转发，插件不访问外部图片 URL。

**自部署服务必须自己支持视觉。** 仅装了文本 GGUF 的实例不会因为装了本插件就获得看图能力。Cloudflare HTTP 图片格式有契约测试，当前本地 Clef-flash 实测覆盖的是文字。

每次支持 1～64 个问题。`choice` 需要 2～255 个选项，`score` 需要 2～10 个等级。省略问题说明时使用问题 ID 作为说明。暂不支持视频、流式回复和聊天接口；这些字段会明确报错，不会静默丢弃。

## 定价与预扣

在 New API 为你启用的每个模型配置“表达式计费”。例如，**假设**你想定为每百万输入 tokens 0.1 美元：

```text
tier("base", u("input_tokens") * 0.1 / 1000000)
```

这只是示例价格，不是 Cloudflare 官方报价。可以分别给 `clef` 和 `clef-flash` 定价；分组倍率仍由 New API 处理。不要把任务表达式里的 `/ 1000000` 去掉，也不要用聊天的 `p`、`c` 变量代替 `u("input_tokens")`。

调用开始时暂时占用额度，完成后按真实输入量结算、多退少补：

| 上游 | 默认预扣依据 |
| --- | --- |
| 自部署 System One | 4096 input tokens |
| Cloudflare Workers AI | 65536 input tokens |
| 另一个 New API 网关 | 65536 input tokens，因为无法知道它后面的部署窗口 |

**预扣不是模型上下文限制，也不是准确的 token 估算。** 自部署默认按 4K 实例配置；如果你部署了更大窗口，发布自己的版本前应修改 `plugin.js` 顶部 `SELF_HOSTED_RESERVE`，与服务器对齐。客户端不能通过请求参数降低预扣。实际返回的 0～65536 input tokens 都会照实结算，不会截成 4096；实际用量超出预扣时，宿主可能需要补扣，额度不足时可能无法交付结果。

上游错误或响应缺少有效答案、模型身份、用量时，插件不报告成功，交给宿主走失败/退款流程。答案不写入 New API 的任务结果库，账单和任务记录仍由宿主保留。上游 5xx 的具体原因可能只显示在管理员日志中。

## 开发与验证

零运行时依赖。插件文件是一个同步 ES 模块，不自行联网、开线程或保存跨请求状态。

```bash
npm test
npm run index
npm run check
```

`index.json` 不要手改。修改发布版本号后，把代码与中英更新说明放进新的版本目录，再生成索引；已经发布的版本目录保持不变。

还应使用实际 New API 宿主验证，而不仅是 Node：

```bash
new-api plugin lint plugins/tasks/clef/1.0.0/plugin.js
```

验证包括 68 项单元测试，以及 New API v1.0.0-rc.42 中的上传、真实 Clef-flash 推理、并发和结算。Workers AI 响应外层、图片透传及异常退款使用模拟上游验证；Cloudflare 云端与 Clef 大模型尚未进行线上实测。

## 来源与许可

基于 [New API 官方 TypeSafe 插件 1.1.0](https://github.com/QuantumNous/new-api-plugins/blob/main/plugins/tasks/typesafe/1.1.0/plugin.js) 改造，沿用 Apache-2.0，归属说明见 [NOTICE](NOTICE)。

协议参考：[Cloudflare Clef-flash](https://developers.cloudflare.com/ai/models/%40cf/cloudflare/clef-flash/)、[Clef](https://huggingface.co/Cloudflare/clef)、[New API 插件协议](https://github.com/QuantumNous/new-api/blob/main/docs/plugin-api/v1.md)。
