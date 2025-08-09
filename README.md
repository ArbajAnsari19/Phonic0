# Phonic0 MVP - AI Calling Agent Platform

## Phase 2 Complete: React Frontend + Auth Service

This features both Phase 1 (auth service) and Phase 2 (modern React frontend) of the Phonic0 MVP implementation, with a complete YC-style dashboard and authentication system.

### Architecture

```
/Phonic0
  /packages
    /auth-service       (✅ Complete - signup/login + brain CRUD)
    /frontend           (✅ Complete - React + YC-style dashboard)
    /kyutai-client      (Coming in Phase 3)
    /orchestrator       (Coming in Phase 4)
    /gateway-service    (Coming in Phase 5)
```

### Prerequisites

- Node.js 18+ 
- pnpm 8+
- MongoDB (local or Atlas)
- Docker (for future phases)

### Quick Start

1. **Clone and install dependencies:**
```bash
cd Phonic0
npm install
```

2. **Set up environment variables:**
```bash
cd packages/auth-service
cp env.example .env
# Edit .env with your MongoDB URI and JWT secret
```

Example `.env` content:
```env
PORT=3001
MONGODB_URI=mongodb://localhost:27017/phonic0
JWT_SECRET=phonic0-super-secret-jwt-key-for-development-only
JWT_EXPIRES_IN=7d
NODE_ENV=development
```

3. **Start MongoDB (if running locally):**
```bash
# Using Docker
docker run -d -p 27017:27017 --name phonic0-mongodb mongo:7

# Or use existing MongoDB installation
```

4. **Start both services:**
```bash
# Start both auth service and frontend
npm run dev:all

# Or start individually:
npm run dev:auth      # Backend API (port 3001)
npm run dev:frontend  # React frontend (port 3000)
```

The services will be available at:
- **Frontend**: `http://localhost:3000` (main app)
- **Backend API**: `http://localhost:3001` (auth service)

### API Endpoints

#### Authentication
- `POST /api/auth/signup` - Create new user account
- `POST /api/auth/login` - User login
- `GET /api/auth/profile` - Get user profile (protected)

#### Brain Management
- `POST /api/brain` - Create new brain (protected)
- `GET /api/brain` - List user's brains (protected)
- `GET /api/brain/active` - Get active brain (protected)
- `GET /api/brain/:id` - Get specific brain (protected)
- `PUT /api/brain/:id` - Update brain (protected)
- `DELETE /api/brain/:id` - Delete brain (protected)

### Testing the API

#### Quick Test (Automated)
Run the comprehensive test script:
```bash
./test-api.sh
```

This script tests all endpoints automatically with sample data.

#### Manual Testing

#### 1. Health Check
```bash
curl http://localhost:3001/health
```

#### 2. Create User
```bash
curl -X POST http://localhost:3001/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com", 
    "password": "password123"
  }'
```

#### 3. Login
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "password123"
  }'
```

#### 4. Create Brain (use token from login)
```bash
curl -X POST http://localhost:3001/api/brain \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "Customer Service Agent",
    "instructions": "You are a helpful customer service agent. Be polite, professional, and try to solve customer problems efficiently.",
    "description": "Main customer service brain for handling general inquiries"
  }'
```

#### 5. Get Active Brain
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:3001/api/brain/active
```

### Environment Variables

Create `packages/auth-service/.env`:

```env
PORT=3001
MONGODB_URI=mongodb://localhost:27017/phonic0
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d
NODE_ENV=development
```

### Features Implemented

✅ **Complete Auth System:**
- User signup/login with JWT
- Password hashing with bcrypt
- Protected routes middleware
- Input validation with Joi

✅ **Brain Management:**
- Full CRUD operations for AI agent personalities
- User-scoped brain storage
- Active brain selection
- Pagination for brain lists

✅ **Modern React Frontend:**
- YC-backed company style design
- Responsive dashboard with real-time stats
- Beautiful authentication pages
- React Router with protected routes
- React Query for state management
- Tailwind CSS for styling
- Framer Motion animations
- Toast notifications
- TypeScript throughout

✅ **Production Ready:**
- TypeScript throughout
- Error handling middleware
- Security headers with Helmet
- Rate limiting
- CORS support
- MongoDB connection management
- Vite build system
- Component architecture

### Next Phase

**Phase 3:** Kyutai Client Integration
- gRPC client for Moshi STT/TTS
- Proto stubs with mock responses
- Audio streaming capabilities
- Real-time speech processing

### Development Commands

```bash
# Start both services concurrently
npm run dev:all

# Start individual services
npm run dev:auth      # Auth service only (port 3001)
npm run dev:frontend  # Frontend only (port 3000)

# Build commands
npm run build --workspace=auth-service
npm run build --workspace=frontend
npm run build  # Build all packages

# Production commands
npm run start --workspace=auth-service
npm run preview --workspace=frontend

# Cleanup
npm run clean
```
