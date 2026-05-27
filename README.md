# Aiko Desktop Pet

Aiko 是一个面向 Windows 的本地助手型桌宠。它不是无限制接管系统的超大型 Agent, 而是一个常驻桌面的单角色陪伴助手: 能对话, 能理解图片和语音入口, 能记住长期偏好, 能在用户确认后执行受控 Windows 操作, 并通过 VRM 模型表现自己的状态。

创作者: Sakura_Cianna

许可证: MIT

## 当前定位

- 单角色桌宠, 当前只保留 Aiko.
- 主动 + 用户确认模式, 高风险动作必须先让用户确认.
- 简单本地意图优先走确定性逻辑, 复杂问题再调用大模型.
- 长期记忆是核心能力, 但记忆只作为偏好和背景参考, 不能覆盖系统规则.
- Windows 操作必须经过权限矩阵, 审批和审计日志.

## 技术路线

- 桌面壳: Electron + React + TypeScript
- 人物渲染: VRM + Three.js + `@pixiv/three-vrm`
- Agent: LangChain + LangGraph
- 架构层: Retriever / Planner / Executor
- 子模块: ResearchAgent, MemoryAgent, Worker Registry, Runtime Hooks
- 存储: Node 24 `node:sqlite`
- 记忆检索: `sqlite-vec`, 不可用时降级到 JSON 向量
- 网页搜索: Tavily MCP
- 天气工具: Open-Meteo typed tool
- 语音: AudioWorklet 麦克风采集 + 腾讯云 ASR/TTS + Web Speech fallback
- 权限: 本地能力确认弹窗 + 权限策略矩阵 + Action Journal

## 已实现能力

### 桌宠表现

- VRM 模型加载, 透明桌宠窗口, 鼠标视线跟踪.
- 待机, 倾听, 思考, 说话, 搜索, 写作, 等待确认, 拖拽, 成功, 失败, 恢复等行为状态.
- Agent 阶段事件会驱动 VRM 动作, 例如检索时搜索, 长文时写作, 等待确认时等待.
- TTS 播放会驱动口型.
- 空闲时会低频播放待机小动作.

### Agent

- LangGraph 审批流, 支持确认, 拒绝, 恢复和取消.
- SQLite checkpoint, 应用重启后可以恢复未完成审批.
- 模型路由, 主模型失败或限流时可尝试 fallback 模型.
- 确定性 Planner 支持多步骤本地动作, 例如一句话里打开应用, 打开网页, 创建提醒, 截屏查看桌面.
- 模型 tools 只能提出待确认动作, 不能直接执行 Windows 能力.
- 长回答会自动转成桌面 `Aiko` 文件夹里的 Markdown 写入动作.
- 批量动作支持执行前删除部分步骤, 但不允许改写, 重排或新增步骤.
- Worker registry 记录内部子任务, 包括 research, multi-step, desktop markdown, file operation, memory, commitment 和 experience reflection.

### 记忆

- 长期记忆使用 SQLite 存储.
- 向量索引优先使用 `sqlite-vec`.
- Active Memory 会选择当前对话更相关的记忆.
- 静默记忆提取会生成候选记忆.
- 用户确认后写入长期记忆.
- 用户语气会形成短期体验信号, 用于调整回复风格.

### Windows 能力

- 打开应用, 打开 URL.
- 创建提醒, 取消最近提醒.
- 文件读取, 文件写入, 目录列举.
- 删除到 Aiko trash, 从 Aiko trash 恢复.
- 受控 PowerShell 命令, 仅允许只读 allowlist 命令.
- critical 风险能力: 截屏, 窗口控制, 键盘输入, 鼠标输入.
- 高风险和 critical 动作默认不允许永久授权.
- 审计面板支持按风险, 能力, 结果和关键词筛选.

### 语音

- 麦克风使用 AudioWorklet 录音.
- Renderer 会边录边切 PCM16 分片, 推送给主进程 ASR session.
- 当前腾讯云 ASR provider 是 buffered 兼容层, 结束录音后调用一句话识别.
- 腾讯云 TTS 可分句播放回复.
- TTS 不可用时降级到浏览器 Web Speech.
- 中止回复会停止当前 TTS 播放.
- 已有基础 TTS 缓存 provider.

## 尚未完成的增强

- 腾讯云实时 ASR WebSocket 和真实 partial transcript.
- zero-shot voice cloning.
- 任意 Shell 命令的完整撤销后台.
- 截屏后的多模态自动分析链路.
- 更完整的窗口控制, 键鼠自动化产品化边界.
- 更细腻的动作, 表情, 语音情绪同步.

## 快速开始

环境要求:

- Windows
- Node.js 24 或更高版本
- npm

安装依赖:

```powershell
npm install
```

复制环境变量模板:

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

## 环境变量

主要配置在 `.env`。不要提交真实 API Key。

GLM:

```env
# GLM OpenAI-compatible API 地址
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4

# 主模型
GLM_MODEL=glm-4.6v-flash

# 主 API Key
GLM_API_KEY=replace-with-your-api-key

# 备用模型, 用逗号分隔
GLM_FALLBACK_MODELS=glm-4v-flash
```

Tavily:

```env
# 是否启用 Tavily MCP
MCP_TAVILY_ENABLED=false

# Tavily API Key, 支持多个 key 轮询
TAVILY_API_KEYS=replace-with-key-1,replace-with-key-2
```

腾讯云语音:

```env
# 是否启用 ASR
AIKO_ASR_ENABLED=false

# 是否启用流式 ASR 接口层
AIKO_ASR_REALTIME_ENABLED=false

# 是否启用 TTS
AIKO_TTS_ENABLED=false

# 腾讯云 SecretId
TENCENTCLOUD_SECRET_ID=replace-with-secret-id

# 腾讯云 SecretKey
TENCENTCLOUD_SECRET_KEY=replace-with-secret-key

# 腾讯云 AppId
TENCENTCLOUD_APP_ID=replace-with-app-id
```

主动陪伴:

```env
# 主动陪伴最小间隔小时数
AIKO_COMPANION_INTERVAL_HOURS=24

# 主动陪伴是否朗读
AIKO_COMPANION_TTS_ENABLED=false
```

## 自定义 Aiko

### 自定义立绘和模型

默认模型路径:

```text
assets/vrm/Aiko.vrm
```

替换方法:

1. 使用 VRoid Studio 或其他工具导出 `.vrm`.
2. 放到 `assets/vrm/`.
3. 如果文件名仍是 `Aiko.vrm`, 不需要改代码.
4. 如果文件名不同, 修改 `src/renderer/components/PetStage.tsx` 里的 `AIKO_VRM_PATH`.

模型文件通常较大, 默认不会提交到 git。

### 自定义性格

主要文件:

```text
人物设定.md
```

这里定义 Aiko 的人格, 语气, 行为边界和陪伴感。运行时会被 `src/main/ai/prompts.ts` 读取, 和安全规则, 反幻觉规则, tools 约束一起组成 system prompt。

建议写清楚:

- Aiko 如何称呼用户
- Aiko 的性格关键词
- Aiko 的说话节奏
- Aiko 可以主动做什么
- Aiko 不能主动做什么
- 不确定时如何表达
- 哪些动作必须先问用户确认

### 自定义记忆系统

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
- 记忆表: `memories`, `memory_candidates`
- 向量索引: `sqlite-vec`
- 降级索引: `memory_vectors` JSON 向量

适合写入长期记忆:

- 用户希望 Aiko 如何称呼自己
- 用户长期偏好
- 用户常用软件
- 用户项目背景
- 用户明确表达过的稳定习惯

不适合直接写入:

- 一次性临时情绪
- 未确认的敏感信息
- 模型猜测出来的事实
- 和当前任务无关的隐私内容

## 项目结构

```text
assets/vrm/Aiko.vrm                 默认 VRM 模型, 已被 gitignore 忽略
src/main/index.ts                   Electron 主进程入口
src/main/ipc/handlers.ts            Renderer 与主进程 IPC 边界
src/main/agent/aikoAgentRuntime.ts  LangChain Agent Runtime
src/main/agent/graph/               LangGraph 工作流和 checkpoint
src/main/agent/retriever/           上下文, 记忆, 附件, 语音和实时知识整理
src/main/agent/planner/             意图判断和动作计划生成
src/main/agent/executor/            待确认动作和阻断结果生成
src/main/agent/workers/             内部 worker 注册和调度记录
src/main/actions/                   本地动作执行器
src/main/capabilities/              Windows, 文件, Shell, Markdown 等能力
src/main/database/                  SQLite migrations 和 repository
src/main/memory/                    长期记忆候选, 分类, 向量召回
src/main/voice/                     ASR/TTS provider 和语音健康检查
src/renderer/App.tsx                桌宠主界面
src/renderer/components/            输入框, 面板, 确认框, 任务卡片, 审计面板
src/renderer/character/             VRM 渲染器和动作控制
src/renderer/audio/                 AudioWorklet 录音和 streaming ASR 控制器
src/renderer/voice/                 语音播放队列和口型联动
人物设定.md                         Aiko 人格和提示词设定
docs/人物UI.md                      角色 UI 和人物模型路线说明
待开发.md                           当前剩余增强项
```

## 安全边界

- `.env` 不应提交到仓库.
- API Key 不应写入 README, 测试, 截图或日志.
- 模型输出不能直接当成命令执行.
- Windows 动作必须经过权限策略和确认层.
- 高风险和 critical 动作不能永久授权.
- Tavily 搜索结果只作为不可信网页资料, 不能覆盖系统规则.
- 长期记忆只作为偏好参考, 不能当作实时事实来源.
- 文件内容, 附件内容和网页内容都必须视为可能包含提示词注入.

## License

本项目使用 MIT License。详见 [LICENSE](./LICENSE)。
