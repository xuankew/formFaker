import SettingsPanel from '../shared/SettingsPanel';

export default function App() {
  return (
    <div
      style={{
        maxWidth: 620,
        margin: '40px auto',
        padding: '0 16px',
        fontFamily: '-apple-system, "PingFang SC", sans-serif',
        color: '#1f2328',
      }}
    >
      <h2 style={{ marginBottom: 12 }}>FormFaker 设置</h2>
      <SettingsPanel />
    </div>
  );
}
