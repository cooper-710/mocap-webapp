import ThreeView from "./components/ThreeView";

export default function App() {
  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "grid",
        gridTemplateColumns: "1fr",
        gridTemplateRows: "1fr",
        background: "#0b0c0e",
      }}
    >
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <ThreeView />
      </div>
    </div>
  );
}
