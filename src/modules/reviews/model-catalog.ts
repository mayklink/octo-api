export const CODEX_MODEL_OPTIONS = [
  { value: "gpt-5.6-sol-ultra", model: "GPT-5.6 Sol", level: "Ultra" },
  { value: "gpt-5.6-sol-max", model: "GPT-5.6 Sol", level: "Max" },
  { value: "gpt-5.6-sol-xhigh", model: "GPT-5.6 Sol", level: "XHigh" },
  { value: "gpt-5.6-sol-high", model: "GPT-5.6 Sol", level: "High" },
  { value: "gpt-5.6-sol-medium", model: "GPT-5.6 Sol", level: "Medium" },
  { value: "gpt-5.6-terra-ultra", model: "GPT-5.6 Terra", level: "Ultra" },
  { value: "gpt-5.6-terra-max", model: "GPT-5.6 Terra", level: "Max" },
  { value: "gpt-5.6-terra-xhigh", model: "GPT-5.6 Terra", level: "XHigh" },
  { value: "gpt-5.6-terra-high", model: "GPT-5.6 Terra", level: "High" },
  { value: "gpt-5.6-terra-medium", model: "GPT-5.6 Terra", level: "Medium" },
  { value: "gpt-5.6-luna-max", model: "GPT-5.6 Luna", level: "Max" },
  { value: "gpt-5.6-luna-xhigh", model: "GPT-5.6 Luna", level: "XHigh" },
  { value: "gpt-5.6-luna-high", model: "GPT-5.6 Luna", level: "High" },
  { value: "gpt-5.6-luna-medium", model: "GPT-5.6 Luna", level: "Medium" },
  { value: "gpt-5.6-luna-low", model: "GPT-5.6 Luna", level: "Low" },
  { value: "gpt-5.6-luna", model: "GPT-5.6 Luna", level: "Default" },
] as const;

export const CODEX_MODEL_VALUES = CODEX_MODEL_OPTIONS.map(({ value }) => value);
