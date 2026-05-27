import { describe, expect, it } from "vitest";
import { createDefaultToolRegistry } from "../../src/main/agent/tools/toolRegistry";

describe("createDefaultToolRegistry", () => {
  it("exposes core tools with risk and confirmation metadata", () => {
    const registry = createDefaultToolRegistry();

    expect(registry.list().map((tool) => tool.name)).toEqual([
      "open_application",
      "open_url",
      "web_search",
      "create_reminder",
      "cancel_reminder",
      "write_desktop_markdown",
      "list_directory",
      "read_file",
      "write_file",
      "delete_file",
      "restore_file_from_trash",
      "run_shell_command",
      "capture_screen",
      "window_control",
      "keyboard_input",
      "mouse_input",
      "recall_memory",
      "list_reminders"
    ]);

    expect(registry.get("open_application")).toMatchObject({
      capability: "open_application",
      risk: "low",
      requiresConfirmation: true,
      schema: {
        query: "string",
        source: "string?"
      },
      planOnly: true
    });
  });

  it("exposes high-risk system tools as plan-only confirmed actions", () => {
    const registry = createDefaultToolRegistry();

    expect(registry.get("run_shell_command")).toMatchObject({
      capability: "run_shell_command",
      risk: "high",
      requiresConfirmation: true,
      planOnly: true
    });
    expect(registry.get("write_file")).toMatchObject({
      capability: "write_file",
      risk: "high",
      requiresConfirmation: true,
      planOnly: true
    });
    expect(registry.get("restore_file_from_trash")).toMatchObject({
      capability: "restore_file_from_trash",
      risk: "high",
      requiresConfirmation: true,
      planOnly: true
    });
  });

  it("exposes critical Windows automation tools as plan-only confirmed actions", () => {
    const registry = createDefaultToolRegistry();

    for (const name of ["capture_screen", "window_control", "keyboard_input", "mouse_input"]) {
      expect(registry.get(name)).toMatchObject({
        risk: "critical",
        requiresConfirmation: true,
        planOnly: true
      });
    }
  });

  it("returns null for unknown tools", () => {
    const registry = createDefaultToolRegistry();

    expect(registry.get("shell_command")).toBeNull();
  });

  it("does not expose mutable registry internals", () => {
    const registry = createDefaultToolRegistry();
    const [tool] = registry.list();

    if (tool) tool.risk = "high";

    expect(registry.get("open_application")).toMatchObject({
      risk: "low"
    });
  });

  it("includes read-only context tools without confirmation", () => {
    const registry = createDefaultToolRegistry();

    expect(registry.get("recall_memory")).toMatchObject({
      capability: "recall_memory",
      risk: "low",
      requiresConfirmation: false,
      planOnly: true
    });
    expect(registry.get("list_reminders")).toMatchObject({
      capability: "list_reminders",
      risk: "low",
      requiresConfirmation: false,
      planOnly: true
    });
  });

  it("exposes reminder cancellation as a confirmed low-risk action", () => {
    const registry = createDefaultToolRegistry();

    expect(registry.get("cancel_reminder")).toMatchObject({
      capability: "cancel_reminder",
      risk: "low",
      requiresConfirmation: true,
      schema: {
        target: "latest",
        source: "string?"
      },
      planOnly: true
    });
  });

  it("exposes desktop markdown writing as a confirmed medium-risk local action", () => {
    const registry = createDefaultToolRegistry();

    expect(registry.get("write_desktop_markdown")).toMatchObject({
      capability: "write_desktop_markdown",
      risk: "medium",
      requiresConfirmation: true,
      schema: {
        title: "string",
        content: "string",
        source: "string?"
      },
      planOnly: true
    });
  });
});
