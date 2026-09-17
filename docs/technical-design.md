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
│  ├─ build-workers.mjs      esbuild 打包 content/background/harness（harness 仅 dev 自检用）
│  └─ build-region.mjs       china-division → region-data.ts
├─ popup.html / options.html / demo.html       Vite MPA 入口
├─ src/
│  ├─ shared/                types.ts / messaging.ts / storage.ts / rules.ts / SettingsPanel.tsx
│  ├─ core/
│  │  ├─ scan/               selectors.ts / label.ts / classify.ts / scroll.ts / index.ts
│  │  ├─ semantics/          rules.ts / infer.ts / link.ts
│  │  ├─ generators/         index.ts / geo.ts / pools.ts / region.ts + region-data.ts(生成物)
│  │  └─ fill/               dom.ts / files.ts / filepool.ts / lookup.ts / strategies.ts
│  ├─ content/               index.ts / guard.ts（重注入守卫，活性探针）
│  ├─ background/index.ts
│  ├─ popup/                 App.tsx / components/ / main.tsx / styles.css
│  ├─ options/               App.tsx / main.tsx
│  ├─ demo/                  main.ts（Vue3 + Element Plus 真实组件演示页）
│  └─ dev/                   harness.ts（window.__ff，含一键 selfCheck）/ audit.ts（独立期望表落地审计）
│                            → dist/harness.js，manifest 不引用，按需注入
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
**白名单例外 2（lookup）**：文本类 `readonly` 且未 `:disabled` 的输入框，若在其 `.el-input/.ant-input-*` 包裹层、所在单元格/表单项、或父元素三个作用域内找到「放大镜/搜索/选择」类触发节点（`findLookupTrigger`：按类名/aria-label/title 命中 `search|lookup|zoom|magnif|picker` 或文本为 选择/查询/搜索/…，再回退到 `.el-input-group__append button`、`.el-input__suffix .el-icon`、`.ant-input-suffix .anticon` 等插槽选择器），则判为 `lookup` 字段并保留 `trigger` 引用——它的值来自弹窗选择（清算会员号/联行号等），不是死字段。可编辑输入框即使带搜索图标仍按 `text` 处理。
**白名单例外 3（upload）**：`input[type=file]` 天生 `display:none`（用户点自定义按钮才唤起系统选择器），按可见性跳过会漏掉整类原生上传字段，故 `upload-image/upload-file` 不做可见性判断。
跳过项收集到 `skipped[]` 供面板折叠展示（含原因）。

### 4.3 控件分类（kind）

widget 根按类名映射 kind（cascader / daterange / datetime / date / multiselect / select-widget / upload-image / upload-file / switch / radio-group / checkbox-group / number）；
原生按 tagName + type 映射（textarea / select / multiselect / checkbox / radio-group / date / datetime / number / richtext / email / url / password / tel / text）。

upload 的 image/file 细分：`accept` 以 `image` 开头或含 upload-picture 类 → image。

**提示文字纠正（`hintSaysImage`）**：真实页的上传控件常常不带 `accept`（限制写在 `before-upload` 里），按 accept 分类会落到 `upload-file` 并注入合成 PDF——页面上表现为「图片格式不正确」，用户只看到缩略图裂开。故两条分支（widget 与原生）在判出 `upload-file` 后，都再检查字段作用域文本是否命中 `IMAGE_HINT_RE`（图片/照片/头像/image/jpe?g/png/gif/webp/bmp/「尺寸大小为 数字」），命中即改判 `upload-image`。反向不改：带 `accept=pdf` 的字段即使提示里有「图片」字样也保持 `upload-file`，因为 accept 是更强的信号。
`lookup` 不由类名映射得出，而是 4.2 的「只读输入框 + 选择触发节点」组合判定，`FieldCandidate` 上额外带 `trigger` 元素引用。

### 4.4 label 提取（优先级）

1. `label[for=id]` 文本（预建 Map 索引，O(1)）
2. `closest('label')` 文本
3. form-item 容器内 label：`closest('.el-form-item,.ant-form-item,[class*=form-item]')` 内 `.el-form-item__label,.ant-form-item-label,label` 文本
4. **表格列头关联（`columnHeaderFor`）**：控件位于 `td/th/[role=gridcell]/[role=cell]` 内时，列头即其 label。依次尝试
   - 单元格 `headers` 属性指向的元素文本；
   - 按 `colspan` 展开算出自身列号后，在 `thead` 最后一行（自下而上回溯多级表头）取同列文本；
   - ARIA 网格：`aria-colindex` 与 `[role=columnheader]` 配对；
   - 作用域回退：EP/AntD 把表头与表体放在兄弟 `<table>` 里，故自身 table 无 `thead` 时改用 `closest('.el-table, .ant-table')` 作为查找范围。
   没有这一步，表格内可编辑单元格只能拿到「请输入」或框架自动生成的 id（如 `el id 5559 2`），姓名/手机号/邮箱/银行账号等语义全部丢失。
5. `aria-label` / `title`
6. `placeholder`
7. `name` / `id`（去下划线驼峰美化）
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
- **company**：城市名 + 字号池(2 字) + 行业池 + 组织形式池。关键词含 公司/企业名/单位名称/供应商名称/合作客户/客户名称/客户单位/company/vendor/supplier；**刻意不匹配裸「客户」**，否则「客户联系人」会被判成企业名而不是人名。
- **date/datetime/daterange**：合理区间（成立日期类语义偏历史，通用语义近 ±3 年）；格式随 kind。
- **amount/integer**：label 含 资本/资金/人数/数量/营业额/营收/销售额/收入/利润/产值 或带单位后缀（元）时按整数元（1万~5亿 的整万）生成，适配「注册资本/实缴资金（单位:元）」「上年度营业额（元）」类校验；其余金额 1万~5亿 两位小数。integer 识别 人数/人员/数量/个数/件数/年限/年数/工龄/司龄/**区号** 及带单位后缀（条/年/个/台/人/名/次/套/家/项/支，**不含元**以免金额被当计数），且规则排在 date 之前——「实际运营时间（年）」因此按年数而非日期；年限类生成 1~30 的合理年数，其余计数 1~999 整数。区号必须显式命中：它常落在 `el-input-number` 上，而 `fallbackSemantic('number')` 是 amount，兜底会生成 `34031.76` 这类小数写进整数框。
- **paragraph**：句池随机 2~4 句拼接（50~150 字）。
- **enum（选项驱动）**：`optionTexts` 非空时优先语义匹配（如 gender→男/女），否则随机一项；组件库选项在填充时读取，生成阶段返回空标记。
- **lookup（弹窗选择）**：生成阶段只返回 `RANDOM_OPTION_PLACEHOLDER`（面板显示「(填充时随机选择)」），真实值由填充阶段在弹窗里选第一条记录决定——候选记录是业务主数据，本地无从伪造。
- **image/file**：值仅为展示占位（`[图片 test-xxxx.png]`）；真实 File 在填充阶段按「文件池优先 + 合成回退」生成：
  - 文件池优先（须先过门槛）：`filepool.ts` 从 `chrome.storage.local`（key `ff.filepool`）读取用户预设文件，按控件 `accept` 令牌匹配（`.ext` / `type/sub` / `type/*`，空 accept 匹配任意，且 upload-image 空 accept 优先 `image/*`），命中后 base64 → `Uint8Array` → `new File([bytes], name, {type})`。匹配前先用 `entryMeetsHints` 剔除不满足字段声明门槛的条目（体积超限、或图片解码尺寸与要求不符），全部不合格时走合成回退——见 §7「上传图片尺寸与拒收自报」。
  - 合成回退（池为空或无匹配时）：PNG 用 content 侧 canvas 画随机色块+文字 → `toBlob`；PDF 用内置最小合法 PDF 字节模板（含随机 ID），`new File([bytes], name, {type:'application/pdf'})`；按 `accept` 选择：image/* → png；含 pdf → pdf；其余 → pdf。

## 7. 填充引擎（core/fill）

### 7.1 通用工具（dom.ts）

- `setNativeValue(el, v)`：取 `HTMLInputElement/HTMLTextAreaElement.prototype` 的 value setter 调用，再 dispatch `input`(InputEvent, bubbles) + `change`。→ 打通 React/Vue 受控组件。
- `realClick(el)`：`mousedown → mouseup → click` 全序列（Ant 系靠 mousedown 展开）。
- `waitUntil(pred, timeout=2000)`：rAF 轮询，超时抛错记入 results。
- `visibleOptions(panelSel, itemSel)`：过滤不可见项。
- `pressEnter(el)` / `blur(el)`：日期组件确认输入。
- `ensureInView(el)`：控件 `getBoundingClientRect()` 为空盒（宽高皆 0，如 `content-visibility:auto` 未渲染区）或完全落在视口外时，`scrollIntoView({block:'center'})`。填充入口对 `cand.root` 统一调用——折叠区/懒挂载字段若不先滚进视口，其下拉面板与弹窗会按错误坐标定位，点击落空。
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
| upload-image / upload-file | 生成 File（图片尺寸按字段提示，见下）→ `DataTransfer` → 赋 `input.files` → dispatch `change`(bubbles) |
| richtext | `el.innerHTML = '<p>…</p>'` + `InputEvent('input')`（Quill/wangEditor 的 MutationObserver 会自同步） |
| lookup | 点触发图标开弹窗 → 选第一条记录 → 提交（行内「选择」链接或页脚确定）→ 校验回填，必要时读回记录文本（`fillLookup`，见下） |

**占位项不是可选值（`PLACEHOLDER_OPTION_RE`）**：原生 `<select>` 普遍带一个 `<option value="">请选择</option>`。它若进入 `optionTexts`，枚举生成器就会随机选中它，而填充侧找不到匹配文本时又回退 `options[0]`——两者叠加把字段静默留在占位项上：面板报成功、页面值为空、依赖该值的 `v-if` 区块（如「企业生产类型=生产性企业」才出现的产线数量）永不揭示，用户看到的是「一整块没填」。故扫描侧 `optionTextsOfSelect` 排除 `value === ''`、`disabled` 与文案命中占位正则（请选择/请设置/select/`-`/`—`）的 option；填充侧 `select` 与原生 `multiselect` 的匹配与回退都只在过滤后的真实选项里挑（`multiselect` 的取消勾选仍遍历全部 option）。审计侧同样把「停在占位项上」判为 `empty`（见 §12.10）。

**上传图片尺寸与拒收自报（`core/fill/files.ts` / `strategies.ts`）**：真实页面常在上传控件旁写明「支持 jpg/png/gif，建议单张 50KB 以内，**尺寸大小为：480*480px**」，并在 `before-upload` 或服务端回调里校验；固定 240×160 的合成图会被直接拒掉，表现为「字段红字提示不能为空 / 图片格式不正确、文件却没上传」。填充顺序为：**文件池优先，但须先过字段门槛**（见下段）→ 池为空或全部不合格时才合成，且合成前用 `requiredImageSize` 在字段作用域（`closest('.el-form-item/.ant-form-item/[class*=form-item]/td/.cell')`，退到父元素）的文本里解析要求尺寸：先匹配 `宽*高 px|像素`（分隔符支持 `* × x X`），再退一步匹配「尺寸…宽*高」这类无单位写法；解析到就按该尺寸画 canvas（单边上限 2000，避免超大画布），解析不到维持默认 240×160。

**文件池门槛过滤（`requiredMaxBytes` / `entryMeetsHints`）**：池里是用户自己挑的文件，但「用户挑的」不等于「这个字段能收」——设置页放一张 800KB 的图，遇到写着「单张 50KB 以内」的字段照样被页面拒掉，而拒收表现为字段红字，用户只会认为扩展坏了。故 `fillUpload` 先解析字段声明再筛池：`requiredMaxBytes` 在同一字段作用域文本里匹配「不超过/不大于/小于/限制为 + 数字 + B/K/KB/M/MB」与「数字 + 单位 + 以内/以下」两种写法，换算成字节上限；`entryMeetsHints` 剔除 `size` 超限的条目，并对 `image/*` 条目用 `createImageBitmap` 解码出真实宽高，与 `requiredImageSize` 的要求不符即剔除（非图片条目不做尺寸判断）。**解码不可用（无 `createImageBitmap` 或解码抛错）时按「尺寸未知」放行**，宁可用池文件走一遍拒收自报，也不要因为环境能力缺失就把用户的真实图片全部弃用。筛完为空则回退合成文件（合成图按解析到的尺寸画，天然满足门槛）；**不做自动裁剪/缩放**：改尺寸等于改用户的图片内容，资质证照类图片被裁掉一角比被拒收更糟，而合成兜底已经能覆盖门槛场景。

**拒收自报（`rejectIfPageRefused`）**：页面拒收时我们这边不会抛任何异常，唯一痕迹是列表项失败态或框架弹提示。注入后轮询（200ms 步、2.5s 窗；列表始终没挂载且无提示时 1.2s 短窗退出）：收集 `.el-upload-list/.ant-upload-list` 的项（**EP 的列表 ul 是 `.el-upload` 的兄弟节点且首文件加入后才挂载，故从共同宿主滚动收集**），出现 `is-fail/-error` 项或**新增**的 `.el-message/.ant-message-notice` 等提示（注入前快照做差集，避免误认旧提示）且文案命中 格式/尺寸/大小/失败/不正确/不支持/超过 → 抛「上传被页面拒绝 `items/fail/img=msg=`」现场清单；出现 `is-success` 或全部 `is-ready/-done`（页面把上传推迟到提交时）则视为此刻无可验失败。**空数组的 `every` 恒真**是个坑：被拒后列表项被移除、items 为空，若不加 `items.length` 前置会提前 return 吞掉证据。

**lookup 填充流程（`core/fill/lookup.ts`）**：先记录页面上已可见的弹窗集合（`.el-dialog/.el-drawer/.ant-modal-content/.ant-drawer-content/[role=dialog]`），`ensureInView` + `realClick(trigger)` 后等新弹窗出现（3s 超时 → 抛「点击后未弹出选择窗口」）。弹窗内取可选行（`.el-table__body tbody tr`、`.ant-table-tbody tr`、`table tbody tr`、`[role=row]`、`.el-dialog__body li`，过滤表头行/空行/不可见行）：**记录通常是弹窗打开后才异步请求回来的，故先等 1.5s 让行到达**，仍为空才点「查询/搜索」按钮（再等 3s），两者都拿不到行 → 抛「弹窗内没有可选记录（可能需要先填查询条件）」。

选中第一行时，**只有行内存在 radio/checkbox 才做点选**：优先点 `.el-radio/.ant-radio-wrapper/.el-checkbox` 包裹层或原生 input，点完检查 `checked`——**框架包裹层可能吞掉这次点击，未勾中就回退点整行**。没有选择列的表格（如 SRM「查询税收编码」，提交靠 `操作` 列的「选择」链接）不再多余点行。

提交控件分两处找，合并成**一条有序候选链依次点击（最多 4 次，每次点完等 150ms/450ms 看是否已回填或弹窗已关，命中即止）**，**有选择列时页脚确认排在前，没有选择列时行内链接排在前**：

- **行内**：`操作` 列的「选择」链接。Element Plus 渲染成 `<a class="el-link"><span class="el-link__inner">选择</span></a>`，不是 `<button>`，故行内选择器放宽到 `button/a/.el-button/.el-link/[role=button]/[class*=link]/[class*=btn]/span/label`，并要求**去空白后文本 ≤ 8 字**，避免整格文本被当成控件；选择器全不命中时再退一步找**叶子节点上文本恰为 选择/选定/选中/确定/确认 的任意标签**（自研组件常把操作渲染成无样式 `div`）。**固定列若以克隆表实现（AntD v3 / Element UI 2.x 把 `操作` 列复制进第二张表覆盖在主表上），可点的那份不在我们持有的行里**，故按行序号到弹窗内其它 `<table>` 的同序号行再找一遍（Element Plus 2.x 经浏览器实测是 sticky 单元格而非克隆表，此路只为兼容旧版本）。
- **弹窗级**：仅 `button/.el-button/.ant-btn/[role=button]`（**页脚 `.el-dialog__footer` 等优先**），并**排除位于数据行内的控件**，否则多行弹窗会提交到错误的记录；选择器保持窄，免得把 `选择供应商` 这类标题 span 当成按钮。
- **每个候选还会再试一次它的内层叶子节点**：监听绑在 `<a>` 根上还是内层 `<span>` 上因组件库而异，而合成 click 派发给外层节点时**不会向下传到内层监听**。

文案匹配统一**去空白后做包含判断**（页脚常渲染成「确 定」，图标按钮还会带多余空格），命中 `选择/选定/选中/确定/确认/保存/提交/ok/confirm`，并**先排除** `取消/关闭/返回/清除/重置/删除/移除/编辑/修改/新增/添加/cancel/close/reset/delete/remove/edit`——选择器放宽到 `a/span` 后必须挡住行内「编辑/删除」这类会改数据的链接。整条候选链为空 → 整行 click + dblclick 兜底。

最后校验回填：输入框有值**或弹窗已自行关闭**都算已提交（确认后框架可能重渲染，旧 input 引用已脱离文档、永远读不到值）。**仍为空且 input 还在文档中时启用读回兜底**：按列头匹配字段标签取记录文本（标签「税收编码」命中同名列；对不上则取第一个数据格，跳过含 radio/checkbox 的格与「编辑选择」这类操作格），再用 `setNativeValue` 写入——它派发 `input`/`change`，框架模型随之更新；**框架重渲染可能把第一次写入还原，故最多写两次**。记录文本在**点提交之前**就读好，因为提交后行通常会被销毁（Element Plus 的表头与表体还是两张表，列头要从弹窗而非行所在表格里取）。

**弹窗自行关闭不等于成功**：自研弹窗常常关掉却不写模型，读回又被框架还原，字段实际仍为空——这种以前是静默通过，现在只要**字段仍为空且 input 还挂在文档上**就抛「选择后未回填到输入框」。两条失败文案都会附上 `diagnose` 现场清单（`rows/tables/closed/dialog/clicked/input=live|detached/record/actions`）：**真实页的控制台我们够不到，用户能截图的只有面板红字，所以证据必须随错误一起回传**。**无论成功失败，`finally` 都关闭弹窗**（点头部关闭按钮，否则派发 Escape），避免遗留遮罩挡住后续字段。

**lookup 清除**：只读输入框写不进去，只有组件自带的清除图标能重置绑定模型，故 `clearCandidate` 把 `root` 换成 `closest('.el-input, .ant-input-affix-wrapper, .ant-input-group-wrapper')` 后走通用 widget 清除路径（聚焦/悬停揭示 × 再点击）。

失败处理：单字段失败不中断批次，`results[i].error` 回传面板标红。

### 7.3 批量节奏

原生类字段每 50 个一片夹 `requestAnimationFrame`，避免长任务；widget 类天然串行（各自 await 展开）。

### 7.4 条件渲染与折叠区字段补填（scanRevealed + walkScroll）

两类字段在初次 scan 时不存在或不可达，单轮 fill 必漏：

**(a) 条件渲染**：向导式表单里，某些区块只在父级下拉/单选被赋值后才渲染（如「企业生产类型=生产性企业」才出现产线数量输入框）。`handleFill` 在主循环后追加补填轮：调用 core 的 `scanRevealed(knownTargets)`——重扫文档并只返回「非 skipped 且 fill targets 不在已跟踪集合内」的新候选；为每个新候选在字段表登记 id/语义/生成值，取快照并填充。每轮前等一帧 `requestAnimationFrame` 让框架完成渲染；最多 2 轮以约束级联揭示。`scanRevealed` 另外排除弹窗/抽屉作用域（`.el-dialog, .el-overlay, .el-drawer, .ant-modal, .ant-drawer`）内的控件：填充途中弹出的选择框是某个字段的临时 UI，由 `fillLookup` 自己负责，增量补扫把弹窗里的单选列/表格控件当新字段吸收会替用户点选记录，弹窗关闭后字段仍旧为空（demo 自检中表现为一条 `(未识别标签)` radio-group「填完仍空」的假违规）。初次 `scanDocument` 不做此排除，整表就在弹窗里的表单仍能正常识别。

**(b) 折叠区/懒挂载（`core/scan/scroll.ts`）**：一屏放不下的长表单里，靠下的字段要么被 `IntersectionObserver`/虚拟滚动延迟挂载，要么根本没进过视口，scan 时 DOM 里没有它们。`walkScroll(onStep, opts)` 边滚边收集：

- 可滚动容器候选：`.el-scrollbar__wrap, .el-main, .el-table__body-wrapper, .el-dialog__body, .ant-layout-content, .ant-table-body, .ant-modal-body, main, [class*=scroll]`，再按 `scrollHeight - clientHeight > 8` 且计算样式 `overflowY` 为 `auto|scroll|overlay` 过滤；窗口本身也算一层。
- 每步把窗口和所有容器各向下推进「视口高 × 0.85」（无视口时按 600/400 兜底），等 2 帧 rAF 让框架完成懒挂载，再调 `onStep()`；回调返回本步新吸收的字段数。
- 连续 4 步无新增（`idleLimit`）或滚到底（无法再移动）即停；`maxSteps` 默认 25（fill 阶段用 15）作为硬上限。
- `finally` 恢复窗口与每个容器进入前的滚动位置，填充结束后页面观感与原来一致。
- jsdom 里 `scrollHeight/clientHeight` 恒为 0，`stepDown` 永不移动 → 天然 no-op，既有单测不受影响。

`handleScan` 因此变成异步：先 `scanDocument` 收全首屏，再 `walkScroll` 逐步把 `scanRevealed` 的新候选并入，最后按 DOM 顺序（`compareDocumentPosition`）排序，保证面板列表与页面视觉顺序一致；联动表（证照/经纬度）在排序后的完整字段集上建立。`handleFill` 在补填轮之后再跑一次 `walkScroll`，边滚边填新出现的字段。新字段进入字段表，故清除/撤销覆盖它们；Popup 列表不自动刷新（以页面实际值为准）。

## 8. 运行时

- **background**：轻量 SW，仅响应 popup 的 `ensureInject` → `scripting.executeScript(content.js)`，并把注入结果按 `InjectResponse`（`{ok, error?}`）回传——chrome:// 等页面会拒绝注入，原因必须带回面板，否则用户只能看到 Chrome 的 lastError 原文。popup 由 manifest `action.default_popup` 在点击图标时自动打开，无需 background 参与（也避开在 `action.onClicked` 里 await 后再开 UI 丢失用户手势的坑）。permissions：`scripting, storage, activeTab, unlimitedStorage`（unlimitedStorage 支撑文件池写入 `storage.local`）+ `host_permissions:<all_urls>`（保证任意业务页可注入，不依赖 activeTab 授予时机）。
- **重注入守卫（`content/guard.ts`）**：没有 `content_scripts` 声明，脚本全靠 popup 按需注入，因此必须幂等；但**扩展重新加载后旧 content script 被孤立、页面里的标记仍在**（页面没刷新），只看布尔值会让重注入跳过 bootstrap、不注册监听器，popup 两次通信都失败并报 `Could not establish connection. Receiving end does not exist.`。`claimBootstrap(host, isAlive)` 改为把带**活性探针**的戳子写在 `globalThis.__ffLoaded` 上：探针闭包属于上一个实例，在其（可能已失效的）扩展上下文里执行，读不到 `chrome.runtime.id`（或抛错）即判定陈旧 → 重新 bootstrap；仍活着则跳过，避免重复监听器把一次填充做两遍。
- **不可达标签页的提示**：popup `request()` 两次通信都失败时，用 `unreachableHint(tabId, raw)` 按 `chrome.tabs.get(tabId).url` 的协议分类——chrome:// / chrome-extension:// / about: / view-source: / devtools: / 应用商店等给出「无法在××运行，请切到普通网页」，普通 http(s) 页则给「请刷新本页后重试」并把原始错误附在括号里作为证据（面板红字是用户唯一会截图回传的通道）。分类逻辑抽成纯函数 `hintForUrl` 以便单测。
- **content**：模块级 `Map<id, FieldRuntime>` 持有元素引用与快照；`scan` 重建，并同时建立两张联动表（`credLinks: numberId→typeId`、`geoLinks: lnglatId→sourceId`）。`scan` 现为**异步**消息（`handleScan` 内含滚动遍历），消息分支写成 `handleScan(msg.rules).then(reply, fail); return true;`——必须 `return true` 才能让 `sendResponse` 通道在异步完成后仍然有效。`regen` 按联动表重新解析：重roll 证照号码时读类型字段当前选中项重定语义；重roll 地址时同步刷新其关联经纬度的坐标；重roll 经纬度时从其源地址重新推导。tab 导航后映射失效，panel `ping` 失败触发重注入 + 重扫。
- **popup**：React，两个窗内视图——字段列表与内嵌设置页，由「设置 / ← 返回」按钮切换（`view` 状态），设置不再开新标签页。设置 UI 抽成共享组件 `src/shared/SettingsPanel.tsx`，popup 设置视图与独立选项页（`options.html`，现仅作 `chrome://extensions` 的兜底入口）共用；其样式在 `src/shared/settings.css` 里随组件引入（卡片/输入框/按钮层级/虚线投放区都带 `.ff-settings` 作用域前缀，避免与宿主样式互染），两个宿主无需各自引样式；选项页外层版式为 `.options-page`，灰底经 `body:has(.options-page)` 生效（Chrome 105+，低于目标版本 116 无碍）。字段列表行内 `content-visibility:auto` 降低长列表渲染成本；UI 状态仅内存，关弹窗即弃（填充/撤销/清除的真状态在 content 侧，关弹窗不丢）。popup 尺寸在 styles.css 固定为 400×600（Chrome 上限 800×600），设置视图内容超出时由 `main` 滚动。UI 状态层级：按钮四档——`primary`（填充全部）、`danger`（清除全部，红色警示）、`ghost`（重新识别/撤销，无边框弱化）、默认；`canUndo` 由 popup 侧维护（fill 成功置真、undo/scan 复位，content 的快照生命周期与之同步），`tone`（''/warn/err）给状态文字着色（填充失败红、清除有无法清空琥珀）；`generic` 语义 chip 灰显以暴露词典未命中；上传类字段值 `readOnly` + `.value.static`；工具条「跳过 N 个」为 linklike 按钮，点击展开并 `scrollIntoView` 到跳过列表。
- **storage**：`ff.settings = {overwrite:boolean, rules:GenRules}`（sync；`loadSettings` 深合并内置默认）；`ff.filepool = PoolEntry[]`（local；每项 `{name,type,size,data(base64)}`，上限 10 个 / 单个 2MB）。

## 9. 性能设计汇总

| 风险 | 对策 |
|------|------|
| 常驻脚本拖慢被测页 | 按需注入，无 content_scripts 声明，无常驻 observer |
| 大表单扫描卡顿 | 单次 querySelectorAll + label Map 索引；无布局抖动（读批/写批分离） |
| 填充长任务 | 分片 rAF；widget 串行 await |
| 面板长列表 | content-visibility + 简单键控渲染（≤千行无需虚拟滚动） |
| 滚动遍历（折叠区/懒挂载）拖慢识别 | 步数硬上限（scan 25 / fill 15）、连续 4 步无新增即提前退出、每步只等 2 帧 rAF、`finally` 恢复原滚动位置；jsdom 下天然 no-op |
| 包体积 | content/background IIFE 无框架；region 数据仅 content 侧静态引入（~90KB 可接受）；UI 侧不引组件库 |

## 10. 扩展性设计

新增一种「语义 + 生成器」：`rules.ts` 加一行正则 + `generators` 注册一个函数。
新增一种「控件」：`selectors.ts` 加 widget 选择器项 + `classify` 映射 + `strategies` 一个 case。
新增一种「随机数据规则」维度：`types.ts` 的 `GenRules` 加字段 + `DEFAULT_GEN_RULES` 给默认 + `SettingsPanel` 的 `RULE_FIELDS` 加一行 + 对应生成器读取 `ctx.rules`。
已落地（V1）结构化自定义规则：设置面板（`SettingsPanel`，Popup 内嵌设置视图 + 选项页共用）表单（日期/时间格式、邮箱域名、手机号段、企业后缀）→ `chrome.storage.sync` → `loadSettings` 深合并（`{...DEFAULT_GEN_RULES, ...user}`，留空回退默认）→ panel 随 `scan/regen` 下发 → 生成器按 `ctx.rules` 取值，优先级高于内置。其中**邮箱域名经 `shared/rules.ts` 的 `normalizeEmailDomain` 规整**——用户常把完整邮箱填进「邮箱域名」（如 `test@mxbc.com`），直接拼接会产出 `faker803@test@mxbc.com` 这种过不了页面格式校验的值；规整规则为取最后一个 `@` 之后的部分、去首尾点与空白、转小写、不满足域名形态则回退内置池，设置面板对会被规整/回退的填写给琥珀色即时提示（「域名只需 @ 后面的部分，将按「mxbc.com」生成」）。
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

**产物文件名固定（不带内容哈希）**：公司安全策略按「`.js` 结尾 + 有代码特征」拦截脚本，例外申请只能按文件名/路径登记，而 Vite 默认的内容哈希（`popup-CrJGMSoq.js`）每次构建都变，会让已批的白名单立刻失效。故 `vite.config.ts` 里把 `entryFileNames/chunkFileNames/assetFileNames` 固定为 `assets/[name].js`（`.css` 同理），并设 `modulePreload.polyfill: false`——MV3 扩展只跑在 Chromium 上，`<link rel=modulepreload>` 原生支持（Chrome 66+），这个 polyfill 每次都是「第一行检测通过就 return」的死重量，去掉后需要加白的文件少一个。代价：扩展读本地文件、不走 HTTP 缓存，固定名不损失缓存收益，但**从文件名看不出是哪次构建**，版本追溯只能靠 `manifest.json` 的 `version`（发版要记得 bump）；另外 Rollup 用 `[name]` 时同名 chunk 会互相覆盖，**以后新增 HTML 入口或共享 chunk 时要确认名字不撞**（症状是产物少一个文件、对应页面白屏，构建期即可发现）。`content.js` / `background.js` / `harness.js` 的名字由 `scripts/build-workers.mjs` 硬编码，本来就不带哈希。

发布包（`release/FormFaker-<version>.zip`，`dist/` 去掉 `harness.js`）内的 JS 共 6 个，即安全策略需要加白的全集：`background.js`、`content.js`、`assets/popup.js`、`assets/options.js`、`assets/SettingsPanel.js`（popup 与 options 的共享 chunk，含 React 运行时）、`assets/demo.js`（仅打开 demo 页时执行）。包内无内联 `<script>`、无 `.mjs/.cjs/.wasm`、无远程代码，故不存在白名单覆盖不到的脚本。打包与哈希清单：

```
pnpm build && cd dist && zip -qr ../release/FormFaker-0.1.1.zip . -x harness.js
cd dist && shasum -a 256 background.js content.js assets/*.js > ../release/SHA256SUMS.txt
```

哈希清单是给安全团队做内容级审计用的（按名放行 + 按哈希可追溯），每次重新构建都要重出。

## 12. 测试策略

- 单测（vitest+jsdom）：
  1. 生成器：phone 号段正则、idNumber/creditCode/bankCard 校验位函数反验、region 路径层级合法、daterange 起<止；**邮箱域名规整**——`emailDomain` 填完整邮箱（`test@mxbc.com`）时只取 `@` 后面的域名、结果恰含一个 `@`（真实缺陷回归：曾拼出 `faker803@test@mxbc.com` 被页面判格式错误），填非法值（`不是域名`/无点域名）回退内置池仍产出合法邮箱；`normalizeEmailDomain` 单元用例覆盖大小写/首尾空白/`mailto:` 前缀/尾斜杠的规整与空串、无点域名、中文的拒绝。
  2. 语义推断：fixture 标签（受理组织/联系电话/注册资本/注册地区…）命中期望语义；优先级用例（手机 vs 电话）。
  3. 控件分类：fixture HTML（原生 + Element/Ant 类名结构）→ kind 矩阵断言；disabled/hidden 过滤；`scanRevealed` 条件渲染补扫——初扫后新插入的控件恰被返回一次、可填充、更新已知集合后二轮为空，且**弹窗（`.el-overlay/.el-dialog`）里的单选列不被增量补扫吸收**（先断言 `scanDocument` 能扫到它，证明排除来自弹窗作用域而非可见性）。
  4. 原生填充：jsdom 中 setNativeValue 后 input 收到事件且 value 生效；select/checkbox/radio 路径。
  5. 经纬度（`test/geo.test.ts`）：lnglat 语义推断；禁用坐标框被白名单放行而其他禁用字段仍跳过；`coordForText` 确定性 + 落在对应省 bbox 内 + 无已知省时返回 null；`resolveGeoLink` 令 lnglat 值等于 `coordForText(地址值)`，且**表单作用域**配对——多表单页里链到同表单地址而非全局第一个地址类字段。
  6. 表格列头标签（`test/table.test.ts`，6 例）：普通表格单元格取列头；取到后语义正确（姓名→cnName、手机号→phone、电子邮箱→email、银行账号→bankCard）；EP 表头/表体分离在兄弟 `<table>` 时仍能关联；`colspan` 展开列号 + 多级表头自下而上回溯；ARIA 网格经 `aria-colindex` 与 `headers` 属性；优先级——form-item 标签与包裹 `<label>` 胜过列头，非表格字段不受影响，无表格时仍回退 placeholder。
  7. 滚动累积（`test/scroll.test.ts`，5 例）：用 `Object.defineProperty` 伪造 `scrollHeight/clientHeight`——步进到最大值后恢复原 `scrollTop`；连续无新增恰在第 4 步退出；`maxSteps` 生效；懒挂载控件只被收集一次（已知集合需像运行时那样增长）；无可滚动容器时为 no-op（仅 1 步）。
  8. 弹窗选择（`test/lookup.test.ts`，22 例）：识别——只读框 + suffix 图标 → `lookup` 且带 trigger；包裹层外的兄弟「选择」按钮 → `lookup`；只读/禁用但无触发器 → skipped「禁用/只读」；可编辑框带搜索图标仍是 `text`。生成——`generate({kind:'lookup'})` 返回占位标记。填充——开弹窗选第一条 + 确定后输入框写入且弹窗隐藏；列表为空时先点「查询」再选中；**记录在弹窗打开 200ms 后才到达（无查询按钮）仍能选中**；**页脚文案为「确 定」时仍被认成确认按钮**；**radio 包裹层吞掉点击（原生 input 未勾中）时回退点整行**；无弹窗时 3s 内抛「点击后未弹出选择窗口」；无可选记录时抛错**且关闭按钮被点过一次**（不留遮罩挡后续字段）。**行内提交形态**（复刻 SRM「查询税收编码」：无页脚、无单选列，`操作` 列是 `<a class="el-link">` 或裸 `<span>` 的「编辑/选择」）——点中第一行的「选择」，**不点「编辑」、不点第二行**；**弹窗自行关闭却没回填时按列头读回记录文本**（标签「货物和劳务名称」取到第二列而非第一列），**列头与标签对不上时退回第一个数据格**。**真实页加固**——固定右列克隆表：主表行内的同名链接点了没反应（无监听），仍能到兄弟表同序号行点中真正的「选择」（克隆行只有操作格，记录按行序号还原，借此证明点的是第一行而非第二行）；操作渲染成**选择器全不覆盖的叶子 `div`** 时按精确文案命中；**监听绑在 `el-link` 内层 `span`** 时外层点空后回退点内层；**框架还原第一次读回**时第二次写入生效（断言写入 2 次、还原 1 次）；**弹窗自关但值始终不落地**时不再静默通过而抛错；无可点控件且写入被还原时抛错，并**在文案里带出现场清单**（`rows=2 tables=2`、`input=live:""`、`actions=span.muted:查看`）。用例需把 `getBoundingClientRect` 打桩为非零矩形——jsdom 恒返回 0×0，填充引擎会据此判为不可见；断言回退点行时只统计 `target` 为行本身的点击，因为包裹层的 click 会冒泡到行。
  9. 上传（`test/files.test.ts`，11 例；`test/filepool.test.ts`，14 例）：`requiredImageSize` 解析——「…50KB以内，尺寸大小为：480*480px」取到 480×480；`×`/`x` 分隔符与空格、大写 PX 均可；无单位的「尺寸要求 1200*900」靠「尺寸」前缀命中；只写体积不写尺寸的提示返回 `null`（沿用默认）；单边超 2000 时收敛到 2000（画布可分配）。`requiredMaxBytes` 解析——后缀式「50KB以内」→ 51200；前缀式「不超过 10MB」「小于500KB」「限制为 1M」各自换算；只写尺寸不写体积、或空提示返回 `null`（不设限）。扫描——`display:none` 的原生 `input[type=file]` 仍判为 `upload-image` 且 `targets=[input]`，不再被当「不可见」跳过；**无 `accept` 的图片提示**（form-item 内「商品轮播图…支持图片格式jpg/png…尺寸大小为：750*564px」）经 `hintSaysImage` 改判 `upload-image`；**提示写的是 pdf** 时仍保持 `upload-file`，证明纠正不会把真附件字段带偏。文件池——`pickPoolFile` 的 accept 令牌匹配（扩展名 / 通配 mime / 精确 mime / 多令牌 / 空 accept 首条与 upload-image 优先图片）、无匹配与空池返回 `null`；`entryMeetsHints` 剔除体积超限条目、剔除解码尺寸与要求不符的图片（`createImageBitmap` 打桩），**解码不可用或抛错时按尺寸未知放行**，非图片条目不做尺寸判断；`poolEntryToFile` base64 还原出同名同类型 File、类型为空时退 `application/octet-stream`。canvas 依赖浏览器，jsdom 无法验 `makePng`，实际像素由 e2e 断言。
  10. 落地审计（`test/audit.test.ts`，18 例；被测对象 `src/dev/audit.ts`）：审计不复用 `SEMANTIC_RULES`，而是**另写一张人工期望表**（标签正则 → 期望语义 → 值形态正则，如 手机号 `/^1[3-9]\d{9}$/`、统一社会信用代码 18 位、开户行名须含「银行/支行/信用社」、人名 2~4 个汉字），因为同源校验只会复刻实现自己的错序。`liveValue` 从 DOM 读回落地值，读取顺序为：上传 → `uploadLive`；布尔类 → `true/false` 与 `checked/''`（未选中是合法结果，故走 `state-mismatch` 而非 `empty`）；原生候选 `root === input`，**必须先直接读 `primary.value`**（`root.querySelector('input')` 对原生控件永远落空）；再退 widget 显示层。违规规则：`fill-error / empty / state-mismatch / placeholder-leak / image-field-non-image / image-label-as-file / upload-size-mismatch / semantic-miss / value-shape`（daterange 按 `~` 拆两段各验一次；选项类与上传类不做值形态校验）。两个 Element Plus 坑写进了用例：**`is-hidden` 的 `.el-select__input-wrapper` 同样带 `.el-select__selected-item` 类且文档序在真显示项之前**，逗号选择器 `querySelector` 会取到空节点（首轮 e2e 因此把已填好的下拉误报 `empty`），故按单选择器逐个收集并跳过 `is-transparent`/`is-hidden`；**自动上传成功后 EP 会清空 `input.files`**，上传证据须回退到 `.el-upload-list__item` 的项数与文件名/src。原生 select 停在占位项上时判 `empty`（`selectedOptions[0].text` 非空会骗过朴素读法，见 §7.2）。
  11. 注入守卫与不可达提示（`test/guard.test.ts` 5 例 + `test/messaging.test.ts` 3 例）：`claimBootstrap` —— 空页面首次 bootstrap；上一实例仍活着时跳过（防重复监听器把一次填充做两遍）；上一实例上下文已失效（扩展重载、页面未刷新）时重新 bootstrap；探针抛 `Extension context invalidated.` 按陈旧处理；旧版本残留的布尔标记（`__ffLoaded === true`，无 `alive`）被识别为陈旧并替换。`hintForUrl` —— chrome:// / chrome-extension:// / about:blank / 应用商店 URL 各自命中「无法在××运行」且**不透出 Chrome lastError 原文**；普通 http(s) 页给「请刷新本页」并把原始错误附在括号里留证；URL 读不到时给兜底提示。
- 手工：demo 页（原生区 + Element Plus 真实组件区，含 cascader/date/upload/switch、「注册地址 + 禁用经纬度」联动样例、「企业生产类型→v-if 揭示产线数量」条件渲染样例，以及**联系人表格区**（姓名/角色/区号/手机号/电子邮箱 + 添加一行）、**两个弹窗选择样例**——「清算会员号」（el-dialog 内 el-table 单选列 + 页脚确定）与「税收编码」（复刻 SRM「查询税收编码」：关键词框 + 搜索/重置/新增、无页脚、无单选列，`操作` 列为 `<el-link>` 的 编辑/选择且 `fixed="right"`）、**1100px 占位 + IntersectionObserver 懒挂载区**（供应商产能/产线/合作客户/意向物料））加载扩展全流程；联动、条件渲染、表格列头、两种弹窗选择、滚动懒挂载均已用 dev harness（`window.__ff`）在真实浏览器端到端验证：扫描覆盖全部区块字段、表格内 姓名/手机号/电子邮箱 写入 Vue `model.contacts`、区号按 integer 生成、**行内「选择」链接提交成功（`model.taxCode = 1010101`）且 radio+页脚形态未回退（`model.clearingNo = QX0001`）、两次填充后遗留遮罩均为 0**、懒挂载四字段全部填入 `model.lazy`、滚动位置复位 `scrollY: 0`、无字段报错；SRM 风格长表单截图页人工核对覆盖率。
  - 懒挂载样例的教训：占位锚点若高度为 0 且正好落在视口底边，`IntersectionObserver` 永不触发——锚点需给 1px 高度并配 `rootMargin`。这是 fixture 写法问题，非 `walkScroll` 缺陷（遍历确实滚到底并复位了）。
  - 弹窗选择的浏览器取证（Element Plus 2.x）：`fixed="right"` 渲染成 **sticky 单元格**（`.el-table-fixed-column--right`），弹窗内只有 2 张表（表头 + 表体）、**没有 `.el-table__fixed-right` 克隆容器**，「选择」的真实 DOM 是 `<a class="el-link el-link--primary"><span class="el-link__inner">选择</span></a>`（监听在 `<a>` 根上）。故克隆表分支只对 AntD v3 / Element UI 2.x 这类老实现有意义，EP 页面上的失败原因不在固定列。第三轮加固后两个样例复测仍成功（税收编码 580ms → `model.taxCode = 1010101`、清算会员号 1096ms → `QX0001`，遗留遮罩 0），候选链变长没有带来误报。
  - 上传样例 e2e（五轮）：demo 增补 EP `picture-card` 上传（商品图片 1 个 + 商品详情图片 3 个并排）、**商品主图**（提示「…尺寸大小为：480*480px」+ `before-upload` 按 `naturalWidth/Height === 480` 严格校验 + 假 `:http-request`；注意 `auto-upload=false` 时 EP 不跑 `before-upload`，门槛样例必须用默认自动上传）与**供应商资质图**（负样例：只收 jpeg，拒收时弹 `ElMessage('图片格式不正确，仅支持jpg/jpeg')`，复刻真实页的拒收提示）。第一轮：8 个上传字段全填、0 报错，主图预览 480×480 门槛通过。第二轮暴露拒收静默：资质图 `qualImgs=0` 却无报错；修好「空列表 every 恒真」与「列表 ul 首文件后才挂载」后，第三轮资质图如实抛「上传被页面拒绝 items=0/fail=0 img=none msg=图片格式不正确，仅支持jpg/jpeg」，其余字段仍全过。**文件池优先复验**：页面里伪造 `chrome.storage.local` 预置一张 480×480 的真实 jpeg 后，资质图与主图都改用池文件并通过门槛（`qualImgs=1`）——证明池优先于合成图生效。第四轮针对「真实页把图片字段当文件传」：新增**商品轮播图**（默认 list-type + `el-button` 触发 + **无 `accept`** + 提示「支持图片格式jpg/png/gif…尺寸大小为：750*564px」，故意不用 picture-card，否则类名分支会先命中而绕过提示纠正），扫描结果 `商品轮播图:upload-image`、`bannerImgs=1`，同页 `上传附件:upload-file` 未被误改。**第五轮（文件池门槛过滤）**：先给 demo 的 `checkMainSize` 补上体积校验（提示文字写着「50KB以内」而门槛只验像素，fixture 与自己的提示不一致就无法验体积分支），再用页面内 canvas 造池条目、伪造 `chrome.storage.local` 跑「商品主图」三次——① 池图 1000×800/5487B（尺寸不符）→ 跳过池文件、注入合成 `test-2155-480x480.png`（8911B），`mainImgs[0].status=success`；② 池图 480×480 但 238125B（超 50KB）→ 同样回退合成 `test-2243-480x480.png`（8893B）并过门槛；③ 池图 480×480/2111B（合规）→ **仍用池文件** `pool-compliant.jpg`，证明池优先没被过滤逻辑削弱。三次 `fillCandidate` 均无异常。本轮**未复跑 `selfCheck` 基线**（两次 15s 工具超时后仍在执行，未取到读数），基线数字沿用第四轮的 60/58/58；门槛字段本身的回归已由上述三场景的 `status=success` 覆盖。
  - 一键自检（`window.__ff.selfCheck()`）：把「扫描 → 生成 → 填充 → 审计」串成一次调用，返回可直接粘贴出来的 JSON（`scanned/fillable/skipped[]/filled[]/checked/violations[]`）。流程与生产 `handleFill` 对齐：`scanDocument` + `walkScroll(scanRevealed)` 累积候选 → 逐个 `inferSemantic` + `generate` + `fillCandidate` → 两轮 `scanRevealed` 补填 + 一次 `walkScroll` 补填（否则联动区块漏审，实测漏了「企业生产类型=生产性企业」揭示的产线数量）→ `auditEntries` 用独立期望表审计落地值。dev-only：`harness.js` 由 `scripts/build-workers.mjs` 打包，不在 manifest 里声明，任意页面注入 `<script src="/harness.js">` 即可用（真实页自检同理）。demo 页当前基线 `scanned 60 / fillable 58 / checked 58`，两次连续运行结果一致，常驻 2 条违规：`供应商资质图|upload-image|fill-error`（**设计好的负样例**，只收 jpeg，证明拒收自报有效）与 `供应商产线|text|semantic-miss`（期望表按「产线」判 integer，实现给 generic → 填了 `autotest-xxxxx` 这种字符串；**真实控件形态未知，未擅自改 `SEMANTIC_RULES`**，待确认真实页该字段是数字还是文字描述）。另有一条曾复现的假违规 `(未识别标签)|radio-group|empty`：清算会员号弹窗的单选列被补填轮吸收、弹窗关闭后读回未选中，已由 §7.4 的弹窗作用域排除修掉。
  - Popup 视觉验证方式：`ego-browser` 的 `Page.captureScreenshot` 在本会话对所有页面（含空白对照页）都超时，截屏能力整体不可用；改用 `dist/ui-preview.html`（把 `dist/popup.html` 加一段内联 `window.chrome` 桩，返回固定的 8 字段扫描结果与一条 f3 填充错误）+ `page.evaluate` 读 computed style / class 断言（卡片圆角 10px 与阴影、按 kind 分类的 chip 配色、`.brand`、`.primary`、底部「⚙ 设置」、红字错误框），验完即删。视觉最终仍需用户在 `chrome://extensions` 重新加载 `dist/` 后亲眼确认。第二轮（按钮层级/状态着色）断言：`清除全部` 计算色 `rgb(207,34,46)` + 浅红边框、`重新识别` ghost 边框与背景透明、`撤销` 初始 `disabled=true` 且填充成功后转 `false`、`generic` chip 灰（`rgb(139,148,158)`）而具体语义蓝（`rgb(47,111,235)`）、上传值 `readOnly=true`、填充失败后 `.status.err` 为红、清除带无法清空时 `.status.warn` 为琥珀、点「跳过 3 个」后 `details[open]` 出现。第三轮（设置页）断言：Popup 内嵌视图与 `options.html` 两个宿主都渲染出 3 张 `.ff-settings .card`（白底、圆角 10px、浅边框），「保存」计算色 `rgb(47,111,235)`、「恢复默认规则」边框与背景透明、虚线投放区 `border-style: dashed` 且内层 file input `display:none`、规则输入框灰底 `rgb(244,246,248)` 圆角 7px、池内「删除」红字 `rgb(207,34,46)`、点保存后出现绿色「已保存」；选项页 `body` 经 `:has(.options-page)` 变灰底 `rgb(245,246,248)`。第四轮（不可达标签页提示）断言：桩把 `tabs.sendMessage` 一律失败（`lastError` = `Could not establish connection…`）且 `ensureInject` 返回 `Cannot access a chrome:// URL`，则 `?tab=chrome://extensions/` 时 `.status.err` 文本为「无法在浏览器内部页面（chrome://）运行，请切到普通网页（http/https）后点「重新识别」。」且**不含 Chrome lastError 原文**；`?tab=https://srm.example.com/supplier/apply` 时为「当前页面未能注入脚本，请刷新本页后点「重新识别」。（Cannot access a chrome:// URL）」——原始错误作为证据保留。注意：**扩展重载导致的陈旧守卫无法在预览桩里复现**（需要真实的扩展上下文失效），该路径由 `test/guard.test.ts` 覆盖，真机验证方式是用户在 `chrome://extensions` 重载扩展后**不刷新业务页**直接点图标。
  - 产物固定文件名后的功能面验证（§11）：改名会动到三处引用链——HTML 里的 `<script type=module src>`、`<link rel=stylesheet>`、popup/options 对共享 chunk 的静态 `import`，Rollup 全部自动重写，人工核对 `dist/popup.html`、`dist/options.html`、`dist/demo.html` 的引用与实际产物一致（`assets/popup.js|options.js|demo.js|SettingsPanel.js` + `popup.css|SettingsPanel.css|demo.css`），且 `assets/` 下**不再有 `modulepreload-polyfill-*.js`**。三个入口在真实浏览器复测：popup 桩页渲染出品牌区/四档按钮/「识别到 4 个可填充字段」，失败路径 `.status.err` 为红 `rgb(207,34,46)` 且「撤销」由 disabled 转可用；options 桩页渲染 3 张卡片、邮箱域名的琥珀色规整提示、文件池文案，点保存后出现绿色「已保存」；`demo.html` 正常水合（20 个 `el-form-item` / 8 个 `el-upload` / 56 个 input），`harness.js` 扫描 54 个候选，合成上传（商品主图 480×480，8901B，`status=success`）与原生填充（`n-name`→张三、`n-email`→a@b.com）均落地。闸门：`tsc --noEmit` 干净、`vitest run` 183/183、`pnpm build` 通过，重新出包并重算 `release/SHA256SUMS.txt`（`shasum -a 256 -c` 全 OK）。**遗留缺口**：预览桩用的是 `dist/` 产物 + `window.chrome` 桩，扩展重载后 content/background 的真实注入链仍需用户在 `chrome://extensions` 重载 `dist/` 复测（预期无影响，名字本来就由 `build-workers.mjs` 硬编码）。
- 缺口明示：Ant Design 路径与真实浏览器事件序列无自动化覆盖，依赖 demo 人工 + 选择器集中配置降低维护成本。

## 13. 风险与对策

| 风险 | 对策 |
|------|------|
| 组件库版本 DOM 变化（如 Element Plus 2.x select 结构改版） | 选择器多版本并存（`.el-select__wrapper`/`.el-input__inner` 均列入 trigger）；role 兜底 |
| 日期组件拒绝键入 | Enter+blur 双确认；失败回传面板可手填 |
| SPA 路由切换后字段失效 | ping 失败→重注入+重扫；面板提示「页面已变化，请重新识别」 |
| 扩展重新加载后，未刷新的页面里旧 content script 被孤立（面板报 `Could not establish connection. Receiving end does not exist.`，重注入看似成功却仍不通） | `content/guard.ts` 的 `claimBootstrap` 用**活性探针**判定页面里残留的标记是否陈旧（探针在上一实例的上下文里执行，读不到 `runtime.id` 即重新 bootstrap）；`ensureInjected` 不再吞掉注入失败原因；popup 按 `tabs.get(tabId).url` 分类给可操作中文提示，chrome:// 等不可注入页面直接说明「请切到普通网页」，普通页则提示刷新并附原始错误 |
| iframe 表单 | MVP 不覆盖，V1.1 all_frames |
| 上传组件自定义 http 上传按钮（无 input[file]） | 识别为 skipped 并提示原因 |
| 上传字段带 `before-upload`/服务端格式与尺寸门槛，合成图被拒（表现为字段红字「不能为空 / 图片格式不正确」而文件没上传） | **分类先纠正**：真实页常无 `accept`，按 accept 分会把图片字段判成 `upload-file` 并注入 PDF（「图片格式不正确」的直接根因），故命中字段提示里的图片线索即改判 `upload-image`。**文件池优先但须先过门槛**（见下一行）；无可池文件才合成，且按字段提示文字解析要求尺寸画 PNG（单边上限 2000）；注入后观察列表失败态与框架提示，拒收则把页面原话写进面板红字（`上传被页面拒绝 … msg=`）。**真实 SRM 商品页尚未复测**：若门槛写死在代码里而提示文字没写尺寸，合成兜底仍会被拒，此时靠预置文件池或红字里的 msg 再定策 |
| 文件池里的图片本身不满足字段门槛（设置页放 800KB 的图，字段写着「单张 50KB 以内」；或池图 1000×800 而字段要求 480×480） | `fillUpload` 先用 `requiredMaxBytes` + `requiredImageSize` 解析字段声明，再用 `entryMeetsHints` 逐条筛池，不合格条目直接跳过、全部不合格则回退按尺寸合成的 PNG；**不自动裁剪或压缩池文件**（改用户图片内容风险大于被拒收）。解码能力缺失时按「尺寸未知」放行，避免误弃真实图片。已在 demo 页真实浏览器验证三场景（尺寸不符/体积超限均回退合成并过门槛，合规池文件仍被优先使用，见 §12 上传 e2e 第五轮）；**真实 SRM 上传字段的门槛文案能否被正则命中仍待用户复测**——提示里没写体积/尺寸时筛不掉，此时仍由拒收自报的 `msg=` 兜底。 |
| 经纬度坐标精度（当前为省级行政中心，非市/区级） | `geo.ts` 为单文件替换点：把真实城市质心表填入 `CITY_CENTERS` 即升级精度，无需改其他代码；坐标全程离线推导，无网络/隐私风险 |
| 虚拟滚动表格（`el-table-v2`、AntD `virtual`）只渲染视口内行 | 列头关联对已渲染行有效；未渲染行需边滚边扫表格内部容器，列入 V1.1（`walkScroll` 已把 `.el-table__body-wrapper` 纳入滚动容器，可作基础） |
| 动态增减行表格（「+ 添加一行」）只填当前已渲染行 | MVP 明确不自动点新增按钮；行数不足时用户先手动加行再识别，自动加行列入 V1.1 |
| 弹窗选择型字段可能强制要求先输入查询条件才有记录 | `fillLookup` 先等记录异步到达，再尝试点「查询/搜索」；仍无记录则抛「弹窗内没有可选记录（可能需要先填查询条件）」并关闭弹窗，错误回传面板标红，不留遮罩阻塞后续字段 |
| 弹窗的提交控件可能是行内链接（`操作` 列「选择」）而非页脚按钮，甚至点了也不回填 | 行内选择器放宽到 `a/.el-link/span` 再退到叶子节点精确文案，与页脚按钮合成**有序候选链依次点击**（无选择列时行内优先，有选择列时页脚优先；每个候选再试内层叶子；固定列克隆表按行序号到兄弟表补找），排除词挡住「编辑/删除/新增」；仍为空则按列头读回记录文本用 `setNativeValue` 写入，**被框架还原就再写一次**；**弹窗自关但字段仍空时不再静默通过，一律抛错**。残留风险：需要「先勾选多行再提交」或提交后由后端异步回填的弹窗，读回文本可能与业务真实主键不一致，此时面板显示成功但值需人工复核 |
| 真实 SRM 弹窗已连续 3 轮失败，而 jsdom 单测与 demo 页真实浏览器 e2e 全绿（自建 fixture 继承了实现的假设） | 不再凭猜测加第 4 种结构分支：两条失败文案都内嵌 `diagnose` 现场清单（行数/表数/弹窗类名/点过的控件/input 是否脱离文档/读到的记录/行内候选），**用户截图面板红字即可回传证据**；清单到手前只做已被证据支持的改动 |

## 14. 里程碑

- M1：设计文档（本文 + 产品文档）✅
- M2：骨架 + 识别 + 生成器 + 单测
- M3：填充引擎 + content/background + Popup 主界面
- M4：demo 页 + 构建/测试全绿 + 手工验收清单
