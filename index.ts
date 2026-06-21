// Simple Puppeteer Extra script with Stealth plugin
// Navigates to the project's GitHub repository page.

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

// Apply the stealth plugin to reduce detection
puppeteer.use(StealthPlugin());

(async () => {
  try {
    // Launch browser (headless mode works with Bun)
    const browser = await puppeteer.launch({
      headless: true,
      // Optional args for better compatibility in CI environments
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    const targetUrl = "https://github.com/benhichem/score24";
    console.log(`Navigating to ${targetUrl} ...`);
    await page.goto(targetUrl, { waitUntil: "networkidle2" });
    console.log("Navigation complete.");

    // Close the browser
    await browser.close();
  } catch (err) {
    console.error("Puppeteer script error:", err);
  }
})();
