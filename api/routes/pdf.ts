import express, { Request, Response, Router } from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';

const router: Router = express.Router();

// Use memory storage for processing files directly
const upload = multer({ storage: multer.memoryStorage() });

router.post('/upload', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No PDF file uploaded' });
      return;
    }

    // Parse the PDF
    const pdfData = await pdfParse(req.file.buffer);
    const text = pdfData.text;

    // Process the text
    // The typical directory structure looks like:
    // Company Name, Category,
    // Address ................... (01234) 567890
    // Sometimes it's wrapped or squished.
    
    // Split text into an array of lines
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    const extractedData = [];
    
    // UK Phone number at the end of the line
    const phoneRegex = /(\(?0\d{3,4}\)?\s*\d{3,6})\s*$/;
    
    let currentCompany = '';
    let currentSubHeading = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(phoneRegex);
      
      if (!match) {
        // It's a text line (Company Name or Sub-heading)
        let isCompany = false;
        
        // In these directories, main companies usually end with a comma.
        if (line.trim().endsWith(',')) {
          isCompany = true;
        } else if (!currentCompany) {
          // If we haven't found any company yet, this must be it
          isCompany = true;
        }
        
        if (isCompany) {
          // Clean up trailing commas
          currentCompany = line.replace(/,\s*$/, '').trim();
          currentSubHeading = '';
        } else {
          // Treat as a location/sub-heading (e.g., "Goole", "Selby")
          currentSubHeading = line.trim();
        }
      } else {
        // It's a phone line
        const contactNumber = match[1].trim();
        let address = '';
        
        if (line.includes('..')) {
          address = line.split(/\.{2,}/)[0].trim();
        } else {
          address = line.replace(phoneRegex, '').trim();
        }
        
        // If the line was just a phone number, use the sub-heading as the address if available
        if (address === '' && currentSubHeading) {
          address = currentSubHeading;
        }
        
        if (currentCompany) {
          extractedData.push({
            companyName: currentCompany,
            address: address,
            contactNumber,
            email: ''
          });
        } else if (address) {
          // Fallback if somehow no company was found
          extractedData.push({
            companyName: address,
            address: '',
            contactNumber,
            email: ''
          });
        }
      }
    }

    res.status(200).json({
      success: true,
      data: extractedData
    });

  } catch (error: any) {
    console.error('PDF parsing error:', error);
    res.status(500).json({ success: false, error: 'Failed to parse PDF' });
  }
});

export default router;