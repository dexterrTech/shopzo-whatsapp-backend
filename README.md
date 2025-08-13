# WhatsApp Dashboard Server

This is the backend server for the WhatsApp Dashboard application with PostgreSQL database support.

## Features

- **Contact Management**: Full CRUD operations for contacts
- **WhatsApp Integration**: Interakt API integration for WhatsApp Business
- **Template Management**: Create and manage message templates
- **Database**: PostgreSQL with automatic migrations
- **API Documentation**: Swagger/OpenAPI documentation

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
