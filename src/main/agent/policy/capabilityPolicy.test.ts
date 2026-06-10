import { describe, expect, test } from "vitest";
import type { PendingActionDto } from "../../../shared/ipcTypes";
import { evaluateCapabilityPolicy } from "./capabilityPolicy";

function action(overrides: Partial<PendingActionDto> = {}): PendingActionDto {
  return {
    title: "打开网页",
    source: "打开 https://example.com",
    risk: "low",
    capability: "open_url",
    target: "https://example.com",
    ...overrides
  };
}

describe("evaluateCapabilityPolicy", () => {
  test("allows low-risk open URL actions with confirmation and remembered authorization", () => {
    expect(evaluateCapabilityPolicy(action())).toMatchObject({
      allowed: true,
      requiresConfirmation: true,
      rememberable: true,
      reason: "confirmation_required"
    });
  });

  test("rejects understated critical capabilities", () => {
    expect(
      evaluateCapabilityPolicy(
        action({
          title: "截屏",
          source: "截屏看看问题",
          risk: "low",
          capability: "capture_screen",
          target: "primary_display"
        })
      )
    ).toMatchObject({
      allowed: false,
      reason: "risk_mismatch"
    });
  });

  test("rejects nested batch actions", () => {
    expect(
      evaluateCapabilityPolicy(
        action({
          title: "批量执行",
          source: "执行一组动作",
          risk: "medium",
          capability: "batch_actions",
          target: "batch",
          actions: [
            action({
              title: "内层批量",
              source: "内层",
              risk: "medium",
              capability: "batch_actions",
              target: "batch",
              actions: [action()]
            })
          ]
        })
      )
    ).toMatchObject({
      allowed: false,
      reason: "nested_batch_denied"
    });
  });
});
