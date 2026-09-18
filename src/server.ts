import http, { Server } from "http";
import app from "./app";
import config from "./app/config";
import { startPlanExpiryJob } from "./app/jobs/planExpiry.job";

let server: Server;

async function startServer() {
  server = http.createServer(app);

  server.listen(config.port, () => {
    console.log(`🚀 Server running on port ${config.port}`);
    startPlanExpiryJob();
  });
}

async function main() {
  await startServer();

  const exitHandler = () => {
    if (server) {
      server.close(() => {
        console.info("Server closed!");
        process.exit(0);
      });
    } else {
      process.exit(1);
    }
  };

  process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
    exitHandler();
  });

  process.on("unhandledRejection", (err) => {
    console.error("Unhandled Rejection:", err);
    exitHandler();
  });

  process.on("SIGTERM", exitHandler);
  process.on("SIGINT", exitHandler);
}

main();
