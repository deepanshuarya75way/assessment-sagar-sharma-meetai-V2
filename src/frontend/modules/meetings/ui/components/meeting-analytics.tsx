"use client";

import { useMemo } from "react";
import {
  BarChart3Icon,
  Clock3Icon,
  MessageSquareTextIcon,
  UsersIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { Badge } from "@/frontend/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/frontend/components/ui/card";
import { Progress } from "@/frontend/components/ui/progress";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/frontend/components/ui/avatar";
import { generateAvatarUri } from "@/frontend/lib/avatar";
import { formatDuration } from "@/frontend/lib/utils";

import type { MeetingGetOne } from "../../types";

type Props = {
  meetingId: string;
  meeting: MeetingGetOne;
};

const HEATMAP_BUCKETS = 24;

const formatClock = (milliseconds: number) => {
  const totalSeconds = Math.max(
    0,
    Math.floor(milliseconds / 1000),
  );

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export const MeetingAnalytics = ({
  meetingId,
  meeting,
}: Props) => {
  const trpc = useTRPC();

  const { data: transcript, isLoading } = useQuery(
    trpc.meetings.getTranscript.queryOptions({
      id: meetingId,
    }),
  );

  const analytics = useMemo(() => {
    const items = transcript ?? [];

  
    const meetingDurationMs =
      meeting.startedAt && meeting.endedAt
        ? Math.max(
            0,
            new Date(meeting.endedAt).getTime() -
              new Date(meeting.startedAt).getTime(),
          )
        : Math.max(
            0,
            ...items.map((item) => item.stop_ts),
          );

    const speakers = new Map<
      string,
      {
        id: string;
        name: string;
        image: string;
        isAi: boolean;
        talkTimeMs: number;
        turns: number;
      }
    >();

    for (const item of items) {
      const duration = Math.max(
        0,
        item.stop_ts - item.start_ts,
      );

      const isAi = item.speaker_id === meeting.agentId;
      const existing = speakers.get(item.speaker_id);

      if (existing) {
        existing.talkTimeMs += duration;
        existing.turns += 1;
      } else {
        speakers.set(item.speaker_id, {
          id: item.speaker_id,
          name: isAi
            ? meeting.agent.name
            : item.user.name,
          image:
            item.user.image ??
            generateAvatarUri({
              seed: isAi
                ? meeting.agent.name
                : item.user.name,
              variant: isAi
                ? "botttsNeutral"
                : "initials",
            }),
          isAi,
          talkTimeMs: duration,
          turns: 1,
        });
      }
    }

    const totalTalkTimeMs = [
      ...speakers.values(),
    ].reduce(
      (total, speaker) =>
        total + speaker.talkTimeMs,
      0,
    );

    const speakerStats = [
      ...speakers.values(),
    ]
      .map((speaker) => ({
        ...speaker,
        percentage:
          totalTalkTimeMs > 0
            ? (speaker.talkTimeMs /
                totalTalkTimeMs) *
              100
            : 0,
      }))
      .sort(
        (a, b) =>
          b.talkTimeMs - a.talkTimeMs,
      );

    
    const bucketDurationMs =
      meetingDurationMs > 0
        ? meetingDurationMs /
          HEATMAP_BUCKETS
        : 1;

    const heatmap = speakerStats.map(
      (speaker) => {
        const speakerItems = items.filter(
          (item) =>
            item.speaker_id === speaker.id,
        );

        const buckets = Array.from(
          {
            length: HEATMAP_BUCKETS,
          },
          (_, index) => {
            const bucketStart =
              index * bucketDurationMs;

            const bucketEnd =
              bucketStart +
              bucketDurationMs;

            return speakerItems.reduce(
              (total, item) => {
                const overlap = Math.max(
                  0,
                  Math.min(
                    item.stop_ts,
                    bucketEnd,
                  ) -
                    Math.max(
                      item.start_ts,
                      bucketStart,
                    ),
                );

                return total + overlap;
              },
              0,
            );
          },
        );

        return {
          ...speaker,
          buckets,
        };
      },
    );

    return {
      speakerStats,
      heatmap,
      totalTalkTimeMs,
      meetingDurationMs,
      totalTurns: items.length,
    };
  }, [meeting, transcript]);

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-white px-4 py-10 text-center text-sm text-muted-foreground">
        Loading participation analytics...
      </div>
    );
  }

  if (
    !transcript?.length ||
    !analytics.speakerStats.length
  ) {
    return (
      <div className="rounded-lg border bg-white px-4 py-10 text-center">
        <p className="font-medium">
          No participation data available
        </p>

        <p className="mt-1 text-sm text-muted-foreground">
          Speaking analytics will appear once
          the meeting has transcript data.
        </p>
      </div>
    );
  }

  const humanSpeakers =
    analytics.speakerStats.filter(
      (speaker) => !speaker.isAi,
    );

  const aiSpeakers =
    analytics.speakerStats.filter(
      (speaker) => speaker.isAi,
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Total talk time
            </CardTitle>

            <Clock3Icon className="size-4 text-muted-foreground" />
          </CardHeader>

          <CardContent>
            <p className="text-2xl font-semibold">
              {formatDuration(
                analytics.totalTalkTimeMs /
                  1000,
              )}
            </p>

            <p className="text-xs text-muted-foreground">
              Meeting duration:{" "}
              {formatDuration(
                analytics.meetingDurationMs /
                  1000,
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Participants
            </CardTitle>

            <UsersIcon className="size-4 text-muted-foreground" />
          </CardHeader>

          <CardContent>
            <p className="text-2xl font-semibold">
              {humanSpeakers.length}
            </p>

            <p className="text-xs text-muted-foreground">
              Human attendees ·{" "}
              {aiSpeakers.length} AI assistant
              {aiSpeakers.length === 1
                ? ""
                : "s"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Speaking turns
            </CardTitle>

            <MessageSquareTextIcon className="size-4 text-muted-foreground" />
          </CardHeader>

          <CardContent>
            <p className="text-2xl font-semibold">
              {analytics.totalTurns}
            </p>

            <p className="text-xs text-muted-foreground">
              Transcript speaking turns
              across the meeting
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Participation breakdown
          </CardTitle>

          <p className="text-sm text-muted-foreground">
            Talk time, contribution
            percentage, and speaking turns
            for every attendee and the AI
            assistant.
          </p>
        </CardHeader>

        <CardContent className="space-y-5">
          {analytics.speakerStats.map(
            (speaker) => (
              <div
                key={speaker.id}
                className="space-y-2"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="size-8">
                      <AvatarImage
                        src={speaker.image}
                        alt={speaker.name}
                      />

                      <AvatarFallback>
                        {speaker.name
                          .slice(0, 1)
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {speaker.name}
                        </p>

                        {speaker.isAi && (
                          <Badge variant="secondary">
                            AI Assistant
                          </Badge>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground">
                        {formatDuration(
                          speaker.talkTimeMs /
                            1000,
                        )}{" "}
                        · {speaker.turns} turn
                        {speaker.turns === 1
                          ? ""
                          : "s"}
                      </p>
                    </div>
                  </div>

                  <p className="shrink-0 text-sm font-semibold">
                    {speaker.percentage.toFixed(
                      1,
                    )}
                    %
                  </p>
                </div>

                <Progress
                  value={speaker.percentage}
                />
              </div>
            ),
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Speaking timeline
          </CardTitle>

          <p className="text-sm text-muted-foreground">
            Speaking activity across the
            meeting timeline. Hover a cell to
            see the speaking duration for that
            interval.
          </p>
        </CardHeader>

        <CardContent>
          <div className="overflow-x-auto">
            <div className="min-w-[760px] space-y-3">
              {analytics.heatmap.map(
                (speaker) => (
                  <div
                    key={speaker.id}
                    className="grid grid-cols-[180px_1fr] items-center gap-4"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar className="size-7">
                        <AvatarImage
                          src={speaker.image}
                          alt={speaker.name}
                        />

                        <AvatarFallback>
                          {speaker.name
                            .slice(0, 1)
                            .toUpperCase()}
                        </AvatarFallback>
                      </Avatar>

                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {speaker.name}
                        </p>

                        <p className="text-xs text-muted-foreground">
                          {speaker.isAi
                            ? "AI assistant"
                            : "Human attendee"}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-1">
                      {speaker.buckets.map(
                        (
                          activityMs,
                          index,
                        ) => {
                          const intensity =
                            activityMs > 0 &&
                            bucketDurationMsForDisplay(
                              analytics.meetingDurationMs,
                            ) > 0
                              ? Math.min(
                                  1,
                                  activityMs /
                                    bucketDurationMsForDisplay(
                                      analytics.meetingDurationMs,
                                    ),
                                )
                              : 0;

                          return (
                            <div
                              key={`${speaker.id}-${index}`}
                              title={`${speaker.name} · ${formatClock(
                                index *
                                  bucketDurationMsForDisplay(
                                    analytics.meetingDurationMs,
                                  ),
                              )} · ${formatClock(
                                activityMs,
                              )} speaking`}
                              className="h-8 rounded-sm border bg-muted"
                              style={
                                activityMs > 0
                                  ? {
                                      opacity:
                                        0.25 +
                                        intensity *
                                          0.75,
                                    }
                                  : undefined
                              }
                            >
                              {activityMs > 0 && (
                                <div className="h-full rounded-sm bg-primary" />
                              )}
                            </div>
                          );
                        },
                      )}
                    </div>
                  </div>
                ),
              )}

              <div className="grid grid-cols-[180px_1fr] gap-4">
                <div />

                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>0:00</span>

                  <span>
                    {formatClock(
                      analytics.meetingDurationMs /
                        2,
                    )}
                  </span>

                  <span>
                    {formatClock(
                      analytics.meetingDurationMs,
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const bucketDurationMsForDisplay = (
  meetingDurationMs: number,
) =>
  meetingDurationMs > 0
    ? meetingDurationMs / HEATMAP_BUCKETS
    : 1;