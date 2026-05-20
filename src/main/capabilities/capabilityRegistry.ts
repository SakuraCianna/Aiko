import type { CapabilityRequest } from "./capabilityTypes";

export function describeCapability(request: CapabilityRequest): string {
  if (request.capability === "open_application") return `打开应用：${request.target}`;
  if (request.capability === "open_url") return `打开网页：${request.target}`;
  if (request.capability === "create_reminder") return `创建提醒：${request.target}`;
  if (request.capability === "open_configured_path") return `打开路径：${request.target}`;
  return `不支持的操作：${request.target}`;
}
