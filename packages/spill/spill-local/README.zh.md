# @deepseek-ai/dsh-spill-local

[English](README.md) | 中文

[`@deepseek-ai/dsh-spill`](../spill) 存储 seam 的**本地文件系统**实现。它注册为 `ctx.spillStore`，将工具产生的过大文本持久化到私有的会话级文件；定位信息是文件路径，取回指引会告诉模型对该路径使用 `read` 或 `grep`。

## 存储布局

文件存放在 `<root>/session-<hash>/​<random>-<safeName>`：

- **`root`**：使用配置中的 `root`（解析为绝对路径）；如果省略，则在操作系统临时目录下延迟创建每进程私有（0700）目录。可预测且任何用户均可读取的根目录会让其他本地用户读取 spill 工具输出，或在其中预置符号链接。
- **`session-<hash>`**：截短的 `sha256(sessionId)` 前缀，用于将同一会话的 spill 文件归在一起，以便未来的清理操作可按会话删除。
- **`<random>-<safeName>`**：不可预测的十六进制前缀，加上经过清理的调用方 `suggestedName`，使其成为单个安全路径段。写入先使用同一私有 session 目录中仅 owner 可读写、不可预测的 `.tmp-*` inode；完整写入并关闭后，再通过 no-clobber hard link 原子发布最终名称，随后删除临时 link。因此读取方只能看到最终 locator 不存在，或看到完整字节，绝不会看到写到一半的最终文件。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `root` | 私有 0700 临时目录 | spill 文件的根目录。设置后可将这些文件保存在已知位置。 |

`saveText` 与 `saveTextStream` 在发生真实存储故障或输入 stream 失败时都会返回拒绝。失败的 stream 保存会删除私有临时文件，且绝不发布最终 locator。spill 策略会按尽力而为原则处理拒绝，并保留普通内联 renderer 结果。

## 模型体验

通过渲染本地路径以及 `read`/`grep` 取回指引的 spill 消费方间接影响模型。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与暂缓事项

- **本地 spill 文件会持续存在，直到外部清理为止**：该后端不提供会话生命周期删除或按时间保留的策略，因为已持久化、已恢复和 fork 后的会话可能仍在引用某个路径。
- **定位信息需要与其位于同一文件系统的消费方**：远程或虚拟部署需要另一个 `SpillStore` 后端，其定位信息和取回指引在该环境中有明确含义。
