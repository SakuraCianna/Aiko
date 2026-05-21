import { describe, expect, it } from "vitest";
import { createDefaultToolRegistry } from "../../src/main/agent/tools/toolRegistry";

describe("createDefaultToolRegistry", () => {
  it("exposes core tools with risk and confirmation metadata", () => {
    const registry = createDefaultToolRegistry();

    expect(registry.list().map((tool) => tool.name)).toEqual([
      "open_application",
      "open_url",
      "web_search",
      "create_reminder"
    ]);

    expect(registry.get("open_application")).toMatchObject({
      capability: "open_application",
      risk: "low",
      requiresConfirmation: true,
      planOnly: true
    });
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
});
