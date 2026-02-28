// ---------------------------------------------
// 1) GOOGLE SHEET CSV LINK
// ---------------------------------------------
const SHEET_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRuhGcY4lSWJMrhp1nYUHlBXuVvEWehlq2OqIhKFj89FcQ84yZeTt3zejC24ucGaBmUaI9mg9sUrkB1/pub?gid=0&single=true&output=csv";


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
// 3) Calculate KPIs
// ---------------------------------------------
function calculateKPIs(rows) {
    const offered = sum(rows, "OFFERED");
    const answered = sum(rows, "ANS. #");
    const abandoned = sum(rows, "ABD #");
    const flowOuts = sum(rows, "FLOW OUTS");
    const holds = sum(rows, "HOLDS");

    return {
        offered,
        answered,
        abandoned,
        flow_outs: flowOuts,
        holds,
        ans_pct: offered ? Math.round((answered / offered) * 100) : 0,
        abn_pct: offered ? Math.round((abandoned / offered) * 100) : 0,
        flow_out_pct: offered ? Math.round((flowOuts / offered) * 100) : 0
    };
}

function sum(rows, col) {
    return rows.reduce((total, r) => {
        const val = Number(r[col] || 0);
        return total + (isNaN(val) ? 0 : val);
    }, 0);
}


// ---------------------------------------------
// 4) Group by Program (LOB)
// ---------------------------------------------
function groupByProgram(rows) {
    const map = {};

    rows.forEach(r => {
        const program = r["Program"] || "Unknown";
        const answered = Number(r["ANS. #"] || 0);

        if (!map[program]) map[program] = 0;
        map[program] += isNaN(answered) ? 0 : answered;
    });

    return Object.entries(map).map(([lob, value]) => ({ lob, value }));
}


// ---------------------------------------------
// 5) Render KPI Cards
// ---------------------------------------------
function renderKPIs(kpis) {
    const container = document.getElementById("kpi-container");
    container.innerHTML = "";

    Object.entries(kpis).forEach(([key, value]) => {
        const card = document.createElement("div");
        card.className = "kpi-card";

        card.innerHTML = `
            <h3>${formatLabel(key)}</h3>
            <p>${formatNumber(value)}</p>
        `;

        container.appendChild(card);
    });
}

function formatLabel(label) {
    return label.replace(/_/g, " ").toUpperCase();
}

function formatNumber(num) {
    return Number(num).toLocaleString();
}


// ---------------------------------------------
// 6) Render Bar Chart
// ---------------------------------------------
let lobChart = null;

function renderLOBChart(data) {
    const ctx = document.getElementById("lobChart");

    if (lobChart) lobChart.destroy();

    lobChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: data.map(item => item.lob),
            datasets: [{
                label: "Answered Contacts",
                data: data.map(item => item.value),
                backgroundColor: "#4a90e2"
            }]
        },
        options: {
            responsive: true,
            scales: {
                x: {
                    ticks: { autoSkip: false, maxRotation: 45, minRotation: 45 }
                },
                y: { beginAtZero: true }
            }
        }
    });
}


// ---------------------------------------------
// 7) Initialize Dashboard
// ---------------------------------------------
loadData().then(rows => {
    if (!rows || rows.length === 0) {
        console.warn("No data loaded from Google Sheet.");
        return;
    }

    const kpis = calculateKPIs(rows);
    renderKPIs(kpis);

    const lobData = groupByProgram(rows);
    renderLOBChart(lobData);
});
