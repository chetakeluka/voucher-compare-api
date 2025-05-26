const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const path = require("path");

// Ensure directory exists
fs.ensureDirSync("voucher_data_dump");

// ---------- AMAZON SCRAPER ----------

const amazonBaseUrl = "https://www.amazon.in/s/query?fs=true&i=gift-cards&page=1&qid=1748099742&ref=sr_pg_1&rh=n%3A6681889031&s=popularity-rank&srs=6681889031&xpid=PKreUTD7FWloE";
const amazonHeaders = {
  "accept": "text/html,image/webp,*/*",
  "accept-language": "en-GB,en;q=0.5",
  "content-type": "application/json",
  "origin": "https://www.amazon.in",
  "referer": "https://www.amazon.in/",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "x-requested-with": "XMLHttpRequest"
};

async function fetchAmazonRawHTML(url, payload = '{"customer-action":"pagination"}') {
  try {
    const response = await axios.post(url, payload, { headers: amazonHeaders });
    return response.data;
  } catch (error) {
    console.error("Amazon request failed:", error.message);
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
      sitename: "Amazon"
    });
  });

  return products;
}

async function scrapeAmazon() {
  console.log("🔍 Starting Amazon voucher scraping...");
  const firstPageData = await fetchAmazonRawHTML(amazonBaseUrl);
  if (!firstPageData) return [];

  const parts = firstPageData.split("&&&").map(p => p.trim()).filter(Boolean);
  const htmlChunks = parts.map((part, i) => {
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
    const pageUrl = amazonBaseUrl.replace("page=1", `page=${page}`);
    console.log(`Processing Amazon page ${page}...`);
    const rawData = await fetchAmazonRawHTML(pageUrl);

    if (!rawData) continue;

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

    await new Promise(r => setTimeout(r, 4000)); // Wait 1s to avoid throttling
  }

  const amazonOutput = "voucher_data_dump/amazon_voucher_data.json";
  await fs.writeJson(amazonOutput, allProducts, { spaces: 4 });
  console.log(`✅ Amazon data saved to ${amazonOutput}`);
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
