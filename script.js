// ---------------------------------------------
// 1) GOOGLE SHEET CSV LINK
// ---------------------------------------------
const SHEET_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRuhGcY4lSWJMrhp1nYUHlBXuVvEWehlq2OqIhKFj89FcQ84yZeTt3zejC24ucGaBmUaI9mg9sUrkB1/pub?gid=0&single=true&output=csv";

let allRows = [];
let lobChart = null;
let volumeTrendChart = null;
let slAbnTrendChart = null;
let ahtChart = null;


// ---------------------------------------------
// 2) Load CSV from Google Sheets
// ---------------------------------------------
async function loadData() {
    const statusPill = document.getElementById("status-pill");
    if (statusPill) {
        statusPill.textContent = "Loading latest data…";
        statusPill.classList.add("loading");
    }

    try {
        const response = await fetch(SHEET_CSV_URL, { cache: "no-store" });
        const csvText = await response.text();
        const rows = parseCSV(csvText);

        // ✅ UPDATED SUCCESS BLOCK
        if (statusPill) {
            const now = new Date().toLocaleString('en-US', { 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric',
                hour: '2-digit', 
                minute: '2-digit', 
                hour12: true 
            });
            statusPill.textContent = `Data loaded: ${now}`;
            statusPill.classList.remove("loading");
            statusPill.classList.add("success");
        }

        return rows;
    } catch (error) {
        console.error("Error loading Google Sheet CSV:", error);
        showAlert("Unable to load data from source.");
        if (statusPill) {
            statusPill.textContent = "Load failed";
            statusPill.classList.remove("loading");
            statusPill.classList.add("error");
        }
        return [];
    }
}


// ---------------------------------------------
// 2B) ROBUST CSV PARSER
// ---------------------------------------------
function parseCSV(csv) {
    const rows = [];
    let row = [];
    let current = "";
    let insideQuotes = false;

    for (let i = 0; i < csv.length; i++) {
        const char = csv[i];
        const next = csv[i + 1];

        if (char === '"' && insideQuotes && next === '"') {
            current += '"';
            i++;
        } else if (char === '"') {
            insideQuotes = !insideQuotes;
        } else if (char === ',' && !insideQuotes) {
            row.push(current);
            current = "";
        } else if ((char === '\n' || char === '\r') && !insideQuotes) {
            if (current.length > 0 || row.length > 0) {
                row.push(current);
                rows.push(row);
                row = [];
                current = "";
            }
        } else {
            current += char;
        }
    }

    if (current.length > 0 || row.length > 0) {
        row.push(current);
        rows.push(row);
    }

    if (rows.length === 0) return [];

    const headers = rows.shift().map(h => h.trim());
    return rows.map(cols => {
        const obj = {};
        headers.forEach((h, i) => {
            obj[h] = (cols[i] || "").trim();
        });
        return obj;
    });
}


// ---------------------------------------------
// TIME FORMATTER (HH:MM:SS)
// ---------------------------------------------
function toHHMMSS(seconds) {
    seconds = Math.floor(seconds);

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}


// ---------------------------------------------
// DATE PARSER
// ---------------------------------------------
function parseSheetDate(value) {
    if (!value) return null;

    const str = String(value).trim();

    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        const [ymd] = str.split(" ");
        const [y, m, d] = ymd.split("-").map(Number);
        const dt = new Date(y, m - 1, d);
        return isNaN(dt.getTime()) ? null : dt;
    }

    const datePart = str.split(" ")[0].trim();
    const parts = datePart.split("/");
    if (parts.length !== 3) return null;

    let [m, d, y] = parts.map(p => p.trim());
    m = Number(m);
    d = Number(d);
    y = Number(y);

    if (y < 100) y = 2000 + y;

    const dt = new Date(y, m - 1, d);
    return isNaN(dt.getTime()) ? null : dt;
}


// ---------------------------------------------
// 3) KPI CALCULATIONS
// ---------------------------------------------
function calculateKPIs(rows) {
    const offered = sum(rows, "OFFERED");
    const answered = sum(rows, "ANS. #");
    const abandoned = sum(rows, "ABD #");
    const flowOuts = sum(rows, "FLOW OUTS");

    const holds = sum(rows, "# of HOLDS");

    const totalWait = sum(rows, "Wait time");
    const timeToAbandon = sum(rows, "TIME TO ABANDON");

    const ansUnder30 = sum(rows, "TOTAL ANS < 30 SEC.");

    const talkTime = sum(rows, "Talk Time");
    const holdTime = sum(rows, "Hold Time");
    const acwTime = sum(rows, "ACW Time");
    const handleTime = sum(rows, "Handle Time");

    const ansPct = offered ? (answered / offered) * 100 : 0;
    const abnPct = offered ? (abandoned / offered) * 100 : 0;
    const slPct = answered ? (ansUnder30 / answered) * 100 : 0;

    const asaSec = answered ? (totalWait - timeToAbandon) / answered : 0;
    const avgTalkSec = answered ? talkTime / answered : 0;
    const avgHoldSec = answered ? holdTime / answered : 0;
    const avgACWSec = answered ? acwTime / answered : 0;
    const avgHandleSec = answered ? handleTime / answered : 0;

    return {
        offered,
        answered,
        abandoned,
        flow_outs: flowOuts,
        holds,

        ans_pct: Math.round(ansPct),
        abn_pct: Math.round(abnPct),
        service_level_pct: Math.round(slPct),

        asa: toHHMMSS(asaSec),
        avg_talk_time: toHHMMSS(avgTalkSec),
        avg_hold_time: toHHMMSS(avgHoldSec),
        avg_acw: toHHMMSS(avgACWSec),
        aht: toHHMMSS(avgHandleSec),

        ans_under_30: ansUnder30
    };
}

function sum(rows, col) {
    return rows.reduce((total, r) => {
        let raw = r[col] ?? "";
        raw = String(raw).trim();

        let cleaned = raw.replace(/[^0-9.\-]/g, "");
        if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") {
            return total;
        }

        const val = parseFloat(cleaned);
        return total + (isNaN(val) ? 0 : val);
    }, 0);
}


// ---------------------------------------------
// 4) GROUP BY BUSINESS
// ---------------------------------------------
function groupByBusiness(rows) {
    const map = {};

    rows.forEach(r => {
        const business = r["Business"] || r["Program"] || r["Programs"] || "Unknown";
        const answered = sum([r], "ANS. #");

        if (!map[business]) map[business] = 0;
        map[business] += answered;
    });

    return Object.entries(map).map(([lob, value]) => ({ lob, value }));
}


// ---------------------------------------------
// 5) RENDER KPI CARDS
// ---------------------------------------------
function renderKPIs(kpis) {
    const container = document.getElementById("kpi-container");
    if (!container) return;

    container.innerHTML = "";

    Object.entries(kpis).forEach(([key, value]) => {
        const card = document.createElement("div");
        card.className = "kpi-card";

        if (key === "service_level_pct") {
            if (value >= 80) card.classList.add("good");
            else if (value >= 60) card.classList.add("warning");
            else card.classList.add("danger");
        }

        if (key === "abn_pct") {
            if (value <= 3) card.classList.add("good");
            else if (value <= 7) card.classList.add("warning");
            else card.classList.add("danger");
        }

        if (key === "asa") {
            const seconds = hmsToSeconds(String(value));
            if (seconds <= 20) card.classList.add("good");
            else if (seconds <= 40) card.classList.add("warning");
            else card.classList.add("danger");
        }

        card.innerHTML = `
            <h3>${formatLabel(key)}</h3>
            <p>${value}</p>
        `;

        container.appendChild(card);
    });
}

function hmsToSeconds(str) {
    const parts = str.split(":").map(Number);
    if (parts.length !== 3) return 0;
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function formatLabel(label) {
    const map = {
        offered: "Offered",
        answered: "Answered",
        abandoned: "Abandoned",
        flow_outs: "Flow Outs",
        holds: "# of Holds",
        ans_pct: "Answer %",
        abn_pct: "Abandon %",
        service_level_pct: "Service Level %",
        asa: "ASA",
        avg_talk_time: "Avg Talk Time",
        avg_hold_time: "Avg Hold Time",
        avg_acw: "Avg ACW",
        aht: "Avg Handle Time",
        ans_under_30: "Answered <30s"
    };

    return map[label] || label.replace(/_/g, " ").toUpperCase();
}


// ---------------------------------------------
// 6) RENDER BAR CHART (Answered by Business)
// ---------------------------------------------
function renderLOBChart(data) {
    const ctx = document.getElementById("lobChart");

    if (!ctx) return;
    if (lobChart) lobChart.destroy();

    lobChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: data.map(item => item.lob),
            datasets: [{
                label: "Answered Contacts",
                data: data.map(item => item.value),
                backgroundColor: "rgba(37, 99, 235, 0.9)",
                borderRadius: 6,
                maxBarThickness: 38
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { mode: "index", intersect: false }
            },
            layout: {
                padding: { top: 8, right: 8, bottom: 8, left: 8 }
            },
            scales: {
                x: {
                    ticks: { autoSkip: false, maxRotation: 45, minRotation: 0, color: "#9ca3af" },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: "#9ca3af" },
                    grid: { color: "rgba(31, 41, 55, 0.7)" }
                }
            }
        }
    });
}


// ---------------------------------------------
// 6B) DAILY AGG
// ---------------------------------------------
function buildDailyAgg(rows) {
    const map = {};

    rows.forEach(r => {
        const d = parseSheetDate(r["DATE"]);
        if (!d) return;
        const key = d.toISOString().slice(0, 10);

        if (!map[key]) {
            map[key] = {
                offered: 0,
                answered: 0,
                abandoned: 0,
                ansUnder30: 0,
                flowOuts: 0,
                talkTime: 0,
                holdTime: 0,
                acwTime: 0,
                handleTime: 0
            };
        }

        const bucket = map[key];
        bucket.offered += sum([r], "OFFERED");
        bucket.answered += sum([r], "ANS. #");
        bucket.abandoned += sum([r], "ABD #");
        bucket.ansUnder30 += sum([r], "TOTAL ANS < 30 SEC.");
        bucket.flowOuts += sum([r], "FLOW OUTS");
        bucket.talkTime += sum([r], "Talk Time");
        bucket.holdTime += sum([r], "Hold Time");
        bucket.acwTime += sum([r], "ACW Time");
        bucket.handleTime += sum([r], "Handle Time");
    });

    const days = Object.keys(map).sort();
    return days.map(date => {
        const b = map[date];
        const slPct = b.answered ? (b.ansUnder30 / b.answered) * 100 : 0;
        const abnPct = b.offered ? (b.abandoned / b.offered) * 100 : 0;
        const ahtSec = b.answered ? b.handleTime / b.answered : 0;

        return {
            date,
            offered: b.offered,
            answered: b.answered,
            abandoned: b.abandoned,
            slPct,
            abnPct,
            ahtSec
        };
    });
}


// ---------------------------------------------
// 6C) Volume Trend Chart
// ---------------------------------------------
function renderVolumeTrendChart(rows) {
    const ctx = document.getElementById("volumeTrendChart");
    if (!ctx) return;

    const daily = buildDailyAgg(rows);

    if (volumeTrendChart) volumeTrendChart.destroy();

    volumeTrendChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: daily.map(d => d.date),
            datasets: [
                {
                    label: "Offered",
                    data: daily.map(d => d.offered),
                    borderColor: "rgba(59, 130, 246, 1)",
                    backgroundColor: "rgba(59, 130, 246, 0.2)",
                    tension: 0.25,
                    fill: true
                },
                {
                    label: "Answered",
                    data: daily.map(d => d.answered),
                    borderColor: "rgba(16, 185, 129, 1)",
                    backgroundColor: "rgba(16, 185, 129, 0.15)",
                    tension: 0.25,
                    fill: true
                },
                {
                    label: "Abandoned",
                    data: daily.map(d => d.abandoned),
                    borderColor: "rgba(239, 68, 68, 1)",
                    backgroundColor: "rgba(239, 68, 68, 0.1)",
                    tension: 0.25,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, labels: { color: "#e5e7eb", boxWidth: 10 } },
                tooltip: { mode: "index", intersect: false }
            },
            scales: {
                x: {
                    ticks: { color: "#9ca3af", maxRotation: 0, autoSkip: true },
                    grid: { color: "rgba(31, 41, 55, 0.7)" }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: "#9ca3af" },
                    grid: { color: "rgba(31, 41, 55, 0.7)" }
                }
            }
        }
    });
}


// ---------------------------------------------
// 6D) Service Level & Abandon % Trend
// ---------------------------------------------
function renderSLAbnTrendChart(rows) {
    const ctx = document.getElementById("slAbnTrendChart");
    if (!ctx) return;

    const daily = buildDailyAgg(rows);

    if (slAbnTrendChart) slAbnTrendChart.destroy();

    slAbnTrendChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: daily.map(d => d.date),
            datasets: [
                {
                    label: "Service Level %",
                    data: daily.map(d => Math.round(d.slPct)),
                    borderColor: "rgba(96, 165, 250, 1)",
                    backgroundColor: "rgba(96, 165, 250, 0.1)",
                    tension: 0.25,
                    yAxisID: "y1"
                },
                {
                    label: "Abandon %",
                    data: daily.map(d => Math.round(d.abnPct)),
                    borderColor: "rgba(248, 113, 113, 1)",
                    backgroundColor: "rgba(248, 113, 113, 0.1)",
                    tension: 0.25,
                    yAxisID: "y2"
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, labels: { color: "#e5e7eb", boxWidth: 10 } },
                tooltip: { mode: "index", intersect: false }
            },
            scales: {
                x: {
                    ticks: { color: "#9ca3af", maxRotation: 0, autoSkip: true },
                    grid: { color: "rgba(31, 41, 55, 0.7)" }
                },
                y1: {
                    type: "linear",
                    position: "left",
                    beginAtZero: true,
                    ticks: { color: "#9ca3af", callback: v => v + "%" }
                },
                y2: {
                    type: "linear",
                    position: "right",
                    beginAtZero: true,
                    ticks: { color: "#9ca3af", callback: v =>
