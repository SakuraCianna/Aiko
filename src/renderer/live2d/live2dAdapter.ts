import type { AikoExpression, AikoMotion, Live2DModelConfig } from "./live2dState";

export type Live2DAdapter = {
  mount: (element: HTMLElement, config: Live2DModelConfig) => Promise<void>;
  setExpression: (expression: AikoExpression) => void;
  playMotion: (motion: AikoMotion) => void;
  setMouthOpen: (value: number) => void;
  destroy: () => void;
};

export function createLive2DAdapter(): Live2DAdapter {
  let mountedElement: HTMLElement | null = null;
  let fallbackNode: HTMLDivElement | null = null;

  return {
    async mount(element, config) {
      mountedElement = element;
      fallbackNode = document.createElement("div");
      fallbackNode.className = "live2d-fallback";
      fallbackNode.textContent = `Live2D: ${config.modelJsonPath || "test model"}`;
      element.replaceChildren(fallbackNode);
    },
    setExpression(expression) {
      if (fallbackNode) fallbackNode.dataset.expression = expression;
    },
    playMotion(motion) {
      if (fallbackNode) fallbackNode.dataset.motion = motion;
    },
    setMouthOpen(value) {
      if (fallbackNode) fallbackNode.style.setProperty("--mouth-open", String(value));
    },
    destroy() {
      mountedElement?.replaceChildren();
      mountedElement = null;
      fallbackNode = null;
    }
  };
}
