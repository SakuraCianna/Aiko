import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AikoAgentStatusEventDto } from "../../src/shared/ipcTypes";
import { selectAgentStatusCue } from "../../src/renderer/character/agentStatusMotion";

describe("agent status motion cues", () => {
  it("maps agent lifecycle phases to distinct VRM behavior cues", () => {
    expect(selectAgentStatusCue(status("retrieving"))).toEqual({
      behavior: "searching",
      motion: "search"
    });
    expect(selectAgentStatusCue(status("planning"))).toEqual({
      behavior: "thinking",
      motion: "ponder"
    });
    expect(selectAgentStatusCue(status("model_generating"))).toEqual({
      behavior: "thinking",
      motion: "think"
    });
    expect(selectAgentStatusCue(status("memory_writing"))).toEqual({
      behavior: "writing",
      motion: "write"
    });
    expect(selectAgentStatusCue(status("waiting_approval"))).toEqual({
      behavior: "confirming",
      motion: "notice"
    });
    expect(selectAgentStatusCue(status("action_executing"))).toEqual({
      behavior: "presenting",
      motion: "tap"
    });
  });

  it("maps terminal phases without fighting the final response renderer", () => {
    expect(selectAgentStatusCue(status("completed"))).toBeNull();
    expect(selectAgentStatusCue(status("cancelled"))).toEqual({
      behavior: "idle",
      motion: "interrupt"
    });
    expect(selectAgentStatusCue(status("failed"))).toEqual({
      behavior: "recovering",
      motion: "errorRecover"
    });
  });

  it("wires renderer subscription through preload and App", () => {
    const preload = readFileSync("src/main/preload.ts", "utf8");
    const sharedTypes = readFileSync("src/shared/ipcTypes.ts", "utf8");
    const app = readFileSync("src/renderer/App.tsx", "utf8");

    expect(sharedTypes).toContain("AikoAgentStatusEventDto");
    expect(sharedTypes).toContain("onAgentStatus");
    expect(preload).toContain("agent:status");
    expect(app).toContain("onAgentStatus");
    expect(app).toContain("selectAgentStatusCue");
  });
});

function status(phase: AikoAgentStatusEventDto["phase"]): AikoAgentStatusEventDto {
  return {
    phase,
    message: phase,
    createdAt: "2026-05-25T10:00:00.000Z"
  };
}
