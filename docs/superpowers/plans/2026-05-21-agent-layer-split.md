# Agent Layer Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Aiko Agent into Retriever, Planner, Executor, Tool Registry and Trace boundaries while preserving current user-visible behavior.

**Architecture:** `aikoAgentRuntime.ts` remains the orchestration entry. New focused modules own context retrieval, plan generation, execution preparation, tool metadata and per-request trace records. Existing `ActionExecutor` remains the final local action executor.

**Tech Stack:** TypeScript, Electron main process, LangChain v1, Vitest, Node 24 `node:sqlite`.

---

### Task 1: Define Shared Agent Types

**Files:**
- Create: `src/main/agent/types.ts`

- [ ] Add shared types for retrieved context, plan steps, plan result and trace events.
- [ ] Keep `PendingActionDto` as the IPC action DTO instead of inventing a second action format.

### Task 2: Add Tool Registry

**Files:**
- Create: `src/main/agent/tools/toolRegistry.ts`
- Test: `tests/agent/toolRegistry.test.ts`

- [ ] Write tests that assert core tools expose metadata, risk level and confirmation policy.
- [ ] Implement `createDefaultToolRegistry`.
- [ ] Keep tool definitions plan-only for model-facing actions.

### Task 3: Add Retriever

**Files:**
- Create: `src/main/agent/retriever/aikoRetriever.ts`
- Test: `tests/agent/aikoRetriever.test.ts`

- [ ] Write tests for memory recall, speech context and attachment summary behavior.
- [ ] Move memory recall and context formatting out of runtime.
- [ ] Preserve the current anti-hallucination wording for memory and audio failures.

### Task 4: Add Planner

**Files:**
- Create: `src/main/agent/planner/aikoPlanner.ts`
- Test: `tests/agent/aikoPlanner.test.ts`

- [ ] Write tests for deterministic open app, web search, URL open and reminder plans.
- [ ] Move deterministic action detection out of runtime.
- [ ] Represent chat, action and clarify outcomes as `AikoPlan`.

### Task 5: Add Executor Adapter

**Files:**
- Create: `src/main/agent/executor/aikoExecutor.ts`
- Test: `tests/agent/aikoExecutor.test.ts`

- [ ] Write tests for converting action plans into execution proposals.
- [ ] Keep high risk actions blocked before local execution.
- [ ] Preserve current `ActionExecutor` as the final execution backend.

### Task 6: Add Trace Recorder

**Files:**
- Create: `src/main/agent/trace/aikoTrace.ts`
- Test: `tests/agent/aikoTrace.test.ts`

- [ ] Write tests for in-memory trace recording.
- [ ] Record request lifecycle events without persisting to database yet.
- [ ] Allow tests and future UI to inspect trace snapshots.

### Task 7: Wire Runtime

**Files:**
- Modify: `src/main/agent/aikoAgentRuntime.ts`
- Modify: `tests/agent/aikoAgentRuntime.test.ts`
- Modify: `tests/agent/agentArchitectureBoundary.test.ts`

- [ ] Use Retriever to prepare model context.
- [ ] Use Planner for deterministic actions before calling the model.
- [ ] Use Tool Registry to create LangChain tools.
- [ ] Use Trace Recorder around each request.
- [ ] Keep existing streaming, memory extraction and fallback behavior.

### Task 8: Verify

**Files:**
- No production changes.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Scan source for deprecated React `FormEvent`, obvious TODO/FIXME, and Chinese punctuation in new code.
