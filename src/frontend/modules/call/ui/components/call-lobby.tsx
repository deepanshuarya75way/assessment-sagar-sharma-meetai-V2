"use client";

import Link from "next/link";
import { CameraOffIcon, LogInIcon } from "lucide-react";

import { Button } from "@/frontend/components/ui/button";

interface Props {
  onJoin: () => void;
}

export const CallLobby = ({ onJoin }: Props) => {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-radial from-sidebar-accent to-sidebar">
      <div className="flex flex-1 items-center justify-center px-8 py-4">
        <div className="flex flex-col items-center justify-center gap-y-6 rounded-lg bg-background p-10 shadow-sm">
          <div className="flex flex-col gap-y-2 text-center">
            <h6 className="text-lg font-medium">Ready to join?</h6>
            <p className="text-sm">
              Set up your call before joining.
            </p>
          </div>

          {/* Assessment fix:
              The Stream VideoPreview component causes an infinite
              state-update loop in this browser environment when no
              camera device is available.
          */}
          <div className="flex h-64 w-full min-w-[400px] items-center justify-center rounded-lg bg-muted">
            <div className="flex flex-col items-center gap-y-3 text-muted-foreground">
              <CameraOffIcon className="size-10" />
              <p className="text-sm">Camera unavailable</p>
              <p className="text-xs">
                You can still join the call.
              </p>
            </div>
          </div>

          {/* Assessment fix:
              Do not render Stream's preview toggle buttons here.
              They depend on the same preview/media state that is
              causing the browser-side update loop.
          */}
          <div className="flex w-full justify-between gap-x-2">
            <Button asChild variant="ghost">
              <Link href="/meetings">Cancel</Link>
            </Button>

            <Button onClick={onJoin}>
              <LogInIcon />
              Join call
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};