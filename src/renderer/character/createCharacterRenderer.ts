import type { CharacterRenderer, CharacterRendererConfig } from "./characterTypes";
import { createFallbackCharacterRenderer } from "./fallbackRenderer";
import { createVrmCharacterRenderer } from "./vrmRenderer";

// 创建角色渲染器, VRM 加载失败时自动退回占位渲染.
export function createCharacterRenderer(): CharacterRenderer {
  const vrmRenderer = createVrmCharacterRenderer();
  let activeRenderer: CharacterRenderer = vrmRenderer;
  let destroyed = false;

  return {
    // 挂载当前角色画面到指定 DOM 容器.
    async mount(element, config) {
      destroyed = false;
      try {
        console.log(`[aiko:vrm] mount requested: ${config.vrmPath}`);
        activeRenderer = vrmRenderer;
        await activeRenderer.mount(element, config);
        console.log("[aiko:vrm] primary VRM renderer mounted");
        if (destroyed) activeRenderer.destroy();
      } catch (error) {
        console.error("[aiko:vrm] primary VRM renderer failed", error);
        if (destroyed) return;
        console.warn("[aiko:vrm] fallback renderer will be mounted");
        activeRenderer = createFallbackCharacterRenderer("VRM 模型加载失败");
        await activeRenderer.mount(element, config);
        if (destroyed) activeRenderer.destroy();
      }
    },
    // 设置当前角色表情.
    setExpression(expression) {
      activeRenderer.setExpression(expression);
    },
    // 设置角色持续行为状态.
    setBehavior(behavior) {
      activeRenderer.setBehavior(behavior);
    },
    // 播放角色动作.
    playMotion(motion) {
      activeRenderer.playMotion(motion);
    },
    // 设置口型张开程度.
    setMouthOpen(value) {
      activeRenderer.setMouthOpen(value);
    },
    // 设置角色看向的位置.
    lookAt(x, y) {
      activeRenderer.lookAt(x, y);
    },
    // 销毁当前角色渲染资源.
    destroy() {
      destroyed = true;
      activeRenderer.destroy();
    }
  };
}

export type { CharacterRendererConfig };
