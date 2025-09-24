export const config = {
  runtime: 'edge',
};

const handler = async (req: Request): Promise<Response> => {
  try {
    const response = await fetch('http://localhost:8000/models');

    if (!response.ok) {
      throw new Error(`Local API returned ${response.status}`);
    }

    const models = await response.json();

    return new Response(JSON.stringify(models), { status: 200 });
  } catch (error) {
    console.error(error);
    return new Response('Error 2', { status: 500 });
  }
};

export default handler;
