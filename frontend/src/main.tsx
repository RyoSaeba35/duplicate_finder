import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import LicenseGate from "./components/LicenseGate";
import { I18nProvider } from "./i18n/context";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <LicenseGate>
        <App />
      </LicenseGate>
    </I18nProvider>
  </React.StrictMode>
);
