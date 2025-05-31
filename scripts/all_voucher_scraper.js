const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");

// Ensure directory exists
fs.ensureDirSync("voucher_data_dump");

// User-agent pool to help avoid detection
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function getAmazonHeaders() {
  return {
    "accept": "text/html",
    "accept-language": "en-US,en;q=0.9",
    "user-agent": getRandomUserAgent(),
  };
}

async function fetchAmazonPage(url, retries = 3) {
  while (retries > 0) {
    try {
      const response = await axios.get(url, { headers: getAmazonHeaders() });
      return response.data;
    } catch (error) {
      console.warn(`⚠️ Failed to fetch ${url} — ${error.message}`);
      retries--;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

function extractAmazonProductInfo(html) {
  const $ = cheerio.load(html);
  const products = [];

  $("div.s-result-item[data-asin]").each((_, el) => {
    const title = $(el).find("h2 span").text().trim();
    if (!title) return;

    const name = title.split("|")[0].trim();
    const urlTag = $(el).find("a.a-link-normal[href]").first();
    const url = urlTag.length ? `https://www.amazon.in${urlTag.attr("href")}` : "N/A";
    const discountMatch = /Flat\s+(\d+)%\s+off/i.exec(title);
    const discount = discountMatch ? parseInt(discountMatch[1], 10) : 0;
    const imgUrl = $(el).find("img.s-image").attr("src") || null;

    products.push({
      name,
      discount_pct: discount,
      url,
      image_url: imgUrl,
      sitename: "Amazon",
      InStock: true,
    });
  });

  return products;
}

async function scrapeAmazon() {
  console.log("🔍 Starting Amazon voucher scraping...");

  const baseUrl = "https://www.amazon.in/s?i=gift-cards&s=popularity-rank&rh=n%3A6681889031&page=";
  const totalPages = 3; // Test with 3 pages first, increase later if stable
  const allProducts = [];

  for (let page = 1; page <= totalPages; page++) {
    const pageUrl = `${baseUrl}${page}`;
    console.log(`📄 Fetching page ${page}...`);

    const html = await fetchAmazonPage(pageUrl);
    if (!html) continue;

    const pageProducts = extractAmazonProductInfo(html);
    allProducts.push(...pageProducts);

    // Randomized delay (3-7s)
    const delay = Math.floor(Math.random() * 4000) + 3000;
    console.log(`⏱ Waiting ${delay}ms before next page...`);
    await new Promise(r => setTimeout(r, delay));
  }

  const outputPath = "voucher_data_dump/amazon_voucher_data.json";
  await fs.writeJson(outputPath, allProducts, { spaces: 4 });
  console.log(`✅ Scraping completed. Saved to ${outputPath}`);
  return allProducts;
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
    const amazonData = await scrapeAmazon();
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
