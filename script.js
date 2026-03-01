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
            // Escaped quote
            current += '"';
            i++;
        } else if (char === '"') {
            // Toggle quote mode
            insideQuotes = !insideQuotes;
        } else if (char === ',' && !insideQuotes) {
            // Column separator
            row.push(current);
            current = "";
        } else if ((char === '\n' || char === '\r') && !insideQuotes) {
            // Row separator
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

    // Push last cell / row
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
// DATE PARSER (supports MM/DD/YYYY and YYYY-MM-DD)
// ---------------------------------------------
function parseSheetDate(value) {
    if (!value) return null;

    const str = String(value).trim();

    // ISO-like export (yyyy-mm-dd or yyyy-mm-dd hh:mm:ss)
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        const [ymd] = str.split(" ");
        const [y, m, d] = ymd.split("-").map(Number);
        const dt = new Date(y, m - 1, d);
        return isNaN(dt.getTime()) ? null : dt;
    }

    // mm/dd/yy or mm/dd/yyyy
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
// 3) KPI CALCULATIONS (SECONDS → HH:MM:SS)
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

    // These are already in SECONDS
    const talkTime = sum(rows, "Talk Time");
    const holdTime = sum(rows, "Hold Time");
    const acwTime = sum(rows, "ACW Time");
    const handleTime = sum(rows, "Handle Time");

    const ansPct = offered ? (answered / offered) * 100 : 0;
    const abnPct = offered ? (abandoned / offered) * 100 : 0;
    const slPct = answered ? (ansUnder30 / answered) * 100 : 0;

    // Averages (seconds → HH:MM:SS)
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

// Sanitizing numeric strings from CSV (handles commas, %, currency, etc.)
function sum(rows, col) {
    return rows.reduce((total, r) => {
        let raw = r[col] ?? "";
        raw = String(raw).trim();

        // Strip non-numeric except digits, dot, minus
        let cleaned = raw.replace(/[^0-9.\-]/g, "");
        if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") {
            return total;
        }

        const val = parseFloat(cleaned);
        return total + (isNaN(val) ? 0 : val);
    }, 0);
}


// ---------------------------------------------
// 4) GROUP BY PROGRAM
// ---------------------------------------------
function groupByProgram(rows) {
    const map = {};

    rows.forEach(r => {
        const program = r["Program"] || r["Programs"] || "Unknown";
        const answered = sum([r], "ANS. #");

        if (!map[program]) map[program] = 0;
        map[program] += answered;
    });

    return Object.entries(map).map(([lob, value]) => ({ lob, value }));
}


// ---------------------------------------------
// 5) RENDER KPI CARDS
// ---------------------------------------------
function renderKPIs(kpis) {
    const container = document.getElementById("kpi-container");
    container.innerHTML = "";

    Object.entries(kpis).forEach(([key, value]) => {
        const card = document.createElement("div");
        card.className = "kpi-card";

        card.innerHTML = `
            <h3>${formatLabel(key)}</h3>
            <p>${value}</p>
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
// 6) RENDER BAR CHART
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
// 7) FILTERS
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

    // Inputs are yyyy-mm-dd; normalize to full-day range
    const startDate = startVal ? new Date(startVal + "T00:00:00") : null;
    const endDate = endVal ? new Date(endVal + "T23:59:59") : null;

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


// Reset all filters to full dataset
function resetFilters() {
    if (!allRows || allRows.length === 0) return;

    const programSelect = document.getElementById("filter-program");
    const daySelect = document.getElementById("filter-day");
    const monthSelect = document.getElementById("filter-month");
    const yearSelect = document.getElementById("filter-year");
    const quarterSelect = document.getElementById("filter-quarter");
    const startInput = document.getElementById("filter-date-start");
    const endInput = document.getElementById("filter-date-end");

    if (programSelect) programSelect.value = "";
    if (daySelect) daySelect.value = "";
    if (monthSelect) monthSelect.value = "";
    if (yearSelect) yearSelect.value = "";
    if (quarterSelect) quarterSelect.value = "";

    const dates = [];
    allRows.forEach(r => {
        if (r["DATE"]) {
            const d = parseSheetDate(r["DATE"]);
            if (d) dates.push(d);
        }
    });

    if (dates.length > 0) {
        dates.sort((a, b) => a - b);
        if (startInput) startInput.value = toInputDate(dates[0]);
        if (endInput) endInput.value = toInputDate(dates[dates.length - 1]);
    } else {
        if (startInput) startInput.value = "";
        if (endInput) endInput.value = "";
    }

    const kpis = calculateKPIs(allRows);
    renderKPIs(kpis);
    renderLOBChart(groupByProgram(allRows));
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

    const resetBtn = document.getElementById("filter-reset");
    if (resetBtn) {
        resetBtn.addEventListener("click", resetFilters);
    }
}


// ---------------------------------------------
// 8) INITIALIZE DASHBOARD
// ---------------------------------------------
loadData().then(rows => {
    if (!rows || rows.length === 0) return;

    allRows = rows;

    populateFilters(allRows);
    attachFilterEvents();

    renderKPIs(calculateKPIs(allRows));
    renderLOBChart(groupByProgram(allRows));
});
