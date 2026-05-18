// netlify/functions/ai.js  — Gemini 1.5 Flash 프록시
var GEMINI_MODEL = 'gemini-1.5-flash';
var rateMap = new Map();

function rateOk(ip) {
  var now = Date.now();
  var e = rateMap.get(ip) || { n: 0, t: now };
  if (now - e.t > 60000) { rateMap.set(ip, { n: 1, t: now }); return true; }
  if (e.n >= 30) return false;
  e.n++; rateMap.set(ip, e); return true;
}

async function gemini(key, sys, msg) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/'
    + GEMINI_MODEL + ':generateContent?key=' + key;
  var r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sys }] },
      contents: [{ role: 'user', parts: [{ text: msg }] }],
      generationConfig: { temperature: 0.75, maxOutputTokens: 1500 },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
      ]
    })
  });
  if (!r.ok) throw new Error('Gemini ' + r.status + ': ' + await r.text());
  var d = await r.json();
  var text = (d.candidates && d.candidates[0] && d.candidates[0].content
    && d.candidates[0].content.parts && d.candidates[0].content.parts[0])
    ? d.candidates[0].content.parts[0].text : '';
  return { content: [{ type: 'text', text: text }] };
}

var SYS = {
  plan: '당신은 학생의 학습 코치입니다. 한국어로 답하세요. 반드시 순수 JSON만 출력하세요 (마크다운 없이). 형식: {"schedule":[{"time":"14:00-14:30","subject":"수학","task":"개념 정리","emoji":"📐","priority":1}],"tips":"팁","message":"응원"}',
  chat: '당신은 학생의 친근한 학습 코치 곰돌이 AI입니다. 격려하는 말투로 한국어로 250자 이내로 답해요. 이모지를 적절히 사용해요.',
  journal: '당신은 따뜻한 학습 코치입니다. 학생의 성찰 일지에 응원하는 피드백을 2-3문장으로 한국어로 답해요. 이모지를 적절히 사용해요.',
  report: '당신은 따뜻한 학습 코치입니다. 학습 데이터를 분석해 3-4문장으로 한국어로 구체적인 조언을 해요. 이모지를 적절히 사용해요.'
};

exports.handler = async function (event) {
  var hdrs = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: hdrs, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: hdrs, body: '{}' };

  var ip = (event.headers && event.headers['x-forwarded-for']) || 'x';
  if (!rateOk(ip)) return { statusCode: 429, headers: hdrs, body: JSON.stringify({ error: '잠시 후 다시 시도해주세요.' }) };

  var key = process.env.GEMINI_API_KEY;
  if (!key) return { statusCode: 500, headers: hdrs, body: JSON.stringify({ error: 'GEMINI_API_KEY 환경변수가 없습니다.' }) };

  var body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: '잘못된 요청' }) }; }

  var type = body.type;
  var payload = body.payload || {};
  var sys = type === 'chat' ? (payload.system || SYS.chat) : SYS[type];
  if (!sys) return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: '알 수 없는 type: ' + type }) };

  var msg = '';
  if (payload.messages && Array.isArray(payload.messages)) {
    msg = payload.messages.map(function (m) { return m.content || ''; }).join('\n');
  } else {
    msg = payload.userMessage || '';
  }
  if (!msg) return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: '메시지 없음' }) };

  try {
    var result = await gemini(key, sys, msg);
    return { statusCode: 200, headers: hdrs, body: JSON.stringify(result) };
  } catch (err) {
    console.error('AI error:', err.message);
    return { statusCode: 500, headers: hdrs, body: JSON.stringify({ error: 'AI 오류: ' + err.message }) };
  }
};
