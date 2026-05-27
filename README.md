# Aiko Desktop Pet

Aiko 是一个面向 Windows 的本地助手型桌宠原型。它的目标不是做成无限制的系统级 Agent, 而是先做好一个常驻桌面, 有单一角色形象, 能对话, 能记住长期偏好, 能在用户确认后执行受控 Windows 操作的陪伴式助手。

当前路线:

- 桌宠外壳: Electron + React + TypeScript
- 人物模型: VRM + Three.js + `@pixiv/three-vrm`
- Agent 架构: LangChain + LangGraph, 按 Retriever / Planner / Executor 拆层
- 本地能力: Node 主进程系统桥 + 权限规则 + 动作审计
- 记忆系统: Node 24 `node:sqlite` + `sqlite-vec` 兼容向量索引
- 语音链路: 腾讯云 ASR/TTS, 目前是录音片段提交和回复播放, 还不是完整低延迟双工语音

## 当前能力

已实现:

- Electron 桌宠窗口和管理面板
- React 渲染层, 输入框, 附件, 麦克风录音入口
- VRM 模型加载, lookAt, 基础动作状态和 Agent 状态联动
- LangChain Agent Runtime
- LangGraph 审批流, 支持确认, 取消, resume 和持久化 checkpoint
- Planner / Retriever / Executor 三层结构
- ResearchAgent / MemoryAgent 子 Agent 边界
- Tavily MCP 网页搜索, 仅在用户明确要求最新新闻或网页搜索时使用
- Open-Meteo 天气工具
- GLM OpenAI-compatible 模型调用, 支持 fallback 模型路由
- 长期记忆候选提取, 记忆面板确认, SQLite 存储和向量召回
- 体验信号分析, 根据用户语气做短期回复策略调整
- 打开应用, 打开 URL, 创建提醒, 取消最近提醒
- 多步骤低风险动作批处理
- 长回答自动生成桌面 `Aiko` 文件夹内的带时间戳 Markdown
- 高风险文件能力: 目录列举, 文件读取, 文件写入, 删除到 Aiko trash, 从 Aiko trash 恢复
- 受控 PowerShell 能力: 只允许单条只读 allowlist cmdlet, 禁止管道, 重定向, 分号, 嵌套 shell 和敏感路径
- 动作审计面板: 可按风险, 能力, 结果和关键词筛选日志
- 动作审计面板: 可查看备份路径, trash 隔离路径和 Shell 输出
- 动作审计面板: 可从成功删除记录里准备恢复动作, 仍然走统一高风险确认弹窗
- 腾讯云一句话 ASR provider
- 腾讯云 TTS provider, 默认超自然大模型音色 `603007 邻家女孩`

暂未完成:

- zero-shot voice cloning
- 完整低延迟双工语音, 包括流式 ASR, 播放队列, 中止播放和口型同步闭环
- 窗口控制, 截图分析, 键鼠自动化
- Shell 命令自动回滚后台
- 面向复杂任务的完整任务进度面板和可编辑执行计划
- 多角色系统, 当前只保留 Aiko 单角色

## 快速开始

环境要求:

- Windows
- Node.js 24 或更高版本
- npm
- GLM API Key

安装依赖:

```powershell
npm install
```

准备环境变量:

```powershell
Copy-Item .env.example .env
```

常用环境变量:

```env
# GLM API 地址
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4

# 主模型
GLM_MODEL=glm-4.6v-flash

# 备用模型, 多个模型用英文逗号分隔
GLM_FALLBACK_MODELS=glm-4v-flash

# GLM API Key
GLM_API_KEY=replace-with-your-api-key

# 是否启用 Tavily MCP
MCP_TAVILY_ENABLED=false

# Tavily API Key, 单 key 兼容配置
TAVILY_API_KEY=replace-with-your-tavily-api-key

# Tavily API Key 轮询列表, 多个 key 用英文逗号分隔
TAVILY_API_KEYS=replace-with-key-1,replace-with-key-2,replace-with-key-3

# 腾讯云 ASR/TTS SecretId
TENCENTCLOUD_SECRET_ID=replace-with-your-tencent-secret-id

# 腾讯云 ASR/TTS SecretKey
TENCENTCLOUD_SECRET_KEY=replace-with-your-tencent-secret-key

# 是否启用腾讯云 ASR
AIKO_ASR_ENABLED=false

# 是否启用腾讯云 TTS
AIKO_TTS_ENABLED=false
```

启动开发模式:

```powershell
npm run dev
```

常用检查:

```powershell
npm run typecheck
npm test
npm run build
```

## 项目结构

```text
assets/vrm/Aiko.vrm                 默认 VRM 模型, 已被 gitignore 忽略
src/main/index.ts                   Electron 主进程入口
src/main/ipc/handlers.ts            Renderer 和主进程之间的 IPC 边界
src/main/agent/aikoAgentRuntime.ts  LangChain Agent Runtime
src/main/agent/graph/               LangGraph 工作流和审批 checkpoint
src/main/agent/mcp/                 Tavily MCP 接入
src/main/agent/subagents/           ResearchAgent 和 MemoryAgent
src/main/agent/retriever/           记忆, 附件, 语音和工具上下文整理
src/main/agent/planner/             意图判断和动作计划生成
src/main/agent/executor/            把计划转换成待确认动作或阻断结果
src/main/actions/                   本地动作执行器
src/main/capabilities/              文件系统, Shell, Markdown 写入等能力
src/main/database/                  SQLite 数据库和 Repository
src/main/memory/                    记忆候选提取和分类
src/renderer/App.tsx                桌宠主界面
src/renderer/components/            输入框, 面板, 确认框和审计面板
src/renderer/character/             VRM 渲染器和动作控制
人物设定.md                         Aiko 的角色人格和提示词设定
docs/人物UI.md                      角色 UI 和人物模型路线说明
待开发.md                           当前剩余任务清单
```

## Agent 架构

Aiko 不允许模型直接接管电脑。当前链路是:

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
  -> Action Journal
```

关键规则:

- Renderer 只负责交互, 不直接执行本地能力
- Retriever 整理长期记忆, 附件, 语音识别结果, 天气和网页资料
- ResearchAgent 负责 Tavily MCP 和 Open-Meteo grounding
- MemoryAgent 负责长期记忆召回和回复后的静默记忆整理
- Planner 优先用确定性逻辑识别本地指令
- Executor 只能生成待确认动作或阻断结果
- LangChain tools 只能提出动作, 不能直接执行 Windows 操作
- 本地动作只能从 `src/main/actions/actionExecutor.ts` 执行
- 高风险动作每次都要用户确认, 不能被永久授权
- 动作执行结果必须进入 Action Journal, 方便回看和恢复

## 如何自定义人物模型

默认模型路径:

```text
assets/vrm/Aiko.vrm
```

替换方法:

1. 用 VRoid Studio 或其他工具导出 `.vrm` 文件
2. 把模型放到 `assets/vrm/`
3. 如果文件名仍然是 `Aiko.vrm`, 不需要改代码
4. 如果文件名不同, 修改 `src/renderer/components/PetStage.tsx` 里的 `AIKO_VRM_PATH`
5. 运行 `npm run dev` 查看效果

注意:

- VRM 模型通过 `/assets/...` 加载
- 模型文件通常较大, 默认不提交到 git
- 当前动作系统已经有基础状态, 但还不是完整 VTuber 动作系统

## 如何自定义角色性格

主要文件:

```text
人物设定.md
```

这里定义 Aiko 的人格, 说话方式, 行为边界和陪伴感。代码会在 `src/main/ai/prompts.ts` 读取它, 再和安全约束, 反幻觉规则一起组成 system prompt。

建议写清楚:

- Aiko 如何称呼用户
- Aiko 的性格关键词
- Aiko 的语气和节奏
- Aiko 可以主动做什么
- Aiko 不能主动做什么
- 不确定时如何表达
- 什么时候必须询问确认
- 什么时候必须拒绝或降级

目标是让 Aiko 有稳定性格, 但不为了角色感编造事实。

## 如何自定义记忆系统

相关代码:

```text
src/main/memory/
src/main/database/
src/main/agent/subagents/memoryAgent.ts
src/main/agent/retriever/
src/renderer/components/MemoryPanel.tsx
```

当前存储:

- 主存储: Node 24 `node:sqlite`
- 记忆表: `memories` 和 `memory_candidates`
- 向量索引: 优先使用 `sqlite-vec` 的 `vec0` 虚拟表
- 降级索引: `memory_vectors` JSON 稀疏向量
- 当前 embedding: 本地确定性 64 维哈希向量, 后续可替换为真实 embedding provider

适合进入长期记忆的内容:

- 用户希望 Aiko 如何称呼自己
- 用户长期偏好
- 用户常用软件
- 用户项目背景
- 用户明确表达过的稳定习惯

不适合直接写入的内容:

- 一次性的临时情绪
- 未确认的敏感信息
- 模型猜测出来的事实
- 和当前任务无关的隐私内容

## 高风险能力边界

当前高风险能力是保守开放:

- 文件读取, 写入, 删除和恢复都需要确认
- 文件覆盖写入前会备份旧内容
- 删除文件只移动到 Aiko trash, 不直接永久删除
- 从 trash 恢复时会检查目标路径是否已经存在
- Shell 只允许单条只读 PowerShell allowlist cmdlet
- Shell 禁止管道, 重定向, 分号, 嵌套 shell 和敏感路径目标
- 高风险动作不会被永久授权
- 审计面板可以查看执行结果, 备份路径, trash 路径和 Shell 输出
- 审计面板发起恢复时仍然必须经过确认弹窗

## 语音状态

当前支持:

- 麦克风录音为 WAV 附件
- 停止录音后自动提交到 Agent
- `AIKO_ASR_ENABLED=true` 且腾讯云密钥完整时, 录音会进入腾讯云 ASR
- `AIKO_TTS_ENABLED=true` 且腾讯云密钥完整时, 回复会优先用腾讯云 TTS 播放
- TTS 不可用时, renderer 会回退到浏览器 Web Speech API

当前限制:

- 还不是完整实时对讲
- 没有流式 ASR
- 没有播放队列和分句缓存
- 没有稳定口型同步闭环
- zero-shot voice cloning 尚未接入

## 安全说明

- `.env` 不应提交到仓库
- API Key 不应写入 README, 测试, 截图或日志
- 模型输出不能直接当成命令执行
- 本地动作必须经过权限层和确认层
- Tavily 搜索结果只作为不可信网页资料注入上下文
- 长期记忆只作为偏好和背景参考, 不作为实时事实来源

## 许可证

本项目使用 MIT License。创作者: Sakura_Cianna。详见 [LICENSE](./LICENSE)。
