import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AdvisorProvider } from "./context/AdvisorContext";
import { AdminProvider } from "./context/AdminContext";
import App from "./App";
import "./style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AdvisorProvider>
        <AdminProvider>
          <App />
        </AdminProvider>
      </AdvisorProvider>
    </BrowserRouter>
  </StrictMode>
);

