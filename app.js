require('dotenv').config();
const express = require('express');
const fuzzy = require('fuzzy');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const cron = require('node-cron');
const { main: runVoucherScrapers } = require('./scripts/all_voucher_scraper.js');


const app = express();
app.use(cors({
    origin: process.env.CORS_ORIGIN
}));
const port = process.env.PORT || 3000;

const directoryPath = path.join(__dirname, process.env.DATA_DIR_FROM_ROOT);

// Function to load data from multiple JSON files in a directory
function loadDataFromDirectory(directoryPath) {
    const files = fs.readdirSync(directoryPath);
    let combinedData = [];

    files.forEach(file => {
        if (file.endsWith('.json')) {
            const filePath = path.join(directoryPath, file);
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const jsonData = JSON.parse(fileContent);
            combinedData = combinedData.concat(jsonData);
        }
    });

    return combinedData;
}

// Initial load
let allData = loadDataFromDirectory(directoryPath);

// Run once on initialization
(async () => {
  console.log('[INIT] Running voucher scrapers...');
  try {
    await runVoucherScrapers();
    allData = loadDataFromDirectory(directoryPath);
    console.log('[INIT] Data scraped and loaded into memory.');
  } catch (err) {
    console.error('[INIT] Scraper failed:', err.message);
  }
})();

// Run script every 5 minutes
cron.schedule('0 2 * * *', async () => {
  console.log('[CRON] Running voucher scrapers...');
  try {
    await runVoucherScrapers();
    console.log('[CRON] Scraping complete. Reloading data...');
    allData = loadDataFromDirectory(directoryPath);
    console.log('[CRON] Data reloaded into memory.');
  } catch (err) {
    console.error('[CRON] Scraper failed:', err.message);
  }
});



// Function to get the best discount based on user query
function getBestDiscount(data, searchName, minScoreThreshold = 50) {
    if (!data || data.length === 0) {
        return "Info: No data provided to search.";
    }
    if (!searchName || typeof searchName !== 'string' || searchName.trim() === "") {
        return "Info: Search query is empty or invalid.";
    }

    const cleanedSearchName = searchName.toLowerCase();
    const names = data.map(item => item.name.toLowerCase());
    const rawFuzzyResults = fuzzy.filter(cleanedSearchName, names);

    if (!rawFuzzyResults || rawFuzzyResults.length === 0) {
        return `No results found for "${searchName}" (no items loosely matched the query).`;
    }

    const goodQualityMatches = rawFuzzyResults.filter(result => result.score >= minScoreThreshold);

    if (goodQualityMatches.length === 0) {
        const bestScoreFound = rawFuzzyResults[0].score;
        return `No sufficiently relevant results found for "${searchName}". (Best match score ${bestScoreFound} was below the threshold of ${minScoreThreshold})`;
    }

    const relevantDataItems = goodQualityMatches.map(result => data[result.index]);

    const bestDiscountItem = relevantDataItems.reduce((maxItem, currentItem) => {
        return currentItem.discount_pct > maxItem.discount_pct ? currentItem : maxItem;
    }, relevantDataItems[0]);

    return bestDiscountItem;
}

// API endpoint to handle user queries
app.get('/best-voucher', (req, res) => {
    const query = req.query.query;

    if (!query) {
        return res.status(400).json({ message: 'Query parameter "query" is required' });
    }

    const result = getBestDiscount(allData, query);

    if (typeof result === 'string') {
        return res.status(404).json({ message: result });
    }

    res.json(result);
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
