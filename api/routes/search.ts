import express, { Request, Response, Router } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import google from 'googlethis';

const router: Router = express.Router();

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, companyName } = req.body;

    if (!name || !companyName) {
      res.status(400).json({ success: false, error: 'Name and Company Name are required' });
      return;
    }

    const googleApiKey = process.env.GOOGLE_API_KEY;

    if (!googleApiKey) {
      res.status(500).json({ success: false, error: 'Google AI Studio API key is not configured' });
      return;
    }

    const genAI = new GoogleGenerativeAI(googleApiKey);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash"
    });

    // 1. Perform a targeted web search using Google (Free via googlethis)
    const searchQuery = `"${name}" "${companyName}" (mobile OR phone OR "call me" OR contact) site:linkedin.com OR site:twitter.com OR site:zoominfo.com`;
    const searchResults = await google.search(searchQuery, {
      page: 0, 
      safe: false,
      additional_params: { hl: 'en' }
    });
    
    // 2. Extract snippets to feed to the AI
    const snippets = searchResults.results
      .map((r: any) => `Title: ${r.title}\nSnippet: ${r.description}\nURL: ${r.url}`)
      .join('\n\n');

    // 3. Use Gemini to analyze the context and find high-confidence matches
    const prompt = `You are a highly precise data researcher. You need to find the direct mobile number for ${name} at ${companyName}.
I have performed a web search. Read the following search result snippets.
Look for high-context evidence that a number belongs specifically to them (e.g., a LinkedIn post where they say 'call me on...', or a profile snippet with their direct number).
DO NOT return general company switchboard numbers.
If you find a high-confidence direct number, return ONLY the phone number. Do not include any other text.
If you do not find a high-confidence direct number in these snippets, return exactly the string "NOT_FOUND".

Search Snippets:
${snippets}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();
    
    let mobile = '';
    if (responseText && responseText !== 'NOT_FOUND' && !responseText.toLowerCase().includes('not found')) {
      mobile = responseText;
    }

    res.status(200).json({
      success: true,
      data: { mobile }
    });

  } catch (error: any) {
    console.error('Single search error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to search for person' });
  }
});

export default router;