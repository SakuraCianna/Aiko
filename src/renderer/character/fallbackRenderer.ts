import type { CharacterRenderer } from "./characterTypes";

// 创建占位角色渲染器, 用于 VRM 缺失或加载失败时显示状态.
export function createFallbackCharacterRenderer(reason = "VRM 模型尚未加载"): CharacterRenderer {
  let mountedElement: HTMLElement | null = null;
  let fallbackNode: HTMLDivElement | null = null;

  return {
    // 挂载占位角色节点.
    async mount(element, config) {
      mountedElement = element;
      fallbackNode = document.createElement("div");
      fallbackNode.className = "character-fallback";
      fallbackNode.textContent = `${reason}\n${config.vrmPath}`;
      element.replaceChildren(fallbackNode);
    },
    // 在占位节点上记录表情状态.
    setExpression(expression) {
      if (fallbackNode) fallbackNode.dataset.expression = expression;
    },
    // 在占位节点上记录持续行为状态.
    setBehavior(behavior) {
      if (fallbackNode) fallbackNode.dataset.behavior = behavior;
    },
    // 在占位节点上记录动作状态.
    playMotion(motion) {
      if (fallbackNode) fallbackNode.dataset.motion = motion;
    },
    // 在占位节点上记录口型状态.
    setMouthOpen(value) {
      if (fallbackNode) fallbackNode.style.setProperty("--mouth-open", String(value));
    },
    // 在占位节点上记录看向状态.
    lookAt(x, y) {
      if (!fallbackNode) return;
      fallbackNode.style.setProperty("--look-x", String(x));
      fallbackNode.style.setProperty("--look-y", String(y));
    },
    // 清理占位节点和引用.
    destroy() {
      mountedElement?.replaceChildren();
      mountedElement = null;
      fallbackNode = null;
    }
  };
}
