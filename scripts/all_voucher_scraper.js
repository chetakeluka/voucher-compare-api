const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const path = require("path");

// Ensure directory exists
fs.ensureDirSync("voucher_data_dump");

// ---------- RANDOM GENERATORS ----------

const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/114.0"
];

function getRandomAmazonHeaders() {
  return {
    "accept": "text/html,image/webp,*/*",
    "accept-language": "en-GB,en;q=0.5",
    "content-type": "application/json",
    "origin": "https://www.amazon.in",
    "referer": "https://www.amazon.in/",
    "user-agent": userAgents[Math.floor(Math.random() * userAgents.length)],
    "x-requested-with": "XMLHttpRequest"
  };
}

function generateRandomXpid(length = 12) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function generateAmazonUrl(page = 1) {
  const xpid = generateRandomXpid();
  return `https://www.amazon.in/s/query?fs=true&i=gift-cards&page=${page}&qid=1748099742&ref=sr_pg_${page}&rh=n%3A6681889031&s=popularity-rank&srs=6681889031&xpid=1RwkI9xapLWCi`;
}

// ---------- AMAZON SCRAPER ----------

async function fetchAmazonRawHTML(page = 1, payload = '{"customer-action":"pagination"}') {
  const url = generateAmazonUrl(page);
  const headers = getRandomAmazonHeaders();
  try {
    const response = await axios.post(url, payload, { headers });
    return response.data;
  } catch (error) {
    console.error(`Amazon request failed for page ${page}:`, error.message);
    return null;
  }
}

function extractLastPageFromHtmlChunks(htmlChunks) {
  let maxPage = 1;
  for (const html of htmlChunks) {
    const $ = cheerio.load(html);
    $("span.s-pagination-item").each((_, el) => {
      const text = $(el).text().trim();
      if (/^\d+$/.test(text)) {
        const num = parseInt(text, 10);
        if (num > maxPage) maxPage = num;
      }
    });
  }
  return maxPage;
}

function extractAmazonProductInfo(htmlChunk) {
  const $ = cheerio.load(htmlChunk);
  const products = [];

  $("div[data-asin]").each((_, el) => {
    const title = $(el).find("h2.a-size-base-plus").text().trim();
    if (!title) return;

    const name = title.split("|")[0].trim();
    const urlTag = $(el).find("a[href]").first();
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
  try {
    const firstPageData = await fetchAmazonRawHTML(1);
    if (!firstPageData) throw new Error("Failed to fetch first page.");

    const parts = firstPageData.split("&&&").map(p => p.trim()).filter(Boolean);
    const htmlChunks = parts.map((part) => {
      try {
        const json = JSON.parse(part);
        return json[2]?.html || null;
      } catch {
        return null;
      }
    }).filter(Boolean);

    const lastPage = extractLastPageFromHtmlChunks(htmlChunks);
    console.log(`Total pages found: ${lastPage}`);

    let allProducts = [];

    for (let page = 1; page <= lastPage; page++) {
      console.log(`Processing Amazon page ${page}...`);
      const rawData = await fetchAmazonRawHTML(page);
      if (!rawData) throw new Error(`Failed to fetch page ${page}`);

      const entries = rawData.split("&&&").map(p => {
        try {
          return JSON.parse(p);
        } catch {
          return null;
        }
      }).filter(Boolean);

      for (const entry of entries) {
        if (
          Array.isArray(entry) &&
          (entry[0] === "search-results" ||
            entry[1]?.startsWith("data-main-slot:search-result-"))
        ) {
          const html = entry[2]?.html;
          if (html) {
            const pageProducts = extractAmazonProductInfo(html);
            allProducts.push(...pageProducts);
          }
        }
      }

      await new Promise(r => setTimeout(r, 4000)); // Avoid throttling
    }

    const amazonOutput = "voucher_data_dump/amazon_voucher_data.json";
    await fs.writeJson(amazonOutput, allProducts, { spaces: 4 });
    console.log(`✅ Amazon data saved to ${amazonOutput}`);
    return allProducts;
  } catch (err) {
    console.error("❌ Amazon scraping failed:", err.message);
    return [];
  }
}

// ---------- MAXIMIZE MONEY SCRAPER ----------

async function scrapeMaximizeMoney() {
  console.log("🔍 Scraping Maximize Money...");
  const url = "https://savemax.maximize.money/api/savemax/giftcard/list-all2";

  const headers = {
    "accept": "application/json, text/plain, */*",
    "authorization": `Bearer ${process.env.MAXMIZE_TOKEN}`,
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
