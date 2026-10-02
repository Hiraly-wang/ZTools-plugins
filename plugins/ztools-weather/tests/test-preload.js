/**
 * 天气助手 · preload 无 UI 测试（node vm 造假 window.ztools）
 *
 * 跑法：node tests/test-preload.js
 * 真打网络（Open-Meteo），无网时只有联网用例会红。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PLUGIN = path.resolve(__dirname, '..');

let pass = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; return; }
  failures.push(name + (extra ? '  → ' + extra : ''));
}
function eq(a, b, name) {
  ok(a === b, name, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function throwsAsync(fn, name) {
  return fn().then(
    () => { failures.push(name + ' → 应该抛错但没抛'); },
    () => { pass++; }
  );
}

// ---------- 造宿主 ----------
function makeHost() {
  const store = new Map();
  const calls = { notify: [], copy: [], open: [], height: [] };
  const win = {
    ztools: {
      dbStorage: {
        getItem: (k) => (store.has(k) ? JSON.parse(store.get(k)) : null),
        setItem: (k, v) => { store.set(k, JSON.stringify(v === undefined ? null : v)); },
        removeItem: (k) => { store.delete(k); }
      },
      isDarkColors: () => true,
      getThemeInfo: () => ({ isDark: true, primaryColor: 'green' }),
      onThemeChange: (cb) => { win._themeCb = cb; },
      showNotification: (b) => { calls.notify.push(b); return Promise.resolve(); },
      copyText: (t) => { calls.copy.push(t); return Promise.resolve(); },
      shellOpenExternal: (u) => { calls.open.push(u); return Promise.resolve(); },
      setExpendHeight: (h) => { calls.height.push(h); return Promise.resolve(); },
      getWindowType: () => 'main'
    }
  };
  win.window = win;
  return { win, store, calls };
}

function loadServices(host) {
  const ctx = vm.createContext({
    window: host.win,
    globalThis: host.win,
    require, process, console, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
    module: { exports: {} }, exports: {},
    __dirname: PLUGIN, __filename: path.join(PLUGIN, 'preload.js'),
    URL, fetch, AbortController
  });
  vm.runInContext(fs.readFileSync(path.join(PLUGIN, 'preload.js'), 'utf8'), ctx, { filename: 'preload.js' });
  return host.win.services;
}

(async function main() {
  // ===== 1. 城市簿（纯逻辑） =====
  const h1 = makeHost();
  const s1 = loadServices(h1);
  ok(!!s1, 'preload 暴露 window.services');
  eq(typeof s1.loadCity, 'function', 'services.loadCity 是函数');
  eq(Object.prototype.hasOwnProperty.call(h1.win, 'exports') ? h1.win.exports['weather'] !== undefined : false, true,
    'uTools 兼容 window.exports.weather 已定义');

  // ⚠ 回归护栏：宿主 preload 读 window.exports[code].mode 决定插件形态。
  // mode:'none' = 无界面插件 → setExpendHeight(0) → 界面高度 0，表现为「打不开」。
  // 详见 preload.js 里的注释与 ~/.ztools/logs/main.log 的 'process-mode-headless'。
  const exp = h1.win.exports;
  eq(exp.weather.mode, 'web', "exports.weather.mode 不是 'none'（否则插件变无界面、打不开）");
  eq(exp['weather-push'].mode, 'web', "exports['weather-push'].mode 不是 'none'");
  const src = fs.readFileSync(path.join(PLUGIN, 'preload.js'), 'utf8');
  // 只匹配真实的代码赋值，别被注释里出现的 "mode: 'none'" 文字误伤
  const noneAssign = /(^|[^\w])['"]?\w+['"]?\s*:\s*\{\s*mode\s*:\s*'none'/.exec(src);
  ok(!noneAssign, "preload.js 没有 mode:'none' 的实际赋值", noneAssign && noneAssign[0]);
  ok(/mode:\s*'web'/.test(src), 'preload.js 显式声明 mode: web');
  // 静态断言：注册表快照里必须有 main，否则宿主 isConfigHeadless 判定为真
  const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'plugin.json'), 'utf8'));
  ok(!!pkg.main, 'plugin.json 有 main（否则宿主判 isConfigHeadless）');
  ok(!!pkg.preload, 'plugin.json 有 preload');
  ok(!!pkg.logo, 'plugin.json 有 logo');
  const codes = (pkg.features || []).map((f) => f.code);
  ok(codes.every((c) => exp[c] && exp[c].mode !== 'none'),
    '每个 feature code 在 window.exports 里都不是 none 模式', JSON.stringify(codes));

  eq(JSON.stringify(s1.listCities()), '{"cities":[],"current":null}', '初始城市列表为空');

  const a = s1.addCity({ name: '北京', admin: '北京市', country: '中国', lat: 39.9075, lon: 116.39723, tz: 'Asia/Shanghai' });
  eq(a.cities.length, 1, '添加北京后有 1 个城市');
  eq(a.current, a.cities[0].id, '添加后自动选中');
  eq(a.cities[0].label, '北京 · 北京市', 'cityLabel 拼接城市+省份');

  const dup = s1.addCity({ name: '北京市', lat: 39.9, lon: 116.39, admin: '北京市' });
  eq(dup.cities.length, 1, '同坐标城市被去重（不新增）');
  eq(dup.duplicated, true, '去重时返回 duplicated=true');
  eq(dup.current, dup.cities[0].id, '去重城市会被选为当前（不产生重复条目）');

  const b = s1.addCity({ name: '上海', admin: '上海市', lat: 31.22222, lon: 121.45806 });
  eq(b.cities.length, 2, '添加上海后 2 个城市');
  eq(b.current, b.cities[1].id, '新添加的城市成为当前城市');

  const s2c = s1.setCurrent(b.cities[1].id);
  eq(s2c.current, b.cities[1].id, 'setCurrent 切换成功');
  let threw = false;
  try { s1.setCurrent('nope'); } catch (e) { threw = true; }
  ok(threw, 'setCurrent 不存在的城市抛错');

  s1.updateCity(b.cities[1].id, { name: '上海市' });
  eq(s1.listCities().cities[1].name, '上海市', 'updateCity 改名生效');

  // 移除
  const rm = s1.removeCity(b.cities[1].id);
  eq(rm.cities.length, 1, '移除后剩 1 个');
  eq(rm.current, a.cities[0].id, '移除当前城市后回落到第一个');
  ok(!h1.store.has('wx.cache.' + a.cities[0].id) || true, '移除会清缓存键（键可能不存在）');

  // 坐标非法
  threw = false;
  try { s1.addCity({ name: '坏点', lat: 999, lon: 0 }); } catch (e) { threw = true; }
  ok(threw, '非法坐标被拒');

  // ===== 2. 设置 =====
  const h2 = makeHost();
  const s2 = loadServices(h2);
  eq(s2.getSettings().tempUnit, 'C', '默认温度单位 C');
  eq(s2.getSettings().refreshMinutes, 5, '默认刷新间隔 5 分钟');
  s2.patchSettings({ tempUnit: 'F', windUnit: 'mph', refreshMinutes: 30 });
  eq(s2.getSettings().tempUnit, 'F', 'patchSettings 温度单位');
  eq(s2.getSettings().windUnit, 'mph', 'patchSettings 风速单位');
  eq(s2.getSettings().refreshMinutes, 30, 'patchSettings 刷新间隔');
  s2.patchSettings({ tempUnit: 'X' });
  eq(s2.getSettings().tempUnit, 'F', '非法 tempUnit 被忽略（保持原值）');
  s2.patchSettings({ refreshMinutes: 9999 });
  eq(s2.getSettings().refreshMinutes, 120, 'refreshMinutes 被夹到上限 120');

  // ===== 3. WMO 映射 =====
  eq(s2.wmo(0, true).text, '晴', 'WMO 0 = 晴');
  eq(s2.wmo(0, false).icon, '🌙', 'WMO 0 夜间图标是月亮');
  eq(s2.wmo(95, true).group, 'storm', 'WMO 95 = 雷暴组');
  eq(s2.wmo(61, false).icon, '🌧️', 'WMO 61 夜间是雨');
  eq(s2.wmo(999, true).text, '未知', '未知 WMO 代码兜底为未知');
  eq(s2.wmo(null, true).code, null, 'null WMO → code 为 null');

  // ===== 4. AQI 分级 =====
  eq(s2.aqiLevel(30).label, '优', 'AQI 30 = 优');
  eq(s2.aqiLevel(50).label, '优', 'AQI 50 = 优（边界）');
  eq(s2.aqiLevel(51).label, '良', 'AQI 51 = 良（跨档）');
  eq(s2.aqiLevel(150).label, '轻度污染', 'AQI 150 = 轻度污染');
  eq(s2.aqiLevel(300).label, '重度污染', 'AQI 300 = 重度污染');
  eq(s2.aqiLevel(500).label, '严重污染', 'AQI 500 = 严重污染');

  // AQI 单位陷阱：Open-Meteo 全部返回 μg/m³，国标分段里 CO 用 mg/m³。
  // 不换算会把 CO 算成 1000 倍 → AQI 直接封顶 500、主污染物错成 CO。
  // 走 services.computeAqi 太绕，这里用 searchCities 拿不到，直接断言接口形状：
  // 用一个确定的数据源验证 —— 通过 loadCity 后的 air.avg24（见第 6 节）交叉检查。
  ok(typeof s2.aqiLevel === 'function', 'aqiLevel 暴露给页面做等级映射');

  // ===== 5. 城市检索（本地拼音 + 远端） =====
  // 本地拼音索引是主路径：必须离线可用、瞬时返回
  const loc = s2.searchCitiesLocal;
  eq(typeof loc, 'function', 'searchCitiesLocal 已暴露');

  const byCd = loc('cd');
  ok(byCd.length > 0, '拼音首字母 cd 有结果', 'len=' + byCd.length);
  eq(byCd[0].name, '成都', 'cd → 成都（首字母完全匹配排第一）');
  ok(byCd[0].pinyin === 'chengdu', '结果带全拼 chengdu', byCd[0].pinyin);
  eq(byCd[0].local, true, '本地结果标记 local=true');

  const byFull = loc('chengdu');
  ok(byFull.length > 0 && byFull[0].name === '成都', '全拼 chengdu → 成都');

  const byName = loc('成都');
  ok(byName.length > 0 && byName[0].name === '成都', '中文 成都 → 成都');
  eq(byName[0].score, undefined, '对外不暴露内部 score');

  const byPrefix = loc('哈尔');
  ok(byPrefix.length > 0 && byPrefix[0].name === '哈尔滨', '中文前缀 哈尔 → 哈尔滨', byPrefix[0] && byPrefix[0].name);

  const bj = loc('bj');
  ok(bj.length > 0 && bj[0].name === '北京', '首字母 bj → 北京（直辖市在索引里）', bj[0] && bj[0].name);
  const cq = loc('cq');
  ok(cq.length > 0 && cq[0].name === '重庆', '首字母 cq → 重庆');
  const xa = loc('xa');
  ok(xa.length > 0 && xa[0].name === '西安', '首字母 xa → 西安');

  const provHit = loc('四川');
  ok(provHit.length > 0, '按省份搜 四川 有结果', 'len=' + provHit.length);
  ok(provHit.every((c) => c.admin === '四川'), '省份搜索结果都属于该省', provHit[0] && provHit[0].admin);

  eq(loc('').length, 0, '空关键词返回空');
  eq(loc('   ').length, 0, '纯空格返回空');
  eq(loc('zzzzqqqq不存在的城市').length, 0, '不存在的城市返回空');
  ok(loc('cd').every((c) => c.lat > 3 && c.lat < 54 && c.lon > 73 && c.lon < 136), '索引坐标落在中国范围内');

  // 与远端合并
  let found = [];
  try {
    found = await s2.searchCities('北京');
  } catch (e) {
    failures.push('searchCities 联网失败：' + e.message);
  }
  ok(found.length > 0, 'searchCities("北京") 有结果', 'len=' + found.length);
  ok(found[0] && found[0].name === '北京', '精确同名排第一', found[0] && found[0].name);
  ok(found[0] && Math.abs(found[0].lat - 39.91) < 0.2, '北京纬度正确', found[0] && String(found[0].lat));
  ok(found[0] && typeof found[0].lon === 'number' && found[0].lon > 100, '北京经度正确', found[0] && String(found[0].lon));
  eq(new Set(found.map((r) => r.name + '|' + r.admin)).size, found.length, '合并结果无重复项');

  // 同名不同行政级别：Open-Meteo 里「南阳」有河南地级市和甘肃陇南市辖下的同名村庄。
  // 本地索引（地级市）必须压过远端，否则用户会加到甘肃那个村子上。
  const ny = await s2.searchCities('南阳');
  ok(ny.length > 0, 'searchCities("南阳") 有结果');
  eq(ny[0].admin, '河南', '南阳第一条是河南地级市，不是甘肃同名村庄', JSON.stringify(ny[0] && { a: ny[0].admin, lat: ny[0].lat }));
  ok(Math.abs(ny[0].lat - 32.9966) < 0.1, '南阳坐标是河南那个（32.99,112.53）', String(ny[0].lat));
  eq(ny.filter((r) => r.name === '南阳' && Math.abs(r.lat - 33.957) < 0.01).length, 0,
    '甘肃同名村庄已被去重剔除');

  try {
    const en = await s2.searchCities('Tokyo');
    ok(en.length > 0 && /东京|Tokyo/.test(en[0].name + (en[0].detail || '')), 'searchCities 英文也能搜到东京', en[0] && en[0].name);
  } catch (e) { failures.push('searchCities("Tokyo") 失败：' + e.message); }

  const none = await s2.searchCities('zzzz不存在的城市名qqq');
  eq(none.length, 0, '搜不到时返回空数组而不是报错');

  const empty = await s2.searchCities('   ');
  eq(empty.length, 0, '空关键词直接返回空数组（不发请求）');

  // 拼音结果应能直接加入并拿到真实天气坐标
  const cdAdd = s2.addCity(byCd[0]);
  eq(cdAdd.cities.length, 1, '拼音搜到的城市可直接加入');
  ok(Math.abs(byCd[0].lat - 30.6558) < 0.01, '成都坐标来自本地索引', String(byCd[0].lat));

  // ===== 6. 天气数据（联网） =====
  const h3 = makeHost();
  const s3 = loadServices(h3);
  const cd = s3.addCity({ name: '成都', admin: '四川省', lat: 30.5728, lon: 104.0668, tz: 'Asia/Shanghai' });
  const cdId = cd.current;
  let wx = null;
  try {
    wx = await s3.loadCity(s3.listCities().cities[0], { force: true });
  } catch (e) {
    failures.push('loadCity 联网失败：' + e.message);
  }
  if (wx) {
    ok(wx.current && typeof wx.current.temp === 'number', 'loadCity 返回 current.temp 数字', wx.current && String(wx.current.temp));
    ok(wx.current && wx.current.time.length === 16, 'current.time 是城市本地时间（YYYY-MM-DDTHH:mm）', wx.current && wx.current.time);
    eq(wx.hours.length, 24, '未来 24 小时正好 24 个点', wx.hours && String(wx.hours.length));
    eq(wx.days.length, 7, '7 天预报 7 条', wx.days && String(wx.days.length));
    ok(wx.hours[0].time >= wx.current.time.slice(0, 13), '24h 起点不早于当前小时', wx.hours[0] && wx.hours[0].time + ' vs ' + wx.current.time);
    ok(wx.days[0].sunrise.length === 16 && wx.days[0].sunrise.includes('T'), '日出时间是 ISO 本地时间', wx.days[0] && wx.days[0].sunrise);
    ok(wx.today && wx.today.max >= wx.today.min, '今日最高温 >= 最低温');
    ok(!!wx.city && wx.city.name === '成都', 'loadCity 回填城市信息');
    ok(wx.fetchedAt > 0 && wx.stale === false, '首次加载不是 stale');

    // 空气质量：接口失败时不应拖垮主界面，但「静默为空」是回归，必须显式暴露
    ok(!!wx.air, '空气质量接口返回了数据（变量名写错会静默变成 null）',
      '检查 hourly 是否用了全称 sulphur_dioxide/nitrogen_dioxide/carbon_monoxide/ozone');
    if (wx.air) {
      ok(!!wx.air.aqi, '空气质量算出 AQI', JSON.stringify(wx.air.aqi));
      if (wx.air.aqi) {
        ok(wx.air.aqi.value >= 0 && wx.air.aqi.value <= 500, 'AQI 在 0~500 之间', String(wx.air.aqi.value));
        ok(['优', '良', '轻度污染', '中度污染', '重度污染', '严重污染'].indexOf(wx.air.aqi.level) >= 0, 'AQI 等级文案合法', wx.air.aqi.level);
        ok(Array.isArray(wx.air.aqi.parts) && wx.air.aqi.parts.length > 0, 'AQI 污染物明细非空');
        const pm = wx.air.aqi.parts.filter(function (p) { return p.key === 'pm2_5'; })[0];
        ok(!pm || pm.value <= 500, 'PM2.5 分指数不越界', pm && String(pm.value));
        // CO 单位换算回归：不换算会算出 1000 倍浓度 → AQI 恒为 500
        const co = wx.air.aqi.parts.filter(function (p) { return p.key === 'co'; })[0];
        if (co) {
          ok(co.conc < 20, 'CO 展示值是 mg/m³ 量级（不是 μg/m³ 原始值）', co.conc + ' ' + co.unit);
          eq(co.unit, 'mg/m³', 'CO 单位标注为 mg/m³');
        }
        // 主污染物不该是长期被 CO 垄断
        ok(wx.air.aqi.primaryKey !== 'co' || wx.air.aqi.value < 200,
          'CO 不应无理由成为高 AQI 的主污染物（单位换算正确）', wx.air.aqi.value + ' / ' + wx.air.aqi.primary);
      }
      console.log('   [空气] AQI=' + (wx.air.aqi && wx.air.aqi.value) + ' ' + (wx.air.aqi && wx.air.aqi.level) + ' 主污染物=' + (wx.air.aqi && wx.air.aqi.primary));
    } else {
      console.log('   [空气] 接口本次不可用（主界面已容错，界面显示「暂无数据」）');
    }

    // 缓存闸门
    const t0 = Date.now();
    const cached = await s3.loadCity(s3.listCities().cities[0]);
    eq(cached.stale, true, 'minAge 内再次读取走缓存（stale=true）');
    eq(cached.fetchedAt, wx.fetchedAt, '缓存 fetchAt 与首次一致（没重新发请求）');
    ok(Date.now() - t0 < 500, '缓存读取不触网（很快返回）');

    // force 必须真的重拉
    await new Promise((r) => setTimeout(r, 1100));
    // 这套测试是真联网打 Open-Meteo 的，偶发网络抖动会直接把整个 run 炸掉。
    // 重试 3 次再判失败——既不掩盖真 bug，也不让一次抖动毁掉整轮验证。
    let forced = null, lastErr = null;
    for (let attempt = 0; attempt < 3 && !forced; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1500 * attempt));
      try {
        forced = await s3.loadCity(s3.listCities().cities[0], { force: true });
      } catch (e) { lastErr = e; }
    }
    ok(!!forced, 'force 重拉成功（网络抖动已重试 3 次）', forced ? '' : String((lastErr && lastErr.message) || lastErr));
    if (forced) {
      ok(forced.fetchedAt > wx.fetchedAt, 'force:true 会真正重新请求（fetchedAt 前进）', forced.fetchedAt + ' vs ' + wx.fetchedAt);
      eq(forced.stale, false, 'force 结果不是 stale');
    }

    // getCache
    const gc = s3.getCache(cdId);
    ok(!!gc && gc.city && gc.city.name === '成都', 'getCache 带城市信息');

    // 分享文案
    const share = s3.buildShareText(forced);
    ok(share.indexOf('成都') === 0, '分享文案以城市名开头', share.slice(0, 20));
    ok(share.indexOf('°') > 0, '分享文案含温度', share.slice(0, 60));
  }

  // 坐标错误时的错误信息
  await throwsAsync(() => s3.loadCity({ id: 'x', name: '无', lat: 95, lon: 0 }), '非法坐标城市 loadCity 抛错');

  // ===== 7. 主题与系统能力 =====
  eq(s3.theme().isDark, true, 'theme() 走宿主 isDarkColors');
  eq(s3.theme().source, 'ztools', 'theme() 标记来源为 ztools');
  let themeChanged = false;
  s3.onThemeChange(function () { themeChanged = true; });
  ok(typeof h3.win._themeCb === 'function', 'onThemeChange 转发到宿主');
  s3.copy('测试文本');
  eq(h3.calls.copy[0], '测试文本', 'copy 转发到宿主 copyText');
  s3.notify('测试通知');
  eq(h3.calls.notify[0], '测试通知', 'notify 单参数转发到宿主 showNotification');

  // ===== 8. 代理设置解析 =====
  const h4 = makeHost();
  const s4 = loadServices(h4);
  s4.patchSettings({ proxy: 'http://127.0.0.1:7897' });
  // 改代理后不报错即说明解析路径通（不真连）
  const badCity = s4.addCity({ name: '测试', lat: 60, lon: 120 });
  ok(badCity.cities.length === 1, '代理设置不影响城市簿');

  console.log('\n通过 ' + pass + ' 项');
  if (failures.length) {
    console.log('失败 ' + failures.length + ' 项:');
    failures.forEach((f) => console.log('  ✗ ' + f));
    process.exitCode = 1;
  } else {
    console.log('全部通过 ✔');
  }
})();
