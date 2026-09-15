import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  devLauncherEnvironment,
  installedLauncherCandidates,
  ensureLauncherProfileForDescriptor,
  readDevChatExperimentalFeatures,
  releaseLauncherEnvironment,
  resolveDevProfilePaths,
} from "../src/dev-chat/profile";

test("DEV profile paths isolate browser, Codex, config, chat, and runtime state", () => {
  const homeDirectory = "/Users/tester";
  const devHome = resolve(homeDirectory, "development");
  const paths = resolveDevProfilePaths({
    homeDirectory,
    environment: {
      CODEX_CHATGPT_WEB_HOME: join(homeDirectory, "production"),
      CODEX_WEB_GPT_DEV_HOME: join(homeDirectory, "development"),
    },
  });
  expect(paths).toEqual({
    home: devHome,
    codexHome: join(devHome, "codex-home"),
    launcherUserData: join(devHome, "launcher"),
    launcherStatePath: join(devHome, "launcher", "launcher-state.json"),
    descriptorPath: join(devHome, "runtime", "launcher-browser.json"),
    chatsPath: join(devHome, "chats"),
    runtimePath: join(devHome, "runtime", "dev-chat"),
    configPath: join(devHome, "config.json"),
  });
});

test("Bigger Context is disabled by default and read from the isolated DEV runtime config", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-web-gpt-dev-features-"));
  try {
    const paths = resolveDevProfilePaths({
      homeDirectory: root,
      environment: { CODEX_WEB_GPT_DEV_HOME: join(root, "dev") },
    });
    expect(readDevChatExperimentalFeatures(paths)).toEqual({ biggerContext: false });
    mkdirSync(paths.home, { recursive: true });
    writeFileSync(paths.configPath, JSON.stringify({
      version: 3,
      experimentalBiggerContext: true,
    }));
    expect(readDevChatExperimentalFeatures(paths)).toEqual({ biggerContext: true });
    writeFileSync(paths.configPath, JSON.stringify({
      version: 3,
      experimentalBiggerContext: "yes",
    }));
    expect(() => readDevChatExperimentalFeatures(paths)).toThrow("Invalid Bigger Context preference");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DEV profile path refuses production home reuse", () => {
  const shared = "/Users/tester/shared";
  expect(() => resolveDevProfilePaths({
    homeDirectory: "/Users/tester",
    environment: {
      CODEX_CHATGPT_WEB_HOME: shared,
      CODEX_WEB_GPT_DEV_HOME: shared,
    },
  })).toThrow("must differ from the production");
});

test("installed launcher discovery has explicit platform candidates", () => {
  expect(installedLauncherCandidates({
    platform: "darwin",
    homeDirectory: "/Users/tester",
    environment: {},
  })).toEqual([
    "/Applications/Codex Web GPT.app/Contents/MacOS/Codex Web GPT",
    "/Users/tester/Applications/Codex Web GPT.app/Contents/MacOS/Codex Web GPT",
  ]);
  expect(installedLauncherCandidates({
    platform: "linux",
    homeDirectory: "/home/tester",
    environment: { PATH: "/usr/local/bin:/usr/bin" },
  })).toEqual([
    "/home/tester/.local/bin/codex-web-gpt",
    "/usr/local/bin/codex-web-gpt",
    "/usr/bin/codex-web-gpt",
  ]);
  expect(installedLauncherCandidates({
    platform: "win32",
    homeDirectory: "C:\\Users\\tester",
    environment: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
  })).toEqual([
    "C:\\Users\\tester\\AppData\\Local\\Programs\\Codex Web GPT\\Codex Web GPT.exe",
  ]);
  expect(installedLauncherCandidates({
    platform: "win32",
    homeDirectory: "C:\\Users\\tester",
    environment: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
    windowsInstallLocation: "D:\\Apps\\Codex Web GPT",
  })).toEqual([
    "D:\\Apps\\Codex Web GPT\\Codex Web GPT.exe",
  ]);
});

test("release launcher removes only DEV-owned profile overrides", () => {
  const devHome = "/Users/tester/development";
  expect(releaseLauncherEnvironment({
    KEEP_ME: "yes",
    CODEX_WEB_GPT_DEV_HOME: devHome,
    CODEX_CHATGPT_WEB_HOME: devHome,
    CODEX_HOME: join(devHome, "codex-home"),
    CODEX_WEB_GPT_LAUNCHER_DATA_DIR: join(devHome, "launcher"),
  })).toEqual({ KEEP_ME: "yes" });

  expect(releaseLauncherEnvironment({
    CODEX_WEB_GPT_DEV_HOME: devHome,
    CODEX_CHATGPT_WEB_HOME: "/Users/tester/explicit-release",
    CODEX_HOME: "/Users/tester/explicit-codex",
    CODEX_WEB_GPT_LAUNCHER_DATA_DIR: "/Users/tester/explicit-launcher",
  })).toEqual({
    CODEX_CHATGPT_WEB_HOME: "/Users/tester/explicit-release",
    CODEX_HOME: "/Users/tester/explicit-codex",
    CODEX_WEB_GPT_LAUNCHER_DATA_DIR: "/Users/tester/explicit-launcher",
  });
});

test("DEV launcher child cannot inherit production home or browser-profile overrides", () => {
  const paths = resolveDevProfilePaths({
    homeDirectory: "/Users/tester",
    environment: {
      CODEX_CHATGPT_WEB_HOME: "/Users/tester/production",
      CODEX_WEB_GPT_DEV_HOME: "/Users/tester/development",
    },
  });
  expect(devLauncherEnvironment(paths, {
    KEEP_ME: "yes",
    CODEX_CHATGPT_WEB_HOME: paths.home,
    CODEX_HOME: "/Users/tester/production-codex",
    CODEX_WEB_GPT_LAUNCHER_DATA_DIR: "/Users/tester/production-launcher",
  })).toEqual({
    KEEP_ME: "yes",
    CODEX_WEB_GPT_DEV_HOME: paths.home,
  });
});


test("configured non-DEV descriptor rejects a live DEV launcher instead of reusing it", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-web-gpt-cross-profile-"));
  const descriptorPath = join(root, "runtime", "launcher-browser.json");
  mkdirSync(join(root, "runtime"), { recursive: true });
  writeFileSync(descriptorPath, JSON.stringify({
    version: 2,
    kind: "codex-web-gpt-launcher",
    profile: "development",
    pid: process.pid,
    endpoint: "http://127.0.0.1:39991",
    control: { endpoint: "http://127.0.0.1:39992", token: "launcher-control-token-0123456789abcdefghijklmnop" },
    helper: { executable: process.execPath, script: __filename },
    partition: "persist:codex-web-gpt-dev-chatgpt",
    idleUrl: "data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Chtml%3E%3Chead%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Ctitle%3ECodex%20Web%20GPT%3C%2Ftitle%3E%3C%2Fhead%3E%3Cbody%3E%3C%2Fbody%3E%3C%2Fhtml%3E#codex-web-gpt-browser-host",
    surfaceId: "launcher_surface_id_0123456789AB",
    createdAt: new Date().toISOString(),
  }) + "\n", { mode: 0o600 });
  try {
    await expect(ensureLauncherProfileForDescriptor(descriptorPath, { executable: process.execPath })).rejects.toThrow(
      "belongs to development, but production was required",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dead production descriptor starts and then reuses only the production launcher", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-web-gpt-launcher-recovery-"));
  const descriptorPath = join(root, "runtime", "launcher-browser.json");
  const launcherScript = join(root, "fake-launcher.cjs");
  const launcherExecutable = join(root, "fake-launcher");
  mkdirSync(join(root, "runtime"), { recursive: true });
  writeFileSync(launcherScript, `#!/usr/bin/env bun
    const { mkdirSync, writeFileSync } = require("node:fs");
    const descriptorPath = process.env.TEST_LAUNCHER_DESCRIPTOR;
    mkdirSync(require("node:path").dirname(descriptorPath), { recursive: true });
    writeFileSync(descriptorPath, JSON.stringify({
      version: 2,
      kind: "codex-web-gpt-launcher",
      profile: "production",
      pid: process.pid,
      endpoint: "http://127.0.0.1:39991",
      control: { endpoint: "http://127.0.0.1:39992", token: "launcher-control-token-0123456789abcdefghijklmnop" },
      helper: { executable: process.execPath, script: __filename },
      partition: "persist:codex-web-gpt-chatgpt",
      idleUrl: ${JSON.stringify("data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Chtml%3E%3Chead%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Ctitle%3ECodex%20Web%20GPT%3C%2Ftitle%3E%3C%2Fhead%3E%3Cbody%3E%3C%2Fbody%3E%3C%2Fhtml%3E#codex-web-gpt-browser-host")},
      surfaceId: "launcher_surface_id_0123456789AB",
      createdAt: new Date().toISOString(),
    }) + "\\n", { mode: 0o600 });
    setInterval(() => {}, 1000);
  `, { mode: 0o600 });
  writeFileSync(launcherExecutable, `#!/bin/sh
exec ${process.execPath} ${launcherScript}\n`, { mode: 0o700 });
  writeFileSync(descriptorPath, JSON.stringify({
    version: 2,
    kind: "codex-web-gpt-launcher",
    profile: "production",
    pid: 999999,
    endpoint: "http://127.0.0.1:39991",
    control: { endpoint: "http://127.0.0.1:39992", token: "launcher-control-token-0123456789abcdefghijklmnop" },
    helper: { executable: process.execPath, script: launcherScript },
    partition: "persist:codex-web-gpt-chatgpt",
    idleUrl: "data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Chtml%3E%3Chead%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Ctitle%3ECodex%20Web%20GPT%3C%2Ftitle%3E%3C%2Fhead%3E%3Cbody%3E%3C%2Fbody%3E%3C%2Fhtml%3E#codex-web-gpt-browser-host",
    surfaceId: "launcher_surface_id_0123456789AB",
    createdAt: new Date().toISOString(),
  }) + "\n", { mode: 0o600 });
  const previous = process.env.TEST_LAUNCHER_DESCRIPTOR;
  process.env.TEST_LAUNCHER_DESCRIPTOR = descriptorPath;
  try {
    const launched = await ensureLauncherProfileForDescriptor(descriptorPath, {
      executable: launcherExecutable,
      timeoutMs: 5_000,
    });
    expect(launched.alreadyRunning).toBe(false);
    expect(launched.descriptor.profile).toBe("production");
    expect(launched.descriptor.partition).toBe("persist:codex-web-gpt-chatgpt");
    expect(launched.descriptor.pid).not.toBe(999999);

    const reused = await ensureLauncherProfileForDescriptor(descriptorPath, {
      executable: launcherExecutable,
      timeoutMs: 5_000,
    });
    expect(reused.alreadyRunning).toBe(true);
    expect(reused.descriptor.pid).toBe(launched.descriptor.pid);
    process.kill(launched.descriptor.pid, "SIGTERM");
  } finally {
    if (previous === undefined) delete process.env.TEST_LAUNCHER_DESCRIPTOR;
    else process.env.TEST_LAUNCHER_DESCRIPTOR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
