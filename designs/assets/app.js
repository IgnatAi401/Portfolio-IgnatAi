  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, "0");
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fullSrc = p => `photos/full/${p.src}`;
  const thumbSrc = p => `photos/thumb/${p.src}`;
  const TYPES = ["人文", "风景"];
  const state = { country: null, city: null, type: "all", hot: null };

  let DB = null, ORDER = [], PEND = [], ORD = new Map(), COUNTRIES = [];
  let PHOTOS = new Map(), COUNTRY_PHOTOS = new Map(), COUNTRY_INFO = new Map();
  let LIT = null, frames = [], regionButtons = [], mapCountries = [];
  const byId = id => PHOTOS.get(id);
  const isLit = p => (!state.country || p.country === state.country) && (!state.city || p.city === state.city) && (state.type === "all" || p.type === state.type);
  const litList = () => LIT ||= ORDER.filter(isLit);
  // 待审核的照片（review: true）单独一栏，只在本地编辑服务器下出现；审核通过后才进入作品、地图和筛选
  let canEdit = false;
  const navList = p => p?.review ? PEND : litList();
  const fmt = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}  ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  const day = p => (p.taken || "").slice(0, 10);
  const when = p => p.taken ? p.taken.slice(0, 16).replace("T", " ") : "日期待补";
  const has = v => v !== null && v !== undefined && v !== "";

  // 某国家的城市选项：先用 photos.json 里登记的，再补上照片里出现但没登记的
  function citiesOf(country) {
    const listed = (DB.countries[country]?.cities || []).map(c => c.name);
    const registered = new Set(listed);
    const extra = [...new Set((COUNTRY_PHOTOS.get(country) || []).filter(p => p.city && !registered.has(p.city)).map(p => p.city))];
    return [...listed, ...extra];
  }
  function cityGeo(p) {
    if (has(p.lat) && has(p.lon)) return [p.lat, p.lon];
    const c = (DB.countries[p.country]?.cities || []).find(c => c.name === p.city);
    return c && has(c.lat) ? [c.lat, c.lon] : null;
  }

  // 排序：按拍摄时间，没日期的排最后
  function derive() {
    LIT = null;
    PHOTOS = new Map(DB.photos.map(p => [p.id, p]));
    COUNTRY_PHOTOS = new Map();
    DB.photos.forEach(p => {
      if (!COUNTRY_PHOTOS.has(p.country)) COUNTRY_PHOTOS.set(p.country, []);
      COUNTRY_PHOTOS.get(p.country).push(p);
    });
    const key = p => (p.taken || "9999") + p.id;
    const sorted = [...DB.photos].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
    ORDER = sorted.filter(p => !p.review);
    PEND = sorted.filter(p => p.review);
    ORD = new Map([...ORDER.map((p, i) => [p, i]), ...PEND.map((p, i) => [p, i])]);
    const orderedCountries = new Map();
    ORDER.forEach(p => {
      if (!orderedCountries.has(p.country)) orderedCountries.set(p.country, []);
      orderedCountries.get(p.country).push(p);
    });
    COUNTRIES = [...orderedCountries].map(([name, items]) => {
      const meta = DB.countries[name] || {};
      const geo = items.map(cityGeo).filter(Boolean);
      const cityCounts = new Map();
      items.forEach(p => cityCounts.set(p.city, (cityCounts.get(p.city) || 0) + 1));
      return {
        name, en: meta.en || "", iso: meta.iso || "", items, cities: citiesOf(name), cityCounts,
        lat: geo.reduce((s, g) => s + g[0], 0) / (geo.length || 1),
        lon: geo.reduce((s, g) => s + g[1], 0) / (geo.length || 1),
      };
    });
    COUNTRY_INFO = new Map(COUNTRIES.map(c => [c.name, c]));
  }

  function years(list) {
    const ys = list.filter(p => p.taken).map(p => p.taken.slice(0, 4)).sort();
    return !ys.length ? "" : ys[0] === ys.at(-1) ? ys[0] : `${ys[0]}–${ys.at(-1)}`;
  }

  /* ———————— 地图 ———————— */
  const W = 1200;
  let H = 560, projection = null, miniURL = null;
  const GEO = new Map();  // 国家名 → { feature, x, y }；单独存，编辑数据重算 COUNTRIES 时不会丢

  function loadMapScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      // 并行下载，按插入顺序执行：d3-geo 依赖 d3-array。
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`地图脚本加载失败：${src}`));
      document.head.appendChild(script);
    });
  }

  async function buildMap() {
    const [topo] = await Promise.all([
      fetch("assets/vendor/countries-110m.json").then(r => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      }),
      ...["d3-array", "d3-geo", "topojson-client"].map(name => loadMapScript(`assets/vendor/${name}.min.js`)),
    ]);
    // 陆地不含南极洲（id 010），否则底边会露出一截被裁断的冰盖
    const land = topojson.merge(topo, topo.objects.countries.geometries.filter(g => g.id !== "010"));
    const features = topojson.feature(topo, topo.objects.countries).features;

    // 纬度范围覆盖格陵兰北端（83.6°N）到火地岛（55.9°S），上下再留出海岸波纹和光晕的空间
    projection = d3.geoNaturalEarth1().rotate([-15, 0]).fitWidth(W, { type: "Sphere" });
    const PAD = 26;
    const yTop = projection([0, 84])[1] - PAD, yBot = projection([0, -56.5])[1] + PAD;
    const [tx, ty] = projection.translate();
    projection.translate([tx, ty - yTop]);
    H = Math.round(yBot - yTop);

    COUNTRIES.forEach(c => { const f = features.find(f => f.id === c.iso); if (f) GEO.set(c.name, { feature: f }); });
    const borders = topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b);

    // 1) 画布底图：像老雕版地图——海岸外一圈圈波纹，陆地实心，去过的国家涂成琥珀色
    const cv = $("mapCanvas"), S = 2;
    cv.width = W * S; cv.height = H * S;
    const ctx = cv.getContext("2d"); ctx.scale(S, S);
    const paths = new Map();
    const draw = (obj, how) => {
      if (!paths.has(obj)) {
        const path = new Path2D();
        d3.geoPath(projection, path)(obj);
        paths.set(obj, path);
      }
      how(paths.get(obj));
    };
    ctx.lineJoin = ctx.lineCap = "round";

    // 海岸波纹：从外往里，先画一圈线色粗描边，再用底片黑压掉内侧，只剩一条细环
    const gap = 4.2, rings = 5;
    for (let i = rings; i >= 1; i--) {
      ctx.lineWidth = i * gap * 2;
      ctx.strokeStyle = `rgba(211, 157, 63, ${0.1 + (rings - i) * 0.05})`;
      draw(land, path => ctx.stroke(path));
      ctx.lineWidth = i * gap * 2 - 1.4;
      ctx.strokeStyle = "#070606";
      draw(land, path => ctx.stroke(path));
    }

    // 经纬网：很淡，压在陆地下面
    ctx.lineWidth = .5; ctx.strokeStyle = "rgba(228, 221, 210, .06)";
    draw(d3.geoGraticule().step([20, 20])(), path => ctx.stroke(path));

    // 陆地 + 国界
    ctx.fillStyle = "#26211c"; draw(land, path => ctx.fill(path));
    ctx.lineWidth = .5; ctx.strokeStyle = "#0f0d0b"; draw(borders, path => ctx.stroke(path));

    // 去过的国家：琥珀色，带一点安全灯似的光晕
    ctx.save();
    ctx.shadowColor = "rgba(211, 157, 63, .55)"; ctx.shadowBlur = 14;
    ctx.fillStyle = "#c8913a";
    GEO.forEach(g => draw(g.feature, path => ctx.fill(path)));
    ctx.restore();
    ctx.lineWidth = .6; ctx.strokeStyle = "#f0c27a";
    GEO.forEach(g => draw(g.feature, path => ctx.stroke(path)));

    // 海岸线
    ctx.lineWidth = .7; ctx.strokeStyle = "rgba(228, 221, 210, .22)";
    draw(land, path => ctx.stroke(path));
    // 小地图只显示 150px：用双倍尺寸异步编码，避免同步编码整张 2400px 底图。
    const mini = document.createElement("canvas");
    mini.width = 300; mini.height = Math.round(300 * H / W);
    mini.getContext("2d").drawImage(cv, 0, 0, mini.width, mini.height);
    mini.toBlob(blob => {
      if (!blob) return;
      if (miniURL) URL.revokeObjectURL(miniURL);
      miniURL = URL.createObjectURL(blob);
      if (cur && vf.classList.contains("open")) paintViewer(cur);
    }, "image/png");

    // 2) SVG 层：去过的国家做成可悬停、可点击的热区；太小的国家补一块看不见的圆形热区
    const svg = $("mapSvg"), path = d3.geoPath(projection);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = COUNTRIES.filter(c => GEO.has(c.name)).map(c => {
      const g = GEO.get(c.name);
      [g.x, g.y] = path.centroid(g.feature);
      const hit = path.area(g.feature) < 400 ? `<circle class="hit" cx="${g.x.toFixed(1)}" cy="${g.y.toFixed(1)}" r="12"/>` : "";
      return `<g class="ctry" data-country="${esc(c.name)}" tabindex="0" role="button" aria-label="${esc(c.name)}，${c.items.length} 张">${hit}<path d="${path(g.feature)}"/></g>`;
    }).join("");
    mapCountries = [...svg.querySelectorAll(".ctry")];
    $("mapLoading").remove();
    paintMap();
  }

  function paintMap() {
    mapCountries.forEach(el => el.classList.toggle("hot", el.dataset.country === state.hot || el.dataset.country === state.country));
    regionButtons.forEach(b => b.classList.toggle("hot", b.dataset.country === state.hot));
  }

  function showTip(name) {
    const tip = $("tip"), c = COUNTRY_INFO.get(name), g = GEO.get(name);
    if (!c || !g || g.x == null) { tip.classList.remove("on"); return; }
    const st = c.items.filter(p => p.type === "人文").length, ls = c.items.filter(p => p.type === "风景").length;
    const show = [...c.items.filter(p => p.pick), ...c.items.filter(p => !p.pick)].slice(0, 3);
    tip.innerHTML = `
      <div class="h"><span>${esc(c.en.toUpperCase())}</span><span>${c.items.length} EXP</span></div>
      <h3>${esc(c.name)}<small>${esc(c.en)}</small></h3>
      <div class="meta">${years(c.items)}　人文 ${st}　风景 ${ls}</div>
      <div class="meta">${c.cities.map(esc).join(" · ")}</div>
      <div class="thumbs">${show.map(p => `<img src="${esc(thumbSrc(p))}" alt="" decoding="async">`).join("")}</div>
      <div class="go">点击跳到印样</div>`;
    const px = g.x / W * 100, py = g.y / H * 100, right = px > 62;
    tip.style.left = right ? "auto" : `calc(${px}% + 26px)`;
    tip.style.right = right ? `calc(${100 - px}% + 26px)` : "auto";
    tip.style.top = `clamp(0px, calc(${py}% - 60px), calc(100% - 210px))`;
    tip.classList.add("on");
    $("edgeCoord").textContent = `${c.en.toUpperCase() || c.name} ▸ ${fmt(c.lat, c.lon)}`;
  }

  function hover(name) {
    if (state.hot === name) return;
    state.hot = name; paintMap();
    if (name) showTip(name);
    else { $("tip").classList.remove("on"); $("edgeCoord").textContent = "把鼠标放在亮起的国家上"; }
  }

  const mapEl = $("map");
  mapEl.addEventListener("pointerover", e => { const t = e.target.closest(".ctry"); hover(t ? t.dataset.country : null); });
  mapEl.addEventListener("pointerleave", () => hover(null));
  mapEl.addEventListener("click", e => { const t = e.target.closest(".ctry"); if (t) pickCountry(t.dataset.country, true); });
  mapEl.addEventListener("focusin", e => { const t = e.target.closest(".ctry"); if (t) hover(t.dataset.country); });
  mapEl.addEventListener("keydown", e => { const t = e.target.closest(".ctry"); if (t && e.key === "Enter") pickCountry(t.dataset.country, true); });

  /* ———————— 地区 + 类别筛选 ———————— */
  function renderBar() {
    const multi = COUNTRIES.length > 1;
    $("rolls").innerHTML = `<button data-all aria-pressed="${!state.country && !state.city}">全部<small>${ORDER.length}</small></button>` +
      COUNTRIES.map(c => (multi
        ? `<button data-country="${esc(c.name)}" aria-pressed="${state.country === c.name && !state.city}">${esc(c.name)}<small>${c.items.length}</small></button>`
        : `<span class="cty">${esc(c.name)}</span>`) +
        c.cities.map(city => `<button data-country="${esc(c.name)}" data-city="${esc(city)}" aria-pressed="${state.city === city && state.country === c.name}">${esc(city)}<small>${c.cityCounts.get(city) || 0}</small></button>`).join("")
      ).join("");
    regionButtons = [...$("rolls").querySelectorAll("button")];
  }
  function paintBar() {
    regionButtons.forEach(b => {
      const pressed = b.dataset.all !== undefined ? !state.country && !state.city
        : state.country === b.dataset.country && (b.dataset.city ? state.city === b.dataset.city : !state.city);
      b.setAttribute("aria-pressed", pressed);
    });
  }
  $("rolls").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.all !== undefined) { state.country = state.city = null; }
    else if (b.dataset.city) {
      const same = state.city === b.dataset.city && state.country === b.dataset.country;
      state.country = same ? null : b.dataset.country; state.city = same ? null : b.dataset.city;
    } else { pickCountry(b.dataset.country, false); return; }
    applyFilter();
  });
  $("rolls").addEventListener("pointerover", e => { const b = e.target.closest("button[data-country]"); state.hot = b ? b.dataset.country : null; paintMap(); });
  $("rolls").addEventListener("pointerleave", () => { state.hot = null; paintMap(); });

  function pickCountry(name, jump) {
    const same = state.country === name && !state.city;
    state.country = same ? null : name; state.city = null;
    applyFilter();
    if (jump && !same) $("sheet").scrollIntoView({ block: "start" });
  }

  $("toggle").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    state.type = b.dataset.type;
    applyFilter();
  });

  // 符合条件的亮着，其余压暗
  function applyFilter() {
    LIT = null;
    paintBar(); paintMap();
    document.querySelectorAll("#toggle button").forEach(x => x.setAttribute("aria-pressed", x.dataset.type === state.type));
    frames.forEach(f => {
      const p = byId(f.dataset.id);
      f.classList.toggle("off", !!p && !p.review && !isLit(p));
    });
  }

  /* ———————— 印样 ———————— */
  function greaseBox(seed) {
    const r = n => ((Math.sin(seed * 9301 + n * 49297) + 1) / 2) * 3 - 1.5;
    return `M${3 + r(1)} ${4 + r(2)} C 30 ${1 + r(3)}, 70 ${2 + r(4)}, ${97 + r(5)} ${3 + r(6)} C ${99 + r(7)} 35, ${98 + r(8)} 70, ${96 + r(9)} ${97 + r(10)} C 65 ${99 + r(11)}, 30 ${98 + r(12)}, ${4 + r(13)} ${96 + r(14)} C ${1 + r(15)} 65, ${2 + r(16)} 30, ${6 + r(17)} ${1 + r(18)}`;
  }

  function frameHTML(p) {
    const n = ORD.get(p) + 1, md = p.taken ? `${p.taken.slice(5, 7)}.${p.taken.slice(8, 10)}` : "——";
    const dash = v => has(v) ? esc(v) : "—";
    return `
      <div class="frame${p.review || isLit(p) ? "" : " off"}" data-id="${esc(p.id)}">
        <div class="fedge t"><span>${md}</span><span>▸ ${n}</span><span>${n}A</span></div>
        <button class="win ${p.h > p.w ? "rot" : ""}" data-id="${esc(p.id)}" aria-label="全屏看：${esc(p.title || "未命名")}">
          <img src="${esc(thumbSrc(p))}" alt="${esc(p.title)}" loading="lazy" decoding="async" draggable="false">
        </button>
        ${p.pick ? `<svg class="mark" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${greaseBox(n)}" vector-effect="non-scaling-stroke"/></svg>` : ""}
        <div class="fedge b"><span>f/${dash(p.f)}</span><span>${dash(p.s)}</span><span>${has(p.mm) ? p.mm + "MM" : "—"}</span><span>ISO${dash(p.iso)}</span></div>
      </div>`;
  }

  // 同一天的照片接成一段胶片，每段最多 6 格
  function stripsHTML(list) {
    const strips = [];
    let i = 0;
    while (i < list.length) {
      const d = day(list[i]);
      let j = i; while (j < list.length && day(list[j]) === d) j++;
      const items = list.slice(i, j);
      const cities = [...new Set(items.map(p => p.city || "城市待补"))].join(" / ");
      for (let k = 0; k < items.length; k += 6) {
        const tag = k ? "" : `<span class="roll-tag">${d ? d.replaceAll("-", ".") : "日期待补"}　${esc(cities)}</span>`;
        strips.push(`<div class="strip">${tag}${items.slice(k, k + 6).map(frameHTML).join("")}</div>`);
      }
      i = j;
    }
    return strips.join("");
  }

  function renderSheet() {
    const nCity = new Set(ORDER.map(p => p.city).filter(Boolean)).size;
    const pending = canEdit && PEND.length ? `
      <section class="pending" aria-label="待审核">
        <div class="sheet-head">
          <h2>待审核<small>${PEND.length} 张，审核通过前不会出现在作品、地图和筛选里，也不会上线</small></h2>
          <span class="note">点开一张，在右侧核对信息，再点「审核通过」</span>
        </div>
        <div class="strips">${stripsHTML(PEND)}</div>
      </section>` : "";
    $("sheet").innerHTML = pending + `
      <div class="sheet-head">
        <h2>Proof ${years(ORDER)}<small>${nCity} 个地方，${ORDER.length} 张</small></h2>
        <span class="note"><svg viewBox="0 0 26 16"><path d="M2 3 C8 1 18 1 24 3 C25 7 25 10 23 14 C16 15 8 15 3 13 C1 9 1 6 3 2" fill="none" stroke="#c9302a" stroke-width="2"/></svg>红笔框的是精选；点任意一格全屏看</span>
      </div>
      <div class="strips">${stripsHTML(ORDER)}</div>`;
    frames = [...$("sheet").querySelectorAll(".frame[data-id]")];
    hideLoupe();
    sheetDirty = false;
  }
  let sheetDirty = false;

  // 放大镜
  const loupe = $("loupe"), inner = $("loupeInner"), Z = 2.6, R = 110;
  let lensOn = null, lensRect = null, lensPointer = null, lensFrame = null;
  const loupeEnabled = matchMedia("(min-width: 761px)");
  function hideLoupe() {
    if (lensFrame !== null) cancelAnimationFrame(lensFrame);
    lensFrame = lensPointer = lensOn = lensRect = null;
    loupe.classList.remove("on");
  }
  function paintLoupe() {
    lensFrame = null;
    const { win, x, y } = lensPointer;
    const rect = lensOn === win && lensRect ? lensRect : win.getBoundingClientRect();
    if (lensOn !== win) {
      lensOn = win; inner.innerHTML = "";
      const c = win.cloneNode(true); c.style.width = rect.width + "px"; c.style.height = rect.height + "px";
      c.querySelector("img").loading = "eager";
      inner.appendChild(c);
    }
    lensRect = rect;
    inner.style.transform = `translate(${R - 6 - (x - rect.left) * Z}px, ${R - 6 - (y - rect.top) * Z}px) scale(${Z})`;
    loupe.style.translate = `${x - R}px ${y - R}px`;
    loupe.classList.add("on");
  }
  $("sheet").addEventListener("pointermove", e => {
    const win = e.target.closest(".win");
    if (!win || e.pointerType !== "mouse" || !loupeEnabled.matches) { hideLoupe(); return; }
    lensPointer = { win, x: e.clientX, y: e.clientY };
    if (lensFrame === null) lensFrame = requestAnimationFrame(paintLoupe);
  });
  $("sheet").addEventListener("pointerleave", hideLoupe);
  addEventListener("scroll", () => { lensRect = null; }, { passive: true });
  addEventListener("resize", hideLoupe);

  /* ———————— 取景器 ———————— */
  const vf = $("vf");
  let cur = null, cover = false, lastFocus = null;

  function paintViewer(p) {
    const lit = navList(p), i = lit.indexOf(p);
    $("vfRoll").innerHTML = `<b>${esc(p.country)}</b>　${esc(p.city || "城市待补")}　▸ ${p.review ? "待审核 " : ""}第 ${ORD.get(p) + 1} 张`;
    $("vfFilt").textContent = p.review ? "只翻待审核的"
      : state.country || state.city || state.type !== "all"
      ? `只翻亮着的：${[state.city || state.country, state.type !== "all" && state.type].filter(Boolean).join(" · ")}` : "";
    $("vfTitle").textContent = p.title || "（未命名）";
    $("vfPlace").textContent = [[p.city, p.spot].filter(Boolean).join(" · "), when(p), p.type].filter(Boolean).join("　");
    $("vfCount").textContent = `${i >= 0 ? pad(i + 1) : "—"} / ${pad(lit.length)}`;
    $("vfS").textContent = p.s || "—";
    $("vfF").textContent = has(p.f) ? "F" + p.f : "—";
    $("vfIso").textContent = has(p.iso) ? p.iso : "—";
    $("vfMm").textContent = has(p.mm) ? p.mm + "mm" : "—";
    $("vfGear").innerHTML = [p.camera, p.lens].filter(Boolean).map(esc).join("<br>");
    const g = cityGeo(p);
    if (miniURL && projection && g) {
      const [x, y] = projection([g[1], g[0]]);
      $("vfMini").hidden = false;
      if ($("vfMiniImg").getAttribute("src") !== miniURL) $("vfMiniImg").src = miniURL;
      $("vfMiniDot").style.left = x / W * 100 + "%"; $("vfMiniDot").style.top = y / H * 100 + "%";
    } else $("vfMini").hidden = true;
  }

  let viewerTimer = null, focusTimer = null;
  function vfShow(p, animate = true) {
    clearTimeout(viewerTimer); clearTimeout(focusTimer);
    cur = p;
    const apply = () => {
      $("vfImg").src = fullSrc(p); $("vfImg").alt = [p.title, p.city, p.spot].filter(Boolean).join("，");
      $("vfImg").classList.toggle("cover", cover);
      $("vfBg").style.backgroundImage = `url("${thumbSrc(p)}")`;
      paintViewer(p);
      syncEditor();
    };
    if (!animate) return apply();
    const sh = $("vfShutter"); sh.classList.remove("fire"); void sh.offsetWidth; sh.classList.add("fire");
    $("vfAf").classList.remove("lock");
    viewerTimer = setTimeout(apply, 50);
    focusTimer = setTimeout(() => $("vfAf").classList.add("lock"), 380);
  }

  // 翻页只在亮着的照片里走；如果点开的是暗掉的那张，就跳到它前后最近的亮着的
  function step(dir) {
    const lit = navList(cur);
    if (!lit.length || !cur) return;
    const o = ORD.get(cur);
    const next = dir > 0
      ? lit.find(p => ORD.get(p) > o) || lit[0]
      : lit.findLast(p => ORD.get(p) < o) || lit.at(-1);
    if (next !== cur) vfShow(next);
  }

  function vfOpen(id) {
    lastFocus = document.activeElement;
    hideLoupe();
    vf.classList.add("open"); document.body.classList.add("lock");
    vfShow(byId(id));
    $("vfClose").focus();
  }
  function vfClose() {
    clearTimeout(viewerTimer); clearTimeout(focusTimer);
    vf.classList.remove("open"); document.body.classList.remove("lock");
    if (sheetDirty) { renderSheet(); applyFilter(); }
    const f = cur && frames.find(f => f.dataset.id === cur.id);
    if (f) { f.scrollIntoView({ block: "nearest" }); f.classList.remove("flash"); void f.offsetWidth; f.classList.add("flash"); }
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  $("sheet").addEventListener("click", e => { const w = e.target.closest(".win"); if (w) vfOpen(w.dataset.id); });
  $("vfClose").onclick = vfClose;
  $("vfPrev").onclick = () => step(-1);
  $("vfNext").onclick = () => step(1);
  addEventListener("keydown", e => {
    if (!vf.classList.contains("open")) return;
    if (e.target instanceof Element && e.target.matches("input, textarea, select")) { if (e.key === "Escape") e.target.blur(); return; }
    if (e.key === "Escape") vfClose();
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
    if (e.key.toLowerCase() === "f") { cover = !cover; $("vfImg").classList.toggle("cover", cover); }
  });
  let x0 = null;
  vf.addEventListener("touchstart", e => { x0 = e.target.closest(".ed") ? null : e.touches[0].clientX; }, { passive: true });
  vf.addEventListener("touchend", e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); x0 = null; });

  /* ———————— 编辑模式（临时）：只有用 tools/serve.py 打开时才有 ———————— */
  let editing = false;
  const ed = $("ed");

  function setEditing(on) {
    editing = on;
    $("editToggle").setAttribute("aria-pressed", on);
    try { localStorage.setItem("ignat-edit", on ? "1" : ""); } catch {}
    syncEditor();
  }
  // 待审核的照片不管编辑模式开没开，都带着编辑面板（要在面板里点「审核通过」）
  function syncEditor() {
    const on = editing || !!cur?.review;
    vf.classList.toggle("editing", on);
    ed.hidden = !on;
    if (on && cur && vf.classList.contains("open")) fillEditor(cur);
  }
  $("editToggle").onclick = () => setEditing(!editing);

  function chips(name, values, current, extra = "") {
    return values.map(v => `<label><input type="radio" name="${name}" value="${esc(v)}"${v === current ? " checked" : ""}><span>${esc(v)}</span></label>`).join("") + extra;
  }

  function fillEditor(p) {
    $("edFile").textContent = p.src.split("/").pop().replace(/\.webp$/, "");
    $("edReview").hidden = !p.review;
    $("edCity").innerHTML = chips("city", citiesOf(p.country), p.city, `<button type="button" id="edAddCity">＋ 新地点</button>`);
    $("edType").innerHTML = chips("type", TYPES, p.type);
    ed.querySelectorAll("[data-k]").forEach(el => {
      const v = p[el.dataset.k];
      if (el.type === "checkbox") el.checked = !!v;
      else el.value = has(v) ? v : "";
      el.classList.toggle("missing", el.type !== "checkbox" && !has(v) && el.dataset.k !== "spot");
    });
    const uniq = k => [...new Set(DB.photos.map(x => x[k]).filter(Boolean))];
    $("dlCamera").innerHTML = uniq("camera").map(v => `<option value="${esc(v)}">`).join("");
    $("dlLens").innerHTML = uniq("lens").map(v => `<option value="${esc(v)}">`).join("");
  }

  function readField(el) {
    if (el.type === "checkbox") return el.checked;
    const v = el.value.trim();
    if (el.dataset.num !== undefined) return v === "" || isNaN(Number(v)) ? null : Number(v);
    if (el.dataset.k === "taken") return v ? (v.length === 16 ? v + ":00" : v) : "";
    return v;
  }

  function edited(k, v) {
    LIT = null;
    cur[k] = v;
    if (["taken", "city", "country"].includes(k)) derive();
    if (["city", "type"].includes(k)) renderBar();
    paintViewer(cur);
    sheetDirty = true;
    scheduleSave();
  }

  ed.addEventListener("input", e => {
    const el = e.target;
    if (el.dataset.k && el.type !== "checkbox" && el.type !== "datetime-local") {
      el.classList.toggle("missing", el.value.trim() === "" && el.dataset.k !== "spot");
      edited(el.dataset.k, readField(el));
    }
  });
  ed.addEventListener("change", e => {
    const el = e.target;
    if (el.name === "city" || el.name === "type") return edited(el.name, el.value);
    if (el.dataset.k && (el.type === "checkbox" || el.type === "datetime-local")) {
      el.classList.toggle("missing", el.type !== "checkbox" && !el.value);
      edited(el.dataset.k, readField(el));
    }
  });
  // 审核通过：去掉 review 标记，并入作品；还有待审核的就接着翻下一张
  $("edApprove").onclick = () => {
    const i = PEND.indexOf(cur);
    delete cur.review;
    LIT = null;
    derive(); renderBar();
    sheetDirty = true;
    scheduleSave();
    if (PEND.length) vfShow(PEND[Math.min(i, PEND.length - 1)]);
    else { paintViewer(cur); syncEditor(); }
    status(`已通过，并入作品（还剩 ${PEND.length} 张待审核）`);
  };

  ed.addEventListener("click", e => {
    if (e.target.id !== "edAddCity") return;
    const name = (prompt(`在「${cur.country}」下面加一个新地点：`) || "").trim();
    if (!name) return;
    const meta = DB.countries[cur.country] ||= { en: "", iso: "", cities: [] };
    if (!meta.cities.some(c => c.name === name)) meta.cities.push({ name, en: "", lat: null, lon: null });
    edited("city", name);
    fillEditor(cur);
  });

  // 自动保存：停手 0.6 秒后把整份数据写回服务器
  let saveTimer = null, saveChain = Promise.resolve();
  const status = (msg, err = false) => { $("edStatus").textContent = msg; $("edStatus").classList.toggle("err", err); };
  function scheduleSave() {
    status("有改动，马上保存…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 600);
  }
  function saveNow() {
    const body = JSON.stringify(DB);
    saveChain = saveChain.then(async () => {
      try {
        const r = await fetch("/api/photos", { method: "PUT", headers: { "Content-Type": "application/json" }, body });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        status(`已保存 ✓ ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`);
      } catch (err) {
        status(`保存失败：${err.message}。请确认终端里的预览服务器还开着，再改一下任意一项重试。`, true);
      }
    });
  }
  addEventListener("beforeunload", e => { if (saveTimer) { e.preventDefault(); e.returnValue = ""; } });

  /* ———————— 启动 ———————— */
  (async () => {
    try {
      DB = await fetch("shared/photos.json", { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
    } catch {
      $("sheet").innerHTML = `<div class="empty">读不到 shared/photos.json。请用预览服务器打开（不要直接双击 html 文件）。</div>`;
      return;
    }
    derive();
    $("edgeYears").textContent = `IGNAT ATLAS ▸ ${years(ORDER)}`;
    $("edgeCount").textContent = `${COUNTRIES.length} ${COUNTRIES.length > 1 ? "COUNTRIES" : "COUNTRY"} / ${ORDER.length} EXP`;
    renderBar(); renderSheet();
    buildMap().catch(() => { $("mapLoading").textContent = "地图暂时无法加载，请刷新重试"; });
    // 只有本地编辑服务器有 /api/edit；部署成静态网站时这里会失败，编辑按钮保持隐藏
    fetch("/api/edit", { cache: "no-store" }).then(r => r.ok && r.json()).then(j => {
      if (!j || !j.ok) return;
      canEdit = true;
      $("editToggle").hidden = false;
      if (PEND.length) { renderSheet(); applyFilter(); }
      let saved = false; try { saved = localStorage.getItem("ignat-edit") === "1"; } catch {}
      setEditing(saved);
    }).catch(() => {});
  })();
