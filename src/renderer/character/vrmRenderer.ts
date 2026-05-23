import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, Timer, WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import type { CharacterBehavior, CharacterExpression, CharacterMotion, CharacterRenderer } from "./characterTypes";

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

const BEHAVIOR_EXPRESSION: Record<CharacterBehavior, CharacterExpression> = {
  idle: "smile",
  listening: "notice",
  thinking: "thinking",
  speaking: "happy",
  dragging: "notice",
  confirming: "serious",
  success: "happy",
  failure: "worried",
  asleep: "close"
};

type ActiveMotion = {
  motion: CharacterMotion;
  startedAt: number;
  duration: number;
};

const MOTION_DURATION_MS: Record<CharacterMotion, number> = {
  idle: 0,
  greet: 1200,
  nod: 820,
  shake: 720,
  think: 1400,
  notice: 900,
  success: 900,
  failure: 900,
  tap: 520,
  drag: 760
};

const RELAXED_LEFT_UPPER_ARM_ROTATION = { x: 0.08, y: 0, z: 0.72 };
const RELAXED_RIGHT_UPPER_ARM_ROTATION = { x: 0.08, y: 0, z: -0.72 };
const RELAXED_LEFT_LOWER_ARM_ROTATION = { x: 0.04, y: 0, z: 0.08 };
const RELAXED_RIGHT_LOWER_ARM_ROTATION = { x: 0.04, y: 0, z: -0.08 };
const LOOK_RESPONSE_RATE = 14;

// 创建基于 Three.js 和 three-vrm 的角色渲染器.
export function createVrmCharacterRenderer(): CharacterRenderer {
  let mountedElement: HTMLElement | null = null;
  let renderer: WebGLRenderer | null = null;
  let camera: PerspectiveCamera | null = null;
  let scene: Scene | null = null;
  let vrm: VRM | null = null;
  let frameId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let destroyed = false;
  let currentExpression: CharacterExpression = "idle";
  let currentBehavior: CharacterBehavior = "idle";
  let mouthOpen = 0;
  let lookTarget = { x: 0, y: 0 };
  let currentLookTarget = { x: 0, y: 0 };
  let activeMotion: ActiveMotion | null = null;
  let warnedMissingHead = false;
  const timer = new Timer();
  timer.connect(document);

  return {
    // 初始化 Three.js 场景并加载 VRM 模型.
    async mount(element, config) {
      destroyed = false;
      timer.reset();
      mountedElement = element;
      currentExpression = config.defaultExpression;
      lookTarget = { x: 0, y: 0 };
      currentLookTarget = { x: 0, y: 0 };
      console.log(`[aiko:vrm] preparing renderer, container=${element.clientWidth}x${element.clientHeight}`);
      if (element.clientWidth <= 1 || element.clientHeight <= 1) {
        console.warn("[aiko:vrm] character container is very small before resize");
      }

      scene = createScene();
      camera = createCamera(element);
      renderer = createRenderer(element);
      element.replaceChildren(renderer.domElement);

      resizeObserver = new ResizeObserver(() => resizeToElement(element, renderer, camera));
      resizeObserver.observe(element);

      const loadedVrm = await loadVrm(config.vrmPath);
      if (destroyed) {
        console.warn("[aiko:vrm] VRM loaded after renderer was destroyed");
        VRMUtils.deepDispose(loadedVrm.scene);
        return;
      }

      vrm = loadedVrm;
      prepareVrm(vrm);
      scene.add(vrm.scene);
      applyExpression(vrm, currentExpression, mouthOpen);
      console.log("[aiko:vrm] VRM added to scene and render loop will start");
      startLoop();
    },
    // 切换 VRM 表情预设.
    setExpression(expression) {
      currentExpression = expression;
      if (vrm) applyExpression(vrm, currentExpression, mouthOpen);
    },
    // 切换角色持续行为状态, 例如思考, 说话或拖拽.
    setBehavior(behavior) {
      currentBehavior = behavior;
      currentExpression = BEHAVIOR_EXPRESSION[behavior];
      if (vrm) applyExpression(vrm, currentExpression, mouthOpen);
    },
    // 播放一个带持续时间的角色动作.
    playMotion(motion) {
      if (motion === "idle") {
        activeMotion = null;
        return;
      }
      activeMotion = {
        motion,
        startedAt: timer.getElapsed(),
        duration: MOTION_DURATION_MS[motion] / 1000
      };
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
      destroyed = true;
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
      activeMotion = null;
    }
  };

  // 启动渲染循环, 持续更新 idle, lookAt, motion 和 VRM 状态.
  function startLoop() {
    if (destroyed || !renderer || !camera || !scene) return;

    // 执行一帧角色动画和渲染.
    const tick = (timestamp?: number) => {
      if (destroyed || !renderer || !camera || !scene) {
        frameId = null;
        return;
      }

      timer.update(timestamp);
      const delta = timer.getDelta();
      const elapsed = timer.getElapsed();
      if (vrm) {
        updateIdleMotion(vrm, elapsed);
        updateCharacterBehavior(vrm, elapsed, currentBehavior);
        updateCharacterMotion(vrm, elapsed);
        smoothLookTarget(delta);
        updateLookAt(vrm, currentLookTarget);
        applyExpression(vrm, currentExpression, resolveMouthOpen(elapsed, currentBehavior, mouthOpen));
        vrm.update(delta);
      }
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(tick);
    };
    tick();
  }

  // 根据目标坐标调整头部朝向.
  function updateLookAt(vrm: VRM, target: { x: number; y: number }) {
    const head = vrm.humanoid?.getNormalizedBoneNode("head");
    if (!head) {
      if (!warnedMissingHead) {
        console.warn("[aiko:vrm] humanoid head bone is missing");
        warnedMissingHead = true;
      }
      return;
    }

    head.rotation.y = target.x * 0.22;
    head.rotation.x = -target.y * 0.14;
  }

  // 用指数插值平滑视线目标, 避免鼠标轮询低频时头部一卡一卡地跳.
  function smoothLookTarget(delta: number) {
    const factor = 1 - Math.exp(-LOOK_RESPONSE_RATE * delta);
    currentLookTarget = {
      x: currentLookTarget.x + (lookTarget.x - currentLookTarget.x) * factor,
      y: currentLookTarget.y + (lookTarget.y - currentLookTarget.y) * factor
    };
  }

  // 根据当前动作状态调整躯干和手臂姿态.
  function updateCharacterMotion(vrm: VRM, elapsed: number) {
    const chest = vrm.humanoid?.getNormalizedBoneNode("chest");
    const spine = vrm.humanoid?.getNormalizedBoneNode("spine");
    const leftUpperArm = vrm.humanoid?.getNormalizedBoneNode("leftUpperArm");
    const rightUpperArm = vrm.humanoid?.getNormalizedBoneNode("rightUpperArm");

    if (!activeMotion) {
      return;
    }

    const progress = Math.min(1, (elapsed - activeMotion.startedAt) / activeMotion.duration);
    const pulse = Math.sin(progress * Math.PI);
    const wave = Math.sin(progress * Math.PI * 2);
    const fastWave = Math.sin(progress * Math.PI * 4);

    if (progress >= 1) {
      activeMotion = null;
      return;
    }

    switch (activeMotion.motion) {
      case "greet":
        setOptionalBoneRotation(chest, 0.04 * pulse, 0.04 * wave, 0.05 * pulse);
        setOptionalBoneRotation(rightUpperArm, -0.38 * pulse, 0.08 * pulse, -0.32 * pulse + 0.2 * fastWave);
        setOptionalBoneRotation(leftUpperArm, 0, 0, 0.05 * pulse);
        break;
      case "nod":
        setOptionalBoneRotation(chest, 0.1 * fastWave, 0, 0);
        break;
      case "shake":
        setOptionalBoneRotation(chest, 0, 0.12 * fastWave, 0);
        break;
      case "think":
        setOptionalBoneRotation(chest, -0.04 * pulse, -0.05 * pulse, -0.03 * pulse);
        setOptionalBoneRotation(rightUpperArm, -0.12 * pulse, 0, -0.16 * pulse);
        break;
      case "notice":
        setOptionalBoneRotation(chest, 0.08 * pulse, 0, 0);
        break;
      case "success":
        setOptionalBoneRotation(chest, 0.06 * pulse, 0, 0.04 * wave);
        setOptionalBoneRotation(rightUpperArm, -0.42 * pulse, 0, -0.2 * pulse);
        setOptionalBoneRotation(leftUpperArm, -0.24 * pulse, 0, 0.18 * pulse);
        break;
      case "failure":
        setOptionalBoneRotation(chest, -0.08 * pulse, 0.04 * wave, -0.04 * pulse);
        break;
      case "tap":
        setOptionalBoneRotation(chest, 0.04 * pulse, 0, 0.04 * wave);
        break;
      case "drag":
        setOptionalBoneRotation(chest, 0, 0.03 * wave, 0.06 * pulse);
        setOptionalBoneRotation(leftUpperArm, 0.08 * pulse, 0, 0.08 * pulse);
        setOptionalBoneRotation(rightUpperArm, 0.08 * pulse, 0, -0.08 * pulse);
        break;
      case "idle":
        activeMotion = null;
        break;
      default:
        activeMotion = null;
    }
  }
}

// 根据持续行为调整角色的基础姿态.
function updateCharacterBehavior(vrm: VRM, elapsed: number, behavior: CharacterBehavior) {
  const chest = vrm.humanoid?.getNormalizedBoneNode("chest");
  const spine = vrm.humanoid?.getNormalizedBoneNode("spine");
  const leftUpperArm = vrm.humanoid?.getNormalizedBoneNode("leftUpperArm");
  const rightUpperArm = vrm.humanoid?.getNormalizedBoneNode("rightUpperArm");
  const leftLowerArm = vrm.humanoid?.getNormalizedBoneNode("leftLowerArm");
  const rightLowerArm = vrm.humanoid?.getNormalizedBoneNode("rightLowerArm");
  const wave = Math.sin(elapsed * 2.2);
  const slowWave = Math.sin(elapsed * 1.1);

  switch (behavior) {
    case "listening":
      setOptionalBoneRotation(chest, 0.02, 0.02 * slowWave, 0.018);
      setOptionalBoneRotation(spine, 0, 0, 0.012);
      setOptionalBoneRotation(leftUpperArm, 0.02, 0, 0.02);
      setOptionalBoneRotation(rightUpperArm, 0.02, 0, -0.02);
      break;
    case "thinking":
      setOptionalBoneRotation(chest, -0.035 + 0.01 * slowWave, -0.045, -0.025);
      setOptionalBoneRotation(spine, -0.02, -0.02, 0);
      setOptionalBoneRotation(rightUpperArm, -0.16, 0.02, -0.2);
      setOptionalBoneRotation(rightLowerArm, -0.1, 0, -0.12);
      setOptionalBoneRotation(leftUpperArm, 0.02, 0, 0.04);
      break;
    case "speaking":
      setOptionalBoneRotation(chest, 0.018 * wave, 0.026 * slowWave, 0.018 * wave);
      setOptionalBoneRotation(spine, 0, 0.012 * wave, 0);
      setOptionalBoneRotation(leftUpperArm, 0.04 * slowWave, 0, 0.08 + 0.03 * wave);
      setOptionalBoneRotation(rightUpperArm, 0.04 * slowWave, 0, -0.08 - 0.03 * wave);
      break;
    case "dragging":
      setOptionalBoneRotation(chest, 0, 0.02 * wave, 0.06);
      setOptionalBoneRotation(spine, 0, 0, 0.02);
      setOptionalBoneRotation(leftUpperArm, 0.08, 0, 0.1);
      setOptionalBoneRotation(rightUpperArm, 0.08, 0, -0.1);
      break;
    case "confirming":
      setOptionalBoneRotation(chest, 0.01, 0, 0);
      setOptionalBoneRotation(spine, 0, 0, 0);
      setRelaxedArmPose(leftUpperArm, rightUpperArm, leftLowerArm, rightLowerArm);
      break;
    case "success":
      setOptionalBoneRotation(chest, 0.035 + 0.012 * wave, 0, 0.025 * slowWave);
      setOptionalBoneRotation(leftUpperArm, -0.16, 0, 0.18);
      setOptionalBoneRotation(rightUpperArm, -0.2, 0, -0.2);
      break;
    case "failure":
      setOptionalBoneRotation(chest, -0.045, 0.015 * slowWave, -0.03);
      setOptionalBoneRotation(spine, -0.02, 0, 0);
      setOptionalBoneRotation(leftUpperArm, 0.04, 0, 0.02);
      setOptionalBoneRotation(rightUpperArm, 0.04, 0, -0.02);
      break;
    case "asleep":
      setOptionalBoneRotation(chest, -0.06 + 0.015 * slowWave, 0, -0.035);
      setOptionalBoneRotation(spine, -0.025, 0, 0);
      setOptionalBoneRotation(leftUpperArm, 0.06, 0, 0.03);
      setOptionalBoneRotation(rightUpperArm, 0.06, 0, -0.03);
      break;
    case "idle":
    default:
      setOptionalBoneRotation(chest, 0, 0, Math.sin(elapsed * 1.2) * 0.012);
      setOptionalBoneRotation(spine, 0, 0, 0);
      setRelaxedArmPose(leftUpperArm, rightUpperArm, leftLowerArm, rightLowerArm);
  }
}

// 根据说话状态生成临时口型, 后续可替换为真实 TTS 音素驱动.
function resolveMouthOpen(elapsed: number, behavior: CharacterBehavior, manualMouthOpen: number) {
  if (manualMouthOpen > 0) return manualMouthOpen;
  if (behavior !== "speaking") return 0;
  return 0.18 + Math.max(0, Math.sin(elapsed * 15)) * 0.55;
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
  camera.position.set(0, 0.62, 4.0);
  camera.lookAt(0, 0.02, 0);
  return camera;
}

// 创建透明背景的 WebGL 渲染器.
function createRenderer(element: HTMLElement): WebGLRenderer {
  const renderer = new WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
  renderer.setClearColor(0x000000, 0);
  resizeToElement(element, renderer);
  renderer.domElement.className = "character-canvas";
  console.log(`[aiko:vrm] WebGL renderer created, webgl2=${renderer.capabilities.isWebGL2}`);
  return renderer;
}

// 从指定路径加载 VRM 模型.
async function loadVrm(vrmPath: string): Promise<VRM> {
  console.log(`[aiko:vrm] loading VRM asset: ${vrmPath}`);
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  const gltf = await loader.loadAsync(vrmPath);
  const loadedVrm = gltf.userData.vrm as VRM | undefined;
  if (!loadedVrm) {
    console.error(`[aiko:vrm] GLTF loaded but userData.vrm is missing: ${vrmPath}`);
    throw new Error(`VRM not found in ${vrmPath}`);
  }
  console.log(`[aiko:vrm] VRM asset loaded: ${vrmPath}`);
  return loadedVrm;
}

// 清理并摆放 VRM 模型到桌宠视角.
function prepareVrm(vrm: VRM) {
  VRMUtils.removeUnnecessaryVertices(vrm.scene);
  VRMUtils.combineSkeletons(vrm.scene);
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.position.set(0, -0.76, 0);
}

// 应用表情和口型权重.
function applyExpression(vrm: VRM, expression: CharacterExpression, mouthOpen: number) {
  const manager = vrm.expressionManager;
  if (!manager) {
    console.warn("[aiko:vrm] expression manager is missing");
    return;
  }

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
  vrm.scene.position.y = -0.76 + Math.sin(elapsed * 1.4) * 0.012;
}

// 安全设置可选骨骼的旋转, 兼容缺少对应骨骼的 VRM.
function setOptionalBoneRotation(
  bone: { rotation: { x: number; y: number; z: number } } | null | undefined,
  x: number,
  y: number,
  z: number
) {
  if (!bone) return;
  bone.rotation.x = x;
  bone.rotation.y = y;
  bone.rotation.z = z;
}

// 把 VRM 默认 T-pose 手臂压成更像桌宠待机的放松姿态.
function setRelaxedArmPose(
  leftUpperArm: { rotation: { x: number; y: number; z: number } } | null | undefined,
  rightUpperArm: { rotation: { x: number; y: number; z: number } } | null | undefined,
  leftLowerArm: { rotation: { x: number; y: number; z: number } } | null | undefined,
  rightLowerArm: { rotation: { x: number; y: number; z: number } } | null | undefined
) {
  setOptionalBoneRotation(
    leftUpperArm,
    RELAXED_LEFT_UPPER_ARM_ROTATION.x,
    RELAXED_LEFT_UPPER_ARM_ROTATION.y,
    RELAXED_LEFT_UPPER_ARM_ROTATION.z
  );
  setOptionalBoneRotation(
    rightUpperArm,
    RELAXED_RIGHT_UPPER_ARM_ROTATION.x,
    RELAXED_RIGHT_UPPER_ARM_ROTATION.y,
    RELAXED_RIGHT_UPPER_ARM_ROTATION.z
  );
  setOptionalBoneRotation(
    leftLowerArm,
    RELAXED_LEFT_LOWER_ARM_ROTATION.x,
    RELAXED_LEFT_LOWER_ARM_ROTATION.y,
    RELAXED_LEFT_LOWER_ARM_ROTATION.z
  );
  setOptionalBoneRotation(
    rightLowerArm,
    RELAXED_RIGHT_LOWER_ARM_ROTATION.x,
    RELAXED_RIGHT_LOWER_ARM_ROTATION.y,
    RELAXED_RIGHT_LOWER_ARM_ROTATION.z
  );
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
