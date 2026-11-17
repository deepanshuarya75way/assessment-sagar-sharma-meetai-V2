"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderIcon } from "lucide-react";
import {
  Call,
  StreamCall,
  StreamVideo,
  StreamVideoClient,
} from "@stream-io/video-react-sdk";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { CallUI } from "./call-ui";
import "@stream-io/video-react-sdk/dist/css/styles.css";

interface Props {
  meetingId: string;
  meetingName: string;
  userId: string;
  userName: string;
  userImage: string;
}

export const CallConnect = ({
  meetingId,
  meetingName,
  userId,
  userName,
  userImage,
}: Props) => {
  const trpc = useTRPC();

  const { mutateAsync: generateToken } = useMutation(
    trpc.meetings.generateToken.mutationOptions(),
  );

  const generateTokenRef = useRef(generateToken);

  useEffect(() => {
    generateTokenRef.current = generateToken;
  }, [generateToken]);

  const [client, setClient] = useState<StreamVideoClient>();
  const [call, setCall] = useState<Call>();

  useEffect(() => {
    const streamClient = new StreamVideoClient({
      apiKey: process.env.NEXT_PUBLIC_STREAM_VIDEO_API_KEY!,
      user: {
        id: userId,
        name: userName,
        image: userImage,
      },
      tokenProvider: () => generateTokenRef.current(),
    });

    setClient(streamClient);

    return () => {
      void streamClient.disconnectUser();
    };
  }, [userId, userName, userImage]);

  useEffect(() => {
    if (!client) return;

    const streamCall = client.call("default", meetingId);

    setCall(streamCall);

    return () => {
      void streamCall.leave();
      setCall(undefined);
    };
  }, [client, meetingId]);

  if (!client || !call) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoaderIcon className="size-6 animate-spin" />
      </div>
    );
  }

  return (
    <StreamVideo client={client}>
      <StreamCall call={call}>
        <CallUI meetingName={meetingName} />
      </StreamCall>
    </StreamVideo>
  );
};