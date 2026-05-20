import { Settings, ShieldCheck } from "lucide-react";
import { useEffect, useRef } from "react";
import { createLive2DAdapter } from "../live2d/live2dAdapter";

type PetStageProps = {
  onOpenSettings: () => void;
  onToggleClickThrough: () => void;
  onControlsEnter: () => void;
  onControlsLeave: () => void;
};

export function PetStage({ onOpenSettings, onToggleClickThrough, onControlsEnter, onControlsLeave }: PetStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const adapter = createLive2DAdapter();
    void adapter.mount(containerRef.current, {
      modelJsonPath: "assets/live2d/test.model3.json",
      defaultExpression: "idle"
    });
    adapter.setExpression("smile");
    return () => adapter.destroy();
  }, []);

  return (
    <section className="pet-stage">
      <div
        ref={containerRef}
        className="live2d-placeholder"
        aria-label="Aiko Live2D preview"
        onMouseEnter={onControlsEnter}
        onMouseLeave={onControlsLeave}
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
