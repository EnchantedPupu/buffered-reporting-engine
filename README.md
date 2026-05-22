# Buffered Reporting Engine

Real-time financial transaction dashboard with a .NET 9 gRPC backend and a React + Redux frontend. The backend streams mock transactions at high frequency, while Redis provides a hot-cache layer to avoid repeated work. The frontend buffers incoming gRPC packets and only flushes to the UI every 500ms to avoid render storms.

## Features
- Server-streaming gRPC API using Protobuf
- Redis hot-cache with batch recycling to reduce load
- Request throttling per API instance
- Per-client token bucket rate limiting
- Health and Prometheus-style metrics endpoints
- React + Redux Toolkit state management
- Client-side buffer flush every 500ms
- Memoized stats (total revenue, average transaction)
- Virtualized list rendering via react-window
- gRPC-Web connection with reconnect and cached-view UI
- Adaptive client batch sizing based on buffer pressure
- Client-side localStorage cache for the last 10,000 transactions
- Client-side anomaly detection using rolling statistics

## Project Structure
- backend/ReportingService: .NET 9 gRPC server
- frontend/web-client: React + TypeScript + Vite app
- proto/Transaction.proto: Protobuf contract
- docker-compose.yml: Redis service

## Prerequisites
- .NET 9 SDK
- Node.js 18+ and npm
- Docker (for Redis)

## Run Locally

### 1) Start Redis

From the repository root:

```bash
docker compose up -d redis
```

or 

```bash
docker run --name buffered-reporting-engine-redis-1 -p 6379:6379 -d redis:7-alpine
```

Redis will be available at localhost:6379.

### 2) Start the backend

```bash
cd backend/ReportingService
dotnet restore
dotnet run
```

The gRPC server listens on http://0.0.0.0:7000 and has gRPC-Web enabled.

### 3) Start the frontend

```bash
cd frontend/web-client
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Architecture Details

### Backend streaming and caching
- Stream method: StreamTransactions (server streaming)
- Hot cache key: hot_transactions:{clientId}
- Cache value: a batch of transactions (default 100) to recycle
- Cache TTL: 2 seconds
- Request throttling: max 10 concurrent streams per API instance
- Per-client rate limiting: token bucket (120/sec with burst up to 200)
- Mock data: roughly 100 transactions per second via 10ms loop delay

### Cache invalidation strategy
If a transaction update needs to invalidate the cache while a stream is active, the backend subscribes to a Redis pub channel named transaction-updates. When it receives a client id, it deletes that clients hot cache key so the next loop iteration refreshes data.

Example with redis-cli:

```bash
PUBLISH transaction-updates browser-123456789
```


### Frontend buffering and rendering
- Incoming gRPC messages are buffered in memory.
- The buffer flushes into Redux every 500ms to avoid render storms.
- The UI shows cached-view status when the stream is down and reconnects with exponential backoff.
- Transactions are rendered using react-window for fast scrolling with large datasets.
- The client adapts the request batch size when the buffer grows or shrinks.
- The most recent transactions are persisted to localStorage and restored on reload.
- Anomalies are flagged using a rolling z-score once enough samples exist.

### Metrics and health
- Health endpoint: http://localhost:7000/health (JSON)
- Metrics endpoint: http://localhost:7000/metrics (Prometheus text format)
- The UI polls /health and shows a small metrics widget in the header.

## Configuration
- Redis: localhost:6379
- Backend: http://0.0.0.0:7000
- Frontend gRPC-Web client target: http://localhost:7000

## Notes
- Protobuf timestamps are stored as seconds + nanos. The UI builds a Date for display while keeping the full 9-digit fractional seconds.
- The generated protobuf client files are committed under frontend/web-client/src.

## Troubleshooting
- If the frontend cannot connect, confirm the backend is running on port 7000 and CORS is enabled.
- If Redis is missing, start it with docker-compose or update the backend configuration.
- If the stream stalls, check the backend logs for ResourceExhausted (too many concurrent streams).
