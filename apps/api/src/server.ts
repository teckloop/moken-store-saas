import "dotenv/config";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import type { ErrorRequestHandler } from "express";
import express from "express";
import multer from "multer";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ZodError } from "zod";
import { migrate } from "./db.js";
import { authenticate } from "./auth.js";
import { routes } from "./routes.js";
import { seedDemoStore } from "./seed.js";

const app = express();
const port = Number(process.env.PORT ?? 4100);
const uploadsDir = join(process.cwd(), "data", "uploads");

migrate();
seedDemoStore();
mkdirSync(uploadsDir, { recursive: true });

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:5176"];

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: allowedOrigins, credentials: true }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "طلبات كثيرة جداً." },
});
app.use("/uploads", express.static(uploadsDir, {
  immutable: true,
  maxAge: "365d"
}));
app.use(express.json());
app.use(authenticate);
app.use("/api", apiLimiter, routes);

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 422).json({
      error: "upload_error",
      message: error.code === "LIMIT_FILE_SIZE" ? "Image size must be 50MB or less." : error.message
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(422).json({
      error: "validation_error",
      issues: error.issues
    });
    return;
  }

  if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
    res.status(409).json({
      error: "duplicate_record",
      message: "A record with the same unique value already exists."
    });
    return;
  }

  if (error instanceof Error && error.message === "PRODUCT_NOT_FOUND") {
    res.status(404).json({
      error: "product_not_found",
      message: "One of the requested products was not found in this store."
    });
    return;
  }

  if (error instanceof Error && error.message === "VARIANT_NOT_FOUND") {
    res.status(404).json({
      error: "variant_not_found",
      message: "One of the selected product options was not found."
    });
    return;
  }

  if (error instanceof Error && error.message === "INSUFFICIENT_INVENTORY") {
    res.status(409).json({
      error: "insufficient_inventory",
      message: "There is not enough inventory to complete this order."
    });
    return;
  }

  if (error instanceof Error && error.message === "SHIPPING_ZONE_NOT_FOUND") {
    res.status(422).json({
      error: "shipping_zone_not_found",
      message: "The selected shipping zone is not available for this store."
    });
    return;
  }

  if (error instanceof Error && error.message === "DISCOUNT_NOT_AVAILABLE") {
    res.status(422).json({
      error: "discount_not_available",
      message: "Discount code is not available for this order."
    });
    return;
  }

  console.error(error);
  res.status(500).json({
    error: "internal_error",
    message: "Unexpected server error."
  });
};

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Moken Store API listening on http://localhost:${port}`);
});
