import { createApp, onMounted, reactive, ref } from 'vue';
import ElementPlus, { ElMessage } from 'element-plus';
import 'element-plus/dist/index.css';

const regionOptions = [
  {
    value: 'zj',
    label: '浙江省',
    children: [
      { value: 'hz', label: '杭州市', children: [{ value: 'xh', label: '西湖区' }, { value: 'bj', label: '滨江区' }] },
      { value: 'nb', label: '宁波市', children: [{ value: 'yz', label: '鄞州区' }] },
    ],
  },
  { value: 'js', label: '江苏省', children: [{ value: 'nj', label: '南京市', children: [{ value: 'gl', label: '鼓楼区' }] }] },
];

const template = `
<div style="max-width: 900px; margin: 24px auto; padding: 0 16px;">
  <h2>FormFaker demo — 原生控件区</h2>
  <form id="native-form" style="display:grid; grid-template-columns:1fr 1fr; gap:12px 24px;">
    <div><label for="n-name">姓名</label><input id="n-name" type="text" /></div>
    <div><label for="n-mobile">联系电话（手机）</label><input id="n-mobile" type="text" maxlength="11" /></div>
    <div><label for="n-tel">固定电话</label><input id="n-tel" type="text" /></div>
    <div><label for="n-email">邮箱</label><input id="n-email" type="email" /></div>
    <div><label for="n-id">身份证号</label><input id="n-id" type="text" /></div>
    <div><label for="n-uscc">统一社会信用代码</label><input id="n-uscc" type="text" /></div>
    <div><label for="n-lictype">证照类型</label>
      <select id="n-lictype">
        <option value="">请选择</option><option selected>统一社会信用代码</option><option>居民身份证</option><option>其他证照</option><option>护照</option>
      </select>
    </div>
    <div><label for="n-licno">证照号码</label><input id="n-licno" type="text" /></div>
    <div><label for="n-paid">实缴资金（单位:元）</label><input id="n-paid" type="text" /></div>
    <div><label for="n-capital">注册资本（单位:元）</label><input id="n-capital" type="number" /></div>
    <div><label for="n-date">成立日期</label><input id="n-date" type="date" /></div>
    <div><label for="n-addr">注册地址</label><input id="n-addr" type="text" /></div>
    <div><label for="n-lnglat">经纬度</label><input id="n-lnglat" type="text" disabled placeholder="110.121140,37.088900" /></div>
    <div><label for="n-prodtype">企业生产类型</label>
      <select id="n-prodtype" v-model="model.prodType">
        <option value="">请选择</option><option>生产性企业</option><option>贸易性企业</option>
      </select>
    </div>
    <template v-if="model.prodType === '生产性企业'">
      <div><label for="n-lines">生产现场产线总数量（条）</label><input id="n-lines" type="text" /></div>
      <div><label for="n-lines-supply">可供应产线（条）</label><input id="n-lines-supply" type="text" /></div>
    </template>
    <div><label for="n-region-select">纳税类别</label>
      <select id="n-region-select">
        <option value="">请选择</option><option>一般纳税人</option><option>小规模纳税人</option>
      </select>
    </div>
    <div>
      <span>性别</span>
      <label><input type="radio" name="n-gender" />男</label>
      <label><input type="radio" name="n-gender" />女</label>
    </div>
    <div>
      <span>经营范围</span>
      <label><input type="checkbox" name="n-scope" />贸易</label>
      <label><input type="checkbox" name="n-scope" />制造</label>
      <label><input type="checkbox" name="n-scope" />服务</label>
    </div>
    <div><label><input type="checkbox" id="n-agree" />同意协议</label></div>
    <div><label for="n-file">上传附件</label><input id="n-file" type="file" accept=".pdf" /></div>
    <div><label for="n-img">营业执照</label><input id="n-img" type="file" accept="image/*" /></div>
    <div><label for="n-disabled">受理组织</label><input id="n-disabled" disabled value="企业级账号" /></div>
    <div style="grid-column:1/-1;"><label for="n-remark">备注</label><textarea id="n-remark" rows="3" style="width:100%"></textarea></div>
    <div style="grid-column:1/-1;"><span>企业简介</span><div id="n-rich" contenteditable="true" aria-label="企业简介" style="border:1px solid #ccc; min-height:60px"></div></div>
  </form>

  <h2>Element Plus 组件区</h2>
  <el-form label-width="140px" style="max-width:640px">
    <el-form-item label="供应商名称"><el-input v-model="model.name" placeholder="请输入" /></el-form-item>
    <el-form-item label="企业性质">
      <el-select v-model="model.nature" placeholder="请选择" clearable>
        <el-option label="国有企业" value="soe" />
        <el-option label="民营企业" value="private" />
        <el-option label="外资企业" value="foreign" />
      </el-select>
    </el-form-item>
    <el-form-item label="经营范围(多选)">
      <el-select v-model="model.scope" multiple placeholder="请选择" clearable>
        <el-option label="贸易" value="trade" />
        <el-option label="制造" value="make" />
        <el-option label="服务" value="service" />
      </el-select>
    </el-form-item>
    <el-form-item label="注册地区">
      <el-cascader v-model="model.region" :options="regionOptions" placeholder="请选择" clearable />
    </el-form-item>
    <el-form-item label="成立日期">
      <el-date-picker v-model="model.found" type="date" placeholder="选择日期" value-format="YYYY-MM-DD" clearable />
    </el-form-item>
    <el-form-item label="有效期">
      <el-date-picker v-model="model.range" type="daterange" start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" clearable />
    </el-form-item>
    <el-form-item label="员工人数"><el-input-number v-model="model.staff" :min="1" /></el-form-item>
    <el-form-item label="纳税类别">
      <el-radio-group v-model="model.tax">
        <el-radio value="general">一般纳税人</el-radio>
        <el-radio value="small">小规模纳税人</el-radio>
      </el-radio-group>
    </el-form-item>
    <el-form-item label="供应商分类">
      <el-checkbox-group v-model="model.cate">
        <el-checkbox value="strategic">战略</el-checkbox>
        <el-checkbox value="normal">普通</el-checkbox>
        <el-checkbox value="temp">临时</el-checkbox>
      </el-checkbox-group>
    </el-form-item>
    <el-form-item label="启用"><el-switch v-model="model.on" /></el-form-item>
    <el-form-item label="上传logo">
      <el-upload action="#" :auto-upload="false" accept="image/*"><el-button>选择图片</el-button></el-upload>
    </el-form-item>
    <el-form-item label="商品图片">
      <el-upload v-model:file-list="model.goodsImgs" list-type="picture-card" accept="image/*" :auto-upload="false" />
    </el-form-item>
    <el-form-item label="商品详情图片">
      <div style="display:flex;gap:8px">
        <el-upload v-model:file-list="model.detailImgs1" list-type="picture-card" accept="image/*" :auto-upload="false" />
        <el-upload v-model:file-list="model.detailImgs2" list-type="picture-card" accept="image/*" :auto-upload="false" />
        <el-upload v-model:file-list="model.detailImgs3" list-type="picture-card" accept="image/*" :auto-upload="false" />
      </div>
    </el-form-item>
    <el-form-item label="商品主图">
      <div>
        <el-upload
          v-model:file-list="model.mainImgs"
          list-type="picture-card"
          accept="image/*"
          :before-upload="checkMainSize"
          :http-request="fakeUpload"
        />
        <div style="color:#e6a23c;font-size:12px">支持图片格式jpg/png/gif，建议单张图片50KB以内，尺寸大小为：480*480px</div>
      </div>
    </el-form-item>
    <el-form-item label="商品轮播图">
      <div>
        <el-upload v-model:file-list="model.bannerImgs" :auto-upload="false"><el-button>上传图片</el-button></el-upload>
        <div style="color:#e6a23c;font-size:12px">支持图片格式jpg/png/gif，建议单张图片100KB以内，尺寸大小为：750*564px</div>
      </div>
    </el-form-item>
    <el-form-item label="供应商资质图">
      <div>
        <el-upload
          v-model:file-list="model.qualImgs"
          list-type="picture-card"
          accept="image/*"
          :before-upload="checkJpegOnly"
          :http-request="fakeUpload"
        />
        <div style="color:#e6a23c;font-size:12px">仅支持jpg/jpeg格式，尺寸大小为：800*800px</div>
      </div>
    </el-form-item>
    <el-form-item label="企业级账号"><el-input v-model="model.account" disabled placeholder="企业级账号" /></el-form-item>
    <el-form-item label="清算会员号">
      <el-input v-model="model.clearingNo" readonly placeholder="请选择">
        <template #suffix>
          <span class="el-icon el-icon-search" style="cursor:pointer" @click="pickerVisible = true">🔍</span>
        </template>
      </el-input>
    </el-form-item>
    <el-form-item label="税收编码">
      <el-input v-model="model.taxCode" readonly placeholder="请选择">
        <template #suffix>
          <span class="el-icon el-icon-search" style="cursor:pointer" @click="taxPickerVisible = true">🔍</span>
        </template>
      </el-input>
    </el-form-item>
    <el-form-item label="跟进组织">
      <el-input v-model="model.followOrg" readonly placeholder="请选择">
        <template #suffix>
          <span class="el-icon el-icon-search" style="cursor:pointer" @click="orgPickerVisible = true">🔍</span>
        </template>
      </el-input>
    </el-form-item>
    <el-form-item>
      <el-button type="primary" @click="dump">打印表单模型（验证框架状态同步）</el-button>
    </el-form-item>
  </el-form>

  <h2>联系人表格区（列头即标签）</h2>
  <el-table :data="model.contacts" border style="width:100%">
    <el-table-column label="姓名" width="140">
      <template #default="s"><el-input v-model="s.row.name" placeholder="请输入" /></template>
    </el-table-column>
    <el-table-column label="角色" width="170">
      <template #default="s">
        <el-select v-model="s.row.role" placeholder="请选择">
          <el-option label="业务联系人" value="biz" />
          <el-option label="财务联系人" value="fin" />
        </el-select>
      </template>
    </el-table-column>
    <el-table-column label="区号" width="110">
      <template #default="s"><el-input-number v-model="s.row.code" :min="1" :controls="false" /></template>
    </el-table-column>
    <el-table-column label="手机号" width="170">
      <template #default="s"><el-input v-model="s.row.mobile" placeholder="请输入" /></template>
    </el-table-column>
    <el-table-column label="电子邮箱">
      <template #default="s"><el-input v-model="s.row.email" placeholder="请输入" /></template>
    </el-table-column>
  </el-table>
  <p><el-button @click="addContact">+ 添加一行</el-button></p>

  <div style="height:1100px;border:1px dashed #ccc;display:flex;align-items:center;justify-content:center;color:#999;margin:24px 0">
    ↓ 下面的区块要滚动进入可视区才会渲染（模拟懒挂载 / 折叠区）
  </div>
  <div id="lazy-anchor" style="height:1px"></div>
  <template v-if="lazyMounted">
    <h2>懒挂载区（滚动后才出现）</h2>
    <el-form label-width="140px" style="max-width:640px">
      <el-form-item label="供应商产能"><el-input v-model="model.capacity" placeholder="请输入" /></el-form-item>
      <el-form-item label="供应商产线"><el-input v-model="model.lines" placeholder="请输入" /></el-form-item>
      <el-form-item label="供应商合作客户"><el-input v-model="model.clients" placeholder="请输入" /></el-form-item>
      <el-form-item label="供应商意向物料"><el-input v-model="model.materials" placeholder="请输入" /></el-form-item>
    </el-form>
  </template>

  <el-dialog v-model="pickerVisible" title="选择清算会员号" width="520px">
    <el-table :data="pickerRows" highlight-current-row @row-click="pickRow">
      <el-table-column width="50">
        <template #default="s"><el-radio v-model="pickedId" :value="s.row.no" /></template>
      </el-table-column>
      <el-table-column prop="no" label="会员号" />
      <el-table-column prop="bank" label="开户行" />
    </el-table>
    <template #footer>
      <el-button @click="pickerVisible = false">取消</el-button>
      <el-button type="primary" @click="confirmPick">确定</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="taxPickerVisible" title="查询税收编码" width="720px">
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <el-input v-model="taxKeyword" placeholder="请输入税收编码" clearable style="width:220px" />
      <el-button type="primary" @click="searchTax">搜索</el-button>
      <el-button @click="taxKeyword = ''">重置</el-button>
      <el-button @click="taxKeyword = ''">新增</el-button>
    </div>
    <el-table :data="taxRows">
      <el-table-column prop="code" label="税收编码" width="140" />
      <el-table-column prop="name" label="货物和劳务名称" />
      <el-table-column prop="rate" label="税率" width="90" />
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="s">
          <el-link type="primary" :underline="false" style="margin-right:12px">编辑</el-link>
          <el-link type="primary" :underline="false" @click="pickTax(s.row)">选择</el-link>
        </template>
      </el-table-column>
    </el-table>
  </el-dialog>

  <!-- 树形选择弹窗（企业系统「选择跟进组织」形态）：父节点是组织组，叶子才是可选公司 -->
  <el-dialog v-model="orgPickerVisible" title="选择跟进组织" width="560px">
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <el-input v-model="orgKeyword" placeholder="请输入名称或编码" clearable style="width:220px" />
      <el-button type="primary" @click="searchOrg">查询</el-button>
      <el-button @click="orgKeyword = ''; searchOrg()">重置</el-button>
      <el-button link type="primary" @click="expandOrgLevel">展开1级</el-button>
    </div>
    <el-tree
      ref="orgTree"
      :data="orgRows"
      node-key="id"
      :props="{ label: 'name' }"
      :default-expanded-keys="orgExpanded"
      :expand-on-click-node="false"
      :filter-node-method="filterOrg"
      highlight-current
      style="max-height:320px;overflow:auto"
      @node-click="pickOrgNode"
    >
      <template #default="s">
        <el-radio v-model="pickedOrg" :value="s.data.id" @click.stop>{{ s.data.name }}</el-radio>
      </template>
    </el-tree>
    <template #footer>
      <el-button @click="orgPickerVisible = false">取消</el-button>
      <el-button type="primary" @click="confirmOrg">确定</el-button>
    </template>
  </el-dialog>
</div>
`;

const app = createApp({
  template,
  setup() {
    const model = reactive({
      name: '', nature: '', scope: [] as string[], region: [] as string[], found: '',
      range: null as string[] | null, staff: 1, tax: '', cate: [] as string[], on: false, account: '',
      prodType: '',
      clearingNo: '', taxCode: '', followOrg: '', capacity: '', lines: '', clients: '', materials: '',
      goodsImgs: [] as unknown[], detailImgs1: [] as unknown[], detailImgs2: [] as unknown[], detailImgs3: [] as unknown[],
      mainImgs: [] as unknown[],
      bannerImgs: [] as unknown[],
      qualImgs: [] as unknown[],
      contacts: [
        { name: '', role: '', code: 86, mobile: '', email: '' },
        { name: '', role: '', code: 86, mobile: '', email: '' },
      ],
    });
    const pickerVisible = ref(false);
    const pickedId = ref('');
    const pickerRows = [
      { no: 'QX0001', bank: '示例银行高新分行' },
      { no: 'QX0002', bank: '示例银行滨江分行' },
    ];
    const pickRow = (row: { no: string }) => { pickedId.value = row.no; };
    const confirmPick = () => {
      model.clearingNo = pickedId.value;
      pickerVisible.value = false;
    };
    const TAX_ALL = [
      { code: '1010101', name: '稻谷', rate: '9%' },
      { code: '1010102', name: '小麦', rate: '9%' },
      { code: '1030101', name: '食用植物油', rate: '13%' },
    ];
    const taxPickerVisible = ref(false);
    const taxKeyword = ref('');
    const taxRows = ref([...TAX_ALL]);
    const searchTax = () => {
      const kw = taxKeyword.value.trim();
      taxRows.value = kw ? TAX_ALL.filter((r) => r.code.includes(kw) || r.name.includes(kw)) : [...TAX_ALL];
    };
    const pickTax = (row: { code: string }) => {
      model.taxCode = row.code;
      taxPickerVisible.value = false;
    };

    // 树形选择弹窗的数据：前两条是组织组（不可提交），后面才是可选公司。
    interface OrgNode { id: string; name: string; children?: OrgNode[] }
    const ORG_ALL: OrgNode[] = [
      {
        id: 'VN01', name: 'VN01 越南大区',
        children: [
          { id: 'HW050001', name: 'HW050001 星海环球有限公司' },
          { id: 'MY0201', name: 'MY0201 南洋贸易有限公司' },
        ],
      },
      {
        id: 'MY02', name: 'MY02 马来分部',
        children: [{ id: 'CF0301', name: 'CF0301 云顶咖啡有限公司' }],
      },
      { id: 'GYS202609190001', name: 'GYS202609190001 中原供应商一' },
      { id: 'GYS202609190002', name: 'GYS202609190002 中原供应商二' },
      { id: 'GYS202609220001', name: 'GYS202609220001 江南供应商三' },
    ];
    const ORG_LEAVES = ['HW050001', 'MY0201', 'CF0301', 'GYS202609190001', 'GYS202609190002', 'GYS202609220001'];
    const orgPickerVisible = ref(false);
    const orgKeyword = ref('');
    const orgTree = ref();
    const orgRows = ORG_ALL;
    const pickedOrg = ref('');
    // 只默认展开第一组：折叠组的子节点在 EP 里根本不渲染，正好验证「叶子优先 + 无叶子才展开」。
    const orgExpanded = ref(['VN01']);
    const pickOrgNode = (data: { id: string }) => { pickedOrg.value = data.id; };
    const filterOrg = (value: string, data: { name: string }) => !value || data.name.includes(value);
    const searchOrg = () => orgTree.value?.filter(orgKeyword.value.trim());
    const expandOrgLevel = () => { orgExpanded.value = ORG_ALL.filter((o) => o.children).map((o) => o.id); };
    const confirmOrg = () => {
      const flat = ORG_ALL.flatMap((o) => [o, ...(o.children ?? [])]);
      const hit = flat.find((o) => o.id === pickedOrg.value);
      // 组节点没有对应公司，业务上不允许提交——真实页会拦，这里照做。
      if (hit && ORG_LEAVES.includes(hit.id)) model.followOrg = hit.name;
      orgPickerVisible.value = false;
    };
    const addContact = () => model.contacts.push({ name: '', role: '', code: 86, mobile: '', email: '' });

    const lazyMounted = ref(false);
    onMounted(() => {
      const anchor = document.getElementById('lazy-anchor');
      if (!anchor) return;
      const io = new IntersectionObserver((entries, obs) => {
        if (entries.some((e) => e.isIntersecting)) {
          lazyMounted.value = true;
          obs.disconnect();
        }
      }, { rootMargin: '200px 0px' });
      io.observe(anchor);
    });

    const checkMainSize = (file: File) =>
      new Promise<boolean>((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        const done = (ok: boolean) => {
          URL.revokeObjectURL(url);
          resolve(ok);
        };
        img.onload = () => done(file.size <= 50 * 1024 && img.naturalWidth === 480 && img.naturalHeight === 480);
        img.onerror = () => done(false);
        img.src = url;
      });
    const fakeUpload = () => Promise.resolve({ url: 'https://example.invalid/fake.png' });
    const checkJpegOnly = (file: File) => {
      const ok = /jpe?g/.test(file.type);
      if (!ok) ElMessage.error('图片格式不正确，仅支持jpg/jpeg');
      return ok;
    };

    const dump = () => {
      console.log('[demo] element-plus model =', JSON.parse(JSON.stringify(model)));
      const native = new FormData(document.getElementById('native-form') as HTMLFormElement);
      console.log('[demo] native form =', Object.fromEntries(native.entries()));
    };
    (window as unknown as Record<string, unknown>).__demoModel = model;
    return {
      model, regionOptions, dump, activeTab: ref('native'),
      pickerVisible, pickedId, pickerRows, pickRow, confirmPick, addContact, lazyMounted,
      taxPickerVisible, taxKeyword, taxRows, searchTax, pickTax, checkMainSize, fakeUpload, checkJpegOnly,
      orgPickerVisible, orgKeyword, orgTree, orgRows, pickedOrg, orgExpanded,
      pickOrgNode, filterOrg, searchOrg, expandOrgLevel, confirmOrg,
    };
  },
});
app.use(ElementPlus);
app.mount('#app');
