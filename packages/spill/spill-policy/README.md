# @deepseek-ai/dsh-spill-policy

English | [中文](README.zh.md)

The **tool-result spill policy**: a `tools/post-execute` transformer that keeps oversized tool results out of the model's context. Generic text gets a bounded head/tail preview. Results produced by the tools package's explicit `jsonRenderer` are instead saved as complete valid `.json` files and replaced with their declared root schema, locator, and retrieval hint.

This plugin registers **no service** and owns no storage or preview mechanics: preview is [`@deepseek-ai/dsh-output-retention`](../../util/output-retention) (`TextRetainer`), storage is `ctx.spillStore`. It only decides WHEN to spill and composes the notice.

## Config

| Key | Default | Meaning |
|---|---|---|
| `maxInlineBytes` | *(omitted)* | Model-facing context cap for a plain-text result, in UTF-8 bytes (a non-negative integer; validated at load). **Omitted disables the policy entirely** (the plugin registers nothing). When set, a larger result is spilled and replaced with a preview derived from the same budget (head/tail split). |

## Behavior

1. Let the tool run (delegates via `next()`, so it bounds whatever a downstream hook accepted).
2. Skip nested executions (`exec.parent` is present — their DURABLE copy is bounded by the dispatch-log arm below), accepted value replacements (the registry must revalidate and rerender them), `read` (avoids a `read → spill → read again` loop), and any non-`accept` decision (a `block`'s corrective feedback passes through).
3. Flatten the accepted content only when it is **plain text** (all `text` blocks); a result with any non-text block is left untouched. Read the execution-local output projection from `ctx.tools`; custom renderers have none and remain generic text.
4. If its UTF-8 size is `≤ maxInlineBytes`, leave it unchanged.
5. Otherwise save the full text. A generic result uses `.txt` and is replaced with a preview + this notice, sized so the whole replacement (preview + blank line + notice) stays within `maxInlineBytes` — the notice's byte cost is reserved out of the budget, so the preview shrinks to fit and the model-facing result never exceeds the cap:

   ```text
   <retained head/tail preview>

   (Omitted N bytes. Full formatted result stored at: /…/session-…/…-web_fetch.txt. Use read with offset/limit, or grep this path to search within it.)
   ```

   An explicit JSON result uses `.json` and no broken head/tail preview. Before ordinary whole-string rendering, the policy serializes incrementally, buffers only through the inline cap, then streams the remainder to storage. Its bounded notice reports `Root output schema: ...`, derived from the already-declared tool output schema. It does not parse, probe, or infer from rendered text. The stored file is the complete rendered JSON.

   When a notice alone cannot fit (a tiny cap or a long locator), the policy keeps the inline result. It never emits a replacement over the cap.

**Best-effort:** no session owner, no `ctx.spillStore` backend, or a `saveText` rejection ⇒ the policy logs a warning and returns the original result. A spill failure never turns a successful call into an `isError` or hides the inline result. A successful replacement changes only `content`; the canonical programmatic value is preserved.

**The dispatch-log arm:** a second listener on `tools/code-dispatch-log` applies the same cap, replacement pipeline, and best-effort fallbacks to the DURABLE copy of each `run_code` sub-call result (artifact label `dispatch`, keyed by the sub-call id). The program's value is untouched — it already crossed the worker boundary whole — and `read` sub-calls are bounded too: a log copy is not model context, so the read-again loop cannot occur, and `read` is precisely the tool that produces huge logs ([rationale](../../../.agents/notes/implemented/feature/2026-07-26-code-dispatch-log-spill.md)).

## Scope

Generic text still operates on the final formatted result. The explicit JSON specialization runs at the tools registry's asynchronous renderer waterfall, after canonical validation and before content materialization. Neither path can recover a provider's earlier truncation. Provider/resource caps stay mandatory and separate. See the [streaming spill decision](../../../.agents/notes/implemented/architecture/2026-08-14-atomic-streamed-json-spill.md), [JSON spill decision](../../../.agents/notes/implemented/feature/2026-08-14-declarative-json-result-spill.md), and original [tool output spill architecture](../../../.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md).

## Model Experience

### Oversized plain-text result

#### What the model sees

Results at or below `maxInlineBytes`, nested results, `read` results, blocked decisions, and results containing non-text blocks are unchanged. An oversized plain-text model-facing result becomes a bounded head/tail preview followed by `(Omitted <bytes> bytes. Full formatted result stored at: <locator>. <retrievalHint>)`; storage or ownership failures leave the original result visible.

#### Token effect

A successful replacement is at most `maxInlineBytes` UTF-8 bytes and remains in history until compaction; the full spill text is not resent to the model.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Oversized declared JSON result

#### What the model sees

The model sees a bounded statement that the complete JSON result was saved, the `.json` locator, a root-only summary sourced from the tool's output schema, and the backend retrieval hint. It does not see an invalid JSON fragment presented as data.

#### Token effect

The root summary spends only the remaining notice budget. Direct object properties are appended until that budget is exhausted; nested schemas are reduced to root type labels.

#### KV Cache effect

Append-only, like generic text spill.

## Known Limitations and Deferred Work

- **Only final all-text results are spillable** — explicit JSON rendering is still a text projection. Mixed-content results, blocked feedback, and `read` pass through; earlier provider truncation cannot be recovered here.
- **A notice that cannot fit disables replacement for that call** — a tiny cap or long locator leaves the oversized original inline after the backend has already saved an unreferenced spill.
