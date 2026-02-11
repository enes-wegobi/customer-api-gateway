# 1Driver Main API

Backend API for the 1Driver ride-hailing platform. Handles trips, real-time tracking, payments, and notifications.

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [API](#api)
- [Contributing](#contributing)
- [License](#license)

## Background

1Driver Main API is a ride-hailing backend service built with NestJS and Fastify. It communicates with an external User Service for authentication, customer, and driver operations.

For detailed architecture, flows, and technical documentation see [ARCHITECTURE.md](./ARCHITECTURE.md).

### Tech Stack

- **Framework**: NestJS + Fastify
- **Database**: MongoDB (Mongoose)
- **Cache/Queue**: Valkey (Redis-compatible) + BullMQ
- **Real-time**: Socket.IO
- **Payments**: Stripe
- **Storage**: AWS S3 / DigitalOcean Spaces
- **Notifications**: Expo Push, SMS

### Features

- Customer & Driver authentication (OTP-based)
- Real-time trip management and tracking
- Driver matching and assignment
- Payment processing with Stripe
- WebSocket communication
- Push notifications
- Document verification for drivers
- Support ticket system

## Install

### Prerequisites

- Node.js 23+
- MongoDB
- Valkey (Redis-compatible)

### Installation

```bash
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in the required values:

```bash
cp .env.example .env
```

### Local Infrastructure (Docker)

Start MongoDB and Valkey for local development:

```bash
docker compose -f ../1driver-infra/docker-compose-local.yml up -d
```

## Usage

### Running the App

```bash
# Development (hot reload)
npm run start:dev

# Debug mode
npm run start:debug

# Production
npm run build
npm run start:prod
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run start:dev` | Development with watch |
| `npm run start:debug` | Debug mode with watch |
| `npm run build` | Build for production |
| `npm run start:prod` | Run production build |
| `npm run test` | Run tests |
| `npm run lint` | Lint code |
| `npm run seed:admin` | Create admin user |

## API

Swagger UI available at `/api/docs` when running.

### Health Checks

- `GET /api/health` — Overall health
- `GET /api/health/ready` — Readiness probe
- `GET /api/health/live` — Liveness probe

### Project Structure

```
src/
├── modules/                # Feature modules
│   ├── auth/              # OTP registration/login (User Service proxy)
│   ├── admin/             # Admin panel (7 controllers)
│   ├── trip/              # Trip lifecycle (core business logic)
│   ├── payments/          # Stripe payments + webhooks
│   ├── customers/         # Customer profiles (User Service proxy)
│   ├── drivers/           # Driver profiles + weekly earnings
│   ├── campaigns/         # Campaign/discount system
│   ├── notifications/     # In-app notifications
│   ├── expo-notifications/# Push notifications (Expo SDK)
│   ├── sms/               # OTP SMS delivery
│   ├── event/             # Event delivery (WS vs Push routing)
│   ├── location/          # REST location updates
│   ├── content/           # FAQ, bank list
│   ├── support-tickets/   # Support tickets
│   ├── common/            # App config, version check
│   └── health/            # Liveness, readiness, WS health
├── websocket/             # Real-time events
├── queue/                 # Background jobs (BullMQ)
├── redis/                 # Redis/Valkey services
├── clients/               # User Service HTTP clients
├── config/                # Env config
├── common/                # Shared enums, DTOs, utils
├── jwt/                   # JWT service + guards
├── events/                # EventEmitter handlers
├── s3/                    # File upload (DigitalOcean Spaces)
├── logger/                # Winston + request logging
├── lock/                  # Distributed lock (Redis)
└── main.ts                # Entry point
```

## Contributing

PRs and issues are welcome. Please open an issue first to discuss proposed changes.

## License

Proprietary. All rights reserved.
