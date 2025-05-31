const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const path = require("path");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

// Ensure directory exists
fs.ensureDirSync("voucher_data_dump");

// ---------- AMAZON SCRAPER ----------
puppeteer.use(StealthPlugin());

async function extractAmazonProductInfo(page) {
  return await page.evaluate(() => {
    const items = [];
    const productElements = document.querySelectorAll("div.s-result-item[data-asin]");

    productElements.forEach(el => {
      const titleEl = el.querySelector("h2 span");
      const linkEl = el.querySelector("a.a-link-normal");
      const imgEl = el.querySelector("img.s-image");

      const title = titleEl?.innerText.trim();
      if (!title) return;

      const name = title.split("|")[0].trim();
      const url = linkEl ? `https://www.amazon.in${linkEl.getAttribute("href")}` : "N/A";
      const discountMatch = /Flat\s+(\d+)%\s+off/i.exec(title);
      const discount = discountMatch ? parseInt(discountMatch[1], 10) : 0;
      const image_url = imgEl?.getAttribute("src") || null;

      items.push({
        name,
        discount_pct: discount,
        url,
        image_url,
        sitename: "Amazon",
        InStock: true,
      });
    });

    return items;
  });
}

async function getLastPageNumber(page) {
  return await page.evaluate(() => {
    const pageItems = [...document.querySelectorAll("span.s-pagination-item")];
    const pageNumbers = pageItems
      .map(el => parseInt(el.innerText.trim(), 10))
      .filter(num => !isNaN(num));
    return pageNumbers.length ? Math.max(...pageNumbers) : 1;
  });
}

async function scrapeAmazonWithPuppeteer() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36");
  await page.setViewport({ width: 1280, height: 800 });

  const baseUrl = "https://www.amazon.in/s?i=gift-cards&s=popularity-rank&rh=n%3A6681889031&page=";
  let allProducts = [];

  // Navigate to page 1 to get total page count
  console.log("📄 Fetching first page...");
  await page.goto(baseUrl + "1", { waitUntil: "domcontentloaded", timeout: 30000 });

  const lastPage = await getLastPageNumber(page);
  console.log(`📚 Found total pages: ${lastPage}`);

  for (let pageNum = 1; pageNum <= lastPage; pageNum++) {
    const url = baseUrl + pageNum;
    console.log(`📄 Scraping page ${pageNum}...`);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

      const blocked = await page.evaluate(() =>
        document.title.includes("Sorry") || document.body.innerText.includes("Enter the characters you see below")
      );
      if (blocked) {
        console.warn("⚠️ Blocked by Amazon on this page");
        continue;
      }

      const products = await extractAmazonProductInfo(page);
      allProducts.push(...products);
    } catch (err) {
      console.error(`❌ Error on page ${pageNum}:`, err.message);
    }

    const delay = Math.floor(Math.random() * 3000) + 2000;
    console.log(`⏱ Waiting ${delay}ms before next page...`);
    await new Promise(r => setTimeout(r, delay));
  }

  await browser.close();

  const output = "voucher_data_dump/amazon_voucher_data.json";
  await fs.writeJson(output, allProducts, { spaces: 4 });
  console.log(`✅ Amazon data saved to ${output}`);
}


// ---------- MAXIMIZE MONEY SCRAPER ----------

async function scrapeMaximizeMoney() {
  console.log("🔍 Scraping Maximize Money...");
  const url = "https://savemax.maximize.money/api/savemax/giftcard/list-all2";

  const headers = {
    "accept": "application/json, text/plain, */*",
    "authorization": `Bearer ${process.env.MAXMIZE_TOKEN}`, // Replace with actual token
    "origin": "https://www.maximize.money",
    "referer": "https://www.maximize.money/",
    "user-agent": "Mozilla/5.0"
  };

  try {
    const response = await axios.get(url, { headers });
    const cards = response.data.data || [];

    const transformed = cards.map(card => ({
      name: card.giftCardName,
      discount_pct: card.discount,
      image_url: card.giftCardLogo,
      url: `https://www.maximize.money/gift-cards/${card.brand}/${card.id}`,
      InStock: card.stock,
      sitename: "Maximize money"
    }));

    const outputFile = "./voucher_data_dump/maximize_money_voucher_data.json";
    await fs.writeJson(outputFile, transformed, { spaces: 4 });
    console.log(`✅ Maximize Money data saved to ${outputFile}`);
    return transformed;
  } catch (err) {
    console.error("❌ Maximize Money fetch failed:", err.message);
    return [];
  }
}

// ---------- MAIN FUNCTION (EXPORTABLE) ----------
async function main() {
  try {
    const amazonData = await scrapeAmazonWithPuppeteer();
    const maximizeMoneyData = await scrapeMaximizeMoney();

    return {
      amazon: amazonData,
      maximizeMoney: maximizeMoneyData
    };
  } catch (error) {
    console.error("❌ Error during scraping:", error);
    throw error;
  }
}

// Run if script is executed directly
if (require.main === module) {
  main()
    .then(() => {
      console.log("🎉 All scraping tasks completed.");
    })
    .catch(err => {
      console.error("💥 Scraping failed:", err);
    });
}

module.exports = { main };
