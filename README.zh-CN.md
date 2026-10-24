# pi-whoasked

[English](README.md) | 简体中文

一个 Pi 扩展：用可配置正则检测助手流式回答中的表述，命中后中断，发送对应的校正 prompt，要求模型从头重新回答。

保留被中断的片段，标注作废，然后重新回答。已经显示的文字不会撤回。

## 安装

需要 Pi（`@earendil-works/pi-coding-agent`）1.4.0+ 和 Node.js 22.19+。运行测试推荐 Node.js 24。

在仓库目录中临时加载：

```bash
pi -e ./src/index.ts
```

持久安装：

```bash
pi install /path/to/whoasked
```

## 配置

默认启用两条内置规则：`不能声称` 和 `不将…冒充为`。它们只检查措辞；正常引用这些短语也会命中。请根据自己的使用习惯调整。

配置按以下顺序合并，后者优先：

1. 内置默认值。
2. `<Pi agentDir>/whoasked.json`，通常为 `~/.pi/agent/whoasked.json`。
3. 已获 Pi 项目信任的 `<cwd>/.pi/whoasked.json`。

`enabled` 和 `maxRetries` 覆盖前值；`rules` 数组整体替换前面的规则。`rules: []` 表示不启用任何规则。未获信任的项目配置不会读取。

也可以指定独立配置文件，此时只在内置默认值之上应用该文件，不再读取个人和项目配置：

```bash
pi -e ./src/index.ts --whoasked-config ./whoasked.example.json
```

[whoasked.example.json](whoasked.example.json) 是完整示例。最小自定义配置：

```json
{
  "enabled": true,
  "maxRetries": 2,
  "rules": [
    {
      "name": "无端引入冒充关系",
      "pattern": "不将[^。！？\\n]{1,40}冒充为",
      "flags": "u",
      "correctionPrompt": "请重新回答原问题。删除无端引入的‘冒充’指控或防御性声明，直接陈述事实及相关局限。不要提及本次校正。"
    }
  ]
}
```

配置字段：

- `enabled`：是否启用检测，默认 `true`。
- `maxRetries`：每次用户请求最多自动校正次数，默认 `2`；`0` 只提示命中，不中断。
- `rules[].name`：唯一的非空规则名称。
- `rules[].pattern`：JavaScript 正则源文本，无 `/…/` 分隔符；JSON 中反斜杠需要转义。
- `rules[].flags`：正则 flags，默认 `u`；空字符串表示不加 Unicode flag。
- `rules[].correctionPrompt`：命中后发送给模型的非空校正要求。
- `rules[].enabled`：是否启用这条规则，默认 `true`。

规则按配置顺序检查，同一快照多条命中时采用第一条。`g` 的匹配状态会重置，`y` 保留其粘连匹配语义。可匹配空输入的规则会被拒绝，运行中零宽命中会被跳过。未知字段、无效正则和非法值会报错并关闭检测，修复后执行 `/whoasked reload`。

示例中还包含一条默认关闭的「不是 A 而是 B」规则。这种句式经常有正常用途，开启前建议收窄范围。

## 运行效果

```text
用户：介绍一下这个项目的测试情况。

助手：项目包含单元测试和集成测试。不将已有测试冒充为……
[回答已中断]

whoasked-correction：
[上一条回答已作废；命中「无端引入冒充关系」；自动校正 1/2]
<这条规则配置的校正 prompt>
请从头重新回答原用户问题，复用已有工具结果。

助手：项目包含单元测试和集成测试，覆盖核心函数与主要接口。
目前尚未覆盖并发和故障恢复场景。
```

校正作为 custom message 显示在对话里。原用户问题、已有工具结果和被中断消息的会话记录均保留，不回滚会话树。

## 命令

```text
/whoasked           查看状态、配置来源和启用规则
/whoasked status    同上
/whoasked on        重新读取配置并在当前会话开启检测
/whoasked off       关闭检测并取消待执行校正
/whoasked reload    重新读取配置
/whoasked cancel    取消本次请求的后续校正，下次用户输入恢复检测
```

命令不写回配置文件。会话启动、切换或扩展重载时重新读取配置。

## 流式与停止行为

- 检查当前助手消息的完整累计正文，可以匹配横跨多个流式片段的模式。不同 text block 之间用换行连接。
- 只检查助手 text，不检查 thinking、工具参数、工具结果、用户消息。
- 命中后中断当前生成，等待本轮完全结束，再触发重新回答。
- 若插件已触发中断，你在同一收尾窗口又按 Escape，Pi 的公共事件无法区分这次额外停止。可用 `/whoasked cancel` 或 `/whoasked off` 显式取消后续校正。
- 新输入、已有待处理输入优先于校正。
- 达到 `maxRetries` 后若仍命中，提示达到上限，让本次回答继续显示，不再中断。
- JSON/RPC/print 模式也运行检测和重试。流式消费者仍会收到已输出的片段，需要按消息边界区分旧回答与重答；状态栏和通知是否可见取决于宿主界面。

## 开发

```bash
npm ci --ignore-scripts
npm run check
```

`check` 包含 TypeScript 检查、配置与流式检测单元测试，以及真实 Pi SDK 生命周期测试。SDK 测试使用本地模拟模型流，不调用在线模型，不读取用户凭据。

文件结构：

```text
src/index.ts           Pi 扩展入口
src/config.ts          配置加载与正则校验
src/extension.ts       流式检测、中断和重试生命周期
whoasked.example.json  可编辑的配置示例
tests/                 单元测试与 SDK 集成测试
```
