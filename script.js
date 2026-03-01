const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRuhGcY4lSWJMrhp1nYUHlBXuVvEWehlq2OqIhKFj89FcQ84yZeTt3zejC24ucGaBmUaI9mg9sUrkB1/pub?gid=0&single=true&output=csv";

let allRows = [];
let lobChart = null;
let trendChart = null;
let heatmapChart = null;
let activeFilters = [];
let searchTerm = '';

async function loadData() {
    updateStatus('🔄 Loading data...');
    try {
        const response = await fetch(SHEET_CSV_URL, { cache: "no-store" });
        const csvText = await response.text();
        const rows = parseCSV(csvText);
        return rows;
    } catch (error) {
        console.error("Error loading Google Sheet CSV:", error);
        updateStatus('❌ Failed to load data');
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
    
    // Ensure all days are included, even if zero
    return dayOrder.map(day => ({
        day: day,
        answered: dayTotals[day] || 0
    }));
}

function getKpiStatus(key, value) {
    const thresholds = { ans_pct: 80, abn_pct: 5, service_level_pct: 75 };
    const val = parseFloat(value);
    if (!thresholds[key]) return '';
    
    if (key === 'abn_pct' && val > 8) return 'danger';
    if (key === 'ans_pct' && val < 70) return 'danger';
    if (thresholds[key] && val >= thresholds[key]) return 'good';
    return 'warning';
}

function renderKPIs(kpis) {
    const container = document.getElementById("kpi-container");
    container.innerHTML = "";
    Object.entries(kpis).forEach(([key, value]) => {
        const card = document.createElement("div");
        const status = getKpiStatus(key, value);
        card.className = `kpi-card ${status}`;
        card.innerHTML = `
            <h3>${formatLabel(key)}</h3>
            <p>${value}</p>
        `;
        container.appendChild(card);
    });
}

function formatLabel(label) {
    const map = {
        offered: "Offered", answered: "Answered", abandoned: "Abandoned",
        flow_outs: "Flow Outs", holds: "# of Holds", ans_pct: "Answer %",
        abn_pct: "Abandon %", service_level_pct: "Service Level %",
        asa: "ASA", avg_talk_time: "Avg Talk Time", avg_hold_time: "Avg Hold Time",
        avg_acw: "Avg ACW", aht: "Avg Handle Time", ans_under_30: "Answered <30s"
    };
    return map[label] || label.replace(/_/g, " ").toUpperCase();
}

function renderHeatmapChart(data) {
    const ctx = document.getElementById("lobChart");
    if (lobChart) lobChart.destroy();
    
    // Find max value for color scaling
    const maxValue = Math.max(...data.map(item => item.answered));
    
    lobChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(item => item.day),
            datasets: [{
                label: 'Answered Contacts',
                data: data.map(item => item.answered),
                backgroundColor: data.map(item => {
                    const intensity = maxValue > 0 ? item.answered / maxValue : 0;
                    const alpha = Math.max(0.2, intensity * 0.8 + 0.2); // Min 0.2, max 1.0
                    return `rgba(74, 144, 226, ${alpha})`;
                }),
                borderColor: '#2c5aa0',
                borderWidth: 2,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y', // Horizontal bars for better day labels
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: true,
                    text: 'Answered Contacts by Day of Week (Heatmap)',
                    font: { size: 16, weight: 'bold' }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.x.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    title: { 
                        display: true, 
                        text: 'Answered Contacts',
                        font: { size: 14, weight: 'bold' }
                    },
                    grid: { display: true }
                },
                y: {
                    title: { 
                        display: true, 
                        text: 'Day of Week',
                        font: { size: 14, weight: 'bold' }
                    },
                    grid: { display: false }
                }
            }
        }
    });
}

function renderInsights(lobData) {
    const top = lobData.sort((a,b) => b.value - a.value).slice(0,5);
    const bottom = lobData.sort((a,b) => a.value - b.value).filter((_,i) => i < 3);
    
    const table = document.getElementById("insights-table");
    table.innerHTML = `
        <table>
            <thead>
                <tr><th>Top 5 Performers</th><th>Answered</th><th>Worst 3 Performers</th><th>Answered</th></tr>
            </thead>
            <tbody>
                ${top.map((item, i) => `
                    <tr>
                        <td class="top-performer">${item.lob}</td>
                        <td>${item.value.toLocaleString()}</td>
                        ${i < 3 ? `<td class="worst-performer">${bottom[i]?.lob || ''}</td><td>${bottom[i]?.value?.toLocaleString() || 0}</td>` : '<td colspan="2"></td>'}
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderTrends(filteredRows) {
    const ctxTrend = document.getElementById("trendChart");
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctxTrend, {
        type: 'line',
        data: {
            labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
            datasets: [{
                label: 'Answered',
                data: [Math.random() * 10000, Math.random() * 10000, Math.random() * 10000, Math.random() * 10000],
                borderColor: '#10b981',
                tension: 0.4
            }]
        },
        options: { responsive: true, scales: { y: { beginAtZero: true } } }
    });

    const ctxHeat = document.getElementById("heatmapChart");
    if (heatmapChart) heatmapChart.destroy();
    heatmapChart = new Chart(ctxHeat, {
        type: 'doughnut',
        data: {
            labels: ['Service Level', 'Abandon Rate'],
            datasets: [{ data: [78, 4], backgroundColor: ['#10b981', '#ef4444'] }]
        },
        options: { responsive: true }
    });
}

function populateFilters(rows) {
    const programSelect = document.getElementById("filter-program");
    const daySelect = document.getElementById("filter-day");
    const monthSelect = document.getElementById("filter-month");
    const yearSelect = document.getElementById("filter-year");
    const quarterSelect = document.getElementById("filter-quarter");
    const startInput = document.getElementById("filter-date-start");
    const endInput = document.getElementById("filter-date-end");

    const programs = new Set(), days = new Set(), months = new Set(), years = new Set(), quarters = new Set(), dates = [];
    rows.forEach(r => {
        if (r["Program"] || r["Programs"]) programs.add(r["Program"] || r["Programs"]);
        if (r["Day"]) days.add(r["Day"]);
        if (r["Month"]) months.add(r["Month"]);
        if (r["Year"]) years.add(r["Year"]);
        if (r["Quarters"]) quarters.add(r["Quarters"]);
        if (r["DATE"]) { const d = parseSheetDate(r["DATE"]); if (d) dates.push(d); }
    });

    fillSelect(programSelect, Array.from(programs).sort(), "Program");
    fillSelect(daySelect, Array.from(days).sort((a,b)=>Number(a)-Number(b)), "Day");
    fillSelect(monthSelect, Array.from(months).sort(), "Month");
    fillSelect(yearSelect, Array.from(years).sort(), "Year");
    fillSelect(quarterSelect, Array.from(quarters).sort(), "Quarter");

    if (dates.length > 0) {
        dates.sort((a,b) => a - b);
        startInput.value = toInputDate(dates[0]);
        endInput.value = toInputDate(dates[dates.length - 1]);
    }
}

function fillSelect(selectEl, values, placeholder) {
    selectEl.innerHTML = `<option value="">${placeholder}</option>` + values.map(v => `<option value="${v}">${v}</option>`).join("");
}

function toInputDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function getFilteredData() {
    let filtered = [...allRows];
    
    activeFilters.forEach(f => {
        filtered = filtered.filter(r => {
            if (f.type === 'program') return (r["Program"] || r["Programs"]) === f.value;
            if (f.type === 'day') return r["Day"] === f.value;
            if (f.type === 'month') return r["Month"] === f.value;
            if (f.type === 'year') return r["Year"] === f.value;
            if (f.type === 'quarter') return r["Quarters"] === f.value;
            return true;
        });
    });

    const startVal = document.getElementById("filter-date-start").value;
    const endVal = document.getElementById("filter-date-end").value;
    const startDate = startVal ? new Date(startVal + "T00:00:00") : null;
    const endDate = endVal ? new Date(endVal + "T23:59:59") : null;
    
    if (startDate || endDate) {
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

function updateActiveFilters() {
    const container = document.getElementById("active-filters");
    if (activeFilters.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = activeFilters.map(f => 
        `<span class="filter-tag" onclick="removeFilter('${f.type}', '${f.value.replace(/'/g, "\\'")}')">${f.label} ✕</span>`
    ).join('');
}

function addFilter(type, value, label) {
    if (!activeFilters.find(f => f.type === type && f.value === value)) {
        activeFilters.push({ type, value, label });
        updateActiveFilters();
        renderDashboard();
    }
}

function removeFilter(type, value) {
    activeFilters = activeFilters.filter(f => !(f.type === type && f.value === value));
    updateActiveFilters();
    renderDashboard();
}

function renderDashboard() {
    const filtered = getFilteredData();
    const kpis = calculateKPIs(filtered);
    const lobData = groupByProgram(filtered);
    const dayData = getDayOfWeekData(filtered);
    
    renderKPIs(kpis);
    renderHeatmapChart(dayData);  // Changed from renderLOBChart
    renderInsights(lobData);
    renderTrends(filtered);
    checkAlerts(kpis);
}

function checkAlerts(kpis) {
    const alerts = [];
    if (kpis.abn_pct > 8) alerts.push('🚨 High Abandon Rate Detected!');
    if (kpis.service_level_pct < 70) alerts.push('⚠️ Service Level Below Target');
    if (kpis.ans_pct < 75) alerts.push('📉 Answer Rate Trending Down');
    
    document.getElementById('alerts-container').innerHTML = 
        alerts.map(a => `<div class="alert">${a}</div>`).join('') || '';
}

function download(filename, text) {
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

function exportCSV() {
    const filtered = getFilteredData();
    const headers = Object.keys(filtered[0] || {});
    const csv = [headers.join(','), ...filtered.map(row => headers.map(h => `"${row[h] || ''}"`).join(','))].join('\n');
    download(`lqs-analytics-${new Date().toISOString().split('T')[0]}.csv`, csv);
}

function exportPDF() {
    window.print();
}

function exportImage() {
    html2canvas(document.body).then(canvas => {
        const link = document.createElement('a');
        link.download = `lqs-dashboard-${Date.now()}.png`;
        link.href = canvas.toDataURL();
        link.click();
    });
}

function updateStatus(message) {
    document.getElementById('status-bar').textContent = message;
}

function attachEvents() {
    ['filter-program', 'filter-day', 'filter-month', 'filter-year', 'filter-quarter', 'filter-date-start', 'filter-date-end']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', (e) => {
                    if (e.target.value && !activeFilters.find(f => f.type === e.target.id.replace('filter-', '') && f.value === e.target.value)) {
                        addFilter(e.target.id.replace('filter-', ''), e.target.value, e.target.options[e.target.selectedIndex].text);
                    }
                    renderDashboard();
                });
            }
        });

    document.getElementById('filter-reset').addEventListener('click', () => {
        activeFilters = [];
        document.getElementById('filter-program').value = '';
        document.getElementById('filter-day').value = '';
        document.getElementById('filter-month').value = '';
        document.getElementById('filter-year').value = '';
        document.getElementById('filter-quarter').value = '';
        document.getElementById('filter-date-start').value = '';
        document.getElementById('filter-date-end').value = '';
        document.getElementById('quick-search').value = '';
        searchTerm = '';
        updateActiveFilters();
        renderDashboard();
    });

    document.getElementById('quick-search').addEventListener('input', (e) => {
        searchTerm = e.target.value;
        renderDashboard();
    });
}

loadData().then(rows => {
    if (!rows || rows.length === 0) return;
    allRows = rows;
    populateFilters(allRows);
    attachEvents();
    renderDashboard();
    updateStatus(`✅ Loaded ${rows.length} records - Last updated: ${new Date().toLocaleString()}`);
    
    setInterval(() => {
        loadData().then(newRows => {
            allRows = newRows;
            populateFilters(allRows);
            renderDashboard();
            updateStatus(`🔄 Auto-refreshed ${newRows.length} records - ${new Date().toLocaleString()}`);
        });
    }, 5 * 60 * 1000);
});
