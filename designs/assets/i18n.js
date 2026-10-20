// Display translations only: source photo data and editor values stay unchanged.
const I18N = (() => {
  let language = navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
  try {
    const saved = localStorage.getItem("ignat-language");
    if (saved === "zh" || saved === "en") language = saved;
  } catch { /* The toggle still works when storage is unavailable. */ }
  const messages = {
    "Ignat 摄影作品": "Ignat Photography",
    "作品": "Work", "故事": "Stories", "联系": "Contact", "编辑模式": "Edit mode",
    "拍摄地点地图": "Map of photo locations", "底片上的世界": "The world on film",
    "正在冲洗地图……": "Developing the map…", "走过的地方，拍下的底片": "Places explored, moments on film",
    "国家": "Country", "城市": "City", "类别": "Category",
    "按国家筛选": "Filter by country", "按城市筛选": "Filter by city", "按类别筛选": "Filter by category",
    "全部国家": "All countries", "全部城市": "All cities", "全部类别": "All categories",
    "人文": "People & culture", "风景": "Landscape", "重置筛选": "Reset filters",
    "正在读取照片……": "Loading photographs…",
    "© Ignat · 所有照片由 Ignat 拍摄，未经允许禁止商用。": "© Ignat · All photographs by Ignat. Commercial use without permission is prohibited.",
    "全屏看图": "Photo viewer", "播放实况": "Play Live Photo", "重新加载": "Retry", "关闭（Esc）": "Close (Esc)",
    "上一张": "Previous photo", "下一张": "Next photo", "← → 翻页　F 铺满　滚轮缩放": "← → Browse · F Fill screen · Scroll to zoom",
    "快门": "Shutter", "光圈": "Aperture", "焦距": "Focal length",
    "编辑照片信息": "Edit photo details", "编辑这张": "Edit this photo",
    "这张还在待审核。核对下面的标题、城市、类别和元数据（AI 推测的可能有错），没问题再通过。": "This photo is pending review. Check its title, city, category and metadata before approving. AI estimates may be incorrect.",
    "审核通过，并入作品": "Approve and add to portfolio",
    "标题": "Title", "给这张起个名字": "Give this photo a title",
    "具体地点（可空）": "Location (optional)", "例如 红场": "e.g. Red Square",
    "用红笔圈出来（精选）": "Feature it (circled in red)", "拍摄时间": "Date taken",
    "光圈 F": "Aperture (f/)", "焦距 mm": "Focal length (mm)", "相机": "Camera", "镜头": "Lens",
    "纬度": "Latitude", "经度": "Longitude",
    "虚线框 = 原图里没有这项信息。改完自动保存；← → 翻页时会带着编辑面板。": "A dashed border means the original file has no value for that field. Changes save automatically, and the editor stays open as you browse with ← →. Title and location edits change the original Chinese text.",
    "日期待补": "Date unknown", "城市待补": "City unknown", "未命名": "Untitled", "（未命名）": "Untitled",
    "点击跳到印样": "View contact sheet", "待审核": "Pending review", "只翻待审核的": "Browsing pending photos",
    "当前筛选：": "Filters: ", "全屏看：": "View photo: ", "＋ 新地点": "+ Add location",
    "点开一张，在右侧核对信息，再点「审核通过」": "Open a photo, check its details, then approve it.",
    "当前条件下没有照片，可切换类别、城市或重置筛选。": "No photos match. Try another category or city, or reset the filters.",
    "正在加载照片……": "Loading photo…", "照片加载失败": "Photo failed to load",
    "大图加载失败，暂时显示预览": "Full image unavailable; showing preview", "正在加载大图……": "Loading full image…",
    "有改动，马上保存…": "Saving changes…",
    "故事标题": "Story title", "正文：空一行分段": "Story text (blank line between paragraphs)", "配图标题（可留空）": "Photo caption (optional)",
    "读不到 shared/photos.json。请用预览服务器打开（不要直接双击 html 文件）。": "Unable to read shared/photos.json. Open this page through the preview server.",
    "地图暂时无法加载，请刷新重试": "Map unavailable. Refresh to try again.",
    "走过的路，留下的故事": "Roads travelled, stories kept", "点击看这里的故事": "Click to read stories from here",
    "占位": "Placeholder", "阅读全文": "Read the story", "返回故事": "Back to stories", "上一篇": "Previous", "下一篇": "Next",
    "这里还没有故事，换个国家或城市看看。": "No stories here yet. Try another country or city.",
    "storyCount": "{count} stories",
    "photoCount": "{count} photos", "proofCount": "{cities} places, {count} photos",
    "pendingCount": "{count} photos · Hidden from the public portfolio, map and filters until approved",
    "frameNumber": "{pending}Frame {number}", "approved": "Approved and added to portfolio ({count} still pending)",
    "addCity": "Add a new location in {country}:", "saved": "Saved ✓ {time}",
    "saveFailed": "Save failed: {error}. Check that the preview server is running, then edit a field to retry."
  };
  const chinese = {
    storyCount: "{count} 篇故事",
    photoCount: "{count} 张", proofCount: "{cities} 个地方，{count} 张",
    pendingCount: "{count} 张，审核通过前不会出现在作品、地图和筛选里，也不会上线",
    frameNumber: "{pending}第 {number} 张", approved: "已通过，并入作品（还剩 {count} 张待审核）",
    addCity: "在「{country}」下面加一个新地点：", saved: "已保存 ✓ {time}",
    saveFailed: "保存失败：{error}。请确认终端里的预览服务器还开着，再改一下任意一项重试。"
  };
  function t(key, values = {}) {
    const dictionary = language === "en" ? messages : chinese;
    let text = Object.hasOwn(dictionary, key) ? dictionary[key] : key;
    if (language === "en" && ["photoCount", "proofCount", "pendingCount", "storyCount"].includes(key)) {
      if (values.count === 1) text = text.replace("photos", "photo").replace("stories", "story");
      if (values.cities === 1) text = text.replace("places", "place");
    }
    return text.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
  }
  function apply() {
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    document.title = t("Ignat 摄影作品");
    document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
    for (const attr of ["aria-label", "placeholder"]) {
      document.querySelectorAll(`[data-i18n-${attr}]`).forEach(el => el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`))));
    }
    const button = document.getElementById("languageToggle");
    button.dataset.lang = language;
    button.setAttribute("aria-label", language === "en" ? "Switch to Chinese" : "Switch to English");
    button.setAttribute("title", language === "en" ? "切换到中文" : "Switch to English");
  }
  return {
    t, apply, get language() { return language; },
    add: entries => Object.assign(messages, entries),
    toggle() {
      language = language === "en" ? "zh" : "en";
      try { localStorage.setItem("ignat-language", language); } catch {}
      apply();
    }
  };
})();
