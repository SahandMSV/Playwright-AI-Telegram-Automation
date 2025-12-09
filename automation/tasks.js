const { chromium } = require("playwright");
const config = require("../config/config");

// Store browser instance globally to keep it open
let globalBrowser = null;
let globalContext = null;
let globalPage = null;

/**
 * Opens browser, navigates to duck.ai, handles modal, opens dropdown, and extracts free model names with details
 * @param {boolean} [keepOpen=true] - Whether to keep the browser open after execution
 * @returns {Promise<Object>} Result object with success status and models array
 */
async function navigateToDuckAI(keepOpen = true) {
  try {
    // Reuse existing browser or create new one
    if (!globalBrowser) {
      // Launch browser with Chrome channel and anti-detection settings
      globalBrowser = await chromium.launch({
        headless: config.playwright.headless,
        channel: "chrome",
        args: [
          "--start-maximized",
          "--disable-blink-features=AutomationControlled",
          "--disable-dev-shm-usage",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-web-security",
          "--disable-features=IsolateOrigins,site-per-process",
          "--window-size=1920,1080",
        ],
      });

      globalContext = await globalBrowser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        locale: "en-US",
        timezoneId: "America/New_York",
        permissions: [],
        extraHTTPHeaders: {
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      // Add stealth scripts to avoid detection
      await globalContext.addInitScript(() => {
        // Override the navigator.webdriver property
        Object.defineProperty(navigator, "webdriver", {
          get: () => false,
        });

        // Mock plugins
        Object.defineProperty(navigator, "plugins", {
          get: () => [1, 2, 3, 4, 5],
        });

        // Mock languages
        Object.defineProperty(navigator, "languages", {
          get: () => ["en-US", "en"],
        });

        // Chrome runtime
        window.chrome = {
          runtime: {},
        };

        // Permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) =>
          parameters.name === "notifications"
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters);
      });

      globalPage = await globalContext.newPage();
    }

    const page = globalPage;

    // Navigate to duck.ai (only if not already there)
    if (!page.url().includes("duck.ai")) {
      await page.goto("https://duck.ai", {
        waitUntil: "networkidle",
        timeout: 30000,
      });

      // Wait a bit for any dynamic content
      await page.waitForTimeout(2000);

      // Check if CAPTCHA/anomaly modal appeared
      const captchaModal = await page
        .locator('div[data-testid="anomaly-modal"]')
        .isVisible()
        .catch(() => false);
      if (captchaModal) {
        throw new Error(
          "CAPTCHA/Challenge detected. Cannot proceed in headless mode"
        );
      }

      // Wait for and handle the welcome modal
      const modalVisible = await page
        .locator('div[role="dialog"][aria-modal="true"]')
        .isVisible()
        .catch(() => false);

      if (modalVisible) {
        await page.click('button:has-text("Agree and Continue")');
        await page.waitForSelector('div[role="dialog"][aria-modal="true"]', {
          state: "hidden",
          timeout: 10000,
        });
      }
    }

    // Wait for dropdown button to appear
    await page.waitForSelector(
      "button.AHrsI58GK_lguBKwmM47.KV9dAjcCJnb8LJzKTup3",
      {
        state: "visible",
        timeout: 10000,
      }
    );

    // Check again for CAPTCHA before clicking
    const captchaModal2 = await page
      .locator('div[data-testid="anomaly-modal"]')
      .isVisible()
      .catch(() => false);
    if (captchaModal2) {
      throw new Error(
        "CAPTCHA/Challenge detected. Cannot proceed in headless mode"
      );
    }

    await page.click("button.AHrsI58GK_lguBKwmM47.KV9dAjcCJnb8LJzKTup3", {
      timeout: 10000,
    });

    // Wait for the dropdown modal to appear
    await page.waitForSelector(
      'div.hOHAbtCOIyeIzsBNXomV ul[role="radiogroup"]',
      {
        state: "visible",
        timeout: 10000,
      }
    );

    // Extract all free model details
    const models = await page.$$eval(
      'div.hOHAbtCOIyeIzsBNXomV ul[role="radiogroup"].SNQyQwxXuNCOKeRCqHri:first-of-type li.bPPjvKMux8ZtRPD4cZrA',
      (items) => {
        return items.map((item) => {
          const nameElement = item.querySelector("p.J58ouJfofMIxA2Ukt6lA");
          const modelName = nameElement ? nameElement.textContent.trim() : "";

          const betaBadge = item.querySelector("span.gADc1vgzmPc4cvxu7yBr");
          const isBeta = betaBadge ? betaBadge.textContent.trim() : null;

          const featureElements = item.querySelectorAll(
            "ul.ciW4M39XxNhJxluFqKlx li.tDjqHxDUIeGL37tpvoSI p.G9yRxKor2ogEXadimNb5"
          );
          const features = Array.from(featureElements).map((el) =>
            el.textContent.trim()
          );

          return {
            name: modelName,
            isBeta: isBeta,
            features: features,
          };
        });
      }
    );

    // Close the modal using the close button with aria-label
    try {
      await page.click('button[aria-label="close dialog"]', {
        timeout: 5000,
      });

      // Wait for modal to close
      await page.waitForSelector("div.hOHAbtCOIyeIzsBNXomV", {
        state: "hidden",
        timeout: 5000,
      });
    } catch (error) {
      // If close button doesn't work, try Escape key as fallback
      await page.keyboard.press("Escape");
    }

    // Don't close browser if keepOpen is true
    if (!keepOpen && globalBrowser) {
      await globalBrowser.close();
      globalBrowser = null;
      globalContext = null;
      globalPage = null;
    }

    return {
      success: true,
      message: `Successfully extracted ${models.length} free models!`,
      models: models,
    };
  } catch (error) {
    // Clean up on error
    if (globalBrowser && !keepOpen) {
      await globalBrowser.close();
      globalBrowser = null;
      globalContext = null;
      globalPage = null;
    }

    return {
      success: false,
      message: `Error: ${error.message}`,
      error: error.message,
      models: [],
    };
  }
}

/**
 * Manually close the browser
 */
async function closeBrowser() {
  if (globalBrowser) {
    await globalBrowser.close();
    globalBrowser = null;
    globalContext = null;
    globalPage = null;
  }
}

module.exports = {
  navigateToDuckAI,
  closeBrowser,
};
