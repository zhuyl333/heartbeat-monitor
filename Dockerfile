# Use the official Node.js image
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy app source
COPY src/ ./src/
COPY public/ ./public/

# Create data directory for SQLite
RUN mkdir -p /app/data

# Expose the port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/status || exit 1

# Run the app
CMD ["node", "src/server.js"]
