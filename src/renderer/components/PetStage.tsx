import { Settings, ShieldCheck } from "lucide-react";
import { useEffect, useRef } from "react";
import { createCharacterRenderer } from "../character/createCharacterRenderer";

type PetStageProps = {
  onOpenSettings: () => void;
  onToggleClickThrough: () => void;
  onControlsEnter: () => void;
  onControlsLeave: () => void;
};

const AIKO_VRM_PATH = "assets/vrm/aiko.vrm";

// 渲染桌宠角色区域和悬停工具按钮.
export function PetStage({ onOpenSettings, onToggleClickThrough, onControlsEnter, onControlsLeave }: PetStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<ReturnType<typeof createCharacterRenderer> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const renderer = createCharacterRenderer();
    rendererRef.current = renderer;
    void renderer.mount(containerRef.current, {
      vrmPath: AIKO_VRM_PATH,
      defaultExpression: "idle"
    });
    renderer.setExpression("smile");
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  // 根据鼠标位置驱动角色头部朝向.
  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
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
        onPointerMove={handlePointerMove}
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
