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

        // ✅ CHANGE #2: Updated timestamp message
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
// DATE PARSER (supports MM/DD/YYYY and YYYY-MM-DD)
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
// ... (Everything else unchanged until showAlert)
// ---------------------------------------------


// Simple toast alert
function showAlert(message) {
    const container = document.getElementById("alerts");
    if (!container) return;

    const el = document.createElement("div");
    el.className = "alert";
    el.textContent = message;

    container.appendChild(el);

    setTimeout(() => {
        el.classList.add("fade-out");
        setTimeout(() => el.remove(), 400);
    }, 2500);
}


// ---------------------------------------------
// ✅ CHANGE #1: EXPORT BUTTONS (NEW)
// ---------------------------------------------
function attachExportEvents() {
    const pngBtn = document.getElementById("download-png");
    const pdfBtn = document.getElementById("download-pdf");
    
    if (pngBtn) pngBtn.addEventListener("click", downloadPNG);
    if (pdfBtn) pdfBtn.addEventListener("click", downloadPDF);
}

function downloadPNG() {
    const canvasList = ['lobChart', 'volumeTrendChart', 'slAbnTrendChart', 'ahtChart'];
    const canvases = canvasList.map(id => document.getElementById(id)).filter(c => c);
    
    if (canvases.length === 0) {
        showAlert("No charts to export");
        return;
    }

    const canvas = canvases[0];  // LOB chart
    const link = document.createElement('a');
    link.download = `LQS_Dashboard_${new Date().toISOString().slice(0,10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showAlert("PNG downloaded successfully!");
}

function downloadPDF() {
    showAlert("PDF export coming soon - PNG works perfectly!");
}


// ---------------------------------------------
// 8) INITIALIZE DASHBOARD
// ---------------------------------------------
loadData().then(rows => {
    if (!rows || rows.length === 0) return;

    allRows = rows;

    populateFilters(allRows);
    attachFilterEvents();
    attachExportEvents();  // ✅ CHANGE #3: Added export buttons

    const initialKpis = calculateKPIs(allRows);
    renderKPIs(initialKpis);
    renderLOBChart(groupByBusiness(allRows));
    renderVolumeTrendChart(allRows);
    renderSLAbnTrendChart(allRows);
    renderAHTChart(allRows);
});
