import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const MODELSCOPE_API_KEY = 'ms-6ef1ba63-475a-4b2a-be42-60c76716f89a';
const MODELSCOPE_BASE_URL = 'https://api-inference.modelscope.cn/v1/';
const MODEL_ID = 'Qwen/Qwen3-8B';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { messages } = await req.json()

    const response = await fetch(`${MODELSCOPE_BASE_URL}chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MODELSCOPE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_ID,
        messages: messages,
        temperature: 0.7,
        max_tokens: 500,
        enable_thinking: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ModelScope API error:', errorText);
      return new Response(
        JSON.stringify({ error: `API request failed: ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || 'I\'m here for you.';

    return new Response(
      JSON.stringify({ content }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
