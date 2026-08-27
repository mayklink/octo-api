export const CODEX_MODEL_OPTIONS = [
  { value: "gpt-5.6-sol", model: "GPT-5.6 Sol" },
  { value: "gpt-5.6-terra", model: "GPT-5.6 Terra" },
  { value: "gpt-5.6-luna", model: "GPT-5.6 Luna" },
] as const;

export const CODEX_MODEL_VALUES = CODEX_MODEL_OPTIONS.map(({ value }) => value);
