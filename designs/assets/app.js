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
  const midSrc = p => `photos/mid/${p.src}`;
  const liveSrc = p => `photos/live/${p.live}`;
  const LIVE_BADGE = `<span class="lbadge" aria-hidden="true">LIVE</span>`;
  const TYPES = ["人文", "风景"];
  const state = { country: null, city: null, type: "all", hot: null, view: "work" };
  // 「作品」和「故事」共用地图和国家/城市筛选，只换下面的主体；用网址 #stories 区分
  const storyMode = () => state.view === "stories";

  let DB = null, ORDER = [], PEND = [], ORD = new Map(), COUNTRIES = [], STORIES = [];
  let PHOTOS = new Map(), COUNTRY_PHOTOS = new Map(), COUNTRY_INFO = new Map();
  let LIT = null, frames = [], regionButtons = [], mapCountries = [];
  let MEDIA = new Map();  // 故事里的图：id 形如 story-01#0
  const byId = id => PHOTOS.get(id) || MEDIA.get(id);
  const isLit = p => (!state.country || p.country === state.country) && (!state.city || p.city === state.city) && (state.type === "all" || p.type === state.type);
  const litList = () => LIT ||= ORDER.filter(isLit);
  // 待审核的照片（review: true）单独一栏，只在本地编辑服务器下出现；审核通过后才进入作品、地图和筛选
  let canEdit = false;
  // 故事里的图只在这篇故事里翻
  const navList = p => p?.story ? p.story.media : p?.review ? PEND : litList();
  const storyOf = (country, city) => STORIES.filter(s => (!country || s.country === country) && (!city || s.city === city));
  const storyText = (s, k) => I18N.language === "en" && s[k + "En"] || s[k];
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
    const ns = storyOf(c.name).length;
    const show = [...c.items.filter(p => p.pick), ...c.items.filter(p => !p.pick)].slice(0, 3);
    tip.innerHTML = `
      <div class="h"><span>${esc(c.en.toUpperCase())}</span><span>${c.items.length} EXP</span></div>
      <h3>${esc(countryLabel(c.name))}${I18N.language === "zh" ? `<small>${esc(c.en)}</small>` : ""}</h3>
      <div class="meta">${years(c.items)} · ${storyMode() ? t("storyCount", { count: ns }) : `${t("人文")} ${st} · ${t("风景")} ${ls}`}</div>
      <div class="meta">${c.cities.map(city => esc(cityLabel(city, c.name))).join(" · ")}</div>
      <div class="thumbs">${show.map(p => `<img src="${esc(thumbSrc(p))}" alt="" decoding="async">`).join("")}</div>
      <div class="go">${t(storyMode() ? "点击看这里的故事" : "点击跳到印样")}</div>`;
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
    // 作品页数照片（受类别筛选），故事页数故事
    const count = (country, city) => storyMode() ? storyOf(country, city).length
      : (country ? COUNTRY_INFO.get(country)?.items || [] : ORDER).filter(p => (!city || p.city === city) && (state.type === "all" || p.type === state.type)).length;
    $("rolls").querySelectorAll("button").forEach(b => {
      const all = b.dataset.all !== undefined, n = count(all ? null : b.dataset.country);
      b.setAttribute("aria-pressed", all ? !state.country : state.country === b.dataset.country);
      b.querySelector("small").textContent = n;
      b.classList.toggle("none", !n);
    });
    $("cityRow").hidden = !c;
    const cityHTML = c ? `<button data-city="" aria-pressed="${!state.city}">${t("全部城市")}<small>${count(c.name)}</small></button>` +
      c.cities.filter(city => c.cityCounts.get(city) > 0).map(city => {
        const n = count(c.name, city);
        return `<button data-city="${esc(city)}" aria-pressed="${state.city === city}"${n ? "" : ' class="none"'}>${esc(cityLabel(city, c.name))}<small>${n}</small></button>`;
      }).join("") : "";
    if ($("cities").innerHTML !== cityHTML) {
      const active = document.activeElement;
      const focusedCity = $("cities").contains(active) ? active.dataset.city : undefined;
      $("cities").innerHTML = cityHTML;
      if (focusedCity !== undefined) [...$("cities").querySelectorAll("button")].find(b => b.dataset.city === focusedCity)?.focus({ preventScroll: true });
    }
    regionButtons = [...$("rolls").querySelectorAll("button")];
    document.querySelectorAll("#toggle button").forEach(b => b.setAttribute("aria-pressed", b.dataset.type === state.type));
    const story = storyMode();
    $("typeLabel").hidden = $("toggle").hidden = story;
    $("filterSummary").textContent = `${[state.country ? countryLabel(state.country) : t("全部国家"), cityLabel(state.city, state.country), !story && state.type !== "all" && t(state.type)].filter(Boolean).join(" · ")} · ${story ? t("storyCount", { count: count(state.country, state.city) }) : photoCount(litList().length)}`;
    $("filterReset").disabled = !state.country && !state.city && (story || state.type === "all");
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
    state.country = state.city = null;
    if (!storyMode()) state.type = "all";
    hover(null);
    applyFilter();
    $("rolls").querySelector("[data-all]").focus({ preventScroll: true });
  });

  function applyFilter() {
    LIT = null;
    paintBar(); paintMap();
    renderMain();
  }
  const renderMain = () => storyMode() ? renderStories() : renderSheet();

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
    return strips;
  }

  let sheetObserver = null, appendSheetBatch = null;
  function renderSheet() {
    sheetObserver?.disconnect();
    appendSheetBatch = null;
    const list = litList();
    const nCity = new Set(list.filter(p => p.city).map(p => `${p.country}/${p.city}`)).size;
    const pending = canEdit && PEND.length ? `
      <section class="pending" aria-label="${t("待审核")}">
        <div class="sheet-head">
          <h2>${t("待审核")}<small>${t("pendingCount", { count: PEND.length })}</small></h2>
          <span class="note">${t("点开一张，在右侧核对信息，再点「审核通过」")}</span>
        </div>
        <div class="strips">${stripsHTML(PEND).join("")}</div>
      </section>` : "";
    $("sheet").innerHTML = pending + `
      <div class="sheet-head">
        <h2>Proof ${years(list)}<small>${t("proofCount", { cities: nCity, count: list.length })}</small></h2>

      </div>
      <div class="strips">${list.length ? "" : `<div class="empty">${t("当前条件下没有照片，可切换类别、城市或重置筛选。")}</div>`}</div>`;
    const strips = stripsHTML(list);
    const container = $("sheet").lastElementChild;
    const sentinel = document.createElement("button");
    sentinel.type = "button";
    sentinel.textContent = I18N.language === "en" ? "Load more" : "加载更多";
    sentinel.className = "sheet-more";
    let offset = 0;
    appendSheetBatch = () => {
      container.insertAdjacentHTML("beforeend", strips.slice(offset, offset + 8).join(""));
      offset += 8;
      frames = [...$("sheet").querySelectorAll(".frame[data-id]")];
      if (offset >= strips.length) { sentinel.remove(); sheetObserver?.disconnect(); appendSheetBatch = null; }
    };
    appendSheetBatch();
    if (appendSheetBatch) {
      container.after(sentinel);
      sentinel.addEventListener("click", () => appendSheetBatch?.());
      sheetObserver = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) {
          appendSheetBatch?.();
          // Reobserve after layout so short batches continue filling the viewport.
          if (sentinel.isConnected) { sheetObserver.unobserve(sentinel); requestAnimationFrame(() => { if (sentinel.isConnected) sheetObserver?.observe(sentinel); }); }
        }
      }, { rootMargin: "800px" });
      sheetObserver.observe(sentinel);
    }
    hideLoupe();
    sheetDirty = false;
  }
  let sheetDirty = false;

  /* ———————— 实况照片：只在故事页播放（故事卡片 + 从故事打开的全屏看图） ———————— */
  // 播放时视频盖在静态图上淡入，播完或停止后淡回静态图
  function playLive(box, p, ref) {
    let v = box.querySelector("video.live-clip");
    if (!v) {
      v = document.createElement("video");
      v.className = "live-clip";
      v.muted = v.playsInline = true;
      v.preload = "auto";
      v.setAttribute("aria-hidden", "true");
      v.addEventListener("playing", () => box.classList.add("playing"));
      v.addEventListener("ended", () => box.classList.remove("playing"));
      v.addEventListener("error", () => box.classList.remove("playing"));
      ref ? ref.after(v) : box.append(v);
    }
    if (v.getAttribute("src") !== liveSrc(p)) v.src = liveSrc(p);
    v.currentTime = 0;
    v.play().catch(() => box.classList.remove("playing"));
  }
  function stopLive(box) {
    box.classList.remove("playing");
    box.querySelector("video.live-clip")?.pause();
  }
  // 故事卡片：鼠标移上去播放一遍，移开停下；触屏点开全屏后自动播放
  $("sheet").addEventListener("pointerover", e => {
    const b = e.target.closest?.(".story .shot.live");
    if (b && e.pointerType === "mouse" && !b.contains(e.relatedTarget)) playLive(b, byId(b.dataset.photo));
  });
  $("sheet").addEventListener("pointerout", e => {
    const b = e.target.closest?.(".story .shot.live");
    if (b && !b.contains(e.relatedTarget)) stopLive(b);
  });

  /* ———————— 故事：一篇一张卡片，按日期从新到旧，瀑布流排列 ———————— */
  // 故事里的每张图都包成独立对象：可以引用作品照片（photo），也可以是故事自己的随手拍（src）。
  // 故事页只讲经过，不带拍摄参数，也不进作品、地图和筛选的计数。
  // raw 是 stories.json 里的原始数据，编辑模式改完整份写回；页面用的对象通过 raw 指回原数据
  let STORY_RAW = [];
  function buildStories(raw) {
    MEDIA = new Map();
    STORY_RAW = raw;
    STORIES = raw.map(src => {
      const s = { ...src, raw: src };
      s.media = (src.media || []).map((m, i) => {
        const base = m.photo ? PHOTOS.get(m.photo) : m.src ? m : null;
        if (!base) return null;
        const item = {
          id: `${s.id}#${i}`, src: base.src, w: base.w, h: base.h, live: base.live || "",
          title: m.caption || "", titleEn: m.captionEn || "", spot: m.spot || "",
          country: s.country, city: s.city, taken: m.taken || base.taken || "", story: s, raw: m,
        };
        MEDIA.set(item.id, item);
        return item;
      }).filter(Boolean);
      return s;
    });
  }
  const caption = p => I18N.language === "en" && p.titleEn || p.title;

  // 每行几张：数据里写了 layout（如 [1, 3]）就照着排，否则按张数自动排；放不下的在最后一张上标 +N
  // 卡片只是预览：layout 只取开头几行（合计不超过 CARD_MAX 张），长故事的整套排版留给阅读页
  const CARD_MAX = 5;
  const autoRows = n => n <= 2 ? [n] : n === 3 ? [1, 2] : n === 4 ? [2, 2] : [2, 3];
  function cardRows(layout) {
    const rows = [];
    let sum = 0;
    for (const n of layout) {
      if (rows.length && sum + n > CARD_MAX) break;
      rows.push(n); sum += n;
    }
    return rows;
  }
  function mediaHTML(s) {
    const items = s.media;
    if (!items.length) return "";
    const rows = s.layout?.length ? cardRows(s.layout) : autoRows(items.length);
    const shown = Math.min(items.length, rows.reduce((a, b) => a + b, 0));
    let k = 0;
    return `<div class="smedia">${rows.map(n => {
      const row = items.slice(k, Math.min(k + n, shown)); k += n;
      if (!row.length) return "";
      // 同一行按宽高比分宽度，整行等高；单张一行时限制得别太高或太扁
      return `<div class="srow${row.length > 2 ? " dense" : ""}">${row.map(p => {
        const lo = row.length === 1 ? .8 : .6, ratio = Math.min(2.4, Math.max(lo, p.w / p.h || 1.5)).toFixed(3);
        const rest = p === items[shown - 1] && items.length > shown ? `<span class="srest">+${items.length - shown}</span>` : "";
        const name = caption(p) || storyText(s, "title");
        return `<button class="shot${p.live ? " live" : ""}" style="--r:${ratio}" data-photo="${esc(p.id)}" aria-label="${t("全屏看：")}${esc(name)}"><img src="${esc(thumbSrc(p))}" alt="${esc(name)}" loading="lazy" decoding="async" draggable="false">${p.live ? LIVE_BADGE : ""}${rest}</button>`;
      }).join("")}</div>`;
    }).join("")}</div>`;
  }
  function storyCardHTML(s, i) {
    const date = (s.date || "").replaceAll("-", ".");
    const place = [countryLabel(s.country), cityLabel(s.city, s.country)].filter(Boolean).join(" · ");
    const text = storyText(s, "text").replace(/^\[图\]$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
    return `
      <article class="story${s.media.length ? "" : " textonly"}" data-i="${i}" data-story="${esc(s.id)}">
        <div class="sedge"><span>${esc(date)}</span><span>${esc(place)}</span></div>
        ${mediaHTML(s)}
        <div class="sbody">
          ${s.placeholder ? `<span class="sflag">${t("占位")}</span>` : ""}
          <h3><a href="#stories/${encodeURIComponent(s.id)}" class="slink">${esc(storyText(s, "title"))}</a></h3>
          ${text ? `<p>${esc(text)}</p>` : ""}
          <div class="sfoot"><span>${s.media.length ? photoCount(s.media.length) : ""}</span><span class="smore" aria-hidden="true">${t("阅读全文")} →</span></div>
        </div>
      </article>`;
  }
  // 按日期从新到旧
  const storyList = () => storyOf(state.country, state.city).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  function renderStories() {
    sheetObserver?.disconnect();
    appendSheetBatch = null;
    const list = storyList();
    $("sheet").innerHTML = `
      <div class="sheet-head">
        <h2>Stories<small>${t("storyCount", { count: list.length })}</small></h2>
      </div>
      ${list.length ? `<div class="stories">${list.map(storyCardHTML).join("")}</div>`
        : `<div class="empty">${t("这里还没有故事，换个国家或城市看看。")}</div>`}`;
    frames = [];
    hideLoupe();
    sheetDirty = false;
    storyCols = 0;
    layoutStories();
  }

  // 瀑布流：卡片按顺序放进当前最矮的一列。图片都写了宽高比，不用等加载完就能量出高度；列数变了才重排
  const STORY_MIN = 300, STORY_GAP = 22;
  let storyCols = 0;
  function layoutStories() {
    const box = $("sheet").querySelector(".stories");
    if (!box) return;
    const n = Math.max(1, Math.min(4, Math.floor((box.clientWidth + STORY_GAP) / (STORY_MIN + STORY_GAP))));
    if (n === storyCols) return;
    storyCols = n;
    const cards = [...box.querySelectorAll(".story")].sort((a, b) => a.dataset.i - b.dataset.i);
    const cols = Array.from({ length: n }, () => Object.assign(document.createElement("div"), { className: "scol" }));
    box.replaceChildren(...cols);
    const heights = cols.map(() => 0);
    cards.forEach(card => {
      const i = heights.indexOf(Math.min(...heights));
      cols[i].append(card);
      heights[i] += card.offsetHeight + STORY_GAP;
    });
  }
  addEventListener("resize", layoutStories);

  /* ———————— 故事阅读页：点开卡片看全文和全部图片；网址 #stories/<故事id> 可以直接分享 ———————— */
  const rd = $("rd");
  let rdStory = null, rdPushed = false;
  // 阅读页里的图：按顺序拼成一行行，每行和正文一样宽。一行最多两张横图、三张竖图，或一横一竖；
  // 数据里写了 layout 就照着分
  const isWide = p => (p.w / p.h || 1.5) >= 1.1;
  const rowFits = row => {
    const L = row.filter(isWide).length, P = row.length - L;
    return L === 0 ? P <= 3 : L === 1 ? P <= 1 : L === 2 && P === 0;
  };
  function readerRows(items, layout) {
    if (layout?.length) {
      const rows = []; let k = 0;
      for (const n of layout) { if (k < items.length) rows.push(items.slice(k, k += n)); }
      if (k < items.length) rows.push(...readerRows(items.slice(k)));
      return rows;
    }
    const rows = [];
    let row = [];
    for (const p of items) {
      if (row.length && !rowFits([...row, p])) { rows.push(row); row = []; }
      row.push(p);
    }
    if (row.length) rows.push(row);
    // 最后落单一张竖图：上一行末尾也是竖图就借过来凑成两张（三竖变两竖+两竖，一横一竖变横图单独一行+两竖）
    const last = rows.at(-1), prev = rows.at(-2);
    if (prev && last.length === 1 && !isWide(last[0]) && !isWide(prev.at(-1))) last.unshift(prev.pop());
    return rows;
  }
  function readerHTML(s) {
    const list = storyList(), i = list.indexOf(s);
    const prev = i > 0 ? list[i - 1] : null, next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
    const date = (s.date || "").replaceAll("-", ".");
    const place = [countryLabel(s.country), cityLabel(s.city, s.country)].filter(Boolean).join(" · ");
    const body = storyText(s, "text");
    const paras = body.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
    // 编辑模式：标题、正文、配图标题都换成输入框，和照片编辑一样改的是中文原文
    const ed = canEdit && editing;
    const n = s.media.length;
    const cap = p => {
      if (ed) return `<input class="rd-in rd-cap" data-mi="${s.media.indexOf(p)}" value="${esc(p.title)}" placeholder="${t("配图标题（可留空）")}">`;
      return caption(p) ? `<figcaption>${esc(caption(p))}</figcaption>` : "";
    };
    const shot = (p, full) => {
      const name = caption(p) || storyText(s, "title");
      return `<button class="shot${p.live ? " live" : ""}" data-photo="${esc(p.id)}" aria-label="${t("全屏看：")}${esc(name)}"><img src="${esc(thumbSrc(p))}"${full ? ` data-mid="${esc(midSrc(p))}"` : ""} alt="${esc(name)}" loading="lazy" decoding="async" draggable="false" width="${p.w}" height="${p.h}">${p.live ? LIVE_BADGE : ""}</button>`;
    };
    const ratio = p => p.w / p.h || 1.5;
    // --rs 是整行的宽高比之和，CSS 用它限制整行别比一屏还高
    const rowHTML = (row, extra = "") => `<div class="rd-row${extra}" style="--rs:${row.reduce((a, p) => a + ratio(p), 0).toFixed(3)}">${row.map(p =>
      `<figure style="--r:${ratio(p).toFixed(3)}">${shot(p, true)}${cap(p)}</figure>`).join("")}</div>`;

    // 排版：文字为主。照片拼成的胶片条均匀插在段落之间，最多每两段一条，让大部分段落连着读；
    // 插不下的：剩一行就接在正文后面，多了用一条虚线隔开，排在正文之后
    const rows = readerRows(s.media, s.layout);
    let flow = "", more = "";
    if (ed) {
      flow = `<textarea class="rd-in rd-body" data-sk="text" rows="6" placeholder="${t("正文：空一行分段")}">${esc(s.text || "")}</textarea>
        <div class="ed-s" id="rdStatus" role="status">${esc(storyStatus.msg)}</div>
        ${rows.map(r => rowHTML(r)).join("")}`;
    } else if (paras.includes("[图]")) {
      // 正文里单独一段写 [图]，就在那里放下一行图（一行几张看 layout），图文就能对上；多出来的图排在最后
      let k = 0;
      flow = paras.map(x => x === "[图]" ? (rows[k] ? rowHTML(rows[k++]) : "") : `<p>${esc(x)}</p>`).join("");
      const left = rows.slice(k);
      if (left.length) more = `<section class="rd-more"><div class="rd-sec" aria-hidden="true"></div>${left.map(r => rowHTML(r)).join("")}</section>`;
    } else {
      const gaps = Math.max(0, paras.length - 1);
      const stops = Math.min(rows.length, Math.ceil(gaps / 2));
      const at = new Map();
      for (let j = 0; j < stops; j++) {
        let k = Math.min(gaps, Math.max(1, Math.round((j + 1) * paras.length / (stops + 1))));
        while (at.has(k) && k < gaps) k++;
        if (!at.has(k)) at.set(k, rows[at.size]);
      }
      flow = paras.map((x, k) => `<p>${esc(x)}</p>${at.has(k + 1) ? rowHTML(at.get(k + 1)) : ""}`).join("");
      const left = rows.slice(at.size);
      if (left.length === 1) flow += rowHTML(left[0]);
      else if (left.length) {
        more = `<section class="rd-more">
          <div class="rd-sec" aria-hidden="true"></div>
          ${left.map(r => rowHTML(r)).join("")}
        </section>`;
      }
    }
    const navBtn = (x, dir) => {
      if (!x) return "<span></span>";
      const c = x.media[0];
      return `<button class="rd-go ${dir}" data-story="${esc(x.id)}">${c ? `<img src="${esc(thumbSrc(c))}" alt="" loading="lazy" decoding="async">` : ""}<span><small>${t(dir === "prev" ? "上一篇" : "下一篇")}</small><b>${esc(storyText(x, "title"))}</b><em>${esc((x.date || "").replaceAll("-", "."))}　${esc([countryLabel(x.country), cityLabel(x.city, x.country)].filter(Boolean).join(" · "))}</em></span></button>`;
    };
    return `
      <div class="rd-bar"><button class="rd-back" id="rdClose">← ${t("返回故事")}</button><span class="rd-where"><span>${esc(date)}　${esc(place)}</span><b>${esc(storyText(s, "title"))}</b></span><span class="rd-tools">${canEdit ? `<button class="rd-edit" id="rdEdit" aria-pressed="${ed}">${t("编辑模式")}</button>` : ""}<span class="rd-esc">Esc</span></span><i class="rd-prog" aria-hidden="true"></i></div>
      <article class="rd-art${n ? "" : " textonly"}${ed ? " editing" : ""}">
        <header class="rd-head">
          <div class="rd-edge"><span>${esc(date)}</span><span>${esc(place)}</span></div>
          ${s.placeholder ? `<span class="sflag">${t("占位")}</span>` : ""}
          ${ed ? `<textarea class="rd-in rd-title" data-sk="title" rows="1" placeholder="${t("故事标题")}">${esc(s.title || "")}</textarea>`
            : `<h1>${esc(storyText(s, "title"))}</h1>`}
        </header>
        <div class="rd-flow">${flow}</div>
        ${more}
        <div class="rd-end" aria-hidden="true">END OF ROLL</div>
      </article>
      ${prev || next ? `<nav class="rd-nav">${navBtn(prev, "prev")}${navBtn(next, "next")}</nav>` : ""}`;
  }
  // 阅读页先显示小图，快滚到时在后台下载中图（长边 1600），解码好再换上，不会出现空白。
  // 不用原图：几十张原图同时解码要占几 GB 内存，Safari 会直接把页面杀掉；全屏看图才用原图。
  // 离开屏幕很远的图换回小图，释放内存，滚回来再换上中图；中图缺失就一直用小图
  const rdFull = new IntersectionObserver(entries => entries.forEach(e => {
    const img = e.target, url = img.dataset.mid;
    if (!e.isIntersecting) {
      if (img.dataset.up) { delete img.dataset.up; img.src = img.dataset.thumb; }
      return;
    }
    if (img.dataset.up || img.dataset.bad) return;
    img.dataset.up = "1";
    img.dataset.thumb ||= img.getAttribute("src");
    const big = new Image();
    big.src = url;
    big.decode().then(() => { if (img.isConnected && img.dataset.up) img.src = url; })
      .catch(() => { img.dataset.bad = "1"; delete img.dataset.up; });
  }), { root: rd, rootMargin: "1200px 0px" });
  function rdOpen(s) {
    const same = rdStory === s && rd.classList.contains("open");
    rdStory = s;
    rdFull.disconnect();
    rd.innerHTML = readerHTML(s);
    rd.querySelectorAll("img[data-mid]").forEach(img => rdFull.observe(img));
    if (!same) {
      hideLoupe();
      rd.classList.add("open"); document.body.classList.add("lock");
      rd.setAttribute("aria-hidden", "false");
      rd.scrollTop = 0;
      $("rdClose").focus({ preventScroll: true });
    }
    rd.querySelectorAll("textarea.rd-in").forEach(grow);
    rdScroll();
  }
  // 顶栏：底边一条读到哪的进度；标题滚出屏幕后，顶栏中间换成文章标题
  let rdTick = 0;
  function rdScroll() {
    rdTick = 0;
    const bar = rd.querySelector(".rd-bar"), h1 = rd.querySelector(".rd-head h1");
    if (!bar) return;
    const max = rd.scrollHeight - rd.clientHeight;
    bar.style.setProperty("--p", max > 0 ? Math.min(1, rd.scrollTop / max).toFixed(4) : 0);
    bar.classList.toggle("past", !!h1 && h1.getBoundingClientRect().bottom < bar.offsetHeight);
  }
  rd.addEventListener("scroll", () => { if (!rdTick) rdTick = requestAnimationFrame(rdScroll); }, { passive: true });
  // 输入框跟着内容长高，不出现内部滚动条
  function grow(el) { el.style.height = "auto"; el.style.height = el.scrollHeight + 2 + "px"; }
  function rdClose() {
    if (!rd.classList.contains("open")) return;
    rd.classList.remove("open");
    rd.setAttribute("aria-hidden", "true");
    if (!vf.classList.contains("open")) document.body.classList.remove("lock");
    rdFull.disconnect();
    rd.innerHTML = "";
    if (storiesDirty) { storiesDirty = false; if (storyMode()) renderMain(); }
    const card = rdStory && $("sheet").querySelector(`.story[data-story="${CSS.escape(rdStory.id)}"]`);
    if (card) { card.scrollIntoView({ block: "nearest", behavior: "instant" }); card.querySelector(".slink")?.focus({ preventScroll: true }); }
    rdStory = null;
  }
  // 关闭：是从页面里点开的就退回上一步（浏览器后退键同理），直接打开链接的就换回 #stories
  function leaveReader() {
    if (rdPushed) { rdPushed = false; history.back(); }
    else { history.replaceState(null, "", "#stories"); route(); }
  }
  function openStory(id) {
    rdPushed = true;
    location.hash = `stories/${encodeURIComponent(id)}`;
  }
  rd.addEventListener("click", e => {
    if (e.target.closest("#rdClose")) return leaveReader();
    if (e.target.closest("#rdEdit")) return setEditing(!editing);
    const go = e.target.closest(".rd-go");
    if (go) { history.replaceState(null, "", `#stories/${encodeURIComponent(go.dataset.story)}`); route(); rd.scrollTop = 0; return; }
    const s = e.target.closest(".shot"); if (s) vfOpen(s.dataset.photo);
  });
  rd.addEventListener("pointerover", e => {
    const b = e.target.closest?.(".shot.live");
    if (b && e.pointerType === "mouse" && !b.contains(e.relatedTarget)) playLive(b, byId(b.dataset.photo));
  });
  rd.addEventListener("pointerout", e => {
    const b = e.target.closest?.(".shot.live");
    if (b && !b.contains(e.relatedTarget)) stopLive(b);
  });
  addEventListener("keydown", e => {
    if (e.key !== "Escape" || !rd.classList.contains("open") || vf.classList.contains("open")) return;
    e.preventDefault();
    if (e.target instanceof Element && e.target.matches(".rd-in")) e.target.blur();
    else leaveReader();
  });
  // 编辑故事：改的同时更新页面对象和原始数据，停手后整份写回 stories.json
  rd.addEventListener("input", e => {
    const el = e.target, s = rdStory;
    if (!s || !el.matches?.(".rd-in")) return;
    const v = el.dataset.sk === "text" ? el.value.trim() : el.value.trim().replace(/\s+/g, " ");
    if (el.dataset.sk) s[el.dataset.sk] = s.raw[el.dataset.sk] = v;
    else {
      const p = s.media[+el.dataset.mi];
      if (!p) return;
      p.title = p.raw.caption = v;
    }
    if (el.tagName === "TEXTAREA") grow(el);
    storiesDirty = true;
    scheduleStorySave();
  });

  // 网址：#stories 是故事页，#stories/<id> 再打开那篇的阅读页，其他都是作品页
  let routed = false;
  let storiesLoaded = false, storiesLoading = null, routeVersion = 0;
  function ensureStories() {
    if (storiesLoaded) return Promise.resolve();
    return storiesLoading ||= fetch("shared/stories.json", { cache: canEdit ? "no-store" : "default" })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(j => { buildStories(j.stories || []); storiesLoaded = true; })
      .finally(() => { storiesLoading = null; });
  }
  async function route() {
    const version = ++routeVersion;
    const [view, id] = location.hash.slice(1).split("/");
    const v = view === "stories" ? "stories" : "work";
    if (v === "stories" && !storiesLoaded) {
      try { await ensureStories(); }
      catch { if (version === routeVersion) $("sheet").textContent = I18N.language === "en" ? "Could not load stories. Please refresh to retry." : "故事加载失败，请刷新重试。"; return; }
      if (version !== routeVersion) return;
    }
    if (!routed || v !== state.view) { routed = true; setView(v); }
    const s = v === "stories" && id && STORIES.find(x => x.id === decodeURIComponent(id));
    if (s) rdOpen(s); else { rdPushed = false; rdClose(); }
  }

  // 切换「作品 / 故事」：只换主体、地图标题和导航高亮，筛选条件保留
  function setView(view) {
    state.view = view === "stories" ? "stories" : "work";
    document.querySelectorAll(".top nav a[data-view]").forEach(a => a.dataset.view === state.view ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
    $("mapTitle").innerHTML = storyMode() ? "Roads<br>&amp; Stories" : "Places<br>&amp; Frames";
    $("mapSub").dataset.i18n = storyMode() ? "走过的路，留下的故事" : "走过的地方，拍下的底片";
    $("mapSub").textContent = t($("mapSub").dataset.i18n);
    if (!DB) return;
    hover(null);
    applyFilter();
  }
  addEventListener("hashchange", route);

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
    vf.classList.toggle("casual", !!p.story);
    if (p.story) return paintStoryViewer(p);
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

  // 故事里的图：顶上写是哪篇故事，下面只有图注、地点和日期，不显示拍摄参数
  function paintStoryViewer(p) {
    const s = p.story, i = s.media.indexOf(p);
    $("vfRoll").innerHTML = `<b>${esc(countryLabel(s.country))}</b>　${esc(cityLabel(s.city, s.country))}　▸ ${esc(storyText(s, "title"))}`;
    $("vfFilt").textContent = "";
    // 没写配图标题就空着，不拿文章标题顶替
    $("vfTitle").textContent = caption(p);
    $("vfPlace").textContent = [label(p.spot), (p.taken || s.date || "").slice(0, 10).replaceAll("-", ".")].filter(Boolean).join("　");
    $("vfCount").textContent = `${pad(i + 1)} / ${pad(s.media.length)}`;
  }

  let viewerRequest = 0, viewerLoadTimer = null, viewerImages = [];
  // 大图缩放状态：倍数、平移、正在按着的手指/鼠标、手势起点（逻辑在下面「缩放」一节）
  let zk = 1, zx = 0, zy = 0, gestured = false, g0 = null;
  const pts = new Map();
  function cancelViewerLoad() {
    viewerRequest++;
    clearTimeout(viewerLoadTimer);
    viewerLoadTimer = null;
    // 中断已过期的下载/解码，不把离屏大图一直留在内存里。
    viewerImages.forEach(img => { if (!img.isConnected) img.removeAttribute("src"); });
    viewerImages = [];
  }
  // 全屏看图：只有故事里的图带实况时才出现 LIVE 按钮
  const viewerLive = p => p?.story && p.live ? p : null;
  function resetViewerLive() {
    stopLive(vf);
    const v = vf.querySelector("video.live-clip");
    if (v) { v.removeAttribute("src"); v.load(); }
    $("vfLive").hidden = true;
  }
  // LIVE 标贴在照片画面的左上角：按 contain 缩放算出画面实际位置；铺满模式下照片顶到屏幕边，就用样式里的默认位置
  function placeLive() {
    const b = $("vfLive"), img = $("vfImg");
    if (b.hidden || !cur || cover || img.hidden) { b.style.left = b.style.top = ""; return; }
    const cs = getComputedStyle(img), pl = parseFloat(cs.paddingLeft), pt = parseFloat(cs.paddingTop);
    const bw = img.clientWidth - pl - parseFloat(cs.paddingRight), bh = img.clientHeight - pt - parseFloat(cs.paddingBottom);
    const k = Math.min(bw / cur.w, bh / cur.h);
    b.style.left = Math.round(pl + (bw - cur.w * k) / 2 + 10) + "px";
    b.style.top = Math.round(pt + (bh - cur.h * k) / 2 + 10) + "px";
  }
  new ResizeObserver(placeLive).observe(vf);
  function clearViewerImages() {
    resetViewerLive();
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
    zoomReset();
    clearViewerImages();
    paintViewer(p);
    syncEditor();
    $("vfAf").classList.remove("lock", "fail");
    $("vfAf").style.animation = "none";
    void $("vfAf").offsetWidth; // 强制重排：每换一张都从大框重新收小，缓存命中时合焦动画也能重播
    $("vfAf").style.animation = "";
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
      $("vfAf").classList.add("fail");
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
      if (viewerLive(p)) { $("vfLive").hidden = false; playLive(vf, p, $("vfImg")); vf.querySelector("video.live-clip").classList.toggle("cover", cover); placeLive(); }
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
    if (cur.story) return vfShow(lit[(lit.indexOf(cur) + dir + lit.length) % lit.length]);
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
    vf.classList.remove("open"); document.body.classList.toggle("lock", rd.classList.contains("open"));
    vf.setAttribute("aria-hidden", "true");
    vf.setAttribute("aria-busy", "false");
    clearViewerImages();
    zoomReset();
    viewerStatus("");
    if (sheetDirty) applyFilter();
    while (cur && !cur.story && !frames.some(f => f.dataset.id === cur.id) && appendSheetBatch) appendSheetBatch();
    const f = cur && frames.find(f => f.dataset.id === cur.id);
    if (f) { f.scrollIntoView({ block: "nearest", behavior: "instant" }); f.classList.remove("flash"); void f.offsetWidth; f.classList.add("flash"); }
    const focus = f?.querySelector(".win") || lastFocus;
    if (focus && document.contains(focus)) focus.focus({ preventScroll: true });
  }

  $("sheet").addEventListener("click", e => {
    const w = e.target.closest(".win"); if (w) return vfOpen(w.dataset.id);
    const s = e.target.closest(".shot"); if (s) return vfOpen(s.dataset.photo);
    const card = e.target.closest(".story[data-story]");
    if (card && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openStory(card.dataset.story); }
  });
  $("vfClose").onclick = vfClose;
  $("vfPrev").onclick = () => step(-1);
  $("vfNext").onclick = () => step(1);
  $("vfRetry").onclick = () => vfShow(cur);
  $("vfLive").onclick = () => viewerLive(cur) && playLive(vf, cur, $("vfImg"));
  $("vfLive").onpointerenter = e => { if (e.pointerType === "mouse" && viewerLive(cur)) playLive(vf, cur, $("vfImg")); };
  addEventListener("keydown", e => {
    if (!vf.classList.contains("open")) return;
    if (e.target instanceof Element && e.target.matches("input, textarea, select")) { if (e.key === "Escape") e.target.blur(); return; }
    if (e.key === "Escape") { e.preventDefault(); vfClose(); }
    if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    if (e.key.toLowerCase() === "f") {
      e.preventDefault();
      cover = !cover;
      zoomReset();
      for (const id of ["vfPreview", "vfImg"]) $(id).classList.toggle("cover", cover);
      vf.querySelector("video.live-clip")?.classList.toggle("cover", cover);
      placeLive();
    }
  });
  let x0 = null;
  vf.addEventListener("touchstart", e => { x0 = e.target.closest(".ed") || e.touches.length > 1 || zk > 1 ? null : e.touches[0].clientX; }, { passive: true });
  vf.addEventListener("touchend", e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); x0 = null; });

  // 缩放：电脑用滚轮（触控板双指捏合也走这里），手机双指捏合；放大后单指/鼠标拖着移动，双击复原。
  // 照片、预览和实况视频共用 vf 上的 --zx/--zy/--zk，换图时不用再追着节点改样式。
  function zoomApply() {
    vf.style.setProperty("--zx", zx + "px");
    vf.style.setProperty("--zy", zy + "px");
    vf.style.setProperty("--zk", zk);
    vf.classList.toggle("zoomed", zk > 1);
  }
  function zoomReset() { zk = 1; zx = zy = 0; g0 = null; pts.clear(); zoomApply(); }
  // 照片画面（不含留白）在未缩放时的位置，算法同 placeLive，铺满模式按 cover 算
  function zoomContent() {
    const img = $("vfImg").hidden ? $("vfPreview") : $("vfImg");
    if (!cur || img.hidden) return null;
    const cs = getComputedStyle(img), pl = parseFloat(cs.paddingLeft), pt = parseFloat(cs.paddingTop);
    const bw = img.clientWidth - pl - parseFloat(cs.paddingRight), bh = img.clientHeight - pt - parseFloat(cs.paddingBottom);
    const k = (cover ? Math.max : Math.min)(bw / cur.w, bh / cur.h);
    return { x: pl + (bw - cur.w * k) / 2, y: pt + (bh - cur.h * k) / 2, w: cur.w * k, h: cur.h * k };
  }
  // 比屏幕大时边缘不能拖进屏幕里；比屏幕小时不能拖出屏幕
  // 最多放到原图像素的 2 倍（至少 4 倍）
  function zoomK(k) {
    const c = zoomContent();
    return c ? Math.min(Math.max(k, 1), Math.max(4, cur.w / c.w * 2)) : 1;
  }
  function zoomTo(k, tx, ty) {
    const c = zoomContent();
    if (!c) return;
    zk = zoomK(k);
    const lim = (t, a, len, view) => { const lo = -zk * a, hi = view - zk * (a + len); return Math.min(Math.max(t, Math.min(lo, hi)), Math.max(lo, hi)); };
    zx = zk === 1 ? 0 : lim(tx, c.x, c.w, vf.clientWidth);
    zy = zk === 1 ? 0 : lim(ty, c.y, c.h, vf.clientHeight);
    zoomApply();
  }
  // 以屏幕上的 (px, py) 为中心缩放，这一点下的画面保持不动
  function zoomAt(k, px, py) {
    const r = vf.getBoundingClientRect(), x = px - r.left, y = py - r.top;
    k = zoomK(k);
    zoomTo(k, x - (x - zx) * k / zk, y - (y - zy) * k / zk);
  }
  const zoomSkip = e => e.target.closest(".ed, .vtop, .vlive, .vstatus");
  vf.addEventListener("wheel", e => {
    if (zoomSkip(e) || !cur) return;
    e.preventDefault();
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(zk * Math.exp(-d * (e.ctrlKey ? 0.01 : 0.002)), e.clientX, e.clientY);
  }, { passive: false });
  vf.addEventListener("pointerdown", e => {
    if (zoomSkip(e) || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (pts.size === 0) gestured = false;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 || zk > 1) { try { vf.setPointerCapture(e.pointerId); } catch {} }
    zoomStart();
  });
  function zoomStart() {
    const [a, b] = [...pts.values()];
    if (b) g0 = { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, k: zk, x: zx, y: zy };
    else if (a) g0 = { mx: a.x, my: a.y, k: zk, x: zx, y: zy };
    else g0 = null;
  }
  vf.addEventListener("pointermove", e => {
    const q = pts.get(e.pointerId);
    if (!q || !g0) return;
    q.x = e.clientX; q.y = e.clientY;
    const [a, b] = [...pts.values()];
    if (b && g0.d) {
      const r = vf.getBoundingClientRect(), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const k = zoomK(g0.k * Math.hypot(b.x - a.x, b.y - a.y) / g0.d);
      // 捏合开始时两指中点下的那一点，跟着手指中点走
      const ox = g0.mx - r.left, oy = g0.my - r.top;
      zoomTo(k, mx - r.left - (ox - g0.x) * k / g0.k, my - r.top - (oy - g0.y) * k / g0.k);
      gestured = true;
    } else if (!b && zk > 1) {
      const dx = a.x - g0.mx, dy = a.y - g0.my;
      if (!gestured && Math.hypot(dx, dy) < 4) return;
      zoomTo(zk, g0.x + dx, g0.y + dy);
      gestured = true;
    }
  });
  const zoomEnd = e => {
    if (!pts.delete(e.pointerId)) return;
    zoomStart(); // 两指松开一指后接着单指拖，从当前位置重新算
  };
  vf.addEventListener("pointerup", zoomEnd);
  vf.addEventListener("pointercancel", zoomEnd);
  // 拖动/捏合结束时浏览器还会补发一次 click，别让它触发翻页
  vf.addEventListener("click", e => { if (gestured) { gestured = false; e.stopPropagation(); e.preventDefault(); } }, true);
  vf.addEventListener("dblclick", e => { if (zk > 1 && !zoomSkip(e)) zoomReset(); });
  // iOS Safari 自带的整页捏合缩放
  vf.addEventListener("gesturestart", e => e.preventDefault());
  addEventListener("resize", () => { if (zk > 1) zoomTo(zk, zx, zy); });

  /* ———————— 编辑模式（临时）：只有用 tools/serve.py 打开时才有 ———————— */
  let editing = false;
  const ed = $("ed");

  function setEditing(on) {
    editing = on;
    $("editToggle").setAttribute("aria-pressed", on);
    try { localStorage.setItem("ignat-edit", on ? "1" : ""); } catch {}
    syncEditor();
    if (rdStory && rd.classList.contains("open")) rdOpen(rdStory);
  }
  // 待审核的照片不管编辑模式开没开，都带着编辑面板（要在面板里点「审核通过」）
  function syncEditor() {
    const on = !cur?.story && (editing || !!cur?.review);
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
  // 故事单独存到 /api/stories，状态显示在阅读页里
  let storyTimer = null, storiesDirty = false;
  const storyStatus = { msg: "" };
  const setStoryStatus = (msg, err = false) => {
    storyStatus.msg = msg;
    const el = $("rdStatus");
    if (el) { el.textContent = msg; el.classList.toggle("err", err); }
  };
  function scheduleStorySave() {
    setStoryStatus(t("有改动，马上保存…"));
    clearTimeout(storyTimer);
    storyTimer = setTimeout(() => { storyTimer = null; saveStoriesNow(); }, 600);
  }
  function saveStoriesNow() {
    const body = JSON.stringify({ stories: STORY_RAW });
    saveChain = saveChain.then(async () => {
      try {
        const r = await fetch("/api/stories", { method: "PUT", headers: { "Content-Type": "application/json" }, body });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        setStoryStatus(t("saved", { time: new Date().toLocaleTimeString(I18N.language === "en" ? "en-GB" : "zh-CN", { hour12: false }) }));
      } catch (err) {
        setStoryStatus(t("saveFailed", { error: err.message }), true);
      }
    });
  }
  addEventListener("beforeunload", e => { if (saveTimer || storyTimer) { e.preventDefault(); e.returnValue = ""; } });

  // Repaint labels only; preserve filters, the current photo and source data.
  $("languageToggle").addEventListener("click", () => {
    I18N.toggle();
    if (!DB) return;
    renderBar(); renderMain(); paintMap();
    $("mapSub").textContent = t($("mapSub").dataset.i18n);
    mapCountries.forEach(el => {
      const c = COUNTRY_INFO.get(el.dataset.country);
      if (c) el.setAttribute("aria-label", `${countryLabel(c.name)}, ${photoCount(c.items.length)}`);
    });
    if (state.hot) showTip(state.hot);
    if (rdStory && rd.classList.contains("open")) rdOpen(rdStory);
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
    // 故事数据单独一个文件；读不到时故事页显示为空，不影响作品页

    derive();

    $("edgeYears").textContent = `IGNAT ATLAS ▸ ${years(ORDER)}`;
    $("edgeCount").textContent = `${COUNTRIES.length} ${COUNTRIES.length > 1 ? "COUNTRIES" : "COUNTRY"} / ${ORDER.length} EXP`;
    renderBar();
    route();
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
