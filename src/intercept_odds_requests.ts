import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";

puppeteer.use(StealthPlugin());

async function run() {
  console.log("Launching headless browser to intercept odds requests...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const requestsLog: any[] = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/graphql")) {
        const postData = req.postData();
        if (postData) {
          try {
            const parsed = JSON.parse(postData);
            requestsLog.push({ type: 'request', url, operationName: parsed.operationName, variables: parsed.variables });
          } catch (e) {
            requestsLog.push({ type: 'request', url, postData });
          }
        }
      } else if (url.includes("/rapi/") || url.includes("odds")) {
        requestsLog.push({ type: 'request', method: req.method(), url });
      }
    });

    page.on("response", async (res) => {
      const url = res.url();
      if (url.includes("/graphql")) {
        try {
          const body = await res.json();
          // We only care about the response if it contains odds or match info
          const bodyStr = JSON.stringify(body);
          if (bodyStr.includes("odds") || bodyStr.includes("Bookmaker")) {
             requestsLog.push({ type: 'response', url, data: body });
          }
        } catch (e: any) {
          // ignore
        }
      }
    });

    const targetUrl = "https://scores24.live/en/table-tennis/m-20-06-2026-jan-pleskot-petr-picek#odds";
    console.log(`Navigating to ${targetUrl} ...`);
    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 60000 });

    console.log("Waiting 5 seconds...");
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    fs.writeFileSync("graphql_intercept.json", JSON.stringify(requestsLog, null, 2));
    console.log("Wrote intercept log to graphql_intercept.json");

  } catch (error) {
    console.error("Puppeteer intercept failed:", error);
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
}

run();
