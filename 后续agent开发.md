# 后续 Agent 开发

## 目标

Aiko 的 Agent 后续开发重点不是快速堆功能, 而是把本地助手能力做成稳定, 可追踪, 可扩展的系统.当前项目已经具备 LangChain Agent, GLM 兼容模型, 长期记忆, 权限规则, 本地动作执行, 图片输入和麦克风录音入口.下一阶段要把这些能力从单一 runtime 中拆成清晰的三层架构:

- Planner: 理解用户意图, 生成可审计计划.
- Retriever: 召回记忆, 会话上下文和外部上下文.
- Executor: 在权限规则约束下执行本地动作.

这个拆分的核心原则是: 模型可以参与判断和计划, 但不能绕过权限系统直接操作 Windows.

## 当前阶段

当前 Agent 的主要入口是 `src/main/agent/aikoAgentRuntime.ts`.它已经完成了这些事情:

- 使用 LangChain `createAgent` 接入 GLM 兼容模型.
- 使用 `buildAikoSystemPrompt` 注入 Aiko 人格, 安全约束和反幻觉提示.
- 在回复前召回长期记忆.
- 在回复后静默抽取记忆候选.
- 对简单高频命令使用确定性规则处理.
- 对复杂命令通过 LangChain tools 生成 `PendingActionDto`.
- 将真正的本地执行交给 `ActionExecutor`.
- 将授权判断交给权限系统和 IPC 确认链路.
- 图片附件已经进入多模态输入.
- 语音附件目前只保留语音理解 provider 入口, 尚未接真实 ASR.

当前主要问题是职责仍然集中在 runtime 中.随着能力扩展, 如果继续把检索, 规划, 工具选择, 权限判断, 回复生成都塞进一个文件, 后续调试会变困难.

## 三层架构

### Retriever

Retriever 负责为一次 Agent 请求准备上下文.它不决定要不要执行动作, 也不直接生成最终回复.

职责:

- 从长期记忆中召回和当前输入相关的内容.
- 整理当前会话历史.
- 整理图片, 音频, 附件摘要.
- 整理可用工具列表和工具元信息.
- 对召回内容加上来源, 类型, 置信度和时效提示.
- 控制上下文长度, 避免把无关记忆塞给模型.

建议接口:

```ts
export type RetrievedContext = {
  userText: string;
  attachmentSummaries: AttachmentSummary[];
  memories: RetrievedMemory[];
  conversationFacts: ConversationFact[];
  toolHints: ToolHint[];
};

export type AikoRetriever = {
  retrieve(input: RetrieverInput): Promise<RetrievedContext>;
};
```

Retriever 需要优先增强长期记忆能力.建议把记忆拆成四类:

- Profile Memory: 用户长期偏好, 例如称呼, 工作习惯, 常用软件.
- Relationship Memory: Aiko 和用户之间形成的互动习惯.
- Project Memory: 当前项目和任务上下文.
- Episodic Memory: 最近发生过的重要事件.

后续增强点:

- 增加记忆置信度.
- 增加记忆来源消息.
- 增加记忆过期策略.
- 增加记忆冲突处理.
- 增加用户可编辑和删除记忆能力.
- 增加召回 trace, 记录为什么召回某条记忆.

### Planner

Planner 负责把用户请求和 Retriever 上下文转成明确计划.它可以调用模型, 也可以先走确定性规则.

职责:

- 判断用户是在聊天, 请求解释, 请求系统动作, 还是请求日程/提醒.
- 判断是否需要工具.
- 生成一个结构化计划.
- 给每个计划步骤标注风险等级.
- 判断哪些步骤需要用户确认.
- 生成给用户看的自然语言回复草案.
- 在信息不足时提出澄清问题, 不编造缺失事实.

建议接口:

```ts
export type AikoPlan = {
  mode: "chat" | "action" | "clarify" | "mixed";
  replyDraft: string;
  steps: AikoPlanStep[];
  grounding: GroundingNote[];
};

export type AikoPlanner = {
  plan(input: PlannerInput): Promise<AikoPlan>;
};
```

Planner 的关键约束:

- 不允许直接调用 Windows 能力.
- 不允许直接写数据库权限.
- 不允许把模型输出当作已执行事实.
- 不允许在 ASR 未接入时假装听懂音频.
- 不允许把长期记忆当作实时事实.

Planner 内部可以继续保留两条路径:

- Deterministic Planner: 处理打开应用, 打开 URL, 简单提醒等高频命令.
- LLM Planner: 处理需要模型理解的复杂请求.

这样做可以减少大模型调用, 降低延迟, 也能降低简单任务的幻觉概率.

### Executor

Executor 负责执行已经通过权限检查的动作.它只接受结构化 plan step 或 action request, 不接受自由文本命令.

职责:

- 校验动作参数.
- 检查风险等级.
- 查询权限规则.
- 对未授权动作返回确认请求.
- 对已授权动作调用本地能力.
- 返回标准执行结果.
- 记录执行 trace.

建议接口:

```ts
export type AikoExecutor = {
  prepare(plan: AikoPlan): Promise<ExecutionProposal>;
  execute(request: ExecuteActionRequest): Promise<ExecuteActionResponse>;
};
```

Executor 的规则:

- Low risk: 已记住授权时可以直接执行.
- Medium risk: 默认需要确认, 可按能力和目标记住授权.
- High risk: 当前阶段不执行.
- Critical risk: 当前阶段不进入实现范围.

本地能力应该统一通过 Tool Registry 暴露, 而不是散落在多个文件里.

## 推荐数据流

```text
Renderer
  -> IPC handler
  -> AikoRuntime
  -> Retriever.retrieve()
  -> Planner.plan()
  -> Executor.prepare()
  -> IPC confirmation if needed
  -> Executor.execute()
  -> Response + Trace + Memory candidate
```

一次普通聊天:

```text
用户输入
  -> Retriever 召回记忆
  -> Planner 判断为 chat
  -> 生成回复
  -> 记忆抽取
  -> 返回消息
```

一次打开应用:

```text
用户输入: 打开 Chrome
  -> Retriever 准备上下文
  -> Planner 生成 open_application plan
  -> Executor.prepare 判断是否已授权
  -> 未授权则请求用户确认
  -> 用户确认
  -> Executor.execute 打开应用
  -> 返回执行结果
```

## Tool Registry

后续所有工具建议注册到统一 Tool Registry.每个工具都应该声明自己的元信息和执行边界.

建议结构:

```ts
export type AikoToolDefinition = {
  name: string;
  description: string;
  capability: string;
  risk: "low" | "medium" | "high" | "critical";
  requiresConfirmation: boolean;
  schema: unknown;
  planOnly: boolean;
};
```

第一阶段工具:

- `open_application`: 打开已配置应用.
- `open_url`: 打开网页.
- `web_search`: 用默认浏览器搜索.
- `create_reminder`: 创建本地提醒.
- `recall_memory`: 查询长期记忆.
- `list_reminders`: 查询提醒.

第二阶段工具:

- `read_clipboard`: 读取剪贴板.
- `write_clipboard`: 写入剪贴板.
- `screenshot`: 截图并交给多模态模型理解.
- `file_search`: 在用户指定目录搜索文件.
- `file_open`: 打开用户指定文件.

第三阶段工具:

- `file_write`: 写入文件.
- `shell_command`: 执行命令.
- `system_setting`: 调整系统设置.

第三阶段工具默认高风险, 不进入早期实现.

## Agent Trace

Agent Trace 是下一阶段最重要的基础设施之一.没有 trace, 后续 Agent 出错时很难判断是检索错了, 计划错了, 权限错了, 还是执行错了.

每次请求建议记录:

- request id.
- 用户输入文本.
- 附件摘要.
- Retriever 召回的记忆.
- Planner 使用的模型和 prompt 摘要.
- Planner 输出的结构化计划.
- 工具候选和风险等级.
- 权限判断结果.
- Executor 执行结果.
- 最终回复.
- 错误信息.
- 耗时.

Trace 默认只保存在本地数据库.后续 UI 可以做一个开发者面板, 用来查看每次 Agent 决策链路.

## 反幻觉策略

Aiko 的反幻觉不应该只靠 prompt, 需要代码层和测试层一起约束.

策略:

- Planner 必须输出结构化计划, 不允许把自然语言直接交给 Executor.
- Retriever 给记忆加上来源和时效提示.
- Executor 只信任结构化参数, 不信任模型自然语言.
- 音频没有 transcript 时, Planner 必须承认未理解.
- 工具失败时, 最终回复必须说明失败, 不能说已经完成.
- 记忆和当前输入冲突时, 当前输入优先.
- 不确定的软件, 文件, 日期, 路径必须询问或降级处理.

需要增加的测试:

- 普通聊天不应生成工具动作.
- 打开应用应生成 `open_application` plan.
- 未授权动作应进入确认流程.
- 已记住授权的低风险动作可以直接执行.
- 高风险动作必须拒绝执行.
- 图片输入应进入模型内容.
- 音频无 ASR 时不能假装听懂.
- 工具失败时不能返回成功措辞.
- 长期记忆为空时不能编造偏好.

## 多模态路线

当前可以先强化图片理解, 暂缓 ASR, TTS 和 voice cloning.

图片理解:

- 图片附件进入 Planner 的多模态输入.
- Planner 需要输出图片相关 grounding.
- 图片内容只在用户明确要求或内容明显长期有用时进入记忆候选.

语音输入:

- 当前保留录音入口和 `SpeechUnderstandingProvider`.
- 未接真实 ASR 前, 只返回未配置提示.
- 后续接 ASR 后, transcript 进入 Retriever 和 Planner.

语音输出:

- TTS 和 zero-shot voice cloning 属于回复播放链路.
- 不应该和语音理解入口混在一起.
- 后续可以设计 `VoiceOutputProvider`.

## Model Adapter

后续不要让业务逻辑直接依赖某一家模型 SDK.建议抽出模型适配层.

建议接口:

```ts
export type AikoModelClient = {
  chat(input: ChatModelInput): Promise<ChatModelOutput>;
  visionChat(input: VisionModelInput): Promise<ChatModelOutput>;
  supportsVision: boolean;
  supportsToolCalling: boolean;
  supportsJsonMode: boolean;
};
```

这样后续可以在 GLM, OpenAI, Claude, Qwen, Ollama, vLLM 之间切换, 不影响 Planner / Retriever / Executor 的主结构.

## 开发顺序

推荐优先级:

1. 增加 Agent Trace.
2. 抽出 Tool Registry.
3. 从 `aikoAgentRuntime.ts` 中拆出 Retriever.
4. 从 `aikoAgentRuntime.ts` 中拆出 Planner.
5. 让 Executor 只接受结构化 plan/action.
6. 增加 Agent 行为测试集.
7. 强化 Memory Policy.
8. 强化图片理解链路.
9. 扩展更多 Windows 本地能力.
10. 最后再接 ASR, TTS 和 voice cloning.

## 第一阶段落地范围

第一阶段不要扩展新高风险能力, 只做架构整理:

- 新增 `src/main/agent/retriever`.
- 新增 `src/main/agent/planner`.
- 新增 `src/main/agent/executor`.
- 新增 `src/main/agent/tools`.
- 新增 `src/main/agent/trace`.
- 保留现有 `ActionExecutor`, 但把它接入新的 Executor 层.
- 保留现有记忆数据库, 但通过 Retriever 访问.
- 保留现有 LangChain Agent, 但只作为 Planner 的一个实现.

第一阶段完成标准:

- `aikoAgentRuntime.ts` 只负责总编排.
- Retriever, Planner, Executor 可以独立单元测试.
- 所有工具都有统一 metadata.
- 每次 Agent 请求都有 trace.
- 现有功能行为不回退.
- `npm run typecheck`, `npm test`, `npm run build` 全部通过.

## 非目标

这些事情暂时不做:

- 不接真实 ASR.
- 不接 TTS.
- 不接 voice cloning.
- 不开放 shell 命令执行.
- 不做文件写入.
- 不做系统设置修改.
- 不做多角色系统.
- 不把模型规划结果直接当作本地执行命令.

## 架构判断

Aiko 更适合走小而稳的本地 Agent 架构, 而不是一开始做成超大型通用 Agent.Planner / Retriever / Executor 三层拆开后, 后续无论是加 Windows 能力, 加更强记忆, 还是换模型 provider, 都能在清晰边界里扩展.

短期目标是让 Aiko 成为一个可控的本地助手.长期目标才是让她逐步拥有更主动, 更自然, 更有陪伴感的桌宠行为.

