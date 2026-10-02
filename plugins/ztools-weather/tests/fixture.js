/* UI 测试夹具：假 window.services + window.ztools，喂真实结构的数据。
   由 tools/build-harness.py 注入到 index.html 的 app.js 之前。 */
(function () {
  'use strict';

  var W = window;

  // ---- 夹具数据（结构与 preload 的 shapeWeather/shapeAir 完全一致） ----
  function mkHour(i) {
    var h = 14 + i;
    var day = h >= 24 ? h - 24 : h;
    var codes = [0, 0, 1, 2, 3, 61, 63, 80, 3, 2, 1, 0, 0, 1, 2, 2, 3, 61, 80, 81, 82, 95, 3, 2];
    return {
      time: (i < 10 ? '2026-09-27T' : '2026-09-28T') + ('0' + day).slice(-2) + ':00',
      hour: day,
      temp: 24 + Math.round(Math.sin(i / 4) * 5 * 10) / 10,
      feels: 26 + Math.round(Math.cos(i / 5) * 4 * 10) / 10,
      pop: [5, 5, 0, 0, 10, 80, 90, 60, 20, 0, 0, 5, 5, 0, 10, 20, 40, 70, 85, 95, 100, 90, 40, 10][i],
      code: codes[i],
      isDay: day >= 6 && day <= 19,
      hum: 60 + (i % 20)
    };
  }
  var HOURS = [];
  for (var i = 0; i < 24; i++) HOURS.push(mkHour(i));

  var DAYS = [];
  for (var d = 0; d < 7; d++) {
    // 用 Date 算真实日期，别用 27+d 拼字符串（27+6=33 → 09/32 这种非法日期）
    var dt = new Date(2026, 8, 27 + d);
    var ds = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2);
    DAYS.push({
      date: ds,
      code: [3, 61, 80, 0, 2, 95, 45][d],
      max: [27.1, 24.3, 22.8, 28.6, 29.2, 23.4, 25.1][d],
      min: [22.2, 20.1, 19.4, 21.0, 22.6, 18.8, 20.2][d],
      feelsMax: 29.4, feelsMin: 22.0,
      rain: [0, 8.2, 14.6, 0, 0, 21.3, 0.4][d],
      pop: [12, 88, 95, 5, 10, 92, 35][d],
      wind: [11.2, 18.4, 24.1, 9.8, 13.2, 28.6, 15.4][d],
      windDir: [355, 45, 90, 180, 225, 270, 315][d],
      uv: [1.15, 2.4, 1.8, 5.6, 6.2, 2.1, 3.4][d],
      sunrise: ds + 'T06:54',
      sunset: ds + 'T18:54'
    });
  }

  function mkData(cityName, admin) {
    return {
      city: { id: 'c1', name: cityName, admin: admin, country: '中国', lat: 30.57, lon: 104.07, label: cityName + ' · ' + admin, source: 'search' },
      current: {
        time: '2026-09-27T14:20', isDay: true, temp: 26.2, feels: 29.7, hum: 72,
        code: 3, precip: 0, cloud: 75, wind: 4.0, windDir: 355, gust: 9.2, pressure: 1011.4
      },
      today: DAYS[0],
      hours: HOURS,
      days: DAYS,
      timezone: 'Asia/Shanghai', utcOffset: 28800, elevation: 485,
      air: {
        now: { time: '2026-09-27T14:00', pm2_5: 35.7, pm10: 36.1, usAqi: 157, euAqi: 66 },
        avg24: { pm2_5: 62.9, pm10: 63.2, so2: 11, no2: 53.7, co: 1.77, o3: 68.3 },
        aqi: {
          value: 100, level: '良', color: 'fair', primary: 'PM2.5', primaryKey: 'pm2_5',
          parts: [
            { key: 'pm2_5', name: 'PM2.5', value: 100, conc: 62.9, unit: 'μg/m³' },
            { key: 'pm10', name: 'PM10', value: 76, conc: 63.2, unit: 'μg/m³' },
            { key: 'no2', name: 'NO₂', value: 74, conc: 53.7, unit: 'μg/m³' },
            { key: 'o3', name: 'O₃', value: 47, conc: 68.3, unit: 'μg/m³' },
            { key: 'so2', name: 'SO₂', value: 24, conc: 11, unit: 'μg/m³' },
            { key: 'co', name: 'CO', value: 44, conc: 1.8, unit: 'mg/m³' }
          ]
        }
      },
      fetchedAt: Date.now(), stale: false
    };
  }

  var CITIES = [
    { id: 'c1', name: '成都', admin: '四川省', country: '中国', lat: 30.57, lon: 104.07, label: '成都 · 四川省', source: 'guess' },
    { id: 'c2', name: '北京', admin: '北京市', country: '中国', lat: 39.9, lon: 116.4, label: '北京 · 北京市', source: 'search' },
    { id: 'c3', name: '上海', admin: '上海市', country: '中国', lat: 31.22, lon: 121.46, label: '上海 · 上海市', source: 'search' }
  ];

  var db = {};
  var calls = { copy: [], notify: [], open: [], height: [], load: [] };
  W.__current = 'c1';   // 当前城市状态，listCities/setCurrent/addCity/removeCity 共用

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  W.services = {
    // current 必须有状态：removeCity/setCurrent/addCity 都要读写它。
    // 之前各自硬编码 'c1'，导致「删当前城市」这条根本测不出真实行为。
    listCities: function () { return { cities: clone(CITIES), current: W.__current }; },
    addCity: function (c) {
      var id = 'c' + (CITIES.length + 1);
      CITIES.push({ id: id, name: c.name, admin: c.admin || '', country: c.country || '', lat: c.lat, lon: c.lon, label: (c.name + (c.admin ? ' · ' + c.admin : '')), source: 'search' });
      W.__current = id;
      return { cities: clone(CITIES), current: W.__current };
    },
    removeCity: function (id) {
      // 与 preload.js 真实行为一致：只有删掉「当前城市」时才把 current 顺延到列表第一个；
      // 删非当前城市不碰 current。夹具之前一律重置成 CITIES[0]，
      // 于是「删非当前城市不切走视图」这条永远测不出来。
      var cur = W.__current;
      CITIES = CITIES.filter(function (x) { return x.id !== id; });
      if (cur === id) { cur = CITIES.length ? CITIES[0].id : null; W.__current = cur; }
      return { cities: clone(CITIES), current: cur };
    },
    updateCity: function (id, p) {
      CITIES.forEach(function (x) { if (x.id === id && p.name) x.name = p.name; });
      return { cities: clone(CITIES), current: W.__current };
    },
    setCurrent: function (id) { W.__current = id; return { cities: clone(CITIES), current: W.__current }; },
      // 远端（Open-Meteo）：只认中文原文，不认拼音/首字母。
      // 这一点必须如实建模——远端对 'cd' 返回垃圾、对拼音返回空，才是真实行为。
      // 之前这里对任何输入都造一条 'q市'，于是「无结果」用例永远测不出来。
    searchCities: function (q) {
      var s = String(q || '').trim();
      if (!s) return Promise.resolve([]);
      if (s === '空结果') return Promise.resolve([]);
      if (s === 'cd') {
        return Promise.resolve([
          { name: '成都', admin: '四川', country: '中国', lat: 30.57, lon: 104.07, tz: 'Asia/Shanghai', detail: '中国 四川', local: false },
          { name: '奥尔良', admin: '卢瓦雷', country: '法国', lat: 47.9, lon: 1.9, tz: 'Europe/Paris', detail: '法国 卢瓦雷', local: false }
        ]);
      }
      // 只对「像真实中文地名」的输入造命中：2~6 个汉字，没有拉丁字母。
      // 'zzzz不存在' 这种要判为「找不到」——Open-Meteo 地理编码确实匹配不到它。
      // 之前这里对任何非 ASCII 输入都造一条 q，于是「无结果」用例永远测不出来。
      if (/^[一-龥]{2,6}$/.test(s)) {
        return Promise.resolve([{ name: s, admin: '测试省', country: '中国', lat: 30, lon: 120, tz: 'Asia/Shanghai', detail: '测试省', local: false }]);
      }
      return Promise.resolve([]);
    },
    // 本地拼音索引（同步返回，与 preload 真实行为一致）
    searchCitiesLocal: function (q) {
      var T = [
        { name: '成都', admin: '四川', pinyin: 'chengdu', initial: 'cd', detail: '四川 · 拼音 chengdu' },
        { name: '常德', admin: '湖南', pinyin: 'changde', initial: 'cd', detail: '湖南 · 拼音 changde' },
        { name: '承德', admin: '河北', pinyin: 'chengde', initial: 'cd', detail: '河北 · 拼音 chengde' },
        { name: '北京', admin: '北京', pinyin: 'beijing', initial: 'bj', detail: '北京 · 拼音 beijing' },
        { name: '上海', admin: '上海', pinyin: 'shanghai', initial: 'sh', detail: '上海 · 拼音 shanghai' },
        { name: '哈尔滨', admin: '黑龙江', pinyin: 'haerbin', initial: 'heb', detail: '黑龙江 · 拼音 haerbin' }
      ];
      var s = String(q || '').trim().toLowerCase();
      if (!s) return [];
      return T.filter(function (c) {
        return c.name.indexOf(s) >= 0 || c.pinyin.indexOf(s) === 0 || c.initial === s ||
          (c.initial.indexOf(s) === 0 && s.length >= 2) || c.admin.indexOf(s) === 0;
      }).slice(0, 12).map(function (c) {
        return { name: c.name, admin: c.admin, country: '中国', lat: 30, lon: 120, tz: 'Asia/Shanghai',
                 detail: c.detail, pinyin: c.pinyin, initial: c.initial, local: true };
      });
    },
    reverseGeocode: function () { return Promise.resolve({ name: '某市', admin: '某省', country: '中国', lat: 30, lon: 120 }); },
    guessCity: function () { return Promise.resolve(null); },   // 已有城市时不该再猜
    loadCity: function (city, opts) {
      calls.load.push({ id: city && city.id, force: !!(opts && opts.force) });
      var nm = (city && city.name) || '成都';
      var ad = (city && city.admin) || '四川省';
      var d = mkData(nm, ad);
      d.stale = false;
      // 与 preload.js 真实返回结构一致：loadCity 会把城市信息挂在 data.city 上
      // （shaped.city = publicCity(city)）。少了它，测试就验不了「显示的是新当前城市的数据」。
      d.city = city ? { id: city.id, name: city.name, admin: city.admin, label: city.label } : null;
      return Promise.resolve(d);
    },
    getCache: function () { return null; },
    getSettings: function () { return db.settings || { tempUnit: 'C', windUnit: 'kmh', refreshMinutes: 5, theme: 'auto', proxy: 'auto' }; },
    patchSettings: function (p) { db.settings = Object.assign(db.settings || {}, p); return db.settings; },
    theme: function () { return { isDark: W.__DARK === true, source: 'ztools' }; },
    onThemeChange: function (cb) { W.__themeCb = cb; return true; },
    wmo: function (code, isDay) {
      var M = {
        0: ['晴', '☀️', '🌙'], 1: ['晴间多云', '🌤️', '🌙'], 2: ['多云', '⛅', '☁️'], 3: ['阴', '☁️', '☁️'],
        45: ['有雾', '🌫️', '🌫️'], 61: ['小雨', '🌦️', '🌧️'], 63: ['中雨', '🌧️', '🌧️'],
        80: ['阵雨', '🌦️', '🌧️'], 82: ['暴雨', '⛈️', '⛈️'], 95: ['雷阵雨', '⛈️', '⛈️']
      };
      var m = M[code] || ['未知', '🌡️', '🌡️'];
      return { code: code == null ? null : code, text: m[0], icon: isDay ? m[1] : m[2], group: 'x' };
    },
    aqiLevel: function (v) {
      return [[50, '优', 'good'], [100, '良', 'fair'], [150, '轻度污染', 'warn'], [200, '中度污染', 'warn'], [300, '重度污染', 'bad'], [Infinity, '严重污染', 'bad']]
        .filter(function (x) { return v <= x[0]; })[0] || ['严重污染', 'bad'];
    },
    buildShareText: function (d) {
      return d.city.name + ' ☁️ 阴\n现在 26°（体感 30°）\n今日 22° ~ 27°';
    },
    openExternal: function (u) { calls.open.push(u); return Promise.resolve(); },
    copy: function (t) { calls.copy.push(t); return Promise.resolve(); },
    notify: function (b) { calls.notify.push(b); return Promise.resolve(); }
  };

  W.ztools = {
    isDarkColors: function () { return W.__DARK === true; },
    getThemeInfo: function () { return { isDark: W.__DARK === true, primaryColor: 'green' }; },
    onThemeChange: function (cb) { W.__themeCb = cb; },
    setExpendHeight: function (h) { calls.height.push(h); return Promise.resolve(); },
    onPluginEnter: function (cb) { W.__enterCb = cb; },
    onPluginOut: function (cb) { W.__outCb = cb; }
  };

  W.__calls = calls;
  W.__cities = function () { return CITIES; };
  W.__setDb = function (o) { db = o || {}; };
  // 供 test-ui.js 恢复现场：前面的用例删过城市后 state.data 可能是 null，
  // 后续断言需要一份可改的数据。直接塞回 state 并重渲染。
  W.__reloadFixtureData = function () {
    var c = CITIES[0];
    if (!c) return Promise.resolve(null);
    return Promise.resolve(W.services.loadCity(c, { force: false })).then(function (d) {
      W.__state.data = d;
      W.__state.loading = false;
      if (typeof W.__render === 'function') W.__render();
      return d;
    });
  };
})();
