import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  createAikoAgentWorkflow,
  isAikoAgentWorkflowInterrupted
} from "../../src/main/agent/graph/aikoAgentWorkflow";
import { createSqliteCheckpointSaver } from "../../src/main/agent/graph/sqliteCheckpointSaver";
import { runMigrations } from "../../src/main/database/migrations";
import type { PendingActionDto } from "../../src/shared/ipcTypes";

const require = createRequire(import.meta.url);

describe("createSqliteCheckpointSaver", () => {
  it("resumes an interrupted approval workflow after reopening the SQLite database", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "aiko-checkpoint-"));
    const dbPath = path.join(tempDir, "aiko.db");
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const action = openApplicationAction("Cursor");
    const threadId = "aiko-persistent-approval";

    const firstDb = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
    runMigrations(firstDb);
    const firstWorkflow = createAikoAgentWorkflow({
      approvalMode: "interrupt",
      checkpointer: createSqliteCheckpointSaver(firstDb),
      async retrieve(payload) {
        return emptyContext(payload.text);
      },
      async plan() {
        return {
          mode: "action",
          replyDraft: "需要确认.",
          steps: [{ kind: "action", source: "deterministic", action }],
          grounding: []
        };
      },
      async prepare() {
        return {
          kind: "pending_action",
          message: "需要确认.",
          action
        };
      }
    });

    const interrupted = await firstWorkflow.invoke({ text: "打开 Cursor", attachments: [] }, { threadId });
    expect(isAikoAgentWorkflowInterrupted(interrupted)).toBe(true);
    firstDb.close();

    const secondDb = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
    runMigrations(secondDb);
    const resumedWorkflow = createAikoAgentWorkflow({
      approvalMode: "interrupt",
      checkpointer: createSqliteCheckpointSaver(secondDb),
      async retrieve() {
        throw new Error("checkpoint resume should not rerun retrieve");
      },
      async plan() {
        throw new Error("checkpoint resume should not rerun plan");
      },
      async prepare() {
        throw new Error("checkpoint resume should not rerun prepare");
      }
    });

    const resumed = await resumedWorkflow.resume({ type: "approve" }, { threadId });

    expect(isAikoAgentWorkflowInterrupted(resumed)).toBe(false);
    if (isAikoAgentWorkflowInterrupted(resumed)) throw new Error("workflow should resume");
    expect(resumed.approval).toEqual({
      status: "reviewed",
      payload: {
        kind: "pending_action_review",
        message: "需要确认.",
        action
      },
      decision: {
        type: "approve"
      }
    });

    secondDb.close();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

function emptyContext(text: string) {
  return {
    userText: text,
    userTranscript: text,
    userContent: text,
    attachmentSummaries: [],
    memories: [],
    speechResults: [],
    webResearch: null,
    currentKnowledge: null,
    toolHints: []
  };
}

function openApplicationAction(target: string): PendingActionDto {
  return {
    title: `打开应用:${target}`,
    source: `打开 ${target}`,
    risk: "low",
    capability: "open_application",
    target
  };
}
