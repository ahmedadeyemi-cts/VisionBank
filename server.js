import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const API_BASE = "https://pop1-apps.mycontactcenter.net/api";
const TOKEN = "VWGKXWSqGA4FwlRXb2cIx5H1dS3cYpplXa5iI3bE4Xg="; // secure on backend

// Generic proxy function
async function forward(req, res, endpoint) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            headers: { token: TOKEN }
        });

        const data = await response.json();
        res.json(data);

    } catch (err) {
        console.error("Proxy Error:", err);
        res.status(500).json({ error: "Proxy failed", details: err.toString() });
    }
}

// ROUTES
app.get("/agents", (req, res) => forward(req, res, "/v3/realtime/status/agents"));
app.get("/queues", (req, res) => forward(req, res, "/v3/realtime/status/queues"));
app.get("/queue-stats", (req, res) => forward(req, res, "/v3/realtime/statistics/queues"));
app.get("/ivr-stats", (req, res) => forward(req, res, "/v3/realtime/statistics/ivrs"));
app.get("/agent-sessions/:date", (req, res) =>
    forward(req, res, `/v3/hist/agentsessions/${req.params.date}`)
);

app.get("/", (req, res) => res.send("VisionBank Dashboard Proxy is running."));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
});
