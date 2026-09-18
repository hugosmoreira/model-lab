/**
 * Ollama adapter: OpenAI-compatible route against a local server.
 * Base from env OLLAMA_BASE_URL (default http://localhost:11434/v1), no key.
 */
import { OpenAiCompatibleProvider } from "./openai-compatible";

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

export class OllamaProvider extends OpenAiCompatibleProvider {
  constructor(baseUrl?: string) {
    super(
      {
        baseUrl: baseUrl ?? process.env["OLLAMA_BASE_URL"] ?? DEFAULT_OLLAMA_BASE_URL,
        apiKey: null,
      },
      "ollama",
    );
  }
}
