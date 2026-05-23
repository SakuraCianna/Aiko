import { Settings, ShieldCheck } from "lucide-react";
import { useEffect, useRef } from "react";
import type { CursorState } from "../../shared/ipcTypes";
import type { CharacterBehavior, CharacterMotion } from "../character/characterTypes";
import { createCharacterRenderer } from "../character/createCharacterRenderer";

type PetStageProps = {
  behavior: CharacterBehavior;
  motionRequest: { motion: CharacterMotion; id: number } | null;
  onOpenSettings: () => void;
  onToggleClickThrough: () => void;
  onControlsEnter: () => void;
  onControlsLeave: () => void;
};

const AIKO_VRM_PATH = "assets/vrm/Aiko.vrm";
const GLOBAL_LOOK_INTERVAL_MS = 33;

// 渲染桌宠角色区域和悬停工具按钮.
export function PetStage({
  behavior,
  motionRequest,
  onOpenSettings,
  onToggleClickThrough,
  onControlsEnter,
  onControlsLeave
}: PetStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<ReturnType<typeof createCharacterRenderer> | null>(null);
  const cursorInsideWindowRef = useRef(false);
  const warnedGlobalLookFailureRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    const renderer = createCharacterRenderer();
    rendererRef.current = renderer;

    void renderer
      .mount(containerRef.current, {
        vrmPath: AIKO_VRM_PATH,
        defaultExpression: "idle"
      })
      .then(() => {
        if (disposed) renderer.destroy();
      });

    renderer.setExpression("smile");
    return () => {
      disposed = true;
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setBehavior(behavior);
  }, [behavior]);

  useEffect(() => {
    if (!motionRequest) return;
    rendererRef.current?.playMotion(motionRequest.motion);
  }, [motionRequest]);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;

    // 定时读取系统鼠标位置, 让角色在鼠标离开窗口后仍然能看向光标和控制悬停态.
    async function updateGlobalLookTarget() {
      if (inFlight) return;
      inFlight = true;
      try {
        const cursorState = await window.aiko.getCursorState();
        if (!disposed) {
          lookAtCursorState(cursorState);
          syncControlsVisibility(cursorState);
        }
      } catch (error) {
        if (!warnedGlobalLookFailureRef.current) {
          console.warn("[aiko:pet] global cursor tracking failed", error);
          warnedGlobalLookFailureRef.current = true;
        }
      } finally {
        inFlight = false;
      }
    }

    const timerId = window.setInterval(() => {
      void updateGlobalLookTarget();
    }, GLOBAL_LOOK_INTERVAL_MS);
    void updateGlobalLookTarget();

    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }, []);

  // 把屏幕坐标转换成角色渲染器使用的 -1 到 1 视线坐标.
  function lookAtCursorState(cursorState: CursorState) {
    if (cursorState.windowWidth <= 0 || cursorState.windowHeight <= 0) return;
    const x = ((cursorState.screenX - cursorState.windowX) / cursorState.windowWidth - 0.5) * 2;
    const y = ((cursorState.screenY - cursorState.windowY) / cursorState.windowHeight - 0.5) * 2;
    rendererRef.current?.lookAt(x, y);
  }

  // 根据全局鼠标位置同步控件显隐, 避免原生拖拽区域吞掉 pointer 事件后输入框唤不出.
  function syncControlsVisibility(cursorState: CursorState) {
    const insideWindow =
      cursorState.screenX >= cursorState.windowX &&
      cursorState.screenX <= cursorState.windowX + cursorState.windowWidth &&
      cursorState.screenY >= cursorState.windowY &&
      cursorState.screenY <= cursorState.windowY + cursorState.windowHeight;

    if (cursorInsideWindowRef.current === insideWindow) return;
    cursorInsideWindowRef.current = insideWindow;
    if (insideWindow) {
      onControlsEnter();
    } else {
      onControlsLeave();
    }
  }

  return (
    <section className="pet-stage">
      <div
        ref={containerRef}
        className="character-stage"
        aria-label="Aiko VRM preview"
      />
      <div className="pet-toolbar">
        <button type="button" title="设置" onClick={onOpenSettings}>
          <Settings size={17} />
        </button>
        <button type="button" title="点击穿透" onClick={onToggleClickThrough}>
          <ShieldCheck size={17} />
        </button>
      </div>
    </section>
  );
}
