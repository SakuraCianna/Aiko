export type AikoExpression =
  | "idle"
  | "smile"
  | "happy"
  | "thinking"
  | "confused"
  | "serious"
  | "notice"
  | "close"
  | "worried";

export type AikoMotion =
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

export type Live2DModelConfig = {
  modelJsonPath: string;
  defaultExpression: AikoExpression;
};
