import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isChatGptTransientCompactionFailure } from "../src/adapters/chatgpt-web/index";

const source = readFileSync(
  new URL("../src/adapters/chatgpt-web/index.ts", import.meta.url),
  "utf8",
);

import {
  CHATGPT_SUBMISSION_EVIDENCE_RETRY_WINDOW_MAX_MS,
  CHATGPT_SUBMISSION_EVIDENCE_RETRY_WINDOW_MS,
  chatGptSubmissionEvidenceWindowMs,
} from "../src/adapters/chatgpt-web/browser-worker";
import {
  CHATGPT_COMPOSER_SINGLE_MESSAGE_CHARS,
  estimateChatGptWebInputChars,
} from "../src/adapters/chatgpt-web/usage";

test("a compaction turn failure is retried on a fresh turn, bounded by a limit", () => {
  expect(source).toContain("CHATGPT_COMPACTION_TURN_ATTEMPT_LIMIT = 3");
  expect(source).toContain("CHATGPT_COMPACTION_RETRY_PAUSE_MS");
  expect(source).toContain("retained compaction fallback retry=");
  expect(source).toContain("runCompactionFallbackAttempt(reason, attempt)");
});

test("transient web-UI faults are retried but rate limits and protocol failures are not", () => {
  const transient = [
    "ChatGPT did not accept the submitted message after 4 attempts (retainedChars=1120)",
    "ChatGPT response DOM disappeared while the browser turn was active",
    "ChatGPT multipart stage stalled (expected=\"CODEX_MULTIPART_ACK 7/8\")",
    "ChatGPT stopped generating but did not expose its completed-turn action",
    "page.evaluate: Target page, context or browser has been closed",
    "ChatGPT left a popover covering the composer, so the staged text could not be submitted",
  ];
  for (const detail of transient) {
    expect(isChatGptTransientCompactionFailure(new Error(detail))).toBe(true);
  }
  const permanent = [
    "ChatGPT rate limit: too many requests. Try again in a few minutes.",
    "ChatGPT model controls are unavailable. Reload ChatGPT and retry the task.",
  ];
  for (const detail of permanent) {
    expect(isChatGptTransientCompactionFailure(new Error(detail))).toBe(false);
  }
});

const workerSource = readFileSync(
  new URL("../src/adapters/chatgpt-web/browser-worker.ts", import.meta.url),
  "utf8",
);

test("a running-stall verdict needs a live read that proves the response stopped growing", () => {
  // A cached response snapshot can lag newly streamed text, so the stall clock is keyed to the
  // best-so-far response length and re-checked against the live assistant turn before failing.
  expect(workerSource).toContain("let bestResponseChars = 0;");
  expect(workerSource).toContain("running-stall verdict reset by live response text");
  expect(workerSource).toContain("bestResponseChars");
  expect(workerSource).toContain('domError.includes("running state without response progress")');
});

test("a long paste gets a longer submission window before the next press", () => {
  expect(chatGptSubmissionEvidenceWindowMs(0)).toBe(CHATGPT_SUBMISSION_EVIDENCE_RETRY_WINDOW_MS);
  expect(chatGptSubmissionEvidenceWindowMs(67_655)).toBeGreaterThan(
    CHATGPT_SUBMISSION_EVIDENCE_RETRY_WINDOW_MS,
  );
  expect(chatGptSubmissionEvidenceWindowMs(50_000_000))
    .toBe(CHATGPT_SUBMISSION_EVIDENCE_RETRY_WINDOW_MAX_MS);
});

test("a payload above the comfortable paste size leaves the single-message transport", () => {
  expect(CHATGPT_COMPOSER_SINGLE_MESSAGE_CHARS).toBe(40_000);
  // The browser payload estimate counts the request as the composer would receive it.
  expect(estimateChatGptWebInputChars({
    modelId: "gpt-5.6",
    context: { input: [{ type: "message", role: "user", content: "x".repeat(50_000) }] },
    stream: false,
    options: {},
  } as never)).toBeGreaterThan(CHATGPT_COMPOSER_SINGLE_MESSAGE_CHARS);
});
