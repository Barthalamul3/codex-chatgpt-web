import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isChatGptTransientCompactionFailure } from "../src/adapters/chatgpt-web/index";

const source = readFileSync(
  new URL("../src/adapters/chatgpt-web/index.ts", import.meta.url),
  "utf8",
);

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
