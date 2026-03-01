const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRuhGcY4lSWJMrhp1nYUHlBXuVvEWehlq2OqIhKFj89FcQ84yZeTt3zejC24ucGaBmUaI9mg9sUrkB1/pub?gid=0&single=true&output=csv";

let allRows = [];
let lobChart = null;
let trendChart = null;
let heatmapChart = null;
let activeFilters = [];
let searchTerm = '';

async function loadData() {
    const statusBar = document.getElementById('status-bar');
    if (statusBar) {
        statusBar.classList.add('loading');
        statusBar.textContent = '🔄 Loading data...';
    }
    
    try {
        const response = await fetch(SHEET_CSV_URL, { cache: "no-store" });
        const csvText = await response.text();
        const rows = parseCSV(csvText);
        return rows;
    } catch (error) {
        console.error("Error loading CSV:", error);
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
        day: day.substring(0, 3),
        answered: dayTotals[day] || 0
    }));
}

function groupByProgram(rows) {
    const map = {};
    rows.forEach(r => {
        const program = r["Program"] || r["Programs"] || "Unknown";
        const answered = sum([r], "ANS. #");
        map[program] = (map[program] || 0) + answered;
    });
    return Object.entries(map).map(([lob, value]) => ({ lob, value }));
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

function formatLabel(label) {
    const map = {
        offered: "Offered", answered: "Answered", abandoned: "Abandoned",
        flow_outs: "Flow Outs", holds: "# of Holds", ans_pct: "Answer %",
        abn_pct: "Abandon %", service_level_pct: "Service Level %",
        asa: "ASA", avg_talk_time: "Avg Talk Time", avg_hold_time: "Avg Hold Time",
        avg_acw: "Avg ACW", aht: "Avg Handle Time"
    };
    return map[label] || label.replace(/_/g, " ").toUpperCase();
}

function renderKPIs(kpis) {
    const container = document.getElementById("kpi-container");
    if (!container) return;
    
    container.innerHTML = '';
    const kpiOrder = ['answered', 'offered', 'abn_pct', 'service_level_pct', 'aht', 'asa'];
    
    kpiOrder.forEach(key => {
        const card = document.createElement('div');
        const status = getKpiStatus(key, kpis[key]);
        card.className = `kpi-card ${status}`;
        card.innerHTML = `
            <h3>${formatLabel(key)}</h3>
            <p>${kpis[key]}</p>
        `;
        container.appendChild(card);
    });
}

function renderHeatmapChart(data) {
    const canvas = document.getElementById('lobChart');
    if (!canvas) return;
    
    if (lobChart) lobChart.destroy();
    
    const maxValue = Math.max(...data.map(item => item.answered));
    
    lobChart = new Chart(canvas, {
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
                barThickness: 30
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { display: false },
                y: { 
                    grid: { display: false },
                    ticks: { font: { size: 13 } }
                }
            },
            animation: {
                duration: 1000,
                easing: 'easeOutQuart'
            }
        }
    });
}

function renderTrendChart(dayData) {
    const canvas = document.getElementById('trendChart');
    if (!canvas || trendChart) {
        if (trendChart) trendChart.destroy();
        return;
    }
    
    trendChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: dayData.map(d => d.day),
            datasets: [{
                data: dayData.map(d => d.answered),
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 5,
                pointHoverRadius: 8,
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: { display: false }
            },
            elements: {
                point: { hoverBackgroundColor: '#059669' }
            }
        }
    });
}

function renderServiceLevelChart(kpis) {
    const canvas = document.getElementById('heatmapChart');
    if (!canvas || heatmapChart) {
        if (heatmapChart) heatmapChart.destroy();
        return;
    }
    
    heatmapChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: ['Service Level', 'Abandon Rate'],
            datasets: [{
                data: [kpis.service_level_pct, kpis.abn_pct],
                backgroundColor: ['#10b981', '#ef4444'],
                borderWidth: 0,
                cutout: '70%'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.label}: ${context.parsed}%`;
                        }
                    }
                }
            }
        }
    });
}

function renderInsights(lobData) {
    const container = document.getElementById("insights-table");
    if (!container) return;
    
    const top = lobData.sort((a,b) => b.value - a.value).slice(0,3);
    const bottom = lobData.sort((a,b) => a.value - b.value).slice(0,3);
    
    container.innerHTML = `
        <table>
            <thead>
                <tr><th>Top LOBs</th><th>Answered</th><th>Bottom LOBs</th><th>Answered</th></tr>
            </thead>
            <tbody>
                ${top.map((item, i) => `
                    <tr>
                        <td class="top-performer">${item.lob}</td>
                        <td>${item.value.toLocaleString()}</td>
                        <td class="worst-performer">${bottom[i]?.lob || '-'}</td>
                        <td>${bottom[i]?.value?.toLocaleString() || 0}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
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
    const lobData = groupByProgram(filtered);
    
    renderKPIs(kpis);
    renderHeatmapChart(dayData);
    renderTrendChart(dayData);
    renderServiceLevelChart(kpis);
    renderInsights(lobData);
    checkAlerts(kpis);
    updateStatus(`✅ ${filtered.length} records | Answered: ${kpis.answered.toLocaleString()} | ${new Date().toLocaleTimeString()}`);
}

function updateStatus(message) {
    const statusBar = document.getElementById('status-bar');
    if (statusBar) {
        statusBar.textContent = message;
        statusBar.classList.remove('loading');
    }
}

function checkAlerts(kpis) {
    const alerts = [];
    if (kpis.abn_pct > 8) alerts.push('🚨 High Abandon Rate Detected!');
    if (kpis.service_level_pct < 70) alerts.push('⚠️ Service Level Below Target');
    if (kpis.ans_pct < 75) alerts.push('📉 Low Answer Rate');
    
    const container = document.getElementById('alerts-container');
    if (container) {
        container.innerHTML = alerts.map(a => `<div class="alert">${a}</div>`).join('') || '';
    }
}

function populateFilters(rows) {
    const selects = {
        'filter-program': new Set(),
        'filter-day': new Set(),
        'filter-month': new Set(),
        'filter-year': new Set(),
        'filter-quarter': new Set()
    };
    
    rows.forEach(r => {
        selects['filter-program'].add(r["Program"] || r["Programs"] || '');
        selects['filter-day'].add(r["Day"] || '');
        selects['filter-month'].add(r["Month"] || '');
        selects['filter-year'].add(r["Year"] || '');
        selects['filter-quarter'].add(r["Quarters"] || '');
    });

    Object.entries(selects).forEach(([id, values]) => {
        const select = document.getElementById(id);
        if (select) {
            const sortedValues = Array.from(values).filter(v => v).sort();
            select.innerHTML = `<option value="">${id.replace('filter-', '')}</option>` + 
                sortedValues.map(v => `<option value="${v}">${v}</option>`).join('');
        }
    });
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

function updateActiveFilters() {
    const container = document.getElementById("active-filters");
    if (!container) return;
    
    if (activeFilters.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = activeFilters.map(f => 
        `<span class="filter-tag" onclick="removeFilter('${f.type}', '${f.value.replace(/'/g, "\\'")}')">${f.label} ✕</span>`
    ).join('');
}

// EXPORT FUNCTIONS
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
    if (!filtered.length) return;
    const headers = Object.keys(filtered[0]);
    const csv = [headers.join(','), 
        ...filtered.map(row => headers.map(h => `"${row[h] || ''}"`).join(','))].join('\n');
    download(`dashboard-${new Date().toISOString().split('T')[0]}.csv`, csv);
}

function exportPDF() {
    window.print();
}

function exportImage() {
    html2canvas(document.body, { 
        scale: 2,
        useCORS: true,
        backgroundColor: '#f5f7fa'
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = `dashboard-${Date.now()}.png`;
        link.href = canvas.toDataURL();
        link.click();
    });
}

function attachEvents() {
    // Quick search
    const searchEl = document.getElementById('quick-search');
    if (searchEl) {
        searchEl.addEventListener('input', (e) => {
            searchTerm = e.target.value;
            renderDashboard();
        });
    }

    // Filter selects
    ['filter-program', 'filter-day', 'filter-month', 'filter-year', 'filter-quarter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                const type = e.target.id.replace('filter-', '');
                if (e.target.value) {
                    addFilter(type, e.target.value, e.target.options[e.target.selectedIndex].text);
                } else {
                    // Clear filter if deselected
                    removeFilter(type, e.target.dataset.lastValue || '');
                }
                e.target.dataset.lastValue = e.target.value;
            });
        }
    });

    // Date filters
    ['filter-date-start', 'filter-date-end'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => renderDashboard());
        }
    });

    // Reset button
    const resetEl = document.getElementById('filter-reset');
    if (resetEl) {
        resetEl.addEventListener('click', () => {
            activeFilters = [];
            searchTerm = '';
            document.querySelectorAll('#control-bar select, #quick-search, .date-controls input').forEach(el => {
                el.value = '';
                if (el.tagName === 'SELECT') el.dataset.lastValue = '';
            });
            updateActiveFilters();
            renderDashboard();
        });
    }
}

// INITIALIZATION
loadData().then(rows => {
    if (!rows || rows.length === 0) {
        updateStatus('❌ No data loaded');
        return;
    }
    
    allRows = rows;
    populateFilters(allRows);
    attachEvents();
    renderDashboard();
    updateStatus(`✅ Loaded ${rows.length} records | Ready`);
    
    // Auto-refresh every 5 minutes
    setInterval(() => {
        loadData().then(newRows => {
            allRows = newRows;
            populateFilters(allRows);
            renderDashboard();
        });
    }, 5 * 60 * 1000);
});
