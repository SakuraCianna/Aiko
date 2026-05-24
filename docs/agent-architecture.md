# Aiko Agent Architecture

## Current Decision

Aiko 的 Agent 编排层已经迁移到 LangChain v1。后续 Agent 能力必须以
`src/main/agent/aikoAgentRuntime.ts` 为入口扩展，不要重新引入旧的直连 `glmClient`、
`intentRouter`，也不要把模型编排逻辑分散到 IPC handler。

当前 `createAgent` 返回的是 LangGraph-backed ReactAgent。第一阶段已经完成
Planner / Retriever / Executor 拆分。第二阶段开始引入显式 LangGraph Functional API
工作流边界: `src/main/agent/graph/aikoAgentWorkflow.ts` 负责串联 retrieve, plan,
prepare 三个生命周期节点。状态边界仍由 runtime 统一管理, 具体职责分散到 `src/main/agent/retriever`,
`src/main/agent/planner`, `src/main/agent/executor`, `src/main/agent/tools`
和 `src/main/agent/trace`。后续如果需要持久化 checkpoint 或 human-in-the-loop interrupt,
应继续沿着 `src/main/agent/graph` 扩展, 不要把 graph 状态散落到 IPC 层。

`AikoAgentWorkflow` 当前支持两种确认模式：

- `passive`: 默认模式, workflow 会为 pending action 生成 `pending_action_review` payload,
  但仍交给现有 IPC pending action 流程和确认弹窗处理。
- `interrupt`: 可恢复审批模式, workflow 会用 LangGraph `interrupt` 暂停 pending action,
  runtime 会把 thread id 附加到 `PendingActionDto.approval`。IPC 确认执行前会调用
  `resumePendingActionApproval()` 恢复 workflow, 再交给 `ActionExecutor` 调用本地能力。
  当前默认仍是 `passive`, 便于保持用户侧交互稳定。

## Runtime Boundary

`src/main/agent/aikoAgentRuntime.ts` 是唯一允许直接导入 LangChain Agent 相关包的运行时边界：

- `langchain`
- `@langchain/openai`
- `@langchain/core`

主进程入口 `src/main/index.ts` 只负责创建 `AikoAgentRuntime`。IPC 层
`src/main/ipc/handlers.ts` 只负责输入校验、权限记忆、流式事件转发和调用 runtime，不直接接触
provider SDK、LangChain tool 或模型实例。

## Execution Policy

LangChain Agent 可以推理、规划、选择工具和生成待确认动作，但不能直接执行 Windows 系统操作。
所有系统操作都必须继续走这条链路：

1. Agent 生成 `PendingActionDto`
2. IPC handler 交给权限规则判断是否已记住授权
3. 未授权时由用户确认
4. 确认后交给 `ActionExecutor` 执行

新增工具时，工具只应该返回待确认动作或纯信息结果，不要在 LangChain tool 内调用 `openUrl`、
`openApplication`、文件系统写入、shell 命令或其他高权限能力。

## Current Agent Capabilities

- 文本输入进入 LangChain Agent。
- 图片附件作为多模态 `image_url` 进入模型。
- 麦克风录音先保留为语音理解 provider 接口，暂不接真实 ASR。
- 回复支持 IPC 流式 delta，最终仍返回完整 `ChatResponse`。
- 简单高频命令先走确定性规则：打开应用、打开 URL、网页搜索、分钟/小时提醒。
- 需要模型判断的动作通过 LangChain tools 生成待确认动作。
- 长期记忆在回复前召回，回复后抽取 memory candidate 并写入 SQLite。
- pending memory 已经提供 UI 确认入口。
- 当前对话上下文是 runtime 内存态短期窗口, 默认保留最近 12 条消息, 注入模型时最多 6000 字符。
- 用户可以在聊天面板点击“开启新对话”, 或直接说“开启新对话/清空上下文”来清空短期上下文。
- 清空当前对话不会删除长期记忆, 权限规则, 默认应用偏好或提醒。
- Tool Registry 已统一记录 `open_application`, `open_url`, `web_search`,
  `create_reminder`, `recall_memory`, `list_reminders` 的工具元信息。
- Agent Trace 当前是内存记录器, 用于调试请求生命周期。

## Layer Split

当前主链路：

1. `AikoAgentRuntime` 接收 chat payload。
2. `AikoAgentWorkflow` 作为 LangGraph Functional API 工作流串联请求生命周期。
3. `AikoRetriever` 召回记忆, 整理附件, 语音结果和工具提示。
4. `AikoPlanner` 先处理确定性本地计划。
5. `AikoExecutor` 将结构化计划转换为待确认动作或阻断结果。
6. Workflow review 节点把待确认动作转换成人审 payload, 默认保持 passive 兼容模式, 可选启用 interrupt + resume 审批链路。
7. 无确定性计划时, runtime 调用 LangChain Agent。
8. LangChain tools 只生成待确认动作, 不执行本地系统操作。
9. 回复后进入静默记忆候选抽取。
10. 普通聊天回复会写入短期上下文窗口, 下一轮模型调用会带上这个窗口。

短期上下文和长期记忆分开计算：

- 短期上下文只保存在当前运行时内存中, 用于“刚才说到哪了”的连续性。
- 长期记忆保存在 SQLite 中, 只保存通过记忆策略筛选后的偏好, 习惯, 软件等候选。
- Retriever 只召回长期记忆, Runtime 再叠加短期上下文。
- 开启新对话只清短期上下文和待确认动作, 不动长期记忆。

第一阶段已完成：

- `src/main/agent/retriever`
- `src/main/agent/planner`
- `src/main/agent/executor`
- `src/main/agent/tools`
- `src/main/agent/trace`
- `tests/agent/aikoRetriever.test.ts`
- `tests/agent/aikoPlanner.test.ts`
- `tests/agent/aikoExecutor.test.ts`
- `tests/agent/toolRegistry.test.ts`
- `tests/agent/aikoTrace.test.ts`

仍属于后续路线：

- 真实 ASR。
- TTS 和 zero-shot voice cloning。
- Model Adapter。
- 数据库持久化 Agent Trace。
- LangGraph checkpoint 持久化。
- 将 `interrupt` 审批模式从可选项提升为默认值, 并为拒绝/取消弹窗补齐 `reject` resume 链路。
- 更细的 Memory Policy。
- 更高风险的 Windows 能力。
- 更复杂的 LangGraph 多节点工作流和 subgraph。

## Extension Rules

新增 Agent 能力时优先采用以下方式：

- 简单高频命令：扩展 `src/main/agent/planner/aikoPlanner.ts`。
- 需要模型判断的能力：扩展 Tool Registry 和 `createAikoTools`。
- 需要多步状态的能力：优先扩展 `src/main/agent/graph/aikoAgentWorkflow.ts` 或新增 graph/subgraph。
- 长期记忆：通过 Retriever 注入召回结果；回复后抽取候选并写入 SQLite。
- 多模态：统一由 Retriever 组装进 LangChain message content。
- 音频输入：先走 `SpeechUnderstandingProvider` 得到 transcript，再交给 Agent。
- 语音输出：TTS 和 zero-shot voice cloning 属于回复发声链路，放在后续 voice provider 中扩展。

不要重新引入以下旧结构：

- `src/main/ai/glmClient.ts`
- `src/main/ai/intentRouter.ts`
- IPC handler 内直接调用模型
- 工具内直接执行 Windows 操作
- 把 TTS 或 voice cloning 当作用户音频输入理解入口

## Guardrails

`tests/agent/agentArchitectureBoundary.test.ts` 会检查：

- 主链路包含 `createAikoAgentRuntime`
- Agent runtime 使用 LangChain `createAgent`
- Agent runtime 通过 `createAikoAgentWorkflow` 进入显式 LangGraph 工作流边界
- 旧 `createGlmClient` / `routeIntent` 没有回到运行时代码
- LangChain provider import 只存在于 agent runtime 边界
- 本文档存在并声明后续扩展规则
