import { NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";
import ErrorHandler from "../utils/utility-class.js";

// Files are kept in memory before going to Cloudinary, so cap their size
// and only accept images
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per photo

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 5 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    cb(new ErrorHandler("Only image files are allowed", 400));
  },
});

// Turn multer errors (file too large, too many files) into 400 responses
// instead of falling through to a 500
const withUploadErrors =
  (handler: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction) =>
    handler(req, res, (err?: unknown) => {
      if (!err) return next();
      if (err instanceof ErrorHandler) return next(err);
      if (err instanceof multer.MulterError) {
        const message =
          err.code === "LIMIT_FILE_SIZE"
            ? "Each photo must be 5 MB or smaller"
            : err.code === "LIMIT_FILE_COUNT" ||
              err.code === "LIMIT_UNEXPECTED_FILE"
            ? "You can only upload 5 Photos"
            : err.message;
        return next(new ErrorHandler(message, 400));
      }
      next(err);
    });

export const singleUpload = withUploadErrors(upload.single("photo"));
export const mutliUpload = withUploadErrors(upload.array("photos", 5));
