# FormFaker 技术设计文档

- 版本：v0.1（MVP）
- 日期：2026-09-14
- 配套：`docs/product-design.md`

## 1. 技术选型与原则

| 层 | 选型 | 理由 |
|----|------|------|
| 扩展规范 | Manifest V3 | Chrome 唯一现行规范 |
| 页面 UI（Popup / Options） | React 19 + TypeScript + Vite | 主流、列表状态管理简单 |
| content / background 脚本 | 原生 TS，esbuild 打包 IIFE | 不引框架，体积最小、注入最快 |
| 构建 | Vite（MPA：popup/options/demo 三个 HTML）+ esbuild（两个 worker 脚本） | 无 beta 插件依赖，确定性强 |
| 数据 | 自研生成器 + `china-division` 行政区划（构建期转换） | 中文合规数据 faker 覆盖不足 |
| 测试 | vitest + jsdom | 生成器/推断/分类/原生填充可单测 |

原则：

1. **按需注入**：manifest 不声明 `content_scripts`；点击图标时 `chrome.scripting.executeScript` 注入，配合 `activeTab`，未使用零开销。
2. **框架无关的填充**：文本类走「原生 value setter + 真实事件」；选择类走「真实 click 序列」模拟真人，天然兼容 React/Vue 受控组件与组件库内部状态。
3. **注册表扩展**：语义规则、生成器、控件选择器配置均为数据表，新增类型 = 加表项，不改流程代码。
4. **选择器集中配置**：组件库 DOM 差异全部收敛在 `core/scan/selectors.ts` 一处，便于按库版本维护与扩展。

## 2. 总体架构

```
┌──────────────────────────── Chrome ────────────────────────────┐
│                                                                 │
│  background.js (SW)          popup.html (React)                   │
│   · 轻量 SW（无 UI）        · 字段列表/编辑/重roll/排除         │
│   · scripting 注入 content.js · 填充/清除/撤销/覆盖开关         │
│   · 响应 ensureInject   ◄────►· chrome.tabs.sendMessage ──┐     │
│                                · chrome.storage 设置       │     │
│                                                            ▼     │
│  页面 (isolated world): content.js                           │    │
│   · scan: 候选收集→控件分类→label 提取→语义推断→生成值            │    │
│   · fill/clear: 按 kind 分派填充/清除策略；undo 快照              │    │
│   · 持有 id→Element 映射（会话期）                               │    │
└─────────────────────────────────────────────────────────────────┘
```

通信协议（runtime/tabs message，统一 `{type, ...payload}`，content 侧 `sendResponse` 异步回复）：

| type | 方向 | 载荷 | 返回 |
|------|------|------|------|
| `ping` | panel→content | - | `{ok:true}`（探测是否已注入） |
| `scan` | panel→content | `{overwrite, rules}` | `{fields: FieldDTO[], skipped: FieldDTO[]}` |
| `regen` | panel→content | `{id, rules}` | `{value}` |
| `fill` | panel→content | `{cmds:[{id,value}], overwrite}` | `{results:[{id,ok,error?}]}` |
| `clear` | panel→content | - | `{cleared, failed}`（failed 为框架单选组等不支持清空的控件数） |
| `undo` | panel→content | - | `{ok}` |

`rules` 为分层随机数据规则 `GenRules`（日期/时间格式、邮箱域名、手机号段、企业后缀），panel 从 `chrome.storage.sync` 读取（用户覆盖合并内置默认）后随消息下发；content 侧透传给生成器，自身不持久化规则。

panel 拿不到 content 响应时（未注入/页面导航后失效）→ 请求 background 重新注入后再重试一次。

## 3. 目录结构

```
FormFaker/
├─ docs/                     产品/技术设计文档
├─ public/manifest.json      MV3 清单
├─ scripts/
│  ├─ build-workers.mjs      esbuild 打包 content/background
│  └─ build-region.mjs       china-division → region-data.ts
├─ popup.html / options.html / demo.html       Vite MPA 入口
├─ src/
│  ├─ shared/                types.ts / messaging.ts / storage.ts / SettingsPanel.tsx
│  ├─ core/
│  │  ├─ scan/               selectors.ts / label.ts / classify.ts / index.ts
│  │  ├─ semantics/          rules.ts / infer.ts / link.ts
│  │  ├─ generators/         index.ts / geo.ts / pools.ts / region.ts + region-data.ts(生成物)
│  │  └─ fill/               dom.ts / files.ts / filepool.ts / strategies.ts
│  ├─ content/index.ts
│  ├─ background/index.ts
│  ├─ popup/                 App.tsx / components/ / main.tsx / styles.css
│  ├─ options/               App.tsx / main.tsx
│  └─ demo/                  main.ts（Vue3 + Element Plus 真实组件演示页）
└─ test/                     vitest 用例 + HTML fixture
```

## 4. 识别引擎（core/scan）

### 4.1 候选收集与去重

1. `WIDGET_SELECTORS`（组件库根选择器，按优先级）：
   `.el-cascader, .ant-cascader, .el-date-editor, .ant-picker, .el-select, .ant-select, .el-upload, .ant-upload, .el-switch, .ant-switch, .el-radio-group, .ant-radio-group, .el-checkbox-group, .ant-checkbox-group, .el-input-number, .ant-input-number, [role=combobox]`
2. 原生候选：`input, textarea, select, [contenteditable=true]`，排除 `type=hidden/button/submit/reset`。
3. 原生候选若 `closest(WIDGET_SELECTORS)` 命中 → 归属该 widget 根，不单独成字段（避免 el-select 内 input 与 widget 重复）。
4. widget 根嵌套时取最内层（`closest` 从自身向上第一个命中者）。
5. radio 按 `name` 分组为一个字段；checkbox 同名 ≥2 个为 checkbox-group，独立单个为 checkbox。

### 4.2 过滤

跳过：`disabled`（含祖先/`is-disabled` 类）、`readonly`（文本类）、不可见（`getClientRects().length === 0`）。
**白名单例外**：原生分支里若 `disabled`/`readonly` 控件的 label 命中 `LNGLAT_RE`（经纬度/坐标），不跳过、保留为可填（`targets=[el]`）——地图选点回填的坐标框设计上即禁用，需联动地址写入。
跳过项收集到 `skipped[]` 供面板折叠展示（含原因）。

### 4.3 控件分类（kind）

widget 根按类名映射 kind（cascader / daterange / datetime / date / multiselect / select-widget / upload-image / upload-file / switch / radio-group / checkbox-group / number）；
原生按 tagName + type 映射（textarea / select / multiselect / checkbox / radio-group / date / datetime / number / richtext / email / url / password / tel / text）。
upload 的 image/file 细分：`accept` 以 `image` 开头或含 upload-picture 类 → image。

### 4.4 label 提取（优先级）

1. `label[for=id]` 文本（预建 Map 索引，O(1)）
2. `closest('label')` 文本
3. form-item 容器内 label：`closest('.el-form-item,.ant-form-item,[class*=form-item]')` 内 `.el-form-item__label,.ant-form-item-label,label` 文本
4. `aria-label` / `title`
5. `placeholder`
6. `name` / `id`（去下划线驼峰美化）
清洗：去 `*`、`:`、`：`、空白折叠。

### 4.5 输出 FieldDTO

```ts
{ id, label, kind, semantic, value, optionTexts?, skipped?, reason? }
```

- `optionTexts`：原生 select / radio / checkbox 组可直接读到的选项文本（用于语义匹配选项与面板展示）。
- 组件库下拉/级联的选项需展开才可得 → `value` 置 `(填充时随机选择)`，填充时现场读取。
- 值生成在 content 侧完成（scan 时即带初值），面板只做展示与编辑。

## 5. 语义推断（core/semantics）

- haystack = `label + placeholder + name + id + aria-label` 小写拼接。
- `rules.ts` 为有序数组 `{semantic, re}`，首个命中即返回；顺序即优先级（手机>电话、信用代码>账号、邮箱>地址、经纬度>地区/地址）。
- 兜底：按 kind 给默认语义（select/radio/checkbox→`enum`，cascader→`region`（若 label 无命中仍默认按地区路径生成，填充时以页面真实选项为准回退随机路径），textarea→`paragraph`，number→`amount`，text→`generic`）。
- **跨字段联动（core/semantics/link.ts）**：`证照/证件类型`（选项类控件）与 `证照/证件号码`（文本类控件）配对。号码字段的语义不取自自身 label，而由类型字段的**当前 DOM 选中项**决定（`currentOptionText` 读 select selectedOptions / radio checked / EP·AntD 选中项文本）；若类型为空则用其计划生成值（填充顺序类型在前，保持一致）。映射：统一社会信用代码→`creditCode`、居民身份证→`idNumber`、护照→`passport`、其他/军官/港澳等→`generic`。scan 建立 numberId→typeId 链接，regen 号码时按类型当前值重新解析。
- **地址→经纬度联动（`resolveGeoLink`）**：每个 `lnglat` 字段配一个地址/地区源。源按**表单作用域**选取——用 `closest('form, .el-form, .ant-form, [role="form"]')` 取经纬度字段所在表单，优先选同表单内的 `address`/`region` 字段；经纬度无表单祖先时回退全局第一个源。命中后令 `lnglat.value = coordForText(source.value)`，并返回 `lnglatId→sourceId` 供 regen 重新解析。表单作用域避免多表单页（如原生表单 + EP 表单各带地址）把坐标错链到别的表单。

## 6. 数据生成器（core/generators）

接口：`type Generator = (ctx: {kind, semantic, optionTexts?, rand}) => string`；注册表 `Map<semantic, Generator>`。

要点：

- **phone**：号段表 `13x/14x/15x/16x/17x/18x/19x` 有效前缀 + 8 位随机。
- **idNumber**：真实县区的 6 位行政区划码 + 1960~2005 出生日期 + 3 位顺序码 + GB 11643 校验位。
- **creditCode**：18 位，字符集 `0-9A-HJ-NP-RTUW-XY`（去 I,O,S,V,Z），前 2 位登记管理部门/类别码、3~8 位行政区划码、9~17 位主体标识码、第 18 位 GB 32100 加权校验位。
- **passport**：护照号，`E/G/P/EA` 前缀 + 8 位数字（供证照联动映射）。
- **bankCard**：16~19 位 + Luhn 校验位。
- **region**：省/市/区三级随机路径，返回 `省/市/区` 串；填充时拆层点击。数据源 `china-division` 的 provinces/cities/areas JSON，构建期脚本转成紧凑数组（`[code,name,parent]`）提交为 `region-data.ts`（约 90KB，一次性加载）。
- **address**：region 路径 + 路名池 + 门牌 + 室号。
- **lnglat（`geo.ts`）**：离线推导坐标，无任何网络请求。`coordForText(text)` 用 `parseRegionNames` 从地址串里匹配省/市名（对照 region-data 的 PROVINCES/CITIES 表），再经 `cityCenter(province, city)` 返回 6 位小数 `lng,lat` 串。`cityCenter` 先查 `CITY_CENTERS[city]` 精确质心，未命中回退 `PROVINCE_CENTERS[province]`（已种子化 34 个省级行政中心），再回退全国中心；并叠加由字符串 hash 决定的确定性抖动（经度跨度 ~1.0、纬度 ~0.8），避免同名城市塌缩到同一点。**精度现状**：`CITY_CENTERS` 目前为空，是单文件替换点——坐标为省级行政中心精度，非市/区级；把真实城市质心表填入 `CITY_CENTERS` 即可升级精度，无需改动其他代码。无地址兄弟字段时，独立 `lnglat` 生成器随机取一条 region 路径并返回其质心。
- **company**：城市名 + 字号池(2 字) + 行业池 + 组织形式池。
- **date/datetime/daterange**：合理区间（成立日期类语义偏历史，通用语义近 ±3 年）；格式随 kind。
- **amount/integer**：label 含 资本/资金/人数/数量/营业额/营收/销售额/收入/利润/产值 或带单位后缀（元）时按整数元（1万~5亿 的整万）生成，适配「注册资本/实缴资金（单位:元）」「上年度营业额（元）」类校验；其余金额 1万~5亿 两位小数。integer 识别 人数/人员/数量/个数/件数/年限/年数/工龄/司龄 及带单位后缀（条/年/个/台/人/名/次/套/家/项/支，**不含元**以免金额被当计数），且规则排在 date 之前——「实际运营时间（年）」因此按年数而非日期；年限类生成 1~30 的合理年数，其余计数 1~999 整数。
- **paragraph**：句池随机 2~4 句拼接（50~150 字）。
- **enum（选项驱动）**：`optionTexts` 非空时优先语义匹配（如 gender→男/女），否则随机一项；组件库选项在填充时读取，生成阶段返回空标记。
- **image/file**：值仅为展示占位（`[图片 test-xxxx.png]`）；真实 File 在填充阶段按「文件池优先 + 合成回退」生成：
  - 文件池优先：`filepool.ts` 从 `chrome.storage.local`（key `ff.filepool`）读取用户预设文件，按控件 `accept` 令牌匹配（`.ext` / `type/sub` / `type/*`，空 accept 匹配任意，且 upload-image 空 accept 优先 `image/*`），命中后 base64 → `Uint8Array` → `new File([bytes], name, {type})`。
  - 合成回退（池为空或无匹配时）：PNG 用 content 侧 canvas 画随机色块+文字 → `toBlob`；PDF 用内置最小合法 PDF 字节模板（含随机 ID），`new File([bytes], name, {type:'application/pdf'})`；按 `accept` 选择：image/* → png；含 pdf → pdf；其余 → pdf。

## 7. 填充引擎（core/fill）

### 7.1 通用工具（dom.ts）

- `setNativeValue(el, v)`：取 `HTMLInputElement/HTMLTextAreaElement.prototype` 的 value setter 调用，再 dispatch `input`(InputEvent, bubbles) + `change`。→ 打通 React/Vue 受控组件。
- `realClick(el)`：`mousedown → mouseup → click` 全序列（Ant 系靠 mousedown 展开）。
- `waitUntil(pred, timeout=2000)`：rAF 轮询，超时抛错记入 results。
- `visibleOptions(panelSel, itemSel)`：过滤不可见项。
- `pressEnter(el)` / `blur(el)`：日期组件确认输入。
- 快照：填充前对每个目标记录 `{value | checked | innerHTML}` 入栈，`undo` 逆序恢复（files 无法还原，文档明示）。

### 7.2 分 kind 策略（strategies.ts）

| kind | 策略摘要 |
|------|---------|
| text/textarea/number/email/url/tel/password | `setNativeValue` |
| select（原生） | 按文本或 value 找 option → 设 `select.value` → `change`+`input` |
| select-widget / multiselect | `realClick(trigger)` → `waitUntil` 面板可见 → 选项项（`.el-select-dropdown__item` / `.ant-select-item-option` / `[role=option]`）文本匹配（无值则随机）→ `realClick`；multiselect 点 2 项后 `Esc` 关闭 |
| cascader | 值按 `/` 拆层；逐层 `waitUntil` 第 n 列菜单（`.el-cascader-menu` / `.ant-cascader-menu`）→ 点匹配节点（`.el-cascader-node` / `.ant-cascader-menu-item`，文本去尾空格）；值与页面选项不符时回退「每层随机」 |
| date/datetime | 内层 input（`.el-date-editor input` / `.ant-picker-input input` / 自身）`setNativeValue` → `pressEnter` → `blur` |
| daterange | 两个内层 input 依次：值 + Enter；第二个 blur |
| radio-group | 目标 = 文本匹配或随机的 label/wrapper → `realClick` |
| checkbox / checkbox-group / switch | 期望态与当前态不同才 `realClick`（group 点 1~2 项） |
| upload-image / upload-file | 生成 File → `DataTransfer` → 赋 `input.files` → dispatch `change`(bubbles) |
| richtext | `el.innerHTML = '<p>…</p>'` + `InputEvent('input')`（Quill/wangEditor 的 MutationObserver 会自同步） |

失败处理：单字段失败不中断批次，`results[i].error` 回传面板标红。

### 7.3 批量节奏

原生类字段每 50 个一片夹 `requestAnimationFrame`，避免长任务；widget 类天然串行（各自 await 展开）。

### 7.4 条件渲染字段补填（scanRevealed）

向导式表单里，某些区块只在父级下拉/单选被赋值后才渲染（如「企业生产类型=生产性企业」才出现产线数量输入框）。这类控件在 scan 时还不存在，字段表里没有它们，单次 fill 会漏填。`handleFill` 在主循环后追加补填轮：调用 core 的 `scanRevealed(knownTargets)`——重扫文档并只返回「非 skipped 且 fill targets 不在已跟踪集合内」的新候选；为每个新候选在字段表登记 id/语义/生成值，取快照并填充。每轮前等一帧 `requestAnimationFrame` 让框架完成渲染；最多 2 轮以约束级联揭示。新字段进入字段表，故清除/撤销覆盖它们；Popup 列表不自动刷新（以页面实际值为准）。

## 8. 运行时

- **background**：轻量 SW，仅响应 popup 的 `ensureInject` → `scripting.executeScript(content.js)`（幂等：content 内 `globalThis.__ffLoaded` 守卫）。popup 由 manifest `action.default_popup` 在点击图标时自动打开，无需 background 参与（也避开在 `action.onClicked` 里 await 后再开 UI 丢失用户手势的坑）。permissions：`scripting, storage, activeTab, unlimitedStorage`（unlimitedStorage 支撑文件池写入 `storage.local`）+ `host_permissions:<all_urls>`（保证任意业务页可注入，不依赖 activeTab 授予时机）。
- **content**：模块级 `Map<id, FieldRuntime>` 持有元素引用与快照；`scan` 重建，并同时建立两张联动表（`credLinks: numberId→typeId`、`geoLinks: lnglatId→sourceId`）。`regen` 按联动表重新解析：重roll 证照号码时读类型字段当前选中项重定语义；重roll 地址时同步刷新其关联经纬度的坐标；重roll 经纬度时从其源地址重新推导。tab 导航后映射失效，panel `ping` 失败触发重注入 + 重扫。
- **popup**：React，两个窗内视图——字段列表与内嵌设置页，由「设置 / ← 返回」按钮切换（`view` 状态），设置不再开新标签页。设置 UI 抽成共享组件 `src/shared/SettingsPanel.tsx`，popup 设置视图与独立选项页（`options.html`，现仅作 `chrome://extensions` 的兜底入口）共用。字段列表行内 `content-visibility:auto` 降低长列表渲染成本；UI 状态仅内存，关弹窗即弃（填充/撤销/清除的真状态在 content 侧，关弹窗不丢）。popup 尺寸在 styles.css 固定为 400×600（Chrome 上限 800×600），设置视图内容超出时由 `main` 滚动。
- **storage**：`ff.settings = {overwrite:boolean, rules:GenRules}`（sync；`loadSettings` 深合并内置默认）；`ff.filepool = PoolEntry[]`（local；每项 `{name,type,size,data(base64)}`，上限 10 个 / 单个 2MB）。

## 9. 性能设计汇总

| 风险 | 对策 |
|------|------|
| 常驻脚本拖慢被测页 | 按需注入，无 content_scripts 声明，无常驻 observer |
| 大表单扫描卡顿 | 单次 querySelectorAll + label Map 索引；无布局抖动（读批/写批分离） |
| 填充长任务 | 分片 rAF；widget 串行 await |
| 面板长列表 | content-visibility + 简单键控渲染（≤千行无需虚拟滚动） |
| 包体积 | content/background IIFE 无框架；region 数据仅 content 侧静态引入（~90KB 可接受）；UI 侧不引组件库 |

## 10. 扩展性设计

新增一种「语义 + 生成器」：`rules.ts` 加一行正则 + `generators` 注册一个函数。
新增一种「控件」：`selectors.ts` 加 widget 选择器项 + `classify` 映射 + `strategies` 一个 case。
新增一种「随机数据规则」维度：`types.ts` 的 `GenRules` 加字段 + `DEFAULT_GEN_RULES` 给默认 + `SettingsPanel` 的 `RULE_FIELDS` 加一行 + 对应生成器读取 `ctx.rules`。
已落地（V1）结构化自定义规则：设置面板（`SettingsPanel`，Popup 内嵌设置视图 + 选项页共用）表单（日期/时间格式、邮箱域名、手机号段、企业后缀）→ `chrome.storage.sync` → `loadSettings` 深合并（`{...DEFAULT_GEN_RULES, ...user}`，留空回退默认）→ panel 随 `scan/regen` 下发 → 生成器按 `ctx.rules` 取值，优先级高于内置。
已落地（V1）上传文件池：设置面板选本地文件（单个 ≤2MB、最多 10 个）→ base64+元数据存 `chrome.storage.local`（key `ff.filepool`）→ content 侧 `loadFilePool` 读取。规则用 `storage.sync`（小、需跨设备同步），文件池用 `storage.local`（体积大），并新增 `unlimitedStorage` 权限以突破默认 5MB 配额。
V1.1 进阶：在结构化规则之上叠加语义规则/生成器的 JSON 级编辑器（scan/infer 时合并用户表）。

## 11. 构建与脚本

```
pnpm build     = vite build (popup/options/demo) && node scripts/build-workers.mjs
pnpm dev       = 同上两者 --watch（两个终端）
pnpm test      = vitest run
pnpm region    = node scripts/build-region.mjs（依赖安装后跑一次，产物已提交）
pnpm preview   = vite preview → http://localhost:4173/demo.html 手工验证
```

dist 即加载目录：`manifest.json`、`background.js`、`content.js`、`popup.html`、`options.html`、`icons/` 均在 dist 根。

## 12. 测试策略

- 单测（vitest+jsdom）：
  1. 生成器：phone 号段正则、idNumber/creditCode/bankCard 校验位函数反验、region 路径层级合法、daterange 起<止。
  2. 语义推断：fixture 标签（受理组织/联系电话/注册资本/注册地区…）命中期望语义；优先级用例（手机 vs 电话）。
  3. 控件分类：fixture HTML（原生 + Element/Ant 类名结构）→ kind 矩阵断言；disabled/hidden 过滤；`scanRevealed` 条件渲染补扫——初扫后新插入的控件恰被返回一次、可填充、更新已知集合后二轮为空。
  4. 原生填充：jsdom 中 setNativeValue 后 input 收到事件且 value 生效；select/checkbox/radio 路径。
  5. 经纬度（`test/geo.test.ts`）：lnglat 语义推断；禁用坐标框被白名单放行而其他禁用字段仍跳过；`coordForText` 确定性 + 落在对应省 bbox 内 + 无已知省时返回 null；`resolveGeoLink` 令 lnglat 值等于 `coordForText(地址值)`，且**表单作用域**配对——多表单页里链到同表单地址而非全局第一个地址类字段。
- 手工：demo 页（原生区 + Element Plus 真实组件区，含 cascader/date/upload/switch、「注册地址 + 禁用经纬度」联动样例、以及「企业生产类型→v-if 揭示产线数量」条件渲染样例）加载扩展全流程；联动与条件渲染样例均已用 dev harness（`window.__ff`）在真实浏览器端到端验证（扫描白名单、同表单配对、禁用框写入、坐标一致；条件字段初扫不存在→父级赋值后渲染→scanRevealed 精确返回→填入数字→二轮为空）；SRM 风格长表单截图页人工核对覆盖率。
- 缺口明示：Ant Design 路径与真实浏览器事件序列无自动化覆盖，依赖 demo 人工 + 选择器集中配置降低维护成本。

## 13. 风险与对策

| 风险 | 对策 |
|------|------|
| 组件库版本 DOM 变化（如 Element Plus 2.x select 结构改版） | 选择器多版本并存（`.el-select__wrapper`/`.el-input__inner` 均列入 trigger）；role 兜底 |
| 日期组件拒绝键入 | Enter+blur 双确认；失败回传面板可手填 |
| SPA 路由切换后字段失效 | ping 失败→重注入+重扫；面板提示「页面已变化，请重新识别」 |
| iframe 表单 | MVP 不覆盖，V1.1 all_frames |
| 上传组件自定义 http 上传按钮（无 input[file]） | 识别为 skipped 并提示原因 |
| 经纬度坐标精度（当前为省级行政中心，非市/区级） | `geo.ts` 为单文件替换点：把真实城市质心表填入 `CITY_CENTERS` 即升级精度，无需改其他代码；坐标全程离线推导，无网络/隐私风险 |

## 14. 里程碑

- M1：设计文档（本文 + 产品文档）✅
- M2：骨架 + 识别 + 生成器 + 单测
- M3：填充引擎 + content/background + Popup 主界面
- M4：demo 页 + 构建/测试全绿 + 手工验收清单
