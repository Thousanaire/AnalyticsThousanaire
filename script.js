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

    return rows;
}

function parseCSVRow(line) {
    const result = [];
    let current = "";
    let insideQuotes = false;

    for (let char of line) {
        if (char === '"' && !insideQuotes) insideQuotes = true;
        else if (char === '"' && insideQuotes) insideQuotes = false;
        else if (char === "," && !insideQuotes) {
            result.push(current);
            current = "";
        } else current += char;
    }

    result.push(current);
    return result;
}


// ---------------------------------------------
// DATE PARSER FOR FORMAT: 1/1/2026
// ---------------------------------------------
function parseSheetDate(value) {
    if (!value) return null;

    const datePart = String(value).split(" ")[0].trim();
    const parts = datePart.split("/");

    if (parts.length !== 3) return null;

    let [m, d, y] = parts.map(p => p.trim());

    m = Number(m);
    d = Number(d);
    y = Number(y);

    if (y < 100) y = 2000 + y;

    return new Date(y, m - 1, d);
}


// ---------------------------------------------
// 3) Calculate KPIs (UPDATED FOR YOUR COLUMNS)
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

    const ansPct = offered ? (answered / offered) * 100 : 0;
    const abnPct = offered ? (abandoned / offered) * 100 : 0;
    const slPct = answered ? (ansUnder30 / answered) * 100 : 0;

    const asa = answered ? (totalWait - timeToAbandon) / answered : 0;

    const avgTalk = answered ? talkTime / answered : 0;
    const avgHold = answered ? holdTime / answered : 0;
    const avgACW = answered ? acwTime / answered : 0;

    const aht = avgTalk + avgHold + avgACW;

    return {
        offered,
        answered,
        abandoned,
        flow_outs: flowOuts,
        holds,

        ans_pct: Math.round(ansPct),
        abn_pct: Math.round(abnPct),
        service_level_pct: Math.round(slPct),

        asa: Math.round(asa),
        avg_talk_time: Math.round(avgTalk),
        avg_hold_time: Math.round(avgHold),
        avg_acw: Math.round(avgACW),
        aht: Math.round(aht),

        ans_under_30: ansUnder30
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
        const program = r["Program"] || r["Programs"] || "Unknown";
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
    const map = {
        offered: "Offered",
        answered: "Answered",
        abandoned: "Abandoned",
        flow_outs: "Flow Outs",
        holds: "Holds",
        ans_pct: "Answer %",
        abn_pct: "Abandon %",
        service_level_pct: "Service Level %",
        asa: "ASA (sec)",
        avg_talk_time: "Avg Talk Time",
        avg_hold_time: "Avg Hold Time",
        avg_acw: "Avg ACW",
        aht: "AHT",
        ans_under_30: "Answered <30s"
    };

    return map[label] || label.replace(/_/g, " ").toUpperCase();
}

function formatNumber(num) {
    return Number(num).toLocaleString();
}


// ---------------------------------------------
// 6) Render Bar Chart
// ---------------------------------------------
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
// 7) FILTERS: Populate + Apply
// ---------------------------------------------
function populateFilters(rows) {
    const programSelect = document.getElementById("filter-program");
    const daySelect = document.getElementById("filter-day");
    const monthSelect = document.getElementById("filter-month");
    const yearSelect = document.getElementById("filter-year");
    const quarterSelect = document.getElementById("filter-quarter");
    const startInput = document.getElementById("filter-date-start");
    const endInput = document.getElementById("filter-date-end");

    const programs = new Set();
    const days = new Set();
    const months = new Set();
    const years = new Set();
    const quarters = new Set();
    const dates = [];

    rows.forEach(r => {
        if (r["Program"] || r["Programs"]) {
            programs.add(r["Program"] || r["Programs"]);
        }
        if (r["Day"]) days.add(r["Day"]);
        if (r["Month"]) months.add(r["Month"]);
        if (r["Year"]) years.add(r["Year"]);
        if (r["Quarters"]) quarters.add(r["Quarters"]);

        if (r["DATE"]) {
            const d = parseSheetDate(r["DATE"]);
            if (d) dates.push(d);
        }
    });

    fillSelect(programSelect, Array.from(programs).sort(), "Program");
    fillSelect(daySelect, Array.from(days).sort((a, b) => Number(a) - Number(b)), "Day");
    fillSelect(monthSelect, Array.from(months).sort(), "Month");
    fillSelect(yearSelect, Array.from(years).sort(), "Year");
    fillSelect(quarterSelect, Array.from(quarters).sort(), "Quarter");

    if (dates.length > 0) {
        dates.sort((a, b) => a - b);
        startInput.value = toInputDate(dates[0]);
        endInput.value = toInputDate(dates[dates.length - 1]);
    }
}

function fillSelect(selectEl, values, placeholder) {
    selectEl.innerHTML = `<option value="">${placeholder}</option>` +
        values.map(v => `<option value="${v}">${v}</option>`).join("");
}

function toInputDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function applyFilters() {
    if (!allRows || allRows.length === 0) return;

    const programVal = document.getElementById("filter-program").value;
    const dayVal = document.getElementById("filter-day").value;
    const monthVal = document.getElementById("filter-month").value;
    const yearVal = document.getElementById("filter-year").value;
    const quarterVal = document.getElementById("filter-quarter").value;
    const startVal = document.getElementById("filter-date-start").value;
    const endVal = document.getElementById("filter-date-end").value;

    const startDate = startVal ? new Date(startVal) : null;
    const endDate = endVal ? new Date(endVal) : null;

    const filtered = allRows.filter(r => {
        if (programVal && (r["Program"] || r["Programs"]) !== programVal) return false;
        if (dayVal && r["Day"] !== dayVal) return false;
        if (monthVal && r["Month"] !== monthVal) return false;
        if (yearVal && r["Year"] !== yearVal) return false;
        if (quarterVal && r["Quarters"] !== quarterVal) return false;

        if (startDate || endDate) {
            const d = parseSheetDate(r["DATE"]);
            if (!d) return false;
            if (startDate && d < startDate) return false;
            if (endDate && d > endDate) return false;
        }

        return true;
    });

    const kpis = calculateKPIs(filtered);
    renderKPIs(kpis);

    const lobData = groupByProgram(filtered);
    renderLOBChart(lobData);
}

function attachFilterEvents() {
    [
        "filter-program",
        "filter-day",
        "filter-month",
        "filter-year",
        "filter-quarter",
        "filter-date-start",
        "filter-date-end"
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("change", applyFilters);
    });
}


// ---------------------------------------------
// 8) Initialize Dashboard
// ---------------------------------------------
loadData().then(rows => {
    if (!rows || rows.length === 0) return;

    allRows = rows;

    populateFilters(allRows);
    attachFilterEvents();

    renderKPIs(calculateKPIs(allRows));
    renderLOBChart(groupByProgram(allRows));
});


