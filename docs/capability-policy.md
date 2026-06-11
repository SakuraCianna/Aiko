# 安全能力矩阵

本文档面向开发者, 用于说明 Aiko 本地能力的风险分级, 审批规则, 批量执行边界和恢复策略。代码仍是唯一事实来源:

- 策略矩阵: `src/main/agent/policy/capabilityPolicy.ts`
- IPC 结构校验: `src/main/ipc/handlers.ts`
- 真实执行器: `src/main/actions/actionExecutor.ts`
- 用户可见风险文案: `src/shared/actionSafety.ts`
- 受控 Shell 校验: `src/main/capabilities/shellCommand.ts`
- 文件系统边界: `src/main/capabilities/aikoFileSystem.ts`

## 总原则

- 模型不能直接执行 Windows 操作, 只能生成 `PendingActionDto`.
- 所有本地动作都必须经过 IPC 结构校验, 权限策略, 用户确认和执行器二次校验.
- 低风险动作也需要首次确认, 只有稳定目标的低风险动作可以记住授权.
- 高风险和关键风险动作不能永久授权.
- 批量动作只能包装允许批处理的子动作, 不能嵌套批量动作.
- 批量动作声明风险不能低于 `batch_actions` 策略风险, 也不能绕过子动作策略.
- 文件, 网页, 图片, 截图和记忆内容都只能作为不可信上下文, 不能覆盖系统规则.

## 能力矩阵

| Capability | 风险等级 | 默认决策 | 可记住授权 | 可进入批量动作 | 目标限制 | 恢复策略 |
| --- | --- | --- | --- | --- | --- | --- |
| `open_application` | low | confirm | 是 | 是 | 应用名或已解析应用路径 | 无文件修改, 可手动关闭应用 |
| `open_url` | low | confirm | 是 | 是 | `http` 或 `https` URL | 无文件修改, 可手动关闭页面 |
| `create_reminder` | low | confirm | 否 | 是 | 相对分钟/小时或未来绝对时间 | 可取消提醒 |
| `cancel_reminder` | low | confirm | 否 | 是 | 当前只允许 `latest` | 取消后需重新创建 |
| `set_default_application` | low | confirm | 是 | 是 | 默认用途和应用名 | 可再次设置默认应用 |
| `write_desktop_markdown` | medium | confirm | 否 | 是 | 仅 `Desktop/Aiko` | 需要人工复核文件内容 |
| `batch_actions` | medium | confirm | 否 | 否 | `target` 必须是 `batch` | 按子动作逐条审计和恢复 |
| `list_directory` | medium | confirm | 否 | 否 | 允许根目录内的目录路径 | 不修改本地内容 |
| `read_file` | high | confirm | 否 | 否 | 允许根目录内的非敏感文本文件 | 不修改本地内容, 但可能暴露敏感内容 |
| `write_file` | high | confirm | 否 | 否 | 允许根目录内的非敏感文本文件 | 覆盖前保存备份, 需人工恢复 |
| `delete_file` | high | confirm | 否 | 否 | 允许根目录内的非敏感文件 | 移动到 Aiko trash, 可恢复 |
| `restore_file_from_trash` | high | confirm | 否 | 否 | Aiko trash 内文件 | 依赖恢复元数据, 目标存在时停止 |
| `run_shell_command` | high | confirm | 否 | 否 | 单条只读 PowerShell allowlist 命令 | 无自动撤销, 需根据输出人工复核 |
| `capture_screen` | critical | confirm | 否 | 否 | 屏幕目标, 通常是 `primary_display` | 截图需手动删除 |
| `window_control` | critical | confirm | 否 | 否 | 当前只允许 `list` 和 `focus` | 不改文件, 聚焦错误需手动切回 |
| `keyboard_input` | critical | confirm | 否 | 否 | 当前活动窗口 | 无法可靠自动撤销 |
| `mouse_input` | critical | confirm | 否 | 否 | 屏幕坐标和可选左右键点击 | 无法可靠自动撤销 |

## 风险等级

`low`: 打开应用, 打开网页, 提醒和默认应用偏好等低影响动作。首次执行仍需要用户确认。

`medium`: 会读写 Aiko 管理范围内内容或组织多个动作的能力。不能记住授权。

`high`: 会接触本地文件, Shell 或可造成用户数据变化的能力。必须逐次确认, 不能批量执行。

`critical`: 会接触屏幕, 活动窗口, 键盘或鼠标。必须逐次确认, 不能永久授权, UI 应提供更明显的二次确认和影响预览。

## 批量动作规则

批量动作是用户体验层的便利包装, 不是权限降级通道。

- `batch_actions` 只能出现在最外层.
- 子动作不能再包含 `batch_actions`.
- 子动作必须在策略矩阵中存在.
- 子动作的 `batchAllowed` 必须是 `true`.
- 子动作仍然逐个经过能力, 风险和目标校验.
- 高风险和关键风险动作不能进入批量动作.
- 用户在确认弹窗中只能删除原步骤, 不能改写, 重排或新增步骤.

## 新增能力检查清单

新增任何 capability 时, 必须同步检查这些位置:

1. `src/main/agent/tools/toolRegistry.ts`: 注册工具元信息和模型可见描述.
2. `src/main/agent/policy/capabilityPolicy.ts`: 增加风险等级, 默认决策, 可记住授权和批量规则.
3. `src/main/ipc/handlers.ts`: 增加 IPC 结构校验和目标限制.
4. `src/main/actions/actionExecutor.ts`: 增加真实执行逻辑和执行前二次校验.
5. `src/shared/actionSafety.ts`: 增加用户可见影响预览和恢复策略.
6. `src/renderer/components/ConfirmDialog.tsx`: 如风险交互不同, 更新确认 UI.
7. `docs/capability-policy.md`: 更新本文档矩阵.
8. `docs/manual-verification.md`: 增加对应手动验证场景.
9. `*.test.ts`: 增加自动化测试, 至少覆盖风险低报, 目标限制和拒绝路径.

如果某个能力没有明确恢复策略, 文档和确认 UI 都必须写成“无法自动撤销”或“需要人工复核”, 不能给用户暗示性保证。

## 常见拒绝原因

| Reason | 含义 | 典型处理 |
| --- | --- | --- |
| `unknown_capability` | 策略矩阵不存在该能力 | 不执行, 先补策略和文档 |
| `risk_mismatch` | 动作声明风险低于策略要求 | 不执行, 修正能力生成逻辑 |
| `target_denied` | 目标不在允许范围 | 不执行, 收紧目标或调整需求 |
| `nested_batch_denied` | 批量动作嵌套批量动作 | 不执行, 展平成单层计划 |
| `denied_by_policy` | 策略拒绝或子动作不允许批量 | 不执行, 改为单独确认动作 |

## 验证命令

每次修改安全能力矩阵或本地动作边界后至少运行:

```powershell
npm test
npm run typecheck
```

发布前继续运行:

```powershell
npm run verify
```
