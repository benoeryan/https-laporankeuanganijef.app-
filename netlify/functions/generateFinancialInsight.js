import { GoogleGenAI } from '@google/genai';

export default async (req) => {
  // CORS headers
  const allowedOrigin = process.env.URL || '*';
  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers });
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers
    });
  }

  // Parse request body
  let body;
  try {
    const rawBody = await req.text();
    const MAX_BODY_SIZE = 50000; // 50KB limit
    if (rawBody.length > MAX_BODY_SIZE) {
      return new Response(JSON.stringify({ error: 'Request body too large' }), {
        status: 413,
        headers
      });
    }
    body = JSON.parse(rawBody);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers
    });
  }

  const { totalPendapatan, totalPengeluaran, saldoKasBank } = body || {};

  if (totalPendapatan === undefined || totalPengeluaran === undefined || saldoKasBank === undefined) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: totalPendapatan, totalPengeluaran, saldoKasBank' }),
      { status: 400, headers }
    );
  }

  // Build prompt
  const prompt = 'Bertindaklah sebagai CFO/Konsultan Keuangan Profesional untuk LPK IJEF Corp. '
    + 'Analisis data keuangan berikut dan berikan:\n'
    + '1. Satu kalimat analisis kondisi keuangan saat ini\n'
    + '2. Satu kalimat saran pemasaran/efisiensi yang konkret\n\n'
    + 'Data Keuangan:\n'
    + '- Total Pendapatan: Rp ' + Number(totalPendapatan).toLocaleString('id-ID') + '\n'
    + '- Total Pengeluaran: Rp ' + Number(totalPengeluaran).toLocaleString('id-ID') + '\n'
    + '- Saldo Kas/Bank saat ini: Rp ' + Number(saldoKasBank).toLocaleString('id-ID') + '\n\n'
    + 'Format jawaban HARUS dalam JSON seperti berikut (tanpa markdown code block):\n'
    + '{"ringkasan_analisis": "...", "rekomendasi_strategi": "..."}\n'
    + 'Jawab dalam Bahasa Indonesia, singkat, profesional, dan langsung ke poin.';

  let text = '';
  let lastError = '';

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const netlifyGatewayKey = process.env.NETLIFY_AI_GATEWAY_KEY;

  if (openRouterKey) {
    // OpenRouter provider option
    const openRouterModels = [
      'google/gemini-2.5-flash-lite',
      'google/gemini-2.5-flash',
      'meta-llama/llama-3.3-70b-instruct:free'
    ];

    for (const model of openRouterModels) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + openRouterKey,
            'HTTP-Referer': 'https://laporankeuanganijef.netlify.app',
            'X-Title': 'Sistem Keuangan IJEF'
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: prompt }]
          })
        });

        if (response.ok) {
          const data = await response.json();
          text = data.choices
            && data.choices[0]
            && data.choices[0].message
            && data.choices[0].message.content
            ? data.choices[0].message.content
            : '';

          if (text) break;
          lastError = 'Empty response from OpenRouter model ' + model;
          continue;
        }

        const errBody = await response.json().catch(function() { return {}; });
        lastError = errBody.error
          ? (errBody.error.message || JSON.stringify(errBody.error))
          : ('HTTP ' + response.status);

        if (response.status === 400 || response.status === 404 || response.status === 403 || response.status === 429) {
          continue;
        }
        break;
      } catch (fetchErr) {
        lastError = fetchErr.message;
        continue;
      }
    }
  } else if (geminiKey || netlifyGatewayKey) {
    // Netlify AI Gateway or Google GenAI SDK (Zero-config auto detects GEMINI_API_KEY & GOOGLE_GEMINI_BASE_URL)
    const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview'];

    for (const model of models) {
      try {
        const ai = new GoogleGenAI({});
        const response = await ai.models.generateContent({
          model: model,
          contents: prompt
        });

        if (response && response.text) {
          text = response.text;
          break;
        }
      } catch (genAiErr) {
        lastError = genAiErr.message || String(genAiErr);
        // Fallback to direct REST call if SDK fails
        try {
          const baseUrl = process.env.GOOGLE_GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
          const apiKey = geminiKey || netlifyGatewayKey;
          const directRes = await fetch(`${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] })
          });
          if (directRes.ok) {
            const directData = await directRes.json();
            text = directData.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (text) break;
          }
        } catch (fetchFallbackErr) {
          lastError = fetchFallbackErr.message;
        }
      }
    }
  } else {
    return new Response(
      JSON.stringify({ error: 'No API key configured. Netlify AI Gateway, OPENROUTER_API_KEY, or GEMINI_API_KEY is required.' }),
      { status: 500, headers }
    );
  }

  if (!text) {
    return new Response(JSON.stringify({ error: 'AI API error: ' + lastError }), {
      status: 502,
      headers
    });
  }

  // Parse AI response - try to extract JSON
  let ringkasan_analisis = '';
  let rekomendasi_strategi = '';

  try {
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const parsed = JSON.parse(cleaned);
    ringkasan_analisis = parsed.ringkasan_analisis || '';
    rekomendasi_strategi = parsed.rekomendasi_strategi || '';
  } catch (parseErr) {
    const sentences = text.split(/[.\n]/).filter(function(s) { return s.trim().length > 10; });
    ringkasan_analisis = sentences[0] ? sentences[0].trim() : text.trim();
    rekomendasi_strategi = sentences[1] ? sentences[1].trim() : 'Lakukan evaluasi berkala terhadap arus kas.';
  }

  const tanggal = new Date().toISOString();

  return new Response(
    JSON.stringify({
      ringkasan_analisis: ringkasan_analisis,
      rekomendasi_strategi: rekomendasi_strategi,
      tanggal: tanggal
    }),
    { status: 200, headers }
  );
};
