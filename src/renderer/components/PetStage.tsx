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
const GLOBAL_LOOK_INTERVAL_MS = 60;
const DRAG_START_DISTANCE_PX = 4;

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
  const draggingRef = useRef(false);
  const dragCandidateRef = useRef<{ pointerId: number; screenX: number; screenY: number } | null>(null);
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

    // 定时读取系统鼠标位置, 让角色在鼠标离开窗口后仍然能看向光标.
    async function updateGlobalLookTarget() {
      if (inFlight || draggingRef.current) return;
      inFlight = true;
      try {
        const cursorState = await window.aiko.getCursorState();
        if (!disposed) lookAtCursorState(cursorState);
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

  // 鼠标按住角色区域时开始移动桌宠窗口.
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    dragCandidateRef.current = {
      pointerId: event.pointerId,
      screenX: event.screenX,
      screenY: event.screenY
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  // 根据鼠标位置驱动角色头部朝向, 拖拽时同步移动窗口.
  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    rendererRef.current?.lookAt(x, y);

    const candidate = dragCandidateRef.current;
    if (!draggingRef.current && candidate?.pointerId === event.pointerId) {
      const movedX = event.screenX - candidate.screenX;
      const movedY = event.screenY - candidate.screenY;
      if (Math.hypot(movedX, movedY) >= DRAG_START_DISTANCE_PX) {
        draggingRef.current = true;
        rendererRef.current?.setBehavior("dragging");
        rendererRef.current?.playMotion("drag");
        void window.aiko.startWindowDrag({ screenX: candidate.screenX, screenY: candidate.screenY });
        return;
      }
    }

    if (draggingRef.current) {
      void window.aiko.moveWindowDrag({ screenX: event.screenX, screenY: event.screenY });
    }
  }

  // 鼠标松开或取消时结束窗口拖拽.
  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const wasDragging = draggingRef.current;
    draggingRef.current = false;
    dragCandidateRef.current = null;
    if (!wasDragging) {
      rendererRef.current?.playMotion("tap");
    }

    if (!wasDragging) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    rendererRef.current?.playMotion("tap");
    rendererRef.current?.setBehavior(behavior);
    void window.aiko.endWindowDrag();
  }

  // 把屏幕坐标转换成角色渲染器使用的 -1 到 1 视线坐标.
  function lookAtCursorState(cursorState: CursorState) {
    if (cursorState.windowWidth <= 0 || cursorState.windowHeight <= 0) return;
    const x = ((cursorState.screenX - cursorState.windowX) / cursorState.windowWidth - 0.5) * 2;
    const y = ((cursorState.screenY - cursorState.windowY) / cursorState.windowHeight - 0.5) * 2;
    rendererRef.current?.lookAt(x, y);
  }

  return (
    <section className="pet-stage">
      <div
        ref={containerRef}
        className="character-stage"
        aria-label="Aiko VRM preview"
        onMouseEnter={onControlsEnter}
        onMouseLeave={onControlsLeave}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
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
