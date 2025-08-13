import { Request, Response, NextFunction } from "express";

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err?.status || err?.response?.status || 500;
  const payload = {
    error: true,
    message: err?.message || "Internal Server Error",
    details: err?.response?.data ?? undefined,
  };
  res.status(status).json(payload);
}


