const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRuhGcY4lSWJMrhp1nYUHlBXuVvEWehlq2OqIhKFj89FcQ84yZeTt3zejC24ucGaBmUaI9mg9sUrkB1/pub?gid=0&single=true&output=csv";

let allRows = [];
let lobChart = null;
let trendChart = null;
let heatmapChart = null;
let activeFilters = [];
let searchTerm = '';

// COMPACT DASHBOARD LAYOUT - Fit to single screen
async function loadData() {
    updateStatus('🔄 Loading...');
    try {
        const response = await fetch(SHEET_CSV_URL, { cache: "no-store" });
        const csvText = await response.text();
        const rows = parseCSV(csvText);
        return rows;
    } catch (error) {
        console.error("Error loading CSV:", error);
        updateStatus('❌ Load failed');
        return [];
    }
}

function parseCSV(csv) {
    const rows = [];
    let row = [];
    let current = "";
    let insideQuotes = false;

    for (let i = 0; i < csv.length; i++) {
        const char = csv[i];
        const next = csv[i + 1];
        if (char === '"' && insideQuotes && next === '"') {
            current += '"'; i++;
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
        headers.forEach((h, i) => obj[h] = (cols[i] || "").trim());
        return obj;
    });
}

function toHHMMSS(seconds) {
    seconds = Math.floor(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

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
    let [m, d, y] = parts.map(p => p.trim()).map(Number);
    if (y < 100) y = 2000 + y;
    const dt = new Date(y, m - 1, d);
    return isNaN(dt.getTime()) ? null : dt;
}

function sum(rows, col) {
    return rows.reduce((total, r) => {
        let raw = r[col] ?? "";
        raw = String(raw).trim();
        let cleaned = raw.replace(/[^0-9.\-]/g, "");
        if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") return total;
        const val = parseFloat(cleaned);
        return total + (isNaN(val) ? 0 : val);
    }, 0);
}

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
        offered, answered, abandoned, flow_outs: flowOuts, holds,
        ans_pct: Math.round(ansPct), abn_pct: Math.round(abnPct), 
        service_level_pct: Math.round(slPct),
        asa: toHHMMSS(asaSec), avg_talk_time: toHHMMSS(avgTalkSec),
        avg_hold_time: toHHMMSS(avgHoldSec), avg_acw: toHHMMSS(avgACWSec),
        aht: toHHMMSS(avgHandleSec), ans_under_30: ansUnder30
    };
}

function getDayOfWeekData(filteredRows) {
    const dayTotals = {};
    const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    
    filteredRows.forEach(row => {
        const day = row["Day"];
        if (day && dayOrder.includes(day)) {
            const answered = sum([row], "ANS. #");
            dayTotals[day] = (dayTotals[day] || 0) + answered;
        }
    });
    
    return dayOrder.map(day => ({
        day: day.substring(0, 3), // Shorten to 3 letters
        answered: dayTotals[day] || 0
    }));
}

function renderCompactKPIs(kpis) {
    const container = document.getElementById("kpi-grid");
    container.innerHTML = `
        <div class="kpi-item"><div class="kpi-value">${kpis.answered.toLocaleString()}</div><div>Answered</div></div>
        <div class="kpi-item"><div class="kpi-value">${kpis.offered.toLocaleString()}</div><div>Offered</div></div>
        <div class="kpi-item"><div class="kpi-value">${kpis.abn_pct}%</div><div>Abandon %</div></div>
        <div class="kpi-item"><div class="kpi-value">${kpis.service_level_pct}%</div><div>Service Level</div></div>
        <div class="kpi-item"><div class="kpi-value">${kpis.aht}</div><div>AHT</div></div>
        <div class="kpi-item"><div class="kpi-value">${kpis.asa}</div><div>ASA</div></div>
    `;
}

function renderHeatmapChart(data) {
    const ctx = document.getElementById("main-chart");
    if (lobChart) lobChart.destroy();
    
    const maxValue = Math.max(...data.map(item => item.answered));
    
    lobChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(item => item.day),
            datasets: [{
                data: data.map(item => item.answered),
                backgroundColor: data.map(item => {
                    const intensity = maxValue > 0 ? item.answered / maxValue : 0;
                    const alpha = Math.max(0.3, intensity * 0.7 + 0.3);
                    return `rgba(74, 144, 226, ${alpha})`;
                }),
                borderColor: '#1e40af',
                borderWidth: 2,
                borderRadius: 6,
                barThickness: 25
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: ctx => ctx[0].label,
                        label: ctx => `${ctx.parsed.x.toLocaleString()} calls`
                    }
                }
            },
            scales: {
                x: { 
                    display: false,
                    min: 0,
                    max: maxValue * 1.1
                },
                y: {
                    grid: { display: false },
                    ticks: { font: { size: 12 } }
                }
            },
            animation: { duration: 1000 }
        }
    });
}

function renderTrends(filteredRows) {
    // Small trend line chart
    const ctxTrend = document.getElementById("trend-mini");
    if (trendChart) trendChart.destroy();
    
    trendChart = new Chart(ctxTrend, {
        type: 'line',
        data: {
            labels: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
            datasets: [{
                data: data.map(d => d.answered),
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.2)',
                tension: 0.4,
                fill: true,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: { display: false }
            }
        }
    });
}

function getFilteredData() {
    let filtered = [...allRows];
    
    // Apply filters (shortened for brevity)
    activeFilters.forEach(f => {
        filtered = filtered.filter(r => {
            if (f.type === 'program') return (r["Program"] || r["Programs"]) === f.value;
            if (f.type === 'day') return r["Day"] === f.value;
            return true;
        });
    });

    const startVal = document.getElementById("filter-date-start")?.value;
    const endVal = document.getElementById("filter-date-end")?.value;
    if (startVal || endVal) {
        const startDate = startVal ? new Date(startVal + "T00:00:00") : null;
        const endDate = endVal ? new Date(endVal + "T23:59:59") : null;
        filtered = filtered.filter(r => {
            const d = parseSheetDate(r["DATE"]);
            if (!d) return false;
            if (startDate && d < startDate) return false;
            if (endDate && d > endDate) return false;
            return true;
        });
    }

    if (searchTerm) {
        filtered = filtered.filter(r => 
            Object.values(r).some(val => String(val).toLowerCase().includes(searchTerm.toLowerCase()))
        );
    }
    return filtered;
}

function renderDashboard() {
    const filtered = getFilteredData();
    const kpis = calculateKPIs(filtered);
    const dayData = getDayOfWeekData(filtered);
    
    renderCompactKPIs(kpis);
    renderHeatmapChart(dayData);
    renderTrends(dayData);
    updateStatus(`📊 ${filtered.length} records | Total: ${kpis.answered.toLocaleString()}`);
}

function updateStatus(message) {
    document.getElementById('status-bar') && (document.getElementById('status-bar').textContent = message);
}

// Simplified init - auto-fits screen
loadData().then(rows => {
    if (!rows?.length) return;
    allRows = rows;
    renderDashboard();
    updateStatus(`✅ ${rows.length} records loaded`);
    
    // Auto refresh
    setInterval(() => loadData().then(r => { allRows = r; renderDashboard(); }), 300000);
});

// Add CSS for compact layout (add to your HTML <head>)
const style = document.createElement('style');
style.textContent = `
body { 
    margin: 0; padding: 10px; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; 
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh;
}
#dashboard { max-width: 1400px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr 1fr; grid-template-rows: auto 1fr auto; gap: 15px; height: 95vh; }
#header { grid-column: 1 / -1; background: rgba(255,255,255,0.95); padding: 15px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; }
#kpi-grid { grid-column: 1; display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; background: rgba(255,255,255,0.95); padding: 15px; border-radius: 12px; }
.kpi-item { text-align: center; padding: 10px; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
.kpi-value { font-size: 24px; font-weight: 700; color: #1e40af; margin-bottom: 4px; }
#main-chart { grid-column: 2; background: rgba(255,255,255,0.95); padding: 15px; border-radius: 12px; height: 100%; }
#sidebar { grid-column: 3; display: flex; flex-direction: column; gap: 15px; }
#trend-mini, .mini-chart { background: rgba(255,255,255,0.95); padding: 15px; border-radius: 12px; height: 120px; }
#bottom-stats { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(auto-fit,minmax(200px,1fr)); gap: 10px; }
.stat-card { background: rgba(255,255,255,0.95); padding: 12px; border-radius: 8px; text-align: center; }
#status-bar { background: rgba(0,0,0,0.8); color: white; padding: 8px; border-radius: 6px; font-size: 14px; grid-column: 1 / -1; }
canvas { max-height: 100%; }
@media (max-width: 1200px) { #dashboard { grid-template-columns: 1fr; grid-template-rows: auto auto 1fr auto auto; } }
`;
document.head.appendChild(style);
`;
document.head.appendChild(style);
