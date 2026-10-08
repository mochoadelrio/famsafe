# syntax=docker/dockerfile:1
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application source code
COPY . .

# Create persistent data directory
RUN mkdir -p /app/data

# Environment variables
ENV NODE_ENV=production
ENV PORT=3005

# Expose internal port
EXPOSE 3005

# Persistent volume for SQLite/JSON database
VOLUME ["/app/data"]

# Start server
CMD ["node", "src/server.js"]
