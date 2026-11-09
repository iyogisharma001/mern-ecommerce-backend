import { NextFunction, Request, Response } from "express";
import { User } from "../models/user.js";
import { getFirebaseAuth } from "../utils/firebase.js";
import ErrorHandler from "../utils/utility-class.js";
import { TryCatch } from "./error.js";

/*
  Authentication is based on a Firebase ID token sent as
  "Authorization: Bearer <token>". The old approach (?id=<uid> in the URL)
  trusted whatever the client sent, so anyone who knew an admin's uid
  was an admin. The ?id= query param is now ignored everywhere.
*/

const getBearerToken = (req: Request) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
};

// Verifies the Firebase token only (used for sign-up, before a DB user exists)
export const verifyToken = TryCatch(
  async (req: Request, res: Response, next: NextFunction) => {
    const token = getBearerToken(req);
    if (!token) return next(new ErrorHandler("Please login first", 401));

    try {
      const decoded = await getFirebaseAuth().verifyIdToken(token);
      req.firebaseUser = {
        uid: decoded.uid,
        email: decoded.email,
        name: decoded.name,
        picture: decoded.picture,
      };
    } catch {
      return next(new ErrorHandler("Session expired, please login again", 401));
    }

    next();
  }
);

// Verifies the token AND loads the user from the database
export const isAuthenticated = TryCatch(async (req, res, next) => {
  const token = getBearerToken(req);
  if (!token) return next(new ErrorHandler("Please login first", 401));

  let uid: string;
  try {
    uid = (await getFirebaseAuth().verifyIdToken(token)).uid;
  } catch {
    return next(new ErrorHandler("Session expired, please login again", 401));
  }

  const user = await User.findById(uid);
  if (!user) return next(new ErrorHandler("User not found", 401));

  req.user = { _id: user._id, role: user.role, name: user.name };
  next();
});

// Only admins are allowed
export const adminOnly = TryCatch(async (req, res, next) => {
  await new Promise<void>((resolve, reject) =>
    isAuthenticated(req, res, (err?: unknown) => (err ? reject(err) : resolve()))
  );

  if (req.user?.role !== "admin")
    return next(new ErrorHandler("Only admins can access this", 403));

  next();
});
