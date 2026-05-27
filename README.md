# Aiko Desktop Pet

Aiko 是一个面向 Windows 的本地桌宠助手原型。它不是 OpenClaw 那种大而全的系统级 Agent, 目前目标更明确: 做一个常驻桌面, 有二次元角色形象, 能对话, 有长期记忆, 能在用户确认后执行低风险 Windows 操作的本地助手。

当前项目重点是先把 Agent 基础, 权限边界, 记忆系统, 桌宠 UI 和云端语音链路跑稳。ASR 已切到腾讯云一句话识别, TTS 已切到腾讯云语音合成超自然大模型音色。

## 当前能做什么

已经实现:

- Electron 桌面窗口, 用于承载桌宠和输入控件。
- React + TypeScript 渲染层。
- VRM 角色渲染路线: Three.js + `@pixiv/three-vrm`。
- LangChain Agent Runtime。
- Planner / Retriever / Executor 三层 Agent 结构。
- ResearchAgent / MemoryAgent 子 Agent 边界, 用于拆分外部资料检索和长期记忆读写。
- ExperiencePolicy 隐式体验策略, 会根据用户后续语气推断短期回复调整方向。
- GLM OpenAI-compatible API 接入。
- 文本聊天。
- 图片附件入口。
- 默认麦克风录音入口。
- 腾讯云 ASR provider, 用于把 WAV 录音附件转成 transcript。
- 腾讯云 TTS provider, 默认使用超自然大模型音色 `603007 邻家女孩`。
- 本地长期记忆, 使用 Node 24 内置 `node:sqlite`。
- 对话结束后的静默记忆候选提取。
- 记忆面板, 可以查看, 接受或忽略待确认记忆。
- 本地动作确认流, Agent 只提出动作, 不直接执行 Windows 操作。
- LangGraph HITL 审批流, 确认, 取消, 已记住授权和应用选择都会进入 interrupt/resume 链路。
- 低风险动作: 打开应用, 打开 URL, 网页搜索, 创建相对时间提醒。
- 授权记忆: 用户确认并选择记住后, 同类低风险动作后续可直接执行。
- 长回复自动落盘: Aiko 会把规划, 报告, 长篇分析等内容写入桌面 `Aiko` 文件夹的带时间戳 Markdown 文件。
- Agent Trace, 状态时间线和体验信号调试面板, 用于排查 Retriever, Planner, Executor, worker 和模型调用链路。

暂未实现:

- zero-shot voice cloning。
- 窗口控制, 截图分析, 键鼠自动化。
- 高风险 Windows 自动化的完整产品化后台。
- 多角色系统。

## 技术栈

- Electron
- React
- TypeScript
- LangChain v1
- GLM OpenAI-compatible API
- Node 24 `node:sqlite`
- `sqlite-vec`
- Three.js
- `@pixiv/three-vrm`
- Vitest

## 环境要求

- Windows
- Node.js 24 或更高版本
- npm
- GLM API Key

项目使用 Node 24 内置的 `node:sqlite`, 所以不要降到旧 Node 版本。

## 快速启动

安装依赖:

```bash
npm install
```

准备环境变量:

```bash
copy .env.example .env
```

`.env` 示例:

```env
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GLM_MODEL=glm-4.6v-flash
GLM_FALLBACK_MODELS=glm-4v-flash
GLM_API_KEY=replace-with-your-api-key

MCP_TAVILY_ENABLED=false
MCP_TAVILY_MODE=stdio
MCP_TAVILY_PACKAGE=tavily-mcp@0.2.19
MCP_TAVILY_REMOTE_URL=https://mcp.tavily.com/mcp/
MCP_TAVILY_MAX_RESULTS=5
MCP_TAVILY_TIMEOUT_MS=15000
TAVILY_API_KEY=replace-with-your-tavily-api-key
TAVILY_API_KEYS=replace-with-key-1,replace-with-key-2,replace-with-key-3

TENCENTCLOUD_SECRET_ID=replace-with-your-tencent-secret-id
TENCENTCLOUD_SECRET_KEY=replace-with-your-tencent-secret-key
TENCENTCLOUD_REGION=ap-shanghai

AIKO_ASR_ENABLED=false
AIKO_ASR_PROVIDER=tencent-cloud
AIKO_ASR_ENGINE_MODEL_TYPE=16k_zh
AIKO_ASR_VOICE_FORMAT=wav
AIKO_ASR_LANGUAGE=zh
AIKO_ASR_TIMEOUT_MS=30000

AIKO_TTS_ENABLED=false
AIKO_TTS_PROVIDER=tencent-cloud
AIKO_TTS_VOICE_TYPE=603007
AIKO_TTS_VOICE_NAME=邻家女孩
AIKO_TTS_FORMAT=wav
AIKO_TTS_SAMPLE_RATE=24000
AIKO_TTS_TIMEOUT_MS=30000
```

`GLM_MODEL` 是主模型, `GLM_FALLBACK_MODELS` 是备用模型列表, 多个模型可以用逗号分隔。
当主模型返回 429 或访问量过大时, Aiko 会在 LangChain Runtime 内自动切到备用模型。
`MCP_TAVILY_ENABLED=true` 后会启用 Tavily MCP 网页检索。默认使用本地 stdio 模式, 通过 `npx -y tavily-mcp@0.2.19` 启动 MCP server, API key 只通过环境变量传给子进程。
如果有多个 Tavily key, 优先填写 `TAVILY_API_KEYS`, 用逗号分隔。Aiko 会按顺序尝试, 当前 key 搜索失败时关闭旧 MCP client 并切到下一个 key。`TAVILY_API_KEY` 仍保留为单 key 兼容配置。

启动开发模式:

```bash
npm run dev
```

常用检查:

```bash
npm run typecheck
npm test
npm run build
```

## 项目结构

```text
assets/vrm/Aiko.vrm                 默认 VRM 测试模型
src/main/index.ts                   Electron 主进程入口
src/main/ipc/handlers.ts            Renderer 和主进程之间的 IPC 边界
src/main/agent/aikoAgentRuntime.ts  LangChain Agent Runtime
src/main/agent/graph/               LangGraph Functional API 工作流边界
src/main/agent/mcp/                 MCP 外部能力接入层, 当前包含 Tavily 搜索 provider
src/main/agent/subagents/           ResearchAgent 和 MemoryAgent 子 Agent 边界
src/main/agent/retriever/           记忆, 附件, 语音上下文和工具提示整理
src/main/agent/experience/          用户语气分析和短期体验策略
src/main/agent/planner/             意图判断和计划生成
src/main/agent/executor/            把计划转换成待确认动作或阻断结果
src/main/actions/                   本地动作执行器
src/main/memory/                    记忆候选提取和分类
src/main/database/                  SQLite 数据库和 Repository
src/renderer/App.tsx                桌宠主界面
src/renderer/components/            输入框, 面板, 确认框等 UI 组件
src/renderer/character/             VRM 角色渲染器
人物设定.md                         Aiko 的角色人格和提示词设定
docs/人物UI.md                      角色 UI 和人物模型路线说明
```

## Agent 架构

Aiko 的 Agent 不是让模型直接接管电脑。当前链路是:

```text
Renderer
  -> IPC Handler
  -> AikoAgentRuntime
  -> Retriever
  -> ResearchAgent / MemoryAgent
  -> ExperiencePolicy
  -> Planner
  -> Executor
  -> LangChain Agent
  -> Pending Action
  -> User Confirmation
  -> Local Action Executor
```

关键规则:

- Renderer 只负责交互, 不直接执行本地能力。
- IPC Handler 是主进程能力入口, 负责输入校验和动作确认。
- Retriever 负责整理上下文, 例如长期记忆, 图片摘要, 语音识别结果和工具提示。
- ResearchAgent 负责 Tavily MCP 网页检索和 Open-Meteo 天气 grounding, 结果只作为资料注入上下文。
- MemoryAgent 负责长期记忆召回, 回复后静默整理记忆候选, 并把写入失败降级为不影响聊天。
- ExperiencePolicy 负责从用户语气中推断短期体验信号, 例如"太啰嗦了","不是这个意思","现在可以了"。这些信号只影响后续回复策略, 不会被当成长期事实。
- Planner 先尝试用确定性逻辑识别简单命令, 比如打开应用和创建提醒。
- Executor 只生成待确认动作或阻断结果。
- LangChain tools 只能生成待确认动作, 不能直接执行 Windows 操作。
- MCP tools 只能作为外部资料能力接入, 当前 Tavily 搜索会先进入 Retriever, 再作为不可信网页资料注入模型上下文。
- 真正执行本地动作只能走 `src/main/actions/actionExecutor.ts`。

这个结构是为了减少幻觉带来的误执行风险。模型可以建议, 但不能越过权限层。

## 体验策略

Aiko 当前没有显式的"满意 / 不满意"反馈按钮。她会通过 `src/main/agent/experience/` 里的规则型分析器观察用户后续语气, 形成短期体验策略:

- 用户说"你刚才太啰嗦了","不是这个意思"时, 会记录为一次隐式体验信号。
- 用户说"现在可以了","这个回复挺好"时, 会记录为一次正向体验信号。
- 用户只是提出当前任务要求, 例如"帮我写一份短一点的学习计划", 不会被误判成不满意。
- 体验信号只保存在运行期, 用于调整后续回复风格, 不会直接写入长期记忆。
- Retriever 会把体验策略作为"非指令上下文"注入模型, 明确要求如果与当前输入冲突, 以当前输入优先。
- Agent 调试面板会显示最近体验信号, 方便排查 Aiko 为什么突然变得更短, 更谨慎或更直接。

这个设计让 Aiko 能有一点"越相处越会看气氛"的感觉, 但仍然避免把模型推断当成用户明确偏好。

## 如何自定义角色模型

默认模型路径:

```text
assets/vrm/Aiko.vrm
```

代码默认读取:

```text
src/renderer/components/PetStage.tsx
```

当前默认配置:

```ts
const AIKO_VRM_PATH = "assets/vrm/Aiko.vrm";
```

替换模型的方法:

1. 用 VRoid Studio 或其他工具导出 `.vrm` 文件。
2. 把模型放到 `assets/vrm/`。
3. 如果文件名仍然是 `Aiko.vrm`, 不需要改代码。
4. 如果文件名不同, 修改 `src/renderer/components/PetStage.tsx` 里的 `AIKO_VRM_PATH`。
5. 运行 `npm run dev` 查看效果。

注意:

- VRM 模型会通过 `/assets/...` 在开发和构建产物里访问。
- 如果模型太大, 启动和首次加载会变慢。
- 当前只有基础 idle, lookAt, expression 和口型接口, 还不是完整 VTuber 动作系统。

## 如何自定义角色性格

主要文件:

```text
人物设定.md
```

这里定义 Aiko 的人格, 说话方式, 行为边界和陪伴感。代码会在 `src/main/ai/prompts.ts` 里读取这个文件, 再和安全约束, 反幻觉规则一起组成 system prompt。

建议写清楚:

- Aiko 如何称呼用户。
- Aiko 的性格关键词。
- Aiko 的说话节奏和语气。
- 她可以主动做什么。
- 她不能主动做什么。
- 不确定时如何表达。
- 面对用户情绪时如何回应。
- 什么时候应该询问确认。
- 什么时候应该拒绝或降级。

当前目标是让 Aiko 有独立性格, 但不能为了角色感编造事实。

## 如何自定义记忆系统

相关代码:

```text
src/main/memory/
src/main/database/
src/main/agent/subagents/memoryAgent.ts
src/main/agent/retriever/
src/renderer/components/MemoryPanel.tsx
```

当前存储和索引:

- 主存储: Node 24 `node:sqlite`, 真实记忆保存在 `memories` 和 `memory_candidates` 表.
- 向量索引: 优先使用 `sqlite-vec` 的 `vec0` 虚拟表 `aiko_memory_vec_index`.
- 兼容索引: `memory_vectors` 仍保存本地稀疏向量 JSON, 当 `sqlite-vec` 扩展加载失败时自动降级.
- 当前 embedding: 本地确定性 64 维哈希向量, 后续可以替换为真实 embedding provider.

当前流程:

1. 用户和 Aiko 对话。
2. 回复完成后, MemoryAgent 在后台静默提取可能有价值的记忆候选。
3. 记忆候选会被分类。
4. 低风险记忆可以进入长期记忆, 需要确认的内容进入待确认列表。
5. 后续对话前, Retriever 通过 MemoryAgent 根据用户输入召回相关记忆。
6. 模型只能把记忆当成偏好和背景参考, 不能把它当成实时事实。

适合放进长期记忆的内容:

- 用户希望 Aiko 如何称呼自己。
- 用户长期偏好。
- 用户常用软件。
- 用户项目背景。
- 用户明确表达过的稳定习惯。

不适合直接写入的内容:

- 一次性的临时情绪。
- 未确认的敏感信息。
- 模型猜测出来的事实。
- 和当前任务无关的隐私内容。

## 如何自定义体验策略

相关代码:

```text
src/main/agent/experience/toneFeedback.ts
src/main/agent/experience/experiencePolicy.ts
src/main/agent/retriever/aikoRetriever.ts
src/renderer/components/AgentDebugPanel.tsx
```

当前策略是保守的规则型判断:

- `toneFeedback.ts` 负责从文本中判断正向, 负向, 纠错或中性语气。
- `experiencePolicy.ts` 负责保存最近的运行期体验信号, 并生成给模型看的短期回复建议。
- `aikoRetriever.ts` 会把体验策略放进模型上下文, 但会标注为"不是用户明确指令"。
- `AgentDebugPanel.tsx` 会显示最近体验信号, 方便测试时观察误判。

扩展时建议遵守:

- 不要把隐式推断直接写进长期记忆。
- 不要让体验策略覆盖用户当前明确输入。
- 不要把"短一点","详细一点"这类当前任务风格要求都误判为不满意。
- 如果以后接入模型型语气分析, 仍然要保留规则校验和置信度阈值。

## 如何扩展本地能力

新增一个本地能力时, 按这个顺序做:

1. 在 `src/main/agent/tools/toolRegistry.ts` 增加工具元信息。
2. 在 `src/main/agent/planner/aikoPlanner.ts` 决定什么时候生成计划。
3. 在 `src/main/agent/executor/aikoExecutor.ts` 把计划转换成待确认动作。
4. 在 `src/main/actions/actionExecutor.ts` 实现真正的本地执行。
5. 在权限系统里定义风险等级和授权策略。
6. 增加测试。

风险分层建议:

- `low`: 打开应用, 打开 URL, 创建普通提醒。
- `medium`: 读取剪贴板, 截图, 读取用户明确指定的文件。
- `high`: 写文件, 删除文件, 执行命令。
- `critical`: 批量文件操作, 系统设置修改, 高权限自动化。

当前版本默认只开放低风险能力。高风险动作先不要直接接入执行链路。

## 多模态输入状态

当前支持:

- 文本输入。
- 图片附件。
- 麦克风录音附件。

当前限制:

- 图片可以进入多模态输入结构。
- 录音会先封装成 WAV 附件, 再进入腾讯云 ASR provider, 前提是 `AIKO_ASR_ENABLED=true` 且腾讯云密钥已配置。
- 没有 ASR 服务时, Aiko 不会假装听懂语音, 会明确把语音理解失败传进上下文。
- 回复语音优先走腾讯云 TTS provider, 默认音色为超自然大模型音色 `603007 邻家女孩`。
- TTS provider 不可用时, renderer 会回退到浏览器 Web Speech API。
- 设置面板会检查腾讯云 ASR/TTS 是否已启用且密钥完整, 不会为了探活额外发起付费识别或合成请求。
- zero-shot voice cloning 还没有正式接入音色管理和训练流程。

后续推荐顺序:

1. 填写腾讯云 SecretId 和 SecretKey, 验证录音附件转 transcript。
2. 开启腾讯云 TTS, 验证回复播放和打断。
3. 按 Aiko 的角色设定微调音色编号, 语速和采样率。
4. 最后再接 zero-shot voice cloning 的参考音频和音色管理。

## 安全边界

当前项目刻意保守:

- `.env` 不应提交到仓库。
- API Key 不应写入 README, 测试, 截图或日志。
- Agent 不直接执行 Windows 操作。
- 本地动作必须经过权限层。
- 未记住授权的动作必须用户确认。
- 用户取消待确认动作时会恢复审批会话并写入 reject 决策, 不会留下悬挂的执行状态。
- 待确认动作有过期时间。
- 高风险动作默认阻断。
- 模型输出不能直接当作命令执行。

## 常见问题

### 为什么我换了 VRM 但没显示?

检查三件事:

1. 文件是否存在于 `assets/vrm/Aiko.vrm`。
2. `src/renderer/components/PetStage.tsx` 里的路径是否一致。
3. 控制台是否有 VRM 加载错误。

如果模型加载失败, 项目会退回 fallback renderer, 这样 UI 不会直接白屏。

### 为什么发语音 Aiko 没真正理解?

请先确认 `.env` 中 `AIKO_ASR_ENABLED=true`, 并且 `TENCENTCLOUD_SECRET_ID` 与 `TENCENTCLOUD_SECRET_KEY` 已配置。没有 ASR 密钥时, Aiko 会明确知道语音理解未配置, 不会编造录音内容。

### 为什么有些 Windows 操作不能做?

这是刻意设计。当前阶段只打通低风险能力, 例如打开应用, 打开网页和创建提醒。文件写入, 删除, Shell 命令和系统设置修改会放到后续权限系统更成熟之后。

### 为什么不用 Live2D?

当前推荐路线已经切到 VRM + Three.js + `@pixiv/three-vrm`。理由是 VRM 更适合 3D 桌宠, 可用 VRoid Studio 直接制作模型, 后续也更容易接 lookAt, 表情, 口型和动作系统。

## 许可证

本项目使用 MIT License。创作者: Sakura_Cianna。详见 [LICENSE](./LICENSE)。
