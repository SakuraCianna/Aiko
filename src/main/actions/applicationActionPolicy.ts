import type { PendingActionDto } from "../../shared/ipcTypes";
import {
  findBrowserApplications,
  findMatchingApplications,
  isGenericBrowserQuery
} from "../capabilities/applicationCatalog";
import type { ApplicationConfig } from "../capabilities/openApplication";

export type ApplicationActionDecision =
  | { kind: "direct"; action: PendingActionDto }
  | { kind: "choice_required"; message: string; actions: PendingActionDto[] };

export type ApplicationActionOptions = {
  defaultApplicationTarget?: string | null;
};

// 根据本机应用目录决定打开应用时是直接执行, 还是让用户先选一个候选.
export function resolveOpenApplicationAction(
  action: PendingActionDto,
  apps: ApplicationConfig[],
  options: ApplicationActionOptions = {}
): ApplicationActionDecision {
  if (isGenericBrowserQuery(action.target)) {
    const browserApps = findBrowserApplications(apps);
    const defaultApp = options.defaultApplicationTarget
      ? findMatchingApplications(browserApps, options.defaultApplicationTarget).at(0)
      : null;

    if (defaultApp) {
      return { kind: "direct", action: toApplicationAction(action, defaultApp) };
    }

    const browserActions = browserApps.map((app) => toApplicationAction(action, app, action.target));
    if (browserActions.length > 1) {
      return {
        kind: "choice_required",
        message: "我找到了几个浏览器. 你选一个, 我再打开.",
        actions: browserActions
      };
    }
    if (browserActions.length === 1) return { kind: "direct", action: browserActions[0] };
  }

  const matches = findMatchingApplications(apps, action.target);
  if (matches.length === 1) {
    return { kind: "direct", action: toApplicationAction(action, matches[0]) };
  }

  if (matches.length > 1) {
    return {
      kind: "choice_required",
      message: "我找到了几个可能的应用. 你点一下要开的那个.",
      actions: matches.map((app) => toApplicationAction(action, app, action.target))
    };
  }

  return { kind: "direct", action };
}

// 把应用目录里的候选转换成可执行的低风险打开应用动作.
function toApplicationAction(action: PendingActionDto, app: ApplicationConfig, defaultFor?: string): PendingActionDto {
  return {
    ...action,
    title: `打开应用:${app.name}`,
    target: app.name,
    params: defaultFor
      ? {
          ...action.params,
          applicationPath: app.path,
          defaultFor
        }
      : {
          ...action.params,
          applicationPath: app.path
        }
  };
}
