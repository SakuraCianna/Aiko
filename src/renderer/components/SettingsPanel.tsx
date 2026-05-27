// 渲染当前模型和语音能力配置的只读设置.
export function SettingsPanel() {
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
    </section>
  );
}
