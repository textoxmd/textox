# Texto 主题开发指南

## 主题文件结构

一个 Texto 主题是一个 CSS 文件，包含三个块：

```css
/* 浅色模式：所有变量的浅色值 */
:root {
  --background: ...;
  --foreground: ...;
  /* ... 全部 33 个变量 + 可选的 --warning */
}

/* 深色模式：所有变量的深色值 */
.dark {
  --background: ...;
  --foreground: ...;
  /* ... 全部 33 个变量 + 可选的 --warning */
}

/* 编辑器内容区域：代码/选中样式 */
#writer {
  --code-editor-theme-light: ...;
  /* ... 编辑器专用变量 + 自定义内容样式 */
}
```

---

## 变量清单

### 一、核心颜色变量

共 33 个变量：32 个标准颜色变量 + `--color-scheme`。以下表格中还包含一个推荐定义的 `--warning`。按分组列出。

#### Surface —— 主表面

| 变量 | 作用 | 视觉说明 |
|------|------|----------|
| `--background` | 整个应用最底层的背景色 | 类似纸张的底色 |
| `--foreground` | 在背景上的默认文本色 | 正文、标题、标签的颜色 |
| `--card` | 卡片组件的背景色 | 比背景略不同的面板底色 |
| `--card-foreground` | 在卡片上的文本色 | 卡片中的文字颜色 |
| `--popover` | 弹出层、菜单、提示框的背景色 | 浮动层的底色 |
| `--popover-foreground` | 在弹出层上的文本色 | 菜单项、提示文字的颜色 |

#### Accents —— 强调色

| 变量 | 作用 | 视觉说明 |
|------|------|----------|
| `--primary` | 主色调，用于选中、焦点、交互态 | 最突出的强调色 |
| `--primary-foreground` | 在主色调背景上的文本色 | 主色调按钮上的文字 |
| `--secondary` | 次要表面色 | 比主背景稍有不同的面板色 |
| `--secondary-foreground` | 在次要表面上的文本色 | 次要面板的文字 |
| `--accent` | 高亮/强调色，用于悬停、选中样式 | 鼠标悬停、选中项的背景 |
| `--accent-foreground` | 在高亮背景上的文本色 | 选中项的文字颜色 |
| `--breathe-color` | 呼吸动画色 | 文件修改指示点的脉冲动画颜色 |

#### Feedback —— 反馈色

| 变量 | 作用 | 视觉说明 |
|------|------|----------|
| `--destructive` | 危险/错误/删除操作的颜色 | 红色系，用于错误提示、删除按钮 |
| `--warning` | 警告状态的颜色（可选，推荐定义） | 橙色/黄色系，用于冲突、警告提示 |
| `--muted` | 弱化背景色 | 比背景略深/浅，用于次要区域 |
| `--muted-foreground` | 弱化文本色 | 用于描述、提示、占位、次要文字 |

#### Boundaries —— 边界色

| 变量 | 作用 | 视觉说明 |
|------|------|----------|
| `--border` | 所有边框的默认颜色 | 面板边框、分割线、卡片描边 |
| `--input` | 输入框的边框颜色 | 文本框、下拉框的边框 |
| `--ring` | 焦点环的颜色 | 点击输入框或按钮时的外发光 |

#### Charts —— 图表色

| 变量 | 作用 |
|------|------|
| `--chart-1` | 图表配色 1 |
| `--chart-2` | 图表配色 2（同时用于标题栏"已保存"状态色） |
| `--chart-3` | 图表配色 3 |
| `--chart-4` | 图表配色 4 |
| `--chart-5` | 图表配色 5 |



#### Sidebar —— 侧边栏色

侧边栏有自己独立的一套颜色，通常比主色调稍暗（浅色模式）或稍亮（深色模式）。

| 变量 | 作用 | 视觉说明 |
|------|------|----------|
| `--sidebar` | 侧边栏背景色 | 文件树区域的底色 |
| `--sidebar-foreground` | 侧边栏文本色 | 文件名、目录名的颜色 |
| `--sidebar-primary` | 侧边栏主色调 | 侧边栏中的强调色 |
| `--sidebar-primary-foreground` | 侧边栏主色调上的文本色 | — |
| `--sidebar-accent` | 侧边栏选中/悬停背景色 | 选中的文件、悬停项的背景 |
| `--sidebar-accent-foreground` | 侧边栏选中项文本色 | 选中文件的文字颜色 |
| `--sidebar-border` | 侧边栏边框颜色 | 侧边栏与应用主体的分隔线 |
| `--sidebar-ring` | 侧边栏焦点环颜色 | 侧边栏中元素聚焦时的外发光 |

#### 特殊变量

| 变量 | 作用 | 取值 |
|------|------|------|
| `--color-scheme` | 浏览器原生 UI 的配色方案 | `light` 或 `dark`（字符串，不是颜色值） |

控制滚动条、表单控件等系统原生元素的样式。

---

### 二、编辑器内容区域的变量（在 `#writer {}` 中定义）

| 变量 | 作用 |
|------|------|
| `--default-selection` | 编辑区中选中文本的背景色（可选，不定义则使用浏览器默认选中色） |
| `--code-editor-theme-light` | 浅色模式代码块的语法高亮主题名 |
| `--code-editor-theme-dark` | 深色模式代码块的语法高亮主题名 |
| `--source-code-theme-light` | 浅色模式源代码编辑器的语法高亮主题名 |
| `--source-code-theme-dark` | 深色模式源代码编辑器的语法高亮主题名 |

`--code-editor-theme-*` 和 `--source-code-theme-*` 的可用值（语法高亮主题名称）：

```
oneDark         materialDark    githubDark      githubLight
dracula         atomone         vscodeDark      xcodeDark
xcodeLight      eclipse         sublime         basicLight
tokyoNightDay   bbedit          solarizedLight
```

---

### 三、编辑器内容样式（在 `#writer {}` 中定义）

以下选择器可用于自定义编辑器内容区域的样式：

```css
#writer h1              /* 一级标题 */
#writer h2              /* 二级标题 */
#writer h3              /* 三级标题 */
#writer h4              /* 四级标题 */
#writer h5              /* 五级标题 */
#writer h6              /* 六级标题 */
#writer p               /* 段落 */
#writer a               /* 链接 */
#writer code            /* 行内代码 */
#writer pre             /* 代码块 */
#writer pre code        /* 代码块内的代码（清除行内代码样式） */
#writer blockquote      /* 引用块 */
#writer ul              /* 无序列表 */
#writer ol              /* 有序列表 */
#writer li              /* 列表项 */
#writer ul li::marker   /* 无序列表标记点颜色 */
#writer ol li::marker   /* 有序列表编号颜色 */
#writer hr              /* 分割线 */
#writer table th        /* 表格表头 */
#writer table td        /* 表格单元格 */
#writer mark            /* 高亮标记 */
#writer ::selection     /* 文本选中样式 */
```

---

## 颜色格式

主题 CSS 文件中可以使用 hex、hsl、oklch 任意格式：

```css
--primary: #3b82f6;
--primary: hsl(217, 91%, 60%);
--primary: oklch(0.546 0.245 262.881);
```

**但视觉主题编辑器只完整支持 oklch 格式。** 使用 hex 或 hsl 的值虽然能在 CSS 中正常生效，但在编辑器的分组面板中不会被显示，且通过取色器编辑后会自动转为 oklch 格式。

推荐直接使用 OKLCH。它更接近人眼感知，色相一致性好，支持 `color-mix()` 函数。

推荐工具：[OKLCH Converter](https://oklch.com/)

---

## 颜色设计原则

每对 background/foreground 变量要保证可读性：

```
--background   / --foreground      主表面
--card         / --card-foreground  卡片表面
--popover      / --popover-foreground  弹出层
--primary      / --primary-foreground  主强调色
--secondary    / --secondary-foreground  次要色
--muted        / --muted-foreground  弱化色
--accent       / --accent-foreground  交互高亮色
--sidebar      / --sidebar-foreground  侧边栏
```

典型关系参考：

- `--foreground` 在 `--background` 上高对比度（如 #111 在 #fff 上）
- `--muted-foreground` 比 `--foreground` 更淡（如 #666 在 #fff 上）
- `--muted` 略深于 `--background`（如 #f5f5f5 在 #fff 上）
- `--border` 比背景深 10-15%
- `--primary` 是应用中最醒目的颜色
- `--sidebar` 系列通常与主色系略有区别

---

## 高亮颜色（mark 标签）

文本高亮的背景色（`<mark>`）现在由**高亮插件**提供：在「设置 → 插件 → 高亮」中选择预设色板，或用取色器自定义颜色，改动即时生效。

主题作者**无需**（也不应）在主题里定义 `--highlight-color`：它已不属于主题变量，主题编辑器不再读取、编辑或导出该变量，内置主题模板也不再包含它。

> 旧主题若仍保留 `--highlight-color` 声明，建议删除——该变量已交由高亮插件管理，继续保留可能与插件设置相互覆盖。

---

## 自定义主题变量

可以定义主题独有的 CSS 变量来组织颜色：

```css
:root {
  --mytheme-code-bg: color-mix(in oklch, var(--primary) 10%, var(--background));
  --mytheme-link-color: var(--primary);
  --mytheme-blockquote-bg: var(--muted);
}

.dark {
  --mytheme-code-bg: color-mix(in oklch, var(--primary) 15%, var(--background));
}

#writer code {
  background: var(--mytheme-code-bg);
}

#writer a {
  color: var(--mytheme-link-color);
}
```

---

## 安全限制

导入主题时以下内容会被拒绝：

| 内容 | 原因 |
|------|------|
| `url(http` 或 `url(https` | 禁止引用外部资源 |
| `@import` | 禁止加载外部样式 |
| `@font-face` | 字体通过应用设置管理 |

---

## 配色思路建议

1. **从 `--background` 和 `--foreground` 开始**，确定底色和文字色
2. **确定 `--primary` 和 `--muted`**，这是使用最广的两个变量
3. **用 `--muted-foreground` 设置次要文字**，让界面有层次
4. **确定 `--border`**，比背景深 10-15% 即可
5. **侧边栏独立配色**，通常比主区略深形成视觉区分
6. **最后调 `--chart-1` 到 `--chart-5`**，确保五色可区分
7. **深色模式**：深色不是浅色的反色。色相要偏移（通常偏蓝），饱和度降低，对比度保持

---

## 完整主题模板

```css
/**
 * 主题名称
 * 简短描述
 */

/* ==================== 浅色模式 ==================== */

:root {
  /* ---- Surface ---- */
  --background: oklch(1 0 0);
  --foreground: oklch(0.25 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.25 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.25 0 0);

  /* ---- Accents ---- */
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --breathe-color: oklch(0.646 0.222 41.116);

  /* ---- Feedback ---- */
  --destructive: oklch(0.577 0.245 27.325);
  --warning: oklch(0.621 0.178 26.1);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);

  /* ---- Boundaries ---- */
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);

  /* ---- Charts ---- */
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);

  /* ---- Sidebar ---- */
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.25 0 0);
  --sidebar-primary: oklch(0.205 0 0);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.9 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);

  /* ---- Special ---- */
  --color-scheme: light;
}

/* ==================== 深色模式 ==================== */

.dark {
  --background: oklch(0.176 0.014 258.4);
  --foreground: oklch(0.943 0.011 243.7);
  --card: oklch(0.22 0.016 256.8);
  --card-foreground: oklch(0.943 0.011 243.7);
  --popover: oklch(0.22 0.016 256.8);
  --popover-foreground: oklch(0.943 0.011 243.7);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.176 0.014 258.4);
  --secondary: oklch(0.267 0.015 256.8);
  --secondary-foreground: oklch(0.943 0.011 243.7);
  --accent: oklch(0.267 0.015 256.8);
  --accent-foreground: oklch(0.943 0.011 243.7);
  --breathe-color: oklch(0.715 0.152 253.3);
  --destructive: oklch(0.586 0.201 26.8);
  --warning: oklch(0.668 0.164 24.7);
  --muted: oklch(0.267 0.015 256.8);
  --muted-foreground: oklch(0.662 0.018 250.9);
  --border: oklch(0.33 0.015 252.3);
  --input: oklch(0.5 0.015 256.8);
  --ring: oklch(0.715 0.152 253.3);
  --chart-1: oklch(0.715 0.152 253.3);
  --chart-2: oklch(0.695 0.181 145.6);
  --chart-3: oklch(0.72 0.14 79.9);
  --chart-4: oklch(0.73 0.15 34.1);
  --chart-5: oklch(0.732 0.167 301.7);
  --sidebar: oklch(0.22 0.016 256.8);
  --sidebar-foreground: oklch(0.943 0.011 243.7);
  --sidebar-primary: oklch(0.715 0.152 253.3);
  --sidebar-primary-foreground: oklch(0.943 0.011 243.7);
  --sidebar-accent: oklch(0.32 0.015 256.8);
  --sidebar-accent-foreground: oklch(0.943 0.011 243.7);
  --sidebar-border: oklch(0.33 0.015 252.3);
  --sidebar-ring: oklch(0.715 0.152 253.3);
  --color-scheme: dark;
}

/* ==================== 编辑器内容区域 ==================== */

#writer {
  --default-selection: oklch(0.6 0.25 255 / 0.3);
  --code-editor-theme-light: githubLight;
  --code-editor-theme-dark: githubDark;
  --source-code-theme-light: githubLight;
  --source-code-theme-dark: githubDark;
}

#writer ::selection {
  background: var(--default-selection);
}

/* ---- 自定义内容样式 ---- */

#writer h1 {
  position: relative;
  padding-bottom: 0.5em;
  border-bottom: 1px solid var(--border);
}

#writer a {
  color: var(--primary);
  text-decoration: none;
  border-bottom: 1px solid color-mix(in oklch, var(--primary) 25%, transparent);
}

#writer code {
  padding: 0.2em 0.4em;
  background: color-mix(in oklch, var(--foreground) 6%, transparent);
  border-radius: 4px;
  font-size: 0.85em;
}

#writer blockquote {
  border-left: 4px solid var(--border);
  padding: 0 1em;
  color: var(--muted-foreground);
}

#writer hr {
  height: 1px;
  background: var(--border);
  border: 0;
}

#writer table th {
  background: var(--muted);
  font-weight: 600;
}

#writer ul li::marker {
  color: var(--primary);
}

#writer ol li::marker {
  color: var(--primary);
  font-weight: 500;
}
```

---

## 调试方式

1. 在主题编辑器中选择"源代码"模式，直接编辑主题 CSS
2. 保存后效果即时生效
3. 应用内置了三个主题（默认为黑白灰、樱染为粉红调、惊蛰为绿色调），可作为配色参考

## 导出与分享

在主题编辑器中选中主题，点击"导出"，保存为 `.css` 文件分享给他人。对方通过"导入"功能使用。
