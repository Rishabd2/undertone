import { speak } from "@/lib/deepgram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The agent's spoken turn. Deepgram Aura, same vendor as the recognizer. */
export async function POST(request: Request) {
  try {
    const { text } = (await request.json()) as { text?: string };
    if (!text?.trim()) {
      return new Response("text is required", { status: 400 });
    }
    const audio = await speak(text);
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/l16; rate=24000",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), {
      status: 500,
    });
  }
}
