import { NextFunction, Request, Response } from "express";
import { User } from "../models/user.js";
import { NewUserRequestBody } from "../types/types.js";
import { TryCatch } from "../middlewares/error.js";
import ErrorHandler from "../utils/utility-class.js";
import { invalidateCache } from "../utils/features.js";

// Sign-up / login. The uid and email come from the VERIFIED Firebase token,
// so nobody can create an account with someone else's id.
export const newUser = TryCatch(
  async (
    req: Request<{}, {}, NewUserRequestBody>,
    res: Response,
    next: NextFunction
  ) => {
    const firebaseUser = req.firebaseUser!;
    const _id = firebaseUser.uid;

    let user = await User.findById(_id);

    if (user)
      return res.status(200).json({
        success: true,
        message: `Welcome, ${user.name}`,
      });

    const { gender, dob } = req.body;
    const name = req.body.name || firebaseUser.name;
    const photo = req.body.photo || firebaseUser.picture;
    const email = firebaseUser.email;

    if (!name || !email || !photo || !gender || !dob)
      return next(
        new ErrorHandler("Please select your gender and date of birth", 400)
      );

    user = await User.create({
      name,
      email,
      photo,
      gender,
      _id,
      dob: new Date(dob),
    });

    // Dashboard user counts / charts include the new user right away
    await invalidateCache({ admin: true });

    return res.status(201).json({
      success: true,
      message: `Welcome, ${user.name}`,
    });
  }
);

export const getAllUsers = TryCatch(async (req, res, next) => {
  const users = await User.find({});

  return res.status(200).json({
    success: true,
    users,
  });
});

// A user can only fetch their own profile (admins can fetch anyone)
export const getUser = TryCatch(async (req, res, next) => {
  const id = req.params.id;

  if (req.user!.role !== "admin" && req.user!._id !== id)
    return next(new ErrorHandler("Not allowed", 403));

  const user = await User.findById(id);

  if (!user) return next(new ErrorHandler("Invalid Id", 400));

  return res.status(200).json({
    success: true,
    user,
  });
});

export const deleteUser = TryCatch(async (req, res, next) => {
  const id = req.params.id;

  if (id === req.user!._id)
    return next(new ErrorHandler("You cannot delete your own account", 400));

  const user = await User.findById(id);

  if (!user) return next(new ErrorHandler("Invalid Id", 400));

  await user.deleteOne();

  await invalidateCache({ admin: true });

  return res.status(200).json({
    success: true,
    message: "User Deleted Successfully",
  });
});
