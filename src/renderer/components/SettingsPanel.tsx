// 渲染当前模型和语音能力配置的只读设置.
export function SettingsPanel() {
  return (
    <section className="panel-content">
      <label>
        GLM 模型
        <input value="glm-4v-flash" readOnly />
      </label>
      <label>
        语音输入
        <input value="语音理解 provider 预留,暂不接入真实 ASR" readOnly />
      </label>
    </section>
  );
}
