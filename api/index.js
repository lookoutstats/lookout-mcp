// Vercel function: every path is rewritten here (vercel.json). It serves the built HTTP entry (`npm run build` first).
import { createHttpHandler } from "../dist/http.js";

const handle = createHttpHandler({ baseUrl: process.env.LOOKOUT_API_URL });

export const GET = (request) => handle(request);
export const POST = (request) => handle(request);
export const OPTIONS = (request) => handle(request);
export const DELETE = (request) => handle(request);
