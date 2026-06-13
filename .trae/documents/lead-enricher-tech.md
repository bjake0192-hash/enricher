## 1. Architecture Design
```mermaid
graph TD
    A["Frontend (React + Vite)"] -->|CSV Upload & State| A
    A -->|API Requests| B["Backend Proxy (Express/Node.js)"]
    B -->|Company Name/Number| C["Companies House API"]
    B -->|Director Name + Company| D["Apollo.io API"]
    C -->|Officers Data| B
    D -->|Contact Data (Mobile)| B
    B -->|Enriched Row| A
```
*Note: A backend proxy is required to securely store API keys (Companies House, Apollo) and to bypass browser CORS restrictions when calling these third-party APIs.*

## 2. Technology Description
- **Frontend**: React@18 + tailwindcss@3 + vite + lucide-react (icons) + papaparse (CSV handling)
- **Backend**: Node.js + Express (Lightweight API proxy) + dotenv (Environment variables) + axios
- **Initialization Tool**: vite-init for frontend, standard npm init for backend.

## 3. Route Definitions
### Frontend Routes
| Route | Purpose |
|-------|---------|
| `/` | Main application interface (Single Page Application handling upload, preview, and download) |

### Backend API Routes
| Route | Purpose |
|-------|---------|
| `POST /api/enrich` | Accepts a single lead's data, orchestrates calls to Companies House and Apollo, and returns the enriched data. |

## 4. API Definitions

### `POST /api/enrich`
**Request:**
```typescript
interface EnrichRequest {
  companyName: string;
  address?: string;
  contactNumber?: string;
  email?: string;
}
```

**Response:**
```typescript
interface EnrichResponse {
  success: boolean;
  data?: {
    director1: { name: string; mobile: string | null };
    director2: { name: string; mobile: string | null };
    director3: { name: string; mobile: string | null };
  };
  error?: string;
}
```

## 5. Third-Party Integrations
1. **Companies House API**:
   - Endpoint: `GET /search/companies` (to find company number)
   - Endpoint: `GET /company/{company_number}/officers` (to find active directors)
   - Auth: Basic Auth using API Key.
2. **Apollo.io API** (Recommended):
   - Endpoint: `POST /v1/people/match` (Match by name and organization name)
   - Auth: API Key in header.

## 6. Project Structure
```text
/
├── frontend/          # React + Vite application
│   ├── src/
│   │   ├── components/
│   │   ├── utils/     # CSV parsing logic
│   │   └── App.tsx
├── backend/           # Node.js + Express server
│   ├── server.js      # API routes and external API logic
│   └── .env           # API Keys (Companies House, Apollo)
└── package.json       # Root package.json for concurrent running
```