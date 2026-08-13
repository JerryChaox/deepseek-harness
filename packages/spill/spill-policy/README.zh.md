# @deepseek-ai/dsh-spill-policy

[English](README.md) | 中文

**工具结果 spill 策略**：一个 `tools/post-execute` 转换器，用于防止过大的工具结果进入模型上下文。通用文本会得到有界的首尾预览；由 tools 包显式 `jsonRenderer` 生成的结果则保存为完整合法的 `.json` 文件，并替换为声明式根 schema、locator 与取回指引。

该插件**不注册任何服务**，也不负责存储或预览机制：预览由 [`@deepseek-ai/dsh-output-retention`](../../util/output-retention)（`TextRetainer`）负责，存储由 `ctx.spillStore` 负责。它只决定何时 spill，并组合通知。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `maxInlineBytes` | *（省略）* | 面向模型的纯文本结果上下文上限，以 UTF-8 字节数计（在加载时验证为非负整数）。**省略时完全禁用该策略**（插件不注册任何内容）。设置后，超过该上限的结果会被 spill，并替换为从同一预算派生的预览（首尾拆分）。 |

## 行为

1. 允许工具运行（通过 `next()` 委托，因此可以限制任何下游钩子接受的结果）。
2. 跳过嵌套执行（存在 `exec.parent`——其持久化副本由下方的 dispatch-log 分支设界）、已接受的值替换（注册表必须重新验证并重新渲染它们）、`read`（避免 `read → spill → read again` 循环）以及任何非 `accept` 决策（`block` 的纠正反馈会原样通过）。
3. 仅在已接受的内容为**纯文本**（全部都是 `text` 块）时才将其展平；包含任何非文本块的结果都保持不变。通过 `ctx.tools` 读取执行期局部输出投影；自定义 renderer 没有该投影，仍按通用文本处理。
4. 如果 UTF-8 大小为 `≤ maxInlineBytes`，则保持不变。
5. 否则保存完整文本。通用结果使用 `.txt`，并替换为预览和以下通知。系统会调整大小，使整个替换内容（预览、空行和通知）不超过 `maxInlineBytes`：先从预算中保留通知所需字节，再缩小预览以适配剩余空间，因此面向模型的结果绝不会超过上限：

   ```text
   <retained head/tail preview>

   (Omitted N bytes. Full formatted result stored at: /…/session-…/…-web_fetch.txt. Use read with offset/limit, or grep this path to search within it.)
   ```

   显式 JSON 结果使用 `.json`，且不会返回损坏的首尾预览。其有界通知包含 `Root output schema: ...`；该摘要直接来自已经声明的工具输出 schema，包括根类型、预算内的对象直接字段，或有界 union 摘要。策略不会解析、探测渲染文本，也不会从中推断结构。保存的文件是完整渲染 JSON。

   当通知本身无法放入预算时（上限极小或 locator 很长），策略保留内联结果。它绝不会发出超过上限的替换内容。

**尽力而为**：没有会话所有者、没有 `ctx.spillStore` 后端，或 `saveText` 返回拒绝 ⇒ 策略记录警告并返回原始结果。spill 失败绝不会将成功调用变为 `isError`，也不会隐藏内联结果。成功替换时只会更改 `content`；规范的程序化值保持不变。

**dispatch-log 分支：**注册在 `tools/code-dispatch-log` 上的第二个监听器，把同一套上限、替换流水线与尽力而为的回退应用到每个 `run_code` 子调用结果的持久化副本上（产物标签为 `dispatch`，按子调用 id 归档）。程序的值不受影响，因为它早已完整跨过 worker 边界；`read` 子调用同样设界：日志副本不是模型上下文，因此不会发生 read-again 循环，而 `read` 恰恰是最容易产生巨型日志的工具（[原理](../../../.agents/notes/implemented/feature/2026-07-26-code-dispatch-log-spill.md)）。

## 范围

该策略只能看到最终格式化的面向模型结果。JSON 特化可以把这段文本与本次执行中已验证的规范值和声明式 schema 对应起来，但仍无法恢复提供方更早发生的截断（例如 `web-fetch-http.maxBodyChars`）。提供方／资源上限仍然是必需的，并且与该策略相互独立。`glob`/`grep` 负责项级呈现 spill；bash 流负责获取期 spill。详见 [JSON spill 决策](../../../.agents/notes/implemented/feature/2026-08-14-declarative-json-result-spill.md)与原有的[工具输出 spill 架构](../../../.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md)。

## 模型体验

### 过大的纯文本结果

#### 模型看到的内容

大小不超过 `maxInlineBytes` 的结果、嵌套结果、`read` 结果、被阻止的决策和包含非文本块的结果都保持不变。过大的纯文本呈现结果会变为有界的首尾预览，后面附加 `(Omitted <bytes> bytes. Full formatted result stored at: <locator>. <retrievalHint>)`；存储失败或没有会话所有者时，原始结果仍然可见。

#### Token 影响

成功替换后的内容最多为 `maxInlineBytes` 个 UTF-8 字节，并会保留在历史中直到压缩（compaction）；完整 spill 文本不会重新发送给模型。

#### KV Cache 影响

仅追加；新可见内容位于可重用请求前缀之后，不会使现有 KV Cache 条目失效。

### 过大的声明式 JSON 结果

#### 模型看到的内容

模型会看到一条有界说明：完整 JSON 结果已保存、`.json` locator、来自工具输出 schema 的根级摘要，以及后端取回提示。模型不会把一个无效 JSON 片段当作数据接收。

#### Token 影响

根摘要只使用通知的剩余预算。对象直接字段会逐个追加到预算耗尽为止；嵌套 schema 只保留根类型标签。

#### KV Cache 影响

与通用文本 spill 相同，仅追加。

## 已知限制与暂缓事项

- **只能对最终全是文本块的结果执行 spill**：显式 JSON 渲染仍是一种文本投影。混合内容结果、阻止反馈和 `read` 会原样通过；无法在此恢复更早发生的提供方截断。
- **通知无法容纳时，该次调用的替换功能会禁用**：当上限极小或定位信息很长时，后端已经保存了无引用的 spill，但过大的原始结果仍会保留在内联位置。
