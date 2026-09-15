export interface ChatGptWebAdapterErrorOptions {
  status: number;
  errorType: string;
  code: string;
  retryable: boolean;
  cause?: unknown;
}

export class ChatGptWebAdapterError extends Error {
  readonly status: number;
  readonly errorType: string;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, options: ChatGptWebAdapterErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ChatGptWebAdapterError";
    this.status = options.status;
    this.errorType = options.errorType;
    this.code = options.code;
    this.retryable = options.retryable;
  }
}

export const CHATGPT_UPSTREAM_GENERATION_STALLED_CODE = "upstream_generation_stalled";

/**
 * Collect the bounded `cause` chain of a failure, plus the member messages of an aggregate error,
 * so logs and diagnostics can show why a stage failed instead of only the friendly wrapper message.
 */
export function chatGptErrorCauseChain(error: unknown, limit = 6): string[] {
  const chain: string[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown): void => {
    if (value === undefined || value === null || chain.length >= limit || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Error) {
      const detail = value.message.trim();
      chain.push(detail.length > 0 ? `${value.name}: ${detail}` : value.name);
      visit((value as { cause?: unknown }).cause);
      const aggregated = (value as { errors?: unknown }).errors;
      if (Array.isArray(aggregated)) {
        for (const nested of aggregated) visit(nested);
      }
      return;
    }
    chain.push(String(value));
  };
  visit(error);
  return chain;
}

export function chatGptUpstreamGenerationStalledError(): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    "ChatGPT remained in a running state without semantic output or Codex tool activity; retrying once on a fresh browser surface.",
    {
      status: 503,
      errorType: "server_error",
      code: CHATGPT_UPSTREAM_GENERATION_STALLED_CODE,
      retryable: true,
    },
  );
}

export function chatGptBrowserTabClosedError(): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    "The ChatGPT browser tab was closed, so the Codex turn was cancelled.",
    {
      status: 499,
      errorType: "client_closed_request",
      code: "client_cancelled",
      retryable: false,
    },
  );
}

export function chatGptStoppedThinkingError(): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    "ChatGPT remained in 'Stopped thinking' for 5 seconds, so the Codex turn was cancelled.",
    {
      status: 499,
      errorType: "client_closed_request",
      code: "client_cancelled",
      retryable: false,
    },
  );
}

export function chatGptRetainedConversationUnavailableError(): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    "The retained ChatGPT conversation is no longer available.",
    {
      status: 409,
      errorType: "invalid_request_error",
      code: "compaction_source_unavailable",
      retryable: false,
    },
  );
}
