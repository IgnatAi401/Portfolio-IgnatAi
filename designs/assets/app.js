  const $ = id => document.getElementById(id);
  const t = I18N.t;
  const label = value => t(value || "");
  const countryLabel = name => I18N.language === "en" ? DB?.countries[name]?.en || label(name) : name;
  const cityLabel = (name, country) => I18N.language === "en"
    ? DB?.countries[country]?.cities?.find(c => c.name === name)?.en || label(name) : name;
  const photoTitle = p => label(p.title || "未命名");
  const photoAlt = p => [photoTitle(p), cityLabel(p.city, p.country), label(p.spot)].filter(Boolean).join(", ");
  const photoCount = count => t("photoCount", { count });
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
  const when = p => p.taken ? p.taken.slice(0, 16).replace("T", " ") : t("日期待补");
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
      return `<g class="ctry" data-country="${esc(c.name)}" tabindex="0" role="button" aria-label="${esc(countryLabel(c.name))}, ${photoCount(c.items.length)}">${hit}<path d="${path(g.feature)}"/></g>`;
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
      <h3>${esc(countryLabel(c.name))}${I18N.language === "zh" ? `<small>${esc(c.en)}</small>` : ""}</h3>
      <div class="meta">${years(c.items)} · ${t("人文")} ${st} · ${t("风景")} ${ls}</div>
      <div class="meta">${c.cities.map(city => esc(cityLabel(city, c.name))).join(" · ")}</div>
      <div class="thumbs">${show.map(p => `<img src="${esc(thumbSrc(p))}" alt="" decoding="async">`).join("")}</div>
      <div class="go">${t("点击跳到印样")}</div>`;
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
    else { $("tip").classList.remove("on"); $("edgeCoord").textContent = ""; }
  }

  const mapEl = $("map");
  mapEl.addEventListener("pointerover", e => { const t = e.target.closest(".ctry"); hover(t ? t.dataset.country : null); });
  mapEl.addEventListener("pointerleave", () => hover(null));
  mapEl.addEventListener("click", e => { const t = e.target.closest(".ctry"); if (t) pickCountry(t.dataset.country, true); });
  mapEl.addEventListener("focusout", () => hover(null));
  mapEl.addEventListener("focusin", e => { const t = e.target.closest(".ctry"); if (t) hover(t.dataset.country); });
  mapEl.addEventListener("keydown", e => { const t = e.target.closest(".ctry"); if (t && ["Enter", " "].includes(e.key)) { e.preventDefault(); pickCountry(t.dataset.country, true); } });

  /* ———————— 地区 + 类别筛选 ———————— */
  function renderBar() {
    $("rolls").innerHTML = `<button data-all aria-pressed="${!state.country}">${t("全部国家")}<small>${ORDER.length}</small></button>` +
      COUNTRIES.map(c => `<button data-country="${esc(c.name)}" aria-pressed="${state.country === c.name}">${esc(countryLabel(c.name))}<small>${c.items.length}</small></button>`).join("");
    paintBar();
  }
  function paintBar() {
    if (state.country && !COUNTRY_INFO.has(state.country)) state.country = state.city = null;
    const c = COUNTRY_INFO.get(state.country);
    if (state.city && !c?.items.some(p => p.city === state.city)) state.city = null;
    LIT = null;
    const count = list => list.filter(p => state.type === "all" || p.type === state.type).length;
    $("rolls").querySelectorAll("button").forEach(b => {
      b.setAttribute("aria-pressed", b.dataset.all !== undefined ? !state.country : state.country === b.dataset.country);
      b.querySelector("small").textContent = count(b.dataset.all !== undefined ? ORDER : COUNTRY_INFO.get(b.dataset.country)?.items || []);
    });
    $("cityRow").hidden = !c;
    const cityHTML = c ? `<button data-city="" aria-pressed="${!state.city}">${t("全部城市")}<small>${count(c.items)}</small></button>` +
      c.cities.filter(city => c.cityCounts.get(city) > 0).map(city => `<button data-city="${esc(city)}" aria-pressed="${state.city === city}">${esc(cityLabel(city, c.name))}<small>${count(c.items.filter(p => p.city === city))}</small></button>`).join("") : "";
    if ($("cities").innerHTML !== cityHTML) {
      const active = document.activeElement;
      const focusedCity = $("cities").contains(active) ? active.dataset.city : undefined;
      $("cities").innerHTML = cityHTML;
      if (focusedCity !== undefined) [...$("cities").querySelectorAll("button")].find(b => b.dataset.city === focusedCity)?.focus({ preventScroll: true });
    }
    regionButtons = [...$("rolls").querySelectorAll("button")];
    document.querySelectorAll("#toggle button").forEach(b => b.setAttribute("aria-pressed", b.dataset.type === state.type));
    $("filterSummary").textContent = `${[state.country ? countryLabel(state.country) : t("全部国家"), cityLabel(state.city, state.country), state.type !== "all" && t(state.type)].filter(Boolean).join(" · ")} · ${photoCount(litList().length)}`;
    $("filterReset").disabled = !state.country && !state.city && state.type === "all";
  }
  $("rolls").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    pickCountry(b.dataset.country || null, false);
  });
  $("cities").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    state.city = b.dataset.city || null;
    applyFilter();
  });
  $("rolls").addEventListener("pointerover", e => { const b = e.target.closest("button[data-country]"); state.hot = b ? b.dataset.country : null; paintMap(); });
  $("rolls").addEventListener("pointerleave", () => { state.hot = null; paintMap(); });

  function pickCountry(name, jump) {
    state.country = name; state.city = null;
    hover(null);
    applyFilter();
    if (jump) $("filters").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  $("toggle").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    state.type = b.dataset.type;
    applyFilter();
  });
  $("filterReset").addEventListener("click", () => {
    state.country = state.city = null; state.type = "all";
    hover(null);
    applyFilter();
    $("rolls").querySelector("[data-all]").focus({ preventScroll: true });
  });

  function applyFilter() {
    LIT = null;
    paintBar(); paintMap();
    renderSheet();
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
        <button class="win ${p.h > p.w ? "rot" : ""}" data-id="${esc(p.id)}" aria-label="${t("全屏看：")}${esc(photoTitle(p))}">
          <img src="${esc(thumbSrc(p))}" alt="${esc(photoTitle(p))}" width="${p.w}" height="${p.h}" loading="lazy" decoding="async" draggable="false">
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
      const cities = [...new Set(items.map(p => cityLabel(p.city, p.country) || t("城市待补")))].join(" / ");
      for (let k = 0; k < items.length; k += 6) {
        const tag = k ? "" : `<span class="roll-tag">${d ? d.replaceAll("-", ".") : t("日期待补")}　${esc(cities)}</span>`;
        strips.push(`<div class="strip">${tag}${items.slice(k, k + 6).map(frameHTML).join("")}</div>`);
      }
      i = j;
    }
    return strips.join("");
  }

  function renderSheet() {
    const list = litList();
    const nCity = new Set(list.filter(p => p.city).map(p => `${p.country}/${p.city}`)).size;
    const pending = canEdit && PEND.length ? `
      <section class="pending" aria-label="${t("待审核")}">
        <div class="sheet-head">
          <h2>${t("待审核")}<small>${t("pendingCount", { count: PEND.length })}</small></h2>
          <span class="note">${t("点开一张，在右侧核对信息，再点「审核通过」")}</span>
        </div>
        <div class="strips">${stripsHTML(PEND)}</div>
      </section>` : "";
    $("sheet").innerHTML = pending + `
      <div class="sheet-head">
        <h2>Proof ${years(list)}<small>${t("proofCount", { cities: nCity, count: list.length })}</small></h2>

      </div>
      <div class="strips">${list.length ? stripsHTML(list) : `<div class="empty">${t("当前条件下没有照片，可切换类别、城市或重置筛选。")}</div>`}</div>`;
    frames = [...$("sheet").querySelectorAll(".frame[data-id]")];
    hideLoupe();
    sheetDirty = false;
  }
  let sheetDirty = false;

  // 放大镜
  const loupe = $("loupe"), inner = $("loupeInner"), Z = 2.6, R = 110;
  let lensOn = null, lensRect = null, lensPointer = null, lensFrame = null, lensPausedUntil = 0;
  const loupeEnabled = matchMedia("(min-width: 761px)");
  function hideLoupe() {
    if (lensFrame !== null) cancelAnimationFrame(lensFrame);
    lensFrame = lensPointer = lensOn = lensRect = null;
    loupe.classList.remove("on");
    inner.replaceChildren();
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
    if (!win || e.pointerType !== "mouse" || !loupeEnabled.matches || performance.now() < lensPausedUntil) { hideLoupe(); return; }
    lensPointer = { win, x: e.clientX, y: e.clientY };
    if (lensFrame === null) lensFrame = requestAnimationFrame(paintLoupe);
  });
  $("sheet").addEventListener("pointerleave", hideLoupe);
  addEventListener("scroll", () => {
    lensPausedUntil = performance.now() + 150;
    if (lensOn || lensFrame !== null) hideLoupe();
  }, { passive: true });
  addEventListener("resize", hideLoupe);

  /* ———————— 取景器 ———————— */
  const vf = $("vf");
  let cur = null, cover = false, lastFocus = null;
  // 底部信息栏高度随内容变化，量出来给取景框四角和照片留位置，免得压到文字。
  new ResizeObserver(([e]) => vf.style.setProperty("--lcd", Math.ceil(e.borderBoxSize?.[0]?.blockSize ?? e.target.offsetHeight) + "px"))
    .observe(vf.querySelector(".lcd"));

  function paintViewer(p) {
    const lit = navList(p), i = lit.indexOf(p);
    $("vfRoll").innerHTML = `<b>${esc(countryLabel(p.country))}</b>　${esc(cityLabel(p.city, p.country) || t("城市待补"))}　▸ ${t("frameNumber", { pending: p.review ? t("待审核") + (I18N.language === "en" ? " · " : " ") : "", number: ORD.get(p) + 1 })}`;
    $("vfFilt").textContent = p.review ? t("只翻待审核的")
      : state.country || state.city || state.type !== "all"
      ? `${t("当前筛选：")}${[state.city ? cityLabel(state.city, state.country) : countryLabel(state.country), state.type !== "all" && t(state.type)].filter(Boolean).join(" · ")}` : "";
    $("vfTitle").textContent = photoTitle(p);
    $("vfPlace").textContent = [[cityLabel(p.city, p.country), label(p.spot)].filter(Boolean).join(" · "), when(p), label(p.type)].filter(Boolean).join("　");
    $("vfCount").textContent = `${i >= 0 ? pad(i + 1) : "—"} / ${pad(lit.length)}`;
    $("vfS").textContent = p.s || "—";
    $("vfF").textContent = has(p.f) ? "F" + p.f : "—";
    $("vfIso").textContent = has(p.iso) ? p.iso : "—";
    $("vfMm").textContent = has(p.mm) ? p.mm + "mm" : "—";
    $("vfGear").innerHTML = [p.camera, p.lens].filter(Boolean).map(value => esc(label(value))).join("<br>");
    const g = cityGeo(p);
    if (miniURL && projection && g) {
      const [x, y] = projection([g[1], g[0]]);
      $("vfMini").hidden = false;
      if ($("vfMiniImg").getAttribute("src") !== miniURL) $("vfMiniImg").src = miniURL;
      $("vfMiniDot").style.left = x / W * 100 + "%"; $("vfMiniDot").style.top = y / H * 100 + "%";
    } else $("vfMini").hidden = true;
  }

  let viewerRequest = 0, viewerLoadTimer = null, viewerImages = [];
  function cancelViewerLoad() {
    viewerRequest++;
    clearTimeout(viewerLoadTimer);
    viewerLoadTimer = null;
    // 中断已过期的下载/解码，不把离屏大图一直留在内存里。
    viewerImages.forEach(img => { if (!img.isConnected) img.removeAttribute("src"); });
    viewerImages = [];
  }
  function clearViewerImages() {
    for (const id of ["vfPreview", "vfImg"]) {
      const img = $(id);
      img.hidden = true;
      img.removeAttribute("src");
      img.alt = "";
    }
    $("vfBg").style.backgroundImage = "";
  }
  function viewerStatus(text, retry = false) {
    $("vfStatus").hidden = !text;
    $("vfLoadText").dataset.i18n = text;
    $("vfLoadText").textContent = t(text);
    $("vfRetry").hidden = !retry;
  }
  function mountViewerImage(img, id, p) {
    img.id = id;
    img.className = "photo";
    img.classList.toggle("cover", cover);
    img.alt = photoAlt(p);
    img.width = p.w; img.height = p.h;
    img.draggable = false;
    // 放进来的就是已经解码的节点，避免再次改 src 时出现旧图或空白帧。
    $(id).replaceWith(img);
  }
  function vfShow(p) {
    if (!p) return;
    cancelViewerLoad();
    cur = p;
    clearViewerImages();
    paintViewer(p);
    syncEditor();
    $("vfAf").classList.remove("lock");
    vf.setAttribute("aria-busy", "true");
    viewerStatus("正在加载照片……");

    const request = viewerRequest;
    const current = () => request === viewerRequest && vf.classList.contains("open");
    const preview = new Image(), full = new Image();
    preview.decoding = full.decoding = "async";
    full.fetchPriority = "high";
    viewerImages = [preview, full];
    let fullSettled = false;
    const failed = () => {
      if (!current() || fullSettled) return;
      fullSettled = true;
      clearTimeout(viewerLoadTimer);
      viewerLoadTimer = null;
      full.removeAttribute("src");
      vf.setAttribute("aria-busy", "false");
      viewerStatus($("vfPreview").hidden ? "照片加载失败" : "大图加载失败，暂时显示预览", true);
    };
    viewerLoadTimer = setTimeout(failed, 20000);

    // 当前照片的小图先垫底；大图和小图使用同一个固定取景区域。
    preview.src = thumbSrc(p);
    preview.decode().then(() => {
      if (!current() || (fullSettled && !$("vfImg").hidden)) return;
      mountViewerImage(preview, "vfPreview", p);
      $("vfBg").style.backgroundImage = `url("${thumbSrc(p)}")`;
      viewerStatus(fullSettled ? "大图加载失败，暂时显示预览" : "正在加载大图……", fullSettled);
    }).catch(() => {});

    full.src = fullSrc(p);
    full.decode().then(() => {
      if (!current() || fullSettled) return;
      fullSettled = true;
      clearTimeout(viewerLoadTimer);
      viewerLoadTimer = null;
      mountViewerImage(full, "vfImg", p);
      $("vfPreview").hidden = true;
      $("vfPreview").removeAttribute("src");
      $("vfAf").classList.add("lock");
      vf.setAttribute("aria-busy", "false");
      viewerStatus("");
    }).catch(failed);
  }

  // 只在当前筛选结果里翻页；编辑后不再匹配时，跳到前后最近的结果
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
    const p = byId(id); if (!p) return;
    lastFocus = document.activeElement;
    hideLoupe();
    vf.classList.add("open"); document.body.classList.add("lock");
    vf.setAttribute("aria-hidden", "false");
    vfShow(p);
    $("vfClose").focus({ preventScroll: true });
  }
  function vfClose() {
    cancelViewerLoad();
    vf.classList.remove("open"); document.body.classList.remove("lock");
    vf.setAttribute("aria-hidden", "true");
    vf.setAttribute("aria-busy", "false");
    clearViewerImages();
    viewerStatus("");
    if (sheetDirty) applyFilter();
    const f = cur && frames.find(f => f.dataset.id === cur.id);
    if (f) { f.scrollIntoView({ block: "nearest", behavior: "instant" }); f.classList.remove("flash"); void f.offsetWidth; f.classList.add("flash"); }
    const focus = f?.querySelector(".win") || lastFocus;
    if (focus && document.contains(focus)) focus.focus({ preventScroll: true });
  }

  $("sheet").addEventListener("click", e => { const w = e.target.closest(".win"); if (w) vfOpen(w.dataset.id); });
  $("vfClose").onclick = vfClose;
  $("vfPrev").onclick = () => step(-1);
  $("vfNext").onclick = () => step(1);
  $("vfRetry").onclick = () => vfShow(cur);
  addEventListener("keydown", e => {
    if (!vf.classList.contains("open")) return;
    if (e.target instanceof Element && e.target.matches("input, textarea, select")) { if (e.key === "Escape") e.target.blur(); return; }
    if (e.key === "Escape") { e.preventDefault(); vfClose(); }
    if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    if (e.key.toLowerCase() === "f") {
      e.preventDefault();
      cover = !cover;
      for (const id of ["vfPreview", "vfImg"]) $(id).classList.toggle("cover", cover);
    }
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
    return values.map(v => `<label><input type="radio" name="${name}" value="${esc(v)}"${v === current ? " checked" : ""}><span>${esc(name === "city" ? cityLabel(v, cur.country) : label(v))}</span></label>`).join("") + extra;
  }

  function fillEditor(p) {
    $("edFile").textContent = p.src.split("/").pop().replace(/\.webp$/, "");
    $("edReview").hidden = !p.review;
    $("edCity").innerHTML = chips("city", citiesOf(p.country), p.city, `<button type="button" id="edAddCity">${t("＋ 新地点")}</button>`);
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
    status(t("approved", { count: PEND.length }));
  };

  ed.addEventListener("click", e => {
    if (e.target.id !== "edAddCity") return;
    const name = (prompt(t("addCity", { country: countryLabel(cur.country) })) || "").trim();
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
    status(t("有改动，马上保存…"));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 600);
  }
  function saveNow() {
    const body = JSON.stringify(DB);
    saveChain = saveChain.then(async () => {
      try {
        const r = await fetch("/api/photos", { method: "PUT", headers: { "Content-Type": "application/json" }, body });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        status(t("saved", { time: new Date().toLocaleTimeString(I18N.language === "en" ? "en-GB" : "zh-CN", { hour12: false }) }));
      } catch (err) {
        status(t("saveFailed", { error: err.message }), true);
      }
    });
  }
  addEventListener("beforeunload", e => { if (saveTimer) { e.preventDefault(); e.returnValue = ""; } });

  // Repaint labels only; preserve filters, the current photo and source data.
  $("languageToggle").addEventListener("click", () => {
    I18N.toggle();
    if (!DB) return;
    renderBar(); renderSheet(); paintMap();
    mapCountries.forEach(el => {
      const c = COUNTRY_INFO.get(el.dataset.country);
      if (c) el.setAttribute("aria-label", `${countryLabel(c.name)}, ${photoCount(c.items.length)}`);
    });
    if (state.hot) showTip(state.hot);
    if (cur && vf.classList.contains("open")) {
      paintViewer(cur);
      for (const id of ["vfPreview", "vfImg"]) $(id).alt = photoAlt(cur);
      syncEditor();
    }
  });
  I18N.apply();

  /* ———————— 启动 ———————— */
  (async () => {
    try {
      DB = await fetch("shared/photos.json", { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
    } catch {
      $("sheet").innerHTML = `<div class="empty" data-i18n="读不到 shared/photos.json。请用预览服务器打开（不要直接双击 html 文件）。">${t("读不到 shared/photos.json。请用预览服务器打开（不要直接双击 html 文件）。")}</div>`;
      return;
    }
    derive();
    $("edgeYears").textContent = `IGNAT ATLAS ▸ ${years(ORDER)}`;
    $("edgeCount").textContent = `${COUNTRIES.length} ${COUNTRIES.length > 1 ? "COUNTRIES" : "COUNTRY"} / ${ORDER.length} EXP`;
    renderBar(); renderSheet();
    buildMap().catch(() => { const el = $("mapLoading"); if (el) { el.dataset.i18n = "地图暂时无法加载，请刷新重试"; el.textContent = t(el.dataset.i18n); } });
    // 只有本地编辑服务器有 /api/edit；部署成静态网站时这里会失败，编辑按钮保持隐藏
    fetch("/api/edit", { cache: "no-store" }).then(r => r.ok && r.json()).then(j => {
      if (!j || !j.ok) return;
      canEdit = true;
      $("editToggle").hidden = false;
      if (PEND.length) applyFilter();
      let saved = false; try { saved = localStorage.getItem("ignat-edit") === "1"; } catch {}
      setEditing(saved);
    }).catch(() => {});
  })();
