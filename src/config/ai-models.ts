// Verified 2026-10-05 against OpenRouter's public catalog and Groq Free Plan limits.
// Allowed IDs are not default selections. Select a model via environment variables.
export const FREE_MODELS = {
  openrouter: ['qwen/qwen3.8-27b:free', 'nvidia/nemotron-3.5-lightning:free', 'liquid/lfm-2.5-2.6b:free'],
  groq: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'],
} as const;
export type AIProviderName = keyof typeof FREE_MODELS;
export function assertFreeModel(provider: AIProviderName, model: string): void {
  if (!(FREE_MODELS[provider] as readonly string[]).includes(model) || (provider === 'openrouter' && !model.endsWith(':free')))
    throw new Error(`Configured ${provider} model is not allowed because only allowlisted free models are permitted.`);
}
export function validateAIConfig(input: Record<string, unknown>) {
  const provider = String(input.AI_PROVIDER || '').trim();
  if (provider && provider !== 'openrouter' && provider !== 'groq') throw new Error('AI_PROVIDER must be openrouter or groq.');
  const openrouterModel = String(input.OPENROUTER_MODEL || '').trim();
  const groqModel = String(input.GROQ_MODEL || '').trim();
  if (openrouterModel) assertFreeModel('openrouter', openrouterModel);
  if (groqModel) assertFreeModel('groq', groqModel);
  const confirmed = String(input.GROQ_FREE_TIER_CONFIRMED || 'false').trim();
  if (!['true', 'false'].includes(confirmed)) throw new Error('GROQ_FREE_TIER_CONFIRMED must be true or false.');
  if (provider === 'groq' && confirmed !== 'true') throw new Error('Groq requires GROQ_FREE_TIER_CONFIRMED=true after verifying the account uses the Free Plan.');
  return { AI_PROVIDER: provider as AIProviderName | '', OPENROUTER_MODEL: openrouterModel, GROQ_MODEL: groqModel, GROQ_FREE_TIER_CONFIRMED: confirmed === 'true' };
}
