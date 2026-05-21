export type CharacterExpression =
  | "idle"
  | "smile"
  | "happy"
  | "thinking"
  | "confused"
  | "serious"
  | "notice"
  | "close"
  | "worried";

export type CharacterMotion =
  | "idle"
  | "greet"
  | "nod"
  | "shake"
  | "think"
  | "notice"
  | "success"
  | "failure"
  | "tap"
  | "drag";

export type CharacterRendererConfig = {
  vrmPath: string;
  defaultExpression: CharacterExpression;
};

export type CharacterRenderer = {
  mount: (element: HTMLElement, config: CharacterRendererConfig) => Promise<void>;
  setExpression: (expression: CharacterExpression) => void;
  playMotion: (motion: CharacterMotion) => void;
  setMouthOpen: (value: number) => void;
  lookAt: (x: number, y: number) => void;
  destroy: () => void;
};
