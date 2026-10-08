import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { EngineProvider } from "./engine";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <EngineProvider>
    <App />
  </EngineProvider>,
);
