# Agent Note: 声明式 JSON 结果 spill

Status: implemented

[English](2026-08-14-declarative-json-result-spill.md) | 中文

## Problem

通用 spill 策略会保存完整的格式化结果，但只给模型返回首尾文本预览。当这段文本是序列化后的 JSON 值时，预览通常不是合法 JSON：数组或对象可能在任意 token 之间被切断，模型也拿不到可靠的根结构来选择有效的 `read` 或 `grep` 查询。在 spill 策略内重新解析 renderer 输出既重复工作，又需要猜测任意文本是不是 JSON，还丢掉了工具定义已经持有的更强事实：经过验证的规范值拥有声明式输出 schema。

策略不能假设每个工具结果都是 JSON。自定义 renderer 会刻意把 JSON 值形式的规范结果呈现为说明文本、表格、终端输出或其他格式。

## Decision

tools 包导出显式输出 renderer `jsonRenderer({ space })`。`defineTool` 把该声明转换为既有的可调用 render 契约，同时 registry 为成功结果保留执行期局部的 `{ kind: 'json', schema }` 投影。`ctx.tools.outputProjection(exec)` 将该投影暴露给同进程策略，但不把它加入持久化结果、面向模型的工具 schema 或 replay 格式。

spill 策略只特化这些已声明的 JSON 投影。结果超过 `maxInlineBytes` 时，策略用 `.json` 建议文件名保存完整渲染文本，并把面向模型的内容替换成有界通知，其中包含 locator、取回提示和声明式输出 schema 的根级摘要。对象摘要只在通知预算允许时追加直接字段；数组与 union 使用有界的根类型标签。schema 遍历不会检查规范值、解析渲染文本，也不会递归穿过无界嵌套 schema。

自定义 render 函数逐字节保留既有 `.txt` 首尾行为。内容替换、值替换、失败、嵌套执行、`read`、混合内容、缺少 owner、存储拒绝，以及通知无法放入上限等情形，都保留原有策略结果。

随附的 goal 工具与 Cordis inspection 工具改用 `jsonRenderer`。ACP `cordis-json-spill` replay 以真实 Cordis inspection 工具和本地 spill 栈启动，并固定 transcript 中可见的 `.json` locator 与根 schema 通知。

## Alternatives considered

**通过解析每个超限渲染字符串来探测 JSON。** 否决，因为语法合法不代表 renderer 的意图；这种方式重复序列化工作，而且只能推断工具已经声明、registry 已经验证过的结构。

**把每个规范工具值都当成 JSON 输出。** 否决，因为规范值始终兼容 JSON，而面向模型的呈现并非如此。这会把说明文本和终端输出错误标记为 JSON，并保存具有误导性的 `.json` 文件。

**自动把根数组转换成 JSONL。** 否决，因为它改变 renderer 格式与 locator 语义，只适用于一种根结构，并让保存结果不再等于完整的面向模型投影。JSONL 可以成为未来的显式 renderer，而不应由保留策略推断。

**在通知中返回完整工具 schema。** 否决，因为大型嵌套 schema 会与结果争抢上下文。有界根摘要足以开始探索；工具目录仍是完整 schema 的权威来源。

**给 `ToolExecutionResult` 增加 schema 与 locator 字段。** 否决，因为 spill 位置属于策略／后端呈现状态，不是规范工具结果；修改持久化结果还会无谓扩大 session 与 Code Mode 契约。

## Consequences

- 超限的声明式 JSON 在 locator 中保持完整且可解析；模型不再收到一个语法损坏的片段作为预览。
- 策略复用工具输出 schema，不执行 JSON probe。无约束 `json` schema 会如实报告为 `json`，而不是根据一次运行样本推断。
- opt-in 是显式的。既有工具与第三方自定义 renderer 在选择 `jsonRenderer` 前都不会改变。
- 该变更不会降低大型值执行 `JSON.stringify` 所需的峰值内存：post-execute spill 之前仍会完整物化 JSON 字符串。流式序列化是独立的架构优化，便于单独评审其内存与文件发布权衡。
- Code Mode 嵌套 dispatch log 保持既有通用文本 spill 行为。本决策刻意不把执行期局部投影加入持久化 dispatch-log 契约。
