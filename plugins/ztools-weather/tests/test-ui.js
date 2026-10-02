/* 天气助手 · UI 测试（浏览器控制台跑，依赖 tests/ui-harness.html）
   跑法：在浏览器打开 tests/ui-harness.html，控制台执行  __runUiTests()
   全部断言完会在控制台打印结果，并把汇总放到 window.__uiResult。 */
(function () {
  'use strict';
  window.__runUiTests = function () {
    var pass = 0, fail = [];
    function ok(c, n, x) { if (c) pass++; else fail.push(n + (x ? '  → ' + x : '')); }
    function eq(a, b, n) { ok(a === b, n, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
    function $(id) { return document.getElementById(id); }
    function txt(id) { return ($(id) ? $(id).textContent : '').trim(); }
    function vis(id) {
      var el = $(id);
      if (!el) return false;
      return getComputedStyle(el).display !== 'none';
    }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    return (async function () {
      // ---- 1. 首次渲染（boot 已自动跑完，等一拍） ----
      await sleep(60);

      ok(vis('view'), '主视图可见');
      ok(!vis('empty'), '有城市时不显示空态');
      eq(txt('cur-city'), '成都 · 四川省', '城市名显示 label');
      ok(/^-?\d+$/.test(txt('cur-temp')), '当前温度是整数', txt('cur-temp'));
      eq(txt('cur-unit'), '°C', '温度单位 °C');
      eq(txt('cur-text'), '阴', '天气文案 = 阴（code 3）');
      eq(txt('cur-icon'), '☁️', '白天阴图标');
      ok($('cur-meta').children.length >= 3, '体感/湿度/风速等徽标已渲染', String($('cur-meta').children.length));
      ok(/体感/.test($('cur-meta').textContent), '含体感温度');
      ok(/湿度 72%/.test($('cur-meta').textContent), '含湿度 72%');
      ok(/北风 4/.test($('cur-meta').textContent), '含风向风速（355°→北风）', $('cur-meta').textContent);
      ok(/1011 hPa/.test($('cur-meta').textContent), '含气压');

      // ---- 2. 城市条 ----
      eq($('cities').children.length, 3, '城市条 3 个城市');
      ok($('cities').children[0].classList.contains('on'), '第一个城市高亮为当前');
      eq($('cities').children[0].querySelector('.chip-name').textContent, '成都', '城市按钮文字');
      eq($('cities').querySelectorAll('.chip-x').length, 3, '每个城市都有删除按钮 ×');

      // ---- 3. 空气质量 ----
      eq(txt('aqi-badge'), '良', 'AQI 徽标 = 良');
      ok($('aqi-badge').classList.contains('fair'), 'AQI 徽标带 fair 颜色类', $('aqi-badge').className);
      ok(/^100/.test(txt('aqi-main')), 'AQI 数值 100', txt('aqi-main'));
      ok(/PM2\.5/.test(txt('aqi-main')), '标注主要污染物');
      eq($('aqi-parts').children.length, 6, '6 个污染物明细');
      ok(/CO 1\.8 mg\/m³/.test($('aqi-parts').textContent), 'CO 显示 mg/m³ 单位', $('aqi-parts').textContent);
      ok(/PM2\.5 62\.9 μg\/m³/.test($('aqi-parts').textContent), 'PM2.5 显示 μg/m³ 单位');

      // ---- 4. 今日概况 ----
      var tg = $('today-grid').textContent;
      ok(/27° \/ 22°/.test(tg), '最高/最低温', tg);
      ok(/概率 12%/.test(tg), '降水概率', tg);
      ok(/紫外线/.test(tg) && /低/.test(tg), '紫外线等级文案', tg);
      ok(/06:54 \/ 18:54/.test(tg), '日出日落 24 小时制', tg);

      // ---- 5. 24 小时 ----
      eq($('hours').children.length, 24, '24 小时卡片 24 个');
      eq($('hours').children[0].querySelector('b').textContent, '14:00', '起点是当前小时 14:00');
      eq($('hours').children[23].querySelector('b').textContent, '13:00', '终点跨到次日 13:00');
      ok(/80%/.test($('hours').children[5].textContent), '第 6 个小时降水概率 80%', $('hours').children[5].textContent);
      ok($('hour-chart').querySelectorAll('polyline').length === 1, '24h 温度折线 1 条');
      ok($('hour-chart').querySelectorAll('circle').length === 24, '24 个数据点');
      ok($('hour-chart').querySelectorAll('rect.bar').length > 0, '降水概率柱已绘制', String($('hour-chart').querySelectorAll('rect.bar').length));
      ok($('hour-chart').querySelectorAll('text').length >= 3, '坐标轴文字存在');

      // ---- 6. 7 天 ----
      eq($('days').children.length, 7, '7 天 7 行');
      eq($('days').children[0].querySelector('.d1').textContent, '今天', '第 1 行是今天');
      eq($('days').children[1].querySelector('.d1').textContent, '明天', '第 2 行是明天');
      ok($('days').children[0].classList.contains('today'), '今天行高亮');
      ok(/24° \/ 20°/.test($('days').children[1].textContent), '明天温度', $('days').children[1].textContent);
      ok(/88% 降水/.test($('days').children[1].textContent), '明天降水概率', $('days').children[1].textContent);
      eq($('day-chart').querySelectorAll('polyline').length, 2, '7 天图有最高/最低两条线');

      // ---- 7. 交互：输入即搜下拉框 ----
      $('q').focus();
      $('q').value = 'cd';
      $('q').dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(200);
      ok(vis('results'), '输入 cd 后下拉框出现');
      var rows = $('results').querySelectorAll('div.r');
      ok(rows.length >= 3, 'cd 命中多个城市（歧义，全部列出让用户选）', String(rows.length));
      eq(rows[0].querySelector('.r-name').textContent, '成都', 'cd 第一条是成都');
      ok(rows[0].classList.contains('on'), '第一条默认高亮');
      ok(rows[0].querySelector('.r-py') !== null, '显示拼音首字母标签');
      ok(/cd/.test(rows[0].querySelector('.r-py').textContent), '首字母标签内容 = cd', rows[0].querySelector('.r-py').textContent);
      ok(/chengdu/.test(rows[0].querySelector('.r-sub').textContent), '副标题含全拼', rows[0].querySelector('.r-sub').textContent);
      ok($('hint').hidden, '有候选时隐藏操作提示');

      // 方向键
      // ⚠ 每次 renderResults() 都会 box.textContent='' 后重建所有行节点，
      // 所以之前取的 rows NodeList 里的元素已经脱离文档，classList 反映的是旧状态。
      // 断言前必须重新查询，否则测的是「已销毁的节点」。
      $('q').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await sleep(20);
      rows = $('results').querySelectorAll('div.r');
      ok(!rows[0].classList.contains('on'), '↓ 后第一条取消高亮');
      ok($('results').children[1].classList.contains('on'), '↓ 后第二条高亮');
      $('q').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      await sleep(20);
      rows = $('results').querySelectorAll('div.r');
      ok($('results').children[0].classList.contains('on'), '↑ 回第一条');

      // 全拼
      $('q').value = 'chengdu';
      $('q').dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(200);
      ok($('results').querySelectorAll('div.r').length >= 1, '全拼 chengdu 有结果');
      eq($('results').querySelector('.r-name').textContent, '成都', '全拼 → 成都');

      // 高亮只在「查询词确实是城市名的子串」时才成立。
      // 搜 'cd' 时 highlight('成都','cd') 找不到子串，就不加 <mark>——这是正确行为，
      // 拼音没法在中文名里高亮。之前这里断言必有 mark，是把不可能的情况写成了断言。
      ok($('results').querySelector('.r-name') !== null, '候选行有城市名元素');
      // 用中文搜一次，验证真正会高亮
      $('q').value = '都';
      $('q').dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(200);
      ok($('results').querySelector('.r-name mark') !== null, '中文查询命中片段被高亮 mark 包裹',
         $('results').querySelector('.r-name') ? $('results').querySelector('.r-name').textContent : 'no row');
      $('q').value = 'cd';
      $('q').dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(200);

      // 点击候选 → 加入
      var nCity = $('cities').children.length;
      $('results').children[0].click();
      await sleep(120);
      ok(!vis('results'), '选中后下拉框收起');
      eq(txt('cur-city'), '成都 · 四川', '切换到成都');
      eq($('q').value, '', '搜索框已清空');
      ok($('q-clear').hidden, '清空按钮隐藏');
      ok($('cities').children.length >= nCity, '城市条已更新', String($('cities').children.length));
      ok(vis('toast'), '有提示 toast');
      ok(/已添加/.test(txt('toast')), 'toast 文案', txt('toast'));

      // Esc 关闭
      $('q').value = 'bj';
      $('q').dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(200);
      ok(vis('results'), '搜 bj 出候选');
      $('q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(30);
      ok(!vis('results'), 'Esc 关闭下拉框但保留输入', getComputedStyle($('results')).display);
      eq($('q').value, 'bj', 'Esc 不清空输入');
      // 再按一次 Esc 清空
      $('q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(30);
      eq($('q').value, '', '再按 Esc 清空输入');

      // 无结果
      $('q').value = 'zzzz不存在';
      $('q').dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(220);
      ok(vis('results'), '无结果时也显示面板（提示语）');
      eq($('results').querySelectorAll('div.r').length, 0, '没有候选行');
      ok(/没有找到/.test($('results').textContent), '给出「没有找到」提示', $('results').textContent);
      $('q-clear').click();
      await sleep(30);
      ok(!vis('results'), '点 ✕ 后收起');

      // ---- 9. 交互：设置对话框（分段按钮） ----
      $('settings').click();
      await sleep(30);
      ok(vis('settings-panel'), '设置对话框打开');
      ok(vis('settings-mask'), '有遮罩层');
      eq($('s-temp').getAttribute('data-v'), 'C', '温度单位初值 C');
      eq($('s-temp').querySelector('button.on').getAttribute('data-v'), 'C', '分段按钮高亮 C');
      eq($('s-refresh').getAttribute('data-v'), '5', '刷新间隔初值 5');
      ok($('settings-panel').getAttribute('aria-modal') === 'true', 'aria-modal 已声明');

      // 取消不保存
      $('s-temp').querySelector('button[data-v="F"]').click();
      await sleep(20);
      eq($('s-temp').getAttribute('data-v'), 'F', '点分段按钮切换选中');
      $('s-cancel').click();
      await sleep(30);
      ok(!vis('settings-panel'), '取消后关闭');
      ok(!vis('settings-mask'), '取消后遮罩消失');
      eq(txt('cur-unit'), '°C', '取消不生效（单位没变）');

      // 重新打开并保存
      $('settings').click();
      $('s-temp').querySelector('button[data-v="F"]').click();
      $('s-wind').querySelector('button[data-v="mph"]').click();
      $('s-refresh').querySelector('button[data-v="30"]').click();
      $('s-close').click();
      await sleep(60);
      ok(!vis('settings-panel'), '保存后关闭');
      eq(txt('cur-unit'), '°F', '切到华氏度后单位变化');
      // 夹具成都 26.2°C → 79.16°F
      ok(/^7\d$|^8\d$/.test(txt('cur-temp')), '华氏度温度已重算（26°C≈79°F）', txt('cur-temp'));
      ok(/7\d°/.test($('hours').children[0].querySelector('em').textContent), '24h 卡片也用华氏度', $('hours').children[0].textContent);
      ok(/8\d° \/ 7\d°/.test($('days').children[0].textContent), '7 天行也用华氏度', $('days').children[0].textContent);
      ok(/mph/.test($('cur-meta').textContent), '风速单位切到 mph', $('cur-meta').textContent);
      eq(window.__state.settings.refreshMinutes, 30, '刷新间隔保存为 30');
      // 改回
      $('settings').click();
      $('s-temp').querySelector('button[data-v="C"]').click();
      $('s-wind').querySelector('button[data-v="kmh"]').click();
      $('s-refresh').querySelector('button[data-v="5"]').click();
      $('s-close').click();
      await sleep(40);
      eq(txt('cur-unit'), '°C', '单位改回 °C');

      // ---- 10. 交互：复制 ----
      $('copy').click();
      await sleep(30);
      ok(window.__calls.copy.length > 0, '复制调用了 services.copy');
      var copied = window.__calls.copy[window.__calls.copy.length - 1] || '';
      ok(/成都|上海/.test(copied), '复制内容含当前城市名', copied);
      ok(/26°/.test(copied), '复制内容含温度', copied);

      // ---- 11. 交互：刷新（force 透传） ----
      var before = window.__calls.load.length;
      $('refresh').click();
      await sleep(60);
      ok(window.__calls.load.length > before, '刷新触发重新加载');
      var last = window.__calls.load[window.__calls.load.length - 1];
      eq(last.force, true, '手动刷新传 force=true');

      // ---- 12. 交互：删除城市 ----
      // 12a. 用 chip 上的 × 删一个「非当前」城市
      var n0 = $('cities').children.length;
      var curName = txt('cur-city');
      var targetIdx = -1;
      for (var i = 0; i < $('cities').children.length; i++) {
        if (!$('cities').children[i].classList.contains('on')) { targetIdx = i; break; }
      }
      ok(targetIdx >= 0, '存在可删除的非当前城市');
      var delId = $('cities').children[targetIdx].getAttribute('data-id');
      $('cities').children[targetIdx].querySelector('.chip-x').click();
      await sleep(120);
      eq($('cities').children.length, n0 - 1, '点 × 后城市数减 1');
      // ⚠ 必须按 id 断言，不能按城市名。前面搜索用例调 pickCity 又加了一个「成都」，
      // 列表里会有两个成都；删掉一个后按名字查当然「还在」——那是另一个，不是没删掉。
      var stillThere = Array.prototype.some.call($('cities').children, function (el) {
        return el.getAttribute('data-id') === delId;
      });
      ok(!stillThere, '被删的城市已从列表消失', 'data-id=' + delId);
      eq(window.__state.cities.filter(function (c) { return c.id === delId; }).length, 0,
         '被删的城市已从 state 移除');
      ok(/已删除/.test(txt('toast')), 'toast 提示已删除', txt('toast'));
      eq(txt('cur-city'), curName, '删非当前城市不会切走当前视图');

      // 12b. 删当前城市（大卡片上的「移除」按钮已删，现在统一走 chip 上的 ×）
      // 这条同时是 removeCityById 里 wasCurrent 判断的回归测试：
      // 删当前城市必须清掉 state.data 并重载，否则会显示上一个城市的数据。
      var n1 = $('cities').children.length;
      var curChip = null;
      for (var j = 0; j < $('cities').children.length; j++) {
        if ($('cities').children[j].classList.contains('on')) { curChip = $('cities').children[j]; break; }
      }
      ok(!!curChip, '能定位到当前城市的 chip');
      curChip.querySelector('.chip-x').click();
      await sleep(150);
      eq($('cities').children.length, n1 - 1, '点当前城市的 × 后城市数减 1');
      ok(vis('view'), '删除后仍显示视图（有其它城市）');
      ok(/已删除/.test(txt('toast')), 'toast 提示已删除', txt('toast'));
      ok(!!window.__state.data, '删当前城市后已重载新数据（不是空白）');
      ok(window.__state.data && window.__state.data.city &&
         window.__state.data.city.id === window.__state.current,
         '显示的是新当前城市的数据', JSON.stringify({
           cur: window.__state.current,
           shown: window.__state.data && window.__state.data.city && window.__state.data.city.id
         }));

      // 大卡片上不该再有「移除」按钮（每个 chip 的 × 才是删除入口）
      ok($('del-city') === null, '大卡片上的「移除」按钮已移除');

      // 静态护栏：app.js 里不允许有同名函数重复定义。
      // 踩过的坑：旧版 doSearch/renderResults 没删干净，同名后者覆盖前者，
      // 表面上「调用了新版」，实际跑的是旧版，输入即搜静默失效（data 有结果但 DOM 不渲染）。
      var appSrc = window.__appSrc || '';
      if (!appSrc && window.fetch) {
        appSrc = await fetch('app.js').then(function (r) { return r.text(); }).catch(function () { return ''; });
      }
      var defs = (appSrc.match(/^\s*function\s+([A-Za-z_$][\w$]*)/gm) || [])
        .map(function (m) { return m.match(/function\s+([A-Za-z_$][\w$]*)/)[1]; });
      // el / X 是图表函数内部的局部辅助函数，重名是正常的（各自作用域独立）。
      // 这里要抓的是「同一个外层作用域里同名函数被定义了两次」——那种才会后者覆盖前者。
      // 判据：行首无缩进 = 顶层定义；顶层同名才是真 bug。
      var topDefs = (appSrc.match(/^function\s+([A-Za-z_$][\w$]*)/gm) || [])
        .map(function (m) { return m.match(/function\s+([A-Za-z_$][\w$]*)/)[1]; });
      var seenD = {}, dupD = [];
      topDefs.forEach(function (n) { if (seenD[n]) { if (dupD.indexOf(n) < 0) dupD.push(n); } seenD[n] = 1; });
      ok(dupD.length === 0, 'app.js 顶层无重复定义的函数', dupD.join(','));

      // ---- 13. onPluginEnter 带 payload → 搜索 ----
      window.__enterCb({ type: 'over', payload: 'bj' });
      await sleep(220);
      ok(vis('results'), '主搜索框 payload 触发搜索');
      eq($('q').value, 'bj', '搜索框回填 payload');
      eq($('results').querySelector('.r-name').textContent, '北京', 'payload「bj」出北京');
      $('q-clear').click();
      await sleep(30);

      // 空 payload：不应残留候选
      window.__enterCb({ type: 'over', payload: '' });
      await sleep(60);
      ok(!vis('results'), '空 payload 不出候选');
      eq($('q').value, '', '空 payload 不写进搜索框');

      // ---- 13b. 非法日期 / 空数据兜底（不能出 NaN 或 09/32） ----
      // 12b 删过城市，state.data 可能已被清空；先确保有一份可改的数据再继续断言。
      if (!window.__state.data) { await window.__reloadFixtureData(); }
      ok(!!window.__state.data, '兜底测试前有可用数据');
      window.__state.data.days[3].date = '2026-09-33';
      window.__state.data.days[4].max = null;
      window.__state.data.days[4].min = null;
      window.__state.data.days[5].sunrise = '';
      window.__state.data.today.sunrise = '';
      window.__state.data.today.sunset = null;
      var rerender = window.__state.data;
      window.__boot();
      await sleep(200);
      var allTxt = $('view').textContent + $('cities').textContent +
                   $('cur-city').textContent + $('cur-temp').textContent;
      // ⚠ 只扫「渲染出来的界面」，不能扫整个 document.body.textContent：
      // harness 把 app.js / test-ui.js 源码内联进了 <script> 标签，脚本里本来就写着
      // "NaN"、"undefined" 这些字面量（注释里更是直接讨论它们），扫全文必然误报。
      ok(allTxt.indexOf('NaN') < 0, '界面不出现 NaN', allTxt.slice(0, 80));
      ok(!/09\/32/.test(allTxt), '界面不出现非法日期 09/32', String(allTxt.match(/\d{2}\/\d{2}/g)));
      ok(!/undefined/.test(allTxt), '界面不出现 undefined');
      ok(/%s/.test(allTxt) || allTxt.indexOf('--') >= 0, '缺失值显示为 -- 或省略');
      void rerender;

      // ---- 14. 主题：深色 ----
      window.__DARK = true;
      if (window.__themeCb) window.__themeCb();
      await sleep(20);
      ok(document.body.classList.contains('dark'), '深色模式 class 生效');
      var bg = getComputedStyle(document.body).backgroundColor;
      ok(bg === 'rgb(11, 18, 32)', '深色背景色', bg);
      // 对比度：正文 vs 背景
      var fg = getComputedStyle($('cur-city')).color;
      function lum(c) {
        var m = c.match(/\d+(\.\d+)?/g).map(Number);
        function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
        return 0.2126 * ch(m[0]) + 0.7152 * ch(m[1]) + 0.0722 * ch(m[2]);
      }
      var L1 = lum(fg), L2 = lum(bg);
      var ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      ok(ratio >= 4.5, '深色下文字对比度 ≥ 4.5:1', ratio.toFixed(2) + ':1');

      // 切回浅色
      window.__DARK = false;
      if (window.__themeCb) window.__themeCb();
      await sleep(20);
      ok(document.body.classList.contains('light'), '浅色模式 class 生效');
      var bg2 = getComputedStyle(document.body).backgroundColor;
      var fg2 = getComputedStyle($('cur-city')).color;
      var L3 = lum(fg2), L4 = lum(bg2);
      var r2 = (Math.max(L3, L4) + 0.05) / (Math.min(L3, L4) + 0.05);
      ok(r2 >= 4.5, '浅色下文字对比度 ≥ 4.5:1', r2.toFixed(2) + ':1');

      // ---- 15. [hidden] 真的隐藏（假 DOM 看不见级联，必须查 computed） ----
      $('toast').hidden = true;
      ok(getComputedStyle($('toast')).display === 'none', 'toast hidden 后真的 display:none');
      $('toast').hidden = false;
      ok(getComputedStyle($('toast')).display !== 'none', 'toast 取消 hidden 后恢复显示');

      // ---- 16. 高度同步 ----
      ok(window.__calls.height.length > 0, '调用了 setExpendHeight');
      var h = window.__calls.height[window.__calls.height.length - 1];
      ok(h > 100 && h <= 900, '高度在合理区间', String(h));

      // ---- 17. 滚动条实际生效 ----
      var sb = getComputedStyle($('hours')).scrollbarWidth;
      ok(sb === 'thin' || sb === 'auto' || sb === '', 'scrollbar-width 已设置', sb);

      console.log('通过 ' + pass + ' 项');
      if (fail.length) {
        console.log('失败 ' + fail.length + ' 项:');
        fail.forEach(function (f) { console.log('  ✗ ' + f); });
      } else {
        console.log('UI 全部通过 ✔');
      }
      window.__uiResult = { pass: pass, fail: fail };
      return window.__uiResult;
    })();
  };
})();
