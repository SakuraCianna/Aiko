import { describe, expect, it } from "vitest";
import {
  createDefaultCapabilityPolicy,
  evaluateCapabilityPolicy
} from "../../src/main/agent/policy/capabilityPolicy";
import type { PendingActionDto } from "../../src/shared/ipcTypes";

describe("capability policy", () => {
  it("confirms known local actions and marks rememberable low-risk actions", () => {
    const decision = evaluateCapabilityPolicy(openApplicationAction(), createDefaultCapabilityPolicy());

    expect(decision).toEqual({
      allowed: true,
      requiresConfirmation: true,
      rememberable: true,
      reason: "confirmation_required"
    });
  });

  it("denies unknown capabilities even when the model marks them as low risk", () => {
    const decision = evaluateCapabilityPolicy(
      {
        title: "Delete files",
        source: "delete temp",
        risk: "low",
        capability: "delete_files",
        target: "C:/Users/Sakura_Cianna/Desktop"
      },
      createDefaultCapabilityPolicy()
    );

    expect(decision).toMatchObject({
      allowed: false,
      requiresConfirmation: false,
      reason: "unknown_capability"
    });
  });

  it("keeps high-risk Windows automation capabilities confirmed and non-rememberable", () => {
    const policy = createDefaultCapabilityPolicy();

    expect(policy.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "read_file", risk: "high", defaultDecision: "confirm", rememberable: false }),
      expect.objectContaining({ capability: "write_file", risk: "high", defaultDecision: "confirm", rememberable: false }),
      expect.objectContaining({ capability: "delete_file", risk: "high", defaultDecision: "confirm", rememberable: false }),
      expect.objectContaining({ capability: "restore_file_from_trash", risk: "high", defaultDecision: "confirm", rememberable: false }),
      expect.objectContaining({ capability: "run_shell_command", risk: "high", defaultDecision: "confirm", rememberable: false })
    ]));
    expect(
      evaluateCapabilityPolicy(
        {
          title: "Run shell",
          source: "run command",
          risk: "low",
          capability: "run_shell_command",
          target: "powershell"
        },
        policy
      )
    ).toMatchObject({
      allowed: true,
      requiresConfirmation: true,
      rememberable: false,
      reason: "confirmation_required"
    });
  });

  it("denies nested batch actions", () => {
    const action: PendingActionDto = {
      title: "Nested batch",
      source: "batch",
      risk: "low",
      capability: "batch_actions",
      target: "batch",
      actions: [
        {
          title: "Inner batch",
          source: "batch",
          risk: "low",
          capability: "batch_actions",
          target: "batch",
          actions: [openApplicationAction()]
        }
      ]
    };

    expect(evaluateCapabilityPolicy(action, createDefaultCapabilityPolicy())).toMatchObject({
      allowed: false,
      reason: "nested_batch_denied"
    });
  });
});

function openApplicationAction(): PendingActionDto {
  return {
    title: "Open Cursor",
    source: "open cursor",
    risk: "low",
    capability: "open_application",
    target: "Cursor"
  };
}
