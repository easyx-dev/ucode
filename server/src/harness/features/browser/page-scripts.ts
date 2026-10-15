/**
 * 页面侧脚本（快照采集、ref 写回、中心点命中检测）。
 *
 * 刻意写成**字符串**而不是 TS 函数：dev 链路的 tsx（esbuild `keepNames`）会给函数加 `__name` 包装，
 * 函数被序列化进页面执行时就变成「`__name is not defined`」；字符串原样送进去，没有转译这一层。
 * 代价是这里没有类型检查，因此每条脚本都由 `__tests__/page-scripts.test.ts` 兜底：语法可解析、
 * 结果形状符合契约、不引用模块作用域。
 */

export type CollectScriptOptions = {
  max: number;
  nameMaxChars: number;
  indexAttribute: string;
  refAttribute: string;
};

const COLLECT = `function (options) {
  var max = options.max;
  var indexAttribute = options.indexAttribute;
  var refAttribute = options.refAttribute;
  var SELECTOR = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "summary",
    "h1",
    "h2",
    "h3",
    "[role]",
    "[contenteditable=true]",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  var ROLE_BY_TAG = {
    a: "link",
    button: "button",
    select: "combobox",
    textarea: "textbox",
    summary: "button",
    img: "img",
    h1: "heading",
    h2: "heading",
    h3: "heading",
  };
  var ROLE_BY_INPUT = {
    button: "button",
    submit: "button",
    reset: "button",
    image: "button",
    checkbox: "checkbox",
    radio: "radio",
    range: "slider",
    number: "spinbutton",
    search: "searchbox",
    email: "textbox",
    tel: "textbox",
    url: "textbox",
    password: "textbox",
    text: "textbox",
  };

  function compress(value) {
    return String(value || "").replace(/\\s+/g, " ").trim();
  }
  function cut(value) {
    return value.length > options.nameMaxChars ? value.slice(0, options.nameMaxChars) + "…" : value;
  }
  function tagOf(el) {
    return el.tagName.toLowerCase();
  }
  function roleOf(el) {
    var explicit = compress(el.getAttribute("role"));
    if (explicit) return explicit.split(" ")[0] || explicit;
    var tag = tagOf(el);
    if (tag === "input") {
      var type = (el.type || "text").toLowerCase();
      return ROLE_BY_INPUT[type] || "textbox";
    }
    if (el.getAttribute("contenteditable") === "true") return "textbox";
    if (/^h[1-6]$/.test(tag)) return "heading";
    return ROLE_BY_TAG[tag] || "generic";
  }
  function labelTextFor(el) {
    var labels = el.labels;
    if (!labels || labels.length === 0) return "";
    var label = labels[0];
    var nodes = label.childNodes;
    // 取不到子节点时回落整段文本（假 DOM / 极端结构）
    if (!nodes) return compress(label.textContent);
    var text = "";
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      // 跳过控件自己所在的那一枝：<label>城市 <select>…</select></label> 整段读会带上全部选项文本
      if (node === el) continue;
      if (node.contains && node.contains(el)) continue;
      text += node.textContent || "";
    }
    return compress(text) || compress(label.textContent);
  }

  function labelledBy(el) {
    var ids = compress(el.getAttribute("aria-labelledby")).split(" ").filter(Boolean);
    return ids
      .map(function (id) {
        var node = el.ownerDocument.getElementById(id);
        return compress(node ? node.textContent : "");
      })
      .filter(Boolean)
      .join(" ");
  }
  function nameOf(el) {
    var ariaLabel = compress(el.getAttribute("aria-label"));
    if (ariaLabel) return ariaLabel;
    var labelled = labelledBy(el);
    if (labelled) return labelled;
    var labelText = labelTextFor(el);
    if (labelText) return labelText;
    var attributes = ["placeholder", "alt", "title", "name"];
    for (var i = 0; i < attributes.length; i += 1) {
      var value = compress(el.getAttribute(attributes[i]));
      if (value) return value;
    }
    var own = compress(el.textContent);
    if (own) return own;
    return compress(el.value);
  }
  function stateOf(el) {
    var notes = [];
    var tag = tagOf(el);
    if (tag === "input" || tag === "textarea") {
      if (el.value && el.type !== "password") notes.push("值=" + cut(compress(el.value)));
      if (tag === "input" && (el.type === "checkbox" || el.type === "radio")) {
        notes.push(el.checked ? "已勾选" : "未勾选");
      }
    }
    if (tag === "select") {
      var options2 = el.selectedOptions;
      notes.push("当前=" + compress(options2 && options2.length > 0 ? options2[0].textContent : ""));
    }
    if (el.disabled === true || el.getAttribute("aria-disabled") === "true") notes.push("禁用");
    return notes.filter(Boolean).join("·");
  }
  function visible(el) {
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (typeof el.checkVisibility === "function") {
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  var previous = document.querySelectorAll("[" + refAttribute + "], [" + indexAttribute + "]");
  for (var s = 0; s < previous.length; s += 1) {
    previous[s].removeAttribute(refAttribute);
    previous[s].removeAttribute(indexAttribute);
  }

  var out = [];
  var candidates = document.querySelectorAll(SELECTOR);
  for (var c = 0; c < candidates.length; c += 1) {
    if (out.length >= max) break;
    var el = candidates[c];
    if (!visible(el)) continue;
    el.setAttribute(indexAttribute, String(out.length));
    var state = stateOf(el);
    var box = el.getBoundingClientRect();
    var entry = {
      role: roleOf(el),
      name: cut(nameOf(el)),
      tag: tagOf(el),
      // 整块在视口之外：取噪时丢掉它（调用方决定要不要用）
      offscreen: box.bottom <= 0 || box.top >= window.innerHeight,
    };
    if (state) entry.state = state;
    out.push(entry);
  }
  return out;
}`;

const APPLY_REFS = `function (options) {
  var indexAttribute = options.indexAttribute;
  var refAttribute = options.refAttribute;
  var pairs = options.pairs;
  var byIndex = {};
  for (var p = 0; p < pairs.length; p += 1) byIndex[pairs[p].index] = pairs[p].ref;
  var nodes = document.querySelectorAll("[" + indexAttribute + "]");
  var applied = 0;
  for (var i = 0; i < nodes.length; i += 1) {
    var node = nodes[i];
    var index = Number(node.getAttribute(indexAttribute));
    var ref = Number.isInteger(index) ? byIndex[index] : undefined;
    if (ref) {
      node.setAttribute(refAttribute, ref);
      applied += 1;
    }
  }
  return applied;
}`;

const HIT_TEST = `function (options) {
  var refAttribute = options.refAttribute;
  var ref = options.ref;
  var el = document.querySelectorAll("[" + refAttribute + '="' + ref + '"]')[0];
  if (!el) return { matched: false, missing: true };

  function describe(node) {
    var text = String(node.getAttribute("aria-label") || node.textContent || "").replace(/\\s+/g, " ").trim();
    var short = text.length > 30 ? text.slice(0, 30) + "…" : text;
    return node.tagName.toLowerCase() + (short ? ' "' + short + '"' : "");
  }

  var rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return { matched: false, missing: false, undecidable: true, reason: "当前不可见（尺寸为 0）" };
  }
  var x = rect.left + rect.width / 2;
  var y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
    return { matched: false, missing: false, undecidable: true, reason: "中心点在视口之外（先 scroll 到它）" };
  }
  var top = document.elementFromPoint(x, y);
  if (!top) {
    return { matched: false, missing: false, undecidable: true, reason: "该坐标上没有元素" };
  }
  var related = top === el || el.contains(top) || top.contains(el);
  if (related) return { matched: true, missing: false };
  return { matched: false, missing: false, blocker: describe(top) };
}`;

/** 采集脚本：入参是当次序号属性、ref 属性、条数与名字上限 */
export const collectScript = (options: CollectScriptOptions): string =>
  `(${COLLECT})(${JSON.stringify(options)})`;

/**
 * 写回脚本：把 Node 侧算好的 ref 按当次序号写回元素。
 *
 * 传的是「序号 → 编号」的配对而不是按下标对齐的数组：取噪会丢掉中间若干元素，
 * 按下标对齐会把编号写到错位的元素上（点 A 的编号作用到 B）。
 */
export const applyRefsScript = (options: {
  indexAttribute: string;
  refAttribute: string;
  pairs: { index: number; ref: string }[];
}): string => `(${APPLY_REFS})(${JSON.stringify(options)})`;

/** 命中检测脚本：取中心点看最顶层元素是不是目标自己 */
export const hitTestScript = (options: { refAttribute: string; ref: string }): string =>
  `(${HIT_TEST})(${JSON.stringify(options)})`;

const ELEMENT_BOX = `function (options) {
  var refAttribute = options.refAttribute;
  var ref = options.ref;
  var el = document.querySelectorAll("[" + refAttribute + '="' + ref + '"]')[0];
  if (!el) return { missing: true };

  /*
    先把元素挪到视口里再量：中心点在视口外时点不到，量出来的坐标也没意义。
    与 Playwright 的 scrollIntoViewIfNeeded 同一意图，只是这边只能自己调 scrollIntoView。
  */
  var before = el.getBoundingClientRect();
  var visible =
    before.width > 0 &&
    before.height > 0 &&
    before.top >= 0 &&
    before.left >= 0 &&
    before.bottom <= window.innerHeight &&
    before.right <= window.innerWidth;
  if (!visible && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ block: "center", inline: "center" });
  }

  var rect = el.getBoundingClientRect();
  return {
    missing: false,
    // 视口坐标：派发鼠标事件用它
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2,
    // 文档坐标：截图裁剪用它（CDP 的 clip 取文档坐标，Playwright 自己也是这么加的）
    pageX: rect.left + window.scrollX,
    pageY: rect.top + window.scrollY,
    // 截图要按设备像素比放大裁剪区，viewport 自己带 dpr
    devicePixelRatio: window.devicePixelRatio || 1
  };
}`;

const FOCUS_FOR_INPUT = `function (options) {
  var refAttribute = options.refAttribute;
  var ref = options.ref;
  var el = document.querySelectorAll("[" + refAttribute + '="' + ref + '"]')[0];
  if (!el) return { missing: true };
  el.focus();
  // 输入框与文本域有 select()，用它把已有内容整体选中，随后 insertText 就是「覆盖」
  var selectable = typeof el.select === "function";
  if (selectable) el.select();
  return { missing: false, selected: selectable, tag: el.tagName.toLowerCase() };
}`;

const SELECT_OPTION = `function (options) {
  var refAttribute = options.refAttribute;
  var ref = options.ref;
  var want = String(options.value);
  var el = document.querySelectorAll("[" + refAttribute + '="' + ref + '"]')[0];
  if (!el) return { missing: true };
  if (el.tagName !== "SELECT") return { missing: false, notSelect: true, tag: el.tagName.toLowerCase() };

  var match = null;
  for (var i = 0; i < el.options.length; i += 1) {
    var option = el.options[i];
    if (option.value === want || option.textContent.trim() === want) {
      match = option;
      break;
    }
  }
  if (!match) return { missing: false, noOption: true, options: [].map.call(el.options, function (o) { return o.value; }).slice(0, 20) };

  el.value = match.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { missing: false, value: match.value };
}`;

const DOCUMENT_STATE = `function () {
  return { readyState: document.readyState, url: location.href, title: document.title };
}`;

/**
 * 元素盒子脚本（桌面端那条通道用）：先把元素滚进视口，再给出它的矩形与中心点。
 * Playwright 那边有现成的 locator / scrollIntoViewIfNeeded，这边只能自己量。
 */
export const elementBoxScript = (options: { refAttribute: string; ref: string }): string =>
  `(${ELEMENT_BOX})(${JSON.stringify(options)})`;

/** 聚焦并选中已有内容：桌面端做 fill 的第一步（随后 insertText 即覆盖） */
export const focusForInputScript = (options: { refAttribute: string; ref: string }): string =>
  `(${FOCUS_FOR_INPUT})(${JSON.stringify(options)})`;

/** 选中下拉项：CDP 没有「选 option」的原语，只能改 value 再派发事件 */
export const selectOptionScript = (options: {
  refAttribute: string;
  ref: string;
  value: string;
}): string => `(${SELECT_OPTION})(${JSON.stringify(options)})`;

/** 文档状态：打开地址后轮询 readyState 等页面可用，顺带取回地址与标题 */
export const documentStateScript = (): string => `(${DOCUMENT_STATE})()`;
