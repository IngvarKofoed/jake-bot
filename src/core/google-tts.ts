/**
 * Google Cloud Text-to-Speech client.
 *
 * Uses the REST API with a simple API key — no service account needed.
 * Returns raw MP3 buffers suitable for streaming to the browser.
 */

import { log } from "./logger.js";

const TAG = "google-tts";
const TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

/** Max characters per TTS request (API limit is 5000, keep well under). */
const MAX_CHUNK_CHARS = 300;

interface SynthesizeResponse {
  audioContent: string; // base64-encoded audio
}

/**
 * Synthesize a single text string into MP3 audio.
 * Returns a base64-encoded MP3 string.
 */
export async function synthesize(
  text: string,
  apiKey: string,
): Promise<string> {
  const body = {
    input: { text },
    voice: { languageCode: "en-US", name: "en-US-Standard-J" },
    audioConfig: { audioEncoding: "MP3", speakingRate: 1.0 },
  };

  const res = await fetch(`${TTS_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Google TTS API ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const json = (await res.json()) as SynthesizeResponse;
  return json.audioContent;
}

/**
 * Split text into sentence-sized chunks for pipelined TTS.
 *
 * Splits on sentence boundaries (.!?) followed by whitespace/end,
 * then re-splits any chunks that exceed MAX_CHUNK_CHARS on commas,
 * semicolons, or word boundaries.
 */
export function splitSentences(text: string): string[] {
  // First pass: split on sentence-ending punctuation
  const raw = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Second pass: break overly long chunks
  const chunks: string[] = [];
  for (const segment of raw) {
    if (segment.length <= MAX_CHUNK_CHARS) {
      chunks.push(segment);
      continue;
    }
    // Try splitting on clause boundaries
    const clauses = segment
      .split(/(?<=[,;:])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    let current = "";
    for (const clause of clauses) {
      if (current && current.length + clause.length + 1 > MAX_CHUNK_CHARS) {
        chunks.push(current);
        current = clause;
      } else {
        current = current ? `${current} ${clause}` : clause;
      }
    }
    if (current) chunks.push(current);
  }

  return chunks;
}

/**
 * Synthesize text in sentence-sized chunks, invoking a callback
 * as each chunk's audio becomes available. Runs up to `concurrency`
 * TTS calls in parallel for pipelining.
 */
export async function synthesizeStreaming(
  text: string,
  apiKey: string,
  onChunk: (audioBase64: string, index: number, total: number) => void,
  concurrency = 3,
): Promise<void> {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return;

  log.info(TAG, `Synthesizing ${sentences.length} chunk(s), concurrency=${concurrency}`);

  // Results array preserves order
  const results: (string | undefined)[] = new Array(sentences.length);
  let nextToEmit = 0;
  let inFlight = 0;
  let nextToLaunch = 0;

  await new Promise<void>((resolve, reject) => {
    function tryEmit(): void {
      while (nextToEmit < results.length && results[nextToEmit] !== undefined) {
        onChunk(results[nextToEmit]!, nextToEmit, sentences.length);
        nextToEmit++;
      }
      if (nextToEmit >= sentences.length) {
        resolve();
      }
    }

    function launch(): void {
      while (inFlight < concurrency && nextToLaunch < sentences.length) {
        const idx = nextToLaunch++;
        inFlight++;
        synthesize(sentences[idx], apiKey)
          .then((audio) => {
            results[idx] = audio;
            inFlight--;
            tryEmit();
            launch();
          })
          .catch((err) => {
            log.error(TAG, `Chunk ${idx} failed: ${err instanceof Error ? err.message : String(err)}`);
            // Use empty string so we skip this chunk rather than stalling
            results[idx] = "";
            inFlight--;
            tryEmit();
            launch();
          });
      }
    }

    launch();
  });
}
