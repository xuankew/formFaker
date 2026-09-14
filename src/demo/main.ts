import { createApp, reactive, ref } from 'vue';
import ElementPlus from 'element-plus';
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
    <el-form-item label="企业级账号"><el-input v-model="model.account" disabled placeholder="企业级账号" /></el-form-item>
    <el-form-item>
      <el-button type="primary" @click="dump">打印表单模型（验证框架状态同步）</el-button>
    </el-form-item>
  </el-form>
</div>
`;

const app = createApp({
  template,
  setup() {
    const model = reactive({
      name: '', nature: '', scope: [] as string[], region: [] as string[], found: '',
      range: null as string[] | null, staff: 1, tax: '', cate: [] as string[], on: false, account: '',
      prodType: '',
    });
    const dump = () => {
      console.log('[demo] element-plus model =', JSON.parse(JSON.stringify(model)));
      const native = new FormData(document.getElementById('native-form') as HTMLFormElement);
      console.log('[demo] native form =', Object.fromEntries(native.entries()));
    };
    (window as unknown as Record<string, unknown>).__demoModel = model;
    return { model, regionOptions, dump, activeTab: ref('native') };
  },
});
app.use(ElementPlus);
app.mount('#app');
