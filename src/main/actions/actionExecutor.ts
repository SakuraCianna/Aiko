import type { ExecuteActionRequest, ExecuteActionResponse } from "../../shared/ipcTypes";
import type { PermissionRepository, ReminderRepository } from "../database/repositories";
import type { PermissionRule } from "../permissions/permissionService";
import { createRelativeReminder, type Reminder } from "../reminders/reminderService";

export type ActionExecutorDeps = {
  openUrl: (url: string) => Promise<void>;
  openApplication: (query: string) => Promise<boolean>;
  now: () => Date;
  permissionRepository?: Pick<PermissionRepository, "remember" | "has" | "list">;
  reminderRepository?: Pick<ReminderRepository, "save" | "list">;
};

export function createActionExecutor(deps: ActionExecutorDeps) {
  const reminders: Reminder[] = [];
  const rememberedActions = new Set<string>();

  return {
    async execute(request: ExecuteActionRequest): Promise<ExecuteActionResponse> {
      const { action, remember } = request;

      if (action.risk === "high") {
        return { ok: false, message: "这个操作风险太高，当前版本不会执行。" };
      }

      if (remember) {
        const rule = toPermissionRule(action);
        if (deps.permissionRepository) {
          deps.permissionRepository.remember(rule);
        } else {
          rememberedActions.add(ruleKey(rule));
        }
      }

      if (action.capability === "open_url") {
        await deps.openUrl(action.target);
        return { ok: true, message: "已打开网页。" };
      }

      if (action.capability === "open_application") {
        const opened = await deps.openApplication(action.target);
        return opened
          ? { ok: true, message: `已打开应用：${action.target}。` }
          : { ok: false, message: `没有找到已配置的应用：${action.target}。` };
      }

      if (action.capability === "create_reminder") {
        const amount = readNumberParam(action.params, "amount");
        const unit = action.params?.unit;
        const title = readStringParam(action.params, "title") || action.target;

        if (!amount || unit !== "minutes") {
          return { ok: false, message: "这个提醒缺少有效的时间参数。" };
        }

        const reminder = createRelativeReminder({
          title,
          amount,
          unit,
          baseTime: deps.now()
        });
        if (deps.reminderRepository) {
          deps.reminderRepository.save(reminder);
        } else {
          reminders.push(reminder);
        }
        return { ok: true, message: `已创建提醒：${title}。` };
      }

      return { ok: false, message: "当前版本还不支持这个操作。" };
    },

    listReminders(): Reminder[] {
      if (deps.reminderRepository) {
        return deps.reminderRepository.list();
      }
      return [...reminders];
    },

    listRememberedActions(): string[] {
      if (deps.permissionRepository) {
        return deps.permissionRepository.list().map(ruleKey);
      }
      return [...rememberedActions];
    },

    isRememberedAction(action: ExecuteActionRequest["action"]): boolean {
      const rule = toPermissionRule(action);
      if (deps.permissionRepository) {
        return deps.permissionRepository.has(rule);
      }
      return rememberedActions.has(ruleKey(rule));
    }
  };
}

function toPermissionRule(action: ExecuteActionRequest["action"]): PermissionRule {
  return {
    capability: action.capability,
    target: action.target,
    risk: action.risk
  };
}

function ruleKey(rule: Pick<PermissionRule, "capability" | "target">): string {
  return `${rule.capability}:${rule.target.toLowerCase()}`;
}

function readNumberParam(params: ExecuteActionRequest["action"]["params"], key: string): number | null {
  const value = params?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringParam(params: ExecuteActionRequest["action"]["params"], key: string): string | null {
  const value = params?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
