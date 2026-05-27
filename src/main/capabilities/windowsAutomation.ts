import { app, desktopCapturer } from "electron";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type CapturedScreenResult = {
  filePath: string;
  summary?: string;
};

export type WindowDescriptor = {
  processId: number;
  processName: string;
  title: string;
};

export type WindowFocusResult = {
  focused: boolean;
  title?: string;
};

export type MouseInput = {
  x: number;
  y: number;
  click?: "none" | "left" | "right";
};

export type KeyboardInput = {
  keys: string;
};

export type WindowsAutomation = {
  captureScreen: (input: { target: string; analysisPrompt?: string }) => Promise<CapturedScreenResult>;
  listWindows: () => Promise<WindowDescriptor[]>;
  focusWindow: (query: string) => Promise<WindowFocusResult>;
  sendKeys: (input: KeyboardInput) => Promise<void>;
  moveMouse: (input: MouseInput) => Promise<void>;
};

const MAX_SEND_KEYS_LENGTH = 120;

// 创建 Windows 自动化后端, 所有调用都应先经过 critical 风险确认.
export function createWindowsAutomation(): WindowsAutomation {
  return {
    async captureScreen(input) {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1920, height: 1080 }
      });
      const source = sources.find((candidate) => candidate.name === input.target) ?? sources[0];
      if (!source) throw new Error("screen_source_not_found");

      const dir = path.join(app.getPath("desktop"), "Aiko", "screenshots");
      await mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${formatTimestamp(new Date())}-screen.png`);
      await writeFile(filePath, source.thumbnail.toPNG());
      return {
        filePath,
        summary: input.analysisPrompt ? `Analysis requested: ${input.analysisPrompt}` : undefined
      };
    },

    async listWindows() {
      const output = await runPowerShellJson(`
        Get-Process |
          Where-Object { $_.MainWindowTitle } |
          Select-Object @{Name='processId';Expression={$_.Id}}, @{Name='processName';Expression={$_.ProcessName}}, @{Name='title';Expression={$_.MainWindowTitle}} |
          ConvertTo-Json -Compress
      `);
      if (!output.trim()) return [];
      const parsed = JSON.parse(output) as WindowDescriptor | WindowDescriptor[];
      return Array.isArray(parsed) ? parsed : [parsed];
    },

    async focusWindow(query) {
      const output = await runPowerShellJson(
        `
          $query = $env:AIKO_WINDOW_QUERY
          Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          public class AikoUser32 {
            [DllImport("user32.dll")]
            public static extern bool SetForegroundWindow(IntPtr hWnd);
          }
"@
          $process = Get-Process | Where-Object {
            $_.MainWindowHandle -ne 0 -and ($_.MainWindowTitle -like "*$query*" -or $_.ProcessName -like "*$query*")
          } | Select-Object -First 1
          if (-not $process) {
            @{ focused = $false } | ConvertTo-Json -Compress
            return
          }
          $focused = [AikoUser32]::SetForegroundWindow($process.MainWindowHandle)
          @{ focused = $focused; title = $process.MainWindowTitle } | ConvertTo-Json -Compress
        `,
        { AIKO_WINDOW_QUERY: query }
      );
      return JSON.parse(output) as WindowFocusResult;
    },

    async sendKeys(input) {
      if (!input.keys || input.keys.length > MAX_SEND_KEYS_LENGTH || /[\r\n]/u.test(input.keys)) {
        throw new Error("invalid_keys");
      }
      await runPowerShellJson(
        `
          $keys = $env:AIKO_SEND_KEYS
          $shell = New-Object -ComObject WScript.Shell
          $shell.SendKeys($keys)
        `,
        { AIKO_SEND_KEYS: input.keys }
      );
    },

    async moveMouse(input) {
      if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x < 0 || input.y < 0) {
        throw new Error("invalid_mouse_position");
      }
      const click = input.click ?? "none";
      if (click !== "none" && click !== "left" && click !== "right") throw new Error("invalid_mouse_click");
      await runPowerShellJson(
        `
          $x = [int]$env:AIKO_MOUSE_X
          $y = [int]$env:AIKO_MOUSE_Y
          $click = $env:AIKO_MOUSE_CLICK
          Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          public class AikoMouse {
            [DllImport("user32.dll")]
            public static extern bool SetCursorPos(int X, int Y);
            [DllImport("user32.dll")]
            public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
          }
"@
          [AikoMouse]::SetCursorPos($x, $y) | Out-Null
          if ($click -eq "left") {
            [AikoMouse]::mouse_event(2, $x, $y, 0, 0)
            [AikoMouse]::mouse_event(4, $x, $y, 0, 0)
          } elseif ($click -eq "right") {
            [AikoMouse]::mouse_event(8, $x, $y, 0, 0)
            [AikoMouse]::mouse_event(16, $x, $y, 0, 0)
          }
        `,
        {
          AIKO_MOUSE_X: String(Math.trunc(input.x)),
          AIKO_MOUSE_Y: String(Math.trunc(input.y)),
          AIKO_MOUSE_CLICK: click
        }
      );
    }
  };
}

// 运行内部 PowerShell 自动化脚本, 参数通过环境变量注入以避免拼接用户输入.
function runPowerShellJson(script: string, env: Record<string, string> = {}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      env: { ...process.env, ...env },
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `powershell_exit_${exitCode}`));
    });
  });
}

// 生成截图文件名里的稳定时间戳.
function formatTimestamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/u, "Z");
}
