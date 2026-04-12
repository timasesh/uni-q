import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ManagerProvider } from "./context/ManagerContext";
import { AdminProvider } from "./context/AdminContext";
import App from "./App";
import "./style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ManagerProvider>
        <AdminProvider>
          <App />
        </AdminProvider>
      </ManagerProvider>
    </BrowserRouter>
  </StrictMode>
);

