import SettingsPanel from '../shared/SettingsPanel';
import RulesPanel from '../shared/RulesPanel';

// 选项页是弹窗的兜底入口，宽度充裕，两块直接铺开，不再套一层页签。
export default function App() {
  return (
    <div className="options-page">
      <h2>FormFaker 设置</h2>
      <SettingsPanel />
      <h2 className="second">规则中心</h2>
      <RulesPanel />
    </div>
  );
}
