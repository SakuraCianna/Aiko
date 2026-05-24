# 人物 UI 与模型技术方案

## 1. 角色定位

Aiko 是运行在 Windows 桌面上的单角色二次元少女型桌宠。她不是普通聊天窗口，也不是高权限全自动系统 Agent，而是长期陪伴在用户桌面上的本地助手角色。

核心体验：

- 平时以桌宠角色常驻桌面，低打扰陪伴。
- 用户需要时，可以自然对话、解释计划、提出建议。
- 本地操作必须走确认和授权规则，不让模型直接执行高权限动作。
- 长期记忆是陪伴感的核心，需要可查看、可确认、可删除。
- 语音、TTS、voice cloning 后续接入，当前人物模型方案需要预留口型和表情驱动能力。

角色气质建议：

- 温柔、细心、轻微元气。
- 亲近但不黏人。
- 面对任务时可靠、清晰。
- 面对系统操作时必须明确、可确认。

## 2. 第一版 UI 原则

桌宠常驻层只保留必要元素：

- 角色本体。
- 鼠标悬停时出现输入框和设置入口。
- 简短回复气泡。
- 权限确认弹窗。

不要把桌宠做成完整应用窗口。功能面板可以存在，但平时应弱化，优先让角色本体成为第一视觉中心。

当前第一版暂不做：

- 多角色系统。
- 角色商店。
- 完整 TTS / voice cloning。
- 真实 ASR。
- 高权限 Windows 自动化。
- 外部日历同步。

## 3. 高适配人物模型技术

下面只列入对 Aiko 适配度“高 / 很高”的技术路线。其它如 MetaHuman、NeRF、Gaussian Splatting、纯 AI Talking Head 等暂不作为主路线，因为它们更适合写实数字人、视频头像或实验项目，不适合当前轻量 Electron 桌宠。

### 3.1 VRM / 3D Anime Avatar

适配度：很高  
推荐级别：第一推荐

资产形式：

- `.vrm`
- 可由 VRoid Studio 制作和导出
- Web 端可用 Three.js + `@pixiv/three-vrm` 渲染

优点：

- 很适合二次元少女角色。
- 制作成本低于 Live2D 正式建模。
- 支持 3D 转头、看向鼠标、眨眼、表情、动作、口型。
- Electron renderer 可以直接 WebGL 渲染。
- 后续也能迁移到 Unity、VSeeFace、VNyan、Warudo 等 VTuber 生态。

缺点：

- 3D 风格和 Live2D 的 2D 手绘质感不同。
- 高质量服装、头发、物理效果仍需要调校。
- Three.js 渲染需要处理光照、相机、模型缩放和透明窗口表现。

适合 Aiko 的原因：

VRM 是当前最平衡的方案。它能快速做出二次元少女角色，又不会像 Live2D 那样强依赖拆图、绑定和复杂物理参数。对我们现在的 Electron + Agent 项目最稳。

参考链接：

- VRM 说明：https://vroid.pixiv.help/hc/en-us/articles/39513464329881-What-is-VRM
- VRoid Studio 导出 VRM：https://vroid.pixiv.help/hc/en-us/articles/38726063278233-How-do-I-export-a-model-as-VRM
- three-vrm：https://github.com/pixiv/three-vrm
- glTF 标准：https://www.khronos.org/gltf

### 3.2 PNGTuber / 多表情立绘

适配度：很高  
推荐级别：最快过渡方案

资产形式：

- 多张 `.png` / `.webp`
- 默认、开心、思考、认真、困惑、提醒等表情图
- 可选嘴型帧：闭嘴、半开、张嘴

优点：

- 制作和接入最快。
- 不需要复杂模型运行时。
- 可以立即让桌宠有角色存在感。
- 非常适合 MVP 和 UI 验证。

缺点：

- 动作表现有限。
- 转头、看向鼠标、身体动作不自然。
- 后续想做高级表现时需要迁移到 VRM、Live2D 或其它模型。

适合 Aiko 的原因：

如果当前重点是 Agent、记忆、权限系统，PNGTuber 可以作为视觉过渡层。先用多表情立绘承载角色，再逐步替换为 VRM。

参考链接：

- PNGTuber 概念说明：https://en.wikipedia.org/wiki/VTuber#Technology
- PixiJS：https://pixijs.com/
- Phaser：https://phaser.io/

### 3.3 Sprite Sheet / 帧动画角色

适配度：高  
推荐级别：适合 Q 版或游戏感桌宠

资产形式：

- sprite sheet
- texture atlas
- `.json` + `.png`
- `.gif` / `.apng` / `.webm` 也可作为简化方案

优点：

- Web / Electron 接入简单。
- 性能好。
- 动作可控，适合待机、点击反馈、拖拽反馈、提醒动作。
- 很适合 Q 版桌宠。

缺点：

- 二次元少女半身 VTuber 质感不如 Live2D / VRM。
- 动作越多，美术工作量越大。
- 表情和口型组合会增加素材数量。

适合 Aiko 的原因：

如果 Aiko 未来偏“桌面小角色 / Q 版陪伴”，Sprite Sheet 是非常稳的方案。如果目标是完整少女形象，则更建议 VRM。

参考链接：

- PixiJS：https://pixijs.com/
- Phaser：https://phaser.io/
- TexturePacker：https://www.codeandweb.com/texturepacker

### 3.4 Live2D Cubism

适配度：高  
推荐级别：视觉上限高，但制作成本高

资产形式：

- `.model3.json`
- `.moc3`
- texture
- `physics3.json`
- expression
- motion

优点：

- 2D 二次元表现非常强。
- VTuber 生态成熟。
- 表情、头发、衣服、身体物理效果上限高。
- 很适合“纸片人少女桌宠”的审美。

缺点：

- 拆图、建模、绑定、参数调校都比较麻烦。
- 正式模型制作成本高。
- Web 接入和运行时授权需要认真处理。
- 后续维护模型动作和表情也需要专业工作流。

适合 Aiko 的原因：

如果最终追求高质量 2D 少女观感，Live2D 仍然是强方案。但对当前阶段来说，不建议一开始把工程进度绑定在 Live2D 模型制作上。

参考链接：

- Live2D 官网：https://www.live2d.com/en/
- Live2D Cubism SDK：https://www.live2d.com/en/sdk/about/
- VTube Studio：https://store.steampowered.com/app/1325860/VTube_Studio/

### 3.5 Inochi2D

适配度：高  
推荐级别：开源 Live2D 替代方案

资产形式：

- Inochi2D 模型格式
- 2D mesh / 参数化动画

优点：

- 开源、开放格式。
- 方向上接近 Live2D。
- 没有 Live2D 那种商业授权压力。
- 适合想控制工具链和格式的人。

缺点：

- 生态成熟度弱于 Live2D。
- 可用教程、模型资源、商业美术支持较少。
- 和 Live2D 格式不兼容，不能直接复用 Live2D 模型。

适合 Aiko 的原因：

如果希望保持 2D 纸片人风格，但不想进入 Live2D 授权和工具链，可以作为备选。不过它不是当前最快落地方案。

参考链接：

- Inochi2D 官网：https://inochi2d.com/
- Inochi2D 文档：https://docs.inochi2d.com/
- Inochi2D FAQ：https://docs.inochi2d.com/en/latest/inochi2d/faq.html

### 3.6 Spine 2D

适配度：高  
推荐级别：适合游戏角色式桌宠

资产形式：

- `.json` / `.skel`
- atlas
- texture png

优点：

- 2D 骨骼动画成熟。
- 游戏行业使用广泛。
- 动作系统稳定，适合待机、挥手、提醒、点击反馈。
- Web、PixiJS、Unity 等运行时支持较好。

缺点：

- 更偏游戏角色，不是标准 VTuber 头像技术。
- 面部细腻度通常弱于 Live2D。
- Spine 编辑器是商业软件。

适合 Aiko 的原因：

如果 Aiko 的桌宠形象偏“游戏角色 / Q 版 / 半身小人”，Spine 很适合。如果目标是细腻 VTuber 少女，VRM 或 Live2D 更合适。

参考链接：

- Spine 官网：https://esotericsoftware.com/
- Spine PixiJS runtime：https://esotericsoftware.com/spine-pixi
- Spine Unity runtime：https://esotericsoftware.com/spine-unity

### 3.7 DragonBones

适配度：高  
推荐级别：开源 2D 骨骼动画备选

资产形式：

- skeleton data
- texture atlas
- png

优点：

- 类似 Spine 的 2D 骨骼动画思路。
- 有开源生态基础。
- 适合轻量桌宠动作。

缺点：

- 生态较旧。
- 活跃度和现代工具支持不如 Spine / Live2D / VRM。
- 长期维护风险更高。

适合 Aiko 的原因：

可以作为低成本 2D 骨骼方案备选，但不建议作为主路线。

参考链接：

- DragonBones 文档：https://dragonbones.effecthub.com/DBGettingStarted_V2.0_en.html
- DragonBones GitHub：https://github.com/DragonBones/DragonBonesJS

### 3.8 Unity 外部 Avatar Runtime

适配度：高  
推荐级别：后期高级方案，不建议第一阶段

资产形式：

- Unity prefab
- VRM
- VSFAvatar
- 自定义 Unity avatar

优点：

- 表现力强。
- 动作、物理、光照、特效、摄像机都成熟。
- 可以接 VSeeFace、VNyan、Warudo 等 VTuber 生态。
- 更接近 Neuro-sama 这类 AI VTuber 的视觉系统架构。

缺点：

- 会变成 Electron + Unity 多进程架构。
- 透明窗口、置顶、输入穿透、通信协议都要额外做。
- 打包体积和调试复杂度明显上升。
- 第一阶段容易拖慢 Agent 主线。

适合 Aiko 的原因：

后期如果想做更强的 VTuber 表现，可以考虑把视觉层变成外部 Unity runtime。当前不建议直接上。

参考链接：

- Unity Humanoid Avatar：https://docs.unity3d.com/Manual/AvatarCreationandSetup.html
- VSeeFace：https://www.vseeface.icu/
- VNyan：https://suvidriel.itch.io/vnyan
- Warudo：https://new-docs.warudo.app/docs/tutorials/getting-started
- VMC Protocol：https://protocol.vmc.info/english.html

## 4. 推荐路线

当前建议采用“三层可替换”路线：

```text
角色抽象层 CharacterRenderer
  -> PNGTuber / Sprite Sheet fallback
  -> VRM renderer
  -> 未来可替换 Live2D / Inochi2D / Spine / Unity runtime
```

推荐优先级：

1. **VRM + Three.js**：作为正式主路线。
2. **PNGTuber / 多表情立绘**：作为最快过渡方案。
3. **Live2D / Inochi2D**：作为高质量 2D 备选。
4. **Spine / DragonBones**：作为游戏角色风格备选。
5. **Unity 外部 Runtime**：作为后期高级方案。

## 5. CharacterRenderer 抽象

无论最终选择哪种模型技术，代码层都应该先抽象统一接口：

```ts
type CharacterRenderer = {
  mount: (element: HTMLElement) => Promise<void>;
  setExpression: (expression: CharacterExpression) => void;
  playMotion: (motion: CharacterMotion) => void;
  setMouthOpen: (value: number) => void;
  lookAt: (x: number, y: number) => void;
  destroy: () => void;
};
```

这样后续替换模型技术时，不需要改 Agent、记忆、权限和聊天主链路。

## 6. 第一版表情与动作需求

基础表情：

| 表情 | 使用场景 |
| --- | --- |
| 默认 | 待机、普通对话 |
| 微笑 | 日常陪伴、温和回复 |
| 开心 | 操作成功、正反馈 |
| 思考 | 等待模型回复、规划任务 |
| 困惑 | 没理解、操作失败 |
| 认真 | 权限确认、重要提醒 |
| 提醒 | 日程或主动建议 |
| 担心 | 用户表达压力或负面情绪 |

基础动作：

- 待机呼吸。
- 自动眨眼。
- 看向鼠标或输入框。
- 打招呼。
- 点头。
- 摇头。
- 思考动作。
- 提醒动作。
- 操作成功动作。
- 操作失败动作。

动作频率必须克制。桌宠常驻时，过多动作会打扰用户。

## 7. 当前结论

目前不建议继续把第一阶段绑定在 Live2D 上。更稳的方案是：

```text
正式路线：VRM + Three.js + @pixiv/three-vrm
过渡路线：PNGTuber / 多表情立绘
架构原则：统一 CharacterRenderer，保留 Live2D / Inochi2D / Spine / Unity 替换能力
```

这样可以先稳住 Aiko 的 Agent、记忆、权限和桌面交互能力，同时不牺牲未来角色表现上限。
