# Juspay Agent Framework (JAF) Production Deployment Guide

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Environment Configuration](#environment-configuration)
4. [Database Setup](#database-setup)
5. [Docker Containerization](#docker-containerization)
6. [Load Balancing and Scaling](#load-balancing-and-scaling)
7. [Monitoring and Observability](#monitoring-and-observability)
8. [Security Considerations](#security-considerations)
9. [CI/CD Pipeline](#cicd-pipeline)
10. [Performance Optimization](#performance-optimization)
11. [Troubleshooting](#troubleshooting)

## Architecture Overview

JAF is a purely functional agent framework built with TypeScript, featuring:

- **Core Engine**: Stateless, immutable execution engine
- **Memory Providers**: Pluggable conversation storage (In-Memory, Redis, PostgreSQL)
- **Server Runtime**: Fastify-based HTTP server with REST API
- **Tool System**: Composable, type-safe function calling
- **LLM Integration**: Model Context Protocol (MCP) and LiteLLM support
- **Tracing**: Built-in observability and debugging

### Key Dependencies

- **Runtime**: Node.js 18+ (ES2022 target)
- **Framework**: Fastify 4.x for HTTP server
- **Validation**: Zod for schema validation
- **LLM**: OpenAI SDK 4.x, MCP SDK 0.4.x
- **Memory**: Optional Redis 4.x or PostgreSQL 8.x clients

## Prerequisites

### System Requirements

- **Node.js**: 18.x or higher (LTS recommended)
- **Memory**: Minimum 512MB RAM, 2GB+ recommended for production
- **Storage**: 10GB+ for application and logs
- **Network**: HTTP/HTTPS traffic on configurable ports

### External Services

- **LLM Provider**: LiteLLM server or direct OpenAI API access
- **Database** (optional): PostgreSQL 12+ or Redis 6+
- **Load Balancer** (recommended): nginx, HAProxy, or cloud LB

## Environment Configuration

### Core Environment Variables

```bash
# Server Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# LLM Configuration
LITELLM_URL=http://litellm:4000
LITELLM_API_KEY=your-api-key
LITELLM_MODEL=gpt-4o-mini

# Memory Provider Configuration
JAF_MEMORY_TYPE=postgres  # options: memory, redis, postgres
```

### Memory Provider Configuration

#### PostgreSQL Configuration
```bash
# PostgreSQL Memory Provider
JAF_MEMORY_TYPE=postgres
JAF_POSTGRES_HOST=postgres
JAF_POSTGRES_PORT=5432
JAF_POSTGRES_DB=jaf_memory
JAF_POSTGRES_USER=jaf_user
JAF_POSTGRES_PASSWORD=secure_password
JAF_POSTGRES_SSL=true
JAF_POSTGRES_TABLE=conversations
JAF_POSTGRES_MAX_CONNECTIONS=10

# Alternative: Connection String
JAF_POSTGRES_CONNECTION_STRING=postgresql://jaf_user:secure_password@postgres:5432/jaf_memory?sslmode=require
```

#### Redis Configuration
```bash
# Redis Memory Provider
JAF_MEMORY_TYPE=redis
JAF_REDIS_HOST=redis
JAF_REDIS_PORT=6379
JAF_REDIS_PASSWORD=secure_redis_password
JAF_REDIS_DB=0
JAF_REDIS_PREFIX=jaf:memory:
JAF_REDIS_TTL=86400  # 24 hours in seconds

# Alternative: Redis URL
JAF_REDIS_URL=redis://:secure_redis_password@redis:6379/0
```

#### In-Memory Configuration
```bash
# In-Memory Provider (development only)
JAF_MEMORY_TYPE=memory
JAF_MEMORY_MAX_CONVERSATIONS=1000
JAF_MEMORY_MAX_MESSAGES=1000
```

## Database Setup

### PostgreSQL Setup

#### 1. Database Initialization

```sql
-- Create database and user
CREATE DATABASE jaf_memory;
CREATE USER jaf_user WITH ENCRYPTED PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE jaf_memory TO jaf_user;

-- Connect to the database
\c jaf_memory;

-- Grant schema permissions
GRANT ALL ON SCHEMA public TO jaf_user;
```

#### 2. Table Schema

The JAF PostgreSQL provider automatically creates the required schema:

```sql
CREATE TABLE IF NOT EXISTS conversations (
    conversation_id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255),
    messages JSONB NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations (user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations (created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_last_activity ON conversations (last_activity);
CREATE INDEX IF NOT EXISTS idx_conversations_metadata_gin ON conversations USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_conversations_trace_id ON conversations ((metadata->>'traceId'));
```

#### 3. Production PostgreSQL Configuration

```ini
# postgresql.conf optimizations
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 16MB
maintenance_work_mem = 64MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
```

### Redis Setup

#### 1. Redis Configuration

```ini
# redis.conf
bind 0.0.0.0
port 6379
requirepass secure_redis_password
maxmemory 512mb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
```

#### 2. Redis Persistence Strategy

For production, choose between:
- **RDB**: Point-in-time snapshots (lower overhead)
- **AOF**: Append-only file (better durability)
- **Mixed**: RDB + AOF (recommended for critical data)

```ini
# Mixed persistence (recommended)
save 300 10
appendonly yes
appendfsync everysec
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
```

## Docker Containerization

### Application Dockerfile

```dockerfile
# Multi-stage build for production
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY src/ ./src/

# Build application
RUN npm run build

# Production stage
FROM node:18-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S jaf && \
    adduser -S jaf -u 1001

WORKDIR /app

# Copy built application and dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Change ownership to non-root user
RUN chown -R jaf:jaf /app
USER jaf

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "http.get('http://localhost:' + (process.env.PORT || 3000) + '/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"

# Expose port
EXPOSE 3000

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
```

### Docker Compose for Development

```yaml
version: '3.8'

services:
  jaf-app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - PORT=3000
      - HOST=0.0.0.0
      - JAF_MEMORY_TYPE=postgres
      - JAF_POSTGRES_HOST=postgres
      - JAF_POSTGRES_DB=jaf_memory
      - JAF_POSTGRES_USER=jaf_user
      - JAF_POSTGRES_PASSWORD=dev_password
      - LITELLM_URL=http://litellm:4000
    depends_on:
      - postgres
      - redis
      - litellm
    volumes:
      - ./src:/app/src
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=jaf_memory
      - POSTGRES_USER=jaf_user
      - POSTGRES_PASSWORD=dev_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass dev_password
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    restart: unless-stopped

  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    ports:
      - "4000:4000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    volumes:
      - ./litellm-config.yaml:/app/config.yaml
    command: ["--config", "/app/config.yaml", "--port", "4000"]
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

### Production Docker Compose

```yaml
version: '3.8'

services:
  jaf-app:
    image: your-registry/jaf-app:latest
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - HOST=0.0.0.0
    env_file:
      - .env.production
    deploy:
      replicas: 3
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
      restart_policy:
        condition: on-failure
        max_attempts: 3
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    depends_on:
      - postgres
      - redis

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - jaf-app
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=${JAF_POSTGRES_DB}
      - POSTGRES_USER=${JAF_POSTGRES_USER}
      - POSTGRES_PASSWORD=${JAF_POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./postgresql.conf:/etc/postgresql/postgresql.conf
    command: postgres -c config_file=/etc/postgresql/postgresql.conf
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server /etc/redis/redis.conf
    volumes:
      - redis_data:/data
      - ./redis.conf:/etc/redis/redis.conf:ro
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

## Load Balancing and Scaling

### Nginx Configuration

```nginx
upstream jaf_backend {
    least_conn;
    server jaf-app-1:3000 weight=1 max_fails=3 fail_timeout=30s;
    server jaf-app-2:3000 weight=1 max_fails=3 fail_timeout=30s;
    server jaf-app-3:3000 weight=1 max_fails=3 fail_timeout=30s;
}

server {
    listen 80;
    server_name your-domain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    # SSL Configuration
    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";
    
    # Compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain application/json application/xml;
    
    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    
    location / {
        limit_req zone=api burst=20 nodelay;
        
        proxy_pass http://jaf_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 5s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # SSE streaming endpoint (optional: if you want specific tuning)
    location = /chat {
        proxy_pass http://jaf_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        add_header X-Accel-Buffering no;
    }
    
    # Health check endpoint (bypass rate limiting)
    location /health {
        proxy_pass http://jaf_backend;
        access_log off;
    }
    
    # Static files (if any)
    location /static/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jaf-app
  labels:
    app: jaf-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: jaf-app
  template:
    metadata:
      labels:
        app: jaf-app
    spec:
      containers:
      - name: jaf-app
        image: your-registry/jaf-app:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: PORT
          value: "3000"
        - name: HOST
          value: "0.0.0.0"
        envFrom:
        - secretRef:
            name: jaf-secrets
        - configMapRef:
            name: jaf-config
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
        securityContext:
          runAsNonRoot: true
          runAsUser: 1001
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
            - ALL

---
apiVersion: v1
kind: Service
metadata:
  name: jaf-app-service
spec:
  selector:
    app: jaf-app
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: ClusterIP

---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: jaf-app-ingress
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/rate-limit: "100"
spec:
  tls:
  - hosts:
    - your-domain.com
    secretName: jaf-tls
  rules:
  - host: your-domain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: jaf-app-service
            port:
              number: 80

---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: jaf-app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: jaf-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

## Monitoring and Observability

### Application Metrics

JAF provides built-in health checks and tracing. Implement additional monitoring:

```typescript
// Custom metrics for Prometheus
import promClient from 'prom-client';

// Create metrics
const httpRequestDuration = new promClient.Histogram({
  name: 'jaf_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5]
});

const conversationCounter = new promClient.Counter({
  name: 'jaf_conversations_total',
  help: 'Total number of conversations',
  labelNames: ['agent', 'memory_provider']
});

const memoryProviderLatency = new promClient.Histogram({
  name: 'jaf_memory_provider_duration_seconds',
  help: 'Memory provider operation duration',
  labelNames: ['provider', 'operation'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1]
});

// Middleware for metrics collection
app.addHook('onRequest', async (request, reply) => {
  request.startTime = Date.now();
});

app.addHook('onResponse', async (request, reply) => {
  const duration = (Date.now() - request.startTime) / 1000;
  httpRequestDuration
    .labels(request.method, request.routerPath, reply.statusCode.toString())
    .observe(duration);
});

// Metrics endpoint
app.get('/metrics', async (request, reply) => {
  const metrics = await promClient.register.metrics();
  reply.type('text/plain').send(metrics);
});
```

### Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'jaf-app'
    static_configs:
      - targets: ['jaf-app:3000']
    scrape_interval: 15s
    metrics_path: /metrics

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres-exporter:9187']

  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']

rule_files:
  - "jaf_alerts.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']
```

### Alert Rules

```yaml
# jaf_alerts.yml
groups:
  - name: jaf_alerts
    rules:
      - alert: JAFHighErrorRate
        expr: rate(jaf_http_request_duration_seconds_count{status_code=~"5.."}[5m]) > 0.1
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High error rate detected"
          description: "JAF application has a high error rate: {{ $value }} errors/sec"

      - alert: JAFHighLatency
        expr: histogram_quantile(0.95, rate(jaf_http_request_duration_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High latency detected"
          description: "95th percentile latency is {{ $value }}s"

      - alert: JAFMemoryProviderDown
        expr: up{job="jaf-app"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "JAF application is down"
          description: "JAF application has been down for more than 1 minute"

      - alert: PostgreSQLDown
        expr: up{job="postgres"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL is down"
          description: "PostgreSQL database is not responding"
```

### Grafana Dashboard

```json
{
  "dashboard": {
    "title": "JAF Application Dashboard",
    "panels": [
      {
        "title": "Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(jaf_http_request_duration_seconds_count[5m])",
            "legendFormat": "{{method}} {{route}}"
          }
        ]
      },
      {
        "title": "Response Time",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(jaf_http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "95th percentile"
          },
          {
            "expr": "histogram_quantile(0.50, rate(jaf_http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "50th percentile"
          }
        ]
      },
      {
        "title": "Memory Provider Latency",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(jaf_memory_provider_duration_seconds_bucket[5m]))",
            "legendFormat": "{{provider}} {{operation}}"
          }
        ]
      },
      {
        "title": "Conversation Count",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(jaf_conversations_total[5m])",
            "legendFormat": "{{agent}}"
          }
        ]
      }
    ]
  }
}
```

### Centralized Logging

```yaml
# fluentd/fluent.conf
<source>
  @type forward
  port 24224
  bind 0.0.0.0
</source>

<filter docker.**>
  @type parser
  key_name log
  <parse>
    @type json
    time_key timestamp
    time_format %Y-%m-%dT%H:%M:%S.%LZ
  </parse>
</filter>

<match docker.jaf-app>
  @type elasticsearch
  host elasticsearch
  port 9200
  index_name jaf-logs
  type_name _doc
  <buffer>
    @type file
    path /var/log/fluentd-buffers/jaf.buffer
    flush_mode interval
    flush_interval 10s
  </buffer>
</match>
```

## Security Considerations

### Application Security

1. **Input Validation**
   - All user inputs are validated using Zod schemas
   - Tool parameter validation is enforced
   - SQL injection prevention through parameterized queries

2. **Authentication & Authorization**
   ```typescript
   // Example JWT middleware
   app.addHook('preHandler', async (request, reply) => {
     if (request.url.startsWith('/api/')) {
       const token = request.headers.authorization?.replace('Bearer ', '');
       if (!token) {
         return reply.code(401).send({ error: 'Authentication required' });
       }
       
       try {
         const decoded = jwt.verify(token, process.env.JWT_SECRET);
         request.user = decoded;
       } catch (error) {
         return reply.code(401).send({ error: 'Invalid token' });
       }
     }
   });
   ```

3. **Rate Limiting**
   ```typescript
   import rateLimit from '@fastify/rate-limit';
   
   await app.register(rateLimit, {
     max: 100,
     timeWindow: '1 minute',
     errorResponseBuilder: function (request, context) {
       return {
         code: 429,
         error: 'Rate limit exceeded',
         message: `Rate limit exceeded, retry in ${Math.round(context.ttl / 1000)} seconds`,
         retryAfter: context.ttl
       };
     }
   });
   ```

### Infrastructure Security

1. **Network Security**
   - Use private networks for database connections
   - Implement firewall rules
   - Enable VPC/security groups in cloud environments

2. **Database Security**
   ```sql
   -- PostgreSQL security hardening
   ALTER SYSTEM SET ssl = on;
   ALTER SYSTEM SET log_statement = 'all';
   ALTER SYSTEM SET log_min_duration_statement = 1000;
   
   -- Create limited user for application
   CREATE USER jaf_app WITH PASSWORD 'secure_password';
   GRANT CONNECT ON DATABASE jaf_memory TO jaf_app;
   GRANT USAGE ON SCHEMA public TO jaf_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON conversations TO jaf_app;
   ```

3. **Container Security**
   ```dockerfile
   # Security-hardened Dockerfile additions
   RUN apk add --no-cache ca-certificates && \
       apk update && apk upgrade && \
       rm -rf /var/cache/apk/*
   
   # Remove package managers
   RUN rm -rf /usr/local/lib/node_modules/npm
   
   # Set read-only filesystem
   USER 1001
   ENV NODE_OPTIONS="--max-old-space-size=256"
   ```

### Secrets Management

```yaml
# Kubernetes secrets
apiVersion: v1
kind: Secret
metadata:
  name: jaf-secrets
type: Opaque
stringData:
  LITELLM_API_KEY: "your-api-key"
  JAF_POSTGRES_PASSWORD: "secure-database-password"
  JAF_REDIS_PASSWORD: "secure-redis-password"
  JWT_SECRET: "your-jwt-secret"

---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: jaf-external-secrets
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-secret-store
    kind: SecretStore
  target:
    name: jaf-secrets
    creationPolicy: Owner
  data:
  - secretKey: LITELLM_API_KEY
    remoteRef:
      key: secret/jaf
      property: litellm_api_key
```

## CI/CD Pipeline

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Build and Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: jaf_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
      
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 6379:6379

    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run tests
      run: npm test
      env:
        JAF_POSTGRES_HOST: localhost
        JAF_POSTGRES_DB: jaf_test
        JAF_POSTGRES_USER: postgres
        JAF_POSTGRES_PASSWORD: test
        JAF_REDIS_HOST: localhost
    
    - name: Type check
      run: npm run typecheck
    
    - name: Lint
      run: npm run lint

  build:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Docker Buildx
      uses: docker/setup-buildx-action@v3
    
    - name: Login to Container Registry
      uses: docker/login-action@v3
      with:
        registry: ghcr.io
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}
    
    - name: Build and push
      uses: docker/build-push-action@v5
      with:
        context: .
        push: true
        tags: |
          ghcr.io/${{ github.repository }}:latest
          ghcr.io/${{ github.repository }}:${{ github.sha }}
        cache-from: type=gha
        cache-to: type=gha,mode=max

  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment: production
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Deploy to Kubernetes
      uses: azure/k8s-deploy@v1
      with:
        manifests: |
          k8s/deployment.yaml
          k8s/service.yaml
          k8s/ingress.yaml
        images: |
          ghcr.io/${{ github.repository }}:${{ github.sha }}
        kubectl-version: 'latest'
```

### Helm Chart

```yaml
# Chart.yaml
apiVersion: v2
name: jaf-app
description: Juspay Agent Framework Application
version: 0.1.0
appVersion: "1.0"

# values.yaml
replicaCount: 3

image:
  repository: ghcr.io/your-org/jaf-app
  pullPolicy: IfNotPresent
  tag: ""

service:
  type: ClusterIP
  port: 80
  targetPort: 3000

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: jaf.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: jaf-tls
      hosts:
        - jaf.example.com

resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 250m
    memory: 256Mi

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70

postgresql:
  enabled: true
  auth:
    postgresPassword: secure-password
    database: jaf_memory

redis:
  enabled: true
  auth:
    enabled: true
    password: secure-redis-password
```

## Performance Optimization

### Application Optimization

1. **Memory Management**
   ```typescript
   // Configure memory limits
   process.env.NODE_OPTIONS = '--max-old-space-size=512';
   
   // Implement conversation cleanup
   async function cleanupOldConversations() {
     if (memoryProvider.cleanupOldConversations) {
       const result = await memoryProvider.cleanupOldConversations(30); // 30 days
       console.log(`Cleaned up ${result.data} old conversations`);
     }
   }
   
   // Schedule cleanup
   setInterval(cleanupOldConversations, 24 * 60 * 60 * 1000); // Daily
   ```

2. **Connection Pooling**
   ```typescript
   // PostgreSQL connection pooling
   const { Pool } = require('pg');
   const pool = new Pool({
     host: process.env.JAF_POSTGRES_HOST,
     port: process.env.JAF_POSTGRES_PORT,
     database: process.env.JAF_POSTGRES_DB,
     user: process.env.JAF_POSTGRES_USER,
     password: process.env.JAF_POSTGRES_PASSWORD,
     max: 20,
     idleTimeoutMillis: 30000,
     connectionTimeoutMillis: 2000,
   });
   ```

3. **Response Caching**
   ```typescript
   import { fastifyRedis } from '@fastify/redis';
   
   await app.register(fastifyRedis, {
     host: process.env.REDIS_HOST,
     port: process.env.REDIS_PORT
   });
   
   // Cache conversation responses
   app.addHook('onSend', async (request, reply, payload) => {
     if (request.url.includes('/conversations/')) {
       const cacheKey = `cache:${request.url}`;
       await app.redis.setex(cacheKey, 300, payload); // 5 minutes
     }
   });
   ```

### Database Optimization

1. **PostgreSQL Tuning**
   ```sql
   -- Analyze query performance
   EXPLAIN (ANALYZE, BUFFERS) 
   SELECT * FROM conversations 
   WHERE user_id = 'user123' 
   ORDER BY last_activity DESC 
   LIMIT 10;
   
   -- Create covering indexes
   CREATE INDEX CONCURRENTLY idx_conversations_user_activity 
   ON conversations (user_id, last_activity DESC) 
   INCLUDE (conversation_id, metadata);
   
   -- Partition large tables
   CREATE TABLE conversations_y2024m01 PARTITION OF conversations
   FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
   ```

2. **Redis Optimization**
   ```bash
   # Redis memory optimization
   CONFIG SET maxmemory-policy allkeys-lru
   CONFIG SET hash-max-ziplist-entries 512
   CONFIG SET hash-max-ziplist-value 64
   CONFIG SET list-max-ziplist-size -2
   ```

### Monitoring Performance

```typescript
// Performance monitoring middleware
app.addHook('onRequest', async (request, reply) => {
  request.startTime = process.hrtime.bigint();
});

app.addHook('onResponse', async (request, reply) => {
  const duration = Number(process.hrtime.bigint() - request.startTime) / 1e6;
  
  // Log slow requests
  if (duration > 1000) {
    console.warn(`Slow request: ${request.method} ${request.url} took ${duration}ms`);
  }
  
  // Add performance headers
  reply.header('X-Response-Time', `${duration}ms`);
});
```

## Troubleshooting

### Common Issues

#### 1. Memory Provider Connection Issues

**Symptoms:**
- "Failed to connect to PostgreSQL/Redis memory provider"
- Health check failures
- Connection timeouts

**Solutions:**
```bash
# Check connectivity
docker exec jaf-app nc -zv postgres 5432
docker exec jaf-app nc -zv redis 6379

# Verify credentials
docker exec postgres psql -U jaf_user -d jaf_memory -c "SELECT 1;"

# Check Redis auth
docker exec redis redis-cli -a password ping
```

#### 2. High Memory Usage

**Symptoms:**
- Container OOM kills
- Performance degradation
- Memory leaks

**Solutions:**
```typescript
// Monitor memory usage
setInterval(() => {
  const usage = process.memoryUsage();
  console.log(`Memory usage: RSS=${Math.round(usage.rss / 1024 / 1024)}MB, Heap=${Math.round(usage.heapUsed / 1024 / 1024)}MB`);
  
  if (usage.rss > 400 * 1024 * 1024) { // 400MB threshold
    console.warn('High memory usage detected');
  }
}, 30000);

// Force garbage collection
if (global.gc) {
  setInterval(() => {
    global.gc();
  }, 60000);
}
```

#### 3. LLM Provider Issues

**Symptoms:**
- Chat endpoints returning 500 errors
- "Model provider not available"
- Timeout errors

**Solutions:**
```bash
# Test LiteLLM connectivity
curl -H "Authorization: Bearer $LITELLM_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-3.5-turbo","messages":[{"role":"user","content":"test"}]}' \
     http://litellm:4000/v1/chat/completions

# Check model availability
curl http://litellm:4000/v1/models
```

#### 4. Database Performance Issues

**Symptoms:**
- Slow response times
- Connection pool exhaustion
- Lock timeouts

**Solutions:**
```sql
-- Check active connections
SELECT count(*) FROM pg_stat_activity WHERE state = 'active';

-- Identify slow queries
SELECT query, mean_exec_time, calls 
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;

-- Check table sizes
SELECT schemaname,tablename,attname,n_distinct,correlation 
FROM pg_stats 
WHERE tablename = 'conversations';
```

### Health Check Endpoints

```typescript
// Comprehensive health check
app.get('/health/detailed', async (request, reply) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks: {
      database: { status: 'unknown' },
      memory: { status: 'unknown' },
      llm: { status: 'unknown' }
    }
  };

  // Check database
  try {
    const dbResult = await memoryProvider.healthCheck();
    health.checks.database = {
      status: dbResult.data?.healthy ? 'healthy' : 'unhealthy',
      latency: dbResult.data?.latencyMs
    };
  } catch (error) {
    health.checks.database = { status: 'error', error: error.message };
  }

  // Check memory usage
  const memUsage = process.memoryUsage();
  health.checks.memory = {
    status: memUsage.rss < 400 * 1024 * 1024 ? 'healthy' : 'warning',
    rss: Math.round(memUsage.rss / 1024 / 1024),
    heap: Math.round(memUsage.heapUsed / 1024 / 1024)
  };

  // Overall status
  const allHealthy = Object.values(health.checks).every(check => 
    check.status === 'healthy' || check.status === 'warning'
  );
  
  if (!allHealthy) {
    health.status = 'unhealthy';
    return reply.code(503).send(health);
  }

  return reply.send(health);
});
```

### Log Analysis

```bash
# Common log queries
# High error rate
kubectl logs -l app=jaf-app | grep "ERROR" | tail -50

# Slow requests
kubectl logs -l app=jaf-app | grep "Slow request" | tail -20

# Memory provider issues
kubectl logs -l app=jaf-app | grep "MEMORY:" | tail -30

# Connection issues
kubectl logs -l app=jaf-app | grep -E "(ECONNREFUSED|timeout|connection)" | tail -20
```

### Performance Debugging

```typescript
// Add request tracing
app.addHook('onRequest', async (request, reply) => {
  request.trace = {
    id: uuidv4(),
    start: Date.now(),
    path: request.url,
    method: request.method
  };
  console.log(`[${request.trace.id}] Started ${request.method} ${request.url}`);
});

app.addHook('onResponse', async (request, reply) => {
  const duration = Date.now() - request.trace.start;
  console.log(`[${request.trace.id}] Completed in ${duration}ms with status ${reply.statusCode}`);
});

// Database query timing
const originalQuery = pool.query;
pool.query = function(...args) {
  const start = Date.now();
  return originalQuery.apply(this, args).finally(() => {
    const duration = Date.now() - start;
    if (duration > 100) {
      console.warn(`Slow query took ${duration}ms:`, args[0]);
    }
  });
};
```

This comprehensive deployment guide provides all the necessary information to deploy JAF applications to production environments. The guide covers everything from basic containerization to advanced Kubernetes deployments, monitoring, security, and troubleshooting.

For additional support or specific deployment scenarios, refer to the individual component documentation and consider the specific requirements of your infrastructure and compliance needs.
