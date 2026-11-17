import {
  and,
  eq,
  inArray,
  not,
} from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { gunzipSync } from "zlib";
import type {
  CallRecordingReadyEvent,
  CallSessionParticipantLeftEvent,
  CallSessionStartedEvent,
  CallTranscriptionReadyEvent,
  CallSessionEndedEvent,
  MessageNewEvent,
} from "@stream-io/node-sdk";

import { db } from "@/backend/db";
import {
  agents,
  meetings,
  user,
} from "@/backend/db/schema";
import { getStreamVideo } from "@/backend/lib/stream-video";
import { getStreamChat } from "@/backend/lib/stream-chat";
import { generateAvatarUri } from "@/frontend/lib/avatar";

const generateGeminiResponse = async ({
  systemInstruction,
  conversation,
}: {
  systemInstruction: string;
  conversation: {
    role: "user" | "model";
    content: string;
  }[];
}) => {
  const apiKey =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is missing",
    );
  }

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [
            {
              text: systemInstruction,
            },
          ],
        },
        contents: conversation.map(
          (message) => ({
            role: message.role,
            parts: [
              {
                text: message.content,
              },
            ],
          }),
        ),
        generationConfig: {
          temperature: 0.3,
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `Gemini API failed (${response.status}): ${errorText}`,
    );
  }

  const data = await response.json();

  const responseText =
    data?.candidates?.[0]?.content?.parts
      ?.map(
        (part: { text?: string }) =>
          part.text || "",
      )
      .join("")
      .trim();

  if (!responseText) {
    throw new Error(
      "Gemini returned an empty response",
    );
  }

  return responseText;
};


const generateMeetingSummary = async (
  transcript: any[],
) => {
  const summaryPrompt = `
You are an expert meeting summarizer.

Summarize the following meeting transcript.

Use exactly this markdown structure:

### Overview
Provide a detailed but concise summary of the session.
Focus on major topics, discussions, decisions,
workflows, demonstrations, and important takeaways.

### Notes

#### Section Name
- Main point
- Important detail
- Action or takeaway

Create multiple sections when the transcript covers
different topics.

Include timestamps when they are available.

Keep the summary factual.
Do not invent information that is not present in
the transcript.

Transcript:

${JSON.stringify(transcript)}
`.trim();

  return generateGeminiResponse({
    systemInstruction:
      "You are an expert meeting summarizer. Only use information contained in the provided transcript.",
    conversation: [
      {
        role: "user",
        content: summaryPrompt,
      },
    ],
  });
};

const verifyWebhookSignature = (
  body: Buffer,
  signature: string,
): Buffer | null => {
  const secret =
    process.env.STREAM_VIDEO_SECRET_KEY;

  if (!secret) {
    console.error(
      "STREAM_VIDEO_SECRET_KEY is missing",
    );
    return null;
  }

  const uncompressedBody =
    body.length >= 2 &&
    body[0] === 0x1f &&
    body[1] === 0x8b
      ? gunzipSync(body)
      : body;

  const expectedSignature = createHmac(
    "sha256",
    secret,
  )
    .update(uncompressedBody)
    .digest("hex");

  const received = Buffer.from(
    signature,
    "utf8",
  );

  const expected = Buffer.from(
    expectedSignature,
    "utf8",
  );

  if (
    received.length !== expected.length ||
    !timingSafeEqual(
      received,
      expected,
    )
  ) {
    return null;
  }

  return uncompressedBody;
};

export async function POST(
  req: NextRequest,
) {
  console.log(
    "STREAM WEBHOOK RECEIVED",
  );

  const signature =
    req.headers.get("x-signature");

  const apiKey =
    req.headers.get("x-api-key");

  if (!signature || !apiKey) {
    return NextResponse.json(
      {
        error:
          "Missing signature or API key",
      },
      { status: 400 },
    );
  }

  const configuredApiKey =
    process.env
      .NEXT_PUBLIC_STREAM_VIDEO_API_KEY;

  if (
    configuredApiKey &&
    apiKey !== configuredApiKey
  ) {
    console.error(
      "STREAM WEBHOOK: Invalid API key",
    );

    return NextResponse.json(
      {
        error: "Invalid API key",
      },
      { status: 401 },
    );
  }

  const rawBody = Buffer.from(
    await req.arrayBuffer(),
  );

  const verifiedBody =
    verifyWebhookSignature(
      rawBody,
      signature,
    );

  if (!verifiedBody) {
    console.error(
      "STREAM WEBHOOK: Invalid signature",
    );

    return NextResponse.json(
      {
        error: "Invalid signature",
      },
      { status: 401 },
    );
  }

  let payload: Record<string, any>;

  try {
    payload = JSON.parse(
      verifiedBody.toString("utf8"),
    );
  } catch {
    return NextResponse.json(
      {
        error: "Invalid JSON",
      },
      { status: 400 },
    );
  }

  const eventType = payload.type;

  console.log(
    "STREAM WEBHOOK EVENT:",
    eventType,
  );

  const streamVideo =
    getStreamVideo();

  /*
   * ============================================================
   * CALL SESSION STARTED
   * ============================================================
   */
  if (
    eventType ===
    "call.session_started"
  ) {
    const event =
      payload as CallSessionStartedEvent;

    const meetingId =
      event.call_cid.split(":")[1];

    if (!meetingId) {
      return NextResponse.json(
        {
          error: "Missing meetingId",
        },
        { status: 400 },
      );
    }

    const [existingMeeting] =
      await db
        .select()
        .from(meetings)
        .where(
          and(
            eq(
              meetings.id,
              meetingId,
            ),
            not(
              eq(
                meetings.status,
                "completed",
              ),
            ),
            not(
              eq(
                meetings.status,
                "active",
              ),
            ),
            not(
              eq(
                meetings.status,
                "cancelled",
              ),
            ),
            not(
              eq(
                meetings.status,
                "processing",
              ),
            ),
          ),
        );

    if (!existingMeeting) {
      console.log(
        "STREAM WEBHOOK: Meeting already active or processed:",
        meetingId,
      );

      return NextResponse.json({
        status: "ok",
      });
    }

    await db
      .update(meetings)
      .set({
        status: "active",
        startedAt: new Date(),
      })
      .where(
        eq(
          meetings.id,
          meetingId,
        ),
      );

    console.log(
      "MEETING STATUS: upcoming -> active",
      meetingId,
    );


  }

  /*
   * ============================================================
   * PARTICIPANT LEFT
   * ============================================================
   */
  else if (
    eventType ===
    "call.session_participant_left"
  ) {
    const event =
      payload as CallSessionParticipantLeftEvent;

    const meetingId =
      event.call_cid.split(":")[1];

    if (!meetingId) {
      return NextResponse.json(
        {
          error: "Missing meetingId",
        },
        { status: 400 },
      );
    }

    const call =
      streamVideo.video.call(
        "default",
        meetingId,
      );

    await call.end();
  }

  /*
   * ============================================================
   * SESSION ENDED
   * ============================================================
   */
  else if (
    eventType ===
    "call.session_ended"
  ) {
    const event =
      payload as CallSessionEndedEvent;

    const meetingId =
      event.call_cid.split(":")[1];

    if (!meetingId) {
      return NextResponse.json(
        {
          error: "Missing meetingId",
        },
        { status: 400 },
      );
    }

    await db
      .update(meetings)
      .set({
        status: "processing",
        endedAt: new Date(),
      })
      .where(
        and(
          eq(
            meetings.id,
            meetingId,
          ),
          eq(
            meetings.status,
            "active",
          ),
        ),
      );

    console.log(
      "MEETING STATUS: active -> processing",
      meetingId,
    );
  }

  /*
   * ============================================================
   * TRANSCRIPTION READY
   * ============================================================
   */
  else if (
    eventType ===
    "call.transcription_ready"
  ) {
    const event =
      payload as CallTranscriptionReadyEvent;

    const meetingId =
      event.call_cid.split(":")[1];

    if (!meetingId) {
      return NextResponse.json(
        {
          error: "Missing meetingId",
        },
        { status: 400 },
      );
    }

    const [updatedMeeting] =
      await db
        .update(meetings)
        .set({
          transcriptUrl:
            event.call_transcription.url,
        })
        .where(
          eq(
            meetings.id,
            meetingId,
          ),
        )
        .returning();

    if (!updatedMeeting) {
      return NextResponse.json(
        {
          error: "Meeting not found",
        },
        { status: 404 },
      );
    }

    try {
      const transcriptResponse =
        await fetch(
          updatedMeeting.transcriptUrl!,
        );

      if (!transcriptResponse.ok) {
        throw new Error(
          `Failed to fetch transcript: ${transcriptResponse.status}`,
        );
      }

      const transcriptText =
        await transcriptResponse.text();

      const transcript =
        transcriptText
          .split("\n")
          .filter(
            (line) =>
              line.trim(),
          )
          .map((line) =>
            JSON.parse(line),
          );

      const speakerIds = [
        ...new Set(
          transcript
            .map(
              (item: any) =>
                item.speaker_id,
            )
            .filter(Boolean),
        ),
      ];

      const userSpeakers =
        speakerIds.length > 0
          ? await db
              .select({
                id: user.id,
                name: user.name,
              })
              .from(user)
              .where(
                inArray(
                  user.id,
                  speakerIds,
                ),
              )
          : [];

      const agentSpeakers =
        speakerIds.length > 0
          ? await db
              .select({
                id: agents.id,
                name: agents.name,
              })
              .from(agents)
              .where(
                inArray(
                  agents.id,
                  speakerIds,
                ),
              )
          : [];

      const speakers = [
        ...userSpeakers,
        ...agentSpeakers,
      ];

      const transcriptWithSpeakers =
        transcript.map(
          (item: any) => {
            const speaker =
              speakers.find(
                (s) =>
                  s.id ===
                  item.speaker_id,
              );

            return {
              ...item,
              speaker_name:
                speaker?.name ??
                "Unknown",
            };
          },
        );

      console.log(
        "Generating Gemini meeting summary...",
      );

      const summary =
        await generateMeetingSummary(
          transcriptWithSpeakers,
        );

      await db
        .update(meetings)
        .set({
          summary,
          status: "completed",
        })
        .where(
          eq(
            meetings.id,
            updatedMeeting.id,
          ),
        );

      console.log(
        "MEETING STATUS: processing -> completed",
        updatedMeeting.id,
      );
    } catch (error) {
      console.error(
        "Failed to process meeting transcript:",
        error,
      );
    }
  }

  /*
   * ============================================================
   * RECORDING READY
   * ============================================================
   */
  else if (
    eventType ===
    "call.recording_ready"
  ) {
    const event =
      payload as CallRecordingReadyEvent;

    const meetingId =
      event.call_cid.split(":")[1];

    if (!meetingId) {
      return NextResponse.json(
        {
          error: "Missing meetingId",
        },
        { status: 400 },
      );
    }

    await db
      .update(meetings)
      .set({
        recordingUrl:
          event.call_recording.url,
      })
      .where(
        eq(
          meetings.id,
          meetingId,
        ),
      );
  }

  /*
   * ============================================================
   * POST-MEETING CHAT
   * ============================================================
   */
  else if (
    eventType === "message.new"
  ) {
    const event =
      payload as MessageNewEvent;

    const userId =
      event.user?.id;

    const channelId =
      event.channel_id;

    const text =
      event.message?.text;

    if (
      !userId ||
      !channelId ||
      !text
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required fields",
        },
        { status: 400 },
      );
    }

    const [existingMeeting] =
      await db
        .select()
        .from(meetings)
        .where(
          and(
            eq(
              meetings.id,
              channelId,
            ),
            eq(
              meetings.status,
              "completed",
            ),
          ),
        );

    if (!existingMeeting) {
      return NextResponse.json(
        {
          error:
            "Meeting not found",
        },
        { status: 404 },
      );
    }

    const [existingAgent] =
      await db
        .select()
        .from(agents)
        .where(
          eq(
            agents.id,
            existingMeeting.agentId,
          ),
        );

    if (!existingAgent) {
      return NextResponse.json(
        {
          error: "Agent not found",
        },
        { status: 404 },
      );
    }

    if (
      userId === existingAgent.id
    ) {
      return NextResponse.json({
        status: "ok",
      });
    }

    const instructions = `
You are an AI assistant helping the user revisit a recently completed meeting.

Below is a summary of the meeting:

${existingMeeting.summary}

The following are your original instructions from the live meeting assistant:

${existingAgent.instructions}

The user may ask questions about the meeting,
request clarifications, or request follow-up actions.

Always base your responses on the meeting summary above.

You also have access to recent conversation history.
Use that context to provide relevant and coherent responses.

If the summary does not contain enough information
to answer a question, politely let the user know.

Be concise, helpful, and accurate.
`.trim();

    const streamChat =
      getStreamChat();

    const channel =
      streamChat.channel(
        "messaging",
        channelId,
      );

    await channel.watch();

    const previousMessages =
      channel.state.messages
        .slice(-5)
        .filter(
          (message) =>
            message.text &&
            message.text.trim() !== "",
        )
        .map(
          (message) => ({
            role:
              message.user?.id ===
              existingAgent.id
                ? ("model" as const)
                : ("user" as const),
            content:
              message.text || "",
          }),
        );

    
    const geminiResponse =
      await generateGeminiResponse({
        systemInstruction:
          instructions,
        conversation: [
          ...previousMessages,
          {
            role: "user",
            content: text,
          },
        ],
      });

    const avatarUrl =
      generateAvatarUri({
        seed: existingAgent.name,
        variant: "botttsNeutral",
      });

    await streamChat.upsertUser({
      id: existingAgent.id,
      name: existingAgent.name,
      image: avatarUrl,
    });

    await channel.sendMessage({
      text: geminiResponse,
      user: {
        id: existingAgent.id,
        name: existingAgent.name,
        image: avatarUrl,
      },
    });
  }

  return NextResponse.json({
    status: "ok",
  });
}