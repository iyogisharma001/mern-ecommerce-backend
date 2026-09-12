# ⚙️ MERN E-Commerce Backend Microservice & API Engine

A robust RESTful backend engine powering a multi-feature e-commerce platform and real-time admin analytics dashboard. Built with Node.js, Express.js, TypeScript, and MongoDB.

Developed & Maintained by **Yogesh Sharma** ([GitHub](https://github.com/iyogisharma001) | [LinkedIn](https://www.linkedin.com/in/yogesh-sharma-597466325/)).

---

## 🛠️ Tech Stack & Key Technologies

- **Server Runtime:** Node.js & Express.js (TypeScript)
- **Database Layer:** MongoDB with Mongoose ODM
- **Caching Layer:** NodeCache (In-memory server caching for high-speed read queries)
- **Payment Processing:** Stripe REST API & Payment Intents
- **Security & Authentication:** Firebase Admin SDK & CORS middleware

---

## ⚡ Architecture Highlights & Features

- **Complex Aggregation Pipelines:** Custom MongoDB `$group`, `$match`, and `$project` aggregation pipelines driving dynamic Admin Dashboard analytics (calculating total revenue, monthly performance splits, transaction counts, and inventory distribution).
- **Server-Side Query Caching:** Integrated in-memory caching to serve high-frequency product catalog reads, significantly reducing database IOPS and improving response latency.
- **Cache Invalidation Workflow:** Built-in cache purging strategy attached to mutation endpoints (`POST`, `PUT`, `DELETE`), ensuring zero stale data delivery to client apps.
- **Role-Based Endpoint Protection:** Security middleware restricting administrative analytics and product management endpoints exclusively to authorized admins.

---

## ⚙️ Installation & Setup

### 1. Prerequisites
- Node.js (v18+)
- MongoDB (Local instance or MongoDB Atlas cluster)

### 2. Install Dependencies
```bash
npm install