/**
 * Predefined CLI provider presets.
 * Each preset specifies the command to run and the argument template
 * for non-interactive mode. The `{prompt}` placeholder is replaced
 * with the actual prompt at runtime.
 */

export interface ProviderPreset {
  command: string;
  argsTemplate: string;
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  qwen: {
    command: "qwen",
    argsTemplate: '-p "{prompt}"',
  },
  custom: {
    command: "",
    argsTemplate: "",
  },
};

export type ProviderKey = keyof typeof PROVIDER_PRESETS;

export function getProviderPreset(key: string): ProviderPreset {
  return PROVIDER_PRESETS[key] ?? PROVIDER_PRESETS.qwen;
}
