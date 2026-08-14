#!/usr/bin/env node

import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.resolve(
  process.env.HOF_CONFIG_FILE ?? path.join(SCRIPT_DIR, "service_config.json")
);

const LOGIN_URL =
  process.env.HOF_LOGIN_URL ??
  "https://passport.thehof.gg/hall-of-fame-web/login";

const PROFILE_DIR = path.resolve(
  process.env.HOF_PROFILE_DIR ?? path.join(SCRIPT_DIR, ".browser-profile")
);

const AUTH_FILE = path.resolve(
  process.env.HOF_AUTH_FILE ?? path.join(SCRIPT_DIR, ".auth/thehof.json")
);

const USER_SELECTOR =
  process.env.HOF_USER_SELECTOR ??
  'input[name="username"], input[type="email"]';

const PASSWORD_SELECTOR =
  process.env.HOF_PASSWORD_SELECTOR ??
  'input[name="password"], input[type="password"]';

const SUBMIT_SELECTOR = process.env.HOF_SUBMIT_SELECTOR ?? null;

async function loadCredentials() {
  let config;

  try {
    config = JSON.parse(await fs.readFile(CONFIG_FILE, "utf8"));
  } catch (error) {
    throw new Error(`อ่าน config ไม่สำเร็จ (${CONFIG_FILE}): ${error.message}`);
  }

  const username = String(config.username ?? "").trim();
  const password = String(config.password ?? "");

  if (!username || !password) {
    throw new Error(
      `ต้องกำหนด username และ password ใน ${CONFIG_FILE}`
    );
  }

  return { username, password };
}

async function waitForEnter(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await rl.question(`${message}\n`);
  rl.close();
}

async function clickLogin(page) {
  if (SUBMIT_SELECTOR) {
    await page.locator(SUBMIT_SELECTOR).click();
    return;
  }

  const namedButton = page.getByRole("button", {
    name: /login|log in|sign in|เข้าสู่ระบบ/i,
  });

  if (await namedButton.count()) {
    await namedButton.first().click();
    return;
  }

  await page.locator('button[type="submit"], input[type="submit"]').first().click();
}

async function waitForLoginPage(page) {
  const usernameInput = page.locator(USER_SELECTOR).first();

  try {
    await usernameInput.waitFor({ state: "visible", timeout: 15_000 });
    return;
  } catch {
    console.log("หน้าแรกเป็น Cloudflare challenge/interstitial");
    await waitForEnter(
      "ทำ Cloudflare challenge ใน browser ให้เสร็จจนเห็นฟอร์ม login แล้วกด Enter ที่ terminal"
    );
    await usernameInput.waitFor({ state: "visible", timeout: 120_000 });
  }
}

const { username, password } = await loadCredentials();

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1440, height: 900 },
});

const page = context.pages()[0] ?? (await context.newPage());

try {
  await page.goto(LOGIN_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  await waitForLoginPage(page);

  await page.locator(USER_SELECTOR).first().fill(username);
  await page.locator(PASSWORD_SELECTOR).first().fill(password);

  const hasTurnstile =
    (await page.locator('iframe[src*="challenges.cloudflare.com"]').count()) > 0;
  console.log("ตรวจพบ Cloudflare Turnstile iframe:", hasTurnstile);

  if (hasTurnstile) {
    await waitForEnter(
      "ทำ CAPTCHA ใน browser ให้เสร็จ แล้วกด Enter ที่ terminal"
    );
  }

  await clickLogin(page);

  await page.waitForURL(
    (url) => !url.pathname.includes("/login"),
    { timeout: 180_000 }
  );

  await fs.mkdir(path.dirname(AUTH_FILE), { recursive: true });
  await context.storageState({ path: AUTH_FILE });

  console.log("Login flow complete");
  console.log("Current URL:", page.url());
  console.log("Saved auth state:", AUTH_FILE);
} finally {
  await context.close();
}
