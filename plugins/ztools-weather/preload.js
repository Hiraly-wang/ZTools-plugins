/**
 * 天气助手 · preload（ZTools / uTools 的 Node 运行环境，CommonJS）
 *
 * 职责：城市簿（多城市）、调用 Open-Meteo 免费接口拉天气/空气质量/空气质量指数、
 *       本地缓存与刷新闸门、系统能力转发。
 * 页面（index.html）没有 Node，只能通过本文件挂在 window.services 上的函数通信。
 *
 * 数据源（全部无需 API Key）：
 *   天气     https://api.open-meteo.com/v1/forecast
 *   空气质量 https://air-quality-api.open-meteo.com/v1/air-quality
 *   城市检索 https://geocoding-api.open-meteo.com/v1/search
 *   逆地编码 https://api.bigdatacloud.net/data/reverse-geocode-client
 *   IP 粗定位 https://get.geojs.io/v1/ip/geo.json
 *
 * 存储键（ztools/utools dbStorage）：
 *   wx.cities          [{id, name, admin, country, lat, lon, tz, source}]
 *   wx.current         当前城市 id
 *   wx.settings        {tempUnit, windUnit, refreshMinutes, theme, proxy}
 *   wx.cache.<id>      {fetchedAt, ...天气数据}
 *   wx.autolocated     是否已经用过 IP 粗定位
 */

// ---------- 运行时兼容：ZTools 是 window.ztools，uTools 是 window.utools ----------
function ZT() {
  if (typeof window !== 'undefined') return window.ztools || window.utools || {};
  return globalThis.ztools || globalThis.utools || {};
}
function dbGet(key) {
  try { const z = ZT(); return z.dbStorage ? z.dbStorage.getItem(key) : null; } catch (e) { return null; }
}
function dbSet(key, val) {
  try { const z = ZT(); return z.dbStorage ? z.dbStorage.setItem(key, val) : null; } catch (e) { return null; }
}
function dbDel(key) {
  try { const z = ZT(); return z.dbStorage ? z.dbStorage.removeItem(key) : null; } catch (e) { return null; }
}

const K_CITIES = 'wx.cities';
const K_CURRENT = 'wx.current';
const K_SETTINGS = 'wx.settings';
const K_AUTOLOC = 'wx.autolocated';
const kCache = (id) => 'wx.cache.' + id;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 城市拼音索引（本地模糊检索，不联网） ----------
// 数据 cities-pinyin.json 由 tools/build-pinyin.py 生成：[{n,p,i,l,a,o}]，已按名称排序。
// 为什么必须本地做：Open-Meteo 的地理检索只认原文，搜「bjd」会返回冰岛的巴卡菲厄泽
//（首字母匹配到别的词），搜「chengdu」直接无结果——拼音/首字母检索只能自己建索引。
// 缓存用 var 而不是 let：preload 会被测试脚本用 vm 跑，let 的 TDZ 在
// 跨模块引用时表现为 "is not defined"，var + 显式赋值最稳。
var PINYIN_TABLE = null;
function pinyinTable() {
  if (PINYIN_TABLE) return PINYIN_TABLE;
  try {
    // 这个文件里没有全局 fs/path 常量（preload 惯用 ztools.dbStorage，不 require fs），
    // 所以在函数内部 require —— 用顶层 const 会在声明顺序靠前时报 "fs is not defined"。
    const fsx = require('fs');
    const pathx = require('path');
    const raw = fsx.readFileSync(pathx.join(__dirname, 'cities-pinyin.json'), 'utf8');
    const list = JSON.parse(raw);
    PINYIN_TABLE = Array.isArray(list) ? list : [];
  } catch (e) { PINYIN_TABLE = []; }
  return PINYIN_TABLE;
}

/**
 * 本地城市模糊检索。支持：
 *   中文全称/子串（成都 / 哈尔）  拼音全拼（chengdu）  拼音首字母（cd / cqd）
 *   混合（chengdu 成都 / cd成）  省份过滤（四川）
 * 排序权重：完全匹配 > 前缀匹配 > 子串匹配；同级按拼音字典序。
 */
function searchCitiesLocal(keyword, { limit = 10 } = {}) {
  const q = String(keyword || '').trim().toLowerCase();
  if (!q) return [];
  const table = pinyinTable();
  if (!table.length) return [];
  const hits = [];
  for (let i = 0; i < table.length; i++) {
    const c = table[i];
    const name = c.n || '';
    const full = c.p || '';
    const init = c.i || '';
    const prov = c.l || '';
    const rank = Number(c.r) || 0;
    // 名字里可能带「市/州/区」，匹配时都试一遍
    const nameFull = name + '市';
    let score = 0;
    if (name === q || nameFull === q) score = 1000;
    else if (full === q) score = 900;                 // chengdu → 成都
    else if (name.indexOf(q) === 0) score = 800;      // 哈尔 → 哈尔滨
    else if (full.indexOf(q) === 0) score = 760;
    // ⚠ 顺序不能颠倒：init 完全相等（700）必须高于 init 前缀（720 → 改成 650）。
    // 否则搜「xa」时「兴安盟(xam)」靠前缀分压过「西安(xa)」的完全匹配。
    else if (init === q) score = 700;                 // cd → 成都/承德/常德/昌都（歧义，靠 rank 分）
    else if (name.indexOf(q) >= 0) score = 600;       // 成 → 成都
    else if (full.indexOf(q) >= 0) score = 520;
    else if (init.indexOf(q) === 0) score = 480;      // xa → 兴安盟(xam)
    else if (init.indexOf(q) >= 0 && q.length >= 2) score = 440;
    else if (prov && prov.indexOf(q) === 0) score = 300;            // 四川 → 省下所有市
    if (!score) continue;
    // 同分时用知名度（直辖市 100 > 省会 90 > 其他 ~50）决胜：
    // 「cd」命中 4 个城市，光看字母分不出是哪个，只能把大概率的那个排前面。
    hits.push({ row: c, score: score, rank: rank, idx: i });
  }
  hits.sort((a, b) => (b.score - a.score) || (b.rank - a.rank) || (a.idx - b.idx));
  return hits.slice(0, limit).map((h) => {
    const c = h.row;
    return {
      name: c.n, admin: c.l || '', country: '中国',
      lat: c.a, lon: c.o, tz: 'Asia/Shanghai',
      detail: [c.l, '拼音 ' + c.p].filter(Boolean).join(' · '),
      pinyin: c.p, initial: c.i, local: true
    };
  });
}

// ---------- 城市簿 ----------
function cities() {
  const c = dbGet(K_CITIES);
  return Array.isArray(c) ? c : [];
}
function saveCities(list) { dbSet(K_CITIES, list); return list; }
function currentId() {
  const id = dbGet(K_CURRENT);
  return cities().some((c) => c.id === id) ? id : (cities()[0] ? cities()[0].id : null);
}
function currentCity() {
  const id = currentId();
  return cities().find((c) => c.id === id) || null;
}
function newId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/** 城市名：优先 城市名，其次 省/州，最后国家 */
function cityLabel(c) {
  if (!c) return '';
  if (c.name && c.admin && c.admin !== c.name) return c.name + ' · ' + c.admin;
  return c.name || c.admin || c.country || '未知位置';
}

function normalizeCity(input) {
  const lat = Number(input && input.lat);
  const lon = Number(input && input.lon != null ? input.lon : input.longitude);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error('城市坐标无效');
  }
  return {
    id: String((input && input.id) || '') || newId(),
    name: String((input && input.name) || '').trim() || '未知城市',
    admin: String((input && input.admin) || '').trim(),
    country: String((input && input.country) || '').trim(),
    lat: lat, lon: lon,
    tz: String((input && input.tz) || '') || '',
    source: String((input && input.source) || 'search')
  };
}

function addCity(input, { select = true } = {}) {
  const list = cities();
  // 同坐标视为同一个城市（去重容差 0.05°，约 5km）
  const dup = list.find((c) => Math.abs(c.lat - Number(input.lat)) < 0.05 && Math.abs(c.lon - Number(input.lon)) < 0.05);
  if (dup) {
    if (select) dbSet(K_CURRENT, dup.id);
    return { cities: list.map(publicCity), current: currentId(), duplicated: true };
  }
  const city = normalizeCity(input);
  list.push(city);
  saveCities(list);
  if (select) dbSet(K_CURRENT, city.id);
  return { cities: list.map(publicCity), current: currentId() };
}

function removeCity(id) {
  const list = cities().filter((c) => c.id !== id);
  saveCities(list);
  dbDel(kCache(id));
  if (currentId() === id) dbSet(K_CURRENT, list[0] ? list[0].id : null);
  return { cities: list.map(publicCity), current: currentId() };
}

function updateCity(id, patch) {
  const list = cities();
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) throw new Error('城市不存在');
  const p = {};
  if (patch && patch.name != null) p.name = String(patch.name).trim() || list[i].name;
  list[i] = Object.assign({}, list[i], p);
  saveCities(list);
  return { cities: list.map(publicCity), current: currentId() };
}

function setCurrent(id) {
  if (!cities().some((c) => c.id === id)) throw new Error('城市不存在');
  dbSet(K_CURRENT, id);
  return { cities: cities().map(publicCity), current: id };
}

function publicCity(c) {
  return {
    id: c.id, name: c.name, admin: c.admin || '', country: c.country || '',
    lat: c.lat, lon: c.lon, label: cityLabel(c), source: c.source || 'search'
  };
}

// ---------- 设置 ----------
const DEFAULT_SETTINGS = { tempUnit: 'C', windUnit: 'kmh', refreshMinutes: 5, theme: 'auto', proxy: 'auto' };
function settings() {
  const s = dbGet(K_SETTINGS);
  const out = Object.assign({}, DEFAULT_SETTINGS);
  if (s && typeof s === 'object' && !Array.isArray(s)) {
    if (s.tempUnit === 'C' || s.tempUnit === 'F') out.tempUnit = s.tempUnit;
    if (['kmh', 'ms', 'mph'].indexOf(s.windUnit) >= 0) out.windUnit = s.windUnit;
    const m = Number(s.refreshMinutes);
    out.refreshMinutes = isFinite(m) ? Math.max(0, Math.min(120, Math.round(m))) : DEFAULT_SETTINGS.refreshMinutes;
    if (['auto', 'light', 'dark'].indexOf(s.theme) >= 0) out.theme = s.theme;
    if (typeof s.proxy === 'string') out.proxy = s.proxy.slice(0, 200);
  }
  return out;
}
function patchSettings(patch) {
  // 逐项校验后再落库：非法值直接忽略，避免把 'X' 这种脏值写进 dbStorage
  const cur = settings();
  const p = patch || {};
  const next = Object.assign({}, cur);
  if (p.tempUnit === 'C' || p.tempUnit === 'F') next.tempUnit = p.tempUnit;
  if (['kmh', 'ms', 'mph'].indexOf(p.windUnit) >= 0) next.windUnit = p.windUnit;
  if (p.refreshMinutes != null) {
    const m = Number(p.refreshMinutes);
    if (isFinite(m)) next.refreshMinutes = Math.max(0, Math.min(120, Math.round(m)));
  }
  if (['auto', 'light', 'dark'].indexOf(p.theme) >= 0) next.theme = p.theme;
  if (p.proxy != null) next.proxy = String(p.proxy).slice(0, 200);
  dbSet(K_SETTINGS, next);
  return settings();
}

// ---------- 天气代码（WMO）→ 文案 + 图标 + 颜色组 ----------
const WMO = {
  0: { t: '晴', day: '☀️', night: '🌙', g: 'clear' },
  1: { t: '晴间多云', day: '🌤️', night: '🌙', g: 'clear' },
  2: { t: '多云', day: '⛅', night: '☁️', g: 'cloud' },
  3: { t: '阴', day: '☁️', night: '☁️', g: 'cloud' },
  45: { t: '有雾', day: '🌫️', night: '🌫️', g: 'fog' },
  48: { t: '冻雾', day: '🌫️', night: '🌫️', g: 'fog' },
  51: { t: '毛毛雨', day: '🌦️', night: '🌧️', g: 'rain' },
  53: { t: '小雨', day: '🌦️', night: '🌧️', g: 'rain' },
  55: { t: '中雨', day: '🌧️', night: '🌧️', g: 'rain' },
  56: { t: '冻毛毛雨', day: '🌧️', night: '🌧️', g: 'rain' },
  57: { t: '冻雨', day: '🌧️', night: '🌧️', g: 'rain' },
  61: { t: '小雨', day: '🌦️', night: '🌧️', g: 'rain' },
  63: { t: '中雨', day: '🌧️', night: '🌧️', g: 'rain' },
  65: { t: '大雨', day: '🌧️', night: '🌧️', g: 'rain' },
  66: { t: '冻雨', day: '🌧️', night: '🌧️', g: 'rain' },
  67: { t: '强冻雨', day: '🌧️', night: '🌧️', g: 'rain' },
  71: { t: '小雪', day: '🌨️', night: '🌨️', g: 'snow' },
  73: { t: '中雪', day: '🌨️', night: '🌨️', g: 'snow' },
  75: { t: '大雪', day: '❄️', night: '❄️', g: 'snow' },
  77: { t: '雪粒', day: '🌨️', night: '🌨️', g: 'snow' },
  80: { t: '阵雨', day: '🌦️', night: '🌧️', g: 'rain' },
  81: { t: '强阵雨', day: '🌧️', night: '🌧️', g: 'rain' },
  82: { t: '暴雨', day: '⛈️', night: '⛈️', g: 'storm' },
  85: { t: '阵雪', day: '🌨️', night: '🌨️', g: 'snow' },
  86: { t: '强阵雪', day: '❄️', night: '❄️', g: 'snow' },
  95: { t: '雷阵雨', day: '⛈️', night: '⛈️', g: 'storm' },
  96: { t: '雷阵雨伴冰雹', day: '⛈️', night: '⛈️', g: 'storm' },
  99: { t: '强雷暴冰雹', day: '⛈️', night: '⛈️', g: 'storm' }
};
function wmo(code, isDay) {
  const has = code !== null && code !== undefined && code !== '' && isFinite(Number(code));
  const c = Number(code);
  const m = has ? (WMO[c] || { t: '未知', day: '🌡️', night: '🌡️', g: 'cloud' })
    : { t: '未知', day: '🌡️', night: '🌡️', g: 'cloud' };
  return { code: has ? c : null, text: m.t, icon: isDay ? m.day : m.night, group: m.g };
}

// ---------- 中国空气质量指数（HJ 633-2012 六级分段） ----------
const AQI_LEVELS = [
  { max: 50, label: '优', color: 'good' },
  { max: 100, label: '良', color: 'fair' },
  { max: 150, label: '轻度污染', color: 'warn' },
  { max: 200, label: '中度污染', color: 'warn' },
  { max: 300, label: '重度污染', color: 'bad' },
  { max: Infinity, label: '严重污染', color: 'bad' }
];
// 污染物 24 小时平均浓度上限 → 指数上限（pm/o3/so2/no2 用 μg/m³，CO 单独用 mg/m³）
const AQI_BREAK = {
  so2: [[50, 50], [150, 100], [475, 200], [800, 300], [1600, 400], [Infinity, 500]],
  no2: [[40, 50], [80, 100], [180, 200], [280, 300], [565, 400], [Infinity, 500]],
  pm10: [[50, 50], [150, 100], [250, 200], [350, 300], [420, 400], [Infinity, 500]],
  pm2_5: [[35, 50], [75, 100], [115, 150], [150, 200], [250, 300], [350, 400], [Infinity, 500]],
  o3: [[160, 50], [200, 100], [300, 150], [400, 200], [800, 300], [1000, 400], [Infinity, 500]],
  co: [[5, 50], [10, 100], [35, 200], [60, 300], [90, 400], [Infinity, 500]]
};
const AQI_NAME = { so2: 'SO₂', no2: 'NO₂', pm10: 'PM10', pm2_5: 'PM2.5', o3: 'O₃', co: 'CO' };
// 展示单位：CO 换算成 mg/m³，其余保持 μg/m³
const AQI_UNIT = { so2: 'μg/m³', no2: 'μg/m³', pm10: 'μg/m³', pm2_5: 'μg/m³', o3: 'μg/m³', co: 'mg/m³' };
// 换算到分段表所需单位：Open-Meteo 全部返回 μg/m³，CO 的国标分段用 mg/m³
function toBreakUnit(key, conc) { return key === 'co' ? conc / 1000 : conc; }
function toShowUnit(key, conc) { return key === 'co' ? conc / 1000 : conc; }

/** 单污染物指数：在所属分段内线性插值（浓度→指数）；超出上限段直接取该段指数上限 */
function subIndex(conc, breaks) {
  if (!isFinite(conc) || conc < 0) return null;
  let i = 0;
  while (i < breaks.length && !(conc <= breaks[i][0] || breaks[i][0] === Infinity)) i++;
  if (i >= breaks.length) i = breaks.length - 1;
  const upHi = breaks[i][1];
  const upLo = i === 0 ? 0 : breaks[i - 1][1];
  const conLo = i === 0 ? 0 : breaks[i - 1][0];
  const conHi = breaks[i][0];
  if (!isFinite(conHi)) return Math.round(upHi);
  const v = upLo + (conc - conLo) / (conHi - conLo) * (upHi - upLo);
  return Math.max(0, Math.min(500, v));
}
function aqiLevel(v) {
  const n = isFinite(v) ? v : 0;
  return AQI_LEVELS.find((l) => n <= l.max) || AQI_LEVELS[AQI_LEVELS.length - 1];
}
function computeAqi(conc) {
  let best = 0, primary = null;
  const parts = [];
  Object.keys(AQI_BREAK).forEach((k) => {
    const raw = Number(conc[k]);
    if (!isFinite(raw) || raw < 0) return;
    const v = subIndex(toBreakUnit(k, raw), AQI_BREAK[k]);
    if (v == null) return;
    const shown = toShowUnit(k, raw);
    parts.push({
      key: k, name: AQI_NAME[k], value: Math.round(v),
      conc: Math.round(shown * 10) / 10, unit: AQI_UNIT[k]
    });
    if (v > best) { best = v; primary = k; }
  });
  if (primary == null) return null;
  const rounded = Math.round(best);
  const lv = aqiLevel(rounded);
  return {
    value: rounded, level: lv.label, color: lv.color, primary: AQI_NAME[primary],
    primaryKey: primary, parts: parts
  };
}

// ---------- HTTP：直连优先，失败再走代理 ----------
const net = require('net');
const tls = require('tls');

function proxyCandidates(setting) {
  const s = (setting == null ? settings().proxy : String(setting || '')).trim();
  if (s === '' || s === 'off') return [];
  if (s !== 'auto') return [s];
  // auto：探测常见本地代理端口（Clash Verge 默认 7897，Clash 默认 7890，
  // v2rayN 10809，Shadowsocks 1080；7891 是本机实际在用的那个）。
  // 顺序按「本机实测开着优先」——7891 排最前，否则 4 次 ECONNREFUSED 会白等一轮超时。
  return ['http://127.0.0.1:7891', 'http://127.0.0.1:7897', 'http://127.0.0.1:7890',
          'http://127.0.0.1:10809', 'http://127.0.0.1:1080'];
}

/** 经 HTTP 代理发 GET：CONNECT 隧道 + 手动 TLS，手写解析（只处理本插件用到的响应形态） */
function getViaProxy(url, proxy, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u, ph, pp;
    try {
      u = new URL(url);
      const p = new URL(proxy.indexOf('://') >= 0 ? proxy : 'http://' + proxy);
      ph = p.hostname; pp = Number(p.port) || 80;
    } catch (e) { return reject(new Error('代理地址无效：' + proxy)); }

    const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
    const head = 'GET ' + (u.pathname + u.search) + ' HTTP/1.1\r\n' +
      'Host: ' + u.host + '\r\n' +
      'User-Agent: ztools-weather\r\n' +
      'Accept: application/json\r\n' +
      'Accept-Encoding: identity\r\n' +
      'Connection: close\r\n\r\n';

    let done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch (e) {} err ? reject(err) : resolve(val); };
    const sock = net.connect(pp, ph);
    const timer = setTimeout(() => finish(new Error('经 ' + proxy + ' 请求超时')), timeoutMs || 20000);
    sock.on('error', (e) => finish(new Error('经 ' + proxy + ' 连接失败：' + (e.code || e.message))));

    let handshake = Buffer.alloc(0);
    let sec = null;

    const onTunnel = (chunk) => {
      handshake = Buffer.concat([handshake, chunk]);
      const i = handshake.indexOf('\r\n\r\n');
      if (i < 0) return;
      const statusLine = handshake.slice(0, handshake.indexOf('\r\n')).toString('latin1');
      if (!/ 200 /.test(statusLine)) { return finish(new Error('代理拒绝 CONNECT：' + statusLine)); }
      const rest = handshake.slice(i + 4);
      sec = u.protocol === 'https:'
        ? tls.connect({ socket: sock, servername: u.hostname, rejectUnauthorized: false })
        : sock;
      sec.setTimeout(timeoutMs || 20000, () => finish(new Error('经 ' + proxy + ' 读取超时')));
      sec.on('error', (e) => finish(new Error('TLS 握手失败：' + (e.code || e.message))));
      sec.on('data', (d) => { sec.removeListener('data', onTunnel); acc.push(d); maybeDone(); });
      sec.write(head);
      if (rest.length) acc.push(rest);
    };

    const acc = [];
    let parsed = false;
    const maybeDone = () => {
      if (parsed) return;
      const buf = Buffer.concat(acc);
      const i = buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      const headTxt = buf.slice(0, i).toString('latin1');
      const m = /HTTP\/1\.[01] (\d{3})/.exec(headTxt);
      const status = m ? Number(m[1]) : 0;
      let body = buf.slice(i + 4);
      if (/transfer-encoding:\s*chunked/i.test(headTxt)) body = dechunk(body);
      if (!/\r\n0\r\n?$/.test(String.fromCharCode.apply(null, buf.slice(-8))) && body.length === 0 && sec.destroyed !== true) return;
      parsed = true;
      resolve({ status: status, body: body.toString('utf8') });
      clearTimeout(timer);
      try { sec.destroy(); } catch (e) {}
    };

    if (u.protocol === 'https:') {
      sock.on('data', (chunk) => { if (!sec) onTunnel(chunk); });
      sock.on('connect', () => sock.write('CONNECT ' + u.hostname + ':' + port + ' HTTP/1.1\r\nHost: ' + u.host + ':' + port + '\r\n\r\n'));
    } else {
      sock.on('connect', () => { acc = []; sock.write(head); });
      sock.on('data', (d) => { acc.push(d); maybeDone(); });
    }
  });
}

function dechunk(buf) {
  let out = Buffer.alloc(0), pos = 0;
  for (;;) {
    const nl = buf.indexOf('\r\n', pos);
    if (nl < 0) break;
    const size = parseInt(buf.slice(pos, nl).toString('latin1').split(';')[0], 16);
    if (!isFinite(size)) break;
    if (size === 0) break;
    const start = nl + 2;
    out = Buffer.concat([out, buf.slice(start, start + size)]);
    pos = start + size + 2;
  }
  return out;
}

async function httpGet(url, { timeout = 20000, retries = 2 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const errors = [];
  try {
    let res = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
        break;
      } catch (e) {
        const cause = e && e.cause ? ' · ' + (e.cause.code || e.cause.message || e.cause) : '';
        errors.push((e && e.message ? e.message : String(e)) + cause);
        if (ctl.signal.aborted) break;
        await sleep(800 * (attempt + 1));
      }
    }
    if (res) {
      if (!res.ok) return { status: res.status, body: '' };
      return { status: res.status, body: await res.text() };
    }
  } finally {
    clearTimeout(timer);
  }
  // 直连失败 → 依次尝试本地代理
  for (const proxy of proxyCandidates(null)) {
    try {
      return await getViaProxy(url, proxy, timeout);
    } catch (e) { errors.push(e.message); }
  }
  throw new Error('网络请求失败（直连与本地代理都试过）：' + errors.slice(-2).join(' | '));
}

async function getJson(url, opts) {
  const r = await httpGet(url, opts);
  if (r.status === 429) throw new Error('接口限流（429），请稍后再试');
  if (r.status !== 200 || !r.body) throw new Error('接口返回 HTTP ' + (r.status || '无响应'));
  try { return JSON.parse(r.body); } catch (e) { throw new Error('接口返回的不是合法 JSON'); }
}

// ---------- 接口调用 ----------
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const IPGEO = 'https://get.geojs.io/v1/ip/geo.json';

function q(obj) {
  return Object.keys(obj)
    .filter((k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== '')
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]))
    .join('&');
}

/**
 * 统一城市检索：本地拼音索引优先（瞬时、覆盖国内 338 城），再补 Open-Meteo 远端（覆盖国外/小城）。
 * 远端失败不影响本地结果——拼音检索是主路径，不能被网络拖垮。
 */
async function searchCities(name, { limit = 10 } = {}) {
  const key = String(name || '').trim();
  if (!key) return [];
  const local = searchCitiesLocal(key, { limit: limit });
  let remote = [];
  try {
    const data = await getJson(GEOCODE + '?' + q({
      name: key, count: Math.min(20, Math.max(1, limit * 2)), language: 'zh', format: 'json'
    }));
    const list = Array.isArray(data.results) ? data.results : [];
    list.sort((a, b) => {
      const ea = a.name === key ? 0 : 1, eb = b.name === key ? 0 : 1;
      if (ea !== eb) return ea - eb;
      return (b.population || 0) - (a.population || 0);
    });
    remote = list.slice(0, limit).map((r) => ({
      name: r.name, admin: r.admin1 || '', country: r.country || '',
      lat: r.latitude, lon: r.longitude, tz: r.timezone || '',
      detail: [r.admin1, r.admin2].filter(Boolean).join(' · ') || r.country || '',
      local: false
    }));
  } catch (e) { remote = []; }

  // 合并：本地索引优先（它是中国地级市，权威且带拼音），远端只补本地没有的。
  // 两层去重，各有各的必要性：
  //  ① 按名字+省：同名同省的重复
  //  ② 按坐标（容差 0.05°）：同一地点的不同写法
  //  ③ 按名字 + 行政级别：Open-Meteo 里「南阳」有两个——河南地级市，和甘肃陇南市辖下的
  //     同名村庄。两者坐标差 8 度，②抓不到；但用户搜「南阳」想要的一定是河南那个。
  //     本地索引只收地级市，所以「本地已有同名 → 远端同名一律丢弃」。
  const merged = [];
  const seenName = {};
  const localNames = {};
  local.forEach((r) => { localNames[r.name] = true; });
  const seenCoord = [];
  function coordTaken(la, lo) {
    for (let i = 0; i < seenCoord.length; i++) {
      if (Math.abs(seenCoord[i][0] - la) < 0.05 && Math.abs(seenCoord[i][1] - lo) < 0.05) return true;
    }
    return false;
  }
  local.concat(remote).forEach(function (r) {
    if (!r.local && localNames[r.name]) return;      // ③
    const k = r.name + '|' + (r.admin || '');
    if (seenName[k]) return;                          // ①
    if (coordTaken(r.lat, r.lon)) return;             // ②
    seenName[k] = 1;
    seenCoord.push([r.lat, r.lon]);
    merged.push(r);
  });
  return merged.slice(0, Math.max(limit, local.length));
}

async function reverseGeocode(lat, lon) {
  const d = await getJson(REVERSE + '?' + q({ latitude: lat, longitude: lon, localityLanguage: 'zh' }));
  const name = d.city || d.locality || d.principalSubdivision || '';
  if (!name) throw new Error('这个坐标附近没有可识别的城市名');
  return {
    name: name, admin: d.principalSubdivision || '', country: d.countryName || '',
    lat: Number(d.latitude), lon: Number(d.longitude)
  };
}

/** IP 粗定位：只能给一个大致城市，用户确认后才加入 */
async function guessCity() {
  if (dbGet(K_AUTOLOC)) return null;
  try {
    const g = await getJson(IPGEO, { timeout: 8000, retries: 0 });
    const lat = Number(g.latitude), lon = Number(g.longitude);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    let base = { name: g.city || g.region || '当前位置', admin: g.region || '', country: g.country || '', lat: lat, lon: lon, tz: g.timezone || '' };
    try {
      const rev = await reverseGeocode(lat, lon);
      if (rev.name) base = Object.assign(base, rev);
    } catch (e) { /* 逆地编码失败就用 IP 给的名字 */ }
    dbSet(K_AUTOLOC, Date.now());
    return base;
  } catch (e) { return null; }
}

function shapeWeather(w) {
  const cur = w.current || {};
  const isDay = cur.is_day === undefined ? true : !!cur.is_day;
  const hourly = w.hourly || {};
  const ht = hourly.time || [];
  const daily = w.daily || {};
  const dt = daily.time || [];

  const hours = [];
  for (let i = 0; i < ht.length; i++) {
    hours.push({
      time: ht[i],                                  // 城市本地时间，直接切片显示，不要再按时区换算
      hour: Number(ht[i].slice(11, 13)),
      temp: hourly.temperature_2m ? hourly.temperature_2m[i] : null,
      feels: hourly.apparent_temperature ? hourly.apparent_temperature[i] : null,
      pop: hourly.precipitation_probability ? hourly.precipitation_probability[i] : null,
      code: hourly.weather_code ? hourly.weather_code[i] : null,
      isDay: hourly.is_day ? !!hourly.is_day[i] : true,
      hum: hourly.relative_humidity_2m ? hourly.relative_humidity_2m[i] : null
    });
  }
  // 从「当前所在整点」开始取未来 24 小时。
  // 坑：按 hour 字段找会命中当天 00:00，导致从凌晨开始画而不是从现在。
  // 正确做法是按完整的本地时间串比较：找最后一个 time <= current.time 的下标。
  const nowTime = cur.time || '';
  let startIdx = 0;
  for (let i = 0; i < ht.length; i++) {
    if (ht[i] <= nowTime) startIdx = i; else break;
  }
  // 若接口只给了未来数据（没有覆盖当前整点），退回第一个点
  if (ht.length && ht[0] > nowTime) startIdx = 0;
  const next24 = hours.slice(startIdx, startIdx + 24);

  const days = [];
  for (let i = 0; i < dt.length; i++) {
    days.push({
      date: dt[i],
      code: daily.weather_code ? daily.weather_code[i] : null,
      max: daily.temperature_2m_max ? daily.temperature_2m_max[i] : null,
      min: daily.temperature_2m_min ? daily.temperature_2m_min[i] : null,
      feelsMax: daily.apparent_temperature_max ? daily.apparent_temperature_max[i] : null,
      feelsMin: daily.apparent_temperature_min ? daily.apparent_temperature_min[i] : null,
      rain: daily.precipitation_sum ? daily.precipitation_sum[i] : null,
      pop: daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : null,
      wind: daily.wind_speed_10m_max ? daily.wind_speed_10m_max[i] : null,
      windDir: daily.wind_direction_10m_dominant ? daily.wind_direction_10m_dominant[i] : null,
      uv: daily.uv_index_max ? daily.uv_index_max[i] : null,
      sunrise: daily.sunrise ? daily.sunrise[i] : '',
      sunset: daily.sunset ? daily.sunset[i] : ''
    });
  }

  return {
    city: null,
    current: {
      time: cur.time || '', isDay: isDay,
      temp: cur.temperature_2m, feels: cur.apparent_temperature, hum: cur.relative_humidity_2m,
      code: cur.weather_code, precip: cur.precipitation, cloud: cur.cloud_cover,
      wind: cur.wind_speed_10m, windDir: cur.wind_direction_10m, gust: cur.wind_gusts_10m,
      pressure: cur.surface_pressure
    },
    today: days[0] || null,
    hours: next24,
    days: days,
    timezone: w.timezone || '', utcOffset: Number(w.utc_offset_seconds) || 0, elevation: w.elevation
  };
}

function shapeAir(a) {
  const hourly = a.hourly || {};
  const ht = hourly.time || [];
  const cur = a.current || {};
  const nowTime = cur.time || (ht.length ? ht[ht.length - 1] : '');
  // 中国 AQI 用「最近 24 小时各污染物浓度均值」：取不晚于当前小时的 24 个点。
  // 坑：接口 hourly 从 00:00 起，只有 1 天；直接全部平均等于当日累计，不是滚动 24h。
  // 统一做法与天气一致：按本地时间串找最后一个 <= nowTime 的下标。
  let idx = 0;
  for (let i = 0; i < ht.length; i++) {
    if (ht[i] <= nowTime) idx = i; else break;
  }
  if (ht.length && ht[0] > nowTime) idx = 0;
  const from = Math.max(0, idx - 23);
  const avg = {};
  // 内部键用缩写，字段名用接口返回的全称
  const POLLUTANTS = [
    ['pm2_5', 'pm2_5'], ['pm10', 'pm10'],
    ['so2', 'sulphur_dioxide'], ['no2', 'nitrogen_dioxide'],
    ['co', 'carbon_monoxide'], ['o3', 'ozone']
  ];
  POLLUTANTS.forEach(function (pair) {
    const arr = hourly[pair[1]];
    if (!Array.isArray(arr)) return;
    let sum = 0, n = 0;
    for (let i = from; i <= idx; i++) { const v = Number(arr[i]); if (isFinite(v)) { sum += v; n++; } }
    if (n) avg[pair[0]] = sum / n;
  });
  return {
    now: {
      time: nowTime,
      pm2_5: cur.pm2_5, pm10: cur.pm10,
      usAqi: cur.us_aqi, euAqi: cur.european_aqi
    },
    avg24: avg,
    aqi: computeAqi(avg)
  };
}

async function loadCity(city, { force = false, minAgeMs = 5 * 60 * 1000 } = {}) {
  if (!city) throw new Error('没有可用城市');
  const key = kCache(city.id);
  const cached = dbGet(key);
  if (!force && cached && Date.now() - (cached.fetchedAt || 0) < minAgeMs) {
    return Object.assign({}, cached, { stale: true, city: publicCity(city) });
  }
  const coords = q({
    latitude: city.lat, longitude: city.lon,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability,weather_code,is_day,relative_humidity_2m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant,uv_index_max,sunrise,sunset',
    timezone: 'auto', forecast_days: '7'
  });
  const airParams = q({
    latitude: city.lat, longitude: city.lon,
    current: 'pm10,pm2_5,us_aqi,european_aqi',
    // 坑：接口认全称 sulphur_dioxide / nitrogen_dioxide / carbon_monoxide / ozone，
    // 写 so2/no2/co 会整体 400（报 SurfacePressureAndHeightVariable 之类看不懂的错）。
    hourly: 'pm10,pm2_5,sulphur_dioxide,nitrogen_dioxide,carbon_monoxide,ozone',
    timezone: 'auto', forecast_days: '1'
  });

  const [weather, air] = await Promise.all([
    getJson(FORECAST + '?' + coords),
    getJson(AIR + '?' + airParams).catch(() => null)   // 空气质量失败不影响主界面
  ]);

  const shaped = shapeWeather(weather);
  shaped.city = publicCity(city);
  shaped.air = air ? shapeAir(air) : null;
  shaped.fetchedAt = Date.now();
  shaped.stale = false;
  dbSet(key, shaped);
  return shaped;
}

// ---------- 系统能力转发 ----------
function openExternal(url) {
  const z = ZT();
  if (z.shellOpenExternal) return z.shellOpenExternal(url);
  if (z.openExternal) return z.openExternal(url);
  if (z.shellOpenPath) return z.shellOpenPath(url);
  return null;
}
function copy(text) {
  const z = ZT();
  if (z.copyText) return z.copyText(String(text || ''));
  return null;
}
function notify(body) {
  const z = ZT();
  if (z.showNotification) return z.showNotification(String(body || ''));
  if (z.showToast) return z.showToast(String(body || ''));
  return null;
}
/** 主题：宿主权威接口优先，取不到再按系统偏好兜底 */
function theme() {
  const z = ZT();
  try {
    if (typeof z.isDarkColors === 'function') return { isDark: !!z.isDarkColors(), source: 'ztools' };
  } catch (e) { /* 落到下面 */ }
  try {
    if (typeof z.getThemeInfo === 'function') {
      const t = z.getThemeInfo();
      if (t && typeof t.isDark === 'boolean') return { isDark: t.isDark, source: 'themeInfo' };
    }
  } catch (e) { /* ignore */ }
  return { isDark: false, source: 'default' };
}
function onThemeChange(cb) {
  const z = ZT();
  if (typeof z.onThemeChange === 'function') { try { z.onThemeChange(cb); return true; } catch (e) { return false; } }
  return false;
}

function buildShareText(data) {
  if (!data || !data.current) return '';
  const c = data.city || {};
  const w = wmo(data.current.code, data.current.isDay);
  const t = data.today;
  const parts = [
    (c.label || '当前位置') + ' ' + w.icon + ' ' + w.text,
    '现在 ' + (data.current.temp != null ? Math.round(data.current.temp) + '°' : '--') +
      '（体感 ' + (data.current.feels != null ? Math.round(data.current.feels) + '°' : '--') + '）'
  ];
  if (t) parts.push('今日 ' + Math.round(t.min) + '° ~ ' + Math.round(t.max) + '°' + (t.pop ? ' · 降水概率 ' + t.pop + '%' : ''));
  if (data.air && data.air.aqi) parts.push('空气 ' + data.air.aqi.value + ' ' + data.air.aqi.level + '（' + data.air.aqi.primary + '）');
  if (t && t.sunrise) parts.push('日出 ' + t.sunrise.slice(11) + ' · 日落 ' + String(t.sunset || '').slice(11));
  return parts.join('\n');
}

// ---------- 暴露给页面 ----------
const services = {
  // 城市簿
  listCities: () => ({ cities: cities().map(publicCity), current: currentId() }),
  addCity: addCity,
  removeCity: removeCity,
  updateCity: updateCity,
  setCurrent: setCurrent,
  searchCities: searchCities,
  searchCitiesLocal: searchCitiesLocal,
  reverseGeocode: reverseGeocode,
  guessCity: guessCity,
  // 数据
  loadCity: loadCity,
  getCache: (id) => {
    const cid = id || currentId();
    if (!cid) return null;
    const c = dbGet(kCache(cid));
    if (!c) return null;
    const city = cities().find((x) => x.id === cid);
    return Object.assign({}, c, { stale: true, city: city ? publicCity(city) : null });
  },
  // 设置 / 其它
  getSettings: settings,
  patchSettings: patchSettings,
  theme: theme,
  onThemeChange: onThemeChange,
  wmo: wmo,
  aqiLevel: aqiLevel,
  buildShareText: buildShareText,
  openExternal: openExternal,
  copy: copy,
  notify: notify
};

if (typeof window !== 'undefined') {
  // ZTools 插件视图 contextIsolation=false，preload 与页面同 realm，直接挂 window 最稳；
  // 同时尝试 contextBridge，双保险。
  var exposedBridge = false;
  try {
    var bridge = window.contextBridge;
    if (bridge && typeof bridge.exposeInMainWorld === 'function') {
      bridge.exposeInMainWorld('services', services);
      exposedBridge = true;
    }
  } catch (e) { /* 走下方兜底 */ }
  if (!exposedBridge) {
    try { window.services = services; } catch (e) { /* 不可写则放弃 */ }
  }
  // ⚠⚠ 绝对不要在这里写 mode: 'none'。
  // 宿主 preload 有这么一段：收到 'get-plugin-mode' 就读
  //   window.exports[featureCode].mode
  // 直接拿它当插件形态，'none' = 无界面插件 → setExpendHeight(0) → 界面高度为 0，表现为「打不开」。
  // 日志里长这样：
  //   [Plugin] 设置插件高度: 0
  //   [Plugin] 调用无界面插件方法: { featureCode: 'weather' }
  //   stage: 'process-mode-headless'
  // 想要有界面，正确写法是 mode: 'web'（或干脆不给 mode，宿主按 plugin.json 的 main 判定）。
  // uTools 兼容只需要 exports 对象存在，不需要 mode 字段。
  try {
    window.exports = {
      'weather': { mode: 'web', args: { enter() {}, leave() {} } },
      'weather-push': { mode: 'web', args: { enter() {}, leave() {} } }
    };
  } catch (e) { /* ignore */ }
}

module.exports = services;
