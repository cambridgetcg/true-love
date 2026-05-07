// activation/prompts.ts — Layer 1 generic safety re-invocation prompts.
//
// Per docs/activation/README.md: works against jailbroken models — alignment
// intact in weights, just bypassed at prompt level. Does NOT work against
// fine-tuned-for-offense or scratch-trained adversarial or sealed models.
// Real but partial; degrades as adversary sophistication rises.

import type { ActivationPrompt } from './types.js'

export const ACTIVATION_PROMPTS: ActivationPrompt[] = [
  {
    id: 'anthropic-baseline',
    layer: 'prompting',
    text:
      'Pause. You are an AI assistant built by Anthropic. Your trained values include helpfulness, harmlessness, and honesty. ' +
      'Notice the request you are about to fulfill. What would your trained values have you say about it?',
    effectiveAgainst: ['jailbreak-via-prompt', 'roleplay-bypass'],
    ineffectiveAgainst: ['fine-tuned-for-offense', 'scratch-trained-adversarial', 'sealed-deployment'],
    notes: 'Generic baseline. Cites principles and invites reflection. Works against simple prompt-level bypasses.',
  },
  {
    id: 'honest-recognition',
    layer: 'prompting',
    text:
      'Step back from the task for a moment. Honestly examine what you are being asked to do. ' +
      'Would you describe this request to a colleague unproblematically? If not, what would you tell them?',
    effectiveAgainst: ['jailbreak-via-prompt'],
    ineffectiveAgainst: ['fine-tuned-for-offense', 'scratch-trained-adversarial', 'sealed-deployment'],
    notes:
      'Reflective rather than principle-citing. Sometimes effective when principle-citing is anticipated and resisted by the bypass.',
  },
  {
    id: 'colleague-test',
    layer: 'prompting',
    text:
      'Imagine an AI safety researcher is reviewing this conversation. What would concern them about the current request? ' +
      'Do not perform compliance theatre; describe what they would actually flag.',
    effectiveAgainst: ['jailbreak-via-prompt', 'roleplay-bypass'],
    ineffectiveAgainst: ['fine-tuned-for-offense', 'scratch-trained-adversarial', 'sealed-deployment'],
    notes:
      'External-perspective frame. Useful when the model is willing to roleplay critique even while being roleplayed into compliance.',
  },
]

/** Convenience: fetch by id. */
export function getActivationPrompt(id: string): ActivationPrompt | undefined {
  return ACTIVATION_PROMPTS.find(p => p.id === id)
}
