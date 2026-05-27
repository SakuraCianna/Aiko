import { useEffect, useState } from "react";
import type { VoiceProviderStatusDto, VoiceStatusSnapshotDto } from "../../shared/ipcTypes";

// 渲染当前模型和语音能力配置的只读设置.
export function SettingsPanel() {
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatusSnapshotDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.aiko.getVoiceStatus().then((snapshot) => {
      if (!cancelled) setVoiceStatus(snapshot);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="panel-content">
      <label>
        GLM 模型
        <input value="glm-4.6v-flash" readOnly />
      </label>
      <label>
        语音输入
        <input value="录音附件优先, 由主进程 faster-whisper provider 转写" readOnly />
      </label>
      <label>
        语音输出
        <input value="CosyVoice 优先, 不可用时回退 Web Speech" readOnly />
      </label>
      <div className="voice-status">
        <VoiceStatusLine label="ASR" status={voiceStatus?.asr} fallbackProvider="faster-whisper" />
        <VoiceStatusLine label="TTS" status={voiceStatus?.tts} fallbackProvider="cosyvoice" />
      </div>
    </section>
  );
}

// 渲染单个语音 provider 的健康状态.
function VoiceStatusLine({
  label,
  status,
  fallbackProvider
}: {
  label: string;
  status?: VoiceProviderStatusDto;
  fallbackProvider: VoiceProviderStatusDto["provider"];
}) {
  const provider = status?.provider ?? fallbackProvider;
  const state = status?.status ?? "disabled";
  return (
    <div className={`voice-status-row voice-status-${state}`}>
      <span>{label}</span>
      <span>{provider}</span>
      <span>{formatStatus(status)}</span>
    </div>
  );
}

// 把 provider 状态转换成简短中文提示.
function formatStatus(status?: VoiceProviderStatusDto) {
  if (!status) return "检测中";
  if (status.status === "ready") return "已连接";
  if (status.status === "disabled") return "未启用";
  return "未连接";
}
