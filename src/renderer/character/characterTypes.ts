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
  | "drag"
  | "search"
  | "write"
  | "explain"
  | "celebrate"
  | "deny"
  | "settle"
  | "curious"
  | "ponder"
  | "present"
  | "proud"
  | "confused"
  | "shy"
  | "wake"
  | "interrupt"
  | "dragHold"
  | "errorRecover"
  | "emphasis";

export type CharacterBehavior =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "dragging"
  | "confirming"
  | "success"
  | "failure"
  | "asleep"
  | "searching"
  | "writing"
  | "curious"
  | "presenting"
  | "shy"
  | "recovering";

export type CharacterRendererConfig = {
  vrmPath: string;
  defaultExpression: CharacterExpression;
};

export type CharacterRenderer = {
  mount: (element: HTMLElement, config: CharacterRendererConfig) => Promise<void>;
  setExpression: (expression: CharacterExpression) => void;
  setBehavior: (behavior: CharacterBehavior) => void;
  playMotion: (motion: CharacterMotion) => void;
  setMouthOpen: (value: number) => void;
  lookAt: (x: number, y: number) => void;
  destroy: () => void;
};
