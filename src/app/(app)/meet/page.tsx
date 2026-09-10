"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { HiOutlineVideoCamera } from "react-icons/hi";

const GOOGLE_MEET_URL = "https://meet.google.com/uov-auvc-hcz?authuser=0";
const ZOOM_MEETING_ID = "81652804327";
const ZOOM_MEETING_PWD = "aCjH5WFtpqENykVv5bmVIswQPiX4sn.1";

export default function MeetPage() {
  const { dbUser, loading } = useAuth();
  const [launched, setLaunched] = useState(false);
  const name = dbUser?.full_name || "Guest";

  const zoomWebUrl = `https://us05web.zoom.us/wc/join/${ZOOM_MEETING_ID}?pwd=${ZOOM_MEETING_PWD}&uname=${encodeURIComponent(name)}`;
  const zoomAppUrl = `https://us05web.zoom.us/j/${ZOOM_MEETING_ID}?pwd=${ZOOM_MEETING_PWD}`;

  useEffect(() => {
    if (!loading && dbUser && !launched) {
      setLaunched(true);
      setTimeout(() => {
        window.open(GOOGLE_MEET_URL, "_blank");
      }, 1000);
    }
  }, [loading, dbUser, launched]);

  if (loading) return <div className="p-8 flex justify-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" /></div>;

  return (
    <div className="p-8 flex items-center justify-center min-h-[60vh] animate-fade-in">
      <div className="text-center space-y-6 max-w-md">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center mx-auto shadow-lg">
          <HiOutlineVideoCamera className="w-10 h-10 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Joining as</h1>
          <p className="text-3xl font-bold gradient-text mt-2">{name}</p>
          <p className="text-sm text-gray-500 mt-2">Your name is set from your login and cannot be changed.</p>
        </div>
        <div className="space-y-3">
          <a href={GOOGLE_MEET_URL} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:brightness-110 text-white font-medium rounded-xl shadow-lg transition-all active:scale-[0.97]">
            <HiOutlineVideoCamera className="w-5 h-5" /> Join Google Meet
          </a>
          <div className="space-y-1 pt-2">
            <div>
              <a href={zoomWebUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors underline">
                Fallback: Join Zoom in browser as {name}
              </a>
            </div>
            <div>
              <a href={zoomAppUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors underline">
                Open Zoom app instead
              </a>
            </div>
          </div>
          <p className="text-xs text-gray-400">Google Meet should open automatically in your browser.</p>
        </div>
      </div>
    </div>
  );
}
