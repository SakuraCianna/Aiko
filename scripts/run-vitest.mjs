import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const vitestEntry = resolve(currentDir, "..", "node_modules", "vitest", "vitest.mjs");
const disableExperimentalWarning = "--disable-warning=ExperimentalWarning";
const currentNodeOptions = process.env.NODE_OPTIONS?.trim();

// 拼接 NODE_OPTIONS, 只屏蔽 node:sqlite 带来的实验性警告.
const nodeOptions = currentNodeOptions?.includes(disableExperimentalWarning)
  ? currentNodeOptions
  : [currentNodeOptions, disableExperimentalWarning].filter(Boolean).join(" ");

// 通过 Node 入口启动 Vitest, 让 worker 子进程继承相同的警告配置.
const child = spawn(process.execPath, [vitestEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptions
  }
});

// 同步子进程退出状态, 保持 npm test 的失败语义.
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

// 输出启动失败原因, 避免测试入口静默失败.
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
