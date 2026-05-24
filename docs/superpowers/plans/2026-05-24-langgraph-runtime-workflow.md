# LangGraph Runtime Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a LangGraph Functional API workflow boundary around Aiko's existing Agent request lifecycle without changing renderer, IPC, or user-visible behavior.

**Architecture:** Keep `AikoAgentRuntime` as the public entry point. Extract the request lifecycle into a focused LangGraph workflow module that owns node sequencing and lifecycle trace labels, while the existing runtime keeps model routing, local action safety, memory extraction, and streaming behavior. This is a stepping stone toward durable checkpointing and human-in-the-loop interrupts.

**Tech Stack:** TypeScript, Electron main process, LangChain v1, `@langchain/langgraph`, Vitest.

---

### Task 1: Add Graph Boundary Test

**Files:**
- Create: `tests/agent/aikoAgentWorkflow.test.ts`
- Modify: `tests/agent/agentArchitectureBoundary.test.ts`

- [x] Add a test that imports `createAikoAgentWorkflow` from `src/main/agent/graph/aikoAgentWorkflow.ts`.
- [x] Assert the workflow exposes `invoke` and records lifecycle nodes in order.
- [x] Run `npm test -- tests/agent/aikoAgentWorkflow.test.ts` and verify it fails because the module does not exist.

### Task 2: Implement LangGraph Workflow Module

**Files:**
- Create: `src/main/agent/graph/aikoAgentWorkflow.ts`

- [x] Implement a small Functional API workflow using `entrypoint` and `task` from `@langchain/langgraph`.
- [x] Define `AikoAgentWorkflowDeps`, `AikoAgentWorkflowResult`, and `AikoAgentWorkflowStepName`.
- [x] Keep task payloads JSON-serializable so this can later move to checkpointed execution.
- [x] Make `createAikoAgentWorkflow()` return an object with `invoke(input)`.

### Task 3: Wire Runtime Through Workflow

**Files:**
- Modify: `src/main/agent/aikoAgentRuntime.ts`
- Modify: `tests/agent/aikoAgentRuntime.test.ts`

- [x] Replace direct retriever/planner/executor sequencing with workflow invocation.
- [x] Preserve cancellation checks between workflow stages.
- [x] Preserve existing trace event names so current tests and debugging stay stable.
- [x] Keep streaming, model fallback, pending action collection, and memory extraction inside runtime for now.

### Task 4: Update Architecture Documentation

**Files:**
- Modify: `docs/agent-architecture.md`
- Modify: `README.md` if public architecture wording needs adjustment.

- [x] Document that the runtime now has an explicit LangGraph workflow boundary.
- [x] Keep the warning that local Windows actions must not execute inside LangChain tools.
- [x] Clarify that full LangGraph HITL/checkpoint persistence remains the next migration step.

### Task 5: Verify

**Files:**
- No production changes.

- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `npm run build`.

### Task 6: Add Passive Approval Payload And Interrupt-Ready Resume

**Files:**
- Modify: `src/main/agent/graph/aikoAgentWorkflow.ts`
- Test: `tests/agent/aikoAgentWorkflow.test.ts`
- Modify: `docs/agent-architecture.md`

- [x] Add tests for passive `pending_action_review` payloads.
- [x] Add tests for LangGraph `interrupt` mode and `resume` decisions.
- [x] Implement `approvalMode: "passive" | "interrupt"`.
- [x] Keep runtime on passive mode during the first migration step so existing IPC confirmation behavior stays unchanged.
- [x] Document the migration boundary and the remaining resume integration step.

### Task 7: Connect Runtime Approval Resume To IPC Execution

**Files:**
- Modify: `src/main/agent/aikoAgentRuntime.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/shared/ipcTypes.ts`
- Test: `tests/agent/aikoAgentRuntime.test.ts`

- [x] Add runtime-level `approvalMode: "interrupt"` support for deterministic pending actions.
- [x] Attach an approval thread id to returned pending actions without changing renderer behavior.
- [x] Resume LangGraph approval before local action execution, including remembered/auto-approved paths.
- [x] Clear pending approval sessions when the current conversation is reset.

### Task 8: Close The HITL Approval Loop

**Files:**
- Modify: `src/main/agent/aikoAgentRuntime.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/shared/ipcTypes.ts`
- Test: `tests/agent/aikoAgentRuntime.test.ts`
- Test: `tests/agent/agentArchitectureBoundary.test.ts`
- Test: `tests/renderer/layoutCss.test.ts`

- [x] Make runtime-level interrupt approval the default path.
- [x] Add a lightweight LangGraph approval workflow for model-proposed actions and auto Markdown actions.
- [x] Add `action:cancel` IPC and renderer `cancelAction` bridge.
- [x] Resume approval with `reject` when the user cancels a pending action.
- [x] Preserve `PendingActionDto.approval` through renderer state and choice actions.
- [x] Remove sibling pending actions that share an approval thread after one choice is approved or rejected.
