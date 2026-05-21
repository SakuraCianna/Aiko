import { Clock, PerspectiveCamera, Scene, WebGLRenderer, AmbientLight, DirectionalLight } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import type { CharacterExpression, CharacterMotion, CharacterRenderer } from "./characterTypes";

const EXPRESSION_PRESET: Record<CharacterExpression, string> = {
  idle: "neutral",
  smile: "relaxed",
  happy: "happy",
  thinking: "relaxed",
  confused: "sad",
  serious: "neutral",
  notice: "surprised",
  close: "relaxed",
  worried: "sad"
};

// 创建基于 Three.js 和 three-vrm 的角色渲染器.
export function createVrmCharacterRenderer(): CharacterRenderer {
  let mountedElement: HTMLElement | null = null;
  let renderer: WebGLRenderer | null = null;
  let camera: PerspectiveCamera | null = null;
  let scene: Scene | null = null;
  let vrm: VRM | null = null;
  let frameId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let currentExpression: CharacterExpression = "idle";
  let mouthOpen = 0;
  let lookTarget = { x: 0, y: 0 };
  const clock = new Clock();

  return {
    // 初始化 Three.js 场景并加载 VRM 模型.
    async mount(element, config) {
      mountedElement = element;
      currentExpression = config.defaultExpression;

      scene = createScene();
      camera = createCamera(element);
      renderer = createRenderer(element);
      element.replaceChildren(renderer.domElement);

      resizeObserver = new ResizeObserver(() => resizeToElement(element, renderer, camera));
      resizeObserver.observe(element);

      vrm = await loadVrm(config.vrmPath);
      prepareVrm(vrm);
      scene.add(vrm.scene);
      applyExpression(vrm, currentExpression, mouthOpen);
      startLoop();
    },
    // 切换 VRM 表情预设.
    setExpression(expression) {
      currentExpression = expression;
      if (vrm) applyExpression(vrm, currentExpression, mouthOpen);
    },
    // 播放简单动作反馈.
    playMotion(motion) {
      if (!vrm) return;
      if (motion === "greet" || motion === "success") {
        vrm.scene.rotation.z = 0.05;
      }
      if (motion === "failure" || motion === "shake") {
        vrm.scene.rotation.z = -0.04;
      }
    },
    // 设置嘴部张开程度, 供后续 TTS 口型驱动使用.
    setMouthOpen(value) {
      mouthOpen = Math.max(0, Math.min(1, value));
      if (vrm) applyExpression(vrm, currentExpression, mouthOpen);
    },
    // 更新角色头部看向目标.
    lookAt(x, y) {
      lookTarget = {
        x: Math.max(-1, Math.min(1, x)),
        y: Math.max(-1, Math.min(1, y))
      };
    },
    // 释放动画, 监听器和 WebGL 资源.
    destroy() {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      mountedElement?.replaceChildren();
      renderer?.dispose();
      if (vrm) VRMUtils.deepDispose(vrm.scene);
      mountedElement = null;
      renderer = null;
      camera = null;
      scene = null;
      vrm = null;
    }
  };

  // 启动渲染循环, 持续更新 idle, lookAt 和 VRM 状态.
  function startLoop() {
    if (!renderer || !camera || !scene) return;
    // 执行一帧角色动画和渲染.
    const tick = () => {
      const delta = clock.getDelta();
      if (vrm) {
        updateIdleMotion(vrm, clock.elapsedTime);
        updateLookAt(vrm, lookTarget);
        vrm.update(delta);
      }
      renderer?.render(scene as Scene, camera as PerspectiveCamera);
      frameId = requestAnimationFrame(tick);
    };
    tick();
  }
}

// 创建角色渲染所需的灯光和场景.
function createScene(): Scene {
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1.8));

  const keyLight = new DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(1.5, 2.2, 2.8);
  scene.add(keyLight);

  const fillLight = new DirectionalLight(0xbfdfff, 1.1);
  fillLight.position.set(-2.0, 1.2, 1.4);
  scene.add(fillLight);
  return scene;
}

// 创建适配角色容器比例的透视相机.
function createCamera(element: HTMLElement): PerspectiveCamera {
  const camera = new PerspectiveCamera(28, aspectRatio(element), 0.1, 20);
  camera.position.set(0, 1.35, 3.1);
  return camera;
}

// 创建透明背景的 WebGL 渲染器.
function createRenderer(element: HTMLElement): WebGLRenderer {
  const renderer = new WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  resizeToElement(element, renderer);
  renderer.domElement.className = "character-canvas";
  return renderer;
}

// 从指定路径加载 VRM 模型.
async function loadVrm(vrmPath: string): Promise<VRM> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  const gltf = await loader.loadAsync(vrmPath);
  const loadedVrm = gltf.userData.vrm as VRM | undefined;
  if (!loadedVrm) throw new Error(`VRM not found in ${vrmPath}`);
  return loadedVrm;
}

// 清理并摆放 VRM 模型到桌宠视角.
function prepareVrm(vrm: VRM) {
  VRMUtils.removeUnnecessaryVertices(vrm.scene);
  VRMUtils.removeUnnecessaryJoints(vrm.scene);
  vrm.scene.rotation.y = Math.PI;
  vrm.scene.position.set(0, -0.95, 0);
}

// 应用表情和口型权重.
function applyExpression(vrm: VRM, expression: CharacterExpression, mouthOpen: number) {
  const manager = vrm.expressionManager;
  if (!manager) return;

  for (const preset of Object.values(EXPRESSION_PRESET)) {
    manager.setValue(preset, 0);
  }

  manager.setValue(EXPRESSION_PRESET[expression], 1);
  manager.setValue("aa", mouthOpen);
  manager.update();
}

// 更新轻微待机浮动和动作回弹.
function updateIdleMotion(vrm: VRM, elapsed: number) {
  vrm.scene.rotation.z *= 0.92;
  vrm.scene.position.y = -0.95 + Math.sin(elapsed * 1.4) * 0.012;
}

// 根据目标坐标调整头部朝向.
function updateLookAt(vrm: VRM, target: { x: number; y: number }) {
  const head = vrm.humanoid?.getNormalizedBoneNode("head");
  if (!head) return;

  head.rotation.y = target.x * 0.22;
  head.rotation.x = -target.y * 0.14;
}

// 根据容器尺寸同步渲染器和相机比例.
function resizeToElement(element: HTMLElement, renderer: WebGLRenderer | null, camera?: PerspectiveCamera | null) {
  const width = Math.max(1, element.clientWidth);
  const height = Math.max(1, element.clientHeight);
  renderer?.setSize(width, height, false);
  if (camera) {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

// 计算容器宽高比, 并避免除以 0.
function aspectRatio(element: HTMLElement): number {
  return Math.max(1, element.clientWidth) / Math.max(1, element.clientHeight);
}
