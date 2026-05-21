# Aiko Desktop Pet

Aiko 是一个面向 Windows 的桌宠与本地助手原型.它使用 Electron + React 构建桌面窗口, 使用 LangChain v1 编排 Agent, 通过 GLM 兼容 API 调用大模型, 并提供本地记忆, 权限确认, 本地动作执行和后续 VRM 角色渲染扩展路线.

这个项目的目标不是做一个超大型 Agent, 而是做一个可控, 可追踪, 可长期陪伴的本地桌宠助手.

## 当前状态

项目还处于早期开发阶段.当前重点是 Agent 地基和桌宠交互框架, 不是最终发行版.

已完成:

- Electron + React 桌宠窗口.
- LangChain v1 Agent runtime.
- GLM 兼容模型配置.
- Planner / Retriever / Executor 三层 Agent 结构.
- Tool Registry 工具元信息系统.
- Node 24 `node:sqlite` 本地长期记忆.
- 对话后静默抽取记忆候选.
- 本地动作用户确认流程.
- 常见命令的本地确定性处理, 例如打开应用, 打开 URL, 网页搜索, 相对时间提醒.
- 图片输入入口.
- 麦克风录音入口.
- Agent Trace 调试记录.
- VRM + Three.js + `@pixiv/three-vrm` 角色路线.

暂未完成:

- 真实 ASR 语音识别.
- TTS 回复播放.
- zero-shot voice cloning.
- 高风险 Windows 操作.
- Shell 命令执行.
- 文件写入能力.
- 多角色系统.

## 技术栈

- Electron
- React
- TypeScript
- LangChain v1
- GLM 兼容 API
- Node 24 `node:sqlite`
- Three.js
- `@pixiv/three-vrm`
- Vitest

## 环境要求

- Windows
- Node.js 24 或更高版本
- npm
- GLM 兼容 API Key

项目当前使用 Node 24 内置的 `node:sqlite`, 所以建议直接使用 Node 24.

## 安装

安装依赖:

```bash
npm install
```

复制环境变量文件:

```bash
copy .env.example .env
```

配置 `.env`:

```env
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GLM_MODEL=glm-4v-flash
GLM_API_KEY=replace-with-your-api-key
```

不要提交 `.env`.这里面应该放你自己的 API Key.

## 开发命令

启动开发模式:

```bash
npm run dev
```

类型检查:

```bash
npm run typecheck
```

运行测试:

```bash
npm test
```

构建:

```bash
npm run build
```

## Agent 架构

当前主链路:

```text
Renderer
  -> IPC handler
  -> AikoAgentRuntime
  -> Retriever
  -> Planner
  -> Executor
  -> LangChain Agent
  -> Memory candidate extraction
```

核心边界:

- `src/main/agent/aikoAgentRuntime.ts`: Agent 总编排和 LangChain 边界.
- `src/main/agent/retriever`: 召回记忆, 整理附件, 语音上下文和工具提示.
- `src/main/agent/planner`: 判断用户意图, 生成结构化计划.
- `src/main/agent/executor`: 把计划转换为待确认动作或阻断结果.
- `src/main/agent/tools`: 工具注册表和工具元信息.
- `src/main/agent/trace`: Agent 请求 trace.
- `src/main/actions`: 已确认本地动作执行.
- `src/main/permissions`: 权限记忆和确认策略.
- `src/main/memory`: 记忆召回, 记忆候选抽取和分类.

LangChain tools 只能生成待确认动作, 不能直接执行 Windows 操作.

## 如何自定义助手性格

主要文件:

```text
人物设定.md
```

这里定义 Aiko 的人格, 说话方式, 行为边界和陪伴感.你可以修改它来定制自己的助手.

建议配置内容:

- 名字和称呼方式.
- 性格关键词.
- 说话语气.
- 是否主动提醒.
- 对用户的关系定位.
- 不应该做的事情.
- 面对不确定信息时如何回答.
- 面对用户情绪时如何回应.

代码入口:

```text
src/main/ai/prompts.ts
```

这个文件会读取 `人物设定.md`, 再合并安全约束和反幻觉规则生成 system prompt.

建议原则:

- 性格可以鲜明, 但不要让她编造事实.
- 可以有陪伴感, 但不要过度打扰用户.
- 可以有二次元角色感, 但不要牺牲可靠性.
- 重要信息不确定时, 应该说明不确定.

## 如何自定义助手立绘和人物模型

当前项目的角色方向是:

```text
VRM + Three.js + @pixiv/three-vrm
```

推荐流程:

1. 使用 VRoid Studio 创建自己的二次元角色.
2. 导出 `.vrm` 模型文件.
3. 将模型放入项目资源目录, 例如 `assets/vrm`.
4. 在角色渲染配置中指向新的 VRM 文件.
5. 根据模型比例调整窗口尺寸, 相机位置和交互区域.

相关目录:

```text
assets/
src/renderer/character/
```

相关文档:

```text
人物UI.md
```

可自定义方向:

- 角色模型.
- 角色表情.
- 角色待机动作.
- 鼠标悬停交互.
- 输入框出现方式.
- 桌宠窗口大小.
- 是否置顶.
- 是否点击穿透.

注意:

- 当前仍是角色渲染基础阶段, 不是完整 VTuber 系统.
- Live2D 路线已经不是优先路线.
- 如果模型文件很大, 会影响启动速度和渲染性能.

## 如何自定义记忆系统

Aiko 的记忆系统是本地长期记忆.当前流程:

1. 用户与 Aiko 对话.
2. 回复完成后, 后台静默抽取记忆候选.
3. 记忆候选被分类.
4. 可自动接受或进入待确认.
5. 后续对话前, Retriever 会召回相关记忆.
6. 模型只把记忆当作偏好参考, 不把它当作实时事实.

相关代码:

```text
src/main/memory/
src/main/database/
src/main/agent/retriever/
```

你可以自定义:

- 哪些内容应该进入长期记忆.
- 哪些记忆需要用户确认.
- 记忆分类.
- 记忆召回数量.
- 记忆匹配规则.
- 记忆过期策略.
- 记忆 UI 展示方式.

当前建议的记忆类型:

- Profile Memory: 用户长期偏好, 例如称呼, 工作习惯, 常用软件.
- Relationship Memory: Aiko 和用户之间形成的互动习惯.
- Project Memory: 当前项目和任务上下文.
- Episodic Memory: 最近发生过的重要事件.

重要原则:

- 当前输入优先于长期记忆.
- 记忆不能当作实时事实.
- 不确定的记忆应该等待用户确认.
- 用户应该可以查看, 接受, 拒绝和删除记忆.

## 如何自定义模型配置

主要配置文件:

```text
.env
```

示例:

```env
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GLM_MODEL=glm-4v-flash
GLM_API_KEY=replace-with-your-api-key
```

相关代码:

```text
src/main/config/env.ts
src/main/agent/aikoAgentRuntime.ts
```

当前使用 `@langchain/openai` 的 OpenAI-compatible 接入方式连接 GLM.后续如果要换模型, 推荐先抽象 Model Adapter, 不要把 provider SDK 调用散落到业务逻辑里.

## 如何自定义工具和本地能力

工具注册表:

```text
src/main/agent/tools/toolRegistry.ts
```

Planner:

```text
src/main/agent/planner/aikoPlanner.ts
```

执行器:

```text
src/main/actions/actionExecutor.ts
src/main/agent/executor/aikoExecutor.ts
```

添加新能力时建议流程:

1. 在 Tool Registry 里添加工具元信息.
2. 在 Planner 中决定什么时候生成计划.
3. 在 Executor 中把计划转换为待确认动作.
4. 在 ActionExecutor 中实现真正的本地动作.
5. 在权限系统中定义风险等级和确认策略.
6. 添加测试.

风险等级建议:

- `low`: 打开应用, 打开 URL, 创建普通提醒.
- `medium`: 读取剪贴板, 截图, 读取用户明确指定的文件.
- `high`: 写文件, 删除文件, 执行命令.
- `critical`: 系统设置修改, 批量文件操作, 高权限自动化.

当前版本高风险操作默认不执行.

## 如何自定义权限策略

相关代码:

```text
src/main/permissions/
src/main/actions/actionExecutor.ts
```

当前策略:

1. Agent 只能生成待确认动作.
2. 未授权动作需要用户确认.
3. 用户可以选择记住某个能力和目标.
4. 已记住的低风险动作后续可直接执行.
5. 高风险动作当前直接阻断.

适合扩展的方向:

- 按能力设置默认风险等级.
- 按目标设置记住授权.
- 给授权规则增加过期时间.
- 增加开发者调试面板.
- 对文件和命令类能力增加更严格的白名单.

## 如何自定义 UI

主要渲染代码:

```text
src/renderer/
```

常见入口:

```text
src/renderer/App.tsx
src/renderer/components/
src/renderer/character/
```

可自定义:

- 桌宠窗口大小.
- 输入框显示方式.
- 设置按钮和面板.
- 聊天面板.
- 记忆面板.
- 提醒面板.
- 角色区域布局.
- 鼠标悬停行为.

当前 UI 目标是桌宠优先, 不是传统聊天软件.所以默认体验应该是人物在前, 控件在需要时出现.

## 多模态输入

当前支持:

- 文本.
- 图片附件.
- 麦克风录音附件.

限制:

- 图片可以进入多模态模型输入.
- 录音目前只是入口, 没有真实 ASR.
- 没有 ASR 时, Aiko 不能假装听懂语音.

后续路线:

- 接入真实 ASR.
- 将 transcript 交给 Retriever 和 Planner.
- 接入 TTS 回复播放.
- 最后再接 zero-shot voice cloning.

## 安全注意事项

- 不要提交 `.env`.
- 不要把 API Key 写入 README, 测试, 截图或日志.
- LangChain tools 不允许直接执行 Windows 操作.
- 高风险操作当前必须阻断.
- Shell 命令和文件写入不属于当前实现范围.
- 模型输出不能直接当作本地命令执行.

## 项目文档

- `docs/agent-architecture.md`: 当前 LangChain Agent 架构约束.
- `后续agent开发.md`: 后续 Agent 开发计划.
- `人物UI.md`: 人物 UI 和模型路线.
- `人物设定.md`: Aiko 人格和提示词设定.

## 许可证

本项目使用 MIT License.详见 [LICENSE](./LICENSE).
