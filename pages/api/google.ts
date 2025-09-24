import { NextApiRequest, NextApiResponse } from 'next';
import { cleanSourceText } from '@/utils/server/google';

import { Message } from '@/types/chat';
import { GoogleBody, GoogleSource } from '@/types/google';

import { Readability } from '@mozilla/readability';
import endent from 'endent';
import jsdom, { JSDOM } from 'jsdom';

const handler = async (req: NextApiRequest, res: NextApiResponse<any>) => {
  try {
    const { messages, model, googleAPIKey, googleCSEId } =
      req.body as GoogleBody;

    const userMessage = messages[messages.length - 1];
    const query = encodeURIComponent(userMessage.content.trim());

    const googleRes = await fetch(
      `https://customsearch.googleapis.com/customsearch/v1?key=${
        googleAPIKey ? googleAPIKey : process.env.GOOGLE_API_KEY
      }&cx=${
        googleCSEId ? googleCSEId : process.env.GOOGLE_CSE_ID
      }&q=${query}&num=5`,
    );

    const googleData = await googleRes.json();

    const sources: GoogleSource[] = googleData.items.map((item: any) => ({
      title: item.title,
      link: item.link,
      displayLink: item.displayLink,
      snippet: item.snippet,
      image: item.pagemap?.cse_image?.[0]?.src,
      text: '',
    }));

    const sourcesWithText: any = await Promise.all(
      sources.map(async (source) => {
        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timed out')), 5000),
          );

          const res = (await Promise.race([
            fetch(source.link),
            timeoutPromise,
          ])) as any;

          const html = await res.text();

          const virtualConsole = new jsdom.VirtualConsole();
          virtualConsole.on('error', (error) => {
            if (!error.message.includes('Could not parse CSS stylesheet')) {
              console.error(error);
            }
          });

          const dom = new JSDOM(html, { virtualConsole });
          const doc = dom.window.document;
          const parsed = new Readability(doc).parse();

          if (parsed) {
            let sourceText = cleanSourceText(parsed.textContent);
            return { ...source, text: sourceText.slice(0, 2000) } as GoogleSource;
          }

          return null;
        } catch (error) {
          console.error(error);
          return null;
        }
      }),
    );

    const filteredSources: GoogleSource[] = sourcesWithText.filter(Boolean);

    const answerPrompt = endent`
    Provide me with the information I requested. Use the sources to provide an accurate response. Respond in markdown format. Cite the sources you used as a markdown link as you use them at the end of each sentence by number of the source (ex: [[1]](link.com)). Provide an accurate response and then stop. Today's date is ${new Date().toLocaleDateString()}.

    Input:
    ${userMessage.content.trim()}

    Sources:
    ${filteredSources
      .map(
        (source) => endent`
        ${source.title} (${source.link}):
        ${source.text}
      `,
      )
      .join('\n\n')}

    Response:
    `;

    const answerMessage: Message = { role: 'user', content: answerPrompt };

    const answerRes = await fetch('http://localhost:8000/chat', {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `Use the sources to provide an accurate response. Respond in markdown format. Cite the sources you used as [1](link), etc. Maximum 4 sentences.`,
          },
          answerMessage,
        ],
        temperature: 1,
      }),
    });

    const reader = answerRes.body?.getReader();
    let fullText = '';

    if (reader) {
      const decoder = new TextDecoder();
      let done = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        if (value) {
          fullText += decoder.decode(value);
        }
        done = readerDone;
      }
    }

    // The backend already streams SSE JSON chunks, so we need to parse
    const lastChunk = fullText.split('\n\n').filter((c) => c.startsWith('data: ')).pop();
    const parsed = lastChunk && JSON.parse(lastChunk.replace('data: ', ''));
    const answer = parsed?.choices?.[0]?.delta?.content || 'No answer.';

    res.status(200).json({ answer });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error 3' });
  }
};

export default handler;
