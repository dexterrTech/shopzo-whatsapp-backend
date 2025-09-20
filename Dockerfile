# Multi-stage build for Node.js TypeScript application

# Stage 1: Build stage
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the TypeScript application
RUN npm run build

# Stage 2: Production stage
FROM node:18-alpine AS production

# Install OpenSSL and other required packages
RUN apk add --no-cache openssl

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy environment example file
COPY .env.example ./

# Set default environment variables as fallback
ENV NODE_ENV=production
ENV PORT=8080
ENV USE_FALLBACK_WHEN_ERROR=true

# Change ownership to nodejs user
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "const http = require('http'); \
    const options = { host: 'localhost', port: 8080, path: '/health', timeout: 5000 }; \
    const req = http.request(options, (res) => { \
      if (res.statusCode === 200) process.exit(0); \
      else process.exit(1); \
    }); \
    req.on('error', () => process.exit(1)); \
    req.end();"

# Start the application
CMD ["npm", "start"]
