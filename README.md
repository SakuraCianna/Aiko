# Aiko Desktop Pet

Aiko 是一个面向 Windows 的本地助手型桌宠。当前目标不是无限制接管系统, 而是做一个单角色陪伴助手: 常驻桌面, 能对话, 能理解图片和语音入口, 能记住长期偏好, 能在用户确认后执行受控 Windows 操作。

## 技术路线

- 桌面壳: Electron + React + TypeScript
- 人物模型: VRM + Three.js + `@pixiv/three-vrm`
- Agent: LangChain + LangGraph, 拆成 Retriever / Planner / Executor
- 子 Agent: ResearchAgent / MemoryAgent / 内部 worker 注册表
- 记忆系统: Node 24 `node:sqlite` + `sqlite-vec` 兼容向量索引
- 网页搜索: Tavily MCP, 仅在用户明确要求新闻, 最新信息或网页搜索时触发
- 天气: Open-Meteo typed tool
- 语音: AudioWorklet 麦克风录音 + 流式 ASR 接口层 + 腾讯云 ASR/TTS, TTS 支持分句队列, 中止和 VRM 口型联动
- 权限: 本地能力走确认弹窗, 权限矩阵和动作审计日志

## 当前能力

已实现:

- Electron 桌宠窗口和管理面板
- VRM 模型加载, lookAt, 待机, 思考, 说话, 执行, 成功, 失败, 拖拽等基础动作
- TTS 播放时驱动 VRM 嘴部开合
- 麦克风录音通过 AudioWorklet 采集 PCM, 已支持边录边分片推送到主进程 ASR 流式接口
- 当前流式接口先使用 buffered provider 兼容腾讯云一句话识别, 后续可替换为腾讯云实时 WebSocket provider
- GLM OpenAI-compatible 模型调用和 fallback 模型路由
- LangGraph 审批流, 支持确认, 取消, resume 和 SQLite checkpoint
- 本地对话上下文, 新对话, 清空上下文和删除当前对话意图识别
- 长期记忆候选提取, 用户确认, SQLite 存储和向量召回
- 用户语气体验信号分析, 用于短期回复策略调整
- Tavily MCP 网页搜索, 支持多个 API key 轮询
- Open-Meteo 天气工具
- 打开应用, 打开 URL, 创建提醒, 取消最近提醒
- 多步骤低风险动作批处理
- 长回答自动写入桌面 `Aiko` 文件夹, 文件名带时间戳
- 文件读取, 文件写入, 目录列举, 删除到 Aiko trash, 从 Aiko trash 恢复
- 受控 PowerShell 命令执行, 只允许单条只读 allowlist cmdlet
- 高风险动作确认弹窗, 动作审计面板和恢复入口
- 用户可见任务卡片, 显示 Aiko 正在理解, 规划, 准备动作, 等待确认或执行
- 内部 worker 调度记录, 可在 Agent 调试面板查看
- 主动陪伴心跳, 默认 24 小时最多出现一次, 支持安静时段和是否朗读配置

仍未完成:

- 真正低延迟双工实时语音, 当前仍是分片采集 + 结束后最终转写 + 回复播放
- 腾讯云实时 ASR WebSocket provider 和 partial transcript
- zero-shot voice cloning
- 窗口控制, 截图分析, 键鼠自动化
- Shell 命令完整回滚后台
- 复杂任务的可编辑执行计划和失败重试
- 多角色系统, 当前只保留 Aiko

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

## 常用配置

主要配置都在 `.env`。示例见 [.env.example](./.env.example)。

必填:

```env
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GLM_MODEL=glm-4.6v-flash
GLM_API_KEY=replace-with-your-api-key
```

可选:

```env
GLM_FALLBACK_MODELS=glm-4v-flash
MCP_TAVILY_ENABLED=false
TAVILY_API_KEYS=replace-with-key-1,replace-with-key-2,replace-with-key-3
AIKO_ASR_ENABLED=false
AIKO_TTS_ENABLED=false
AIKO_COMPANION_INTERVAL_HOURS=24
AIKO_COMPANION_TTS_ENABLED=false
```

腾讯云语音启用时需要:

```env
TENCENTCLOUD_SECRET_ID=replace-with-your-tencent-secret-id
TENCENTCLOUD_SECRET_KEY=replace-with-your-tencent-secret-key
```

## 项目结构

```text
assets/vrm/Aiko.vrm                 默认 VRM 模型, 已被 gitignore 忽略
src/main/index.ts                   Electron 主进程入口
src/main/ipc/handlers.ts            Renderer 和主进程之间的 IPC 边界
src/main/agent/aikoAgentRuntime.ts  LangChain Agent Runtime
src/main/agent/graph/               LangGraph 工作流和 checkpoint
src/main/agent/retriever/           记忆, 附件, 语音和工具上下文整理
src/main/agent/planner/             意图判断和动作计划生成
src/main/agent/executor/            待确认动作和阻断结果生成
src/main/agent/companion/           主动陪伴心跳
src/main/agent/workers/             内部 worker 注册和调度记录
src/main/actions/                   本地动作执行器
src/main/capabilities/              文件系统, Shell, Markdown 写入等能力
src/main/database/                  SQLite 数据库和 Repository
src/main/memory/                    长期记忆候选, 分类和召回
src/renderer/App.tsx                桌宠主界面
src/renderer/components/            输入框, 面板, 确认框, 任务卡片和审计面板
src/renderer/character/             VRM 渲染器和动作控制
src/renderer/audio/                 麦克风 AudioWorklet 录音, PCM 分片, 流式 ASR 控制器和 WAV 封装
src/renderer/voice/                 语音播放队列和口型联动
人物设定.md                         Aiko 的角色人格和提示词设定
docs/人物UI.md                      角色 UI 和人物模型路线说明
待开发.md                           当前剩余任务清单
```

## Agent 架构

Aiko 不允许模型直接执行 Windows 操作。当前链路是:

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
- Retriever 整理记忆, 附件, 语音识别结果, 天气和网页资料
- Planner 优先用确定性逻辑识别本地指令
- Executor 只能生成待确认动作或阻断结果
- LangChain tools 只能提出动作, 不能直接执行 Windows 操作
- 本地动作只从 `src/main/actions/actionExecutor.ts` 执行
- 高风险动作每次都需要用户确认, 不能永久授权
- 执行结果必须进入 Action Journal

## 自定义 Aiko

### 自定义模型

默认模型路径:

```text
assets/vrm/Aiko.vrm
```

替换方式:

1. 用 VRoid Studio 或其他工具导出 `.vrm`
2. 放到 `assets/vrm/`
3. 如果文件名仍然是 `Aiko.vrm`, 不需要改代码
4. 如果文件名不同, 修改 `src/renderer/components/PetStage.tsx` 里的 `AIKO_VRM_PATH`

模型文件通常较大, 默认不会提交到 git。

### 自定义性格

主要文件:

```text
人物设定.md
```

这里定义 Aiko 的人格, 说话节奏, 行为边界和陪伴感。代码会在 `src/main/ai/prompts.ts` 读取它, 再和安全约束, 反幻觉规则一起组成 system prompt。

建议写清楚:

- Aiko 如何称呼用户
- Aiko 的性格关键词
- Aiko 的语气和节奏
- Aiko 可以主动做什么
- Aiko 不能主动做什么
- 不确定时如何表达
- 什么时候必须询问确认

### 自定义记忆

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

适合进入长期记忆:

- 用户希望 Aiko 如何称呼自己
- 用户长期偏好
- 用户常用软件
- 用户项目背景
- 用户明确表达过的稳定习惯

不适合直接写入:

- 一次性的临时情绪
- 未确认的敏感信息
- 模型猜测出的事实
- 和当前任务无关的隐私内容

## 安全边界

- `.env` 不应提交到仓库
- API Key 不应写入 README, 测试, 截图或日志
- 模型输出不能直接当成命令执行
- 本地动作必须经过权限层和确认层
- Tavily 搜索结果只作为不可信网页资料注入上下文
- 长期记忆只作为偏好和背景参考, 不作为实时事实来源
- Shell 当前只允许单条只读 allowlist cmdlet

## License

本项目使用 MIT License。创作者: Sakura_Cianna。详见 [LICENSE](./LICENSE)。
