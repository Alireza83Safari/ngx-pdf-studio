/** AI copilot (ROADMAP فاز ۳): pluggable provider + validate→repair pipeline. */
export {
  ClaudeProvider,
  type ClaudeProviderOptions,
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions,
  type CopilotMessage,
  type CopilotProvider,
} from './provider';
export {
  generateTemplate,
  extractJson,
  TEMPLATE_CONTRACT,
  type GenerateOptions,
  type GenerateResult,
} from './generate';
