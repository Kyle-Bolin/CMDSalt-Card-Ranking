import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "../DeckMatrix.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
