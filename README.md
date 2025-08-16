# WhatsApp Dashboard Server

This is the backend server for the WhatsApp Dashboard application with PostgreSQL database support.

## Features

- **Contact Management**: Full CRUD operations for contacts
- **WhatsApp Integration**: Interakt API integration for WhatsApp Business
- **Template Management**: Create and manage message templates
- **Database**: PostgreSQL with automatic migrations
- **API Documentation**: Swagger/OpenAPI documentation

## New Features Added

### 🧪 Test Message Endpoint
- `POST /api/interakt/test-message` - Send test template messages (matches Facebook Graph API format)
- Perfect for testing with your number (7447340010) and verifying API functionality

### 🔗 Webhook Support
- `GET /api/interakt/webhook` - Facebook webhook verification (hub.challenge)
- `POST /api/interakt/webhook` - Receive message status updates and incoming messages

## Environment Variables

```bash
# Required for real WhatsApp sending
INTERAKT_BASE_URL=https://amped-express.interakt.ai/api/v17.0
INTERAKT_WABA_ID=your_waba_id
INTERAKT_ACCESS_TOKEN=your_access_token
INTERAKT_PHONE_NUMBER_ID=your_phone_number_id

# Webhook verification
WEBHOOK_VERIFY_TOKEN=your_webhook_token

# Fallback behavior
USE_FALLBACK_WHEN_ERROR=true
```

## Quick Test

1. **Test Template Message**:
   ```bash
   curl -X POST http://localhost:4000/api/interakt/test-message \
     -H "Content-Type: application/json" \
     -d '{
       "to": "7447340010",
       "template_name": "hello_world",
       "language_code": "en_US"
     }'
   ```

2. **Webhook Verification**:
   ```bash
   curl "http://localhost:4000/api/interakt/webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=CHALLENGE_STRING"
   ```

## Database Setup

### Prerequisites

1. PostgreSQL installed and running
2. Node.js and npm

### Database Configuration

The application uses the following connection string:
```
postgresql://postgres:newpassword@localhost:5432/whatsapp_dashbaord
```

### Setup Steps

1. **Create Database**:
   ```sql
   CREATE DATABASE whatsapp_dashbaord;
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Run Migrations**:
   ```bash
   npm run migrate
   ```

4. **Seed Database (Optional)**:
   ```bash
   npm run seed
   ```

5. **Start Development Server**:
   ```bash
   npm run dev
   ```

## API Endpoints

### Contacts API

- `GET /api/contacts` - Get all contacts (with optional search and pagination)
- `GET /api/contacts/:id` - Get contact by ID
- `POST /api/contacts` - Create new contact
- `PUT /api/contacts/:id` - Update contact
- `DELETE /api/contacts/:id` - Delete contact

### Interakt API

- `GET /api/interakt/phone-numbers` - Get WhatsApp phone numbers
- `GET /api/interakt/templates` - Get message templates
- `POST /api/interakt/templates` - Create new template
- `POST /api/interakt/messages` - Send template message
- `POST /api/interakt/test-message` - **NEW**: Test template message (Facebook Graph API format)
- `GET /api/interakt/webhook` - **NEW**: Webhook verification
- `POST /api/interakt/webhook` - **NEW**: Receive webhook updates

### Campaigns API

- `POST /api/campaigns` - Create campaign
- `POST /api/campaigns/send-template` - Send template to multiple contacts

## Contact Schema

```sql
CREATE TABLE contacts (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255),
  whatsapp_number VARCHAR(20) UNIQUE NOT NULL,
  phone VARCHAR(20),
  telegram_id VARCHAR(100),
  viber_id VARCHAR(100),
  line_id VARCHAR(100),
  instagram_id VARCHAR(100),
  facebook_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## API Documentation

Visit `http://localhost:3000/docs` for interactive API documentation.

## Environment Variables

Create a `.env` file in the server directory:

```env
NODE_ENV=development
PORT=3000
INTERAKT_API_KEY=your_interakt_api_key
INTERAKT_BASE_URL=https://api.interakt.ai
```

## Development

- **Development**: `npm run dev`
- **Build**: `npm run build`
- **Start Production**: `npm start`
- **Run Migrations**: `npm run migrate`
- **Seed Database**: `npm run seed`

## Docker Setup

### Prerequisites
- Docker and Docker Compose installed

### Quick Start with Docker

1. **Clone and Navigate**:
   ```bash
   cd shopzo-whatsapp-backend
   ```

2. **Setup Environment**:
   ```bash
   cp .env.example .env
   # Edit .env file with your actual values
   ```

3. **Build and Run**:
   ```bash
   # Build and start the container
   docker-compose up --build

   # Or run in background
   docker-compose up -d --build
   ```

4. **Access Application**:
   - API: http://localhost:8080
   - Health Check: http://localhost:8080/health
   - API Docs: http://localhost:8080/docs

### Docker Commands

```bash
# Build the image
docker build -t shopzo-whatsapp-backend .

# Run container directly
docker run -p 8080:8080 --env-file .env shopzo-whatsapp-backend

# Using docker-compose
docker-compose up -d        # Start in background
docker-compose down         # Stop containers
docker-compose logs -f      # View logs
docker-compose restart      # Restart services
```

### Environment Setup

The Docker setup requires a `.env` file. Copy `.env.example` to `.env` and fill in your actual values:

```bash
cp .env.example .env
```

Required variables include:
- `INTERAKT_WABA_ID` - Your WhatsApp Business Account ID
- `INTERAKT_ACCESS_TOKEN` - Your access token
- `INTERAKT_PHONE_NUMBER_ID` - Your phone number ID
- Database connection details (if using external DB)

### Docker Features

- **Multi-stage build**: Optimized production image
- **Health checks**: Automatic container health monitoring
- **Non-root user**: Runs with limited privileges for security
- **Hot reload**: Development setup with volume mounting
- **Environment variables**: Easy configuration management

### Production Deployment

For production, ensure you:
1. Set `NODE_ENV=production` in your `.env`
2. Use proper secrets management
3. Configure external database connection
4. Set up proper logging and monitoring

## Sample Data

The seed script will automatically insert sample contacts:
- John Doe (john.doe@example.com)
- Jane Smith (jane.smith@example.com)
- Bob Johnson (bob.johnson@example.com)

## Troubleshooting

### Database Connection Issues

1. Ensure PostgreSQL is running
2. Verify the database exists: `whatsapp_dashbaord`
3. Check credentials: `postgres:newpassword`
4. Verify port: `5432`

### Common Errors

- **Connection refused**: PostgreSQL not running
- **Database does not exist**: Run `CREATE DATABASE whatsapp_dashbaord;`
- **Authentication failed**: Check username/password in connection string
