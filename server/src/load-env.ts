import dotenv from 'dotenv';
import path from 'path';

// Side-effect module: load .env as early as possible. Must be the first import
// in server/src/index.ts so env vars are available before any other module's
// top-level code runs (auth.ts throws at load time if JWT_SECRET is unset).
//
// Tries cwd/.env first (npm run dev runs from the project root), then ../env
// (when the server is launched from server/). In Docker, env vars are injected
// via env_file, no .env file exists, and dotenv is a silent no-op. dotenv never
// overrides already-set process.env values, so real environment wins.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
