import express, { Application, NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import cors from "cors";
import cookieParser from "cookie-parser";
import router from "./app/routes";
import GlobalErrorHandler from "./middlewares/globalErrorHandler";

const app: Application = express();

export const corsOptions = {
  origin: [
    "http://localhost:3011",
    "http://localhost:3010",
    "https://dashboard.isobrain.ai",
    "https://www.isobrain.ai",
    "https://isobrain.ai", // ✅ ADD THIS
    "https://api.isobrain.ai",
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(cookieParser());

app.use("/api/v1/payments/webhook", express.raw({ type: "application/json" }));

// Now apply normal body parsers for all other routes
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ limit: "200mb", extended: true }));
app.use(express.static("public"));

// Root route and the rest of API routes
app.get("/", (req: Request, res: Response) => {
  res.send({
    success: true,
    statusCode: httpStatus.OK,
    message: "Welcome to Server!",
  });
});

app.use("/api/v1", router);

app.use((req: Request, res: Response, next: NextFunction) => {
  res.status(httpStatus.NOT_FOUND).json({
    success: false,
    message: "API NOT FOUND!",
    error: {
      path: req.originalUrl,
      message: "Your requested path is not found!",
    },
  });
});

app.use(GlobalErrorHandler);

export default app;
