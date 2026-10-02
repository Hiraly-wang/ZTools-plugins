/* 天气助手 · 页面逻辑（无 Node，只能调 window.services） */
(function () {
  'use strict';

  var S = window.services;
  var Z = window.ztools || window.utools || {};
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    cities: [],
    current: null,
    data: null,
    settings: null,
    timer: null,
    searching: false,
    results: [],
    resultIdx: -1,
    loading: false,
    lastError: ''
  };

  // ---------- 单位换算 ----------
  function temp(c, unit) {
    if (c == null || !isFinite(c)) return null;
    return unit === 'F' ? c * 9 / 5 + 32 : c;
  }
  function wind(kmh, unit) {
    if (kmh == null || !isFinite(kmh)) return null;
    if (unit === 'ms') return kmh / 3.6;
    if (unit === 'mph') return kmh * 0.621371;
    return kmh;
  }
  function windUnitLabel(u) { return u === 'ms' ? 'm/s' : (u === 'mph' ? 'mph' : 'km/h'); }
  function round1(v) { return v == null || !isFinite(v) ? null : Math.round(v * 10) / 10; }
  /** 温度显示：null/NaN 一律 '--'，绝不让 NaN 出现在界面上 */
  function deg(v, digits) {
    if (v == null || !isFinite(v)) return '--';
    return digits ? v.toFixed(1) : String(Math.round(v));
  }

  /** 16 方位中文 */
  var DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  function dirText(deg) {
    if (deg == null || !isFinite(deg)) return '';
    return DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8] + '风';
  }
  function uvText(v) {
    if (v == null || !isFinite(v)) return '--';
    if (v < 3) return v.toFixed(1) + ' 低';
    if (v < 6) return v.toFixed(1) + ' 中等';
    if (v < 8) return v.toFixed(1) + ' 偏高';
    if (v < 11) return v.toFixed(1) + ' 高';
    return v.toFixed(1) + ' 很高';
  }
  function clock(iso) {
    // ⚠ 别对 '2026-09-27T18:54' 直接 slice 当显示用：字段缺失时会得到 'undefined'。
    // 一律走正则校验，解析不出就返回 '--'。
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ''));
    return m ? (m[4] + ':' + m[5]) : '--';
  }
  function hm(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function dayLabel(dateStr, i) {
    if (i === 0) return '今天';
    if (i === 1) return '明天';
    if (i === 2) return '后天';
    var d = new Date(String(dateStr) + 'T00:00:00');
    if (isNaN(d.getTime())) return '--';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + '日一二三四五六'[d.getDay()];
  }
  /** 7 天表格里的短日期：MM/DD，非法日期返回 '--'（别让 09/32 这种东西出现在界面上） */
  function shortDate(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
    if (!m) return '--';
    var y = +m[1], mo = +m[2], d = +m[3];
    // ⚠ 光校验格式不够：'2026-09-33' 完全符合 \d{4}-\d{2}-\d{2}，正则照样放行，
    // 于是界面上出现 09/32 这种根本不存在的日期。必须回构造一个真实 Date 再比对。
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '--';
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '--';
    return m[2] + '/' + m[3];
  }

  // ---------- 主题 ----------
  function applyTheme(force) {
    var pref = state.settings ? state.settings.theme : 'auto';
    if (pref === 'light' || pref === 'dark') {
      document.body.classList.toggle('dark', pref === 'dark');
      document.body.classList.toggle('light', pref === 'light');
      return;
    }
    var dark = null;
    try { if (typeof S.theme === 'function') dark = !!S.theme().isDark; } catch (e) { dark = null; }
    if (dark == null) {
      try { dark = !!Z.isDarkColors; } catch (e) { dark = false; }
      if (typeof Z.isDarkColors === 'function') { try { dark = !!Z.isDarkColors(); } catch (e) { /* keep */ } }
    }
    if (dark == null) dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.classList.toggle('dark', !!dark);
    document.body.classList.toggle('light', !dark);
    if (force && typeof S.onThemeChange === 'function') S.onThemeChange(function () { applyTheme(false); });
  }

  // ---------- 提示 ----------
  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2400);
  }

  // ---------- 高度 ----------
  function syncHeight() {
    var h = Math.min(document.body.scrollHeight, 900);
    try { if (typeof Z.setExpendHeight === 'function') Z.setExpendHeight(h); } catch (e) { /* ignore */ }
  }

  // ---------- 渲染 ----------
  function renderCities() {
    var box = $('cities');
    box.textContent = '';
    state.cities.forEach(function (c) {
      // 每个城市一个 chip，chip 内含「×」用于直接删除该城市
      // （原来只有「移除」按钮删当前城市，列表里加到 3 个以上就没法删非当前的那个）
      var wrap = document.createElement('span');
      wrap.className = 'chip' + (c.id === state.current ? ' on' : '');
      wrap.setAttribute('data-id', c.id);
      wrap.title = c.label;

      var name = document.createElement('button');
      name.className = 'chip-name';
      name.textContent = c.name;
      name.setAttribute('data-act', 'pick');
      wrap.appendChild(name);

      var x = document.createElement('button');
      x.className = 'chip-x';
      x.textContent = '×';
      x.title = '删除 ' + c.name;
      x.setAttribute('data-act', 'del');
      x.setAttribute('data-id', c.id);
      wrap.appendChild(x);

      box.appendChild(wrap);
    });
  }

  function removeCityById(id) {
    var c = state.cities.filter(function (x) { return x.id === id; })[0];
    if (!c) return Promise.resolve();
    // 记下「删之前」的当前城市。判断该不该清数据必须用这个快照：
    // 下面 state.current 会被 S.removeCity 的返回值覆盖，删完之后再比较就没有意义了。
    // 之前写成 if (state.current !== id) 是反的——删非当前城市时 state.current 仍指向
    // 原来那个（!= id），于是把还有效的 state.data 清成 null，视图直接空白。
    var wasCurrent = (state.current === id);
    return Promise.resolve(S.removeCity(id)).then(function (r) {
      state.cities = r.cities;
      state.current = r.current;
      if (wasCurrent) state.data = null;   // 删的是当前城市 → 数据作废，必须重载
      renderCities();
      if (state.current) return loadCurrent(true);
      render();
    }).then(function () { toast('已删除 ' + (c ? c.name : '')); });
  }

  function renderNow(d) {
    var st = state.settings;
    var c = d.city || {};
    var w = S.wmo(d.current.code, d.current.isDay);
    var t = round1(temp(d.current.temp, st.tempUnit));
    $('cur-temp').textContent = deg(t);
    $('cur-unit').textContent = '°' + st.tempUnit;
    $('cur-text').textContent = w.text;
    $('cur-icon').textContent = w.icon;
    $('cur-city').textContent = c.label || '';
    $('cur-updated').textContent = d.stale ? ('缓存 · ' + hm(d.fetchedAt)) : ('更新于 ' + hm(d.fetchedAt));

    var meta = $('cur-meta');
    meta.textContent = '';
    function add(txt) { var s = document.createElement('span'); s.className = 'badge'; s.textContent = txt; meta.appendChild(s); }
    var feels = round1(temp(d.current.feels, st.tempUnit));
    if (feels != null) add('体感 ' + deg(feels) + '°');
    if (d.current.hum != null) add('湿度 ' + d.current.hum + '%');
    var wv = round1(wind(d.current.wind, st.windUnit));
    if (wv != null) add(dirText(d.current.windDir) + ' ' + wv + ' ' + windUnitLabel(st.windUnit));
    if (d.current.cloud != null) add('云量 ' + d.current.cloud + '%');
    if (d.current.pressure != null) add(Math.round(d.current.pressure) + ' hPa');
  }

  function renderAqi(d) {
    var badge = $('aqi-badge');
    var main = $('aqi-main');
    var parts = $('aqi-parts');
    parts.textContent = '';
    var a = d.air && d.air.aqi;
    if (!a) {
      badge.textContent = '--'; badge.className = 'badge';
      main.innerHTML = '<span class="muted">暂无数据</span>';
      return;
    }
    badge.textContent = a.level;
    badge.className = 'badge ' + a.color;
    main.innerHTML = '';
    main.appendChild(document.createTextNode(String(a.value)));
    var sm = document.createElement('small');
    sm.textContent = ' ' + a.level + ' · 主要污染物 ' + a.primary;
    main.appendChild(sm);
    a.parts.forEach(function (p) {
      var s = document.createElement('span');
      s.textContent = p.name + ' ' + p.conc + ' ' + (p.unit || '');
      parts.appendChild(s);
    });
  }

  function renderToday(d) {
    var box = $('today-grid');
    box.textContent = '';
    var st = state.settings;
    var t = d.today;
    function row(k, v) {
      var kk = document.createElement('div'); kk.className = 'k'; kk.textContent = k;
      var vv = document.createElement('div'); vv.className = 'v'; vv.textContent = v;
      box.appendChild(kk); box.appendChild(vv);
    }
    if (!t) { row('—', '暂无数据'); return; }
    var hi = round1(temp(t.max, st.tempUnit)), lo = round1(temp(t.min, st.tempUnit));
    row('最高 / 最低', deg(hi) + '° / ' + deg(lo) + '°');
    row('降水', (t.rain != null ? t.rain + ' mm' : '--') + (t.pop != null ? '（概率 ' + t.pop + '%）' : ''));
    var wv = round1(wind(t.wind, st.windUnit));
    row('最大风速', wv == null ? '--' : dirText(t.windDir) + ' ' + wv + ' ' + windUnitLabel(st.windUnit));
    row('紫外线', uvText(t.uv));
    row('日出 / 日落', clock(t.sunrise) + ' / ' + clock(t.sunset));
  }

  function renderHours(d) {
    var box = $('hours');
    box.textContent = '';
    var st = state.settings;
    d.hours.forEach(function (h) {
      var w = S.wmo(h.code, h.isDay);
      var div = document.createElement('div');
      div.className = 'hour';
      var b = document.createElement('b');
      b.textContent = (h.hour === 0 ? '00' : String(h.hour)) + ':00';
      var sp = document.createElement('span'); sp.textContent = w.icon;
      var em = document.createElement('em');
      var tv = round1(temp(h.temp, st.tempUnit));
      em.textContent = deg(tv) + '°';
      div.appendChild(b); div.appendChild(sp); div.appendChild(em);
      if (h.pop != null && h.pop > 0) {
        var p = document.createElement('em');
        p.textContent = h.pop + '%';
        div.appendChild(p);
      }
      box.appendChild(div);
    });
    drawHourChart(d);
  }

  function drawHourChart(d) {
    var svg = $('hour-chart');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var hs = d.hours;
    if (!hs.length) return;
    var st = state.settings;
    var W = 960, H = 150, padL = 26, padR = 12, padT = 14, padB = 20;
    var NS = 'http://www.w3.org/2000/svg';
    function el(n, a) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); return e; }

    var temps = [], pops = [];
    hs.forEach(function (h) {
      var tv = temp(h.temp, st.tempUnit);
      if (tv != null && isFinite(tv)) temps.push(tv);
      if (h.pop != null && isFinite(h.pop)) pops.push(h.pop);
    });
    if (!temps.length) return;
    var tmin = Math.min.apply(null, temps), tmax = Math.max.apply(null, temps);
    if (tmax - tmin < 1) { tmax += 0.5; tmin -= 0.5; }
    var pmax = Math.max.apply(null, pops.concat([10]));
    var innerW = W - padL - padR, innerH = H - padT - padB;
    function X(i) { return padL + (hs.length <= 1 ? innerW / 2 : (innerW * i / (hs.length - 1))); }
    function Yt(v) { return padT + innerH - ((v - tmin) / (tmax - tmin)) * innerH; }
    function Yp(v) { return padT + innerH - (Math.max(0, v) / pmax) * (innerH * 0.5); }

    // 降水概率柱（只画非 0，避免大片空柱）
    hs.forEach(function (h, i) {
      if (h.pop == null || !isFinite(h.pop) || h.pop <= 0) return;
      var y = Yp(h.pop);
      var w = Math.max(3, innerW / hs.length * 0.5);
      svg.appendChild(el('rect', { x: X(i) - w / 2, y: y, width: w, height: Math.max(1, padT + innerH - y), class: 'bar' }));
    });

    // 网格 + 温度刻度
    [tmin, (tmin + tmax) / 2, tmax].forEach(function (v) {
      var y = Yt(v);
      svg.appendChild(el('line', { x1: padL, y1: y, x2: W - padR, y2: y, class: 'grid' }));
      var tx = el('text', { x: 2, y: y + 3 });
      tx.textContent = Math.round(v) + '°';
      svg.appendChild(tx);
    });

    // 温度折线
    var pts = [];
    hs.forEach(function (h, i) {
      var tv = temp(h.temp, st.tempUnit);
      if (tv != null && isFinite(tv)) pts.push(X(i) + ',' + Yt(tv));
    });
    if (pts.length > 1) svg.appendChild(el('polyline', { points: pts.join(' '), class: 'ln' }));
    hs.forEach(function (h, i) {
      var tv = temp(h.temp, st.tempUnit);
      if (tv == null || !isFinite(tv)) return;
      svg.appendChild(el('circle', { cx: X(i), cy: Yt(tv), r: 2.6, class: 'dot' }));
    });

    // 时间刻度：每 3 小时一个
    hs.forEach(function (h, i) {
      if (i % 3 !== 0) return;
      var tx = el('text', { x: X(i), y: H - 5, 'text-anchor': 'middle' });
      tx.textContent = (h.hour === 0 ? '00' : String(h.hour)) + '时';
      svg.appendChild(tx);
    });
  }

  function renderDays(d) {
    var box = $('days');
    box.textContent = '';
    var st = state.settings;
    d.days.forEach(function (day, i) {
      var w = S.wmo(day.code, true);
      var hi = round1(temp(day.max, st.tempUnit)), lo = round1(temp(day.min, st.tempUnit));
      var div = document.createElement('div');
      div.className = 'day' + (i === 0 ? ' today' : '');
      var c1 = document.createElement('div'); c1.className = 'd1'; c1.textContent = dayLabel(day.date, i);
      var c2 = document.createElement('div'); c2.className = 'd2'; c2.textContent = w.icon; c2.title = w.text;
      var c3 = document.createElement('div'); c3.className = 'd3';
      c3.textContent = deg(hi) + '° / ' + deg(lo) + '°';
      var c4 = document.createElement('div'); c4.className = 'd4';
      c4.textContent = (day.pop != null ? day.pop + '% 降水' : '') + (day.rain ? ' ' + day.rain + 'mm' : '');
      div.appendChild(c1); div.appendChild(c2); div.appendChild(c3); div.appendChild(c4);
      box.appendChild(div);
    });
    drawDayChart(d);
  }

  function drawDayChart(d) {
    var svg = $('day-chart');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var days = d.days;
    if (!days || days.length < 2) return;
    var st = state.settings;
    var W = 960, H = 120, padL = 26, padR = 12, padT = 12, padB = 18;
    var NS = 'http://www.w3.org/2000/svg';
    function el(n, a) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); return e; }
    var vals = [];
    days.forEach(function (x) {
      var hi = temp(x.max, st.tempUnit), lo = temp(x.min, st.tempUnit);
      if (hi != null && isFinite(hi)) vals.push(hi);
      if (lo != null && isFinite(lo)) vals.push(lo);
    });
    if (!vals.length) return;
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (mx - mn < 1) { mx += 0.5; mn -= 0.5; }
    var innerW = W - padL - padR, innerH = H - padT - padB;
    function X(i) { return padL + (innerW * i / (days.length - 1)); }
    function Y(v) { return padT + innerH - ((v - mn) / (mx - mn)) * innerH; }

    var hiPts = [], loPts = [];
    days.forEach(function (x, i) {
      var hi = temp(x.max, st.tempUnit), lo = temp(x.min, st.tempUnit);
      if (hi != null && isFinite(hi)) hiPts.push(X(i) + ',' + Y(hi));
      if (lo != null && isFinite(lo)) loPts.push(X(i) + ',' + Y(lo));
    });
    if (hiPts.length > 1) svg.appendChild(el('polyline', { points: hiPts.join(' '), class: 'ln' }));
    if (loPts.length > 1) svg.appendChild(el('polyline', { points: loPts.join(' '), class: 'ln-min' }));
    [mn, mx].forEach(function (v) {
      var y = Y(v);
      svg.appendChild(el('line', { x1: padL, y1: y, x2: W - padR, y2: y, class: 'grid' }));
      var t = el('text', { x: 2, y: y + 3 });
      t.textContent = Math.round(v) + '°';
      svg.appendChild(t);
    });
    days.forEach(function (x, i) {
      var t = el('text', { x: X(i), y: H - 4, 'text-anchor': 'middle' });
      t.textContent = i === 0 ? '今天' : (i === 1 ? '明天' : shortDate(x.date));
      svg.appendChild(t);
    });
  }

  function render() {
    var d = state.data;
    var has = !!(d && d.current);
    $('view').hidden = !has;
    $('empty').hidden = has || state.cities.length > 0;
    if (!has) { syncHeight(); return; }
    renderNow(d);
    renderAqi(d);
    renderToday(d);
    renderHours(d);
    renderDays(d);
    syncHeight();
  }

  // ---------- 搜索：本地拼音索引（瞬时）+ 远端补充 ----------
  var searchSeq = 0;

  function renderResults() {
    var box = $('results');
    var q = $('q').value.trim();
    box.textContent = '';
    if (!q) { box.hidden = true; $('hint').hidden = false; return; }
    $('hint').hidden = true;
    if (!state.results.length) {
      var none = document.createElement('div');
      none.className = 'none';
      none.textContent = state.searching ? '搜索中…' : ('没有找到「' + q + '」，试试拼音或首字母');
      box.appendChild(none);
      box.hidden = false;
      return;
    }
    box.hidden = false;
    state.results.forEach(function (r, i) {
      var div = document.createElement('div');
      div.className = 'r' + (i === state.resultIdx ? ' on' : '');
      div.setAttribute('data-i', String(i));

      var nm = document.createElement('div');
      nm.className = 'r-name';
      nm.textContent = r.name;
      if (state.keyword) highlight(nm, r.name, state.keyword);

      var sub = document.createElement('div');
      sub.className = 'r-sub';
      sub.textContent = r.detail || r.admin || '';

      var py = document.createElement('div');
      py.className = 'r-py';
      if (r.initial) {
        py.appendChild(document.createTextNode('首字母 '));
        var b = document.createElement('b');
        b.textContent = r.initial;
        py.appendChild(b);
      }

      div.appendChild(nm);
      div.appendChild(sub);
      if (r.initial) div.appendChild(py);
      box.appendChild(div);
    });
  }

  /** 把命中的字/字母高亮出来 */
  function highlight(el, text, q) {
    el.textContent = '';
    var lower = text.toLowerCase();
    var i = lower.indexOf(q.toLowerCase());
    if (i < 0) { el.textContent = text; return; }
    el.appendChild(document.createTextNode(text.slice(0, i)));
    var mk = document.createElement('mark');
    mk.textContent = text.slice(i, i + q.length);
    el.appendChild(mk);
    el.appendChild(document.createTextNode(text.slice(i + q.length)));
  }

  /** 输入即搜：先本地拼音（同步、零延迟），再用远端补外国城市 */
  function doSearch(keyword) {
    var q = String(keyword == null ? $('q').value : keyword).trim();
    $('q-clear').hidden = !$('q').value;
    state.keyword = q;
    if (!q) {
      state.results = []; state.resultIdx = -1;
      renderResults();
      return Promise.resolve();
    }
    var seq = ++searchSeq;
    var local = [];
    try { local = S.searchCitiesLocal(q, { limit: 12 }) || []; } catch (e) { local = []; }
    state.results = local;
    state.resultIdx = local.length ? 0 : -1;
    state.searching = true;
    renderResults();
    return Promise.resolve(S.searchCities(q))
      .then(function (list) {
        if (seq !== searchSeq) return;          // 已有更新的输入，丢弃这次结果
        state.searching = false;
        // ⚠ 远端结果只能「补充」，不能「覆盖」本地结果。
        // 覆盖的后果：输入 cd 时本地瞬间给出 成都/常德/承德（带拼音、排序按知名度），
        // 网络回来后被 Open-Meteo 自己的结果整份换掉——它不认拼音，
        // 「cd市」这种垃圾条目会取代全部本地候选，表现就是「模糊查找不生效」。
        if (list && list.length) {
          var seen = {};
          state.results.forEach(function (r) { seen[(r.name || '') + '|' + (r.admin || '')] = 1; });
          var extra = list.filter(function (r) { return !seen[(r.name || '') + '|' + (r.admin || '')]; });
          if (extra.length) {
            state.results = state.results.concat(extra).slice(0, 12);
            if (state.resultIdx < 0) state.resultIdx = 0;
          }
        }
        renderResults();
      })
      .catch(function () {
        if (seq !== searchSeq) return;
        state.searching = false;
        renderResults();                          // 本地结果已经显示，不打扰用户
      });
  }

  function closeResults() {
    state.results = [];
    state.resultIdx = -1;
    searchSeq++;                                  // 让在途的远端请求作废
    $('results').hidden = true;
    $('results').textContent = '';
    $('hint').hidden = false;
  }

  function moveSelection(delta) {
    if (!state.results.length) return;
    var n = state.results.length;
    state.resultIdx = ((state.resultIdx + delta) % n + n) % n;
    renderResults();
    var on = $('results').children[state.resultIdx];
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }
  function showError(msg) {
    state.lastError = msg;
    $('cur-city').textContent = msg;
    $('cur-city').className = 'now-city err';
    $('view').hidden = true;
    $('empty').hidden = state.cities.length > 0;
    toast(msg);
  }

  function loadCurrent(force) {
    if (!state.current) { state.data = null; render(); return Promise.resolve(); }
    // ⚠ re-entrancy 闸门原来写成 `if (state.loading) return Promise.resolve();`——
    // 直接丢弃会留下「永远 loading」的坏状态：删城市后紧接着要重载新当前城市，
    // 若此时上一轮 loadCity 还没 settle，这次重载就被吞掉，state.data 一直是 null，
    // 视图空白。正确做法是记下「有更新请求」，等当前这轮结束后补跑一次。
    if (state.loading) { state.pendingReload = force; return Promise.resolve(); }
    var city = state.cities.filter(function (c) { return c.id === state.current; })[0];
    if (!city) { state.data = null; render(); return Promise.resolve(); }
    state.loading = true;
    $('cur-city').className = 'now-city loading';
    return Promise.resolve(S.loadCity(city, { force: !!force }))
      .then(function (d) {
        state.data = d;
        state.lastError = '';
        render();
      })
      .catch(function (e) {
        showError(String((e && e.message) || e));
      })
      .finally(function () {
        state.loading = false;
        if (state.pendingReload !== undefined) {
          var f = state.pendingReload;
          state.pendingReload = undefined;
          loadCurrent(f);
        }
      });
  }

  function loadAll(force) {
    var list = state.cities;
    return Promise.all(list.map(function (c) {
      return Promise.resolve(S.loadCity(c, { force: !!force })).catch(function () { return null; });
    }));
  }

  function scheduleRefresh() {
    clearInterval(state.timer);
    var min = state.settings ? Number(state.settings.refreshMinutes) : 5;
    if (!min || min <= 0) return;
    state.timer = setInterval(function () {
      // 窗口不可见时跳过，页面还开着就继续
      if (document.hidden) return;
      loadCurrent(false);
    }, min * 60 * 1000);
  }

  function refreshCityList() {
    return Promise.resolve(S.listCities()).then(function (r) {
      state.cities = r.cities || [];
      state.current = r.current || null;
      renderCities();
    });
  }

  // ---------- 交互 ----------
  function pickCity(r) {
    if (!r) return Promise.resolve();
    return Promise.resolve(S.addCity({ name: r.name, admin: r.admin, country: r.country, lat: r.lat, lon: r.lon, tz: r.tz }))
      .then(function (res) {
        closeResults();
        $('q').value = '';
        $('q-clear').hidden = true;
        state.cities = res.cities; state.current = res.current;
        renderCities();
        return loadCurrent(true);
      })
      .then(function () { toast('已添加 ' + r.name); });
  }

  function bind() {
    // 输入即搜（带 120ms 防抖），本地拼音索引是同步的所以候选立刻出现
    var debounce = null;
    $('q').addEventListener('input', function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () { doSearch(); }, 120);
    });
    $('q').addEventListener('focus', function () {
      if ($('q').value.trim()) doSearch();
    });
    $('q-clear').addEventListener('click', function () {
      $('q').value = '';
      $('q-clear').hidden = true;
      closeResults();
      $('q').focus();
    });

    $('q').addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(debounce);
        if (state.resultIdx >= 0 && state.results[state.resultIdx]) pickCity(state.results[state.resultIdx]);
        else doSearch();
      } else if (e.key === 'Escape') {
        if (!$('results').hidden) { closeResults(); }
        else { $('q').value = ''; $('q-clear').hidden = true; }
      }
    });

    $('results').addEventListener('click', function (e) {
      var row = e.target.closest && e.target.closest('div.r');
      if (!row) return;
      pickCity(state.results[Number(row.getAttribute('data-i'))]);
    });
    // 鼠标悬停同步键盘高亮，避免点错
    $('results').addEventListener('mousemove', function (e) {
      var row = e.target.closest && e.target.closest('div.r');
      if (!row) return;
      var i = Number(row.getAttribute('data-i'));
      if (i === state.resultIdx) return;
      state.resultIdx = i;
      Array.prototype.forEach.call($('results').children, function (c, j) {
        c.classList.toggle('on', j === i);
      });
    });

    // 点空白收起下拉
    document.addEventListener('mousedown', function (e) {
      if (!$('results').hidden && !e.target.closest('.searchwrap')) closeResults();
    });

    $('cities').addEventListener('click', function (e) {
      var del = e.target.closest && e.target.closest('.chip-x');
      if (del) {
        e.stopPropagation();
        removeCityById(del.getAttribute('data-id'));
        return;
      }
      var name = e.target.closest && e.target.closest('.chip-name');
      if (!name) return;
      var wrap = name.closest('.chip');
      if (!wrap) return;
      var id = wrap.getAttribute('data-id');
      if (id === state.current) return;
      Promise.resolve(S.setCurrent(id)).then(function (r) {
        state.current = r.current;
        renderCities();
        loadCurrent(false);
      });
    });

    $('refresh').addEventListener('click', function () {
      toast('正在刷新…');
      loadCurrent(true);
    });

    $('copy').addEventListener('click', function () {
      if (!state.data) return;
      var txt = S.buildShareText(state.data);
      if (!txt) return;
      Promise.resolve(S.copy(txt)).then(function () { toast('已复制到剪贴板'); });
    });

    // ---- 设置对话框（分段按钮，不是 select） ----
    function segValue(id) { return $(id).getAttribute('data-v'); }
    function segSet(id, v) {
      var seg = $(id);
      seg.setAttribute('data-v', v);
      Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
        b.classList.toggle('on', b.getAttribute('data-v') === v);
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll('.seg'), function (seg) {
      seg.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('button[data-v]');
        if (!b) return;
        segSet(seg.id, b.getAttribute('data-v'));
      });
    });

    function openSettings() {
      var s = state.settings;
      segSet('s-temp', s.tempUnit);
      segSet('s-wind', s.windUnit);
      segSet('s-refresh', String(s.refreshMinutes));
      $('settings-mask').hidden = false;
      $('settings-panel').hidden = false;
    }
    function closeSettings(save) {
      if (save) {
        // proxy 不在设置面板里暴露了（那是本机网络细节，插件内部用 'auto' 就够：
        // 直连失败自动探测本地代理）。别把已存的旧值清掉，沿用用户上一次的选择。
        var patch = {
          tempUnit: segValue('s-temp'),
          windUnit: segValue('s-wind'),
          refreshMinutes: Number(segValue('s-refresh'))
        };
        if (state.settings.proxy != null) patch.proxy = state.settings.proxy;
        state.settings = S.patchSettings(patch);
        applyTheme(false);
        scheduleRefresh();
        render();
      }
      $('settings-mask').hidden = true;
      $('settings-panel').hidden = true;
    }
    $('settings').addEventListener('click', openSettings);
    $('s-x').addEventListener('click', function () { closeSettings(false); });
    $('s-cancel').addEventListener('click', function () { closeSettings(false); });
    $('settings-mask').addEventListener('click', function () { closeSettings(false); });
    $('s-close').addEventListener('click', function () { closeSettings(true); });

    // 宿主生命周期
    if (typeof Z.onPluginEnter === 'function') {
      Z.onPluginEnter(function (param) {
        applyTheme(false);
        refreshCityList().then(function () { return loadCurrent(false); });
        var p = param && param.payload;
        if (typeof p === 'string' && p.trim()) {
          // 主搜索框直出：payload 是用户输入的城市关键词
          $('q').value = p.trim();
          doSearch(p.trim());
        }
      });
    }
    if (typeof Z.onPluginOut === 'function') {
      Z.onPluginOut(function () { clearInterval(state.timer); state.timer = null; });
    }
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.current && state.settings && state.settings.refreshMinutes > 0) {
        // 回前台补一轮：闸门决定是真拉还是用缓存
        loadCurrent(false);
      }
    });
  }

  // ---------- 启动 ----------
  function boot() {
    state.settings = S.getSettings();
    applyTheme(true);
    bind();
    // 首次使用：给个猜测城市（IP 粗定位只作为建议，用户可随时改）
    return refreshCityList()
      .then(function () {
        if (state.cities.length) return loadCurrent(false);
        return Promise.resolve(S.guessCity()).then(function (g) {
          if (g) return Promise.resolve(S.addCity(g, { select: true })).then(function (r) {
            state.cities = r.cities; state.current = r.current;
            renderCities();
            return loadCurrent(true);
          });
          render();
        });
      })
      .then(function () { scheduleRefresh(); syncHeight(); });
  }

  // 供 UI 测试用
  window.__boot = boot;
  window.__state = state;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
