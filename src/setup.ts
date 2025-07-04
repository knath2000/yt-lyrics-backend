import fs from 'fs';
import path from 'path';

// Define the path where the cookies.txt file will be created inside the container.
// Using /tmp is good practice for temporary files in containerized environments.
const COOKIE_FILE_PATH = path.join('/tmp', 'cookies.txt');

/**
 * Initializees the cookie jar by writing the content from an environment variable
 * to a temporary file. This file will then be used by yt-dlp.
 */
export function initializeCookieJar(): string | null {
  let cookieData = process.env.YOUTUBE_COOKIES_CONTENT;

  if (cookieData) {
    try {
      // Some platforms (e.g. Fly.io) may mangle new-lines or wrap the value in
      // quotes which breaks the Netscape cookie file format expected by yt-dlp.
      // 1. Strip wrapping quotes if present.
      if (cookieData.startsWith('"') && cookieData.endsWith('"')) {
        cookieData = cookieData.slice(1, -1);
      }

      // 2. If value looks like a single-line base64 string, attempt to decode it.
      //    This allows using `base64 < cookies.txt` when setting the secret so
      //    we don't have to worry about preserving tabs/newlines in CI.
      if (!cookieData.includes('\n') && /^[A-Za-z0-9+/=]+$/.test(cookieData.trim())) {
        try {
          const decoded = Buffer.from(cookieData, 'base64').toString('utf8');
          // Basic sanity check – cookie files always start with the Netscape header
          if (decoded.startsWith('#') || decoded.includes('\t')) {
            cookieData = decoded;
          }
        } catch {
          // Not valid base64 – fall back to raw value
        }
      }

      // Ensure the directory for the cookie file exists
      const dir = path.dirname(COOKIE_FILE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write the cookie data to the file
      fs.writeFileSync(COOKIE_FILE_PATH, cookieData, 'utf8');
      console.log(`Successfully initialized cookie jar at ${COOKIE_FILE_PATH}`);
      return COOKIE_FILE_PATH; // Return the path if successful
    } catch (error) {
      console.error(`Error initializing cookie jar: ${(error as Error).message}`);
      return null; // Return null if an error occurs
    }
  } else {
    console.log('YOUTUBE_COOKIES_CONTENT environment variable not found. Skipping cookie jar initialization.');
    return null; // Return null if the environment variable is not set
  }
}