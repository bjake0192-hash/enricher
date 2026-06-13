import express, { Request, Response, Router } from 'express';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import google from 'googlethis';

const router: Router = express.Router();

interface EnrichRequest {
  companyName: string;
  address?: string;
  contactNumber?: string;
  email?: string;
}

const COMPANIES_HOUSE_API_URL = 'https://api.company-information.service.gov.uk';

// Parse name like "SMITH, John Doe" into first/last
function parseOfficerName(fullName: string) {
  const parts = fullName.split(',');
  if (parts.length > 1) {
    const lastName = parts[0].trim();
    const firstNames = parts[1].trim();
    return { firstName: firstNames.split(' ')[0], lastName }; // Take only the very first name to improve matching
  }
  const spaceParts = fullName.split(' ');
  return {
    firstName: spaceParts[0],
    lastName: spaceParts.slice(1).join(' '),
  };
}

router.post('/', async (req: Request<{}, {}, EnrichRequest>, res: Response): Promise<void> => {
  try {
    const { companyName, email } = req.body;
    
    if (!companyName) {
      res.status(400).json({ success: false, error: 'companyName is required' });
      return;
    }

    const chApiKey = process.env.COMPANIES_HOUSE_API_KEY;
    const googleApiKey = process.env.GOOGLE_API_KEY;

    if (!chApiKey) {
      res.status(500).json({ success: false, error: 'Companies House API key is not configured on the server' });
      return;
    }

    if (!googleApiKey) {
      res.status(500).json({ success: false, error: 'Google AI Studio API key is not configured on the server' });
      return;
    }

    const genAI = new GoogleGenerativeAI(googleApiKey);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash"
    });

    const chAuthHeader = `Basic ${Buffer.from(chApiKey + ':').toString('base64')}`;

    // 1. Search for company
    const searchRes = await axios.get(`${COMPANIES_HOUSE_API_URL}/search/companies`, {
      params: { q: companyName, items_per_page: 1 },
      headers: { Authorization: chAuthHeader }
    });

    const items = searchRes.data.items;
    if (!items || items.length === 0) {
      res.status(200).json({
        success: true,
        data: {
          director1: { name: '', mobile: '' },
          director2: { name: '', mobile: '' },
          director3: { name: '', mobile: '' },
        },
        message: 'Company not found in Companies House'
      });
      return;
    }

    const companyNumber = items[0].company_number;
    const matchedCompanyName = items[0].title;
    const companyAddress = items[0].address_snippet || '';

    // 2. Get officers
    const officersRes = await axios.get(`${COMPANIES_HOUSE_API_URL}/company/${companyNumber}/officers`, {
      headers: { Authorization: chAuthHeader }
    });

    const activeDirectors = (officersRes.data.items || [])
      .filter((officer: any) => officer.officer_role === 'director' && !officer.resigned_on)
      .slice(0, 3);

    const enrichedDirectors: { name: string; mobile: string }[] = [];

    // Extract domain from email if available to improve Apollo match
    let companyDomain = '';
    if (email) {
      const domainMatch = email.match(/@(.+)$/);
      if (domainMatch) {
        companyDomain = domainMatch[1];
      }
    }

    // 3. Get mobile numbers via DDG Search + Gemini Context Analyzer
    for (const director of activeDirectors) {
      const { firstName, lastName } = parseOfficerName(director.name);
      const formattedName = `${firstName} ${lastName}`;
      let mobile = '';

      try {
        const searchQuery = `"${formattedName}" "${companyName}" (mobile OR phone OR "call me" OR contact) site:linkedin.com OR site:twitter.com OR site:zoominfo.com`;
        const searchResults = await google.search(searchQuery, {
          page: 0,
          safe: false,
          additional_params: { hl: 'en' }
        });
        
        const snippets = searchResults.results
          .map((r: any) => `Title: ${r.title}\nSnippet: ${r.description}\nURL: ${r.url}`)
          .join('\n\n');

        const prompt = `You are a highly precise data researcher. You need to find the direct mobile number for ${formattedName} who is a director at the UK company ${companyName}.
I have performed a web search. Read the following search result snippets.
Look for high-context evidence that a number belongs specifically to them (e.g., a LinkedIn post where they say 'call me on...', or a profile snippet with their direct number).
DO NOT return general company switchboard numbers.
If you find a high-confidence direct number, return ONLY the phone number. Do not include any other text.
If you do not find a high-confidence direct number in these snippets, return exactly the string "NOT_FOUND".

Search Snippets:
${snippets}`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text().trim();
        
        if (responseText && responseText !== 'NOT_FOUND' && !responseText.toLowerCase().includes('not found')) {
          mobile = responseText;
        }
      } catch (err: any) {
        console.error(`Gemini error for ${formattedName}:`, err.message);
      }
      
      enrichedDirectors.push({
        name: formattedName,
        mobile: mobile
      });
    }

    // Pad to 3 directors
    while (enrichedDirectors.length < 3) {
      enrichedDirectors.push({ name: '', mobile: '' });
    }

    res.status(200).json({
      success: true,
      data: {
        director1: enrichedDirectors[0],
        director2: enrichedDirectors[1],
        director3: enrichedDirectors[2],
        fetchedAddress: companyAddress,
      }
    });

  } catch (error: any) {
    console.error('Enrichment error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: 'Failed to enrich lead' });
  }
});

export default router;