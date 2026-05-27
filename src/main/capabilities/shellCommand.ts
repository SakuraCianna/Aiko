import { spawn } from "node:child_process";

export type ShellCommandRequest = {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  outputLimit?: number;
};

export type ShellCommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type ShellCommandRunner = (request: ShellCommandRequest) => Promise<ShellCommandResult>;

const MAX_COMMAND_LENGTH = 2000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_OUTPUT_LIMIT = 12_000;
const MAX_OUTPUT_LIMIT = 40_000;
const BLOCKED_COMMAND_PATTERN =
  /\b(Remove-Item|rm|del|erase|rmdir|Format-Volume|Clear-Disk|Remove-Partition|Set-ExecutionPolicy|shutdown|Restart-Computer|Stop-Computer)\b/i;
const BLOCKED_SHELL_SYNTAX_PATTERN = /[;&|><`]/;
const SENSITIVE_SHELL_TARGET_PATTERN = /(^|[\\/.\s])(\.env(?:\.\w+)?|\.npmrc|id_rsa|id_ed25519)(?=$|[\\/.\s])/i;
const READ_ONLY_COMMAND_ALLOWLIST = new Set([
  "get-childitem",
  "get-command",
  "get-item",
  "get-location",
  "get-process",
  "get-service",
  "resolve-path",
  "test-path"
]);

export type ShellCommandValidationResult =
  | { ok: true; request: Required<Pick<ShellCommandRequest, "command" | "timeoutMs" | "outputLimit">> & { cwd?: string } }
  | { ok: false; reason: "invalid_command" | "blocked_command" | "not_allowlisted" | "invalid_timeout" | "invalid_output_limit" };

// 校验模型提出的 PowerShell 命令, 在进入真实系统调用前挡住危险命令.
export function validateShellCommandRequest(request: ShellCommandRequest): ShellCommandValidationResult {
  const command = request.command.trim();
  if (!command || command.length > MAX_COMMAND_LENGTH) return { ok: false, reason: "invalid_command" };
  if (BLOCKED_COMMAND_PATTERN.test(command)) return { ok: false, reason: "blocked_command" };
  if (BLOCKED_SHELL_SYNTAX_PATTERN.test(command)) return { ok: false, reason: "blocked_command" };
  if (SENSITIVE_SHELL_TARGET_PATTERN.test(command)) return { ok: false, reason: "blocked_command" };
  if (!isAllowlistedReadOnlyCommand(command)) return { ok: false, reason: "not_allowlisted" };

  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    return { ok: false, reason: "invalid_timeout" };
  }

  const outputLimit = request.outputLimit ?? DEFAULT_OUTPUT_LIMIT;
  if (!Number.isInteger(outputLimit) || outputLimit <= 0 || outputLimit > MAX_OUTPUT_LIMIT) {
    return { ok: false, reason: "invalid_output_limit" };
  }

  return {
    ok: true,
    request: {
      command,
      cwd: request.cwd,
      timeoutMs,
      outputLimit
    }
  };
}

// 只允许明确的只读 PowerShell cmdlet, 避免模型把任意 shell 一行脚本塞进执行器.
function isAllowlistedReadOnlyCommand(command: string) {
  const commandName = command.match(/^([A-Za-z][A-Za-z0-9-]*)\b/)?.[1];
  return Boolean(commandName && READ_ONLY_COMMAND_ALLOWLIST.has(commandName.toLowerCase()));
}

// 创建受控 PowerShell 运行器, 只执行已经通过校验和用户确认的命令.
export function createPowerShellCommandRunner(): ShellCommandRunner {
  return (request) => {
    const validated = validateShellCommandRequest(request);
    if (!validated.ok) throw new Error(validated.reason);

    return new Promise<ShellCommandResult>((resolve, reject) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", validated.request.command], {
        cwd: validated.request.cwd,
        windowsHide: true
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        child.kill();
        resolve({
          exitCode: null,
          stdout: truncateOutput(stdout, validated.request.outputLimit),
          stderr: truncateOutput(stderr, validated.request.outputLimit),
          timedOut: true
        });
      }, validated.request.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = appendLimited(stdout, chunk.toString("utf8"), validated.request.outputLimit);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = appendLimited(stderr, chunk.toString("utf8"), validated.request.outputLimit);
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode,
          stdout: truncateOutput(stdout, validated.request.outputLimit),
          stderr: truncateOutput(stderr, validated.request.outputLimit),
          timedOut: false
        });
      });
    });
  };
}

// 追加输出时保留尾部内容, 避免大输出撑爆 IPC 消息.
function appendLimited(current: string, next: string, limit: number) {
  return truncateOutput(current + next, limit);
}

// 截断命令输出, 让执行结果保持可读且不会过大.
function truncateOutput(text: string, limit: number) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[output truncated]`;
}
