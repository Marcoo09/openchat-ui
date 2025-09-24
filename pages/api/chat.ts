import { DEFAULT_SYSTEM_PROMPT, DEFAULT_TEMPERATURE } from '@/utils/app/const';
import { ChatBody, Message } from '@/types/chat';
import llamaTokenizer from 'llama-tokenizer-js';

export const config = {
  runtime: 'edge',
};

const handler = async (req: Request): Promise<Response> => {
  try {
    console.log('here', req)
    const { model, messages, prompt, temperature } = (await req.json()) as ChatBody;

    let promptToSend = prompt || DEFAULT_SYSTEM_PROMPT;
    let temperatureToUse = temperature ?? DEFAULT_TEMPERATURE;

    const prompt_tokens = llamaTokenizer.encode(promptToSend, false);

    let tokenCount = prompt_tokens.length;
    let messagesToSend: Message[] = [];

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const tokens = llamaTokenizer.encode(message.content, false);

      if (tokenCount + tokens.length + 768 > model.tokenLimit) {
        break;
      }
      tokenCount += tokens.length;
      messagesToSend = [message, ...messagesToSend];
    }

    // Call your local FastAPI backend instead of OpenAI
    const response = await fetch('http://localhost:8000/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: messagesToSend,
        prompt: promptToSend,
        temperature: temperatureToUse,
      }),
    });

    if (!response.ok) {
      throw new Error(`Local API returned ${response.status}`);
    }

    // Pass through the stream directly
    return new Response(response.body, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  } catch (error) {
    console.error(error);
    return new Response('Error 1', { status: 500 });
  }
};

export default handler;
