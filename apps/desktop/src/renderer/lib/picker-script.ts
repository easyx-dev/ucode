/**
 * 页面侧的点选脚本，以及把点选结果整理成一段可读摘要。
 *
 * 脚本是**字符串**：它被注入到页面的主世界执行，不能带闭包、不能用 TS 语法（与 harness 的页面脚本同一约束）。
 * 摘要的整理留在 Node 侧（纯函数、可单测）——`elementSummaryText` 里那几条截断与省略是唯一有判断的部分。
 *
 * 覆盖面参照同类产品（Trae 起的头、Cursor 的 Design Mode、ZCode 的网页元素上下文）的共识字段：
 * **元素身份**（role / 可访问名 / 选择器 / 属性 / 计算样式 / 盒子）、**页面身份**（URL + 标题）、
 * **内容**（自身文本、附近文本、一段 HTML 片段）。差别是他们把「组件名与 fiber props / 元素截图」也算进来，
 * 那两样要么要构建期插件、要么要额外一条截图链路，这里不做（见 docs/browser.md 的已知限制）。
 */

/** 点选结果：够模型定位到源码里的那个元素，不多采 */
export type PickedElement = {
  tag: string;
  role: string;
  name: string;
  selector: string;
  text: string;
  /** 父元素里除它自己以外的文本（列表项、表格行这类元素的「上下文」） */
  nearbyText: string;
  /** 属性表（已剔除内联事件与 style），值按原样给 */
  attributes: { name: string; value: string }[];
  /** 盒子（视口坐标，四舍五入留整） */
  rect: { x: number; y: number; width: number; height: number };
  /** 计算样式里与「这个元素长什么样」最相关的几项 */
  style: {
    color: string;
    background: string;
    font: string;
    weight: string;
    display: string;
  };
  /** outerHTML 摘要（已去掉内联事件与脚本） */
  html: string;
};

const PICKER = `function (options) {
  return new Promise(function (resolve) {
    var doc = document;
    var rootId = options.rootId;
    var highlight = options.highlight;
    var previous = doc.getElementById(rootId);
    if (previous) previous.remove();

    var hovered = null;
    var previousOutline = "";
    var settled = false;

    function roleOf(el) {
      var explicit = el.getAttribute && el.getAttribute("role");
      if (explicit) return explicit;
      var tag = el.tagName.toLowerCase();
      if (tag === "a") return "link";
      if (tag === "button") return "button";
      if (tag === "input") return el.getAttribute("type") || "textbox";
      if (tag === "textarea") return "textbox";
      if (tag === "select") return "combobox";
      if (tag === "img") return "image";
      if (/^h[1-6]$/.test(tag)) return "heading";
      return tag;
    }

    function nameOf(el) {
      var label = el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("placeholder"));
      var text = (label || el.textContent || "").replace(/\\s+/g, " ").trim();
      if (text.length > 300) text = text.slice(0, 300) + "…";
      return text;
    }

    /*
      选择器按「源码里最可能出现的那个特征」优先：测试 id / 元素 id / 表单名 / 无障碍名，
      都不行才退回结构路径（带 class 与 nth-of-type）。只给一个 CSS 路径的话，
      模型得自己猜是哪个组件，测试 id 这类特征它能直接在仓库里搜到。
    */
    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
      return String(value).replace(/["\\\\]/g, "\\\\$&");
    }

    function structuralPath(el) {
      var parts = [];
      var node = el;
      while (node && node.nodeType === 1 && parts.length < 4) {
        var tag = node.tagName.toLowerCase();
        var parent = node.parentElement;
        if (parent) {
          var sameTag = 0;
          var index = 0;
          for (var i = 0; i < parent.children.length; i += 1) {
            var child = parent.children[i];
            if (child.tagName === node.tagName) {
              sameTag += 1;
              if (child === node) index = sameTag;
            }
          }
          tag = sameTag > 1 ? tag + ":nth-of-type(" + index + ")" : tag;
        }
        if (node.classList && node.classList.length > 0) tag = tag + "." + node.classList[0];
        parts.unshift(tag);
        node = parent;
      }
      return parts.join(" > ");
    }

    function selectorOf(el) {
      var testId = el.getAttribute && (el.getAttribute("data-testid") || el.getAttribute("data-test"));
      if (testId) return '[data-testid="' + cssEscape(testId) + '"]';
      if (el.id) return "#" + cssEscape(el.id);
      var name = el.getAttribute && el.getAttribute("name");
      if (name) return el.tagName.toLowerCase() + '[name="' + cssEscape(name) + '"]';
      var label = el.getAttribute && el.getAttribute("aria-label");
      if (label) return el.tagName.toLowerCase() + '[aria-label="' + cssEscape(label) + '"]';
      return structuralPath(el);
    }

    /** 附近文本：父元素里除它自己以外的文字，列表项 / 表格行靠它才说得清是「哪一条」 */
    function nearbyOf(el) {
      var parent = el.parentElement;
      if (!parent) return "";
      var clone = parent.cloneNode(true);
      var self = el.id ? clone.querySelector("#" + CSS.escape(el.id)) : null;
      if (self) self.remove();
      else if (clone.firstElementChild) {
        // 没有 id 时按标签与序号粗略定位，定位不到就不删（宁可多一段上下文）
        var index = Array.prototype.indexOf.call(parent.children, el);
        var target = clone.children[index];
        if (target) target.remove();
      }
      var text = (clone.textContent || "").replace(/\\s+/g, " ").trim();
      return text === nameOf(el) ? "" : text.slice(0, 600);
    }

    function attributesOf(el) {
      var result = [];
      var attrs = el.attributes || [];
      for (var i = 0; i < attrs.length && result.length < 24; i += 1) {
        var name = attrs[i].name;
        if (/^on/i.test(name) || name === "style") continue;
        var value = String(attrs[i].value);
        if (value.length > 160) value = value.slice(0, 160) + "…";
        result.push({ name: name, value: value });
      }
      return result;
    }

    /** 透明的背景不必写进上下文（它没有信息量） */
    function isTransparent(value) {
      if (!value) return true;
      if (value === "transparent") return true;
      var match = /rgba?(([^)]+))/.exec(value);
      if (!match) return false;
      var parts = match[1].split(",");
      return parts.length === 4 && parseFloat(parts[3]) === 0;
    }

    function styleOf(el) {
      var computed = window.getComputedStyle(el);
      var background = isTransparent(computed.backgroundColor) ? "" : computed.backgroundColor;
      var font = [computed.fontSize, (computed.fontFamily || "").split(",")[0].replace(/["']/g, "").trim()].filter(Boolean).join(" ");
      return {
        color: computed.color || "",
        background: background,
        font: font,
        weight: computed.fontWeight || "",
        display: computed.display || ""
      };
    }

    /** outerHTML 摘要：去掉内联事件与 script/style，避免把可执行片段带进对话 */
    function htmlOf(el) {
      var clone = el.cloneNode(true);
      var all = clone.querySelectorAll ? clone.querySelectorAll("*") : [];
      var nodes = [clone].concat([].slice.call(all));
      for (var i = 0; i < nodes.length; i += 1) {
        var node = nodes[i];
        if (!node.attributes) continue;
        if (node.tagName && (node.tagName === "SCRIPT" || node.tagName === "STYLE")) {
          node.remove();
          continue;
        }
        var names = [];
        for (var j = 0; j < node.attributes.length; j += 1) names.push(node.attributes[j].name);
        for (var k = 0; k < names.length; k += 1) {
          if (/^on/i.test(names[k])) node.removeAttribute(names[k]);
        }
      }
      var html = clone.outerHTML || "";
      return html.length > 4000 ? html.slice(0, 4000) + "…" : html;
    }

    function clearHover() {
      if (!hovered) return;
      hovered.style.outline = previousOutline;
      hovered = null;
    }

    function finish(payload) {
      if (settled) return;
      settled = true;
      clearHover();
      doc.removeEventListener("mousemove", onMove, true);
      doc.removeEventListener("click", onClick, true);
      doc.removeEventListener("keydown", onKey, true);
      var root = doc.getElementById(rootId);
      if (root) root.remove();
      resolve(payload);
    }

    function onMove(event) {
      var target = event.target;
      if (!target || target.nodeType !== 1) return;
      if (target === hovered) return;
      clearHover();
      hovered = target;
      previousOutline = target.style.outline;
      /*
        用 outline 高亮：不改布局、不插节点，页面自己的样式也不受影响。
        颜色由调用方按语义 token 解析后传进来——页面里读不到应用的 CSS 变量。
      */
      target.style.outline = "2px solid " + highlight;
    }

    function onClick(event) {
      var target = event.target;
      if (!target || target.nodeType !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      // 先摘掉高亮再采集：那圈 inline outline 会跟着 outerHTML 一起进片段，模型会以为那是页面自己的样式
      clearHover();
      var element = target;
      var box = element.getBoundingClientRect();
      var text = (element.textContent || "").replace(/\\s+/g, " ").trim();
      finish({
        tag: element.tagName.toLowerCase(),
        role: roleOf(element),
        name: nameOf(element),
        selector: selectorOf(element),
        text: text.slice(0, 1000),
        nearbyText: nearbyOf(element),
        attributes: attributesOf(element),
        rect: {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height)
        },
        style: styleOf(element),
        html: htmlOf(element)
      });
    }

    function onKey(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish(null);
    }

    doc.addEventListener("mousemove", onMove, true);
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("keydown", onKey, true);
  });
}`;

/**
 * 点选脚本：注入页面主世界执行，返回 Promise（点中给 payload，Esc 给 null）。
 *
 * 入参都由调用方给：高亮色按语义 token 解析（页面里读不到应用的 CSS 变量），`rootId` 用来在重复进入
 * 点选模式时清掉上一次的残留——它要足够独特，别撞上页面自己的元素。
 */
export const pickerScript = (options: { highlight: string; rootId: string }): string =>
  `(${PICKER})(${JSON.stringify(options)})`;

/** 一段 HTML 片段的长度上限：够看清结构，又不至于把输入框塞满（同类产品取的是 6000~8000，我们给一半） */
const MAX_HTML_CHARS = 1500;
const MAX_TEXT_CHARS = 200;
const MAX_NEARBY_CHARS = 160;
const MAX_ATTRIBUTES_CHARS = 300;

const clip = (value: string, max: number): string => {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
};

// i18n-ignore: 同 LABELS——摘要进的是用户消息正文，不随界面语言翻译
// biome-ignore format: 一行写完，配一条 i18n-ignore 就够
const STYLE_LABELS = { color: "颜色", background: "背景", font: "字体", weight: "字重" };

/** 样式行的取值：空白不写，长值截一下 */
const styleLine = (style: PickedElement["style"]): string => {
  const parts = [
    style.color && `${STYLE_LABELS.color} ${clip(style.color, 40)}`,
    style.background && `${STYLE_LABELS.background} ${clip(style.background, 40)}`,
    style.font && `${STYLE_LABELS.font} ${clip(style.font, 60)}`,
    style.weight && `${STYLE_LABELS.weight} ${clip(style.weight, 10)}`,
    style.display && `display ${clip(style.display, 20)}`,
  ].filter(Boolean);
  return parts.join("；");
};

const attributesLine = (attributes: PickedElement["attributes"]): string =>
  clip(
    attributes.map((attribute) => `${attribute.name}="${attribute.value}"`).join(" "),
    MAX_ATTRIBUTES_CHARS,
  );

/**
 * 点选结果 → 插进输入框的摘要文本。
 *
 * 是给人看也给人改的（进的是用户自己的消息）：先说清「这是页面上哪个元素」，再给选择器、盒子、样式、
 * 属性、文本与附近文本，最后是一段 HTML 片段，让模型能对着改。空值整行不写——与同类产品同一取舍，
 * 免得半行空标签占上下文。
 *
 * 中文不套 i18n：它是**用户消息的正文**（给模型看的摘要），不是界面文案——跟着界面语言翻译反而会让
 * 同一句话在两种语言下含义不一致。 // i18n-ignore
 */
// biome-ignore format: 一行写完，配一条 i18n-ignore 就够（拆行会让每条中文各自需要标记）
const LABELS = { page: "【页面元素】", element: "元素", selector: "选择器", rect: "位置", style: "样式", attributes: "属性", text: "文本", nearby: "附近", untitled: "(无标题)" };

export const elementSummaryText = (
  picked: PickedElement,
  page: { url: string; title: string },
): string => {
  const where = page.title ? `${page.title}（${page.url}）` : `${LABELS.untitled}（${page.url}）`;
  const lines = [`${LABELS.page}${where}`];
  const field = (label: string, value: string) => {
    if (value) lines.push(`- ${label}：${value}`);
  };

  const named = picked.name ? ` "${clip(picked.name, 80)}"` : "";
  field(LABELS.element, `${picked.role}${named}（<${picked.tag}>）`);
  field(LABELS.selector, clip(picked.selector, 300));
  const rect = picked.rect;
  field(
    LABELS.rect,
    // 页面侧已经取过整，这里再取一次：坐标带小数在提示里没有信息量，只是噪声
    `x=${Math.round(rect.x)}, y=${Math.round(rect.y)}, ${Math.round(rect.width)} × ${Math.round(rect.height)}`,
  );
  field(LABELS.style, styleLine(picked.style));
  field(LABELS.attributes, attributesLine(picked.attributes));

  const text = clip(picked.text, MAX_TEXT_CHARS);
  const nearby = clip(picked.nearbyText, MAX_NEARBY_CHARS);
  if (text && text !== clip(picked.name, 80)) field(LABELS.text, text);
  field(LABELS.nearby, nearby);

  const html = clip(picked.html, MAX_HTML_CHARS);
  // 代码块围栏不带中文：摘要是「字段区 + 片段」两段拼起来
  return html ? `${lines.join("\n")}\n\n\`\`\`html\n${html}\n\`\`\`` : lines.join("\n");
};
