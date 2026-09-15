import type { Locator, Page } from "playwright-core";
import {
  assertAuthenticatedChatGptPage,
  CHATGPT_COMPOSER_SELECTOR,
  CHATGPT_EFFORT_CONTROL_SELECTOR,
  activateChatGptEffortMenu,
  parseChatGptEffortSliderState,
} from "../../chatgpt-session";
import { ChatGptWebAdapterError } from "./adapter-error";

export const CHATGPT_WORK_HOME_URL = "https://chatgpt.com/";
const ASTRA_LABEL = "GPT-6 Astra";
const MEDIUM_INDEX = 1;

function unavailable(detail: string): Error {
  return new ChatGptWebAdapterError(`ChatGPT Work Astra Medium is unavailable: ${detail}`, {
    status: 400, errorType: "invalid_request_error", code: "work_model_unavailable", retryable: false,
  });
}

async function confirm(check: () => Promise<boolean>, detail: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  do {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw unavailable(detail);
}

function modelControl(page: Page): Locator {
  return page.locator(CHATGPT_COMPOSER_SELECTOR).filter({ visible: true })
    .locator("xpath=ancestor::form[1]")
    .locator(CHATGPT_EFFORT_CONTROL_SELECTOR).filter({ visible: true }).last();
}

/** Work has no Temporary Chat picker. Only navigate a newly leased or explicitly refreshed tab. */
export async function prepareChatGptWorkSurface(
  page: Page,
  capture?: (checkpoint: string) => Promise<void>,
): Promise<void> {
  if (page.url() !== CHATGPT_WORK_HOME_URL) {
    await page.goto(CHATGPT_WORK_HOME_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  }
  const work = page.getByRole("radio", { name: "Work", exact: true });
  try {
    await work.waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    throw unavailable("the account did not expose the Work switch");
  }
  await assertAuthenticatedChatGptPage(page);
  if (await work.getAttribute("aria-checked") !== "true") await work.click();
  await confirm(() => work.getAttribute("aria-checked").then(value => value === "true"), "Work was not selected");
  await page.locator(CHATGPT_COMPOSER_SELECTOR).filter({ visible: true })
    .waitFor({ state: "visible", timeout: 30_000 });
  await capture?.("work-surface-ready");
}

/** Exact model selection precedes effort: Default's slider maps to a different model at each step. */
export async function selectChatGptWorkAstraMedium(
  page: Page,
  capture?: (checkpoint: string) => Promise<void>,
): Promise<void> {
  const control = modelControl(page);
  await control.waitFor({ state: "visible", timeout: 30_000 });
  const { slider } = await activateChatGptEffortMenu(page, control);
  // Scope the whole picker; the generic helper may return a nested model-list group.
  const menu = page.getByTestId("composer-intelligence-picker-content").filter({ visible: true });
  const selectModel = menu.getByRole("menuitem", { name: "Select model", exact: true });
  const advanced = menu.getByTestId("composer-model-picker-slider-advanced-view");
  if (await advanced.getAttribute("data-active") !== "true") await selectModel.click();
  const astra = menu.getByRole("menuitemradio", { name: ASTRA_LABEL, exact: true });
  try {
    await astra.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    await page.keyboard.press("Escape");
    throw unavailable("GPT-6 Astra is not offered in the Work model list");
  }
  if (!await astra.isEnabled() || await astra.getAttribute("aria-disabled") === "true") {
    await page.keyboard.press("Escape");
    throw unavailable("GPT-6 Astra is disabled for this account");
  }
  await astra.click();
  // The selected row becomes inert when the picker returns to its simple view.
  const checkedAstra = menu.locator('[role="menuitemradio"]').filter({ hasText: /^GPT-6 Astra$/ });
  await confirm(() => checkedAstra.getAttribute("aria-checked").then(value => value === "true"), "the picker did not confirm GPT-6 Astra");
  await slider.waitFor({ state: "visible", timeout: 5_000 });
  const readState = async () => parseChatGptEffortSliderState(
    await slider.getAttribute("aria-valuemin"),
    await slider.getAttribute("aria-valuemax"),
    await slider.getAttribute("aria-valuenow"),
  );
  let state = await readState();
  // Observed explicit Astra picker: Low, Medium, High, Extra High, Max (0..4).
  // Fail closed on a changed layout instead of selecting an unrelated power level.
  if (!state || state.min !== 0 || state.max !== 4) throw unavailable("Astra's effort slider range changed");
  const power = slider.locator("xpath=ancestor::*[@role='menuitem'][1]");
  for (let step = 0; state.value !== MEDIUM_INDEX && step < 4; step++) {
    const direction = state.value < MEDIUM_INDEX ? 1 : -1;
    const expected = state.value + direction;
    await power.press(direction === 1 ? "ArrowRight" : "ArrowLeft");
    await confirm(async () => (await readState())?.value === expected, "the effort slider did not move one step");
    state = (await readState())!;
  }
  if (state.value !== MEDIUM_INDEX) throw unavailable("Medium effort was not selected");
  await page.keyboard.press("Escape");
  await assertChatGptWorkAstraMedium(page);
  await capture?.("work-astra-medium-selected");
}

/** Recheck immediately before submission; a label alone is not used to select the model. */
export async function assertChatGptWorkAstraMedium(page: Page): Promise<void> {
  await confirm(async () => {
    const label = (await modelControl(page).innerText()).replace(/\s+/g, " ").trim();
    return /^GPT-6 Astra\s*Medium$/.test(label);
  }, "the composer no longer shows GPT-6 Astra Medium");
}
