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
        <input value="实时语音识别优先,不支持时退回录音附件" readOnly />
      </label>
    </section>
  );
}
