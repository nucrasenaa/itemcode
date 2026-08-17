#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { launch } from "cloakbrowser/puppeteer";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.resolve(
  process.env.HOF_CONFIG_FILE ?? path.join(SCRIPT_DIR, "service_config.json")
);
const LOGIN_URL =
  process.env.HOF_LOGIN_URL ??
  "https://passport.thehof.gg/hall-of-fame-web/login";
const SHOW_CHROMIUM =
  process.argv.includes("--show-chromium") || process.env.HOF_HEADLESS !== "true";
const USE_SECONDARY = process.env.HOF_ACCOUNT === "secondary";
const TURNSTILE_INPUT_SELECTOR = 'input[name="cf-turnstile-response"]';
const TURNSTILE_WRAPPER_SELECTOR =
  'div:has(> div > div > input[name="cf-turnstile-response"])';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseConfigJson(text) {
  // รองรับ comment แบบบรรทัดเดียวใน service_config.json
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
}

async function loadCredentials() {
  const config = parseConfigJson(await fs.readFile(CONFIG_FILE, "utf8"));
  const usernameKey = USE_SECONDARY ? "username2" : "username";
  const passwordKey = USE_SECONDARY ? "password2" : "password";
  const username = String(config[usernameKey] ?? "").trim();
  const password = String(config[passwordKey] ?? "");

  if (!username || !password) {
    throw new Error(`ต้องกำหนด ${usernameKey}/${passwordKey} ใน ${CONFIG_FILE}`);
  }

  return { username, password };
}

async function hasTurnstile(page) {
  return Boolean(
    (await page.$(TURNSTILE_INPUT_SELECTOR)) ||
    (await page.$('iframe[src*="challenges.cloudflare.com"]'))
  );
}

async function waitForTurnstileToken(page, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const token = await page
      .$eval(TURNSTILE_INPUT_SELECTOR, (el) => el.value || "")
      .catch(() => "");
    if (token) return true;
    await sleep(500);
  }
  return false;
}

async function solveTurnstile(page, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await waitForTurnstileToken(page, 1_000)) return true;

    const wrapper = await page.$(TURNSTILE_WRAPPER_SELECTOR);
    const wrapperBox = wrapper ? await wrapper.boundingBox().catch(() => null) : null;
    if (wrapperBox && wrapperBox.width > 250 && wrapperBox.height > 40) {
      await sleep(800);
      await page.mouse.click(wrapperBox.x + 22, wrapperBox.y + 32);
    } else {
      const iframe = await page.$('iframe[src*="challenges.cloudflare.com"]');
      const iframeBox = iframe ? await iframe.boundingBox().catch(() => null) : null;
      if (iframeBox && iframeBox.width > 250 && iframeBox.height > 40) {
        await sleep(800);
        await page.mouse.click(iframeBox.x + 42, iframeBox.y + 45);
      }
    }

    if (await waitForTurnstileToken(page, 2_000)) return true;
  }

  return false;
}

async function main() {
  const { username, password } = await loadCredentials();
  const browser = await launch({
    headless: !SHOW_CHROMIUM,
    humanize: true,
    args: [],
  });

  try {
    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());
    page.setDefaultNavigationTimeout(120_000);

    console.log(`Chromium mode: ${SHOW_CHROMIUM ? "visible" : "headless"}`);
    console.log(`Account: ${USE_SECONDARY ? "secondary" : "primary"}`);

    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

    if ((await page.content()).includes("challenge-platform")) {
      console.log("กำลังตรวจพบ Cloudflare challenge และกด Turnstile อัตโนมัติ...");
      const solved = await solveTurnstile(page, 120_000);
      if (!solved) throw new Error("ไม่สามารถผ่าน Turnstile หน้า challenge ได้");

      for (let i = 0; i < 60 && (await page.content()).includes("challenge-platform"); i++) {
        await sleep(1_000);
      }
    }

    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    const usernameInput = await page.waitForSelector(
      'input[name="username"], input[type="email"]',
      { visible: true, timeout: 60_000 }
    );
    const passwordInput = await page.waitForSelector(
      'input[name="password"], input[type="password"]',
      { visible: true, timeout: 60_000 }
    );

    if (await hasTurnstile(page)) {
      console.log("กำลังเตรียม Turnstile ในฟอร์ม login...");
      const solved = await solveTurnstile(page, 120_000);
      if (!solved) throw new Error("ไม่สามารถผ่าน Turnstile ในฟอร์ม login ได้");
    }

    await usernameInput.type(username);
    await passwordInput.type(password);

    const loginSubmit = await page.$('button[type="submit"], input[type="submit"]');
    if (!loginSubmit) throw new Error("ไม่พบปุ่ม submit ของหน้า login");

    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120_000 }),
      loginSubmit.click(),
    ]);
    await sleep(2_000);

    if (page.url().includes("/login")) {
      const bodyText = await page.evaluate(() => document.body?.innerText || "");
      throw new Error(`ล็อกอินไม่สำเร็จ: ${bodyText.slice(0, 300)}`);
    }

    console.log("Login flow complete");
    console.log("Current URL:", page.url());
    console.log("Title:", await page.title());
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
