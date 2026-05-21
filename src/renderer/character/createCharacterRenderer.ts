import type { CharacterRenderer, CharacterRendererConfig } from "./characterTypes";
import { createFallbackCharacterRenderer } from "./fallbackRenderer";
import { createVrmCharacterRenderer } from "./vrmRenderer";

// 创建角色渲染器, VRM 加载失败时自动退回占位渲染.
export function createCharacterRenderer(): CharacterRenderer {
  const vrmRenderer = createVrmCharacterRenderer();
  let activeRenderer: CharacterRenderer = vrmRenderer;

  return {
    // 挂载当前角色画面到指定 DOM 容器.
    async mount(element, config) {
      try {
        activeRenderer = vrmRenderer;
        await activeRenderer.mount(element, config);
      } catch {
        activeRenderer = createFallbackCharacterRenderer("VRM 模型加载失败");
        await activeRenderer.mount(element, config);
      }
    },
    // 设置当前角色表情.
    setExpression(expression) {
      activeRenderer.setExpression(expression);
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
      activeRenderer.destroy();
    }
  };
}

export type { CharacterRendererConfig };
