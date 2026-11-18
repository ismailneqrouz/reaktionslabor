import { useEffect } from "react";
import { startLab } from "./lab/engine";

/**
 * App shell. React renders the layout; the lab engine (ported from the original
 * single-file app) fills the sidebar and main column and handles hash routing.
 */
export default function App() {
  useEffect(() => {
    startLab();
  }, []);

  return (
    <div className="app">
      <aside className="side" id="side" />
      <main id="main" />
    </div>
  );
}
