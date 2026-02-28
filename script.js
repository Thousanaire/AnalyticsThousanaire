// ---------------------------------------------
// 1) GOOGLE SHEET CSV LINK
// ---------------------------------------------
const SHEET_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRuhGcY4lSWJMrhp1nYUHlBXuVvEWehlq2OqIhKFj89FcQ84yZeTt3zejC24ucGaBmUaI9mg9sUrkB1/pub?gid=0&single=true&output=csv";

let allRows = [];
let lobChart = null;


// ---------------------------------------------
// 2) Load CSV from Google Sheets
// ---------------------------------------------
async function loadData() {
    try {
        const response = await fetch(SHEET_CSV_URL, { cache: "no-store" });
        const csvText = await response.text();
        return parseCSV(csvText);
    } catch (error) {
        console.error("Error loading Google Sheet CSV:", error);
        return [];
    }
}


// ---------------------------------------------
// 2B) Robust CSV Parser + Header Normalizer
// ---------------------------------------------
function parseCSV(csv) {
    csv = csv.replace(/^\uFEFF/, ""); // Remove BOM

    const lines = csv.split(/\r?\n/).filter(line => line.trim() !== "");
    const rawHeaders = parseCSVRow(lines[0]);

    const headers = rawHeaders.map(h =>
        h.replace(/"/g, "").replace(/\r/g, "").trim()
    );

    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVRow(lines[i]);
        const row = {};

        headers.forEach((header, index) => {
            const cleanHeader = header.trim();
            const cleanValue = (values[index] || "")
                .replace(/"/g, "")
                .replace(/\r/g, "")
                .trim();

            row[cleanHeader] = cleanValue;
        });

        rows.push(row);
    }

    console.log("Parsed rows:", rows);
    return rows;
}

function parseCSVRow(line) {
    const result = [];
    let current = "";
    let insideQuotes = false;

    for (let char of line) {
        if (char === '"' && !insideQuotes) {
            insideQuotes = true;
        } else if (char === '"' && insideQuotes) {
            insideQuotes = false;
        } else if (char === "," && !insideQuotes) {
            result.push(current);
            current = "";
        } else {
            current += char;
        }
    }

    result.push(current);
    return result;
}


// ---------------------------------------------
// 3) Calculate KPIs (UPDATED FOR YOUR COLUMNS)
// ---------------------------------------------
function calculateKPIs(rows) {
    // Core counts
    const offered = sum(rows, "OFFERED");
    const answered = sum(rows, "ANS. #");
    const abandoned = sum(rows, "ABD #");
    const flowOuts = sum(rows, "FLOW OUTS");

    // Holds (you have two columns)
    const holds = sum(rows, "HOLDS") + sum(rows, "# of HOLDS");

    // Speed-to-answer metrics
    const totalWait = sum(rows, "Wait time");
    const timeToAbandon = sum(rows, "TIME TO ABANDON");
    const ansUnder30 = sum(rows, "TOTAL ANS < 30 SEC.");

    // Time-based metrics
    const talkTime = sum(rows, "Talk Time");
