"use client";

import { useRef, useState } from "react";
import {
  CallingState,
  StreamTheme,
  useCall,
  useCallStateHooks,
} from "@stream-io/video-react-sdk";

import { CallLobby } from "./call-lobby";
import { CallActive } from "./call-active";
import { CallEnded } from "./call-ended";

interface Props {
  meetingName: string;
}

export const CallUI = ({
  meetingName,
}: Props) => {
  const call = useCall();

  const { useCallCallingState } =
    useCallStateHooks();

  const callingState =
    useCallCallingState();

  const [show, setShow] = useState<
    "lobby" | "call" | "ended"
  >("lobby");

  const joiningRef = useRef(false);

  const handleJoin = async () => {
    if (!call || joiningRef.current) return;

    if (callingState === CallingState.JOINED) {
      setShow("call");
      return;
    }

    if (callingState === CallingState.JOINING) {
      return;
    }

    joiningRef.current = true;

    try {
      await call.join();

      setShow("call");

      try {
        await call.microphone.enable();
      } catch (error) {
        console.error(
          "Failed to enable microphone:",
          error,
        );
      }

      try {
        await call.camera.enable();
      } catch (error) {
        console.error(
          "Failed to enable camera:",
          error,
        );
      }
    } catch (error) {
      console.error(
        "Failed to join meeting:",
        error,
      );
    } finally {
      joiningRef.current = false;
    }
  };

  const handleLeave = async () => {
    if (!call) return;

    try {
      await call.endCall();
    } catch (error) {
      console.error(
        "Failed to end call, leaving instead:",
        error,
      );

      await call.leave();
    } finally {
      joiningRef.current = false;
      setShow("ended");
    }
  };

  return (
    <StreamTheme className="h-full">
      {show === "lobby" && (
        <CallLobby onJoin={handleJoin} />
      )}

      {show === "call" && (
        <CallActive
          onLeave={handleLeave}
          meetingName={meetingName}
        />
      )}

      {show === "ended" && (
        <CallEnded />
      )}
    </StreamTheme>
  );
};