/*
  Seeds the store with demo products (photos are uploaded to YOUR Cloudinary).

    npm run seed            add the demo products
    npm run seed -- --dry   show what would be added, change nothing
    npm run seed -- --no-upload
                            keep the original image URLs (no Cloudinary keys
                            needed; handy for local development)

  Reads MONGO_URI, CLOUD_NAME, CLOUD_API_KEY and CLOUD_API_SECRET from .env.
  Safe to run more than once: products whose name already exists are skipped.

  Product data: a fixed snapshot of DummyJSON (https://dummyjson.com), a free
  demo-data set for testing shops. Prices are converted to INR.

  The live API caches product lists in Redis. After seeding, restart the
  backend (Render -> Manual Deploy -> Restart service): the server clears its
  read caches on startup, so the new products show up straight away.
*/
import { v2 as cloudinary } from "cloudinary";
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import mongoose from "mongoose";
import { Product } from "../models/product.js";

config({ path: "./.env" });

type SeedProduct = {
  name: string;
  price: number;
  stock: number;
  category: string;
  description: string;
  images: string[];
};

const dryRun = process.argv.includes("--dry");
// --no-upload: store the original image URLs instead of copying them to
// Cloudinary (local development, or seeding without Cloudinary keys)
const noUpload = process.argv.includes("--no-upload");
const products: SeedProduct[] = JSON.parse(
  readFileSync(new URL("./seed-products.json", import.meta.url), "utf8")
);

const required = dryRun || noUpload
  ? ["MONGO_URI"]
  : ["MONGO_URI", "CLOUD_NAME", "CLOUD_API_KEY", "CLOUD_API_SECRET"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing in .env: ${missing.join(", ")}`);
  process.exit(1);
}

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});

// Cloudinary fetches the image from the URL itself; nothing is downloaded here
const uploadPhoto = async (url: string) => {
  const result = await cloudinary.uploader.upload(url, {
    folder: "mern-ecommerce/products",
  });
  return { public_id: result.public_id, url: result.secure_url };
};

const main = async () => {
  // Same database name as the API (utils/features.ts connectDB)
  await mongoose.connect(process.env.MONGO_URI!, { dbName: "Ecommerce_24" });
  console.log(`Connected to MongoDB${dryRun ? " (dry run)" : ""}\n`);

  let added = 0;
  let skipped = 0;

  for (const item of products) {
    if (await Product.exists({ name: item.name })) {
      console.log(`skip   ${item.name} (already exists)`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`would add  ${item.name}  Rs.${item.price}  [${item.category}]`);
      added++;
      continue;
    }

    const photos = [];
    for (const [i, url] of item.images.entries())
      photos.push(
        noUpload
          ? { public_id: `seed/${item.name}/${i}`, url } // nothing in Cloudinary to delete
          : await uploadPhoto(url)
      );

    await Product.create({
      name: item.name,
      price: item.price,
      stock: item.stock,
      category: item.category.toLowerCase(),
      description: item.description,
      photos,
    });
    console.log(`added  ${item.name}  (${photos.length} photos)`);
    added++;
  }

  console.log(
    `\nDone: ${added} ${dryRun ? "to add" : "added"}, ${skipped} skipped.`
  );
  if (!dryRun && added)
    console.log(
      "Now restart the backend on Render so the site shows them right away."
    );
};

main()
  .catch((error) => {
    console.error("Seeding failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
