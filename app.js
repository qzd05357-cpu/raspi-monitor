// =====================================================
// 定数
// =====================================================
const SPREADSHEET_ID = "16iU30vglfkdwiKbNV7LN6-HY4bskH6iHJAtpwlD3SAs";
const GID_1H  = "317642509";  // Raspi 1時間平均シート
const GID_RAW = "0";          // Raspi 生データシート

/**
 * 全タブ共通のモード定義。
 * raspiGid: Raspi タブが7d のとき 1時間平均シートを使い、それ以外は生データシートを使う。
 */
const MODES = {
  '7d':   { days:   7, hours:  1, raspiGid: GID_1H,  label: '直近7日・1時間平均' },
  '30d':  { days:  30, hours:  6, raspiGid: GID_RAW, label: '直近30日・6時間平均' },
  '90d':  { days:  90, hours: 12, raspiGid: GID_RAW, label: '直近90日・12時間平均' },
  '180d': { days: 180, hours: 24, raspiGid: GID_RAW, label: '直近180日・24時間平均' },
};

const SW_DEVICES = [
  { name: "トイレ",   gid: "1917349074", colorT: "#FF6B6B", colorH: "#FF9F8B", cls: "sw0", icon: "🚽" },
  { name: "リビング", gid: "1678891253", colorT: "#FF9F43", colorH: "#FFD0A0", cls: "sw1", icon: "🛋️" },
  { name: "外",       gid: "1925376014", colorT: "#54A0FF", colorH: "#A0D4FF", cls: "sw2", icon: "🌿" },
];

const CMP_SOURCES = [
  { name: 'Raspi',    isRaspi: true,  gid: null,          colorT: '#a0c4ff', colorH: '#5bc5fa' },
  { name: 'トイレ',   isRaspi: false, gid: '1917349074',  colorT: '#FF6B6B', colorH: '#FF9F8B' },
  { name: 'リビング', isRaspi: false, gid: '1678891253',  colorT: '#FF9F43', colorH: '#FFD0A0' },
  { name: '外',       isRaspi: false, gid: '1925376014',  colorT: '#54A0FF', colorH: '#A0D4FF' },
];

// =====================================================
// ユーティリティ
// =====================================================

/** Google Sheets gviz CSV API からテキストを取得する。 */
function fetchCsv(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}&t=${Date.now()}`;
  return fetch(url).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
}

/**
 * CSV テキストをバケット集計し { labels, temps, hums, lights } を返す。
 * @param {string}  csvText  - CSVテキスト（ヘッダー行含む）
 * @param {Date}    cutoff   - この日時以前の行を除外
 * @param {number}  hours    - 集計時間単位（1, 6, 12, 24）
 * @param {boolean} hasLight - 4列目の照度データを集計するか
 */
function bucketAggregate(csvText, cutoff, hours, hasLight = false) {
  const lines  = csvText.trim().split('\n');
  const bucket = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(s => s.replace(/^"|"$/g, '').trim());
    if (cols.length < 3) continue;
    // Safari は "YYYY-MM-DD HH:MM:SS" を Invalid Date にするため ISO 形式に変換
    const dt = new Date(cols[0].replace(' ', 'T'));
    if (isNaN(dt) || dt < cutoff) continue;
    const hUnit = Math.floor(dt.getHours() / hours) * hours;
    const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(hUnit).padStart(2,'0')}:00`;
    if (!bucket[key]) bucket[key] = { t: [], h: [], l: [] };
    bucket[key].t.push(parseFloat(cols[1]));
    bucket[key].h.push(parseFloat(cols[2]));
    if (hasLight && cols.length >= 4 && cols[3] !== '') {
      const lv = parseFloat(cols[3]);
      if (!isNaN(lv)) bucket[key].l.push(lv);
    }
  }

  const avg    = arr => arr.length ? +(arr.reduce((a, v) => a + v, 0) / arr.length).toFixed(1) : null;
  const labels = Object.keys(bucket).sort();
  return {
    labels,
    temps:  labels.map(k => avg(bucket[k].t)),
    hums:   labels.map(k => avg(bucket[k].h)),
    lights: hasLight ? labels.map(k => bucket[k].l.length ? avg(bucket[k].l) : null) : null,
  };
}

/**
 * Chart.js 共通オプションを生成する。
 * @param {string[]} labels           - X軸ラベル配列
 * @param {string}   yTitle           - Y軸タイトル（"℃", "%" など）
 * @param {object}   [yRange={}]      - Y軸範囲 { min?, max? }
 */
function buildChartOptions(labels, yTitle, yRange = {}) {
  const n        = labels.length;
  // 72点以下（≒3日・1h）は時刻まで表示、それ以上は日付のみにして幅を節約
  const showTime = n <= 72;
  const formatTick = l => {
    const m = l.match(/\d{4}-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
    if (!m) return l;
    return showTime
      ? `${parseInt(m[1])}/${parseInt(m[2])} ${m[3]}:00`
      : `${parseInt(m[1])}/${parseInt(m[2])}`;
  };
  // Chart.js の autoSkip に任せ、最大表示数を制限する
  const maxTicksLimit = showTime ? 24 : 15;
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { labels: { color: '#ccc' } } },
    scales: {
      x: {
        ticks: {
          color: '#aaa', maxRotation: 90, minRotation: 45,
          autoSkip: true, maxTicksLimit,
          callback: (v, i) => formatTick(labels[i]),
        },
        grid:  { color: 'rgba(255,255,255,0.05)' },
      },
      y: {
        ...yRange,
        ticks: { color: '#aaa' },
        grid:  { color: 'rgba(255,255,255,0.08)' },
        title: { display: true, text: yTitle, color: '#aaa' },
      },
    },
  };
}

/** モードボタンのアクティブ状態を更新する。 */
function setActiveMode(prefix, activeMode) {
  ['7d', '30d', '90d', '180d'].forEach(m => {
    document.getElementById(`${prefix}${m}`).classList.toggle('active', m === activeMode);
  });
}

/** cutoff 日時を返す。 */
function makeCutoff(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

// =====================================================
// Raspberry Pi タブ
// =====================================================
let tempChartObj = null;
let humChartObj  = null;
let currentMode  = '7d';

function switchMode(mode) {
  currentMode = mode;
  setActiveMode('btn', mode);
  loadData();
}

function loadData() {
  document.getElementById('status').textContent = '読み込み中...';
  const cfg = MODES[currentMode];
  fetchCsv(cfg.raspiGid)
    .then(csv => {
      const { labels, temps, hums } = bucketAggregate(csv, makeCutoff(cfg.days), cfg.hours);
      renderRaspiCharts(labels, temps, hums);
      const t = new Date().toLocaleString('ja-JP');
      document.getElementById('tempUpdated').textContent = `更新: ${t}`;
      document.getElementById('humUpdated').textContent  = `更新: ${t}`;
      document.getElementById('status').textContent =
        `✅ ${cfg.label} / ${labels.length} 件（最終更新: ${t}）`;
    })
    .catch(err => {
      document.getElementById('status').textContent = `❌ 読み込みエラー: ${err.message}`;
    });
}

function renderRaspiCharts(labels, temps, hums) {
  const ptRadius = labels.length <= 12 ? 3 : 0;
  if (tempChartObj) tempChartObj.destroy();
  tempChartObj = new Chart(document.getElementById('tempChart'), {
    type: 'line',
    data: { labels, datasets: [{ label: '温度 (℃)', data: temps,
      borderColor: '#ff7043', backgroundColor: 'rgba(255,112,67,0.1)',
      borderWidth: 1.5, pointRadius: ptRadius, tension: 0.3, fill: true }] },
    options: buildChartOptions(labels, '℃'),
  });
  if (humChartObj) humChartObj.destroy();
  humChartObj = new Chart(document.getElementById('humChart'), {
    type: 'line',
    data: { labels, datasets: [{ label: '湿度 (%)', data: hums,
      borderColor: '#42a5f5', backgroundColor: 'rgba(66,165,245,0.1)',
      borderWidth: 1.5, pointRadius: ptRadius, tension: 0.3, fill: true }] },
    options: buildChartOptions(labels, '%'),
  });
}

// =====================================================
// SwitchBot タブ
// =====================================================
let swCurrentMode = '7d';
let swLoaded      = false;
const swCharts    = {};

function switchSwMode(mode) {
  swCurrentMode = mode;
  setActiveMode('sw-btn', mode);
  loadSwitchBotData();
}

function buildSwDom() {
  const container = document.getElementById('sw-charts');
  if (container.children.length > 0) return;  // 既に生成済み
  SW_DEVICES.forEach((dev, idx) => {
    const section  = document.createElement('div');
    section.id     = `sw-section-${idx}`;
    const luxHtml  = (idx === 1) ? `
      <div class="chart-container">
        <div class="chart-title ${dev.cls}">☀️ 照度推移（level 1〜20）</div>
        <div class="canvas-wrapper"><canvas id="sw-lux-${idx}"></canvas></div>
      </div>` : '';
    section.innerHTML = `
      <h2 style="text-align:center;color:#a0c4ff;margin:24px 0 12px">${dev.icon} ${dev.name}</h2>
      <div class="chart-container">
        <div class="chart-title ${dev.cls}">🌡 温度推移（℃）</div>
        <div class="canvas-wrapper"><canvas id="sw-temp-${idx}"></canvas></div>
      </div>
      <div class="chart-container">
        <div class="chart-title ${dev.cls}">💧 湿度推移（%）</div>
        <div class="canvas-wrapper"><canvas id="sw-hum-${idx}"></canvas></div>
      </div>${luxHtml}`;
    container.appendChild(section);
  });
}

function loadSwitchBotData() {
  document.getElementById('sw-status').textContent = '読み込み中...';
  buildSwDom();  // fetch 前に全デバイス分の DOM を生成（表示順序を固定）
  const cfg    = MODES[swCurrentMode];
  const cutoff = makeCutoff(cfg.days);
  let completed = 0, totalCount = 0;

  SW_DEVICES.forEach((dev, idx) => {
    const hasLight = (idx === 1);  // リビング Hub 2 のみ照度あり
    fetchCsv(dev.gid)
      .then(csv => {
        const { labels, temps, hums, lights } = bucketAggregate(csv, cutoff, cfg.hours, hasLight);
        totalCount += labels.length;
        renderSwChart(dev, idx, labels, temps, hums, lights);
        completed++;
        if (completed === SW_DEVICES.length) {
          document.getElementById('sw-status').textContent =
            `✅ ${cfg.label} / ${Math.round(totalCount / SW_DEVICES.length)} 件（最終更新: ${new Date().toLocaleString('ja-JP')}）`;
          swLoaded = true;
        }
      })
      .catch(err => {
        document.getElementById('sw-status').textContent =
          `❌ 読み込みエラー (${dev.name}): ${err.message}`;
      });
  });
}

function renderSwChart(dev, idx, labels, temps, hums, lights) {
  const ptRadius = labels.length <= 12 ? 3 : 0;
  if (swCharts[idx]?.temp) swCharts[idx].temp.destroy();
  if (swCharts[idx]?.hum)  swCharts[idx].hum.destroy();
  if (swCharts[idx]?.lux)  swCharts[idx].lux.destroy();
  if (!swCharts[idx]) swCharts[idx] = {};

  swCharts[idx].temp = new Chart(document.getElementById(`sw-temp-${idx}`), {
    type: 'line',
    data: { labels, datasets: [{ label: `${dev.name} 温度 (℃)`, data: temps,
      borderColor: dev.colorT, backgroundColor: dev.colorT + '22',
      borderWidth: 1.5, pointRadius: ptRadius, tension: 0.3, fill: true }] },
    options: buildChartOptions(labels, '℃'),
  });

  swCharts[idx].hum = new Chart(document.getElementById(`sw-hum-${idx}`), {
    type: 'line',
    data: { labels, datasets: [{ label: `${dev.name} 湿度 (%)`, data: hums,
      borderColor: dev.colorH, backgroundColor: dev.colorH + '22',
      borderWidth: 1.5, pointRadius: ptRadius, tension: 0.3, fill: true }] },
    options: buildChartOptions(labels, '%'),
  });

  if (lights !== null) {
    swCharts[idx].lux = new Chart(document.getElementById(`sw-lux-${idx}`), {
      type: 'line',
      data: { labels, datasets: [{ label: `${dev.name} 照度 (level)`, data: lights,
        borderColor: '#FFD700', backgroundColor: '#FFD70022',
        borderWidth: 1.5, pointRadius: ptRadius, tension: 0.3, fill: true, spanGaps: false }] },
      options: buildChartOptions(labels, 'level', { min: 0, max: 20 }),
    });
  }
}

// =====================================================
// 比較タブ（Raspi + SwitchBot 3台を1グラフに重ね表示）
// =====================================================
let cmpCurrentMode = '7d';
let cmpLoaded      = false;
let cmpTempChart   = null;
let cmpHumChart    = null;

function switchCmpMode(mode) {
  cmpCurrentMode = mode;
  setActiveMode('cmp-btn', mode);
  loadCmpData();
}

function loadCmpData() {
  document.getElementById('cmp-status').textContent = '読み込み中...';
  const cfg    = MODES[cmpCurrentMode];
  const cutoff = makeCutoff(cfg.days);

  const promises = CMP_SOURCES.map(src => {
    const gid = src.isRaspi ? cfg.raspiGid : src.gid;
    return fetchCsv(gid).then(csv => {
      const { labels, temps, hums } = bucketAggregate(csv, cutoff, cfg.hours);
      const result = {};
      labels.forEach((k, i) => { result[k] = { t: temps[i], h: hums[i] }; });
      return result;
    });
  });

  Promise.all(promises)
    .then(buckets => {
      const allKeys = new Set();
      buckets.forEach(b => Object.keys(b).forEach(k => allKeys.add(k)));
      const labels = Array.from(allKeys).sort();

      const tempDatasets = CMP_SOURCES.map((src, i) => ({
        label: src.name + ' 温度',
        data: labels.map(k => (buckets[i][k] !== undefined ? buckets[i][k].t : null)),
        borderColor: src.colorT, backgroundColor: src.colorT + '22',
        borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false, spanGaps: false,
      }));

      const humDatasets = CMP_SOURCES.map((src, i) => ({
        label: src.name + ' 湿度',
        data: labels.map(k => (buckets[i][k] !== undefined ? buckets[i][k].h : null)),
        borderColor: src.colorH, backgroundColor: src.colorH + '22',
        borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false, spanGaps: false,
      }));

      if (cmpTempChart) cmpTempChart.destroy();
      cmpTempChart = new Chart(document.getElementById('cmpTempChart'), {
        type: 'line',
        data: { labels, datasets: tempDatasets },
        options: buildChartOptions(labels, '℃'),
      });

      if (cmpHumChart) cmpHumChart.destroy();
      cmpHumChart = new Chart(document.getElementById('cmpHumChart'), {
        type: 'line',
        data: { labels, datasets: humDatasets },
        options: buildChartOptions(labels, '%'),
      });

      document.getElementById('cmp-status').textContent =
        `✅ ${cfg.label} / ${labels.length} 件（最終更新: ${new Date().toLocaleString('ja-JP')}）`;
      cmpLoaded = true;
    })
    .catch(err => {
      document.getElementById('cmp-status').textContent = `❌ 読み込みエラー: ${err.message}`;
    });
}

// =====================================================
// ページタブ切替
// =====================================================
function switchPage(page) {
  ['raspi', 'switchbot', 'compare'].forEach(p => {
    document.getElementById(`page-${p}`).style.display = (p === page) ? '' : 'none';
    document.getElementById(`tab-${p}`).classList.toggle('active', p === page);
  });
  if (page === 'switchbot' && !swLoaded)  loadSwitchBotData();
  if (page === 'compare'   && !cmpLoaded) loadCmpData();
}

// =====================================================
// 初期化 + 自動更新
// =====================================================
loadData();
setInterval(loadData, 10 * 60 * 1000);

// SwitchBot タブ表示中のみ 5 分ごとに更新
setInterval(() => {
  if (document.getElementById('page-switchbot').style.display !== 'none') loadSwitchBotData();
}, 5 * 60 * 1000);

// 比較タブ表示中のみ 10 分ごとに更新
setInterval(() => {
  if (document.getElementById('page-compare').style.display !== 'none') loadCmpData();
}, 10 * 60 * 1000);
