import { NextFunction, Request, Response } from "express";
import ErrorHandler from "../utils/utility-class.js";
import { ControllerType } from "../types/types.js";

export const errorMiddleware = (
  err: ErrorHandler & { code?: number },
  req: Request,
  res: Response,
  next: NextFunction
) => {
  err.message ||= "Internal Server Error";
  err.statusCode ||= 500;

  if (err.name === "CastError") {
    err.message = "Invalid ID";
    err.statusCode = 400;
  }

  // Mongoose schema validation failed -> client error, not 500
  if (err.name === "ValidationError") err.statusCode = 400;

  // Duplicate unique key (e.g. coupon code already exists)
  if (err.code === 11000) {
    err.message = "Duplicate value, this already exists";
    err.statusCode = 400;
  }

  return res.status(err.statusCode).json({
    success: false,
    message: err.message,
  });
};

export const TryCatch =
  (func: ControllerType) =>
  (req: Request, res: Response, next: NextFunction) => {
    return Promise.resolve(func(req, res, next)).catch(next);
  };
