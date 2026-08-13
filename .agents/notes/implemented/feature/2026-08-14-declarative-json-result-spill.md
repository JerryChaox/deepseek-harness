# Agent Note: Declarative JSON result spill

Status: implemented

English | [中文](2026-08-14-declarative-json-result-spill.zh.md)

## Problem

The generic spill policy saves a complete formatted result but gives the model a head/tail text preview. When that text is a serialized JSON value, the preview is usually invalid JSON: an array or object can be cut between tokens, and the model has no reliable root shape with which to choose a useful `read` or `grep` query. Parsing the renderer's output inside the spill policy would duplicate work, guess that arbitrary text is JSON, and discard the stronger fact already held by the tool definition: the validated canonical value has a declared output schema.

The policy must not assume every tool result is JSON. Custom renderers intentionally produce prose, tables, terminal text, and other representations from JSON-valued canonical results.

## Decision

The tools package exports `jsonRenderer({ space })` as an explicit output renderer. `defineTool` turns that declaration into the existing callable render contract, while the registry retains an execution-local `{ kind: 'json', schema }` projection for successful results rendered through it. `ctx.tools.outputProjection(exec)` exposes that projection to same-process policies without adding it to the durable result, model-facing tool schema, or replay format.

The spill policy specializes only those declared JSON projections. Above `maxInlineBytes`, it saves the complete rendered text under a `.json` suggested name and replaces the model-facing content with a bounded notice containing the locator, retrieval hint, and a root-only summary of the declared output schema. Object summaries add direct fields only while the notice budget permits; arrays and unions use bounded root type labels. Schema traversal does not inspect the canonical value, parse the rendered text, or recurse through unbounded nested schemas.

Custom render functions retain the existing `.txt` head/tail behavior byte for byte. Content replacements, value replacements, failures, nested executions, `read`, mixed content, missing ownership, storage rejection, and a notice too large for the configured cap retain their previous policy outcomes.

The shipped goal tools and Cordis inspection tools adopt `jsonRenderer`. The ACP `cordis-json-spill` replay boots the real Cordis inspection tool with the local spill stack and pins the transcript-visible `.json` locator plus root-schema notice.

## Alternatives considered

**Detect JSON by parsing every oversized rendered string.** Rejected because syntax does not establish renderer intent, it repeats serialization work, and it can only infer a shape that the tool already declared and the registry already validated.

**Treat every canonical tool value as JSON output.** Rejected because canonical values are always JSON-compatible while model-facing renderings are not. This would relabel prose and terminal output as JSON and save misleading `.json` files.

**Convert root arrays to JSONL automatically.** Rejected because it changes the renderer's format and locator semantics, applies only to one root shape, and makes a saved result differ from the complete model-facing projection. JSONL can be an explicit future renderer, not an inference made by retention policy.

**Return the entire tool schema in the notice.** Rejected because large nested schemas would compete with the result for context. A bounded root summary is enough to begin exploration; the tool catalog remains the authoritative full schema source.

**Add schema and locator fields to `ToolExecutionResult`.** Rejected because spill location is policy/backend presentation state, not a canonical tool outcome, and durable result changes would widen session and Code Mode contracts unnecessarily.

## Consequences

- Oversized declared JSON remains complete and parseable at its locator; the model no longer receives a syntactically broken fragment as its preview.
- The policy reuses the tool's output schema and performs no JSON probe. An unconstrained `json` schema is reported honestly as `json` rather than inferred from one runtime sample.
- Opt-in is explicit. Existing tools and third-party custom renderers do not change until they select `jsonRenderer`.
- This change does not reduce the peak memory required to stringify a large value: rendering still materializes the complete JSON string before post-execute spill. Streaming serialization is a separate architectural optimization so its memory and file-publication trade-offs can be reviewed independently.
- Code Mode nested dispatch logs keep their existing generic text spill behavior. The execution-local projection is intentionally not added to the durable dispatch-log contract in this decision.
