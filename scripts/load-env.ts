/**
 * Load .env.local the way Next.js does, so scripts and the app read the same
 * keys. Imported for side effects, before anything that touches process.env.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });
