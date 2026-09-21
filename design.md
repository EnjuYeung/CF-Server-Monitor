# Design — Server Monitor · 樱昼 / 星夜

用户于 2026-09-21 确认的全站设计系统。首页、节点详情、登录和后台共用，不按页面重新选择主题。

## Genre and structure

Atmospheric，柔和、梦幻且以监控读数为先。应用采用 Workbench 家族的功能层次：简洁页头（N9）、统计摘要、操作与筛选、数据内容、单行署名页脚（Ft2）。这里是实际应用，不是营销页面，不添加宣传区或模拟浏览器边框。

## Theme

樱昼：樱白背景、浅粉表面、莓粉强调；星夜：深靛底色、紫灰表面、淡粉强调。所有新色彩通过根目录 tokens.css 定义的 OKLCH 变量使用；映射既有变量与 shadcn 语义变量。指标的绿/红/蓝具有业务含义，服务器自定义标签保留其独立色表。弹窗使用实色表面，不在每张卡片上执行背景模糊。

## Typography

标题和正文优先使用本机苹方（PingFang SC），无该字体时回退系统黑体；不加载霞鹜文楷。正文 14–16px，行高 1.5。代码：系统等宽。数字使用 tabular-nums。现有 emoji 按用户要求保留。

## Dashboard layout

首页页头左侧为樱花与站点标题，右侧为等尺寸设置按钮；窄屏标题可省略，按钮不压缩。下方先显示统计摘要，再显示统一工具区：桌面左侧直接排列地区/分组筛选按钮，不添加前置文字标签，右侧视图切换；960px 以下视图切换独占首行，随后排列地区和分组。统一边界与间距，筛选直接靠近节点列表。

## Spacing and components

4px 基准，8/12/16/24/32/48px 命名间距。卡片 12px、控件及地区筛选 8px 圆角；控件默认 40px，触屏 44px。shadcn-vue 的 Button、ToggleGroup、Dialog 作为可组合基础，样式由语义变量管理。选中、禁用、加载、错误、键盘焦点均需可辨识。表单标签不依赖占位符，弹窗标题及焦点约束保留。

## Motion and explicit user exceptions

用户明确要求装饰动画与保留 emoji，覆盖 Hallmark 的应用不加装饰、无限动画和 emoji 默认禁令。白天最多 18 片花瓣、夜晚最多 32 颗星，手机分别 8/16；只动画 transform/opacity，不引入动画库、画布循环或逐帧 Vue 更新。后台标签页暂停；减少动态效果及用户关闭时不运行动效。提供持久化动效按钮。明暗仍遵循已有手动/跟随系统行为，不另行按时钟切换。

## Responsive and verification

至少验证 320/375/414/768/1440px，两种主题、三种首页视图、详情、后台、登录及弹窗。全页禁止水平滚动，宽数据表允许自身横向滚动。装饰不接受指针、不出现在无障碍树。用真实隔离主控与浏览器记录布局、交互、帧时间、任务耗时和请求体积；不将合成短测宣传为低端手机性能保证。

## Exports

tokens.css 是可导入的完整 CSS token 源；前端主题样式引用这些变量。以下为四种格式的核心导出示例，完整明暗色表以 tokens.css 为准。

### CSS

```css
@import './tokens.css';
.surface { background: var(--card); color: var(--foreground); border-radius: var(--radius-card); }
```

### Tailwind v4

已集成在 src/frontend/styles/main.css，无需额外粘贴或启用 preflight。新项目可使用以下语义映射：

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-ring: var(--ring);
}
```

### DTCG JSON

```json
{
  "light": {
    "paper": { "$type": "color", "$value": "oklch(97% .009 355)" },
    "ink": { "$type": "color", "$value": "oklch(29% .027 325)" },
    "accent": { "$type": "color", "$value": "oklch(47% .15 355)" }
  },
  "dark": {
    "paper": { "$type": "color", "$value": "oklch(19% .029 280)" },
    "ink": { "$type": "color", "$value": "oklch(94% .009 340)" },
    "accent": { "$type": "color", "$value": "oklch(82% .096 355)" }
  },
  "font": { "display": { "$type": "fontFamily", "$value": ["PingFang SC", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", "sans-serif"] } },
  "space": { "panel": { "$type": "dimension", "$value": { "value": 1.5, "unit": "rem" } } },
  "duration": { "micro": { "$type": "duration", "$value": { "value": 120, "unit": "ms" } } }
}
```

### shadcn-vue variables

本项目使用 Tailwind v4 的完整 CSS 颜色值，而非旧版 HSL/OKLCH 数字三元组；body.light 是既有主题切换入口。

```css
body {
  --background: var(--color-paper);
  --foreground: var(--color-ink);
  --card: var(--color-paper-2);
  --card-foreground: var(--color-ink);
  --primary: var(--color-accent);
  --primary-foreground: var(--color-accent-ink);
  --muted: var(--color-paper-3);
  --muted-foreground: var(--color-ink-2);
  --border: var(--color-rule);
  --input: var(--color-input-rule);
  --ring: var(--color-focus);
}
```

## Visual review

Hallmark 引导了 Workbench 信息层次、标题/正文分工、语义色与统一焦点状态；shadcn-vue 提供 Button、ToggleGroup、Tabs 和 Dialog 的交互基础。按截图复核后修正了旧 CSS 覆盖弹窗定位、视图选中态文字颜色、重复嵌套卡片边框。现有 emoji、自定义标签颜色和业务状态颜色保留。对继承样式未宣称全部 58 项通用门禁通过；新界面按本项目数据密集场景与用户明确动效要求验收。
