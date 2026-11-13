# ---- Build: compile TypeScript ----
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Run: only production dependencies + compiled JS ----
# (smaller image, fits Render's free 512 MB instance more comfortably)
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Render sets PORT itself; 4000 is the local default from app.ts
EXPOSE 4000
CMD ["node", "dist/app.js"]
