import { Request } from "express";
import { redis, redisTTL } from "../app.js";
import { TryCatch } from "../middlewares/error.js";
import { Product } from "../models/product.js";
import { Review } from "../models/review.js";
import {
  BaseQuery,
  NewProductRequestBody,
  SearchRequestQuery,
} from "../types/types.js";
import {
  deleteFromCloudinary,
  escapeRegex,
  findAverageRatings,
  invalidateCache,
  uploadToCloudinary,
} from "../utils/features.js";
import ErrorHandler from "../utils/utility-class.js";
// import { faker } from "@faker-js/faker";

// Form fields arrive as strings (multipart), so check the numeric value
const validatePrice = (price: unknown) => {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0)
    return "Price must be a number greater than 0";
  return null;
};

const validateStock = (stock: unknown) => {
  const value = Number(stock);
  if (!Number.isInteger(value) || value < 0)
    return "Stock must be a whole number, 0 or more";
  return null;
};

// Revalidate on New,Update,Delete Product & on New Order
export const getlatestProducts = TryCatch(async (req, res, next) => {
  let products;

  products = await redis.get("latest-products");

  if (products) products = JSON.parse(products);
  else {
    products = await Product.find({}).sort({ createdAt: -1 }).limit(5);
    await redis.setex("latest-products", redisTTL, JSON.stringify(products));
  }

  return res.status(200).json({
    success: true,
    products,
  });
});

// Revalidate on New,Update,Delete Product & on New Order
export const getAllCategories = TryCatch(async (req, res, next) => {
  let categories;

  categories = await redis.get("categories");

  if (categories) categories = JSON.parse(categories);
  else {
    categories = await Product.distinct("category");
    await redis.setex("categories", redisTTL, JSON.stringify(categories));
  }

  return res.status(200).json({
    success: true,
    categories,
  });
});

// Revalidate on New,Update,Delete Product & on New Order
export const getAdminProducts = TryCatch(async (req, res, next) => {
  let products;

  products = await redis.get("all-products");

  if (products) products = JSON.parse(products);
  else {
    products = await Product.find({});
    await redis.setex("all-products", redisTTL, JSON.stringify(products));
  }

  return res.status(200).json({
    success: true,
    products,
  });
});

export const getSingleProduct = TryCatch(async (req, res, next) => {
  let product;
  const id = req.params.id;
  const key = `product-${id}`;

  product = await redis.get(key);
  if (product) product = JSON.parse(product);
  else {
    product = await Product.findById(id);
    if (!product) return next(new ErrorHandler("Product Not Found", 404));

    await redis.setex(key, redisTTL, JSON.stringify(product));
  }

  return res.status(200).json({
    success: true,
    product,
  });
});

export const newProduct = TryCatch(
  async (req: Request<{}, {}, NewProductRequestBody>, res, next) => {
    const { name, price, stock, category, description } = req.body;
    const photos = req.files as Express.Multer.File[] | undefined;

    if (!photos) return next(new ErrorHandler("Please add Photo", 400));

    if (photos.length < 1)
      return next(new ErrorHandler("Please add atleast one Photo", 400));

    if (photos.length > 5)
      return next(new ErrorHandler("You can only upload 5 Photos", 400));

    if (
      !name ||
      price === undefined ||
      stock === undefined ||
      !category ||
      !description
    )
      return next(new ErrorHandler("Please enter All Fields", 400));

    const priceError = validatePrice(price);
    if (priceError) return next(new ErrorHandler(priceError, 400));

    const stockError = validateStock(stock);
    if (stockError) return next(new ErrorHandler(stockError, 400));

    // Upload Here

    const photosURL = await uploadToCloudinary(photos);

    await Product.create({
      name,
      price,
      description,
      stock,
      category: category.toLowerCase(),
      photos: photosURL,
    });

    await invalidateCache({ product: true, admin: true });

    return res.status(201).json({
      success: true,
      message: "Product Created Successfully",
    });
  }
);

export const updateProduct = TryCatch(async (req, res, next) => {
  const { id } = req.params;
  const { name, price, stock, category, description } = req.body;
  const photos = req.files as Express.Multer.File[] | undefined;

  const product = await Product.findById(id);

  if (!product) return next(new ErrorHandler("Product Not Found", 404));

  // Validate BEFORE uploading new photos / deleting old ones
  const hasPrice = price !== undefined && price !== "";
  const hasStock = stock !== undefined && stock !== "";

  if (hasPrice) {
    const priceError = validatePrice(price);
    if (priceError) return next(new ErrorHandler(priceError, 400));
  }
  if (hasStock) {
    const stockError = validateStock(stock);
    if (stockError) return next(new ErrorHandler(stockError, 400));
  }

  if (photos && photos.length > 0) {
    const photosURL = await uploadToCloudinary(photos);

    const ids = product.photos.map((photo) => photo.public_id);

    await deleteFromCloudinary(ids);

    product.photos = photosURL;
  }

  if (name) product.name = name;
  if (hasPrice) product.price = Number(price);
  // hasStock instead of `if (stock)` so stock can be set to 0
  if (hasStock) product.stock = Number(stock);
  // Same as newProduct, so category filters keep working after an edit
  if (category) product.category = category.toLowerCase();
  if (description) product.description = description;

  await product.save();

  await invalidateCache({
    product: true,
    productId: String(product._id),
    admin: true,
  });

  return res.status(200).json({
    success: true,
    message: "Product Updated Successfully",
  });
});

export const deleteProduct = TryCatch(async (req, res, next) => {
  const product = await Product.findById(req.params.id);
  if (!product) return next(new ErrorHandler("Product Not Found", 404));

  const ids = product.photos.map((photo) => photo.public_id);

  await deleteFromCloudinary(ids);

  await product.deleteOne();
  await Review.deleteMany({ product: product._id }); // no orphan reviews

  await invalidateCache({
    product: true,
    productId: String(product._id),
    admin: true,
  });

  return res.status(200).json({
    success: true,
    message: "Product Deleted Successfully",
  });
});

export const getAllProducts = TryCatch(
  async (req: Request<{}, {}, {}, SearchRequestQuery>, res, next) => {
    const { search, sort, category, price } = req.query;

    const page = Number(req.query.page) || 1;

    const key = `products-${search}-${sort}-${category}-${price}-${page}`;

    let products;
    let totalPage;

    const cachedData = await redis.get(key);
    if (cachedData) {
      const data = JSON.parse(cachedData);
      totalPage = data.totalPage;
      products = data.products;
    } else {
      // 1,2,3,4,5,6,7,8
      // 9,10,11,12,13,14,15,16
      // 17,18,19,20,21,22,23,24
      const limit = Number(process.env.PRODUCT_PER_PAGE) || 8;
      const skip = (page - 1) * limit;

      const baseQuery: BaseQuery = {};

      if (search)
        baseQuery.name = {
          // escaped so a crafted search can't hang MongoDB (ReDoS)
          $regex: escapeRegex(search),
          $options: "i",
        };

      if (price)
        baseQuery.price = {
          $lte: Number(price),
        };

      if (category) baseQuery.category = category.toLowerCase();

      const productsPromise = Product.find(baseQuery)
        .sort(sort && { price: sort === "asc" ? 1 : -1 })
        .limit(limit)
        .skip(skip);

      const [productsFetched, filteredCount] = await Promise.all([
        productsPromise,
        Product.countDocuments(baseQuery),
      ]);

      products = productsFetched;
      totalPage = Math.ceil(filteredCount / limit);

      await redis.setex(key, 30, JSON.stringify({ products, totalPage }));
    }

    return res.status(200).json({
      success: true,
      products,
      totalPage,
    });
  }
);

export const allReviewsOfProduct = TryCatch(async (req, res, next) => {
  let reviews;
  const key = `reviews-${req.params.id}`;

  reviews = await redis.get(key);

  if (reviews) reviews = JSON.parse(reviews);
  else {
    reviews = await Review.find({
      product: req.params.id,
    })
      .populate("user", "name photo")
      .sort({ updatedAt: -1 });

    await redis.setex(key, redisTTL, JSON.stringify(reviews));
  }

  return res.status(200).json({
    success: true,
    reviews,
  });
});

export const newReview = TryCatch(async (req, res, next) => {
  const user = req.user!;

  const product = await Product.findById(req.params.id);
  if (!product) return next(new ErrorHandler("Product Not Found", 404));

  const { comment, rating } = req.body;

  const alreadyReviewed = await Review.findOne({
    user: user._id,
    product: product._id,
  });

  if (alreadyReviewed) {
    alreadyReviewed.comment = comment;
    alreadyReviewed.rating = rating;

    await alreadyReviewed.save();
  } else {
    await Review.create({
      comment,
      rating,
      user: user._id,
      product: product._id,
    });
  }

  const { ratings, numOfReviews } = await findAverageRatings(product._id);

  product.ratings = ratings;
  product.numOfReviews = numOfReviews;

  await product.save();

  await invalidateCache({
    product: true,
    productId: String(product._id),
    admin: true,
    review: true,
  });

  return res.status(alreadyReviewed ? 200 : 201).json({
    success: true,
    message: alreadyReviewed ? "Review Update" : "Review Added",
  });
});

export const deleteReview = TryCatch(async (req, res, next) => {
  const user = req.user!;

  const review = await Review.findById(req.params.id);
  if (!review) return next(new ErrorHandler("Review Not Found", 404));

  const isAuthenticUser = review.user.toString() === user._id;

  if (!isAuthenticUser) return next(new ErrorHandler("Not Authorized", 403));

  await review.deleteOne();

  const product = await Product.findById(review.product);

  if (!product) return next(new ErrorHandler("Product Not Found", 404));

  const { ratings, numOfReviews } = await findAverageRatings(product._id);

  product.ratings = ratings;
  product.numOfReviews = numOfReviews;

  await product.save();

  await invalidateCache({
    product: true,
    productId: String(product._id),
    admin: true,
    review: true, // was missing: deleted reviews stayed visible for 4 hours
  });

  return res.status(200).json({
    success: true,
    message: "Review Deleted",
  });
});

// const generateRandomProducts = async (count: number = 10) => {
//   const products = [];

//   for (let i = 0; i < count; i++) {
//     const product = {
//       name: faker.commerce.productName(),
//       photo: "uploads\\5ba9bd91-b89c-40c2-bb8a-66703408f986.png",
//       price: faker.commerce.price({ min: 1500, max: 80000, dec: 0 }),
//       stock: faker.commerce.price({ min: 0, max: 100, dec: 0 }),
//       category: faker.commerce.department(),
//       createdAt: new Date(faker.date.past()),
//       updatedAt: new Date(faker.date.recent()),
//       __v: 0,
//     };

//     products.push(product);
//   }

//   await Product.create(products);

//   console.log({ succecss: true });
// };

// const deleteRandomsProducts = async (count: number = 10) => {
//   const products = await Product.find({}).skip(2);

//   for (let i = 0; i < products.length; i++) {
//     const product = products[i];
//     await product.deleteOne();
//   }

//   console.log({ succecss: true });
// };
