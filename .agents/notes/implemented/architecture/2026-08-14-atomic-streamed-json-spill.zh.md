# Agent Note: 原子发布的流式 JSON spill

Status: implemented

[English](2026-08-14-atomic-streamed-json-spill.md) | 中文

## Problem

[声明式 JSON spill 功能](../feature/2026-08-14-declarative-json-result-spill.md)解决了模型探索问题，但它在 post-execute 中先完整物化 JSON 字符串，随后才把该字符串写入存储。对于远大于内联上限的结果，即便模型只收到一条很短的通知，运行时仍要同时持有经过验证的规范值与第二份完整结果表示。

增量写入还带来独立的正确性风险：如果在序列化或存储完成前就让最终 locator 指向文件，并发读取方可能看到语法不完整的 JSON 前缀。序列化器失败也可能留下一个貌似有效、实际指向部分文件的 locator。

## Decision

显式 JSON 渲染在规范值验证之后、结果内容物化之前增加一道异步 `tools/render-json-output` waterfall。默认路径保留既有 `JSON.stringify` renderer。spill 策略在此监听，通过显式工作栈序列化，并且只把 chunk 缓冲到其 UTF-8 大小跨过 `maxInlineBytes`。上限内结果委托给剩余 renderer 链并保持内联；超限结果则把缓冲前缀与后续所有 chunk 通过 `SpillStore.saveTextStream` 流式写出，最后返回与前一个功能相同的 schema-aware 通知。

该序列化器在无损 JSON 词汇范围内与 `JSON.stringify(value, null, space)` 一致，包括字符串转义、孤立 surrogate、对象键顺序、紧凑输出，以及 1–10 的缩进宽度。它不会递归遍历值树，大字符串与缩进也以有界 chunk 发出。

`SpillStore.saveTextStream` 是增量兼容操作：基类实现会收集 chunk 并委托给 `saveText`，因此既有后端保持源码兼容。本地后端覆盖该方法：先在目标 session 目录内写入不可预测、仅 owner 可读写的临时 inode；完整关闭后，通过 no-clobber hard link 发布最终随机名称，再尝试删除临时 link。stream、写入、关闭或发布失败时不返回 locator；主要结果明确之后，临时文件清理以尽力而为方式进行。

`saveText` 也复用同一本地原子路径，只是把已物化字符串适配为单个 chunk 的 stream。通用文本 spill 策略及其模型可见行为不变。

## Alternatives considered

**把已经物化的 JSON 字符串切成 chunk。** 否决，因为这只改变写入调用，不降低序列化峰值内存；第一个 chunk 到达存储前，完整字符串已经存在。

**直接写最终随机路径。** 否决，因为不可预测名称能防碰撞攻击，却不能阻止已经获知或观察到路径的读取方在写入期间读取部分文件。

**用 rename 把临时文件覆盖到最终名称。** 同目录 rename 是原子的，但普通 rename 可以替换既有目标。这里选择 no-clobber hard-link 发布，以保留后端原有的排他创建保证。

**把 JSONL 作为流式格式。** 否决，因为 JSONL 改变 renderer 契约，而且只天然适合序列。对于每一种支持的根结构，保存字节都必须严格等于声明式 JSON 投影。

**要求所有 spill 后端立即实现流式写入。** 否决，因为这会让一次优化变成破坏性服务变更。基类兼容实现先保证正确性，再让有能力的后端获得有界内存收益。

## Consequences

- 超限的声明式 JSON 不再需要完整序列化字符串。serializer 缓冲上限为内联上限加一个有界 chunk；规范值本身仍必须留在内存中，以供验证和程序化消费者使用。
- 本地最终 locator 是原子发布点：完成前不存在，发布后即完整。临时文件名是私有实现细节，成功或失败后的清理均以尽力而为方式进行。
- 非流式后端仍然正确，但基类兼容实现会拼接 chunk，因此得不到内存收益。后端能力是行为差异，而非第二项服务声明。
- 只有 registry 的内置声明式 renderer 边界变为异步。自定义同步 render 函数与公开 `ToolExecutionResult` 结构保持不变。
- 流式存储或通知构造失败时，策略会调用普通整串 renderer 并保留内联结果。这条尽力回退可能重新付出原有内存成本，但不会把存储优化失败变成工具失败。
- 嵌套 Code Mode dispatch 保持既有 renderer 与持久日志行为；本决策不对跨 worker 边界的值执行流式处理。
