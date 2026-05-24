import type {
  ExecuteActionRequest,
  ExecuteActionResponse,
} from "../../shared/ipcTypes";
import type {
  ApplicationPreferenceRepository,
  PermissionRepository,
  ReminderRepository,
} from "../database/repositories";
import {
  describeActionFailure,
  describeActionSuccess,
} from "../ai/aikoVoice";
import type { PermissionRule } from "../permissions/permissionService";
import {
  createAbsoluteReminder,
  createRelativeReminder,
  type Reminder,
} from "../reminders/reminderService";
import type { DesktopMarkdownWriter } from "../capabilities/writeDesktopMarkdown";
import type { AikoActionJournal } from "../agent/runtime/actionJournal";
import type { AikoRuntimeHooks } from "../agent/runtime/runtimeHooks";

export type ActionExecutorDeps = {
  openUrl: (url: string) => Promise<void>;
  openApplication: (query: string, expectedPath?: string) => Promise<boolean>;
  writeDesktopMarkdown?: DesktopMarkdownWriter;
  actionJournal?: Pick<AikoActionJournal, "recordExecutionResult">;
  hooks?: Pick<AikoRuntimeHooks, "emit">;
  now: () => Date;
  applicationPreferenceRepository?: Pick<ApplicationPreferenceRepository, "setDefaultApplication" | "getDefaultApplication">;
  permissionRepository?: Pick<
    PermissionRepository,
    "remember" | "has" | "list"
  >;
  reminderRepository?: Pick<ReminderRepository, "save" | "list" | "cancelLatestActive">;
};

// 创建本地动作执行器, 负责把已确认的动作转成本地能力调用.
export function createActionExecutor(deps: ActionExecutorDeps) {
  const reminders: Reminder[] = [];
  const rememberedActions = new Set<string>();

  return {
    // 执行一个已经通过权限确认的动作请求.
    async execute(
      request: ExecuteActionRequest,
    ): Promise<ExecuteActionResponse> {
      const { action, remember } = request;

      let result: ExecuteActionResponse;
      try {
        await emitActionHook("before_tool_call", action, {
          phase: "execute",
          remember
        });
        result = await executeSafely(action, remember);
      } catch {
        result = { ok: false, message: describeActionFailure(action, "execution_failed") };
      }
      await emitActionHook("after_tool_call", action, {
        phase: "execute",
        remember,
        ok: result.ok
      });
      deps.actionJournal?.recordExecutionResult({ action, ...result });
      return result;
    },

    // 列出当前执行器可见的提醒.
    listReminders(): Reminder[] {
      if (deps.reminderRepository) {
        return deps.reminderRepository.list();
      }
      return [...reminders];
    },

    // 列出已经记住授权的动作规则.
    listRememberedActions(): string[] {
      if (deps.permissionRepository) {
        return deps.permissionRepository.list().map(ruleKey);
      }
      return [...rememberedActions];
    },

    // 判断某个动作是否已经被用户授权记住.
    isRememberedAction(action: ExecuteActionRequest["action"]): boolean {
      const rule = toPermissionRule(action);
      if (deps.permissionRepository) {
        return deps.permissionRepository.has(rule);
      }
      return rememberedActions.has(ruleKey(rule));
    },
  };

  // 在统一错误边界内执行动作, 保证 IPC 总能拿到结构化结果.
  async function executeSafely(
    action: ExecuteActionRequest["action"],
    remember: boolean,
  ): Promise<ExecuteActionResponse> {
    if (action.risk === "high") {
      return { ok: false, message: describeActionFailure(action, "high_risk") };
    }

    if (action.capability === "batch_actions") {
      return executeBatchAction(action, remember);
    }

    if (action.capability === "open_url") {
      await deps.openUrl(action.target);
      rememberSuccessfulPermission(action, remember);
      return { ok: true, message: describeActionSuccess(action) };
    }

    if (action.capability === "open_application") {
      const opened = await deps.openApplication(action.target, readStringParam(action.params, "applicationPath") ?? undefined);
      if (opened) {
        rememberSuccessfulPermission(action, remember);
        rememberDefaultApplication(action, remember);
      }
      const defaultFor = readStringParam(action.params, "defaultFor");
      if (opened && remember && defaultFor) {
        return {
          ok: true,
          message: `${action.target} 已经打开, 也设成默认${defaultFor}. 以后要改的话, 对我说"将默认${defaultFor}改成 XXX".`
        };
      }
      return opened
        ? { ok: true, message: describeActionSuccess(action) }
        : { ok: false, message: describeActionFailure(action, "not_found") };
    }

    if (action.capability === "set_default_application") {
      const defaultFor = readStringParam(action.params, "defaultFor") || action.target;
      const application = readStringParam(action.params, "application");
      if (!deps.applicationPreferenceRepository || !application) {
        return { ok: false, message: describeActionFailure(action, "invalid") };
      }

      deps.applicationPreferenceRepository.setDefaultApplication(defaultFor, application);
      rememberSuccessfulPermission(action, remember);
      return {
        ok: true,
        message: `默认${defaultFor}已改成 ${application}. 下次你说"打开${defaultFor}", 我就按这个来.`
      };
    }

    if (action.capability === "create_reminder") {
      const amount = readNumberParam(action.params, "amount");
      const unit = action.params?.unit;
      const title = readStringParam(action.params, "title") || action.target;
      const triggerAtText = readStringParam(action.params, "triggerAt");

      if (triggerAtText) {
        const baseTime = deps.now();
        const triggerAt = new Date(triggerAtText);
        if (!Number.isFinite(triggerAt.getTime()) || triggerAt.getTime() <= baseTime.getTime()) {
          return { ok: false, message: describeActionFailure(action, "invalid") };
        }

        const reminder = createAbsoluteReminder({
          title,
          triggerAt,
          baseTime
        });
        if (deps.reminderRepository) {
          deps.reminderRepository.save(reminder);
        } else {
          reminders.push(reminder);
        }
        rememberSuccessfulPermission(action, remember);
        return { ok: true, message: describeActionSuccess(action) };
      }

      // 提醒参数来自模型侧 payload, 保存前必须重新校验.
      if (!amount || (unit !== "minutes" && unit !== "hours")) {
        return { ok: false, message: describeActionFailure(action, "invalid") };
      }

      const reminder = createRelativeReminder({
        title,
        amount,
        unit,
        baseTime: deps.now(),
      });
      if (deps.reminderRepository) {
        deps.reminderRepository.save(reminder);
      } else {
        reminders.push(reminder);
      }
      rememberSuccessfulPermission(action, remember);
      return { ok: true, message: describeActionSuccess(action) };
    }

    if (action.capability === "cancel_reminder") {
      const target = readStringParam(action.params, "target") || action.target;
      if (target !== "latest") {
        return { ok: false, message: describeActionFailure(action, "invalid") };
      }

      const reminder = deps.reminderRepository
        ? deps.reminderRepository.cancelLatestActive()
        : cancelLatestActiveReminder(reminders);
      if (!reminder) {
        return { ok: false, message: "现在没有正在等待的提醒可以取消. 我先不乱删." };
      }

      rememberSuccessfulPermission(action, remember);
      return {
        ok: true,
        message: `已取消提醒: ${reminder.title}. 我把这条从待办里收起来了.`
      };
    }

    if (action.capability === "write_desktop_markdown") {
      const title = readStringParam(action.params, "title") || "Aiko回答";
      const content = readStringParam(action.params, "content");

      // 写文件必须有注入的本地 writer 和非空正文, 避免模型构造空文件.
      if (!deps.writeDesktopMarkdown || !content) {
        return { ok: false, message: describeActionFailure(action, "invalid") };
      }

      const result = await deps.writeDesktopMarkdown({ title, content });
      rememberSuccessfulPermission(action, remember);
      return { ok: true, message: `我把 Markdown 写好了: ${result.filePath}` };
    }

    return { ok: false, message: describeActionFailure(action, "unsupported") };
  }

  // 顺序执行批量动作, 每个子动作仍然走同一套权限后执行校验.
  async function executeBatchAction(
    action: ExecuteActionRequest["action"],
    remember: boolean,
  ): Promise<ExecuteActionResponse> {
    const actions = action.actions ?? [];
    if (actions.length === 0 || actions.some((child) => child.risk === "high" || child.capability === "batch_actions")) {
      return { ok: false, message: describeActionFailure(action, "invalid") };
    }

    const results: ExecuteActionResponse[] = [];
    for (const childAction of actions) {
      results.push(await executeSafely(childAction, remember));
    }

    const ok = results.every((result) => result.ok);
    const lines = results.map((result, index) => `${index + 1}. ${result.message}`);
    return {
      ok,
      message: `${ok ? "这组操作我处理完了" : "这组操作有部分没完成"}:\n${lines.join("\n")}`
    };
  }

  // 执行成功后才记住权限, 避免失败动作污染自动授权规则.
  function rememberSuccessfulPermission(
    action: ExecuteActionRequest["action"],
    remember: boolean,
  ) {
    if (!remember || !canRememberAction(action)) return;
    const rule = toPermissionRule(action);
    // 记住权限时只绑定能力和目标, 不扩大到任意未来动作.
    if (deps.permissionRepository) {
      deps.permissionRepository.remember(rule);
    } else {
      rememberedActions.add(ruleKey(rule));
    }
  }

  // 用户选择"设为默认"时, 把泛称应用和具体应用绑定起来.
  function rememberDefaultApplication(
    action: ExecuteActionRequest["action"],
    remember: boolean,
  ) {
    if (!remember || !deps.applicationPreferenceRepository) return;
    const defaultFor = readStringParam(action.params, "defaultFor");
    if (!defaultFor) return;
    deps.applicationPreferenceRepository.setDefaultApplication(defaultFor, action.target);
  }

  // 触发本地执行 hook, 让操作日志和未来 worker 能观察真实系统调用边界.
  async function emitActionHook(
    name: "before_tool_call" | "after_tool_call",
    action: ExecuteActionRequest["action"],
    payload: Record<string, unknown>
  ) {
    await deps.hooks?.emit({
      name,
      payload: {
        ...payload,
        capability: action.capability,
        target: action.target,
        actionId: action.id
      }
    });
  }
}

// 只有可重复, 低风险, 目标稳定的动作能被长期自动授权.
function canRememberAction(action: ExecuteActionRequest["action"]): boolean {
  return action.risk === "low" && (action.capability === "open_application" || action.capability === "open_url");
}

// 从本地内存提醒中取消最近创建的激活提醒.
function cancelLatestActiveReminder(reminders: Reminder[]): Reminder | null {
  const reminder = [...reminders]
    .filter((candidate) => candidate.status === "active")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
  if (!reminder) return null;

  reminder.status = "cancelled";
  return { ...reminder };
}

// 把待执行动作转换成权限规则.
function toPermissionRule(
  action: ExecuteActionRequest["action"],
): PermissionRule {
  return {
    capability: action.capability,
    target: permissionTarget(action),
    risk: action.risk,
  };
}

// 应用授权绑定到已解析路径, 避免同名快捷方式在未来接管 remembered 权限.
function permissionTarget(action: ExecuteActionRequest["action"]): string {
  if (action.capability !== "open_application") return action.target;
  const applicationPath = readStringParam(action.params, "applicationPath");
  return applicationPath ? `${action.target}|${applicationPath}` : action.target;
}

// 生成权限规则的稳定 key.
function ruleKey(rule: Pick<PermissionRule, "capability" | "target">): string {
  return `${rule.capability}:${rule.target.toLowerCase()}`;
}

// 从动作参数中安全读取数字.
function readNumberParam(
  params: ExecuteActionRequest["action"]["params"],
  key: string,
): number | null {
  const value = params?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// 从动作参数中安全读取字符串.
function readStringParam(
  params: ExecuteActionRequest["action"]["params"],
  key: string,
): string | null {
  const value = params?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
