import { createHash, createHmac } from "node:crypto";

export type TencentCloudHeaderInput = {
  action: string;
  host: string;
  payload: string;
  region: string;
  secretId: string;
  secretKey: string;
  service: string;
  timestamp?: number;
  version: string;
};

export type TencentCloudRequestInput = TencentCloudHeaderInput & {
  fetchImpl?: typeof fetch;
  timeoutMs: number;
};

// 创建腾讯云 TC3-HMAC-SHA256 请求头, SecretKey 只参与签名, 不写入日志或请求体.
export function createTencentCloudHeaders(input: TencentCloudHeaderInput): Record<string, string> {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = "application/json; charset=utf-8";
  const canonicalHeaders = `content-type:${contentType}\nhost:${input.host}\nx-tc-action:${input.action.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256(input.payload)
  ].join("\n");
  const credentialScope = `${date}/${input.service}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(timestamp),
    credentialScope,
    sha256(canonicalRequest)
  ].join("\n");
  const signingKey = createSigningKey(input.secretKey, date, input.service);
  const signature = hmacHex(signingKey, stringToSign);

  return {
    Authorization: `TC3-HMAC-SHA256 Credential=${input.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "Content-Type": contentType,
    Host: input.host,
    "X-TC-Action": input.action,
    "X-TC-Region": input.region,
    "X-TC-Timestamp": String(timestamp),
    "X-TC-Version": input.version
  };
}

// 发送腾讯云 JSON API 请求, provider 层负责解释具体 Response 字段.
export async function requestTencentCloudApi(input: TencentCloudRequestInput): Promise<Record<string, unknown>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers = createTencentCloudHeaders(input);
  const response = await fetchImpl(`https://${input.host}`, {
    method: "POST",
    headers,
    body: input.payload,
    signal: AbortSignal.timeout(input.timeoutMs)
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const message = readTencentErrorMessage(body) || `Tencent Cloud request failed: ${response.status}`;
    throw new Error(message);
  }
  return body;
}

// 从腾讯云通用错误响应里读取可展示的错误信息.
export function readTencentErrorMessage(body: Record<string, unknown>): string {
  const response = readRecord(body.Response);
  const error = readRecord(response?.Error);
  const code = readString(error?.Code);
  const message = readString(error?.Message);
  if (!code && !message) return "";
  return [code, message].filter(Boolean).join(": ");
}

// 安全读取腾讯云 Response 对象.
export function readTencentResponse(body: Record<string, unknown>): Record<string, unknown> {
  return readRecord(body.Response) ?? {};
}

// 安全读取字符串字段.
export function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// 安全读取对象字段.
function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

// 对字符串执行 SHA256 hex 摘要.
function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// 生成腾讯云 TC3 分层签名 key.
function createSigningKey(secretKey: string, date: string, service: string): Buffer {
  const secretDate = createHmac("sha256", `TC3${secretKey}`).update(date).digest();
  const secretService = createHmac("sha256", secretDate).update(service).digest();
  return createHmac("sha256", secretService).update("tc3_request").digest();
}

// 使用二进制 key 计算 HMAC hex.
function hmacHex(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}
