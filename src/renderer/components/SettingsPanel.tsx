export function SettingsPanel() {
  return (
    <section className="panel-content">
      <label>
        GLM 模型
        <input value="glm-4v-flash" readOnly />
      </label>
      <label>
        实时语音
        <input value="Realtime Voice Pipeline 预留" readOnly />
      </label>
    </section>
  );
}
