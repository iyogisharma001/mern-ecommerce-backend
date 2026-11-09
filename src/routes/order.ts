import express from "express";
import { adminOnly, isAuthenticated } from "../middlewares/auth.js";
import {
  allOrders,
  deleteOrder,
  getSingleOrder,
  myOrders,
  newOrder,
  processOrder,
} from "../controllers/order.js";

const app = express.Router();

// route - /api/v1/order/new
app.post("/new", isAuthenticated, newOrder);

// route - /api/v1/order/my
app.get("/my", isAuthenticated, myOrders);

// route - /api/v1/order/all
app.get("/all", adminOnly, allOrders);

app
  .route("/:id")
  .get(isAuthenticated, getSingleOrder)
  .put(adminOnly, processOrder)
  .delete(adminOnly, deleteOrder);

export default app;
