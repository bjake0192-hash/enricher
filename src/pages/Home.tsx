import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import { UploadCloud, Download, Loader2, AlertCircle, CheckCircle2, ArrowLeft, FileText, Search } from 'lucide-react';
import axios from 'axios';

interface LeadData {
  companyName: string;
  address?: string;
  contactNumber?: string;
  email?: string;
  fetched_address?: string;
  director1_name?: string;
  director1_mobile?: string;
  director2_name?: string;
  director2_mobile?: string;
  director3_name?: string;
  director3_mobile?: string;
  _status?: 'pending' | 'processing' | 'success' | 'failed';
  _error?: string;
}

const loadPdfJs = async () => {
  if (!(window as any).pdfjsLib) {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  return (window as any).pdfjsLib;
};

export default function Home() {
  const [step, setStep] = useState<'upload' | 'map' | 'dashboard'>('upload');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawData, setRawData] = useState<any[]>([]);
  const [mapping, setMapping] = useState({ companyName: '', address: '', contactNumber: '', email: '' });

  const [dataType, setDataType] = useState<'b2b' | 'residential'>('b2b');
  const [data, setData] = useState<LeadData[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPdfUploading, setIsPdfUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const residentialCsvInputRef = useRef<HTMLInputElement>(null);

  const [searchName, setSearchName] = useState('');
  const [searchCompany, setSearchCompany] = useState('');
  const [searchResult, setSearchResult] = useState<{mobile?: string, error?: string, loading: boolean, searched: boolean}>({ loading: false, searched: false });

  const handleSingleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchName || !searchCompany) return;
    
    setSearchResult({ loading: true, searched: true, error: undefined, mobile: undefined });
    try {
      const res = await axios.post('/api/search', { name: searchName, companyName: searchCompany });
      if (res.data.success) {
        setSearchResult({ mobile: res.data.data.mobile, loading: false, searched: true });
      } else {
        setSearchResult({ error: res.data.error, loading: false, searched: true });
      }
    } catch (err: any) {
      setSearchResult({ error: err.response?.data?.error || err.message, loading: false, searched: true });
    }
  };

  const handleResidentialCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as string[][];
        const formattedData: LeadData[] = [];

        let startIndex = 0;
        if (rows.length > 0 && rows[0][0] && rows[0][0].toLowerCase().includes('name')) {
          startIndex = 1;
        }

        for (let i = startIndex; i < rows.length; i++) {
          const row = rows[i];
          const col1 = row[0] || '';
          const col2 = row[1] || '';

          const parts = col1.split(',');
          let name = col1;
          let address = '';

          if (parts.length >= 3) {
            const lastName = parts[0].trim();
            const firstName = parts[1].trim();
            name = `${firstName} ${lastName}`;
            address = parts.slice(2).join(',').trim();
          } else if (parts.length === 2) {
            const lastName = parts[0].trim();
            const firstName = parts[1].trim();
            name = `${firstName} ${lastName}`;
          }

          formattedData.push({
            companyName: name, // Using companyName to store First & Last Name
            address: address,
            contactNumber: col2,
            _status: 'success' // Pre-mark as success so it skips enrichment
          });
        }

        setData(formattedData);
        setDataType('residential');
        setProgress(0);
        setStep('dashboard');
      }
    });
    
    if (residentialCsvInputRef.current) residentialCsvInputRef.current.value = '';
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (!results.meta.fields) return;
        const headers = results.meta.fields;
        setRawHeaders(headers);
        setRawData(results.data);

        // Improved auto-guessing for column mapping
        const guess = (keywords: string[]) => headers.find(h => keywords.some(k => h.toLowerCase().includes(k))) || '';
        
        setMapping({
          companyName: guess(['company', 'business', 'organization', 'account', 'name', 'firm']),
          address: guess(['address', 'location', 'city', 'street']),
          contactNumber: guess(['phone', 'number', 'mobile', 'contact']),
          email: guess(['email', 'e-mail'])
        });

        setStep('map');
      }
    });
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsPdfUploading(true);

    try {
      const pdfjsLib = await loadPdfJs();
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        for (const item of textContent.items) {
          fullText += item.str;
          if (item.hasEOL) {
            fullText += '\n';
          }
        }
      }

      // Process the extracted text using the exact same logic
      const lines = fullText.split('\n').map((line: string) => line.trim()).filter((line: string) => line.length > 0);
      const extractedData = [];
      const phoneRegex = /(\(?0\d{3,4}\)?\s*\d{3,6})\s*$/;
      
      let currentCompany = '';
      let currentSubHeading = '';
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(phoneRegex);
        
        if (!match) {
          let isCompany = false;
          if (line.trim().endsWith(',')) {
            isCompany = true;
          } else if (!currentCompany) {
            isCompany = true;
          }
          
          if (isCompany) {
            currentCompany = line.replace(/,\s*$/, '').trim();
            currentSubHeading = '';
          } else {
            currentSubHeading = line.trim();
          }
        } else {
          const contactNumber = match[1].trim();
          let address = '';
          
          if (line.includes('..')) {
            address = line.split(/\.{2,}/)[0].trim();
          } else {
            address = line.replace(phoneRegex, '').trim();
          }
          
          if (address === '' && currentSubHeading) {
            address = currentSubHeading;
          }
          
          if (currentCompany) {
            extractedData.push({
              companyName: currentCompany,
              address: address,
              contactNumber,
              email: '',
              _status: 'pending' as const
            });
          } else if (address) {
            extractedData.push({
              companyName: address,
              address: '',
              contactNumber,
              email: '',
              _status: 'pending' as const
            });
          }
        }
      }

      if (extractedData.length > 0) {
        setRawData(extractedData);
        setData(extractedData);
        setProgress(0);
        setStep('dashboard');
      } else {
        alert("Could not extract any directory listings from this PDF.");
      }
    } catch (err: any) {
      console.error(err);
      alert("Failed to parse PDF. " + err.message);
    } finally {
      setIsPdfUploading(false);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  };

  const confirmMapping = () => {
    if (!mapping.companyName) return;

    const mappedData: LeadData[] = rawData.map(row => ({
      ...row,
      companyName: row[mapping.companyName] || '',
      address: mapping.address ? row[mapping.address] : '',
      contactNumber: mapping.contactNumber ? row[mapping.contactNumber] : '',
      email: mapping.email ? row[mapping.email] : '',
      _status: 'pending'
    })).filter(d => d.companyName && String(d.companyName).trim() !== '');

    setData(mappedData);
    setProgress(0);
    setStep('dashboard');
  };

  const resetAll = () => {
    setStep('upload');
    setRawHeaders([]);
    setRawData([]);
    setData([]);
    setDataType('b2b');
    setProgress(0);
    setMapping({ companyName: '', address: '', contactNumber: '', email: '' });
  };

  const processLeads = async () => {
    if (data.length === 0) return;
    setIsProcessing(true);

    const updatedData = [...data];
    
    for (let i = 0; i < updatedData.length; i++) {
      if (updatedData[i]._status === 'success') continue;
      
      updatedData[i]._status = 'processing';
      setData([...updatedData]);

      try {
        const response = await axios.post('/api/enrich', {
          companyName: updatedData[i].companyName,
          address: updatedData[i].address,
          contactNumber: updatedData[i].contactNumber,
          email: updatedData[i].email
        });

        if (response.data.success && response.data.data) {
            const enrichData = response.data.data;
            updatedData[i].fetched_address = enrichData.fetchedAddress;
            updatedData[i].director1_name = enrichData.director1.name;
            updatedData[i].director1_mobile = enrichData.director1.mobile;
          updatedData[i].director2_name = enrichData.director2.name;
          updatedData[i].director2_mobile = enrichData.director2.mobile;
          updatedData[i].director3_name = enrichData.director3.name;
          updatedData[i].director3_mobile = enrichData.director3.mobile;
          updatedData[i]._status = 'success';
        } else {
          updatedData[i]._status = 'failed';
          updatedData[i]._error = response.data.message || 'Unknown error';
        }
      } catch (error: any) {
        updatedData[i]._status = 'failed';
        updatedData[i]._error = error.response?.data?.error || error.message;
      }
      
      setProgress(Math.round(((i + 1) / updatedData.length) * 100));
      setData([...updatedData]);
    }

    setIsProcessing(false);
  };

  const downloadCsv = () => {
    if (dataType === 'residential') {
      const headers = ['First & Last Name', 'Address', 'Contact Number'];
      const csvContent = [
        headers.join(','),
        ...data.map(row => [
          `"${(row.companyName || '').replace(/"/g, '""')}"`,
          `"${(row.address || '').replace(/"/g, '""')}"`,
          `"${(row.contactNumber || '').replace(/"/g, '""')}"`
        ].join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'formatted_residential_data.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    const headers = [
      'Company Name', 
      'Original Address',
      'Registered Address', 
      'Main Phone', 
      'Director 1', 
      'Mobile 1', 
      'Director 2', 
      'Mobile 2', 
      'Director 3', 
      'Mobile 3'
    ];
    
    const csvContent = [
      headers.join(','),
      ...data.map(row => [
        `"${(row.companyName || '').replace(/"/g, '""')}"`,
        `"${(row.address || '').replace(/"/g, '""')}"`,
        `"${(row.fetched_address || '').replace(/"/g, '""')}"`,
        `"${(row.contactNumber || '').replace(/"/g, '""')}"`,
        `"${(row.director1_name || '').replace(/"/g, '""')}"`,
        `"${(row.director1_mobile || '').replace(/"/g, '""')}"`,
        `"${(row.director2_name || '').replace(/"/g, '""')}"`,
        `"${(row.director2_mobile || '').replace(/"/g, '""')}"`,
        `"${(row.director3_name || '').replace(/"/g, '""')}"`,
        `"${(row.director3_mobile || '').replace(/"/g, '""')}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'enriched_leads.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const pendingCount = data.filter(d => d._status === 'pending').length;
  const successCount = data.filter(d => d._status === 'success').length;
  const failedCount = data.filter(d => d._status === 'failed').length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-6 md:p-12">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900">
              Openlead<span className="text-[#3cdbc0]">.</span>
            </h1>
            <p className="text-slate-500 mt-1">Upload your B2B leads to fetch directors and mobile numbers automatically.</p>
          </div>
        </header>

        {/* Quick Search */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-2 mb-4">
            <Search className="w-5 h-5 text-[#3cdbc0]" />
            <h2 className="text-lg font-bold text-slate-900">Quick Web Search</h2>
          </div>
          <form onSubmit={handleSingleSearch} className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 w-full">
              <label className="block text-sm font-medium text-slate-700 mb-1">Person Name</label>
              <input type="text" value={searchName} onChange={e => setSearchName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-[#3cdbc0] focus:border-[#3cdbc0] block p-2.5 outline-none" placeholder="e.g. John Doe" required />
            </div>
            <div className="flex-1 w-full">
              <label className="block text-sm font-medium text-slate-700 mb-1">Company Name</label>
              <input type="text" value={searchCompany} onChange={e => setSearchCompany(e.target.value)} className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-[#3cdbc0] focus:border-[#3cdbc0] block p-2.5 outline-none" placeholder="e.g. Acme Corp" required />
            </div>
            <button type="submit" disabled={searchResult.loading || !searchName || !searchCompany} className="bg-slate-900 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors h-[42px] flex items-center gap-2">
              {searchResult.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Search Web
            </button>
          </form>
          
          {searchResult.searched && !searchResult.loading && (
            <div className={`mt-4 p-4 rounded-lg flex items-start gap-3 ${searchResult.error || !searchResult.mobile ? 'bg-slate-50 text-slate-700 border border-slate-200' : 'bg-green-50 text-green-800 border border-green-200'}`}>
              {searchResult.error || !searchResult.mobile ? <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-slate-400" /> : <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-green-600" />}
              <div>
                <p className="font-medium text-slate-900">{searchResult.error ? 'Search Error' : (searchResult.mobile ? 'Number Found!' : 'No Number Found')}</p>
                <p className="text-sm mt-1">{searchResult.error || (searchResult.mobile ? `We found a contact number for ${searchName} at ${searchCompany}: ` : `Gemini couldn't find a publicly listed direct number for ${searchName} at ${searchCompany}.`)}
                  {searchResult.mobile && <span className="font-bold text-base ml-1">{searchResult.mobile}</span>}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Upload Zone */}
        {step === 'upload' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 rounded-xl p-12 flex flex-col items-center justify-center bg-white cursor-pointer hover:border-[#3cdbc0] hover:bg-[#3cdbc0]/5 transition-colors h-64"
            >
              <input 
                type="file" 
                accept=".csv" 
                className="hidden" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
              />
              <div className="bg-[#3cdbc0]/10 p-4 rounded-full mb-4">
                <UploadCloud className="w-8 h-8 text-[#3cdbc0]" />
              </div>
              <h3 className="text-lg font-semibold mb-1">Upload B2B CSV</h3>
              <p className="text-sm text-slate-500 text-center max-w-sm mt-2">
                We'll help you map your columns in the next step.
              </p>
            </div>

            <div 
              onClick={() => !isPdfUploading && pdfInputRef.current?.click()}
              className={`border-2 border-dashed border-slate-300 rounded-xl p-12 flex flex-col items-center justify-center bg-white transition-colors h-64 ${isPdfUploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-purple-500 hover:bg-purple-50'}`}
            >
              <input 
                type="file" 
                accept=".pdf" 
                className="hidden" 
                ref={pdfInputRef} 
                onChange={handlePdfUpload} 
              />
              <div className="bg-purple-100 p-4 rounded-full mb-4">
                {isPdfUploading ? <Loader2 className="w-8 h-8 text-purple-600 animate-spin" /> : <FileText className="w-8 h-8 text-purple-600" />}
              </div>
              <h3 className="text-lg font-semibold mb-1">Extract PDF Directory</h3>
              <p className="text-sm text-slate-500 text-center max-w-sm mt-2">
                {isPdfUploading ? 'Extracting listings...' : 'Upload a directory-style PDF to extract names and numbers.'}
              </p>
            </div>

            <div 
              onClick={() => residentialCsvInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 rounded-xl p-12 flex flex-col items-center justify-center bg-white cursor-pointer hover:border-orange-500 hover:bg-orange-50 transition-colors h-64"
            >
              <input 
                type="file" 
                accept=".csv" 
                className="hidden" 
                ref={residentialCsvInputRef} 
                onChange={handleResidentialCsvUpload} 
              />
              <div className="bg-orange-100 p-4 rounded-full mb-4">
                <UploadCloud className="w-8 h-8 text-orange-600" />
              </div>
              <h3 className="text-lg font-semibold mb-1 text-center">Format Residential CSV</h3>
              <p className="text-sm text-slate-500 text-center max-w-sm mt-2">
                Instantly formats "Lastname, First, Address" data.
              </p>
            </div>
          </div>
        )}

        {/* Mapping Step */}
        {step === 'map' && (
          <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 max-w-2xl mx-auto">
            <div className="flex items-center gap-3 mb-6 pb-6 border-b border-slate-100">
              <button onClick={resetAll} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Map Columns</h2>
                <p className="text-sm text-slate-500 mt-1">Match your CSV columns to the required fields</p>
              </div>
            </div>

            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <label className="text-sm font-medium text-slate-700 md:text-right">Company Name <span className="text-red-500">*</span></label>
                <div className="md:col-span-2">
                  <select 
                    value={mapping.companyName} 
                    onChange={e => setMapping({...mapping, companyName: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 outline-none"
                  >
                    <option value="">-- Select Column --</option>
                    {rawHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <label className="text-sm font-medium text-slate-700 md:text-right">Address</label>
                <div className="md:col-span-2">
                  <select 
                    value={mapping.address} 
                    onChange={e => setMapping({...mapping, address: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 outline-none"
                  >
                    <option value="">-- Ignore --</option>
                    {rawHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <label className="text-sm font-medium text-slate-700 md:text-right">Contact Number</label>
                <div className="md:col-span-2">
                  <select 
                    value={mapping.contactNumber} 
                    onChange={e => setMapping({...mapping, contactNumber: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 outline-none"
                  >
                    <option value="">-- Ignore --</option>
                    {rawHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <label className="text-sm font-medium text-slate-700 md:text-right">Email</label>
                <div className="md:col-span-2">
                  <select 
                    value={mapping.email} 
                    onChange={e => setMapping({...mapping, email: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 outline-none"
                  >
                    <option value="">-- Ignore --</option>
                    {rawHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>

              <div className="pt-6 mt-6 border-t border-slate-100 flex justify-end">
                <button 
                  onClick={confirmMapping}
                  disabled={!mapping.companyName}
                  className="bg-slate-900 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Confirm & Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Dashboard */}
        {step === 'dashboard' && data.length > 0 && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">Total Leads</p>
                  <p className="text-2xl font-bold">{data.length}</p>
                </div>
                <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                  <UploadCloud className="w-5 h-5 text-slate-600" />
                </div>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">Pending</p>
                  <p className="text-2xl font-bold">{pendingCount}</p>
                </div>
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-amber-600" />
                </div>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">Enriched</p>
                  <p className="text-2xl font-bold text-green-600">{successCount}</p>
                </div>
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                </div>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">Failed</p>
                  <p className="text-2xl font-bold text-red-600">{failedCount}</p>
                </div>
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-red-600" />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex gap-3">
                {dataType === 'b2b' && (
                  <button 
                    onClick={processLeads}
                    disabled={isProcessing || pendingCount === 0}
                    className="bg-slate-900 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                  >
                    {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {isProcessing ? `Processing (${progress}%)` : 'Start Enrichment'}
                  </button>
                )}
                <button 
                  onClick={resetAll}
                  disabled={isProcessing}
                  className="bg-white border border-slate-200 text-slate-700 px-5 py-2.5 rounded-lg font-medium hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  Start Over
                </button>
              </div>
              <button 
                onClick={downloadCsv}
                disabled={data.length === 0}
                className="bg-slate-900 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            </div>

            {isProcessing && (
              <div className="w-full bg-slate-200 rounded-full h-2.5">
                <div className="bg-[#3cdbc0] h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-600 uppercase text-xs border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 font-medium">Status</th>
                      <th className="px-6 py-4 font-medium min-w-[200px]">Company Name</th>
                      <th className="px-6 py-4 font-medium min-w-[200px]">Original Address</th>
                      <th className="px-6 py-4 font-medium min-w-[200px]">Registered Address</th>
                      <th className="px-6 py-4 font-medium min-w-[150px]">Main Phone</th>
                      <th className="px-6 py-4 font-medium min-w-[150px]">Director 1</th>
                      <th className="px-6 py-4 font-medium min-w-[150px]">Mobile 1</th>
                      <th className="px-6 py-4 font-medium min-w-[150px]">Director 2</th>
                      <th className="px-6 py-4 font-medium min-w-[150px]">Mobile 2</th>
                      <th className="px-6 py-4 font-medium min-w-[150px]">Director 3</th>
                      <th className="px-6 py-4 font-medium min-w-[150px]">Mobile 3</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.slice(0, 50).map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          {row._status === 'pending' && <span className="inline-flex items-center px-2 py-1 rounded-md bg-slate-100 text-slate-600 text-xs font-medium">Pending</span>}
                          {row._status === 'processing' && <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#3cdbc0]/10 text-slate-700 text-xs font-medium"><Loader2 className="w-3 h-3 animate-spin text-[#3cdbc0]" /> Processing</span>}
                          {row._status === 'success' && <span className="inline-flex items-center px-2 py-1 rounded-md bg-green-50 text-green-700 text-xs font-medium">Enriched</span>}
                          {row._status === 'failed' && (
                            <div className="group relative inline-flex items-center">
                              <span className="inline-flex items-center px-2 py-1 rounded-md bg-red-50 text-red-700 text-xs font-medium cursor-help">Failed</span>
                              <div className="hidden group-hover:block absolute left-full ml-2 w-48 p-2 bg-slate-800 text-white text-xs rounded shadow-lg z-10">
                                {row._error}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 font-medium text-slate-900">{row.companyName}</td>
                        <td className="px-6 py-4 text-slate-600 truncate max-w-xs" title={row.address}>{row.address || '-'}</td>
                        <td className="px-6 py-4 text-slate-600 truncate max-w-xs" title={row.fetched_address}>{row.fetched_address || '-'}</td>
                        <td className="px-6 py-4 text-slate-600">{row.contactNumber || '-'}</td>
                        <td className="px-6 py-4 text-slate-600">{row.director1_name || '-'}</td>
                        <td className="px-6 py-4 text-slate-600">{row.director1_mobile || '-'}</td>
                        <td className="px-6 py-4 text-slate-600">{row.director2_name || '-'}</td>
                        <td className="px-6 py-4 text-slate-600">{row.director2_mobile || '-'}</td>
                        <td className="px-6 py-4 text-slate-600">{row.director3_name || '-'}</td>
                        <td className="px-6 py-4 text-slate-600">{row.director3_mobile || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.length > 50 && (
                <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 text-center text-sm text-slate-500">
                  Showing first 50 rows. The full list will be available upon export.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}