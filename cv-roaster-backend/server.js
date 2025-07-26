// backend/server.js - Node.js Express Server with Claude AI Integration

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'https://cv-roaster-rust.vercel.app',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // limit each IP to 10 requests per windowMs
    message: {
        error: 'Too many requests, please try again later.',
        retryAfter: '15 minutes'
    }
});
app.use('/api/roast', limiter);

// File upload configuration
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PDF, DOCX, and TXT files are allowed.'));
        }
    }
});

// Text extraction functions
async function extractTextFromPDF(buffer) {
    try {
        const data = await pdfParse(buffer);
        return data.text;
    } catch (error) {
        throw new Error('Failed to extract text from PDF');
    }
}

async function extractTextFromDocx(buffer) {
    try {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
    } catch (error) {
        throw new Error('Failed to extract text from DOCX');
    }
}

async function extractTextFromTxt(buffer) {
    return buffer.toString('utf8');
}

// Claude AI Integration
async function callClaudeAPI(content, type = 'cv') {
    const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY;
    
    if (!CLAUDE_API_KEY) {
        throw new Error('Claude API key not configured');
    }

    let prompt;
    
    if (type === 'cv') {
        prompt = `You are a brutally honest but constructive career coach and CV expert. Your job is to roast this CV/resume with humor while providing actionable, specific feedback.

ROASTING GUIDELINES:
- Be funny but not mean-spirited
- Point out specific problems with examples
- Give actionable advice for improvement
- Focus on common mistakes: buzzwords, vague descriptions, poor formatting, missing achievements
- Use a conversational, slightly sarcastic tone
- Include specific suggestions with examples
- Be encouraging despite the "roasting" - the goal is to help them improve

CV CONTENT TO ROAST:
${content}

Provide your roast in a conversational tone, using emojis where appropriate, and structure it with clear sections for different problems you find. End with actionable improvement suggestions.`;
    } else {
        prompt = `You are a brutally honest but constructive LinkedIn profile expert. Your job is to roast this LinkedIn profile URL/content with humor while providing actionable feedback.

ROASTING GUIDELINES FOR LINKEDIN:
- Call out generic headlines and buzzword-heavy summaries
- Point out clichéd posts and engagement patterns
- Critique vague experience descriptions
- Mock overused phrases like "thought leader," "passionate professional," etc.
- Be funny about networking and connection habits
- Give specific advice for profile improvement
- Use a conversational, slightly sarcastic tone
- Include examples of better alternatives

LINKEDIN PROFILE TO ROAST:
${content}

Provide your roast focusing on common LinkedIn mistakes, profile optimization, and networking behavior.`;
    }

    try {
        const response = await axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-3-sonnet-20240229',
            max_tokens: 1500,
            messages: [{
                role: 'user',
                content: prompt
            }]
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            timeout: 30000 // 30 second timeout
        });

        return response.data.content[0].text;
    } catch (error) {
        console.error('Claude API Error:', error.response?.data || error.message);
        
        if (error.response?.status === 401) {
            throw new Error('Invalid API key');
        } else if (error.response?.status === 429) {
            throw new Error('Rate limit exceeded. Please try again later.');
        } else if (error.response?.status === 400) {
            throw new Error('Invalid request format');
        } else {
            throw new Error('Failed to get AI feedback. Please try again.');
        }
    }
}

// LinkedIn profile scraping (basic implementation)
async function scrapeLinkedInProfile(url) {
    // Note: LinkedIn blocks most scraping attempts
    // In production, you'd need:
    // 1. LinkedIn API access (expensive)
    // 2. User to copy-paste their profile content
    // 3. Browser extension to extract content
    
    // For now, return instruction for user
    return `Please copy and paste your LinkedIn profile content including:
- Your headline
- About section
- Experience descriptions
- Skills section
- Recent posts

This will allow me to give you better feedback since LinkedIn blocks automated access.`;
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// CV/Resume roasting endpoint
app.post('/api/roast/cv', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        let extractedText;
        const fileType = req.file.mimetype;

        // Extract text based on file type
        switch (fileType) {
            case 'application/pdf':
                extractedText = await extractTextFromPDF(req.file.buffer);
                break;
            case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                extractedText = await extractTextFromDocx(req.file.buffer);
                break;
            case 'text/plain':
                extractedText = await extractTextFromTxt(req.file.buffer);
                break;
            default:
                return res.status(400).json({ error: 'Unsupported file type' });
        }

        // Validate extracted text
        if (!extractedText || extractedText.trim().length < 50) {
            return res.status(400).json({ 
                error: 'Could not extract meaningful content from file. Please ensure your CV contains readable text.' 
            });
        }

        // Truncate if too long (Claude has token limits)
        if (extractedText.length > 10000) {
            extractedText = extractedText.substring(0, 10000) + '\n\n[Content truncated...]';
        }

        // Get AI feedback
        const roast = await callClaudeAPI(extractedText, 'cv');

        res.json({
            success: true,
            roast: roast,
            wordCount: extractedText.split(' ').length,
            extractedLength: extractedText.length
        });

    } catch (error) {
        console.error('CV Roast Error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to process CV',
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// LinkedIn profile roasting endpoint
app.post('/api/roast/linkedin', async (req, res) => {
    try {
        const { url, content } = req.body;

        if (!url && !content) {
            return res.status(400).json({ 
                error: 'Please provide either a LinkedIn URL or profile content' 
            });
        }

        let profileContent;

        if (content) {
            // User provided profile content directly
            profileContent = content;
        } else if (url) {
            // Validate LinkedIn URL
            if (!url.includes('linkedin.com/in/')) {
                return res.status(400).json({ 
                    error: 'Please provide a valid LinkedIn profile URL (linkedin.com/in/username)' 
                });
            }

            // For now, ask user to provide content manually
            profileContent = await scrapeLinkedInProfile(url);
        }

        // Get AI feedback
        const roast = await callClaudeAPI(profileContent, 'linkedin');

        res.json({
            success: true,
            roast: roast,
            profileUrl: url
        });

    } catch (error) {
        console.error('LinkedIn Roast Error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to process LinkedIn profile',
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
        }
    }
    
    console.error('Unhandled Error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
    console.log(`🔥 CV Roaster API running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Claude API Key configured: ${!!process.env.ANTHROPIC_API_KEY}`);
});

module.exports = app;