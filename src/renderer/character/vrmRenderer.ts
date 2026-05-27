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
  asleep: "close",
  searching: "notice",
  writing: "thinking",
  curious: "notice",
  presenting: "happy",
  shy: "smile",
  recovering: "worried",
  waiting: "notice"
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
  drag: 760,
  search: 1300,
  write: 1300,
  explain: 1500,
  celebrate: 1050,
  deny: 850,
  settle: 780,
  curious: 1200,
  ponder: 1600,
  present: 1600,
  proud: 1200,
  confused: 1100,
  shy: 1250,
  wake: 1000,
  interrupt: 700,
  dragHold: 900,
  errorRecover: 1500,
  emphasis: 850,
  idleShift: 1200,
  wait: 1100,
  focus: 1400,
  relief: 900
};

type PoseBone = { rotation: { x: number; y: number; z: number } };
type PoseBones = {
  hips: PoseBone | null | undefined;
  spine: PoseBone | null | undefined;
  chest: PoseBone | null | undefined;
  neck: PoseBone | null | undefined;
  head: PoseBone | null | undefined;
  leftUpperArm: PoseBone | null | undefined;
  rightUpperArm: PoseBone | null | undefined;
  leftLowerArm: PoseBone | null | undefined;
  rightLowerArm: PoseBone | null | undefined;
  leftHand: PoseBone | null | undefined;
  rightHand: PoseBone | null | undefined;
};

type SceneAccent = {
  x?: number;
  y?: number;
  rotationY?: number;
  rotationZ?: number;
  scale?: number;
};

type SceneRestPose = {
  x: number;
  y: number;
  rotationY: number;
  rotationZ: number;
  scale: number;
};

type SceneAccentState = {
  x: number;
  y: number;
  rotationY: number;
  rotationZ: number;
  scale: number;
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
  let sceneRestPose = createDefaultSceneRestPose();
  let sceneAccentState = createEmptySceneAccentState();
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
      sceneRestPose = readSceneRestPose(vrm);
      sceneAccentState = createEmptySceneAccentState();
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
        updateCharacterBehavior(vrm, elapsed, currentBehavior);
        updateCharacterMotion(vrm, elapsed);
        updateIdleMotion(vrm, elapsed, sceneRestPose, sceneAccentState);
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
    const bones = getPoseBones(vrm);
    const {
      hips,
      spine,
      chest,
      neck,
      head,
      leftUpperArm,
      rightUpperArm,
      leftLowerArm,
      rightLowerArm,
      leftHand,
      rightHand
    } = bones;

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
        applySceneAccent(sceneAccentState, { x: 0.01 * wave, y: 0.018 * pulse, rotationZ: 0.02 * wave });
        setOptionalBoneRotation(chest, 0.04 * pulse, 0.04 * wave, 0.05 * pulse);
        setOptionalBoneRotation(head, -0.02 * pulse, 0.05 * wave, 0.02 * wave);
        setOptionalBoneRotation(rightUpperArm, -0.38 * pulse, 0.08 * pulse, -0.32 * pulse + 0.2 * fastWave);
        setOptionalBoneRotation(leftUpperArm, 0, 0, 0.05 * pulse);
        break;
      case "nod":
        setOptionalBoneRotation(chest, 0.1 * fastWave, 0, 0);
        setOptionalBoneRotation(neck, 0.08 * fastWave, 0, 0);
        break;
      case "shake":
        setOptionalBoneRotation(chest, 0, 0.12 * fastWave, 0);
        setOptionalBoneRotation(head, 0, 0.18 * fastWave, 0);
        break;
      case "think":
        applySceneAccent(sceneAccentState, { x: -0.008 * pulse, rotationZ: -0.018 * pulse });
        setOptionalBoneRotation(chest, -0.04 * pulse, -0.05 * pulse, -0.03 * pulse);
        setOptionalBoneRotation(neck, -0.05 * pulse, -0.05 * pulse, 0.02 * pulse);
        setOptionalBoneRotation(rightUpperArm, -0.12 * pulse, 0, -0.16 * pulse);
        break;
      case "notice":
        applySceneAccent(sceneAccentState, { y: 0.02 * pulse, scale: 0.012 * pulse });
        setOptionalBoneRotation(chest, 0.08 * pulse, 0, 0);
        setOptionalBoneRotation(head, -0.03 * pulse, 0, 0);
        break;
      case "success":
        applySceneAccent(sceneAccentState, { y: 0.025 * pulse, rotationZ: 0.025 * wave, scale: 0.012 * pulse });
        setOptionalBoneRotation(chest, 0.06 * pulse, 0, 0.04 * wave);
        setOptionalBoneRotation(rightUpperArm, -0.42 * pulse, 0, -0.2 * pulse);
        setOptionalBoneRotation(leftUpperArm, -0.24 * pulse, 0, 0.18 * pulse);
        break;
      case "failure":
        applySceneAccent(sceneAccentState, { y: -0.015 * pulse, rotationZ: -0.02 * pulse });
        setOptionalBoneRotation(chest, -0.08 * pulse, 0.04 * wave, -0.04 * pulse);
        setOptionalBoneRotation(head, 0.05 * pulse, -0.03 * wave, 0.04 * pulse);
        break;
      case "tap":
        applySceneAccent(sceneAccentState, { y: 0.015 * pulse, rotationZ: 0.02 * wave });
        setOptionalBoneRotation(chest, 0.04 * pulse, 0, 0.04 * wave);
        break;
      case "drag":
      case "dragHold":
        applySceneAccent(sceneAccentState, { x: 0.02 * wave, y: 0.01 * pulse, rotationZ: 0.08 * pulse });
        setOptionalBoneRotation(hips, 0, 0, 0.04 * pulse);
        setOptionalBoneRotation(chest, 0, 0.03 * wave, 0.06 * pulse);
        setOptionalBoneRotation(leftUpperArm, 0.08 * pulse, 0, 0.08 * pulse);
        setOptionalBoneRotation(rightUpperArm, 0.08 * pulse, 0, -0.08 * pulse);
        break;
      case "search":
        applySceneAccent(sceneAccentState, { x: 0.018 * wave, rotationY: 0.05 * wave, rotationZ: 0.012 * fastWave });
        setOptionalBoneRotation(hips, 0, 0.04 * wave, -0.012 * fastWave);
        setOptionalBoneRotation(chest, -0.03 + 0.05 * pulse, 0.16 * wave, 0.025 * fastWave);
        setOptionalBoneRotation(spine, -0.015 * pulse, 0.05 * wave, 0);
        setOptionalBoneRotation(neck, -0.02 * pulse, 0.18 * wave, -0.02 * wave);
        setOptionalBoneRotation(head, 0, 0.22 * wave, -0.04 * wave);
        setOptionalBoneRotation(leftUpperArm, -0.05 * pulse, 0.03 * wave, 0.2 + 0.08 * pulse);
        setOptionalBoneRotation(rightUpperArm, -0.05 * pulse, -0.03 * wave, -0.2 - 0.08 * pulse);
        break;
      case "write":
        applySceneAccent(sceneAccentState, { x: -0.012 * pulse, y: -0.005 * pulse, rotationZ: -0.018 * pulse });
        setOptionalBoneRotation(hips, -0.02 * pulse, 0, -0.015 * pulse);
        setOptionalBoneRotation(chest, -0.05 * pulse, -0.03 * wave, -0.02 * pulse);
        setOptionalBoneRotation(neck, -0.08 * pulse, -0.02 * pulse, 0.02 * wave);
        setOptionalBoneRotation(rightUpperArm, -0.2 * pulse, 0.04, -0.24 * pulse);
        setOptionalBoneRotation(rightLowerArm, -0.22 * pulse, 0, -0.18 * fastWave);
        setOptionalBoneRotation(rightHand, 0.02 * fastWave, 0, -0.12 * fastWave);
        setOptionalBoneRotation(leftUpperArm, 0.02, 0, 0.1 * pulse);
        break;
      case "explain":
        applySceneAccent(sceneAccentState, { x: 0.012 * wave, y: 0.008 * pulse, rotationZ: 0.012 * fastWave });
        setOptionalBoneRotation(chest, 0.03 * pulse, 0.06 * wave, 0.03 * fastWave);
        setOptionalBoneRotation(neck, -0.025 * pulse, 0.05 * wave, 0.02 * wave);
        setOptionalBoneRotation(leftUpperArm, -0.12 * pulse, 0.03 * wave, 0.22 + 0.1 * fastWave);
        setOptionalBoneRotation(rightUpperArm, -0.12 * pulse, -0.03 * wave, -0.22 - 0.1 * fastWave);
        setOptionalBoneRotation(leftLowerArm, -0.08 * pulse, 0, 0.12 * wave);
        setOptionalBoneRotation(rightLowerArm, -0.08 * pulse, 0, -0.12 * wave);
        break;
      case "celebrate":
        applySceneAccent(sceneAccentState, { y: 0.045 * pulse, rotationZ: 0.06 * wave, scale: 0.018 * pulse });
        setOptionalBoneRotation(hips, 0.04 * pulse, 0, 0.02 * wave);
        setOptionalBoneRotation(chest, 0.08 * pulse, 0, 0.08 * wave);
        setOptionalBoneRotation(head, -0.04 * pulse, 0.04 * wave, 0.04 * wave);
        setOptionalBoneRotation(leftUpperArm, -0.42 * pulse, 0.05 * wave, 0.42 * pulse);
        setOptionalBoneRotation(rightUpperArm, -0.42 * pulse, -0.05 * wave, -0.42 * pulse);
        setOptionalBoneRotation(leftLowerArm, -0.2 * pulse, 0, 0.18 * fastWave);
        setOptionalBoneRotation(rightLowerArm, -0.2 * pulse, 0, -0.18 * fastWave);
        break;
      case "deny":
        applySceneAccent(sceneAccentState, { x: -0.012 * pulse, rotationZ: -0.02 * pulse });
        setOptionalBoneRotation(chest, -0.04 * pulse, 0.16 * fastWave, -0.02 * pulse);
        setOptionalBoneRotation(head, 0, 0.18 * fastWave, 0);
        setOptionalBoneRotation(leftUpperArm, 0.04, 0, 0.05 * pulse);
        setOptionalBoneRotation(rightUpperArm, 0.04, 0, -0.05 * pulse);
        break;
      case "settle":
        applySceneAccent(sceneAccentState, { y: -0.012 * pulse, rotationZ: -0.015 * pulse });
        setOptionalBoneRotation(chest, -0.035 * pulse, 0, 0.02 * wave);
        setOptionalBoneRotation(spine, -0.015 * pulse, 0, 0);
        setOptionalBoneRotation(leftUpperArm, 0.04 * pulse, 0, 0.08 * pulse);
        setOptionalBoneRotation(rightUpperArm, 0.04 * pulse, 0, -0.08 * pulse);
        break;
      case "curious":
        applySceneAccent(sceneAccentState, { x: 0.01 * pulse, y: 0.008 * pulse, rotationZ: -0.045 * pulse });
        setOptionalBoneRotation(hips, 0, 0.02 * wave, -0.018 * pulse);
        setOptionalBoneRotation(chest, -0.02 * pulse, 0.05 * wave, -0.05 * pulse);
        setOptionalBoneRotation(neck, -0.05 * pulse, 0.08 * wave, -0.12 * pulse);
        setOptionalBoneRotation(head, -0.03 * pulse, 0.08 * wave, -0.16 * pulse);
        setOptionalBoneRotation(leftUpperArm, 0.02, 0, 0.12 * pulse);
        break;
      case "ponder":
        applySceneAccent(sceneAccentState, { x: -0.008 * pulse, rotationZ: -0.02 * pulse });
        setOptionalBoneRotation(chest, -0.055 * pulse, -0.04 * pulse, -0.035 * pulse);
        setOptionalBoneRotation(neck, -0.08 * pulse, -0.04 * pulse, 0.04 * pulse);
        setOptionalBoneRotation(rightUpperArm, -0.2 * pulse, 0.02, -0.28 * pulse);
        setOptionalBoneRotation(rightLowerArm, -0.18 * pulse, 0, -0.2 * pulse);
        setOptionalBoneRotation(rightHand, 0, 0, -0.08 * pulse);
        break;
      case "present":
        applySceneAccent(sceneAccentState, { y: 0.018 * pulse, rotationZ: 0.018 * wave, scale: 0.01 * pulse });
        setOptionalBoneRotation(chest, 0.045 * pulse, 0.04 * wave, 0.025 * wave);
        setOptionalBoneRotation(neck, -0.02 * pulse, 0.04 * wave, 0.02 * wave);
        setOptionalBoneRotation(leftUpperArm, -0.22 * pulse, 0.08 * pulse, 0.34 * pulse);
        setOptionalBoneRotation(rightUpperArm, -0.22 * pulse, -0.08 * pulse, -0.34 * pulse);
        setOptionalBoneRotation(leftLowerArm, -0.12 * pulse, 0, 0.18 * pulse);
        setOptionalBoneRotation(rightLowerArm, -0.12 * pulse, 0, -0.18 * pulse);
        break;
      case "proud":
        applySceneAccent(sceneAccentState, { y: 0.024 * pulse, rotationZ: 0.018 * wave, scale: 0.014 * pulse });
        setOptionalBoneRotation(hips, 0.03 * pulse, 0, 0);
        setOptionalBoneRotation(chest, 0.095 * pulse, 0, 0.025 * wave);
        setOptionalBoneRotation(neck, -0.055 * pulse, 0, 0);
        setOptionalBoneRotation(leftUpperArm, -0.1 * pulse, 0, 0.18 * pulse);
        setOptionalBoneRotation(rightUpperArm, -0.1 * pulse, 0, -0.18 * pulse);
        break;
      case "confused":
        applySceneAccent(sceneAccentState, { x: 0.012 * wave, y: -0.008 * pulse, rotationZ: 0.05 * wave });
        setOptionalBoneRotation(chest, -0.04 * pulse, 0.09 * wave, 0.04 * wave);
        setOptionalBoneRotation(neck, 0.02 * pulse, 0.12 * wave, 0.08 * wave);
        setOptionalBoneRotation(head, 0.02 * pulse, 0.16 * wave, 0.12 * wave);
        setOptionalBoneRotation(leftUpperArm, 0.04, 0, 0.06 * pulse);
        setOptionalBoneRotation(rightUpperArm, 0.04, 0, -0.06 * pulse);
        break;
      case "shy":
        applySceneAccent(sceneAccentState, { y: -0.016 * pulse, rotationZ: -0.03 * pulse });
        setOptionalBoneRotation(hips, -0.02 * pulse, 0, -0.015 * pulse);
        setOptionalBoneRotation(chest, -0.07 * pulse, -0.035 * pulse, -0.04 * pulse);
        setOptionalBoneRotation(neck, 0.08 * pulse, -0.03 * pulse, -0.04 * pulse);
        setOptionalBoneRotation(head, 0.09 * pulse, -0.04 * pulse, -0.05 * pulse);
        setOptionalBoneRotation(leftUpperArm, 0.09 * pulse, 0, 0.16 * pulse);
        setOptionalBoneRotation(rightUpperArm, 0.09 * pulse, 0, -0.16 * pulse);
        break;
      case "wake":
        applySceneAccent(sceneAccentState, { y: 0.035 * pulse, rotationZ: -0.02 * wave, scale: 0.012 * pulse });
        setOptionalBoneRotation(chest, -0.04 + 0.12 * pulse, 0.03 * wave, 0.02 * wave);
        setOptionalBoneRotation(neck, 0.08 - 0.14 * pulse, 0.02 * wave, 0);
        setOptionalBoneRotation(head, 0.08 - 0.16 * pulse, 0.04 * wave, 0);
        break;
      case "interrupt":
        applySceneAccent(sceneAccentState, { x: -0.018 * pulse, y: -0.012 * pulse, rotationZ: -0.06 * pulse });
        setOptionalBoneRotation(chest, -0.08 * pulse, 0.2 * fastWave, -0.05 * pulse);
        setOptionalBoneRotation(neck, 0.04 * pulse, 0.16 * fastWave, 0);
        setOptionalBoneRotation(leftUpperArm, 0.1 * pulse, 0, 0.16 * pulse);
        setOptionalBoneRotation(rightUpperArm, 0.1 * pulse, 0, -0.16 * pulse);
        break;
      case "errorRecover":
        applySceneAccent(sceneAccentState, { y: -0.018 * pulse + 0.014 * Math.sin(progress * Math.PI * 3), rotationZ: -0.025 * pulse });
        setOptionalBoneRotation(chest, -0.08 * pulse + 0.035 * Math.sin(progress * Math.PI * 3), 0.03 * wave, -0.035 * pulse);
        setOptionalBoneRotation(neck, 0.08 * pulse - 0.05 * Math.sin(progress * Math.PI * 3), 0.04 * wave, 0.02 * wave);
        setOptionalBoneRotation(head, 0.06 * pulse - 0.06 * Math.sin(progress * Math.PI * 3), 0.04 * wave, 0.03 * wave);
        break;
      case "emphasis":
        applySceneAccent(sceneAccentState, { y: 0.02 * pulse, rotationZ: 0.035 * wave, scale: 0.008 * pulse });
        setOptionalBoneRotation(chest, 0.055 * pulse, 0.03 * wave, 0.035 * wave);
        setOptionalBoneRotation(neck, -0.04 * pulse, 0.03 * wave, 0);
        setOptionalBoneRotation(rightUpperArm, -0.22 * pulse, 0.04, -0.26 * pulse);
        setOptionalBoneRotation(rightLowerArm, -0.16 * pulse, 0, -0.18 * pulse);
        setOptionalBoneRotation(rightHand, -0.04 * pulse, 0, -0.16 * pulse);
        break;
      case "idleShift":
        applySceneAccent(sceneAccentState, { x: 0.012 * wave, y: 0.006 * pulse, rotationZ: 0.018 * slowEase(progress) });
        setOptionalBoneRotation(chest, 0.015 * pulse, 0.02 * wave, 0.018 * slowEase(progress));
        setOptionalBoneRotation(neck, -0.012 * pulse, 0.03 * wave, 0.012 * wave);
        setOptionalBoneRotation(leftUpperArm, 0.03 * pulse, 0, 0.05 * pulse);
        setOptionalBoneRotation(rightUpperArm, 0.03 * pulse, 0, -0.05 * pulse);
        break;
      case "wait":
        applySceneAccent(sceneAccentState, { y: 0.012 * pulse, scale: 0.006 * pulse });
        setOptionalBoneRotation(chest, 0.025 * pulse, 0, 0);
        setOptionalBoneRotation(neck, -0.02 * pulse, 0.035 * wave, 0);
        setOptionalBoneRotation(head, -0.012 * pulse, 0.04 * wave, 0);
        break;
      case "focus":
        applySceneAccent(sceneAccentState, { x: 0.008 * wave, rotationZ: -0.014 * pulse });
        setOptionalBoneRotation(chest, -0.035 * pulse, 0.03 * wave, -0.02 * pulse);
        setOptionalBoneRotation(neck, -0.045 * pulse, 0.04 * wave, 0.012 * wave);
        setOptionalBoneRotation(head, -0.025 * pulse, 0.05 * wave, 0.014 * wave);
        setOptionalBoneRotation(rightUpperArm, -0.08 * pulse, 0, -0.12 * pulse);
        break;
      case "relief":
        applySceneAccent(sceneAccentState, { y: -0.01 * pulse + 0.016 * Math.sin(progress * Math.PI * 1.5), rotationZ: 0.018 * wave });
        setOptionalBoneRotation(chest, -0.03 * pulse + 0.05 * Math.sin(progress * Math.PI * 1.5), 0, 0.02 * wave);
        setOptionalBoneRotation(neck, 0.035 * pulse - 0.04 * Math.sin(progress * Math.PI * 1.5), 0.02 * wave, 0);
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
  const {
    hips,
    spine,
    chest,
    neck,
    head,
    leftUpperArm,
    rightUpperArm,
    leftLowerArm,
    rightLowerArm,
    leftHand,
    rightHand
  } = getPoseBones(vrm);
  const wave = Math.sin(elapsed * 2.2);
  const slowWave = Math.sin(elapsed * 1.1);

  switch (behavior) {
    case "listening":
      setOptionalBoneRotation(chest, 0.02, 0.02 * slowWave, 0.018);
      setOptionalBoneRotation(neck, -0.018, 0.04 * slowWave, 0.018);
      setOptionalBoneRotation(spine, 0, 0, 0.012);
      setOptionalBoneRotation(leftUpperArm, 0.02, 0, 0.02);
      setOptionalBoneRotation(rightUpperArm, 0.02, 0, -0.02);
      break;
    case "thinking":
      setOptionalBoneRotation(chest, -0.035 + 0.01 * slowWave, -0.045, -0.025);
      setOptionalBoneRotation(spine, -0.02, -0.02, 0);
      setOptionalBoneRotation(neck, -0.04 + 0.01 * slowWave, -0.035, 0.02);
      setOptionalBoneRotation(rightUpperArm, -0.16, 0.02, -0.2);
      setOptionalBoneRotation(rightLowerArm, -0.1, 0, -0.12);
      setOptionalBoneRotation(leftUpperArm, 0.02, 0, 0.04);
      break;
    case "speaking":
      setOptionalBoneRotation(chest, 0.018 * wave, 0.026 * slowWave, 0.018 * wave);
      setOptionalBoneRotation(spine, 0, 0.012 * wave, 0);
      setOptionalBoneRotation(neck, -0.012 + 0.01 * wave, 0.026 * slowWave, 0.01 * wave);
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
    case "searching":
      setOptionalBoneRotation(chest, -0.02 + 0.012 * slowWave, 0.025 * wave, 0.018 * slowWave);
      setOptionalBoneRotation(spine, -0.012, 0.018 * slowWave, 0);
      setOptionalBoneRotation(neck, -0.018, 0.05 * wave, 0.012 * slowWave);
      setOptionalBoneRotation(leftUpperArm, 0.03, 0, 0.16 + 0.025 * wave);
      setOptionalBoneRotation(rightUpperArm, 0.03, 0, -0.16 - 0.025 * wave);
      break;
    case "writing":
      setOptionalBoneRotation(chest, -0.045 + 0.01 * slowWave, -0.018, -0.018);
      setOptionalBoneRotation(spine, -0.018, -0.01, 0);
      setOptionalBoneRotation(neck, -0.045, -0.012, 0.01 * slowWave);
      setOptionalBoneRotation(leftUpperArm, 0.02, 0, 0.08);
      setOptionalBoneRotation(rightUpperArm, -0.14 + 0.02 * wave, 0.02, -0.22);
      setOptionalBoneRotation(rightLowerArm, -0.18, 0, -0.12 + 0.03 * wave);
      setOptionalBoneRotation(rightHand, 0.02 * wave, 0, -0.08 + 0.02 * wave);
      break;
    case "curious":
      setOptionalBoneRotation(hips, 0, 0.012 * slowWave, -0.012);
      setOptionalBoneRotation(chest, -0.018, 0.025 * slowWave, -0.045);
      setOptionalBoneRotation(neck, -0.035, 0.035 * slowWave, -0.09);
      setOptionalBoneRotation(head, -0.025, 0.04 * slowWave, -0.12);
      setOptionalBoneRotation(leftUpperArm, 0.02, 0, 0.1);
      setOptionalBoneRotation(rightUpperArm, 0.02, 0, -0.04);
      break;
    case "presenting":
      setOptionalBoneRotation(chest, 0.03 + 0.014 * wave, 0.02 * slowWave, 0.012 * wave);
      setOptionalBoneRotation(neck, -0.025, 0.025 * slowWave, 0);
      setOptionalBoneRotation(leftUpperArm, -0.12 + 0.02 * wave, 0.04, 0.26);
      setOptionalBoneRotation(rightUpperArm, -0.12 - 0.02 * wave, -0.04, -0.26);
      setOptionalBoneRotation(leftLowerArm, -0.06, 0, 0.08 + 0.02 * wave);
      setOptionalBoneRotation(rightLowerArm, -0.06, 0, -0.08 - 0.02 * wave);
      break;
    case "shy":
      setOptionalBoneRotation(hips, -0.012, 0, -0.008);
      setOptionalBoneRotation(chest, -0.055 + 0.01 * slowWave, -0.018, -0.035);
      setOptionalBoneRotation(neck, 0.045, -0.018, -0.035);
      setOptionalBoneRotation(head, 0.055, -0.02, -0.045);
      setOptionalBoneRotation(leftUpperArm, 0.07, 0, 0.13);
      setOptionalBoneRotation(rightUpperArm, 0.07, 0, -0.13);
      setOptionalBoneRotation(leftHand, 0, 0, 0.08);
      setOptionalBoneRotation(rightHand, 0, 0, -0.08);
      break;
    case "recovering":
      setOptionalBoneRotation(chest, -0.05 + 0.018 * slowWave, 0.014 * wave, -0.024);
      setOptionalBoneRotation(spine, -0.018, 0, 0);
      setOptionalBoneRotation(neck, 0.035 - 0.012 * slowWave, 0.02 * wave, 0.012 * wave);
      setOptionalBoneRotation(leftUpperArm, 0.045, 0, 0.04);
      setOptionalBoneRotation(rightUpperArm, 0.045, 0, -0.04);
      break;
    case "waiting":
      setOptionalBoneRotation(chest, 0.012 + 0.01 * slowWave, 0.018 * wave, 0);
      setOptionalBoneRotation(spine, 0, 0.01 * slowWave, 0);
      setOptionalBoneRotation(neck, -0.02 + 0.006 * wave, 0.04 * slowWave, 0);
      setOptionalBoneRotation(leftUpperArm, 0.025, 0, 0.08 + 0.015 * wave);
      setOptionalBoneRotation(rightUpperArm, 0.025, 0, -0.08 - 0.015 * wave);
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

// 更新轻微待机浮动和动作回弹, 并保留 VRM 修正后的基础朝向.
function updateIdleMotion(vrm: VRM, elapsed: number, sceneRestPose: SceneRestPose, sceneAccentState: SceneAccentState) {
  decaySceneAccent(sceneAccentState);
  vrm.scene.position.x = sceneRestPose.x + sceneAccentState.x;
  vrm.scene.position.y = sceneRestPose.y + Math.sin(elapsed * 1.4) * 0.012 + sceneAccentState.y;
  vrm.scene.rotation.y = sceneRestPose.rotationY + sceneAccentState.rotationY;
  vrm.scene.rotation.z = sceneRestPose.rotationZ + sceneAccentState.rotationZ;
  vrm.scene.scale.setScalar(sceneRestPose.scale * (1 + sceneAccentState.scale));
}

// 一次性动作只写入临时偏移, 不直接覆盖 VRM 的基础朝向.
function applySceneAccent(state: SceneAccentState, accent: SceneAccent) {
  state.x += accent.x ?? 0;
  state.y += accent.y ?? 0;
  state.rotationY += accent.rotationY ?? 0;
  state.rotationZ += accent.rotationZ ?? 0;
  state.scale += accent.scale ?? 0;
  clampSceneAccent(state);
}

// 每帧衰减临时动作偏移, 让模型回到读入后的原始朝向和位置.
function decaySceneAccent(state: SceneAccentState) {
  state.x *= 0.82;
  state.y *= 0.72;
  state.rotationY *= 0.78;
  state.rotationZ *= 0.78;
  state.scale *= 0.72;
}

// 限制临时偏移范围, 防止连续动作把模型旋转或位移积累过大.
function clampSceneAccent(state: SceneAccentState) {
  state.x = clamp(state.x, -0.12, 0.12);
  state.y = clamp(state.y, -0.08, 0.08);
  state.rotationY = clamp(state.rotationY, -0.2, 0.2);
  state.rotationZ = clamp(state.rotationZ, -0.24, 0.24);
  state.scale = clamp(state.scale, -0.04, 0.04);
}

// 读取模型加载和 rotateVRM0 后的静止姿态, 后续动作都围绕它做偏移.
function readSceneRestPose(vrm: VRM): SceneRestPose {
  return {
    x: vrm.scene.position.x,
    y: vrm.scene.position.y,
    rotationY: vrm.scene.rotation.y,
    rotationZ: vrm.scene.rotation.z,
    scale: vrm.scene.scale.x || 1
  };
}

// 创建默认静止姿态, 在模型加载完成前用于初始化状态.
function createDefaultSceneRestPose(): SceneRestPose {
  return {
    x: 0,
    y: -0.76,
    rotationY: 0,
    rotationZ: 0,
    scale: 1
  };
}

// 创建空的临时动作偏移状态.
function createEmptySceneAccentState(): SceneAccentState {
  return {
    x: 0,
    y: 0,
    rotationY: 0,
    rotationZ: 0,
    scale: 0
  };
}

// 收集常用 humanoid 骨骼, 让动作编排能同时使用髋部, 头颈, 手臂和手腕.
function getPoseBones(vrm: VRM): PoseBones {
  return {
    hips: vrm.humanoid?.getNormalizedBoneNode("hips"),
    spine: vrm.humanoid?.getNormalizedBoneNode("spine"),
    chest: vrm.humanoid?.getNormalizedBoneNode("chest"),
    neck: vrm.humanoid?.getNormalizedBoneNode("neck"),
    head: vrm.humanoid?.getNormalizedBoneNode("head"),
    leftUpperArm: vrm.humanoid?.getNormalizedBoneNode("leftUpperArm"),
    rightUpperArm: vrm.humanoid?.getNormalizedBoneNode("rightUpperArm"),
    leftLowerArm: vrm.humanoid?.getNormalizedBoneNode("leftLowerArm"),
    rightLowerArm: vrm.humanoid?.getNormalizedBoneNode("rightLowerArm"),
    leftHand: vrm.humanoid?.getNormalizedBoneNode("leftHand"),
    rightHand: vrm.humanoid?.getNormalizedBoneNode("rightHand")
  };
}

// 安全设置可选骨骼的旋转, 兼容缺少对应骨骼的 VRM.
function setOptionalBoneRotation(
  bone: PoseBone | null | undefined,
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
  leftUpperArm: PoseBone | null | undefined,
  rightUpperArm: PoseBone | null | undefined,
  leftLowerArm: PoseBone | null | undefined,
  rightLowerArm: PoseBone | null | undefined
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

// 把数值限制在指定区间内.
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// 给待机小动作一个慢速缓入, 避免突然偏头或位移.
function slowEase(progress: number): number {
  return Math.sin(Math.max(0, Math.min(1, progress)) * Math.PI * 0.5);
}
